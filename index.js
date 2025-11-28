// index.js  — Ultimate Namma KARTET English Mentor (Lang-II)
// File2 (analytics, leaderboard) + multilingual UI (from File1 style)

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

// Simple JSON file DB for streaks + wrongBank
const DB_FILE = "./botdb.json";

let persistent = {
  streaks: {},   // { [userId]: { currentStreak, lastTestDate } }
  wrongBank: {}, // { [userId]: [questionId, ...] }
};

try {
  const raw = fs.readFileSync(DB_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === "object") {
    persistent.streaks = parsed.streaks || {};
    persistent.wrongBank = parsed.wrongBank || {};
  }
} catch (e) {
  // First run / file missing / invalid → start fresh
  console.log("ℹ️ No existing botdb.json, starting fresh.");
}

function savePersistentDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(persistent, null, 2));
  } catch (e) {
    console.error("❌ Error writing botdb.json:", e);
  }
}

// ========= LAYER 2 HELPERS =========

// ✅ Shuffle helper
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ✅ Difficulty ramp: Easy → Moderate → Tough
function applyDifficultyRamp(pool) {
  return pool.sort((a, b) => (a.level || 1) - (b.level || 1));
}

// ✅ Store old wrong questions per user (temporary RAM version)
const wrongBank = {}; // { userId: Set(questionId) }
// Hydrate wrongBank from persisted data
Object.keys(persistent.wrongBank).forEach((uid) => {
  const ids = persistent.wrongBank[uid] || [];
  wrongBank[uid] = new Set(ids);
});


// ✅ Build final practice pool = 3 New + 2 Old Wrong
function buildPracticePool(userId, allQuestions, size = MINI_TEST_SIZE) {
  const history = [...(wrongBank[userId] || [])];

  // ✅ Pick up to 2 old wrong
  const oldWrongs = shuffleArray(history)
    .map(id => allQuestions.find(q => q.id === id))
    .filter(Boolean)
    .slice(0, 2);

  const usedIds = new Set(oldWrongs.map(q => q.id));

  // ✅ Pick remaining NEW questions
  const freshPool = allQuestions.filter(q => !usedIds.has(q.id));
  const newOnes = shuffleArray(freshPool).slice(0, size - oldWrongs.length);

  // ✅ Final = old wrong + new
  const finalPool = [...oldWrongs, ...newOnes];

  return applyDifficultyRamp(finalPool);
}


// ================== CONFIG ==================

// Load English Language II questions
// Make sure this file exists and is valid JSON
const questions = require("./eng_questions.json");

// Premium users (hard-coded for now)
// Add your own Telegram user id here
const premiumUsers = new Set([
  437248254, // example: your id
  // 1295834746, // add more ids as needed
]);

function isPremiumUser(userId) {
  return premiumUsers.has(userId);
}

// Free-plan limits
const FREE_DAILY_MINI_TESTS = 1; // 1 test per day
const MINI_TEST_SIZE = 5; // 5 questions per free test

// Sound config (Telegram file_id placeholders)
// Step:
// 1. Send a short sound to your bot
// 2. Read the file_id from update
// 3. Paste here
const CORRECT_SOUND_FILE_ID = ""; // e.g. "CQACAgUAAxkBA....."
const WRONG_SOUND_FILE_ID = "";   // e.g. "CQACAgUAAxkBA....."

// Telegram bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.on("polling_error", (err) => {
  console.error("❌ Telegram polling error:", err.message || err);
});


// ================== IN-MEMORY STORES ==================


const sessions = {};   // per-chat active test
const lastResults = {}; // per-chat last finished test
const mainResults = {}; // only non-retake (main) tests go here

const userStats = {};   // per-user aggregated stats

// userPrefs[userId] = {
//   uiLang: 'en' | 'kn' | 'ur',
// }
//
// userPrefs[userId] = {
//   eng2Mode: 'rc' | 'grammar' | 'poetry' | 'pedagogy' | 'vocab' | 'mixed'
// }


const letters = ["a", "b", "c", "d"];

// Simple reactions
const correctReactions = ["✅", "🎯 Great!", "🔥 Superb!", "🌟 Excellent!"];
const wrongReactions = ["❌", "⚠️ Revise this", "🧐 Check again", "📚 Needs revision"];

// ================== MULTILINGUAL UI TEXT ==================

const uiText = {
  en: {
    langName: "English",
    // Start flow
    startGreeting: "👋 Welcome to *Namma KARTET English Mentor* (Language II)!",
    startSub:
      "First, choose your app language for menus & messages.\n_Questions will remain in English, just like the exam._",
    chooseLanguage: "Choose your language:",
    langEnglishButton: "🇬🇧 English (Free)",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    // After language chosen
    welcomeMain:
      "Welcome! I’ll help you practise *English Language – II* with daily tests, explanations and topic-wise analysis.",

    // ✅ LAYER 1 – HOME BUTTONS (EN)
    todaysPracticeButton: "🎯 Today’s Practice",
    myProgressButton: "📊 My Progress",
    myWeakAreasButton: "📌 My Weak Areas",
    moreOptionsButton: "📂 More Options",


    // Main menu labels
    mainMenuIntro:
      "What would you like to do now?",
    dailyPracticeButton: "🧪 Daily Practice Test",
    fullMockButton: "📄 Full Mock Test (coming later)",
    leaderboardButton: "🏆 Leaderboard",
    helpButton: "❓ Help",

    // Premium language pitch
    premiumLangPitch:
      "*Mentor+ (Premium) Special Access*\n\n" +
      "Kannada / Urdu menus & guidance are part of Mentor+.\n\n" +
      "Premium includes:\n" +
      "• Unlimited tests & retakes\n" +
      "• Full explanations & teaching tips\n" +
      "• Topic-wise & weak-topic analysis\n" +
      "• Multilingual guidance (Kannada/Urdu)\n\n" +
      "Upgrade later when you're ready. For now, continue in English.",
    upgradeButton: "⭐ Upgrade to Mentor+",
    continueEnglishButton: "➡️ Continue in English",

    // Help / status etc
    helpTitle: "❓ Help – Namma KARTET English Mentor",
    accountStatusTitle: "📊 Your Account Status",
    planFree: "Free User",
    planPremium: "⭐ Premium (Mentor+)",

    // Settings / language
    settingsButton: "⚙️ Settings",
    changeLanguageButton: "🌐 Change Language",
    settingsTitle: "⚙️ Settings",
    changeLanguageTitle: "🌐 Change Language",
    changeLanguageSub: "Choose your preferred language for menus and messages.",


    // Result / summary headings
    testFinished: "✅ *Test finished!*",
    summaryHeading: "📊 *Summary*",
    scoreLabel: "Score",
    attemptedLabel: "Attempted",
    skippedLabel: "Skipped",
    wrongLabel: "Wrong",
    accuracyLabel: "Accuracy (on attempted)",
    topicPerfTitle: "📚 *Topic-wise performance*",
    weakTopicsTitle: "⚠️ *Weak topics (focus here first)*",
    rightAnswersTitle: "✅ *Right Answers (with explanations)*",
    wrongAnswersTitle: "❌ *Wrong Answers (with explanations & tips)*",
    wrongPreviewTitle: "❌ *Wrong Answers (preview)*",
    noTopicsYet:
      "Not enough data to show topic-wise stats yet.",
    noWeakTopics:
      "Right now, no clear weak topics based on threshold. Keep maintaining this level!",
    noWrongAnswers:
      "✅ No wrong answers in this test.\nExcellent work!",
    noRightAnswers:
      "You had no fully correct answers in this test.\nNext time it will be better.",
    wrongRetakeStart:
      "Starting a test with only your previous wrong questions.",
    wrongRetakePerfect:
      "Super! You got everything correct in the last test.\nNo wrong-only retest needed.",
    freeLimitReached:
      "⏳ Free limit reached for today.\n\n" +
      "You already used your free mini-test.\n\n" +
      "Free plan:\n" +
      `• 1 mini-test (${MINI_TEST_SIZE} questions) per day\n\n` +
      "To unlock full access, you can think about Mentor+ later.",
  },
  kn: {
    langName: "ಕನ್ನಡ",
    startGreeting:
      "👋 *Namma KARTET English Mentor* ಗೆ ಸ್ವಾಗತ!",
    startSub:
      "ಮೊದಲು ನಿಮಗೆ menus & messages ಯಾವ ಭಾಷೆಯಲ್ಲಿ ಬೇಕೋ ಆಯ್ಕೆಮಾಡಿ.\nಪ್ರಶ್ನೆಗಳು ಮಾತ್ರ exam ಹಾಗೆ English ನಲ್ಲೇ ಇರುತ್ತವೆ.",
    chooseLanguage: "ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆಮಾಡಿ:",
    langEnglishButton: "🇬🇧 English (ಉಚಿತ)",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    welcomeMain:
      "ಸ್ವಾಗತ! Daily practice, explanations, topic-wise analysis ಮೂಲಕ English Language – II ಸಿದ್ಧತೆ ಮಾಡೋಣ.",

    // ✅ LAYER 1 – HOME BUTTONS (KN)
    todaysPracticeButton: "🎯 ಇಂದಿನ ಅಭ್ಯಾಸ",
    myProgressButton: "📊 ನನ್ನ ಪ್ರಗತಿ",
    myWeakAreasButton: "📌 ನನ್ನ ದುರ್ಬಲ ಭಾಗಗಳು",
    moreOptionsButton: "📂 ಇನ್ನಷ್ಟು ಆಯ್ಕೆಗಳು",


    mainMenuIntro: "ಈಗ ಏನು ಮಾಡ್ಬೇಕು?",
    dailyPracticeButton: "🧪 Daily Practice Test",
    fullMockButton: "📄 Full Mock Test (ತಕ್ಷಣ ಬರ್ತದೆ)",
    leaderboardButton: "🏆 Leaderboard",
    helpButton: "❓ Help",

    premiumLangPitch:
      "*Mentor+ (Premium) ವಿಶೇಷ ಸೌಲಭ್ಯ*\n\n" +
      "Kannada menus & guidance Mentor+ ಭಾಗ.\n\n" +
      "Mentor+ ನಲ್ಲಿ:\n" +
      "• Unlimited tests & mocks\n" +
      "• ಪೂರ್ಣ explanations & teaching tips\n" +
      "• Topic-wise & weak-topic analysis\n" +
      "• Multilingual guidance (Kannada/Urdu)\n\n" +
      "ಈಗ examಗೇ focus ಮಾಡಿ, ಮುಂದೆ ಬೇಕಾದ್ರೆ upgrade ಮಾಡ್ಕೊಳ್ಳಿ.",
    upgradeButton: "⭐ Mentor+ upgrade",
    continueEnglishButton: "➡️ Englishನಲ್ಲಿ ಮುಂದುವರಿಸಿ",

    helpTitle: "❓ Help – Namma KARTET English Mentor",
    accountStatusTitle: "📊 ನಿಮ್ಮ Account Status",
    planFree: "Free User",
    planPremium: "⭐ Premium (Mentor+)",

    // Settings / language
    settingsButton: "⚙️ Settings",
    changeLanguageButton: "🌐 Change Language",
    settingsTitle: "⚙️ Settings",
    changeLanguageTitle: "🌐 Change Language",
    changeLanguageSub: "Choose your preferred language for menus and messages.",


    testFinished: "✅ *Test ಮುಗಿತು!*",
    summaryHeading: "📊 *Summary*",
    scoreLabel: "Score",
    attemptedLabel: "Attempted",
    skippedLabel: "Skipped",
    wrongLabel: "Wrong",
    accuracyLabel: "Accuracy (on attempted)",
    topicPerfTitle: "📚 *Topic-wise performance*",
    weakTopicsTitle: "⚠️ *Weak topics*",
    rightAnswersTitle: "✅ *Right Answers*",
    wrongAnswersTitle: "❌ *Wrong Answers*",
    wrongPreviewTitle: "❌ *Wrong Answers (preview)*",
    noTopicsYet: "Topic-wise stats ತೋರಿಸೋಕೆ data ಸಾಲಿಲ್ಲ.",
    noWeakTopics:
      "ಈಗಾಗಲೇ clear weak topics ಇಲ್ಲ. ಇದೇ level continue ಮಾಡಿ!",
    noWrongAnswers:
      "✅ ಈ testನಲ್ಲಿ ಯಾವ ತಪ್ಪುಗಳಿಲ್ಲ.\nಚೊಕ್ಕ ಕೆಲಸ!",
    noRightAnswers:
      "ಈ ಬಾರಿ ಸರಿಯಾದ ಉತ್ತರಗಳೇ ಬಂದಿಲ್ಲ. ಮುಂದಿನ ಬಾರಿ better ಆಗುತ್ತದೆ.",
    wrongRetakeStart:
      "ಹಿಂದಿನ testನಲ್ಲಿ ತಪ್ಪಾದ ಪ್ರಶ್ನೆಗಳು ಮಾತ್ರ ಮತ್ತೆ ಕೇಳ್ತಿವಿ.",
    wrongRetakePerfect:
      "Super! ಹಿಂದಿನ testನಲ್ಲಿ ಎಲ್ಲ correct. Wrong-only retake ಬೇಡ.",
    freeLimitReached:
      "⏳ ಇವತ್ತು free limit ಮುಗಿದೆ.\nನೀವು ಇವತ್ತು already ಒಂದು mini-test use ಮಾಡಿದ್ದೀರ.\n\n" +
      "Free plan:\n" +
      `• ಒಂದು mini-test (${MINI_TEST_SIZE} ಪ್ರಶ್ನೆಗಳು) ಪ್ರತಿದಿನ\n\n` +
      "ನಂತರ Mentor+ ಬಗ್ಗೆ ಯೋಚಿಸ್ತೀರಾ ಅಂದ್ರೆ ಬೇರೆ.",
  },
  ur: {
    langName: "اردو",
    startGreeting:
      "👋 *Namma KARTET English Mentor* میں خوش آمديد!",
    startSub:
      "پہلے menus اور messages کے ليے زبان منتخب کريں۔\nسوالات امتحان کی طرح English ميں ہی رہيں گے۔",
    chooseLanguage: "اپنی زبان منتخب کريں:",
    langEnglishButton: "🇬🇧 English (مفت)",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    welcomeMain:
      "خوش آمديد! آئيں English Language – II کے ليے روزانہ مشق، وضاحت اور topic-wise تجزيہ کے ساتھ تياری کريں۔",

    todaysPracticeButton: "🎯 آج کی مشق",
    myProgressButton: "📊 میری پیش رفت",
    myWeakAreasButton: "📌 میری کمزوریاں",
    moreOptionsButton: "📂 مزید اختيارات",


    mainMenuIntro: "اب آپ کيا کرنا چاہيں گے؟",
    dailyPracticeButton: "🧪 Daily Practice Test",
    fullMockButton: "📄 Full Mock Test (جلد آرہا ہے)",
    leaderboardButton: "🏆 Leaderboard",
    helpButton: "❓ Help",

    premiumLangPitch:
      "*Mentor+ (Premium) خصوصی سہولت*\n\n" +
      "Kannada / Urdu guidance Mentor+ کا حصہ ہے۔\n\n" +
      "Mentor+ ميں:\n" +
      "• بے حد ٹيسٹس اور mocks\n" +
      "• مکمل explanations اور teaching tips\n" +
      "• Topic-wise اور weak-topic analysis\n" +
      "• Multilingual guidance (Kannada/Urdu)\n\n" +
      "فيصلہ بعد ميں، فيل حال تياری پر توجہ ديں۔",
    upgradeButton: "⭐ Mentor+ Upgrade",
    continueEnglishButton: "➡️ English ميں جاری رکھيں",

    helpTitle: "❓ Help – Namma KARTET English Mentor",
    accountStatusTitle: "📊 آپ کا Account Status",
    planFree: "Free User",
    planPremium: "⭐ Premium (Mentor+)",

    // Settings / language
    settingsButton: "⚙️ Settings",
    changeLanguageButton: "🌐 Change Language",
    settingsTitle: "⚙️ Settings",
    changeLanguageTitle: "🌐 Change Language",
    changeLanguageSub: "Choose your preferred language for menus and messages.",


    testFinished: "✅ *Test مکمل ہوا!*",
    summaryHeading: "📊 *Summary*",
    scoreLabel: "Score",
    attemptedLabel: "Attempted",
    skippedLabel: "Skipped",
    wrongLabel: "Wrong",
    accuracyLabel: "Accuracy (on attempted)",
    topicPerfTitle: "📚 *Topic-wise performance*",
    weakTopicsTitle: "⚠️ *Weak topics*",
    rightAnswersTitle: "✅ *Right Answers*",
    wrongAnswersTitle: "❌ *Wrong Answers*",
    wrongPreviewTitle: "❌ *Wrong Answers (preview)*",
    noTopicsYet: "Topic-wise stats کے ليے data کم ہے۔",
    noWeakTopics:
      "ابھی کوئی واضح weak topics نہيں۔ اسی سطح کو برقرار رکھيں!",
    noWrongAnswers:
      "✅ اس test ميں کوئی غلط جواب نہيں۔ شاباش!",
    noRightAnswers:
      "اس بار مکمل صحيح جواب نہيں آئے۔ اگلی بار بہتر ہوگا۔",
    wrongRetakeStart:
      "آپ کے پچھلے غلط سوالات سے نيا test شروع ہو رہا ہے۔",
    wrongRetakePerfect:
      "Super! پچھلے test ميں سب صحيح تھے، wrong-only retest کی ضرورت نہيں۔",
    freeLimitReached:
      "⏳ آج کے ليے free limit ختم ہو چکی ہے۔\nآپ آج کا mini-test پہلے ہی دے چکے ہيں۔\n\n" +
      "Free plan:\n" +
      `• 1 mini-test (${MINI_TEST_SIZE} سوالات) روزانہ\n\n` +
      "بعد ميں Mentor+ پر غور کر سکتے ہيں۔",
  },
};

// ================== MULTILINGUAL MOTIVATION ==================

const motivation = {
  en: {
    perfect: [
      "Outstanding! You’re exam-ready. 🎯",
      "Flawless performance! Keep this level!",
      "Perfect score! Top-class work.",
    ],
    good: [
      "Nice work! You’re improving.",
      "Good attempt! Just a little more push.",
      "You’re on the right track!",
    ],
    low: [
      "No worries — learning starts here.",
      "Every mistake today helps tomorrow.",
      "Don’t be discouraged, keep going.",
    ],
  },
  kn: {
    perfect: [
      "ಅದ್ಭುತ! ನೀವೆ examಗೆ ಸಿದ್ಧ. 🎯",
      "ಚೆನ್ನಾಗಿ attempt ಮಾಡಿದ್ದೀರಿ, ಇದೇ level continue ಮಾಡಿ.",
      "Perfect score! Top-class ಕೆಲಸ.",
    ],
    good: [
      "ಚೆನ್ನಾಗಿದೆ! ನಿಮ್ಮ progress ಸ್ಪಷ್ಟ.",
      "ಒಳ್ಳೆಯ ಪ್ರಯತ್ನ. ಸ್ವಲ್ಪ ಹೆಚ್ಚು practice ಮಾಡಿದ್ರೆ ಇನ್ನೂ better.",
      "ಸರಿ ದಾರಿಯಲ್ಲಿದ್ದೀರ, ಮುಂದುವರಿಸಿ.",
    ],
    low: [
      "ಚಿಂತಿಸ್ಬೇಡಿ — ಇಲ್ಲಿಂದಲೇ learning ಶುರು.",
      "ಇವತ್ತು ಮಾಡಿದ ತಪ್ಪು ನಾಳೆ correct ಆಗುತ್ತೆ.",
      "ತಪ್ಪುಗಳು normal; practice ನಿಲ್ಲಿಸ್ಬೇಡಿ.",
    ],
  },
  ur: {
    perfect: [
      "کمال! آپ امتحان کے ليے تيار ہيں۔ 🎯",
      "بہترين کارکردگی! اسی رفتار سے جاری رکھيں۔",
      "پورا نمبر! زبردست محنت۔",
    ],
    good: [
      "اچھی کوشش! آپ کی progress صاف نظر آرہی ہے۔",
      "اچها! تھوڑی سی اور مشق سے بہت مضبوط ہو جائيں گے۔",
      "آپ صحيح راستے پر ہيں، بس جاری رکھيں۔",
    ],
    low: [
      "فکر نہ کريں — اصل سيکهنا يہيں سے شروع ہوتا ہے۔",
      "آج کی غلطياں کل کے امتحان ميں مدد کريں گی۔",
      "پيچهے مت ہٹيں، آہستہ ہی سہی مگر آگے بڑھ رہے ہيں۔",
    ],
  },
};

const userPrefs = {};
const DEFAULT_LANG = "en";

function getUiLang(userId) {
  if (!userPrefs[userId]) userPrefs[userId] = {};
  const prefs = userPrefs[userId];

  // Canonical field
  if (prefs.lang) return prefs.lang;

  // Backward compatibility (old uiLang)
  if (prefs.uiLang) return prefs.uiLang;

  return DEFAULT_LANG;
}

function setUiLang(userId, lang) {
  if (!userPrefs[userId]) userPrefs[userId] = {};
  userPrefs[userId].lang = lang;   // ✅ canonical
  userPrefs[userId].uiLang = lang; // ✅ backward-compatible
}


function t(userId, key) {
  const lang = getUiLang(userId);
  const pack = uiText[lang] || uiText.en;
  return pack[key] || uiText.en[key] || `[${key}]`;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function getMotivationLine(userId, score, total) {
  const lang = getUiLang(userId);
  const pack = motivation[lang] || motivation.en;
  const ratio = total > 0 ? score / total : 0;
  if (ratio === 1) return pickRandom(pack.perfect);
  if (ratio >= 0.5) return pickRandom(pack.good);
  return pickRandom(pack.low);
}

// ================== HELPERS ==================

function makeProgressBar(correct, total, length = 10) {
  if (total === 0) return "[----------]";
  const ratio = correct / Math.max(total, 1);
  const filled = Math.round(ratio * length);
  let bar = "[";
  for (let i = 0; i < length; i++) {
    bar += i < filled ? "█" : "░";
  }
  bar += "]";
  return bar;
}

function getDisplayName(user) {
  if (!user) return "User";
  if (user.username) return "@" + user.username;
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return `User_${user.id}`;
}

function getExplanationPreview(full) {
  if (!full || typeof full !== "string") return "";
  const trimmed = full.trim();
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex > 20 && dotIndex < 160) {
    return trimmed.slice(0, dotIndex + 1);
  }
  if (trimmed.length <= 120) return trimmed;
  return trimmed.slice(0, 120) + "...";
}

function getPrettyModeName(mode) {
  switch ((mode || "mixed").toLowerCase()) {
    case "rc":
      return "Reading Comprehension";
    case "grammar":
      return "Grammar & Structure";
    case "poetry":
      return "Poetry";
    case "pedagogy":
      return "Pedagogy";
    case "vocab":
      return "Vocabulary";
    case "mixed":
    default:
      return "Mixed (All Types)";
  }
}

// Filter questions based on chosen mode
function filterQuestionsByMode(allQuestions, mode) {
  if (!mode || mode === "mixed") return allQuestions;
  const lcMode = mode.toLowerCase();
  return allQuestions.filter((q) => {
    const cat = (q.categoryId || "").toLowerCase();
    const topic = (q.topicId || "").toLowerCase();
    if (lcMode === "rc") {
      const hasPassage =
        q.passage && typeof q.passage === "string" && q.passage.trim().length > 0;
      return (
        hasPassage ||
        cat.includes("reading") ||
        cat.includes("comprehension") ||
        topic.includes("rc")
      );
    }
    if (lcMode === "grammar") {
      return cat.includes("grammar") || topic.includes("grammar");
    }
    if (lcMode === "poetry") {
      return cat.includes("poetry") || cat.includes("poem") || topic.includes("poem");
    }
    if (lcMode === "pedagogy") {
      return cat.includes("pedagogy") || topic.includes("pedagogy");
    }
    if (lcMode === "vocab") {
      return cat.includes("vocab") || cat.includes("vocabulary") || topic.includes("vocab");
    }
    return true;
  });
}

// Main menu keyboard (labels will be localized on send)

function buildMainMenu(userId) {
  return {
    reply_markup: {
      keyboard: [
        [t(userId, "todaysPracticeButton"), t(userId, "myProgressButton")],
        [t(userId, "myWeakAreasButton"), t(userId, "moreOptionsButton")],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}
function buildTomorrowDirectionText(result, userId) {
  if (!result || !result.weakTopics || !result.weakTopics.length) {
    return null;
  }

  const lang = getUiLang(userId);
  const w = result.weakTopics[0];

  const topic = w.topicId || w.categoryId || "one topic";
  const levelText = w.level ? ` (Level ${w.level})` : "";

  if (lang === "kn") {
    return (
      "📅 *ನಾಳೆಯ ಗಮನ – Tomorrow’s Focus*\n\n" +
      `ಇದ್ದೀಗ ನೀವು ಹೆಚ್ಚು ಅಂಕ ಕಳೆದುಕೊಳ್ಳುತ್ತಿರುವ ವಿಷಯ: *${topic}*${levelText}.\n` +
      "ನಾಳೆಯ ಅಭ್ಯಾಸದಲ್ಲಿ ಈ ಭಾಗವನ್ನು ಸ್ವಲ್ಪ ಹೆಚ್ಚು ಗುರಿಯಾಗಿಸಿ ನೋಡಿ.\n\n" +
      "ನಿಮ್ಮ ತಪ್ಪುಗಳು ನಿಮ್ಮ ವಿರುದ್ಧಲ್ಲ — ಅವೇ ನಿಮ್ಮ ಮುಂದಿನ ದಿಕ್ಕು."
    );
  } else if (lang === "ur") {
    return (
      "📅 *کل کا فوکس – Tomorrow’s Focus*\n\n" +
      `فی الحال آپ جس موضوع میں زیادہ نمبر کھو رہے ہیں: *${topic}*${levelText}.\n` +
      "کل کی مشق میں اسی حصے پر تھوڑا زیادہ فوکس کریں۔\n\n" +
      "غلطیاں آپ کے خلاف ثبوت نہیں، آپ کی رہنمائی ہیں۔"
    );
  }

  // default EN
  return (
    "📅 *Tomorrow’s Focus*\n\n" +
    `Right now, you’re losing marks most often in: *${topic}*${levelText}.\n` +
    "In tomorrow’s practice, give this area a little extra attention.\n\n" +
    "Your mistakes aren’t evidence against you — they’re a roadmap for what to fix next."
  );
}

// ================== MORE OPTIONS MENU ==================
function showMoreOptions(chatId, userId) {
  const text =
    "📂 More Options:\n\n" +
    "• Daily Practice Test\n" +
    "• Full Mock Test (coming later)\n" +
    "• Leaderboard\n" +
    "• Help\n" +
    "• Settings";

  bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: t(userId, "dailyPracticeButton"), callback_data: "opt_daily_practice" },
        ],
        [
          { text: t(userId, "fullMockButton"), callback_data: "opt_full_mock" },
        ],
        [
          { text: t(userId, "leaderboardButton"), callback_data: "opt_leaderboard" },
        ],
        [
          { text: t(userId, "helpButton"), callback_data: "opt_help" },
        ],
        [
          { text: t(userId, "settingsButton"), callback_data: "opt_settings" },
        ],
      ],
    },
    parse_mode: "Markdown",
  });
}
function buildLanguageInlineKeyboard() {
  const pack = uiText.en; // language names stay consistent
  return {
    inline_keyboard: [
      [{ text: pack.langEnglishButton, callback_data: "set_lang_en" }],
      [{ text: pack.langKannadaButton, callback_data: "set_lang_kn" }],
      [{ text: pack.langUrduButton, callback_data: "set_lang_ur" }],
    ],
  };
}



// ================== TEST FLOW ==================

function startTest(chatId, user, questionsPoolOverride, isFreeMini = false) {
  const pool = questionsPoolOverride || questions;
  sessions[chatId] = {
    currentIndex: 0,
    score: 0,
    answers: [],
    user: {
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
    },
    isWrongRetake: false,
    isFreeMini,
    questionsPool: pool,
  };
  sendQuestion(chatId);
}

function startWrongRetake(chatId, user) {
  const prevResult = lastResults[chatId];
  if (!prevResult || !prevResult.answers || prevResult.answers.length === 0) {
    bot.sendMessage(
      chatId,
      "No recent test data found.\nPlease take a test first. 🙂",
      buildMainMenu(user.id)
    );
    return;
  }
  const basePool = prevResult.questionsPool || questions;
  const wrongAnswers = prevResult.answers.filter((a) => !a.correct);
  const uniqueIndices = Array.from(new Set(wrongAnswers.map((a) => a.qIndex)));
  const wrongPool = uniqueIndices
    .map((idx) => basePool[idx])
    .filter((q) => Boolean(q));

  if (!wrongPool.length) {
    bot.sendMessage(chatId, t(user.id, "wrongRetakePerfect"), buildMainMenu(user.id));
    return;
  }

  sessions[chatId] = {
    currentIndex: 0,
    score: 0,
    answers: [],
    user: {
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
    },
    isWrongRetake: true,
    isFreeMini: false,
    questionsPool: wrongPool,
  };
  bot.sendMessage(chatId, t(user.id, "wrongRetakeStart"));
  sendQuestion(chatId);
}

// Ask user which type of English they want
function askEnglishMode(chatId, user) {
  const name = getDisplayName(user);
  const userId = user.id;
  const text =
    `Hi ${name}! 👋\n` +
    "You chose *English Language – II*.\n" +
    "Let’s personalise your practice.\n\n" +
    "What would you like to practise today?";
  const inlineKeyboard = [
    [{ text: "📖 Reading Comprehension", callback_data: "eng2_mode_rc" }],
    [{ text: "✏️ Grammar & Structure", callback_data: "eng2_mode_grammar" }],
    [{ text: "📝 Poetry", callback_data: "eng2_mode_poetry" }],
    [{ text: "👩‍🏫 Pedagogy", callback_data: "eng2_mode_pedagogy" }],
    [{ text: "🔤 Vocabulary", callback_data: "eng2_mode_vocab" }],
    [{ text: "🔀 Mixed (All Types)", callback_data: "eng2_mode_mixed" }],
  ];
  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

// Start daily practice (uses mode + free vs premium logic + LAYER 2)
// Start daily practice (uses mode + free vs premium logic + LAYER 2)
function startDailyPracticeTest(chatId, user) {
  const userId = user.id;

  // ✅ use userId for preferences, not chatId
  const prefs = userPrefs[userId] || {};
  const mode = prefs.eng2Mode || "mixed";

  // 1️⃣ Mode filter stays exactly as before
  const filteredPool = filterQuestionsByMode(questions, mode);
  const effectivePool = filteredPool.length ? filteredPool : questions;

  // 2️⃣ PREMIUM USERS → full mode pool, but shuffled + difficulty ramp
  if (isPremiumUser(userId)) {
    const premiumPool = applyDifficultyRamp(shuffleArray(effectivePool));
    startTest(chatId, user, premiumPool, false);
    return;
  }

  // 3️⃣ FREE USERS → same free limit logic as before
  const today = new Date().toISOString().slice(0, 10);

  if (!userStats[userId]) {
    userStats[userId] = {
      id: userId,
      name: getDisplayName(user),

      // Existing fields (keep)
      attempts: 0,
      bestScore: 0,
      lastScore: 0,
      lastFreeDate: null,
      freeTestsToday: 0,

      // ✅ NEW FIELDS (for My Progress)
      totalQuestionsAttempted: 0,
      totalCorrect: 0,
      currentStreak: 0,
      lastTestDate: null,
    };

    // ✅ RESTORE STREAK FROM botdb.json IF BOT RESTARTED
    const persisted = persistent.streaks[userId];
    if (persisted) {
      userStats[userId].currentStreak = persisted.currentStreak || 0;
      userStats[userId].lastTestDate = persisted.lastTestDate || null;
    }
  }

  const stats = userStats[userId];

  // DAILY FREE LIMIT RESET (unchanged)
  if (stats.lastFreeDate !== today) {
    stats.lastFreeDate = today;
    stats.freeTestsToday = 0;
  }

  // FREE DAILY LIMIT CHECK (unchanged)
  if (stats.freeTestsToday >= FREE_DAILY_MINI_TESTS) {
    bot.sendMessage(chatId, t(userId, "freeLimitReached"), {
      parse_mode: "Markdown",
      ...buildMainMenu(userId),
    });
    return;
  }

  stats.freeTestsToday += 1;

  const pretty = getPrettyModeName(mode);

  // 4️⃣ LAYER 2 MAGIC:
  //    - 2 old wrong (if any) from this mode
  //    - 3 new questions
  //    - Easy → Moderate → Tough
  const dailyPool = buildPracticePool(userId, effectivePool, MINI_TEST_SIZE);

  bot.sendMessage(
    chatId,
    `🧪 Starting today’s *free* ${MINI_TEST_SIZE}-question practice test\nin *${pretty}*...`,
    { parse_mode: "Markdown" }
  );

  startTest(chatId, user, dailyPool, true);
}


function sendQuestion(chatId) {
  const session = sessions[chatId];
  if (!session) return;
  const pool = session.questionsPool || questions;
  const qIndex = session.currentIndex;
  if (qIndex >= pool.length) {
    sendResult(chatId);
    return;
  }
  const q = pool[qIndex];
  const total = pool.length;

  let text = `Q${qIndex + 1}/${total}\n\n`;
  if (q.passage && typeof q.passage === "string" && q.passage.trim().length > 0) {
    text += `📜 *Passage / Poem:*\n${q.passage}\n\n`;
  }
  text += `❓ ${q.question}\n\n`;
  (q.options || []).forEach((opt, i) => {
    text += `${letters[i]}) ${opt}\n`;
  });
  text += `\nChoose one option:`;

  const inlineKeyboard = [
    [
      { text: "a", callback_data: `${qIndex}:0` },
      { text: "b", callback_data: `${qIndex}:1` },
      { text: "c", callback_data: `${qIndex}:2` },
      { text: "d", callback_data: `${qIndex}:3` },
    ],
    [
      { text: "⏭️ Skip", callback_data: `skip:${qIndex}` },
      { text: "🏁 Finish test", callback_data: `finish_now:${qIndex}` },
    ],
  ];

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

// ================== TOPIC ANALYTICS ==================

function calculateTopicStats(result) {
  const topicStats = {};
  result.answers.forEach((a) => {
    if (!a.subjectId || !a.categoryId || !a.topicId) return; // skip invalid

    const key = `${a.subjectId}|${a.categoryId}|${a.topicId}`;

    if (!topicStats[key]) {
      topicStats[key] = {
        subjectId,
        categoryId,
        topicId,
        attempted: 0,
        correct: 0,
      };
    }
    topicStats[key].attempted++;
    if (a.correct) topicStats[key].correct++;
  });
  return topicStats;
}
function findStrongestTopic(topicStats, minAttempt = 2) {
  let best = null;
  Object.values(topicStats || {}).forEach((stat) => {
    if (!stat.attempted || stat.attempted < minAttempt) return;
    const accuracy = (stat.correct / stat.attempted) * 100;
    if (!best || accuracy > best.accuracy) {
      best = { ...stat, accuracy: Math.round(accuracy) };
    }
  });
  return best;
}

function formatTopicLabel(stat) {
  if (!stat) return null;
  const { subjectId, categoryId, topicId, accuracy, attempted, correct } = stat;
  const accText =
    accuracy != null ? ` (${accuracy}% – ${correct}/${attempted})` : "";
  return `*${subjectId}* → _${categoryId}_ → ${topicId}${accText}`;
}

function getWeakTopics(topicStats, threshold = 60, minAttempt = 2) {
  const weak = [];
  Object.values(topicStats).forEach((stat) => {
    if (stat.attempted < minAttempt) return;
    const accuracy = (stat.correct / stat.attempted) * 100;
    if (accuracy < threshold) {
      weak.push({
        ...stat,
        accuracy: Math.round(accuracy),
      });
    }
  });
  weak.sort((a, b) => a.accuracy - b.accuracy);
  return weak;
}

// ================== SUMMARY & REVIEW TEXT ==================

function formatSummaryMessage(result, userId, isPrem) {
  const pool = result.questionsPool || questions;
  const totalQuestions = pool.length;
  const attempted = result.answers.length;
  const correct = result.answers.filter((a) => a.correct).length;
  const wrong = attempted - correct;
  const skipped = totalQuestions - attempted;
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  const bar = makeProgressBar(correct, attempted, 10);

  let msg = "";
  msg += `${t(userId, "testFinished")}\n\n`;
  msg += `${t(userId, "summaryHeading")}\n\n`;
  msg += `🎯 ${t(userId, "scoreLabel")}: ${correct}/${attempted}\n`;
  msg += `📝 ${t(userId, "attemptedLabel")}: ${attempted}/${totalQuestions}\n`;
  msg += `⏭️ ${t(userId, "skippedLabel")}: ${skipped}\n`;
  msg += `❌ ${t(userId, "wrongLabel")}: ${wrong}\n`;
  msg += `📈 ${t(userId, "accuracyLabel")}: ${accuracy}%\n\n`;
  msg += `Progress: ${bar}\n`;

  if (accuracy === 100 && attempted > 0) {
    msg += "\n🏆 Amazing performance! You’ve mastered this area.";
  } else if (accuracy >= 80) {
    msg += "\n✨ Very good! Just polish the few areas you slipped on.";
  } else if (accuracy >= 40) {
    msg += "\n📚 Good attempt! Focus on the wrong answers and revise those topics.";
  } else if (accuracy > 0 && accuracy < 40) {
    msg += "\n🔁 Revision needed. Slow down a bit, revise basics, then retry.";
  } else if (accuracy === 0 && attempted > 0) {
    msg += "\n🌱 New beginning. Review the basics and come back fresh.";
  } else {
    msg += "\n💡 Tip: Try to answer at least one question next time!";
  }

  const motiv = getMotivationLine(userId, correct, totalQuestions);
  msg += `\n\n${motiv}`;

  if (!isPrem) {
    msg +=
      "\n\nℹ️ Detailed topic-wise breakdown and wrong-only retakes will be part of Mentor+ later.";
  }

  return msg;
}

function formatRightAnswersMessage(result, userId) {
  const pool = result.questionsPool || questions;
  const rightAnswers = result.answers.filter((a) => a.correct);
  if (!rightAnswers.length) {
    return t(userId, "noRightAnswers");
  }
  let text = `${t(userId, "rightAnswersTitle")}\n\n`;
  rightAnswers.forEach((ans, idx) => {
    const q = pool[ans.qIndex];
    if (!q) return;
    const correctOption = q.options[q.correctIndex];
    const correctLetter = letters[q.correctIndex];
    text += `Q${idx + 1}) ${q.question}\n`;
    text += `✅ *Correct:* ${correctLetter}) ${correctOption}\n`;
    if (q.explanation) {
      text += "ℹ️ *Explanation:*\n";
      text += `• ${q.explanation}\n`;
    }
    text += "\n";
  });
  text += "You can now check wrong answers, topic-wise performance, or retake wrong-only questions.";
  return text;
}

function formatWrongAnswersMessage(result, userId) {
  const pool = result.questionsPool || questions;
  const wrongAnswers = result.answers.filter((a) => !a.correct);
  if (!wrongAnswers.length) {
    return t(userId, "noWrongAnswers");
  }
  let text = `${t(userId, "wrongAnswersTitle")}\n\n`;
  wrongAnswers.forEach((ans, idx) => {
    const q = pool[ans.qIndex];
    if (!q) return;
    const correctOption = q.options[q.correctIndex];
    const correctLetter = letters[q.correctIndex];
    const chosenOption =
      ans.chosen != null ? q.options[ans.chosen] : "No option selected";
    const chosenLetter = ans.chosen != null ? letters[ans.chosen] : "-";
    text += `Q${idx + 1}) ${q.question}\n`;
    text += `🧍 *Your answer:* ${chosenLetter}) ${chosenOption}\n`;
    text += `✅ *Correct:* ${correctLetter}) ${correctOption}\n`;
    if (q.explanation) {
      text += "ℹ️ *Explanation:*\n";
      text += `• ${q.explanation}\n`;
    }
    if (q.tip) {
      text += "👩‍🏫 *Teaching tip:*\n";
      text += `• ${q.tip}\n`;
    }
    text += "\n";
  });
  text += "Try a wrong-only retake to fix these topics faster. 🔁";
  return text;
}

function formatWrongAnswersPreviewMessage(result, userId) {
  const pool = result.questionsPool || questions;
  const wrongAnswers = result.answers.filter((a) => !a.correct);
  if (!wrongAnswers.length) {
    return `${t(userId, "noWrongAnswers")}\n\nFull explanations & teaching tips will be part of Mentor+ later.`;
  }
  let text = `${t(userId, "wrongPreviewTitle")}\n\n`;
  wrongAnswers.forEach((ans, idx) => {
    const q = pool[ans.qIndex];
    if (!q) return;
    const correctOption = q.options[q.correctIndex];
    const correctLetter = letters[q.correctIndex];
    const chosenOption =
      ans.chosen != null ? q.options[ans.chosen] : "No option selected";
    const chosenLetter = ans.chosen != null ? letters[ans.chosen] : "-";
    text += `Q${idx + 1}) ${q.question}\n`;
    text += `🧍 *Your answer:* ${chosenLetter}) ${chosenOption}\n`;
    text += `✅ *Correct:* ${correctLetter}) ${correctOption}\n`;
    if (q.explanation) {
      const preview = getExplanationPreview(q.explanation);
      text += "ℹ️ *Explanation (preview):*\n";
      text += `• ${preview}\n`;
      text += "Full explanation + teaching tips will be part of Mentor+ later.\n";
    } else {
      text += "ℹ️ *Explanation:* (not added yet)\n";
    }
    text += "\n";
  });
  text +=
    "Use this to see where you slipped, and then revise those areas. Steady progress style. 🙂";
  return text;
}

function formatTopicStatsMessage(result, userId) {
  const topicStats = result.topicStats || calculateTopicStats(result);
  const entries = Object.values(topicStats);
  if (!entries.length) {
    return `${t(userId, "topicPerfTitle")}\n\n${t(userId, "noTopicsYet")}`;
  }
  let text = `${t(userId, "topicPerfTitle")}\n\n`;
  entries.forEach((stat) => {
    const { subjectId, categoryId, topicId, attempted, correct } = stat;
    const accuracy = Math.round((correct / attempted) * 100);
    text += `• *${subjectId}* → _${categoryId}_ → ${topicId}\n`;
    text += `   ✅ ${correct}/${attempted} correct (${accuracy}%)\n\n`;
  });
  text += "Use this to decide which topics need more practice.";
  return text;
}

function formatWeakTopicsMessage(result, userId) {
  const topicStats = result.topicStats || calculateTopicStats(result);
  const weakTopics = result.weakTopics || getWeakTopics(topicStats, 60, 2);
  if (!weakTopics.length) {
    return `${t(userId, "weakTopicsTitle")}\n\n${t(userId, "noWeakTopics")}`;
  }
  let text = `${t(userId, "weakTopicsTitle")}\n\n`;
  weakTopics.forEach((w) => {
    text += `• *${w.subjectId}* → _${w.categoryId}_ → ${w.topicId}\n`;
    text += `   ✅ ${w.correct}/${w.attempted} correct (${w.accuracy}%)\n\n`;
  });
  text += "First revise these, then move to strong areas.";
  return text;
}

function buildReviewKeyboard(isPremium, hasWrong) {
  if (isPremium) {
    const inlineKeyboard = [
      [
        { text: "✅ Right answers", callback_data: "view_right" },
        { text: "❌ Wrong answers", callback_data: "view_wrong" },
      ],
      [
        { text: "📚 Topic-wise", callback_data: "view_topics" },
        { text: "⚠️ Weak topics", callback_data: "view_weak_topics" },
      ],
    ];
    if (hasWrong) {
      inlineKeyboard.push([
        {
          text: "🔁 Retake wrong-only",
          callback_data: "retake_wrong",
        },
      ]);
    }
    inlineKeyboard.push([
      { text: "🏠 Main Menu", callback_data: "done_results" },
    ]);
    return { inline_keyboard: inlineKeyboard };
  }

  const inlineKeyboard = [
    [
      { text: "❌ Wrong answers (preview)", callback_data: "view_wrong" },
      { text: "⭐ Mentor+ info", callback_data: "upgrade_mentor" },
    ],
    [{ text: "🏠 Main Menu", callback_data: "done_results" }],
  ];
  return { inline_keyboard: inlineKeyboard };
}

// ================== RESULT & LEADERBOARD ==================

function sendResult(chatId) {
  const session = sessions[chatId];
  if (!session) return;
  const pool = session.questionsPool || questions;
  const total = pool.length;
  const score = session.score;
  const user = session.user;
  const userId = user.id;
  const name = getDisplayName(user);
  const isPrem = isPremiumUser(userId);
  let streakNote = "";


  if (!session.isWrongRetake) {
    if (!userStats[userId]) {
      userStats[userId] = {
        id: userId,
        name,
        attempts: 0,
        bestScore: 0,
        lastScore: 0,
        lastFreeDate: null,
        freeTestsToday: 0,
        // NEW fields for My Progress
        totalQuestionsAttempted: 0,
        totalCorrect: 0,
        currentStreak: 0,
        lastTestDate: null,
      };
    }
    const stats = userStats[userId];
    stats.name = name;

    // 🔢 Attempts / scores
    stats.attempts += 1;
    stats.lastScore = score;
    if (score > stats.bestScore) {
      stats.bestScore = score;
    }

    // ✅ Accuracy totals for My Progress
    const attemptedQ = session.answers.length; // how many Q in this test
    const correctQ = score;                    // session.score = correct answers

    stats.totalQuestionsAttempted =
      (stats.totalQuestionsAttempted || 0) + attemptedQ;
    stats.totalCorrect = (stats.totalCorrect || 0) + correctQ;

    // 🔁 Streak (based on calendar days)
    const today = new Date().toISOString().slice(0, 10);

    if (!stats.lastTestDate) {
      // first ever test
      stats.currentStreak = 1;
    } else if (stats.lastTestDate === today) {
      // already played today → keep streak as is
    } else {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      if (stats.lastTestDate === yesterday) {
        stats.currentStreak = (stats.currentStreak || 0) + 1;
      } else {
        stats.currentStreak = 1;
      }
    }

    // ✅ update in-memory lastTestDate
    stats.lastTestDate = today;

    // ✅ NOW persist UPDATED streak info to botdb.json
    if (!persistent.streaks) persistent.streaks = {};
    if (!persistent.streaks[userId]) {
      persistent.streaks[userId] = {};
    }
    persistent.streaks[userId].currentStreak = stats.currentStreak;
    persistent.streaks[userId].lastTestDate = stats.lastTestDate;
    savePersistentDb();

    // ✅ Milestone note (uses updated currentStreak)
    const s = stats.currentStreak || 0;
    if (s === 3) {
      streakNote =
        "💪 3-day streak — nice momentum. Keep showing up like this.";
    } else if (s === 7) {
      streakNote =
        "✨ 7 days in a row — real discipline is forming. Most people never reach this.";
    } else if (s === 14) {
      streakNote =
        "🏆 14-day streak — this is top 10% behaviour. You’re building exam stamina now.";
    }


  const baseResult = {
    answers: session.answers,
    questionsPool: pool,
  };
  // ✅ Save wrong questions for future revision (LAYER 2)
  if (!session.isWrongRetake) {
    const user = session.user;
    const userId = user.id;

    const wrongIds = session.answers
      .filter((a) => !a.correct)
      .map((a) => {
        const q = pool[a.qIndex];
        return q?.id;               // ✅ optional chaining
      })
      .filter((id) => id != null);   // ✅ remove null/undefined

    if (!wrongBank[userId]) wrongBank[userId] = new Set();

    if (wrongIds.length > 0) {       // ✅ only save if there are wrong questions
      wrongIds.forEach((id) => wrongBank[userId].add(id));

      // ✅ Persist wrongBank for this user to botdb.json
      persistent.wrongBank[userId] = Array.from(wrongBank[userId]);
      savePersistentDb();
    }

    const topicStats = calculateTopicStats(baseResult);
    const weakTopics = getWeakTopics(topicStats, 60, 2);


  // ✅ Always store the *latest* test (main or retake) for summary etc.
  lastResults[chatId] = {
    ...baseResult,
    topicStats,
    weakTopics,
  };

  // ✅ Only store *main tests* (non-retake) in mainResults
  if (!session.isWrongRetake) {
    mainResults[chatId] = {
      ...baseResult,
      topicStats,
      weakTopics,
    };
  }

  let summaryText = formatSummaryMessage(lastResults[chatId], userId, isPrem);

  if (streakNote) {
    summaryText += `\n\n${streakNote}`;
  }


  const hasWrong =
    lastResults[chatId] && Array.isArray(lastResults[chatId].answers)
      ? lastResults[chatId].answers.some((a) => !a.correct)
      : false;

  const reviewKeyboard = buildReviewKeyboard(isPrem, hasWrong);

  bot
    .sendMessage(chatId, summaryText, {
      parse_mode: "Markdown",
      reply_markup: reviewKeyboard,
    })
    .then(() => {
      // ✅ Pick MAIN test if available, else fall back to lastResult
      const resultForDirection =
        mainResults[chatId] && mainResults[chatId].weakTopics
          ? mainResults[chatId]
          : lastResults[chatId];

      const directionText = buildTomorrowDirectionText(resultForDirection, userId);
      if (directionText) {
        bot.sendMessage(chatId, directionText, {
          parse_mode: "Markdown",
          ...buildMainMenu(userId),
        });
        } else {
          bot.sendMessage(
            chatId,
            "Ready for tomorrow's practice! 💪",
            {
              parse_mode: "Markdown",
              ...buildMainMenu(userId),
            }
          );
        }

    })
    .catch((err) => {
      console.error("Error sending result summary:", err);
      bot.sendMessage(chatId, `Test finished!\nScore: ${score}/${total}`, {
        parse_mode: "Markdown",
        ...buildMainMenu(userId),
      });
    });

  delete sessions[chatId];
}


function sendLeaderboard(chatId, userId) {
  const list = Object.values(userStats);
  if (!list.length) {
    bot.sendMessage(
      chatId,
      "🏆 Leaderboard\n\nNo tests attempted yet.\nYou start first, nimage advantage. 😄\nTap *Daily Practice Test* to begin.",
      { parse_mode: "Markdown", ...buildMainMenu(userId) }
    );
    return;
  }
  const sorted = [...list].sort((a, b) => {
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    return b.attempts - a.attempts;
  });
  const top = sorted.slice(0, 10);
  let text = "🏆 *Leaderboard – Top performers*\n\n";
  top.forEach((u, i) => {
    const badge = isPremiumUser(u.id) ? "⭐ " : "";
    text += `${i + 1}. ${badge}${u.name} — Best: ${u.bestScore || 0}/${
      questions.length
    }, Attempts: ${u.attempts}\n`;
  });
  bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...buildMainMenu(userId) });
}
function sendMyProgress(chatId, userId) {
  const stats = userStats[userId];
  const lang = getUiLang(userId);

  if (!stats || !stats.attempts) {
    // same "brand new" text you already had
    let msg;
    if (lang === "kn") {
      msg =
        "📊 *ನಿಮ್ಮ ಕಲಿಕೆಯ ಪ್ರಗತಿ*\n\n" +
        "ಇನ್ನೂ ಯಾವುದೇ ಅಭ್ಯಾಸ ಪರೀಕ್ಷೆಯ data ಇಲ್ಲ.\n" +
        "ಮೊದಲು *🎯 ಇಂದಿನ ಅಭ್ಯಾಸ* ಬಳಸಿ ಒಮ್ಮೆ ಪರೀಕ್ಷೆ ಮಾಡಿ.\n\n" +
        "ಪ್ರತಿ ಪ್ರಯತ್ನದಿಂದ ನಾನು ನಿಮ್ಮ ದುರ್ಬಲ ಹಾಗೂ ಬಲವಾದ ವಿಷಯಗಳ ನಕ್ಷೆ ಸಿದ್ಧಪಡಿಸುವೆ.";
    } else if (lang === "ur") {
      msg =
        "📊 *آپ کی پیش رفت*\n\n" +
        "ابھی تک کوئی پریکٹس ٹیسٹ ڈیٹا موجود نہیں ہے۔\n" +
        "پہلے *🎯 آج کی مشق* کے ساتھ کم از کم ایک ٹیسٹ دیں۔\n\n" +
        "ہر کوشش کے بعد میں آپ کی مضبوط اور کمزور جگہوں کا نقشہ بناؤں گا۔";
    } else {
      msg =
        "📊 *Your Progress*\n\n" +
        "You don’t have any practice test data yet.\n" +
        "Start with *🎯 Today’s Practice* to unlock your progress stats.\n\n" +
        "After each test, I’ll map your strongest and weakest areas for smarter revision.";
    }

    bot.sendMessage(chatId, msg, {
      parse_mode: "Markdown",
      ...buildMainMenu(userId),
    });
    return;
  }

  const attempts = stats.attempts || 0;
  const best = stats.bestScore || 0;
  const last = stats.lastScore || 0;
  const totalQ = stats.totalQuestionsAttempted || 0;
  const totalCorrect = stats.totalCorrect || 0;
  const streak = stats.currentStreak || 0;
  const avgAccuracy =
    totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;

  // Topic info based on latest MAIN test (same logic as Weak Areas)
  const baseResult =
    mainResults[chatId] && mainResults[chatId].answers?.length
      ? mainResults[chatId]
      : lastResults[chatId];

  let strongestLabel = null;
  let weakestLabel = null;

  if (baseResult && baseResult.topicStats) {
    const topicStats = baseResult.topicStats;
    const strong = findStrongestTopic(topicStats, 2); // helper we discussed
    const weakList =
      baseResult.weakTopics && baseResult.weakTopics.length
        ? baseResult.weakTopics
        : getWeakTopics(topicStats, 60, 2);
    const weakest = weakList && weakList.length ? weakList[0] : null;

    strongestLabel = formatTopicLabel(strong);
    weakestLabel = formatTopicLabel(weakest);
  }

  const noTopicDataEN = "Not enough topic data yet.";
  const noTopicDataKN = "ವಿಷಯ ಮಟ್ಟದ data ಇನ್ನೂ ಸಾಕಾಗಿಲ್ಲ.";
  const noTopicDataUR = "ابھی موضوع کی سطح کا ڈیٹا کافی نہیں ہے۔";

  let msg;

  if (lang === "kn") {
    msg =
      "📊 *ನಿಮ್ಮ ಕಲಿಕೆಯ ಪ್ರಗತಿ – ಸಂಕ್ಷಿಪ್ತ ಚಿತ್ರ*\n\n" +
      `➤ ಒಟ್ಟು ಪರೀಕ್ಷೆಗಳು: *${attempts}*\n` +
      `➤ ಸರಾಸರಿ ಶುದ್ಧತೆ: *${avgAccuracy}%*\n` +
      `➤ ಒಂದೇ ಪರೀಕ್ಷೆಯಲ್ಲಿ ಹೆಚ್ಚು ಸರಿಯಾದ ಉತ್ತರಗಳು (Best score): *${best}*\n` +
      `➤ ನಿರಂತರ ದಿನಗಳ ಅಭ್ಯಾಸ (Streak): *${streak}* ದಿನ(ಗಳು)\n\n` +
      "🧠 *ವಿಷಯಾಧಾರಿತ ಚಿತ್ರ (ಇತ್ತೀಚಿನ ಮುಖ್ಯ ಪರೀಕ್ಷೆಯ ಆಧಾರ)*\n" +
      `• ಬಲವಾದ ವಿಷಯ: ${
        strongestLabel || noTopicDataKN
      }\n` +
      `• ದುರ್ಬಲ ವಿಷಯ: ${
        weakestLabel || noTopicDataKN
      }\n\n` +
      "ಸಣ್ಣ, ನಿರಂತರ ಪ್ರಯತ್ನಗಳು ದೊಡ್ಡ ಫಲಿತಾಂಶಗಳನ್ನು ತರುತ್ತವೆ.\n" +
      "ಇಂದೇ *🎯 ಇಂದಿನ ಅಭ್ಯಾಸ* ಮಾಡಿ ಮತ್ತು ಈ ಸಂಖ್ಯೆಗಳನ್ನ ಮೃದುವಾಗಿ ಮೇಲಕ್ಕೆ ಎಳೆಯಿರಿ.";
  } else if (lang === "ur") {
    msg =
      "📊 *آپ کی پیش رفت – خلاصہ*\n\n" +
      `➤ کل ٹیسٹ: *${attempts}*\n` +
      `➤ اوسط درستگی (Accuracy): *${avgAccuracy}%*\n` +
      `➤ ایک ٹیسٹ میں سب سے زیادہ درست جوابات (Best score): *${best}*\n` +
      `➤ مسلسل دنوں کی مشق (Streak): *${streak}* دن\n\n` +
      "🧠 *موضوع کی بنیاد پر تصویر (حالیہ مین ٹیسٹ کے مطابق)*\n" +
      `• مضبوط ترین موضوع: ${
        strongestLabel || noTopicDataUR
      }\n` +
      `• سب سے کمزور موضوع: ${
        weakestLabel || noTopicDataUR
      }\n\n` +
      "چھوٹی مگر مسلسل کوششیں ہی بڑے نتیجے بناتی ہیں۔\n" +
      "آج *🎯 آج کی مشق* سے ان اعداد و شمار کو آہستہ آہستہ اوپر لے جائیں۔";
  } else {
    msg =
      "📊 *Your Progress – Snapshot*\n\n" +
      `➤ Total tests attempted: *${attempts}*\n` +
      `➤ Average accuracy: *${avgAccuracy}%*\n` +
      `➤ Best score in a single test: *${best}* correct\n` +
      `➤ Current practice streak: *${streak}* day(s)\n\n` +
      "🧠 *Topic picture (based on your latest main test)*\n" +
      `• Strongest topic: ${
        strongestLabel || noTopicDataEN
      }\n` +
      `• Weakest topic: ${
        weakestLabel || noTopicDataEN
      }\n\n` +
      "Small, consistent sessions beat random heavy study.\n" +
      "Use *🎯 Today’s Practice* to keep this graph moving upward.";
  }

  bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    ...buildMainMenu(userId),
  });
}

function sendMyWeakAreas(chatId, userId) {
  const lang = getUiLang(userId);

  // Prefer latest MAIN test; if none exists yet, fallback to latest test
  const last =
    mainResults[chatId] && mainResults[chatId].answers?.length
      ? mainResults[chatId]
      : lastResults[chatId];

  // CASE 1: No recent test data at all
  if (!last || !last.answers || last.answers.length === 0) {
    let msg;
    if (lang === "kn") {
      msg =
        "📌 *ನನ್ನ ದುರ್ಬಲ ಭಾಗಗಳು*\n\n" +
        "ಇನ್ನೂ ಇತ್ತೀಚಿನ ಯಾವುದೇ ಪರೀಕ್ಷಾ data ಇಲ್ಲ, ಅದರಿಂದ ದುರ್ಬಲ ಭಾಗಗಳನ್ನು ನಕ್ಷೆ ಮಾಡಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ.\n\n" +
        "ಮೊದಲು ಕನಿಷ್ಠ ಒಂದು ಅಭ್ಯಾಸ ಪರೀಕ್ಷೆ ಮಾಡಿ – *🎯 ಇಂದಿನ ಅಭ್ಯಾಸ* ಬಳಸಿ.\n\n" +
        "ಪ್ರತಿ ಪರೀಕ್ಷೆಯ ನಂತರ  ನೀವು ಹೆಚ್ಚು ತಪ್ಪು ಮಾಡುತ್ತಿರುವ ವಿಷಯಗಳನ್ನು ನಾನು ತೋರಿಸುತ್ತೇನೆ,\n" +
        "ಹೀಗಾಗಿ ನಿಮ್ಮ ಪುನರವಲೋಕನ ಹೆಚ್ಚು ಗುರಿ ಸ್ಪಷ್ಟವಾಗುತ್ತದೆ.";
    } else if (lang === "ur") {
      msg =
        "📌 *میری کمزوریاں*\n\n" +
        "ابھی تک حالیہ ٹیسٹ کا ڈیٹا موجود نہیں، اس لیے کمزور حصوں کا نقشہ واضح نہیں ہے۔\n\n" +
        "پہلے کم از کم ایک پریکٹس ٹیسٹ دیں — *🎯 آج کی مشق* استعمال کریں۔\n\n" +
        "ہر ٹیسٹ کے بعد میں آپ کو وہ موضوعات دکھاؤں گا جہاں آپ زیادہ نمبر کھو رہے ہیں،\n" +
        "تاکہ آپ کی دہرائی زیادہ فوکسڈ ہو سکے۔";
    } else {
      msg =
        "📌 *My Weak Areas*\n\n" +
        "You don’t have enough recent test data yet for me to map your weak areas.\n\n" +
        "First, take at least one practice test using *🎯 Today’s Practice*.\n\n" +
        "After each test, I’ll highlight the topics where you’re losing marks most often,\n" +
        "so your revision becomes laser-focused.";
    }

    bot.sendMessage(chatId, msg, {
      parse_mode: "Markdown",
      ...buildMainMenu(userId),
    });
    return;
  }

  // CASE 2: We have at least one test → use existing analytics
  const base = formatWeakTopicsMessage(last, userId); // already lists topics / or “no weak topics”

  let msg;
  if (lang === "kn") {
    msg =
      "📌 *ನನ್ನ ದುರ್ಬಲ ಭಾಗಗಳು – ಗಮನ ಕೇಂದ್ರ*\n\n" +
      "ಈ ಕೆಳಗಿನ ವಿಷಯಗಳಲ್ಲಿ ನೀವು ಈಗ ಹೆಚ್ಚು ಅಂಕ ಕಳೆದುಕೊಳ್ಳುವ ಸಾಧ್ಯತೆ ಇದೆ.\n" +
      "ಇಲ್ಲಿ ಸುಧಾರಣೆ ಮಾಡಿದರೆ ನಿಮ್ಮ ಒಟ್ಟು ಸಾಧನೆಯಲ್ಲಿ ತ್ವರಿತ ಬದಲಾವಣೆ ಕಾಣುತ್ತದೆ.\n\n" +
      base +
      "\n\n" +
      "🎯 ಇಂದಿನ ಯೋಜನೆ:\n" +
      "• 1–2 ದುರ್ಬಲ ವಿಷಯಗಳನ್ನು ಆರಿಸಿ\n" +
      "• ಅದನ್ನು ಪುನರವಲೋಕನ ಮಾಡಿ\n" +
      "• ನಂತರ *🎯 ಇಂದಿನ ಅಭ್ಯಾಸ* ಮತ್ತೆ ಮಾಡಿ.\n\n" +
      "ತಪ್ಪುಗಳು ನಿಮ್ಮ ವಿರುದ್ಧ ಅಲ್ಲ — ಅವೇ ನಿಮ್ಮ ದಿಕ್ಕು ತೋರಿಸುವ ಯಂತ್ರ.";
  } else if (lang === "ur") {
    msg =
      "📌 *میری کمزوریاں – فوکس میپ*\n\n" +
      "ان موضوعات میں آپ اس وقت نسبتاً زیادہ نمبر کھو رہے ہیں۔\n" +
      "یہی وہ جگہ ہے جہاں بہت تھوڑی سی بہتری آپ کے مجموعی اسکور کو تیزی سے اوپر لے جا سکتی ہے۔\n\n" +
      base +
      "\n\n" +
      "🎯 آج کا پلان:\n" +
      "• 1–2 کمزور موضوعات منتخب کریں\n" +
      "• انہیں دہرائیں\n" +
      "• پھر *🎯 آج کی مشق* دوبارہ دیں۔\n\n" +
      "غلطیاں آپ کے خلاف ثبوت نہیں، آپ کی رہنمائی کا ذریعہ ہیں۔";
  } else {
    msg =
      "📌 *My Weak Areas – Focus Map*\n\n" +
      "These are the topics where you’re currently losing marks more often.\n" +
      "Improving just a few of these will give you the fastest boost in your score.\n\n" +
      base +
      "\n\n" +
      "🎯 Plan for today:\n" +
      "• Pick 1–2 weak topics\n" +
      "• Revise them\n" +
      "• Then take *🎯 Today’s Practice* again.\n\n" +
      "Your mistakes are not evidence against you — they’re a roadmap for what to fix next.";
  }

  bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    ...buildMainMenu(userId),
  });
}


// ================== /start – LANGUAGE SELECTION ==================

// ================== /start – ONBOARDING + HOME ==================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const prefs = userPrefs[userId] || {};
  const hasLang = Boolean(prefs.lang || prefs.uiLang); // lang chosen before?

  // 🟢 A. FIRST-TIME USER → SHOW LANGUAGE SELECTION (NO HOME YET)
  if (!hasLang) {
    const pack = uiText.en; // language chooser copy in English

    const text =
      `${pack.startGreeting}\n\n` +
      `${pack.startSub}\n\n` +
      `*${pack.chooseLanguage}*`;

    bot.sendMessage(chatId, text, {
      reply_markup: buildLanguageInlineKeyboard(),
      parse_mode: "Markdown",
    });
    return;
  }

  // 🟡 B. RETURNING USER → DIRECTLY SHOW HOME (THIS IS YOUR “6th” LINE)
  const text = `${t(userId, "welcomeMain")}\n\n${t(userId, "mainMenuIntro")}`;

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...buildMainMenu(userId), // 🎯 Today’s Practice / 📊 My Progress / 📌 My Weak Areas / 📂 More Options
  });
});



// ================== OTHER COMMANDS ==================

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text =
    `${t(userId, "helpTitle")}\n\n` +
    "Commands:\n" +
    "/start – Show main menu & language selector\n" +
    "/dailytest – Start a daily practice test (5Q free)\n" +
    "/leaderboard – View top performers\n" +
    "/status – Check whether you are Free or Premium\n\n" +
    "Daily flow idea:\n" +
    "1️⃣ Choose Daily Practice Test\n" +
    "2️⃣ Select area: RC / Grammar / Poetry / Pedagogy / Vocab / Mixed\n" +
    "3️⃣ Finish 5Q mini-test\n" +
    "4️⃣ See summary, note weak areas, revise";
  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...buildMainMenu(userId),
  });
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isPrem = isPremiumUser(userId);
  const name = getDisplayName(msg.from);
  const status = isPrem ? t(userId, "planPremium") : t(userId, "planFree");
  let message = `${t(userId, "accountStatusTitle")}\n\n`;
  message += `👤 Name: *${name}*\n`;
  message += `📦 Plan: *${status}*\n\n`;
  if (isPrem) {
    message +=
      "You have access to:\n" +
      "• Unlimited tests & mocks\n" +
      "• Full explanations & teaching tips\n" +
      "• Topic-wise & weak-topic analysis\n" +
      "• Wrong-only practice\n" +
      "• ⭐ Badge on leaderboard\n";
  } else {
    message += "Free plan:\n";
    message += `• 1 mini-test (${MINI_TEST_SIZE} questions) per day\n`;
    message += "• Score + accuracy summary\n";
    message += "• Wrong-answers explanation *preview*\n\n";
    message += "Later, you can decide about Premium based on your comfort.";
  }
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/dailytest/, (msg) => {
  const chatId = msg.chat.id;
  askEnglishMode(chatId, msg.from);
});

bot.onText(/\/leaderboard/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  sendLeaderboard(chatId, userId);
});


// ================== CALLBACKS ==================

bot.on("callback_query", async (callbackQuery) => {
  try {
    const data = callbackQuery.data;
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const isPrem = isPremiumUser(userId);
    // ===== More Options callbacks =====
    if (data === "opt_daily_practice") {
      // Same as pressing 🎯 Today’s Practice
      askEnglishMode(chatId, callbackQuery.from);
      return;
    }

    if (data === "opt_full_mock") {
      await bot.sendMessage(
        chatId,
        "Full mock tests coming soon. Use Today’s Practice for now. 🙂",
        { parse_mode: "Markdown", ...buildMainMenu(userId) }
      );
      return;
    }

    if (data === "opt_leaderboard") {
      sendLeaderboard(chatId, userId);
      return;
    }

    if (data === "opt_help") {
      const help =
        `${t(userId, "helpTitle")}\n\n` +
        "Commands:\n" +
        "/start — Show main menu\n" +
        "/dailytest — Practice test\n" +
        "/leaderboard — Top performers\n" +
        "/status — Account status";
      await bot.sendMessage(chatId, help, {
        parse_mode: "Markdown",
        ...buildMainMenu(userId),
      });
      return;
    }


    // ===== LANGUAGE HANDLING =====
    if (data && data.startsWith("set_lang_")) {
      const lang = data.split("_")[2]; // en / kn / ur

      if ((lang === "kn" || lang === "ur") && !isPremiumUser(userId)) {
        const pack = uiText[lang] || uiText.kn;
        await bot.sendMessage(chatId, pack.premiumLangPitch, {
          reply_markup: {
            inline_keyboard: [
              [{ text: pack.upgradeButton, callback_data: "go_premium" }],
              [{ text: pack.continueEnglishButton, callback_data: "set_lang_en" }],
            ],
          },
          parse_mode: "Markdown",
        });
        return;
      }

      setUiLang(userId, lang);

      const text = `${t(userId, "welcomeMain")}\n\n${t(userId, "mainMenuIntro")}`;
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        ...buildMainMenu(userId),
      });
      return;
    }

    if (data === "go_premium") {
      await bot.sendMessage(
        chatId,
        "In the future, this will redirect to the premium upgrade page / payment link."
      );
      return;
    }

    // ===== Mode selection (RC / Grammar / Poetry / Pedagogy / Vocab / Mixed) =====
    if (data && data.startsWith("eng2_mode_")) {
      const mode = data.replace("eng2_mode_", "");
      if (!userPrefs[userId]) userPrefs[userId] = {};
      userPrefs[userId].eng2Mode = mode;

      const pretty = getPrettyModeName(mode);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `Mode set to: ${pretty}`,
        show_alert: false,
      });
      await bot.sendMessage(
        chatId,
        `Nice! We’ll practise *${pretty}* questions now.`,
        { parse_mode: "Markdown" }
      );
      startDailyPracticeTest(chatId, callbackQuery.from);
      return;
    }

    // ===== Skip current question =====
    if (data.startsWith("skip:")) {
      const session = sessions[chatId];
      if (!session) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "No active test to skip.",
          show_alert: false,
        });
        return;
      }
      const [, qIndexStr] = data.split(":");
      const pressedIndex = parseInt(qIndexStr, 10);
      if (pressedIndex !== session.currentIndex) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "This question is already handled.",
          show_alert: false,
        });
        return;
      }
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "Skipped. Moving ahead.",
        show_alert: false,
      });
      const pool = session.questionsPool || questions;
      session.currentIndex++;
      if (session.currentIndex < pool.length) {
        sendQuestion(chatId);
      } else {
        sendResult(chatId);
      }
      return;
    }

    // ===== Finish test early =====
    if (data.startsWith("finish_now:")) {
      const session = sessions[chatId];
      if (!session) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "No active test to finish.",
          show_alert: false,
        });
        return;
      }
      const [, qIndexStr] = data.split(":");
      const pressedIndex = parseInt(qIndexStr, 10);
      if (pressedIndex !== session.currentIndex) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "This question is already handled.",
          show_alert: false,
        });
        return;
      }
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "Finishing test with attempted questions.",
        show_alert: false,
      });
      sendResult(chatId);
      return;
    }

    // ===== "More Options" → Settings → Change Language =====
    if (data === "opt_settings") {
      const text =
        `${t(userId, "settingsTitle")}\n\n` +
        `• ${t(userId, "changeLanguageButton")}`;
      await bot.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: t(userId, "changeLanguageButton"),
                callback_data: "opt_change_lang",
              },
            ],
            [
              {
                text: "⬅️ Back to Home",
                callback_data: "done_results", // reuse main menu route
              },
            ],
          ],
        },
        parse_mode: "Markdown",
      });
      return;
    }

    if (data === "opt_change_lang") {
      const text =
        `${t(userId, "changeLanguageTitle")}\n\n` +
        `${t(userId, "changeLanguageSub")}`;
      await bot.sendMessage(chatId, text, {
        reply_markup: buildLanguageInlineKeyboard(),
        parse_mode: "Markdown",
      });
      return;
    }


    // ===== Answer selection =====
    if (/^\d+:\d+$/.test(data)) {
      const session = sessions[chatId];
      if (!session) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "No active test.",
          show_alert: false,
        });
        return;
      }
      const [qIndexStr, optIndexStr] = data.split(":");
      const qIndex = parseInt(qIndexStr, 10);
      const chosen = parseInt(optIndexStr, 10);
      if (qIndex !== session.currentIndex) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "This question is already handled.",
          show_alert: false,
        });
        return;
      }

      const pool = session.questionsPool || questions;
      const q = pool[qIndex];
      const correct = chosen === q.correctIndex;

      session.answers.push({
        qIndex,
        chosen,
        correct,
        subjectId: q.subjectId,
        categoryId: q.categoryId,
        topicId: q.topicId,
      });
      if (correct) {
        session.score++;
      }

      // react
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: correct ? pickRandom(correctReactions) : pickRandom(wrongReactions),
        show_alert: false,
      });

      session.currentIndex++;
      if (session.currentIndex < pool.length) {
        sendQuestion(chatId);
      } else {
        sendResult(chatId);
      }
      return;
    }

    // ===== Review screens after result =====

    if (data === "view_right") {
      const result = lastResults[chatId];
      if (!result) return;
      const msgText = formatRightAnswersMessage(result, userId);
      await bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
      return;
    }

    if (data === "view_wrong") {
      const result = lastResults[chatId];
      if (!result) return;
      const msgText = isPrem
        ? formatWrongAnswersMessage(result, userId)
        : formatWrongAnswersPreviewMessage(result, userId);
      await bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
      return;
    }

    if (data === "view_topics") {
      const result = lastResults[chatId];
      if (!result) return;
      const msgText = formatTopicStatsMessage(result, userId);
      await bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
      return;
    }

    if (data === "view_weak_topics") {
      const result = lastResults[chatId];
      if (!result) return;
      const msgText = formatWeakTopicsMessage(result, userId);
      await bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
      return;
    }

    if (data === "retake_wrong") {
      startWrongRetake(chatId, callbackQuery.from);
      return;
    }

    if (data === "upgrade_mentor") {
      await bot.sendMessage(
        chatId,
        "Later, Mentor+ will unlock full explanations, topic-wise breakdown and wrong-only retakes.\nRight now, focus on steady practice. 🙂"
      );
      return;
    }

    if (data === "done_results") {
      await bot.sendMessage(
        chatId,
        t(userId, "mainMenuIntro"),
        { parse_mode: "Markdown", ...buildMainMenu(userId) }
      );
      return;
    }
  } catch (err) {
    console.error("Error in callback_query handler:", err);
  }
});
// ================== MAIN MENU MESSAGE HANDLER (FIX) ==================
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text;

  if (!text || !userId) return;

  // ✅ let /start, /help, /status, etc be handled by bot.onText only
  if (text.startsWith("/")) return;

  if (text === t(userId, "todaysPracticeButton")) {
    askEnglishMode(chatId, msg.from);

  } else if (text === t(userId, "myProgressButton")) {
    sendMyProgress(chatId, userId);

  } else if (text === t(userId, "myWeakAreasButton")) {
    sendMyWeakAreas(chatId, userId);

  } else if (text === t(userId, "moreOptionsButton")) {
    showMoreOptions(chatId, userId);
  }
});

