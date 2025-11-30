// index.js

const TelegramBot = require("node-telegram-bot-api");

// ================== CONFIG ==================

// --- SUBJECT CONFIGURATION ---
const AVAILABLE_SUBJECTS = {
  'eng2': { name: 'English Language II', icon: '🔤', free: true }, 
  'cdp': { name: 'Child Development & Pedagogy (CDP)', icon: '👶', free: false }, 
  'maths': { name: 'Mathematics', icon: '🔢', free: false }, 
  'evs': { name: 'Environmental Studies (EVS)', icon: '🌳', free: false } 
};

// Load English Language II questions (using mock data structure for demo)
// In a real application, you'd load based on subjectId.
const questions = require("./eng_questions.json");

// Premium users (hard-coded for now - this will be replaced by DB subject map)
const premiumUsers = new Set([
  437248254, // EXAMPLE: YOUR TELEGRAM ID. Used for Admin Error Reporting!
  // add more ids...
]);

// --- ADMIN ID FOR ERROR REPORTING ---
// The first user ID in the set will be treated as the admin for receiving error reports.
const ADMIN_ID = [...premiumUsers][0]; 


// NOTE: Since we are still using in-memory storage, we will simulate the purchased modules
// In a real app, userPrefs[userId].purchasedModules would be loaded from Firestore.
function hasAccessToSubject(userId, subjectId, isFullTest = false) {
  // 1. Check if the subject is marked as free (Mini Tests are free for all subjects)
  if (AVAILABLE_SUBJECTS[subjectId].free && !isFullTest) {
    return true;
  }
  
  // 2. Check for the pilot group (the 10 teachers)
  if (premiumUsers.has(userId)) {
    return true; // Full access for pilot users
  }
  
  // 3. Check for specific subject purchase (simulated in memory)
  const purchasedModules = userPrefs[userId]?.purchasedModules || {};
  return purchasedModules[subjectId] === true;
}

// Free-plan limits
const FREE_DAILY_MINI_TESTS = 1; // 1 test per day
const MINI_TEST_SIZE = 5;        // 5 questions per free test

// Sound config (Telegram file_id placeholders)
const CORRECT_SOUND_FILE_ID = "";
const WRONG_SOUND_FILE_ID   = "";

// Telegram bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// In-memory stores
const sessions   = {};
const lastResults = {};
const userStats  = {}; // New structure needed for Progress/Weak Areas/Profile - keeping empty for now
const userPrefs  = {}; // will now store { uiLang: 'en', purchasedModules: { 'cdp': true } }

const letters = ['A', 'B', 'C', 'D'];
const correctReactions = ['🎉', '🥳', '✅', '🌟', '👍'];
const wrongReactions   = ['😔', '❌', '😟', '🤔', '🫣'];

// ================== UI TEXT / LANGUAGE BANK (REDESIGN) ==================

const uiText = {
  en: {
    startGreeting: "👋 Welcome to *Namma KARTET English Mentor*!",
    startSub: "Let's set your app language first (only menus & messages). Questions will still be in English, just like the exam.",
    chooseLanguage: "Choose your language:",

    langEnglishButton: "🇬🇧 English (Free)",
    langKannadaButton: "ಕನ್ನಡ Kannada (🔒 Mentor+)",
    langUrduButton: "اردو Urdu (🔒 Mentor+)",

    mainMenuIntro: "✅ Using *English* for menus and guidance.\nChoose an option to begin your KARTET practice!",

    // --- HOME MENU BUTTONS ---
    practiceButton: "🎯 Today’s Practice", // Renamed
    progressButton: "📊 My Progress",     // New
    weakAreasButton: "📌 Practice Weak Areas", // New
    moreOptionsButton: "📂 More Options", // New

    // --- MORE OPTIONS MENU BUTTONS ---
    mockButton: "📚 Full Mock Test", // Moved
    leaderboardButton: "🏆 Leaderboard", // Moved
    profileButton: "👤 My Profile / Plan", // New
    settingsButton: "⚙️ Settings (Language)", // Renamed
    helpButton: "❓ Help & Support", // New

    // --- SUBJECT MENU TEXT ---
    subjectMenuIntro: "🎯 *Select the Subject* you wish to practice. Mini Tests (5 Qs) are free for all subjects.",
    subjectModulePaid: "🔒 Module Access Required",

    // Quiz Menu
    quizMenuIntro: "*{subjectName} Practice Modes:*",
    modeGrammar: "🧩 Grammar & Vocabulary",
    modeRC: "📖 Reading Comprehension (RC)",
    modePedagogy: "🍎 Pedagogy",
    modeMixed: "🔄 Mixed Bag",
    modeMiniTest: "⚡ Mini Test (5 Qs) - FREE",
    modeFullTest: "🔥 Full Test (15 Qs) - PAID",

    // Premium pitch text
    premiumPitch: "🔒 *Access Required for {subjectName}*\n\nTo unlock the full {subjectName} module, including unlimited Full Tests, detailed modes (Grammar/RC), and advanced progress tracking, you need to purchase access.\n\n*Purchase Full Access for {subjectName} (₹50 once-off)*.",
    upgradeButton: "🔓 Purchase Full Access for {subjectName}",
    continueFreeButton: "🔙 Continue with Free Mini Test",
    
    // --- ERROR REPORTING TEXT ---
    reportErrorButton: "🐞 Report Question Error",
    errorReported: "Thank you! We received your report and will review the question immediately. 🙏",
    
    // Progress text
    progressNoData: "You haven't completed any tests yet. Try a practice run first!",
    progressTitle: "📊 *Your Performance Summary*",
    progressLast: "Last Test Score: {score}/{total} ({percent}%)",
    progressAvg: "Average Score: {avgScore}/{avgTotal} ({avgPercent}%)",
    progressTotal: "Total Questions Attempted: {totalAttempted}",
    progressImprovement: "Keep practicing! Consistency is key.",

    // Placeholder text for new features
    weakAreasPlaceholder: "This feature is currently under development. Soon, we will automatically detect and test you on your weakest topics!",
    leaderboardPlaceholder: "The Leaderboard feature requires you to complete at least 3 tests before being activated. Keep practicing!",
    profilePlaceholder: "👤 *Your Profile Status*\n\n*Plan:* Free User\n*Tests Completed:* 0\n*Joined:* {joinDate}\n\nUpgrade to Premium for advanced features!",
    helpPlaceholder: "❓ *Help & Support*\n\nIf you need immediate assistance, please email us at support@kartetmentor.com or check our FAQ on our website.",
  },

  kn: {
    premiumLangPitch:"🔒 *Mentor+ (Premium) ವಿಶೇಷ ಸೌಲಭ್ಯ*\n\n" +"ನಿಮ್ಮಿಗೆ ಕನ್ನಡದಲ್ಲೇ:\n" +"✅ ಸ್ನೇಹಪೂರ್ವಕ ಮಾರ್ಗದರ್ಶನ\n" +"✅ ಸುಲಭವಾದ ಮೆನುಗಳು\n" +"✅ ಕಡಿಮೆ ಗೊಂದಲ, ಹೆಚ್ಚು ಆತ್ಮವಿಶ್ವಾಸ 💪\n\n" +"ಇವುಗಳನ್ನೆಲ್ಲ ಪಡೆಯಲು *Mentor+ ಗೆ ಅಪ್ಗ್ರೇಡ್ ಮಾಡಿ*.\n\n" +"💎 ತಿಂಗಳಿಗೆ ಕೇವಿಯ₹199!",
    subjectMenuIntro: "🎯 ನೀವು practice ಮಾಡಲು ಬಯಸುವ ವಿಷಯವನ್ನು *ಆಯ್ಕೆಮಾಡಿ*.",
    quizMenuIntro: "*{subjectName} Practice ವಿಧಾನಗಳು:*",
    upgradeButton: "🔓 ಪೂರ್ಣ ಪ್ರವೇಶವನ್ನು ಖರೀದಿಸಿ",
    continueEnglishButton: "🔙 English ನಲ್ಲಿ ಮುಂದುವರಿಯಿರಿ",
    errorReported: "ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ವರದಿಯನ್ನು ನಾವು ಸ್ವೀಕರಿಸಿದ್ದೇವೆ ಮತ್ತು ಪ್ರಶ್ನೆಯನ್ನು ತಕ್ಷಣ ಪರಿಶೀಲಿಸುತ್ತೇವೆ. 🙏",
    
    // HOME MENU BUTTONS (Kannada)
    practiceButton: "🎯 ಇಂದಿನ ಅಭ್ಯಾಸ", 
    progressButton: "📊 ನನ್ನ ಪ್ರಗತಿ", 
    weakAreasButton: "📌 ದುರ್ಬಲ ವಿಭಾಗಗಳ ಅಭ್ಯಾಸ", 
    moreOptionsButton: "📂 ಹೆಚ್ಚಿನ ಆಯ್ಕೆಗಳು", 

    // MORE OPTIONS MENU BUTTONS (Kannada)
    mockButton: "📚 ಸಂಪೂರ್ಣ ಅಣಕು ಪರೀಕ್ಷೆ", 
    leaderboardButton: "🏆 ಲೀಡರ್‌ಬೋರ್ಡ್", 
    profileButton: "👤 ನನ್ನ ಪ್ರೊಫೈಲ್ / ಯೋಜನೆ", 
    settingsButton: "⚙️ ಸೆಟ್ಟಿಂಗ್‌ಗಳು (ಭಾಷೆ)", 
    helpButton: "❓ ಸಹಾಯ ಮತ್ತು ಬೆಂಬಲ", 
    
    // Placeholder text for new features
    weakAreasPlaceholder: "ಈ ವೈಶಿಷ್ಟ್ಯವು ಪ್ರಸ್ತುತ ಅಭಿವೃದ್ಧಿಯಲ್ಲಿದೆ. ಶೀಘ್ರದಲ್ಲೇ, ನಿಮ್ಮ ದುರ್ಬಲ ವಿಷಯಗಳ ಮೇಲೆ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಪರೀಕ್ಷೆ ನೀಡಲಾಗುತ್ತದೆ!",
    leaderboardPlaceholder: "ಲೀಡರ್‌ಬೋರ್ಡ್ ಅನ್ನು ಸಕ್ರಿಯಗೊಳಿಸಲು ನೀವು ಕನಿಷ್ಠ 3 ಪರೀಕ್ಷೆಗಳನ್ನು ಪೂರ್ಣಗೊಳಿಸಬೇಕು. ಅಭ್ಯಾಸ ಮಾಡುತ್ತಿರಿ!",
    profilePlaceholder: "👤 *ನಿಮ್ಮ ಪ್ರೊಫೈಲ್ ಸ್ಥಿತಿ*\n\n*ಯೋಜನೆ:* ಉಚಿತ ಬಳಕೆದಾರ\n*ಪೂರ್ಣಗೊಂಡ ಪರೀಕ್ಷೆಗಳು:* 0\n*ಸೇರಿದ ದಿನಾಂಕ:* {joinDate}\n\nಸುಧಾರಿತ ವೈಶಿಷ್ಟ್ಯಗಳಿಗಾಗಿ ಪ್ರೀಮಿಯಂಗೆ ಅಪ್‌ಗ್ರೇಡ್ ಮಾಡಿ!",
    helpPlaceholder: "❓ *ಸಹಾಯ ಮತ್ತು ಬೆಂಬಲ*\n\nನಿಮಗೆ ತಕ್ಷಣದ ಸಹಾಯ ಬೇಕಿದ್ದರೆ, ದಯವಿಟ್ಟು support@kartetmentor.com ಗೆ ಇಮೇಲ್ ಮಾಡಿ ಅಥವಾ ನಮ್ಮ ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿರುವ FAQ ಅನ್ನು ಪರಿಶೀಲಿಸಿ.",
  },

  ur: {
    premiumLangPitch:"🔒 *مینٹر+ (Premium) کی خصوصی سہولت*\n\n" +"اردو زبان میں:\n" +"✅ دوستانہ رہنمائی\n" +"✅ آسان مینو\n" +"✅ کم الجھن، زیادہ اعتماد 💪\n\n" +"ان سب کے لیے *Mentor+ میں اپگریڈ کریں*۔\n\n" +"💎 صرف ₹199 ماہانہ!",
    subjectMenuIntro: "🎯 براہ کرم اس مضمون کا *انتخاب کریں* جس کی آپ مشق کرنا چاہتے ہیں۔",
    quizMenuIntro: "*{subjectName} مشق کے طریقے:*",
    upgradeButton: "🔓 مکمل رسائی خریدیں",
    continueEnglishButton: "🔙 English میں جاری رکھیں",
    errorReported: "شکریہ! ہمیں آپ کی رپورٹ موصول ہو گئی ہے اور ہم سوال کا فوری جائزہ لیں گے۔ 🙏",
    
    // HOME MENU BUTTONS (Urdu)
    practiceButton: "🎯 آج کی مشق", 
    progressButton: "📊 میری پیش رفت", 
    weakAreasButton: "📌 کمزور حصوں کی مشق", 
    moreOptionsButton: "📂 مزید اختیارات", 

    // MORE OPTIONS MENU BUTTONS (Urdu)
    mockButton: "📚 مکمل فرضی ٹیسٹ", 
    leaderboardButton: "🏆 لیڈر بورڈ", 
    profileButton: "👤 میرا پروفائل / منصوبہ", 
    settingsButton: "⚙️ ترتیبات (زبان)", 
    helpButton: "❓ مدد اور معاونت", 
    
    // Placeholder text for new features
    weakAreasPlaceholder: "یہ فیچر فی الحال زیرِ ترقی ہے۔ جلد ہی، آپ کے کمزور ترین موضوعات پر خودکار طریقے سے جانچ کی جائے گی!",
    leaderboardPlaceholder: "لیڈر بورڈ کی خصوصیت کو فعال کرنے کے لیے آپ کو کم از کم 3 ٹیسٹ مکمل کرنے ہوں گے۔ مشق جاری رکھیں!",
    profilePlaceholder: "👤 *آپ کے پروفائل کی حیثیت*\n\n*منصوبہ:* مفت صارف\n*مکمل کیے گئے ٹیسٹ:* 0\n*شمولیت کی تاریخ:* {joinDate}\n\nاعلیٰ خصوصیات کے لیے پریمیئم میں اپ گریڈ کریں!",
    helpPlaceholder: "❓ *مدد اور معاونت*\n\nاگر آپ کو فوری مدد کی ضرورت ہے، تو براہ کرم ہمیں support@kartetmentor.com پر ای میل کریں یا ہماری ویب سائٹ پر موجود FAQ چیک کریں۔",
  }
};


// ================== HELPER FUNCTIONS (PREFS) ==================

function getUiLang(userId) {
  if (!userPrefs[userId]) userPrefs[userId] = { uiLang: 'en' };
  return userPrefs[userId].uiLang || 'en';
}

function setUiLang(userId, lang) {
  if (!userPrefs[userId]) userPrefs[userId] = {};
  userPrefs[userId].uiLang = lang;
}

/**
 * Gets the localized text for a key, falling back to English.
 * @param {number} userId
 * @param {string} key
 * @returns {string} Localized text
 */
function getLocalizedText(userId, key) {
    const lang = getUiLang(userId);
    if (uiText[lang] && uiText[lang][key]) {
        return uiText[lang][key];
    }
    return uiText.en[key] || `[Missing text for ${key}]`;
}


// ================== HELPER FUNCTIONS (QUIZ) ==================

/**
 * Shuffles an array in place (Fisher-Yates)
 * @param {Array} a items
 * @returns {Array} Shuffled array
 */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Creates a unique pool of questions for the session.
 */
function createQuestionPool(size, subjectId, mode = 'mixed') {
  // SIMULATION: Since we only have 'eng_questions', we will use it for all
  let filteredQuestions = questions;

  if (mode !== 'mixed' && mode !== 'full' && mode !== 'mini') {
    // Filter by specific sub-mode if available in the subject data
    filteredQuestions = questions.filter(q => q.eng2Mode === mode);
  }

  // Ensure we don't try to pull more questions than available
  const poolSize = Math.min(size, filteredQuestions.length);

  const indices = Array.from({ length: filteredQuestions.length }, (_, i) => i);
  shuffle(indices);
  const selectedIndices = indices.slice(0, poolSize);

  // Map indices back to question objects, and assign a unique session qIndex
  const pool = selectedIndices.map(index => {
    const q = filteredQuestions[index];
    return {
        // qIndex is the index in the global 'questions' array. This is the key we need for error reporting.
        qIndex: questions.findIndex(globalQ => globalQ.question === q.question),
        ...q 
    };
  });

  return pool;
}

/**
 * Sends the current question in the session to the chat.
 * @param {number} chatId Telegram chat ID
 */
async function sendQuestion(chatId) {
  const session = sessions[chatId];
  if (!session || session.questionsPool.length === 0) {
    return bot.sendMessage(chatId, "Error: Could not start the test. Please try /start or /practice again.");
  }

  const qData = session.questionsPool[session.currentIndex];
  // The unique identifier of the question in the global list for error reporting
  const globalQIndex = qData.qIndex; 

  const currentQNum = session.currentIndex + 1;
  const totalQNum = session.questionsPool.length;

  const text = [
    `*Question ${currentQNum}/${totalQNum}*`,
    "---",
    `*${qData.question}*`,
    "",
    ...qData.options.map((opt, i) => `${letters[i]}) ${opt}`)
  ].join("\n");

  const optionButtons = qData.options.map((_, i) => ({
    // ans_{subjectId}_{globalQIndex}_{chosenOptionIndex}
    text: letters[i],
    callback_data: `ans_${session.subjectId}_${globalQIndex}_${i}` 
  }));
  
  // Add the Error Report Button
  const errorReportButton = {
      text: getLocalizedText(session.userId, 'reportErrorButton'),
      // report_{subjectId}_{globalQIndex}
      callback_data: `report_${session.subjectId}_${globalQIndex}`
  };

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
          optionButtons, // Row 1: A, B, C, D
          [errorReportButton] // Row 2: Report Error
      ]
    },
    parse_mode: 'Markdown'
  };

  if (session.messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: session.messageId,
        ...keyboard,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      if (!error.message.includes('message is not modified') && !error.message.includes('message to edit not found')) {
        console.error("Error editing message:", error.message);
      }
      const sentMessage = await bot.sendMessage(chatId, text, keyboard);
      session.messageId = sentMessage.message_id;
    }
  } else {
    const sentMessage = await bot.sendMessage(chatId, text, keyboard);
    session.messageId = sentMessage.message_id;
  }
}


// ================== MOTIVATION SYSTEM (MULTI-LANGUAGE) ==================

const motivation = {
  en: {
    // ... (motivation content remains the same)
    perfect: [
      "Outstanding! You’re exam-ready 💯",
      "Flawless performance! Keep this level 🔥",
      "Perfect score! Top-class work 👏",
      "Brilliant! You nailed every question 💎",
    ],
    good: [
      "Nice work! You’re improving 👍",
      "Good attempt! Just a little more push 💪",
      "You’re on the right track!",
      "Strong effort! Keep revising.",
    ],
    low: [
      "No worries — learning starts here 🌱",
      "Every mistake today helps tomorrow.",
      "Don’t be discouraged, keep going 💪",
      "Progress takes time — you’re trying!",
    ]
  },

  kn: {
    // ... (motivation content remains the same)
    perfect: [
      "ಅದ್ಭುತ! ನೀವು examಗೆ ರೆಡಿಯಾಗಿದ್ದೀರಾ 💯",
      "ಚನ್ನಾಗಿ attempt ಮಾಡಿದ್ದೀರಾ, ಇಂತಹ ಮಟ್ಟ ನಿಂತರೆ 90+ ಖಾತ್ರಿ 🔥",
      "ಪರ್ಫೆಕ್ಟ್ ಸ್ಕೋರ್! ಟಾಪ್ ಕ್ಲಾಸ್ ಕೆಲಸ 👏",
      "ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳನ್ನೂ ಸೂಪರ್‌ಗಾ ಮಾಡಿದೀರಾ 💎",
    ],
    good: [
      "ಚೆನ್ನಾಗಿದೆ! ನಿಮ್ಮ progress ಸ್ಪಷ್ಟವಾಗಿದೆ 👍",
      "ಒಳ್ಳೆಯ ಪ್ರಯತ್ನ! ಇನ್ನೂ ಸ್ವಲ್ಪ ರಿವಿಷನ್ ಮಾಡಿದ್ರೆ ಇನ್ನೂ better 💪",
      "ಸರಿಯಾದ ದಾರಿಯಲ್ಲಿದ್ದೀರಾ, ಹೀಗೆ continue ಮಾಡಿ!",
      "ಸಾಲಿಡ್ effort! ದಿನವೂ ಸ್ವಲ್ಪ practice ಮಾಡಿದ್ರೆ ಸಾಕು.",
    ],
    low: [
      "ಟೆನ್ಷನ್ ಬೇಡ — ಇಲ್ಲಿ‌ನಿಂದಲೇ ನಿಜವಾದ learning ಶುರು ಆಗುತ್ತದೆ 🌱",
      "ಇಂದಿನ ತಪ್ಪುಗಳು ನಾಳೆಯ examನಲ್ಲಿ کمک ಮಾಡುತ್ತವೆ.",
      "ಹೊಸದು practice ಮಾಡ್ತೀರಾ, ತಪ್ಪು ಬರೋದ್ರಲ್ಲಿ ತಪ್ಪಿಲ್ಲ 💪",
      "ಹಿಂದೇಟು ಅಂತಾನೇನಿಲ್ಲ, ಮುಂದಕ್ಕೆ ಹೋಗೋಕ್ಕೆ ಇವು ಸಹಾಯಕ.",
    ]
  },

  ur: {
    // ... (motivation content remains the same)
    perfect: [
      "کمال! آپ امتحان کے لیے تیار ہیں 💯",
      "بہترین کارکردگی! اسی لیول پر رہے تو 90+ یقینی 🔥",
      "پورا نمبر! زبردست محنت 👏",
      "ہر سوال شاندار طریقے سے حل کیا 💎",
    ],
    good: [
      "اچھی کوشش! آپ کی پیش رفت صاف نظر آرہی ہے 👍",
      "بہت اچھا! تھوڑی سی اور مشق سے اور مضبوط ہو جائیں گے 💪",
      "آپ صحیح راستے پر ہیں، بس جاری رکھیں!",
      "مزبوط کوشش! روز تھوڑا سا دہرائیں، کافی ہے۔",
    ],
    low: [
      "فکر مت کریں — اصل سیکھنا یہیں سے شروع ہوتا ہے 🌱",
      "آج کی غلطیاں، کل کے امتحان میں مدد کریں گی۔",
      "غلطیاں برا نہیں، کوشش نہ کرنا برا ہے 💪",
      "پیچھے ہٹنا نہیں، آہستہ آہستہ ہی سہی، آگے بڑھ رہے ہیں۔",
    ]
  }
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getMotivation(score, total, uiLang) {
  const ratio = score / total;
  const lang = motivation[uiLang] ? uiLang : 'en';

  if (ratio === 1) return pickRandom(motivation[lang].perfect);
  if (ratio >= 0.5) return pickRandom(motivation[lang].good);
  return pickRandom(motivation[lang].low);
}


/**
 * Ends the test session and sends the results summary.
 * @param {number} chatId Telegram chat ID
 */
async function sendResult(chatId) {
  const session = sessions[chatId];
  if (!session) return;
  
  const userId = session.userId || chatId; 

  const total = session.questionsPool.length;
  const score = session.score;
  const percentage = (score / total) * 100;
  const timeTaken = (Date.now() - session.startTime) / 1000; // seconds

  // Update last result (for progress tracking)
  lastResults[chatId] = { score, total, percentage, timeTaken, endTime: Date.now(), subjectId: session.subjectId };

  // Generate summary text (Using English in summary for now, as UI Text is for menus)
  const summaryText = [
    "🎉 *Test Completed!*",
    "---",
    `✅ *Score:* ${score} out of ${total} in *${AVAILABLE_SUBJECTS[session.subjectId].name}*`,
    `📈 *Accuracy:* ${percentage.toFixed(0)}%`,
    `⏱️ *Time Taken:* ${timeTaken.toFixed(1)} seconds`,
    "---",
  ].join("\n");

  // Get user's UI language and motivation line
  const uiLang = getUiLang(userId); 
  const motivationLine = getMotivation(score, total, uiLang);

  // Send the final result message with motivation line in the correct language
  await bot.sendMessage(chatId, summaryText + "\n\n" + motivationLine, {
    parse_mode: 'Markdown'
  });

  // Clean up session
  delete sessions[chatId];
}


// ================== TELEGRAM HANDLERS (MENUS) ==================

// Handle /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!userPrefs[userId] || !userPrefs[userId].uiLang) {
      setUiLang(userId, 'en');
  }

  const t = uiText.en; // Use English for the initial language selector menu

  const text = [
    t.startGreeting,
    "",
    t.startSub,
    "",
    `*${t.chooseLanguage}*`
  ].join("\n");

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: t.langEnglishButton, callback_data: 'set_lang_en' }],
        [{ text: t.langKannadaButton, callback_data: 'set_lang_kn' }],
        [{ text: t.langUrduButton, callback_data: 'set_lang_ur' }]
      ]
    },
    parse_mode: 'Markdown'
  };

  bot.sendMessage(chatId, text, keyboard);
});

// Sends the main menu based on current user language preference (The new 3-button HOME)
async function sendMainMenu(chatId, userId, messageId) {
    const t = uiText.en;
    const introText = getLocalizedText(userId, 'mainMenuIntro');
    
    // Get localized button texts
    const practiceText = getLocalizedText(userId, 'practiceButton');
    const progressText = getLocalizedText(userId, 'progressButton');
    const weakAreasText = getLocalizedText(userId, 'weakAreasButton');
    const moreOptionsText = getLocalizedText(userId, 'moreOptionsButton');

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: practiceText, callback_data: 'menu_subject_select' }],
                [{ text: progressText, callback_data: 'menu_progress' }],
                [{ text: weakAreasText, callback_data: 'menu_weak_areas' }],
                [{ text: moreOptionsText, callback_data: 'menu_more_options' }]
            ]
        },
        parse_mode: 'Markdown'
    };

    if (messageId) {
        try {
            await bot.editMessageText(introText, {
                chat_id: chatId,
                message_id: messageId,
                ...keyboard,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            await bot.sendMessage(chatId, introText, keyboard);
        }
    } else {
        await bot.sendMessage(chatId, introText, keyboard);
    }
}

// Sends the secondary "More Options" menu
async function sendMoreOptions(chatId, userId, messageId) {
    const t = uiText.en;
    const introText = getLocalizedText(userId, 'moreOptionsButton'); // Using the button text as the title

    // Get localized button texts
    const mockText = getLocalizedText(userId, 'mockButton');
    const leaderboardText = getLocalizedText(userId, 'leaderboardButton');
    const profileText = getLocalizedText(userId, 'profileButton');
    const settingsText = getLocalizedText(userId, 'settingsButton');
    const helpText = getLocalizedText(userId, 'helpButton');
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: mockText, callback_data: 'menu_full_mock' }],
                [{ text: leaderboardText, callback_data: 'menu_leaderboard' }],
                [{ text: profileText, callback_data: 'menu_profile' }],
                [{ text: settingsText, callback_data: 'menu_change_lang' }],
                [{ text: helpText, callback_data: 'menu_help' }],
                [{ text: '🔙 Back to Home', callback_data: 'menu_main_home' }]
            ]
        },
        parse_mode: 'Markdown'
    };

    if (messageId) {
        try {
            await bot.editMessageText(`*${introText}*`, {
                chat_id: chatId,
                message_id: messageId,
                ...keyboard,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            await bot.sendMessage(chatId, `*${introText}*`, keyboard);
        }
    } else {
        await bot.sendMessage(chatId, `*${introText}*`, keyboard);
    }
}


// === Sends the subject selection menu ===
async function sendSubjectMenu(chatId, userId, messageId) {
    const t = uiText.en; // Use English as the primary language for subject names
    const introText = getLocalizedText(userId, 'subjectMenuIntro');
    
    const subjectButtons = Object.entries(AVAILABLE_SUBJECTS).map(([id, subject]) => {
        // Check if full test is paid (or if access is needed)
        const isPaid = !hasAccessToSubject(userId, id, true); 
        const buttonText = `${subject.icon} ${subject.name} ${isPaid ? '🔒' : '✅'}`;
        return [{ text: buttonText, callback_data: `select_subject_${id}` }];
    });

    const keyboard = {
        reply_markup: { 
            inline_keyboard: [
                ...subjectButtons,
                // Back button to Main Menu
                [{ text: '🔙 Back to Home', callback_data: 'menu_main_home' }]
            ] 
        },
        parse_mode: 'Markdown'
    };

    // Try to edit the previous message, if available, otherwise send new
    if (messageId) {
        try {
            await bot.editMessageText(introText, {
                chat_id: chatId,
                message_id: messageId,
                ...keyboard,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            await bot.sendMessage(chatId, introText, keyboard);
        }
    } else {
        await bot.sendMessage(chatId, introText, keyboard);
    }
}


// === Sends the quiz mode selection menu for a SPECIFIC SUBJECT ===
async function sendQuizMenu(chatId, userId, subjectId, messageId) {
    const t = uiText.en;
    const subject = AVAILABLE_SUBJECTS[subjectId];
    if (!subject) return;

    const subjectName = subject.name;
    const introText = getLocalizedText(userId, 'quizMenuIntro').replace('{subjectName}', subjectName);
    
    // Check if the user has bought the full access for this specific subject
    const isSubjectFullAccess = hasAccessToSubject(userId, subjectId, true);
    
    const modeButtons = [
        // Detailed modes usually require full module access
        [{ text: isSubjectFullAccess ? t.modeGrammar : `🔒 ${t.modeGrammar}`, callback_data: isSubjectFullAccess ? `start_quiz_${subjectId}_grammar` : `pitch_subject_${subjectId}` }],
        [{ text: isSubjectFullAccess ? t.modeRC : `🔒 ${t.modeRC}`, callback_data: isSubjectFullAccess ? `start_quiz_${subjectId}_rc` : `pitch_subject_${subjectId}` }],
        [{ text: isSubjectFullAccess ? t.modePedagogy : `🔒 ${t.modePedagogy}`, callback_data: isSubjectFullAccess ? `start_quiz_${subjectId}_pedagogy` : `pitch_subject_${subjectId}` }],
        // Mixed bag is also usually tied to the full content library
        [{ text: isSubjectFullAccess ? t.modeMixed : `🔒 ${t.modeMixed}`, callback_data: isSubjectFullAccess ? `start_quiz_${subjectId}_mixed` : `pitch_subject_${subjectId}` }],
    ];
    
    // Mini Test (always free, but tied to the subject ID)
    modeButtons.push(
        [{ text: t.modeMiniTest, callback_data: `start_test_${subjectId}_mini` }]
    );
    
    // Full Test is only available if access is purchased
    modeButtons.push(
        [{ text: isSubjectFullAccess ? t.modeFullTest : `🔒 ${t.modeFullTest}`, callback_data: isSubjectFullAccess ? `start_test_${subjectId}_full` : `pitch_subject_${subjectId}` }]
    );

    const keyboard = {
        reply_markup: { 
            inline_keyboard: [
                ...modeButtons,
                // Back button to Subject Select
                [{ text: '🔙 Back to Subjects', callback_data: 'menu_subject_select' }] 
            ]
        },
        parse_mode: 'Markdown'
    };

    if (messageId) {
        try {
            await bot.editMessageText(introText, {
                chat_id: chatId,
                message_id: messageId,
                ...keyboard,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            await bot.sendMessage(chatId, introText, keyboard);
        }
    } else {
        await bot.sendMessage(chatId, introText, keyboard);
    }
}


// ================== TELEGRAM HANDLERS (CALLBACKS) ==================

// Handle callback queries (button clicks)
bot.on('callback_query', async (cbq) => {
  const data = cbq.data;
  const chatId = cbq.message.chat.id;
  const userId = cbq.from.id;
  const username = cbq.from.username || 'N/A';
  const msg = cbq.message;
  
  await bot.answerCallbackQuery(cbq.id);

  // ================== ERROR REPORTING ==================
  if (data.startsWith('report_')) {
      const parts = data.split('_');
      const subjectId = parts[1];
      const qIndex = parseInt(parts[2], 10);
      
      const reportedQ = questions[qIndex];
      
      if (ADMIN_ID) {
          const reportMessage = [
              "🚨 *NEW QUESTION ERROR REPORTED*",
              "---",
              `*User:* ${userId} (@${username})`,
              `*Subject:* ${AVAILABLE_SUBJECTS[subjectId].name}`,
              `*Question Index (Global):* ${qIndex}`,
              `*Reported Question:* ${reportedQ.question.substring(0, 100)}...`,
              `*Full Text:* ${reportedQ.question}`,
              "---",
              "Review this question and correct the content file."
          ].join("\n");
          
          await bot.sendMessage(ADMIN_ID, reportMessage, { parse_mode: 'Markdown' });
      }

      const reportSuccessMessage = getLocalizedText(userId, 'errorReported');
      // A small notification that disappears
      await bot.answerCallbackQuery(cbq.id, { text: reportSuccessMessage, show_alert: false }); 
      return;
  }
  
  // ================== LANGUAGE HANDLING ==================
  
  if (data.startsWith('set_lang_')) {
    const lang = data.split('_')[2];
    
    if ((lang === 'kn' || lang === 'ur') && !premiumUsers.has(userId)) {
      const t = uiText[lang];
      await bot.sendMessage(chatId, t.premiumLangPitch, {
        reply_markup: {
          inline_keyboard: [
            [{ text: t.upgradeButton.replace('{subjectName}', 'All Subjects'), callback_data: 'go_premium' }],
            [{ text: t.continueEnglishButton, callback_data: 'set_lang_en' }]
          ]
        },
        parse_mode: 'Markdown'
      });
      return;
    }
    
    setUiLang(userId, lang);
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
    await sendMainMenu(chatId, userId);
    return;
  }
  
  // ================== MAIN MENU NAVIGATION (New Structure) ==================
  
  if (data === 'menu_main_home') {
      await sendMainMenu(chatId, userId, msg.message_id);
      return;
  }

  if (data === 'menu_more_options') {
      await sendMoreOptions(chatId, userId, msg.message_id);
      return;
  }
  
  if (data === 'menu_subject_select') {
      await sendSubjectMenu(chatId, userId, msg.message_id);
      return;
  } 
  
  if (data.startsWith('select_subject_')) {
      const subjectId = data.split('_')[2];
      if (AVAILABLE_SUBJECTS[subjectId]) {
          await sendQuizMenu(chatId, userId, subjectId, msg.message_id);
          return;
      }
  }
  
  // ================== FEATURE PLACEHOLDERS ==================

  if (data === 'menu_progress') {
      // Basic progress tracking for demo
      const lastResult = lastResults[chatId];
      const t = getLocalizedText(userId, 'progressTitle');

      if (!lastResult) {
          bot.sendMessage(chatId, t + "\n" + getLocalizedText(userId, 'progressNoData'), { parse_mode: 'Markdown' });
          return;
      }
      
      const summary = getLocalizedText(userId, 'progressLast')
          .replace('{score}', lastResult.score)
          .replace('{total}', lastResult.total)
          .replace('{percent}', lastResult.percentage.toFixed(0));

      bot.sendMessage(chatId, t + "\n\n" + summary + "\n\n" + getLocalizedText(userId, 'progressImprovement'), { parse_mode: 'Markdown' });
      return;
  }

  if (data === 'menu_weak_areas') {
      const placeholderText = getLocalizedText(userId, 'weakAreasPlaceholder');
      bot.sendMessage(chatId, placeholderText, { parse_mode: 'Markdown' });
      return;
  }
  
  if (data === 'menu_leaderboard') {
      const placeholderText = getLocalizedText(userId, 'leaderboardPlaceholder');
      bot.sendMessage(chatId, placeholderText, { parse_mode: 'Markdown' });
      return;
  }

  if (data === 'menu_profile') {
      const joinDate = '28 Nov 2025'; // Mocked
      const placeholderText = getLocalizedText(userId, 'profilePlaceholder').replace('{joinDate}', joinDate);
      bot.sendMessage(chatId, placeholderText, { parse_mode: 'Markdown' });
      return;
  }

  if (data === 'menu_help') {
      const placeholderText = getLocalizedText(userId, 'helpPlaceholder');
      bot.sendMessage(chatId, placeholderText, { parse_mode: 'Markdown' });
      return;
  }

  if (data === 'menu_full_mock') {
      bot.sendMessage(chatId, "Mock Test is coming soon. We are planning a full-length, timed, weekly test!");
      return;
  }
  
  if (data === 'menu_change_lang') {
      // Re-send the initial language selector menu from the More Options section
      await bot.editMessageText(uiText.en.chooseLanguage, {
        chat_id: chatId,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: uiText.en.langEnglishButton, callback_data: 'set_lang_en' }],
            [{ text: uiText.en.langKannadaButton, callback_data: 'set_lang_kn' }],
            [{ text: uiText.en.langUrduButton, callback_data: 'set_lang_ur' }],
            [{ text: '🔙 Back to More Options', callback_data: 'menu_more_options' }]
          ]
        },
        parse_mode: 'Markdown'
      });
      return;
  }


  // ================== PREMIUM PITCH LOGIC (SUBJECT SPECIFIC) ==================
  
  if (data.startsWith('pitch_subject_')) {
    const subjectId = data.split('_')[2];
    const subjectName = AVAILABLE_SUBJECTS[subjectId]?.name || 'this subject';

    const pitchText = getLocalizedText(userId, 'premiumPitch').replace(/{subjectName}/g, subjectName);
    const upgradeButtonText = getLocalizedText(userId, 'upgradeButton').replace('{subjectName}', subjectName);
    const continueFreeButtonText = getLocalizedText(userId, 'continueFreeButton');
    
    await bot.editMessageText(pitchText, {
        chat_id: chatId,
        message_id: msg.message_id,
        reply_markup: {
            inline_keyboard: [
                [{ text: upgradeButtonText, callback_data: `start_payment_${subjectId}` }], // Trigger payment flow
                [{ text: continueFreeButtonText, callback_data: `start_test_${subjectId}_mini` }] // Back to free mini test
            ]
        },
        parse_mode: 'Markdown'
    });
    return;
  }
  
  // ================== QUIZ START ==================
  
  if (data.startsWith('start_test_') || data.startsWith('start_quiz_')) {
    const parts = data.split('_');
    const subjectId = parts[2];
    const mode = parts[3]; // 'mini', 'full', 'grammar', 'rc', 'pedagogy', 'mixed'

    let testSize;
    let isFullTest = false;
    
    if (mode === 'mini') {
        testSize = MINI_TEST_SIZE;
        // Check for daily limit in a real app (requires DB tracking of daily free tests)
        // Currently skipping limit check for demo
    } else if (mode === 'full') {
        testSize = 15; // Mock full test size
        isFullTest = true;
    } else {
        // Detailed modes (grammar, rc, pedagogy, mixed) - full size
        testSize = 15;
        isFullTest = true;
    }

    // Double check access if it's a paid mode
    if (isFullTest && !hasAccessToSubject(userId, subjectId, true)) {
        await bot.answerCallbackQuery(cbq.id, { 
            text: `Access Denied. Please purchase the ${AVAILABLE_SUBJECTS[subjectId].name} module.`, 
            show_alert: true 
        });
        // Reroute back to pitch page
        await sendQuizMenu(chatId, userId, subjectId, msg.message_id);
        return;
    }

    // 1. Create Question Pool
    const pool = createQuestionPool(testSize, subjectId, mode);

    if (pool.length === 0) {
        await bot.sendMessage(chatId, `Sorry, no questions found for *${AVAILABLE_SUBJECTS[subjectId].name}* in *${mode}* mode.`, { parse_mode: 'Markdown' });
        return;
    }

    // 2. Initialize Session
    sessions[chatId] = {
      questionsPool: pool,
      currentIndex: 0,
      score: 0,
      subjectId: subjectId,
      startTime: Date.now(),
      userId: userId,
      messageId: msg.message_id // Use the menu message to display the first question
    };

    // 3. Start Test
    await sendQuestion(chatId);
    return;
  }

  // ================== QUIZ ANSWER ==================

  if (data.startsWith('ans_')) {
    const parts = data.split('_');
    const subjectId = parts[1];
    const qIndex = parseInt(parts[2], 10); // Global Question Index
    const chosenIndex = parseInt(parts[3], 10);

    const session = sessions[chatId];
    if (!session || questions[qIndex] === undefined) {
      await bot.answerCallbackQuery(cbq.id, { text: "Session error. Please start a new test.", show_alert: true });
      return;
    }
    
    // Check if the current question being answered is actually the one visible
    const expectedQIndex = session.questionsPool[session.currentIndex]?.qIndex;
    if (qIndex !== expectedQIndex) {
        // User clicked an old button, ignore silently or give a quick message
        await bot.answerCallbackQuery(cbq.id, { text: "Please answer the current question only.", show_alert: false });
        return;
    }

    const q = questions[qIndex];
    const isCorrect = chosenIndex === q.correctIndex;
    
    // 1. Update Score and Answers (Crucial for DB persistence later)
    if (isCorrect) session.score++;
    
    // NOTE: This array push is incomplete without full session management in DB
    // session.answers.push({
    //   qIndex,
    //   chosen: chosenIndex,
    //   correctIndex: q.correctIndex,
    //   correct: isCorrect,
    // });

    // 2. Provide Quick Feedback
    const reaction = isCorrect
      ? correctReactions[Math.floor(Math.random() * correctReactions.length)]
      : wrongReactions[Math.floor(Math.random() * wrongReactions.length)];

    await bot.answerCallbackQuery(cbq.id, {
      text: isCorrect ? `Correct! ${reaction}` : `Wrong… ${reaction}`,
      show_alert: false,
    });

    // 3. Move to next question or end test
    session.currentIndex++;

    if (session.currentIndex < session.questionsPool.length) {
      // Small delay to ensure the answer feedback registers before the message update
      setTimeout(() => sendQuestion(chatId), 50); 
    } else {
      sendResult(chatId);
    }
    return;
  }

});
