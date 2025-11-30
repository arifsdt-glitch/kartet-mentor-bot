// ═══════════════════════════════════════════════════════════════════════
// NAMMA KARTET ENGLISH MENTOR - Your Personal Teaching Companion
// "Not just a bot, but your patient teacher who never gives up on you"
// ═══════════════════════════════════════════════════════════════════════

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════════════
// DATABASE & PERSISTENCE LAYER
// ═══════════════════════════════════════════════════════════════════════

const DB_DIR = "./data";
const DB_FILE = path.join(DB_DIR, "botdb.json");
const BACKUP_DIR = path.join(DB_DIR, "backups");

let db = {
  version: "2.0",
  users: {},
  wrongBank: {},
  lastBackup: null,
  dailyStats: {}, // Track daily engagement
};

let isDirty = false;
let saveQueue = Promise.resolve();

// Initialize database
async function initDatabase() {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
    await fs.mkdir(BACKUP_DIR, { recursive: true });

    try {
      const raw = await fs.readFile(DB_FILE, "utf8");
      const parsed = JSON.parse(raw);

      if (!parsed.version || parsed.version === "1.0") {
        db = migrateFromV1(parsed);
        await saveDatabase();
        console.log("✅ Migrated database to v2.0");
      } else {
        db = parsed;
      }
    } catch (err) {
      if (err.code === "ENOENT") {
        console.log("ℹ️ Starting fresh database");
        await saveDatabase();
      } else {
        throw err;
      }
    }

    scheduleDailyBackup();
    console.log("✅ Database ready");
  } catch (err) {
    console.error("❌ Database init failed:", err);
    throw err;
  }
}

function migrateFromV1(oldData) {
  const newDb = {
    version: "2.0",
    users: {},
    wrongBank: oldData.wrongBank || {},
    lastBackup: null,
    dailyStats: {},
  };

  Object.entries(oldData.streaks || {}).forEach(([userId, streak]) => {
    if (!newDb.users[userId]) {
      newDb.users[userId] = { streaks: streak };
    }
  });

  return newDb;
}

async function saveDatabase() {
  if (!isDirty) return;

  saveQueue = saveQueue.then(async () => {
    try {
      const tempFile = DB_FILE + ".tmp";
      await fs.writeFile(tempFile, JSON.stringify(db, null, 2));
      await fs.rename(tempFile, DB_FILE);
      isDirty = false;
      console.log("💾 Saved");
    } catch (err) {
      console.error("❌ Save error:", err);
    }
  });

  return saveQueue;
}

// Auto-save every 30 seconds
setInterval(() => {
  if (isDirty) saveDatabase().catch(console.error);
}, 30000);

async function createBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, "-").split('.')[0];
    const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.json`);

    await fs.copyFile(DB_FILE, backupFile);

    // Keep only last 7 backups
    const files = await fs.readdir(BACKUP_DIR);
    const backups = files.filter(f => f.startsWith("backup_"));

    if (backups.length > 7) {
      backups.sort();
      for (const old of backups.slice(0, backups.length - 7)) {
        await fs.unlink(path.join(BACKUP_DIR, old));
      }
    }

    db.lastBackup = new Date().toISOString();
    console.log(`✅ Backup: ${backupFile}`);
  } catch (err) {
    console.error("❌ Backup error:", err);
  }
}

function scheduleDailyBackup() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(3, 0, 0, 0);

  setTimeout(() => {
    createBackup();
    scheduleDailyBackup();
  }, tomorrow - now);
}

function getUserData(userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      streaks: {
        currentStreak: 0,
        lastTestDate: null,
        bestStreak: 0,
      },
      prefs: {
        lang: "en",
        eng2Mode: "mixed",
        reminderTime: null, // User's preferred practice time
        showEncouragement: true,
      },
      stats: {
        attempts: 0,
        bestScore: 0,
        lastScore: 0,
        totalQuestionsAttempted: 0,
        totalCorrect: 0,
        lastFreeDate: null,
        freeTestsToday: 0,
      },
      personality: {
        // Adaptive personality traits learned over time
        respondsToEncouragement: true,
        needsDetailedExplanations: false,
        prefersShortSessions: false,
      },
      badges: [],
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };
    isDirty = true;
  }
  return db.users[userId];
}

function updateUserData(userId, updates) {
  const user = getUserData(userId);
  Object.entries(updates).forEach(([key, value]) => {
    if (typeof value === "object" && !Array.isArray(value) && user[key]) {
      user[key] = { ...user[key], ...value };
    } else {
      user[key] = value;
    }
  });
  user.lastActive = new Date().toISOString();
  isDirty = true;
}

function getWrongBank(userId) {
  if (!db.wrongBank[userId]) {
    db.wrongBank[userId] = [];
  }
  return new Set(db.wrongBank[userId]);
}

function updateWrongBank(userId, questionIds) {
  db.wrongBank[userId] = Array.from(new Set([
    ...(db.wrongBank[userId] || []),
    ...questionIds,
  ]));
  isDirty = true;
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIG & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

const questions = require("./eng_questions.json");

const premiumUsers = new Set([
  437248254,
  // Add more premium user IDs
]);

function isPremiumUser(userId) {
  return premiumUsers.has(userId);
}

const FREE_DAILY_MINI_TESTS = 1;
const MINI_TEST_SIZE = 5;

const CORRECT_SOUND_FILE_ID = "";
const WRONG_SOUND_FILE_ID = "";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.on("polling_error", (err) => {
  console.error("❌ Polling error:", err.message || err);
});

// ═══════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

const UserState = {
  IDLE: 'idle',
  CHOOSING_LANGUAGE: 'choosing_language',
  CHOOSING_MODE: 'choosing_mode',
  IN_TEST: 'in_test',
  VIEWING_RESULTS: 'viewing_results',
};

const sessions = {};
const lastResults = {};
const mainResults = {};
const userContext = {};
const activeInlineMessages = {};

function getUserState(userId) {
  return userContext[userId]?.state || UserState.IDLE;
}

function setUserState(userId, state, data = {}) {
  userContext[userId] = {
    state,
    timestamp: Date.now(),
    ...data
  };
}

function clearUserState(userId) {
  delete userContext[userId];
}

async function clearAllInlineKeyboards(chatId) {
  const msgIds = activeInlineMessages[chatId] || [];

  await Promise.all(msgIds.map(msgId => 
    bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: msgId }
    ).catch(() => {})
  ));

  activeInlineMessages[chatId] = [];
}

function trackInlineMessage(chatId, msgId) {
  if (!activeInlineMessages[chatId]) {
    activeInlineMessages[chatId] = [];
  }
  activeInlineMessages[chatId].push(msgId);

  if (activeInlineMessages[chatId].length > 10) {
    activeInlineMessages[chatId].shift();
  }
}

async function sendWithInlineKeyboard(chatId, text, options = {}) {
  const sentMsg = await bot.sendMessage(chatId, text, options);
  if (options.reply_markup?.inline_keyboard) {
    trackInlineMessage(chatId, sentMsg.message_id);
  }
  return sentMsg;
}

function isCallbackValid(callbackQuery, expectedState = null) {
  const userId = callbackQuery.from.id;
  const messageDate = callbackQuery.message.date * 1000;
  const now = Date.now();

  if (now - messageDate > 5 * 60 * 1000) return false;

  if (expectedState && getUserState(userId) !== expectedState) {
    return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// MULTILINGUAL UI - THE HEART OF PERSONAL CONNECTION
// ═══════════════════════════════════════════════════════════════════════

const uiText = {
  en: {
    langName: "English",

    // Warm, personal greetings
    startGreeting: "🙏 Welcome, my dear student!\n\nI'm not just a bot—I'm your *personal English mentor* for KARTET.",
    startSub: "First, let's talk in a language you're most comfortable with.\n\n_Questions will be in English (just like the real exam), but I'll guide you in your language._",
    chooseLanguage: "Which language feels like home to you?",

    langEnglishButton: "🇬🇧 English",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    welcomeMain: "I'm here for you, every single day. 💙\n\nTogether, we'll master *English Language II* through small, consistent steps.\n\nNo rush. No pressure. Just steady progress.",

    // Compassionate main menu
    todaysPracticeButton: "🎯 Today's Practice",
    myProgressButton: "📊 My Journey",
    myWeakAreasButton: "🔍 Areas to Focus",
    moreOptionsButton: "📂 More",

    mainMenuIntro: "What would you like to do today?",

    // Premium language pitch (warm, not pushy)
    premiumLangPitch:
      "🌟 *Learning in Your Mother Tongue*\n\n" +
      "I see you prefer Kannada/Urdu. I respect that deeply.\n\n" +
      "Mentor+ lets me explain everything in your language—like a real teacher sitting beside you.\n\n" +
      "*What Mentor+ gives you:*\n" +
      "• Unlimited practice (no daily limits)\n" +
      "• Full explanations in Kannada/Urdu\n" +
      "• Detailed topic analysis\n" +
      "• One-on-one doubt clearing\n\n" +
      "But here's the truth: Even in English, I'll help you succeed. Many teachers have cleared KARTET with me using the free plan.\n\n" +
      "The choice is yours. I'm here either way. 💙",

    upgradeButton: "⭐ Explore Mentor+",
    continueEnglishButton: "➡️ Continue in English",

    // Results messages
    testFinished: "✅ *You completed the test!*",
    summaryHeading: "📊 *Let's see how you did*",
    scoreLabel: "Score",
    attemptedLabel: "Attempted",
    skippedLabel: "Skipped",
    wrongLabel: "Wrong",
    accuracyLabel: "Accuracy",

    topicPerfTitle: "📚 *Topic-wise Performance*",
    weakTopicsTitle: "🎯 *Topics That Need Your Love*",
    rightAnswersTitle: "✅ *Questions You Got Right*",
    wrongAnswersTitle: "💡 *Learning from Mistakes*",
    wrongPreviewTitle: "👀 *Quick Look at Mistakes*",

    noTopicsYet: "Not enough data yet. Take a few more tests, and I'll map your strengths.",
    noWeakTopics: "Honestly? You're doing great across all topics. Keep this level! 🌟",
    noWrongAnswers: "✅ Perfect score!\n\nYou're exam-ready in this area. Beautiful work! 🎉",
    noRightAnswers: "This was a tough one, I know.\n\nBut here's what I've learned about you: You show up. And that's what matters most.\n\nLet's review the concepts together.",

    wrongRetakeStart: "Starting a focused session with your previous mistakes.\n\nThis is how champions are built—by facing what's hard. 💪",
    wrongRetakePerfect: "You got everything right last time!\n\nNo wrong-only retake needed. You're on fire! 🔥",

    freeLimitReached:
      "⏰ *Today's free practice is complete*\n\n" +
      `You've used your ${MINI_TEST_SIZE}-question practice for today.\n\n` +
      "Here's what I want you to know:\n" +
      "• Even 5 questions daily = 150 questions/month\n" +
      "• Consistency beats intensity, always\n" +
      "• Many teachers clear KARTET with just the free plan\n\n" +
      "Come back tomorrow. I'll be here, same time, same dedication. 💙",

    // Encouragement messages
    comebackMessage: "You're back! I was hoping to see you today. 😊",
    streakBreakMessage: "I noticed you missed yesterday.\n\nThat's completely okay. Life happens.\n\nWhat matters is that you're here now. Let's begin fresh. 🌅",
    firstTestEver: "This is your very first test with me.\n\nRemember: Everyone starts somewhere.\n\nThere's no wrong score today—only a starting point. 💙",
  },

  kn: {
    langName: "ಕನ್ನಡ",

    startGreeting: "🙏 ನಮಸ್ಕಾರ, ನನ್ನ ಪ್ರೀತಿಯ ವಿದ್ಯಾರ್ಥಿ!\n\nನಾನು ಕೇವಲ ಬಾಟ್ ಅಲ್ಲ—ನಾನು ನಿಮ್ಮ *ವೈಯಕ್ತಿಕ English mentor* KARTET ಗಾಗಿ.",
    startSub: "ಮೊದಲು, ನಿಮಗೆ ಹೆಚ್ಚು ಆರಾಮದಾಯಕವಾದ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡೋಣ.\n\n_ಪ್ರಶ್ನೆಗಳು English ನಲ್ಲಿಯೇ ಇರುತ್ತವೆ (ನಿಜವಾದ ಪರೀಕ್ಷೆಯಂತೆ), ಆದರೆ ನಾನು ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಮಾರ್ಗದರ್ಶನ ನೀಡುತ್ತೇನೆ._",
    chooseLanguage: "ನಿಮಗೆ ಮನೆಯಂತೆ ಅನಿಸುವ ಭಾಷೆ ಯಾವುದು?",

    langEnglishButton: "🇬🇧 English",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    welcomeMain: "ನಾನು ಪ್ರತಿದಿನ ನಿಮ್ಮೊಂದಿಗಿದ್ದೇನೆ. 💙\n\nಸಣ್ಣ, ಸ್ಥಿರವಾದ ಹೆಜ್ಜೆಗಳ ಮೂಲಕ ನಾವು *English Language II* ನಲ್ಲಿ ಪರಿಣತರಾಗುತ್ತೇವೆ.\n\nಯಾವುದೇ ಆತುರವಿಲ್ಲ. ಯಾವುದೇ ಒತ್ತಡವಿಲ್ಲ. ಕೇವಲ ಸ್ಥಿರ ಪ್ರಗತಿ.",

    todaysPracticeButton: "🎯 ಇಂದಿನ ಅಭ್ಯಾಸ",
    myProgressButton: "📊 ನನ್ನ ಪ್ರಯಾಣ",
    myWeakAreasButton: "🔍 ಗಮನ ಕೇಂದ್ರೀಕರಿಸಬೇಕಾದ ವಿಷಯಗಳು",
    moreOptionsButton: "📂 ಇನ್ನಷ್ಟು",

    mainMenuIntro: "ಇಂದು ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?",

    premiumLangPitch:
      "🌟 *ನಿಮ್ಮ ಮಾತೃಭಾಷೆಯಲ್ಲಿ ಕಲಿಕೆ*\n\n" +
      "ನೀವು ಕನ್ನಡವನ್ನು ಆದ್ಯತೆ ನೀಡುತ್ತೀರಿ ಎಂದು ನಾನು ನೋಡುತ್ತೇನೆ. ನಾನು ಅದನ್ನು ಆಳವಾಗಿ ಗೌರವಿಸುತ್ತೇನೆ.\n\n" +
      "Mentor+ ನನಗೆ ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಎಲ್ಲವನ್ನೂ ವಿವರಿಸಲು ಅನುವು ಮಾಡಿಕೊಡುತ್ತದೆ—ನಿಮ್ಮ ಪಕ್ಕದಲ್ಲಿ ಕುಳಿತಿರುವ ನಿಜವಾದ ಶಿಕ್ಷಕರಂತೆ.\n\n" +
      "*Mentor+ ನಿಮಗೆ ನೀಡುವುದು:*\n" +
      "• ಅನಿಯಮಿತ ಅಭ್ಯಾಸ (ದೈನಂದಿನ ಮಿತಿಗಳಿಲ್ಲ)\n" +
      "• ಕನ್ನಡದಲ್ಲಿ ಸಂಪೂರ್ಣ ವಿವರಣೆಗಳು\n" +
      "• ವಿವರವಾದ ವಿಷಯ ವಿಶ್ಲೇಷಣೆ\n" +
      "• ಒಬ್ಬರಿಗೊಬ್ಬರು ಸಂದೇಹ ನಿವಾರಣೆ\n\n" +
      "ಆದರೆ ಇಲ್ಲಿ ಸತ್ಯ: English ನಲ್ಲಿಯೂ ಸಹ, ನಾನು ನಿಮಗೆ ಯಶಸ್ವಿಯಾಗಲು ಸಹಾಯ ಮಾಡುತ್ತೇನೆ. ಅನೇಕ ಶಿಕ್ಷಕರು free plan ಬಳಸಿ ನನ್ನೊಂದಿಗೆ KARTET ಪಾಸ್ ಮಾಡಿದ್ದಾರೆ.\n\n" +
      "ಆಯ್ಕೆ ನಿಮ್ಮದು. ಯಾವುದೇ ರೀತಿಯಲ್ಲಿ ನಾನು ಇಲ್ಲಿದ್ದೇನೆ. 💙",

    upgradeButton: "⭐ Mentor+ ಅನ್ವೇಷಿಸಿ",
    continueEnglishButton: "➡️ English ನಲ್ಲಿ ಮುಂದುವರಿಸಿ",

    testFinished: "✅ *ನೀವು ಪರೀಕ್ಷೆಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಿದ್ದೀರಿ!*",
    summaryHeading: "📊 *ನೀವು ಹೇಗೆ ಮಾಡಿದ್ದೀರಿ ಎಂದು ನೋಡೋಣ*",
    scoreLabel: "ಅಂಕ",
    attemptedLabel: "ಪ್ರಯತ್ನಿಸಿದ",
    skippedLabel: "ಬಿಟ್ಟುಹೋದ",
    wrongLabel: "ತಪ್ಪು",
    accuracyLabel: "ನಿಖರತೆ",

    topicPerfTitle: "📚 *ವಿಷಯಾನುಸಾರ ಕಾರ್ಯಕ್ಷಮತೆ*",
    weakTopicsTitle: "🎯 *ನಿಮ್ಮ ಪ್ರೀತಿಯ ಅಗತ್ಯವಿರುವ ವಿಷಯಗಳು*",
    rightAnswersTitle: "✅ *ನೀವು ಸರಿಯಾಗಿ ಪಡೆದ ಪ್ರಶ್ನೆಗಳು*",
    wrongAnswersTitle: "💡 *ತಪ್ಪುಗಳಿಂದ ಕಲಿಕೆ*",
    wrongPreviewTitle: "👀 *ತಪ್ಪುಗಳ ತ್ವರಿತ ನೋಟ*",

    noTopicsYet: "ಇನ್ನೂ ಸಾಕಷ್ಟು ಡೇಟಾ ಇಲ್ಲ. ಇನ್ನೂ ಕೆಲವು ಪರೀಕ್ಷೆಗಳನ್ನು ತೆಗೆದುಕೊಳ್ಳಿ, ಮತ್ತು ನಾನು ನಿಮ್ಮ ಸಾಮರ್ಥ್ಯಗಳನ್ನು ನಕ್ಷೆ ಮಾಡುತ್ತೇನೆ.",
    noWeakTopics: "ಪ್ರಾಮಾಣಿಕವಾಗಿ? ನೀವು ಎಲ್ಲಾ ವಿಷಯಗಳಲ್ಲೂ ಉತ್ತಮವಾಗಿ ಮಾಡುತ್ತಿದ್ದೀರಿ. ಈ ಮಟ್ಟವನ್ನು ಉಳಿಸಿಕೊಳ್ಳಿ! 🌟",
    noWrongAnswers: "✅ ಪರಿಪೂರ್ಣ ಸ್ಕೋರ್!\n\nಈ ಪ್ರದೇಶದಲ್ಲಿ ನೀವು ಪರೀಕ್ಷೆಗೆ ಸಿದ್ಧರಾಗಿದ್ದೀರಿ. ಸುಂದರ ಕೆಲಸ! 🎉",
    noRightAnswers: "ಇದು ಕಠಿಣವಾಗಿತ್ತು, ನನಗೆ ಗೊತ್ತು.\n\nಆದರೆ ನಾನು ನಿಮ್ಮ ಬಗ್ಗೆ ಕಲಿತದ್ದು: ನೀವು ಹಾಜರಾಗುತ್ತೀರಿ. ಮತ್ತು ಅದು ಅತ್ಯಂತ ಮುಖ್ಯವಾದುದು.\n\nಪರಿಕಲ್ಪನೆಗಳನ್ನು ಒಟ್ಟಿಗೆ ಪರಿಶೀಲಿಸೋಣ.",

    wrongRetakeStart: "ನಿಮ್ಮ ಹಿಂದಿನ ತಪ್ಪುಗಳೊಂದಿಗೆ ಕೇಂದ್ರೀಕೃತ ಅಧಿವೇಶನವನ್ನು ಪ್ರಾರಂಭಿಸುತ್ತಿದೆ.\n\nಇದು ಚಾಂಪಿಯನ್‌ಗಳು ಹೇಗೆ ನಿರ್ಮಾಣವಾಗುತ್ತಾರೆ—ಕಷ್ಟಕರವಾದುದನ್ನು ಎದುರಿಸುವ ಮೂಲಕ. 💪",
    wrongRetakePerfect: "ಕೊನೆಯ ಬಾರಿ ನೀವು ಎಲ್ಲವನ್ನೂ ಸರಿಯಾಗಿ ಪಡೆದಿದ್ದೀರಿ!\n\nತಪ್ಪು-ಮಾತ್ರ retake ಅಗತ್ಯವಿಲ್ಲ. ನೀವು ಬೆಂಕಿಯಲ್ಲಿದ್ದೀರಿ! 🔥",


freeLimitReached:
      "⏰ *ಇಂದಿನ ಉಚಿತ ಅಭ್ಯಾಸ ಪೂರ್ಣಗೊಂಡಿದೆ*\n\n" +
      `ನೀವು ಇಂದಿನ ${MINI_TEST_SIZE}-ಪ್ರಶ್ನೆ ಅಭ್ಯಾಸವನ್ನು ಬಳಸಿದ್ದೀರಿ.\n\n` +
      "ನಾನು ನಿಮಗೆ ತಿಳಿಸಲು ಬಯಸುವುದು:\n" +
      "• ಪ್ರತಿದಿನ 5 ಪ್ರಶ್ನೆಗಳು = ತಿಂಗಳಿಗೆ 150 ಪ್ರಶ್ನೆಗಳು\n" +
      "• ಸ್ಥಿರತೆ ತೀವ್ರತೆಯನ್ನು ಸೋಲಿಸುತ್ತದೆ, ಯಾವಾಗಲೂ\n" +
      "• ಅನೇಕ ಶಿಕ್ಷಕರು ಕೇವಲ free plan ನೊಂದಿಗೆ KARTET ಪಾಸ್ ಮಾಡುತ್ತಾರೆ\n\n" +
      "ನಾಳೆ ಹಿಂತಿರುಗಿ. ನಾನು ಇಲ್ಲಿರುತ್ತೇನೆ, ಅದೇ ಸಮಯ, ಅದೇ ಸಮರ್ಪಣೆ. 💙",

    comebackMessage: "ನೀವು ಹಿಂತಿರುಗಿದ್ದೀರಿ! ನಾನು ಇಂದು ನಿಮ್ಮನ್ನು ನೋಡಲು ಆಶಿಸುತ್ತಿದ್ದೆ. 😊",
    streakBreakMessage: "ನೀವು ನಿನ್ನೆ ತಪ್ಪಿಸಿಕೊಂಡಿದ್ದೀರಿ ಎಂದು ನಾನು ಗಮನಿಸಿದೆ.\n\nಅದು ಸಂಪೂರ್ಣವಾಗಿ ಸರಿ. ಜೀವನ ನಡೆಯುತ್ತದೆ.\n\nಮುಖ್ಯವಾದದ್ದು ನೀವು ಈಗ ಇಲ್ಲಿದ್ದೀರಿ. ತಾಜಾವಾಗಿ ಪ್ರಾರಂಭಿಸೋಣ. 🌅",
    firstTestEver: "ಇದು ನನ್ನೊಂದಿಗೆ ನಿಮ್ಮ ಮೊದಲ ಪರೀಕ್ಷೆ.\n\nನೆನಪಿಡಿ: ಪ್ರತಿಯೊಬ್ಬರೂ ಎಲ್ಲೋ ಪ್ರಾರಂಭಿಸುತ್ತಾರೆ.\n\nಇಂದು ಯಾವುದೇ ತಪ್ಪು ಸ್ಕೋರ್ ಇಲ್ಲ—ಕೇವಲ ಆರಂಭಿಕ ಬಿಂದು. 💙",
  },

  ur: {
    langName: "اردو",

    startGreeting: "🙏 خوش آمدید، میرے پیارے طالب علم!\n\nمیں صرف ایک بوٹ نہیں—میں آپ کا *ذاتی English mentor* ہوں KARTET کے لیے.",
    startSub: "پہلے، آئیں اس زبان میں بات کریں جو آپ کو سب سے زیادہ آرام دہ لگے.\n\n_سوالات English میں ہوں گے (اصل امتحان کی طرح), لیکن میں آپ کی زبان میں رہنمائی کروں گا._",
    chooseLanguage: "کون سی زبان آپ کو گھر جیسی محسوس ہوتی ہے؟",

    langEnglishButton: "🇬🇧 English",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    welcomeMain: "میں ہر روز آپ کے ساتھ ہوں. 💙\n\nچھوٹے، مستقل قدموں کے ذریعے ہم *English Language II* میں ماہر بن جائیں گے.\n\nکوئی جلدی نہیں. کوئی دباؤ نہیں. بس مستقل ترقی.",

    todaysPracticeButton: "🎯 آج کی مشق",
    myProgressButton: "📊 میرا سفر",
    myWeakAreasButton: "🔍 توجہ کے شعبے",
    moreOptionsButton: "📂 مزید",

    mainMenuIntro: "آج آپ کیا کرنا چاہیں گے؟",

    premiumLangPitch:
      "🌟 *اپنی مادری زبان میں سیکھنا*\n\n" +
      "میں دیکھتا ہوں کہ آپ اردو کو ترجیح دیتے ہیں. میں اس کی گہرائی سے عزت کرتا ہوں.\n\n" +
      "Mentor+ مجھے آپ کی زبان میں سب کچھ سمجھانے دیتا ہے—آپ کے پاس بیٹھے ایک حقیقی استاد کی طرح.\n\n" +
      "*Mentor+ آپ کو کیا دیتا ہے:*\n" +
      "• لامحدود مشق (کوئی روزانہ کی حد نہیں)\n" +
      "• اردو میں مکمل وضاحتیں\n" +
      "• تفصیلی موضوع کا تجزیہ\n" +
      "• ایک سے ایک شک و شبہ کا ازالہ\n\n" +
      "لیکن یہاں سچ ہے: English میں بھی، میں آپ کو کامیاب ہونے میں مدد کروں گا. بہت سے اساتذہ نے free plan استعمال کرتے ہوئے میرے ساتھ KARTET پاس کیا ہے.\n\n" +
      "انتخاب آپ کا ہے. میں کسی بھی طرح یہاں ہوں. 💙",

    upgradeButton: "⭐ Mentor+ دریافت کریں",
    continueEnglishButton: "➡️ English میں جاری رکھیں",

    testFinished: "✅ *آپ نے ٹیسٹ مکمل کر لیا!*",
    summaryHeading: "📊 *دیکھیں آپ نے کیسے کیا*",
    scoreLabel: "سکور",
    attemptedLabel: "کوشش کی",
    skippedLabel: "چھوڑ دیا",
    wrongLabel: "غلط",
    accuracyLabel: "درستگی",

    topicPerfTitle: "📚 *موضوع کے لحاظ سے کارکردگی*",
    weakTopicsTitle: "🎯 *وہ موضوعات جنہیں آپ کی محبت کی ضرورت ہے*",
    rightAnswersTitle: "✅ *سوالات جو آپ نے صحیح کیے*",
    wrongAnswersTitle: "💡 *غلطیوں سے سیکھنا*",
    wrongPreviewTitle: "👀 *غلطیوں کی فوری جھلک*",

    noTopicsYet: "ابھی تک کافی ڈیٹا نہیں. کچھ مزید ٹیسٹ لیں، اور میں آپ کی طاقتوں کا نقشہ بناؤں گا.",
    noWeakTopics: "ایمانداری سے؟ آپ تمام موضوعات میں بہترین کر رہے ہیں. یہ سطح برقرار رکھیں! 🌟",
    noWrongAnswers: "✅ کامل سکور!\n\nآپ اس علاقے میں امتحان کے لیے تیار ہیں. خوبصورت کام! 🎉",
    noRightAnswers: "یہ مشکل تھا، مجھے معلوم ہے.\n\nلیکن یہاں میں نے آپ کے بارے میں کیا سیکھا: آپ حاضر ہوتے ہیں. اور یہی سب سے اہم ہے.\n\nآئیں تصورات کا ایک ساتھ جائزہ لیں.",

    wrongRetakeStart: "آپ کی پچھلی غلطیوں کے ساتھ ایک مرکوز سیشن شروع کر رہا ہوں.\n\nیہ ہے کہ چیمپئنز کیسے بنتے ہیں—مشکل کا سامنا کرکے. 💪",
    wrongRetakePerfect: "آپ نے آخری بار سب کچھ صحیح کیا!\n\nغلط صرف دوبارہ کوشش کی ضرورت نہیں. آپ آگ میں ہیں! 🔥",

    freeLimitReached:
      "⏰ *آج کی مفت مشق مکمل ہو گئی*\n\n" +
      `آپ نے آج کی ${MINI_TEST_SIZE}-سوالات مشق استعمال کر لی ہے.\n\n` +
      "یہاں وہ ہے جو میں آپ کو جاننا چاہتا ہوں:\n" +
      "• روزانہ 5 سوالات = مہینے میں 150 سوالات\n" +
      "• مستقل مزاجی شدت کو ہرا دیتی ہے، ہمیشہ\n" +
      "• بہت سے اساتذہ صرف free plan کے ساتھ KARTET پاس کرتے ہیں\n\n" +
      "کل واپس آئیں. میں یہاں ہوں گا، وہی وقت، وہی لگن. 💙",

    comebackMessage: "آپ واپس آ گئے! میں آج آپ کو دیکھنے کی امید کر رہا تھا. 😊",
    streakBreakMessage: "میں نے محسوس کیا کہ آپ کل نہیں آئے.\n\nیہ بالکل ٹھیک ہے. زندگی چلتی ہے.\n\nاہم بات یہ ہے کہ آپ اب یہاں ہیں. آئیں تازہ شروع کریں. 🌅",
    firstTestEver: "یہ میرے ساتھ آپ کا پہلا ٹیسٹ ہے.\n\nیاد رکھیں: ہر کوئی کہیں سے شروع کرتا ہے.\n\nآج کوئی غلط سکور نہیں—صرف ایک نقطہ آغاز. 💙",
  },
};

// ═══════════════════════════════════════════════════════════════════════
// ADAPTIVE MOTIVATION - THE PSYCHOLOGY ENGINE
// ═══════════════════════════════════════════════════════════════════════

const motivation = {
  en: {
    perfect: [
      "You're absolutely exam-ready. This level of mastery? It's rare. 🎯",
      "Outstanding! The hard work is showing. You should feel proud right now.",
      "Perfect score! You know what this means? You're not just preparing—you're excelling.",
    ],
    good: [
      "Solid work today. You're building exactly what you need: confidence + competence.",
      "Good progress! A few more focused sessions and you'll be unstoppable.",
      "You're on the right path. Every question you get right is teaching your brain the pattern.",
    ],
    medium: [
      "This is where real learning happens—in the middle, where you're figuring things out.",
      "50-60% is not failure. It's honest feedback. And honest feedback is gold for improvement.",
      "You showed up. You tried. That's the foundation of every success story.",
    ],
    low: [
      "Tough day, I know. But here's what matters: You finished. Many would have quit.",
      "Low scores today don't define your potential. They show you exactly what to focus on tomorrow.",
      "Every expert was once at this stage. The difference? They kept going. Just like you're doing now.",
    ],
    veryLow: [
      "I see you're struggling, and I want you to know: that's okay. Learning is messy.",
      "This is hard right now. But 'hard' doesn't mean 'impossible'. It means 'not yet'.",
      "You took the test when it would've been easier to avoid it. That takes courage. Real courage.",
    ],
  },
  kn: {
    perfect: [
      "ನೀವು ಸಂಪೂರ್ಣವಾಗಿ ಪರೀಕ್ಷೆಗೆ ಸಿದ್ಧರಾಗಿದ್ದೀರಿ. ಈ ಮಟ್ಟದ ಪಾಂಡಿತ್ಯ? ಇದು ಅಪರೂಪ. 🎯",
      "ಅದ್ಭುತ! ಕಠಿಣ ಪರಿಶ್ರಮ ತೋರಿಸುತ್ತಿದೆ. ನೀವು ಈಗ ಹೆಮ್ಮೆಪಡಬೇಕು.",
      "ಪರಿಪೂರ್ಣ ಸ್ಕೋರ್! ಇದರ ಅರ್ಥವೇನೆಂದರೆ? ನೀವು ಕೇವಲ ತಯಾರಿ ಮಾಡುತ್ತಿಲ್ಲ—ನೀವು ಉತ್ಕೃಷ್ಟರಾಗಿದ್ದೀರಿ.",
    ],
    good: [
      "ಇಂದು ದೃಢವಾದ ಕೆಲಸ. ನಿಮಗೆ ಅಗತ್ಯವಿರುವುದನ್ನು ನೀವು ನಿರ್ಮಿಸುತ್ತಿದ್ದೀರಿ: ವಿಶ್ವಾಸ + ಸಾಮರ್ಥ್ಯ.",
      "ಉತ್ತಮ ಪ್ರಗತಿ! ಇನ್ನೂ ಕೆಲವು ಕೇಂದ್ರೀಕೃತ ಅಧಿವೇಶನಗಳು ಮತ್ತು ನೀವು ತಡೆಯಲಾಗದವರಾಗಿರುತ್ತೀರಿ.",
      "ನೀವು ಸರಿಯಾದ ಮಾರ್ಗದಲ್ಲಿದ್ದೀರಿ. ನೀವು ಸರಿಯಾಗಿ ಪಡೆಯುವ ಪ್ರತಿಯೊಂದು ಪ್ರಶ್ನೆ ನಿಮ್ಮ ಮೆದುಳಿಗೆ ಮಾದರಿಯನ್ನು ಕಲಿಸುತ್ತಿದೆ.",
    ],
    medium: [
      "ಇಲ್ಲಿಯೇ ನಿಜವಾದ ಕಲಿಕೆ ನಡೆಯುತ್ತದೆ—ಮಧ್ಯದಲ್ಲಿ, ನೀವು ವಿಷಯಗಳನ್ನು ಲೆಕ್ಕಾಚಾರ ಮಾಡುತ್ತಿರುವಾಗ.",
      "50-60% ವಿಫಲತೆ ಅಲ್ಲ. ಇದು ಪ್ರಾಮಾಣಿಕ ಪ್ರತಿಕ್ರಿಯೆ. ಮತ್ತು ಪ್ರಾಮಾಣಿಕ ಪ್ರತಿಕ್ರಿಯೆ ಸುಧಾರಣೆಗೆ ಚಿನ್ನ.",
      "ನೀವು ಹಾಜರಾಗಿದ್ದೀರಿ. ನೀವು ಪ್ರಯತ್ನಿಸಿದ್ದೀರಿ. ಅದು ಪ್ರತಿ ಯಶಸ್ಸಿನ ಕಥೆಯ ಅಡಿಪಾಯ.",
    ],
    low: [
      "ಕಠಿಣ ದಿನ, ನನಗೆ ಗೊತ್ತು. ಆದರೆ ಇಲ್ಲಿ ಮುಖ್ಯವಾದದ್ದು: ನೀವು ಮುಗಿಸಿದ್ದೀರಿ. ಅನೇಕರು ಬಿಟ್ಟುಕೊಡುತ್ತಿದ್ದರು.",
      "ಇಂದು ಕಡಿಮೆ ಅಂಕಗಳು ನಿಮ್ಮ ಸಾಮರ್ಥ್ಯವನ್ನು ವ್ಯಾಖ್ಯಾನಿಸುವುದಿಲ್ಲ. ನಾಳೆ ಯಾವುದರ ಮೇಲೆ ಕೇಂದ್ರೀಕರಿಸಬೇಕೆಂದು ಅವು ನಿಮಗೆ ನಿಖರವಾಗಿ ತೋರಿಸುತ್ತವೆ.",
      "ಪ್ರತಿ ತಜ್ಞರು ಒಮ್ಮೆ ಈ ಹಂತದಲ್ಲಿದ್ದರು. ವ್ಯತ್ಯಾಸ? ಅವರು ಮುಂದುವರೆದರು. ನೀವು ಈಗ ಮಾಡುತ್ತಿರುವಂತೆಯೇ.",
    ],
    veryLow: [
      "ನೀವು ಹೆಣಗಾಡುತ್ತಿರುವುದನ್ನು ನಾನು ನೋಡುತ್ತೇನೆ, ಮತ್ತು ನಾನು ನಿಮಗೆ ತಿಳಿಸಲು ಬಯಸುತ್ತೇನೆ: ಅದು ಸರಿ. ಕಲಿಕೆ ಗೊಂದಲಮಯವಾಗಿದೆ.",
      "ಇದು ಇದೀಗ ಕಷ್ಟ. ಆದರೆ 'ಕಷ್ಟ' ಎಂದರೆ 'ಅಸಾಧ್ಯ' ಅಲ್ಲ. ಇದರ ಅರ್ಥ 'ಇನ್ನೂ ಇಲ್ಲ'.",
      "ಅದನ್ನು ತಪ್ಪಿಸುವುದು ಸುಲಭವಾಗಿದ್ದಾಗ ನೀವು ಪರೀಕ್ಷೆ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಿ. ಅದಕ್ಕೆ ಧೈರ್ಯ ಬೇಕು. ನಿಜವಾದ ಧೈರ್ಯ.",
    ],
  },
  ur: {
    perfect: [
      "آپ مکمل طور پر امتحان کے لیے تیار ہیں. مہارت کی یہ سطح؟ یہ نایاب ہے. 🎯",
      "شاندار! محنت دکھائی دے رہی ہے. آپ کو ابھی فخر محسوس کرنا چاہیے.",
      "کامل سکور! آپ جانتے ہیں اس کا کیا مطلب ہے؟ آپ صرف تیاری نہیں کر رہے—آپ بہترین ہیں.",
    ],
    good: [
      "آج ٹھوس کام. آپ بالکل وہی بنا رہے ہیں جس کی آپ کو ضرورت ہے: اعتماد + قابلیت.",
      "اچھی ترقی! کچھ مزید مرکوز سیشنز اور آپ ناقابل تسخیر ہو جائیں گے.",
      "آپ صحیح راستے پر ہیں. ہر سوال جو آپ صحیح کرتے ہیں وہ آپ کے دماغ کو پیٹرن سکھا رہا ہے.",
    ],
    medium: [
      "یہ وہ جگہ ہے جہاں اصل سیکھنا ہوتا ہے—درمیان میں، جہاں آپ چیزوں کو سمجھ رہے ہیں.",
      "50-60% ناکامی نہیں ہے. یہ ایمانداری کی رائے ہے. اور ایمانداری کی رائے بہتری کے لیے سونا ہے.",
      "آپ حاضر ہوئے. آپ نے کوشش کی. یہ ہر کامیابی کی کہانی کی بنیاد ہے.",
    ],
    low: [
      "مشکل دن، مجھے معلوم ہے. لیکن یہاں جو اہم ہے: آپ نے ختم کیا. بہت سے چھوڑ دیتے.",
      "آج کم سکور آپ کی صلاحیت کی تعریف نہیں کرتے. وہ آپ کو بالکل دکھاتے ہیں کہ کل کس پر توجہ مرکوز کرنی ہے.",
      "ہر ماہر ایک بار اس مرحلے پر تھا. فرق؟ انہوں نے جاری رکھا. جیسے آپ ابھی کر رہے ہیں.",
    ],
    veryLow: [
      "میں دیکھتا ہوں کہ آپ جدوجہد کر رہے ہیں، اور میں آپ کو جاننا چاہتا ہوں: یہ ٹھیک ہے. سیکھنا گندا ہے.",
      "یہ ابھی مشکل ہے. لیکن 'مشکل' کا مطلب 'ناممکن' نہیں ہے. اس کا مطلب 'ابھی نہیں' ہے.",
      "آپ نے ٹیسٹ لیا جب اسے نظرانداز کرنا آسان ہوتا. اس میں ہمت چاہیے. اصل ہمت.",
    ],
  },
};

const DEFAULT_LANG = "en";

function getUiLang(userId) {
  const userData = getUserData(userId);
  return userData.prefs?.lang || DEFAULT_LANG;
}

function setUiLang(userId, lang) {
  updateUserData(userId, { prefs: { lang } });
}

function t(userId, key) {
  const lang = getUiLang(userId);
  const pack = uiText[lang] || uiText.en;
  return pack[key] || uiText.en[key] || `[${key}]`;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getPersonalizedMotivation(userId, score, total) {
  const lang = getUiLang(userId);
  const pack = motivation[lang] || motivation.en;
  const ratio = total > 0 ? score / total : 0;

  let category;
  if (ratio === 1) category = 'perfect';
  else if (ratio >= 0.75) category = 'good';
  else if (ratio >= 0.5) category = 'medium';
  else if (ratio >= 0.25) category = 'low';
  else category = 'veryLow';

  return pickRandom(pack[category]);
}


// ═══════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS & LEARNING ENGINE
// ═══════════════════════════════════════════════════════════════════════

const letters = ["a", "b", "c", "d"];

const correctReactions = ["✅", "🎯 Great!", "🔥 Superb!", "🌟 Excellent!"];
const wrongReactions = ["❌", "⚠️ Let's review", "🧐 Check again", "📚 Study this"];

// Difficulty ramp helper
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function applyDifficultyRamp(pool) {
  return pool.sort((a, b) => (a.level || 1) - (b.level || 1));
}

// Build practice pool: 3 new + 2 old wrong
function buildPracticePool(userId, allQuestions, size = MINI_TEST_SIZE) {
  const wrongSet = getWrongBank(userId);
  const history = Array.from(wrongSet);

  const oldWrongs = shuffleArray(history)
    .map((id) => allQuestions.find((q) => q.id === id))
    .filter(Boolean)
    .slice(0, 2);

  const usedIds = new Set(oldWrongs.map((q) => q.id));
  const freshPool = allQuestions.filter((q) => !usedIds.has(q.id));
  const newOnes = shuffleArray(freshPool).slice(0, size - oldWrongs.length);

  const finalPool = [...oldWrongs, ...newOnes];
  return applyDifficultyRamp(finalPool);
}

// Mode filtering
function getPrettyModeName(mode) {
  switch ((mode || "mixed").toLowerCase()) {
    case "rc": return "Reading Comprehension";
    case "grammar": return "Grammar & Structure";
    case "poetry": return "Poetry";
    case "pedagogy": return "Pedagogy";
    case "vocab": return "Vocabulary";
    default: return "Mixed (All Types)";
  }
}

function filterQuestionsByMode(allQuestions, mode) {
  if (!mode || mode === "mixed") return allQuestions;
  const lcMode = mode.toLowerCase();

  return allQuestions.filter((q) => {
    const cat = (q.categoryId || "").toLowerCase();
    const topic = (q.topicId || "").toLowerCase();

    if (lcMode === "rc") {
      const hasPassage = q.passage && typeof q.passage === "string" && q.passage.trim().length > 0;
      return hasPassage || cat.includes("reading") || cat.includes("comprehension") || topic.includes("rc");
    }
    if (lcMode === "grammar") return cat.includes("grammar") || topic.includes("grammar");
    if (lcMode === "poetry") return cat.includes("poetry") || cat.includes("poem") || topic.includes("poem");
    if (lcMode === "pedagogy") return cat.includes("pedagogy") || topic.includes("pedagogy");
    if (lcMode === "vocab") return cat.includes("vocab") || cat.includes("vocabulary") || topic.includes("vocab");

    return true;
  });
}

// Display helpers
function getDisplayName(user) {
  if (!user) return "User";
  if (user.username) return "@" + user.username;
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return `User_${user.id}`;
}

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

// ═══════════════════════════════════════════════════════════════════════
// KEYBOARD BUILDERS
// ═══════════════════════════════════════════════════════════════════════

function buildLanguageInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: uiText.en.langEnglishButton, callback_data: "set_lang_en" }],
      [{ text: uiText.en.langKannadaButton, callback_data: "set_lang_kn" }],
      [{ text: uiText.en.langUrduButton, callback_data: "set_lang_ur" }],
    ],
  };
}

function buildMainMenuInline(userId) {
  return {
    inline_keyboard: [
      [
        { text: t(userId, "todaysPracticeButton"), callback_data: "menu_practice" },
        { text: t(userId, "myProgressButton"), callback_data: "menu_progress" }
      ],
      [
        { text: t(userId, "myWeakAreasButton"), callback_data: "menu_weak" },
        { text: t(userId, "moreOptionsButton"), callback_data: "menu_more" }
      ],
    ],
  };
}

async function showMainMenu(chatId, userId) {
  await clearAllInlineKeyboards(chatId);
  const text = `${t(userId, "welcomeMain")}\n\n${t(userId, "mainMenuIntro")}`;

  await sendWithInlineKeyboard(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: buildMainMenuInline(userId),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TEST FLOW
// ═══════════════════════════════════════════════════════════════════════

function startTest(chatId, user, questionsPoolOverride, isFreeMini = false) {
  const userId = user.id;
  const pool = questionsPoolOverride || questions;

  sessions[userId] = {
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

  setUserState(userId, UserState.IN_TEST);
  sendQuestion(chatId, userId);
}

function sendQuestion(chatId, userId) {
  const session = sessions[userId];
  if (!session) return;

  const pool = session.questionsPool || questions;
  const qIndex = session.currentIndex;

  if (qIndex >= pool.length) {
    setUserState(userId, UserState.VIEWING_RESULTS);
    sendResult(chatId, userId);
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

  sendWithInlineKeyboard(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

async function sendResult(chatId, userId) {
  const session = sessions[userId];
  if (!session) return;

  const pool = session.questionsPool || questions;
  const score = session.score;
  const attempted = session.answers.length;
  const correct = score;
  const wrong = attempted - correct;
  const skipped = pool.length - attempted;
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  const bar = makeProgressBar(correct, attempted, 10);

  let summaryText = `${t(userId, "testFinished")}\n\n`;
  summaryText += `${t(userId, "summaryHeading")}\n\n`;
  summaryText += `🎯 ${t(userId, "scoreLabel")}: ${correct}/${attempted}\n`;
  summaryText += `📝 ${t(userId, "attemptedLabel")}: ${attempted}/${pool.length}\n`;
  summaryText += `⏭️ ${t(userId, "skippedLabel")}: ${skipped}\n`;
  summaryText += `❌ ${t(userId, "wrongLabel")}: ${wrong}\n`;
  summaryText += `📈 ${t(userId, "accuracyLabel")}: ${accuracy}%\n\n`;
  summaryText += `Progress: ${bar}\n\n`;

  // Personalized motivation
  const motiv = getPersonalizedMotivation(userId, correct, pool.length);
  summaryText += motiv;

  // Update user data
  if (!session.isWrongRetake) {
    const testData = {
      score: correct,
      attempted,
      correct,
    };

    const result = recordTestResult(userId, testData);

    if (result.streak >= 3) {
      if (result.streak === 3) summaryText += "\n\n💪 3-day streak — nice momentum!";
      else if (result.streak === 7) summaryText += "\n\n✨ 7 days in a row — real discipline!";
      else if (result.streak === 14) summaryText += "\n\n🏆 14-day streak — top 10% behavior!";
    }

    // Store wrong questions
    const wrongIds = session.answers
      .filter((a) => !a.correct)
      .map((a) => pool[a.qIndex]?.id)
      .filter((id) => id != null);

    if (wrongIds.length > 0) {
      updateWrongBank(userId, wrongIds);
    }
  }

  // Store results
  const baseResult = {
    answers: session.answers,
    questionsPool: pool,
  };

  lastResults[userId] = baseResult;
  if (!session.isWrongRetake) {
    mainResults[userId] = baseResult;
  }

  const hasWrong = session.answers.some((a) => !a.correct);

  const reviewKeyboard = {
    inline_keyboard: [
      [
        { text: "✅ Right answers", callback_data: "view_right" },
        { text: "❌ Wrong answers", callback_data: "view_wrong" },
      ],
      [{ text: "🏠 Main Menu", callback_data: "done_results" }],
    ],
  };

  if (hasWrong && isPremiumUser(userId)) {
    reviewKeyboard.inline_keyboard.splice(1, 0, [
      { text: "🔄 Retake wrong-only", callback_data: "retake_wrong" }
    ]);
  }

  await sendWithInlineKeyboard(chatId, summaryText, {
    parse_mode: "Markdown",
    reply_markup: reviewKeyboard,
  });

  await showMainMenu(chatId, userId);

  delete sessions[userId];
}

function startDailyPracticeTest(chatId, user) {
  const userId = user.id;
  const userData = getUserData(userId);
  const mode = userData.prefs?.eng2Mode || "mixed";

  const filteredPool = filterQuestionsByMode(questions, mode);
  const effectivePool = filteredPool.length ? filteredPool : questions;

  // Premium: full pool
  if (isPremiumUser(userId)) {
    const premiumPool = applyDifficultyRamp(shuffleArray(effectivePool));
    startTest(chatId, user, premiumPool, false);
    return;
  }

  // Free: check daily limit
  const testsToday = checkDailyLimit(userId);

  if (testsToday >= FREE_DAILY_MINI_TESTS) {
    bot.sendMessage(chatId, t(userId, "freeLimitReached"), {
      parse_mode: "Markdown",
      reply_markup: buildMainMenuInline(userId),
    });
    return;
  }

  incrementDailyUse(userId);

  const pretty = getPrettyModeName(mode);
  const dailyPool = buildPracticePool(userId, effectivePool, MINI_TEST_SIZE);

  bot.sendMessage(
    chatId,
    `🧪 Starting today's *free* ${MINI_TEST_SIZE}-question practice test\nin *${pretty}*...`,
    { parse_mode: "Markdown" }
  );

  startTest(chatId, user, dailyPool, true);
}

function askEnglishMode(chatId, user) {
  const userId = user.id;
  setUserState(userId, UserState.CHOOSING_MODE);

  const name = getDisplayName(user);
  const text =
    `Hi ${name}! 👋\n` +
    "You chose *English Language — II*.\n" +
    "Let's personalise your practice.\n\n" +
    "What would you like to practise today?";

  const inlineKeyboard = [
    [{ text: "📖 Reading Comprehension", callback_data: "eng2_mode_rc" }],
    [{ text: "✏️ Grammar & Structure", callback_data: "eng2_mode_grammar" }],
    [{ text: "📝 Poetry", callback_data: "eng2_mode_poetry" }],
    [{ text: "👩‍🏫 Pedagogy", callback_data: "eng2_mode_pedagogy" }],
    [{ text: "🔤 Vocabulary", callback_data: "eng2_mode_vocab" }],
    [{ text: "🔀 Mixed (All Types)", callback_data: "eng2_mode_mixed" }],
  ];

  sendWithInlineKeyboard(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// BOT COMMANDS
// ═══════════════════════════════════════════════════════════════════════

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await clearAllInlineKeyboards(chatId);

  const userData = getUserData(userId);
  const hasLang = Boolean(userData.prefs?.lang);

  if (!hasLang) {
    setUserState(userId, UserState.CHOOSING_LANGUAGE);
    const pack = uiText.en;
    const text = `${pack.startGreeting}\n\n${pack.startSub}\n\n*${pack.chooseLanguage}*`;

    await sendWithInlineKeyboard(chatId, text, {
      reply_markup: buildLanguageInlineKeyboard(),
      parse_mode: "Markdown",
    });
    return;
  }

  await showMainMenu(chatId, userId);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const text =
    `*Help — Namma KARTET English Mentor*\n\n` +
    "Commands:\n" +
    "/start — Show main menu\n" +
    "/help — Show this help\n" +
    "/status — Check your account status\n\n" +
    "Daily flow:\n" +
    "1️⃣ Choose Daily Practice Test\n" +
    "2️⃣ Select area (RC/Grammar/Poetry/etc)\n" +
    "3️⃣ Complete 5-question test\n" +
    "4️⃣ Review mistakes & progress";

  bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isPrem = isPremiumUser(userId);
  const name = getDisplayName(msg.from);
  const userData = getUserData(userId);

  let message = `*Your Account Status*\n\n`;
  message += `👤 Name: *${name}*\n`;
  message += `📦 Plan: *${isPrem ? "⭐ Premium (Mentor+)" : "Free User"}*\n`;
  message += `🔥 Current Streak: *${userData.streaks.currentStreak} days*\n`;
  message += `📊 Tests taken: *${userData.stats.attempts}*\n\n`;

  if (isPrem) {
    message += "You have access to:\n" +
      "• Unlimited tests & mocks\n" +
      "• Full explanations\n" +
      "• Topic-wise analysis\n" +
      "• Wrong-only practice\n";
  } else {
    message += "Free plan:\n" +
      `• 1 mini-test (${MINI_TEST_SIZE} questions) per day\n` +
      "• Score + accuracy summary\n" +
      "• Wrong-answers preview\n";
  }

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

// ═══════════════════════════════════════════════════════════════════════
// CALLBACK HANDLERS
// ═══════════════════════════════════════════════════════════════════════

bot.on("callback_query", async (callbackQuery) => {
  try {
    const data = callbackQuery.data;
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const isPrem = isPremiumUser(userId);

    // Validate callback
    if (!isCallbackValid(callbackQuery)) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "This button is no longer active. Use /start",
        show_alert: true,
      });
      return;
    }

    // Language selection
    if (data && data.startsWith("set_lang_")) {
      const lang = data.split("_")[2];

      if ((lang === "kn" || lang === "ur") && !isPrem) {
        const pack = uiText[lang === "kn" ? "kn" : "ur"];
        await sendWithInlineKeyboard(chatId, pack.premiumLangPitch, {
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

      await clearAllInlineKeyboards(chatId);
      setUiLang(userId, lang);
      setUserState(userId, UserState.IDLE);
      await showMainMenu(chatId, userId);
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    // Main menu navigation
    if (data === "menu_practice") {
      await bot.answerCallbackQuery(callbackQuery.id);
      askEnglishMode(chatId, callbackQuery.from);
      return;
    }

    if (data === "menu_progress") {
      await bot.answerCallbackQuery(callbackQuery.id);
      // sendMyProgress(chatId, userId); // Implement this
      bot.sendMessage(chatId, "Progress tracking coming soon! 📊");
      return;
    }

    if (data === "menu_weak") {
      await bot.answerCallbackQuery(callbackQuery.id);
      // sendMyWeakAreas(chatId, userId); // Implement this
      bot.sendMessage(chatId, "Weak areas analysis coming soon! 🔍");
      return;
    }

    if (data === "menu_more") {
      await bot.answerCallbackQuery(callbackQuery.id);
      // showMoreOptions(chatId, userId); // Implement this
      bot.sendMessage(chatId, "More options coming soon! 📂");
      return;
    }

    // Mode selection
    if (data && data.startsWith("eng2_mode_")) {
      if (getUserState(userId) !== UserState.CHOOSING_MODE) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "This option is no longer available.",
          show_alert: false,
        });
        return;
      }

      const mode = data.replace("eng2_mode_", "");
      updateUserData(userId, { prefs: { eng2Mode: mode } });

      const pretty = getPrettyModeName(mode);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `Mode set to: ${pretty}`,
        show_alert: false,
      });

      await clearAllInlineKeyboards(chatId);
      await bot.sendMessage(chatId, `Nice! We'll practise *${pretty}* questions now.`, {
        parse_mode: "Markdown",
      });

      startDailyPracticeTest(chatId, callbackQuery.from);
      return;
    }

    // Answer selection
    if (/^\d+:\d+$/.test(data)) {
      const session = sessions[userId];

      if (!session || getUserState(userId) !== UserState.IN_TEST) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "No active test. Start a new one with /start",
          show_alert: true,
        });
        return;
      }

      const [qIndexStr, optIndexStr] = data.split(":");
      const qIndex = parseInt(qIndexStr, 10);
      const chosen = parseInt(optIndexStr, 10);

      if (qIndex !== session.currentIndex) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "This question has already been answered.",
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

      if (correct) session.score++;

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: correct ? pickRandom(correctReactions) : pickRandom(wrongReactions),
        show_alert: false,
      });

      session.currentIndex++;

      if (session.currentIndex < pool.length) {
        sendQuestion(chatId, userId);
      } else {
        setUserState(userId, UserState.VIEWING_RESULTS);
        sendResult(chatId, userId);
      }

      return;
    }

    // Skip/Finish
    if (data.startsWith("skip:") || data.startsWith("finish_now:")) {
      const session = sessions[userId];

      if (!session || getUserState(userId) !== UserState.IN_TEST) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "No active test.",
          show_alert: false,
        });
        return;
      }

      const qIndexStr = data.split(":")[1];
      const pressedIndex = parseInt(qIndexStr, 10);

      if (pressedIndex !== session.currentIndex) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "This question is already handled.",
          show_alert: false,
        });
        return;
      }

      if (data.startsWith("skip:")) {
        session.currentIndex++;
        if (session.currentIndex < (session.questionsPool || questions).length) {
          sendQuestion(chatId, userId);
        } else {
          setUserState(userId, UserState.VIEWING_RESULTS);
          sendResult(chatId, userId);
        }
      } else {
        setUserState(userId, UserState.VIEWING_RESULTS);
        sendResult(chatId, userId);
      }

      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    // Done with results
    if (data === "done_results") {
      await clearAllInlineKeyboards(chatId);
      setUserState(userId, UserState.IDLE);
      await showMainMenu(chatId, userId);
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    // View results
    if (data === "view_right" || data === "view_wrong") {
      await bot.answerCallbackQuery(callbackQuery.id);
      bot.sendMessage(chatId, "Detailed review coming soon! 📚");
      return;
    }

    // Retake wrong
    if (data === "retake_wrong") {
      await bot.answerCallbackQuery(callbackQuery.id);
      bot.sendMessage(chatId, "Wrong-only retake coming soon! 🔄");
      return;
    }

  } catch (err) {
    console.error("Error in callback_query handler:", err);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "An error occurred. Please try /start",
      show_alert: true,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════

async function shutdown() {
  console.log("🛑 Shutting down...");

  if (isDirty) {
    await saveDatabase();
  }

  await createBackup();
  console.log("✅ Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ═══════════════════════════════════════════════════════════════════════
// START BOT
// ═══════════════════════════════════════════════════════════════════════

(async () => {
  try {
    await initDatabase();
    console.log("🤖 Bot is running...");
    console.log("✨ Namma KARTET English Mentor - Your Personal Teaching Companion");
  } catch (err) {
    console.error("❌ Failed to start bot:", err);
    process.exit(1);
  }
})();
