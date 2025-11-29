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
      `ನೀವು ಇಂದು ${MINI_TEST_SIZE} ಪ್ರಶ್ನೆಗಳನ್ನು ಅಭ್ಯಾಸ ಮಾಡಿದ್ದೀರಿ.\n\n` +
      "ನಾನು ನಿಮಗೆ ಹೇಳಲು ಬಯಸುವುದು ಇಷ್ಟೇ:\n" +
      "• ದಿನಕ್ಕೆ 5 ಪ್ರಶ್ನೆಗಳಾದರೂ ಸಾಕು, ತಿಂಗಳಿಗೆ 150 ಪ್ರಶ್ನೆಗಳಾಗುತ್ತವೆ\n" +
      "• ಒಮ್ಮೆ ಹೆಚ್ಚು ಓದುವುದಕ್ಕಿಂತ, ದಿನಾ ಸ್ವಲ್ಪ ಓದುವುದು ಉತ್ತಮ\n" +
      "• ಅನೇಕರು ಕೇವಲ free plan ಬಳಸಿ KARTET ಪಾಸ್ ಮಾಡಿದ್ದಾರೆ\n\n" +
      "ನಾಳೆ ಬನ್ನಿ. ನಾನು ಇಲ್ಲೇ ಇರುತ್ತೇನೆ, ಅದೇ ಪ್ರೀತಿಯಿಂದ. 💙",

    // Encouragement messages
    comebackMessage: "ಬಂದ್ರಾ! ಇಂದು ನಿಮ್ಮನ್ನು ನೋಡಲು ಕಾಯುತ್ತಿದ್ದೆ. 😊",
    streakBreakMessage: "ನೀವು ನಿನ್ನೆ ಬರಲಿಲ್ಲ ಎಂದು ಗಮನಿಸಿದೆ.\n\nಪರವಾಗಿಲ್ಲ. ಜೀವನದಲ್ಲಿ ಇದೆಲ್ಲ ಸಹಜ.\n\nಮುಖ್ಯವಾದ ವಿಷಯವೆಂದರೆ ನೀವು ಈಗ ಇಲ್ಲಿದ್ದೀರಿ. ಹೊಸದಾಗಿ ಶುರು ಮಾಡೋಣ. 🌅",
    firstTestEver: "ಇದು ನನ್ನೊಂದಿಗೆ ನಿಮ್ಮ ಮೊದಲ ಪರೀಕ್ಷೆ.\n\nನೆನಪಿಡಿ: ಎಲ್ಲರೂ ಎಲ್ಲೋ ಒಂದು ಕಡೆ ಶುರು ಮಾಡಲೇಬೇಕು.\n\nಇಂದಿನ ಸ್ಕೋರ್ ಮುಖ್ಯವಲ್ಲ—ಇದು ಕೇವಲ ಆರಂಭ. 💙",
  },

  ur: {
    langName: "اردو",

    startGreeting: "🙏 خوش آمدید، میرے عزیز طالب علم!\n\nمیں صرف ایک بوٹ نہیں ہوں—میں KARTET کے لیے آپ کا *ذاتی انگلش مینٹر* ہوں۔",
    startSub: "سب سے پہلے، اس زبان میں بات کرتے ہیں جو آپ کو گھر جیسی لگے۔\n\n_سوالات انگریزی میں ہوں گے (بالکل امتحان کی طرح)، لیکن میں آپ کی رہنمائی آپ کی اپنی زبان میں کروں گا۔_",
    chooseLanguage: "آپ کو کون سی زبان سب سے زیادہ اپنی لگتی ہے؟",

    langEnglishButton: "🇬🇧 English",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    welcomeMain: "میں ہر روز آپ کے ساتھ ہوں۔ 💙\n\nہم مل کر، چھوٹے اور مستقل قدموں کے ساتھ *English Language II* میں مہارت حاصل کریں گے۔\n\nکوئی جلد بازی نہیں۔ کوئی دباؤ نہیں۔ صرف مستقل بہتری۔",

    todaysPracticeButton: "🎯 آج کی مشق",
    myProgressButton: "📊 میرا سفر",
    myWeakAreasButton: "🔍 توجہ طلب عنوانات",
    moreOptionsButton: "📂 مزید",

    mainMenuIntro: "آج آپ کیا کرنا چاہیں گے؟",

    premiumLangPitch:
      "🌟 *اپنی مادری زبان میں سیکھیں*\n\n" +
      "میں دیکھ رہا ہوں کہ آپ اردو کو ترجیح دیتے ہیں۔ میں اس کا تہہ دل سے احترام کرتا ہوں۔\n\n" +
      "Mentor+ مجھے اجازت دیتا ہے کہ میں ہر چیز آپ کی زبان میں سمجھاؤں—بالکل ایسے جیسے کوئی استاد آپ کے پاس بیٹھا ہو۔\n\n" +
      "*Mentor+ میں آپ کو کیا ملتا ہے:*\n" +
      "• لا محدود مشق (روزانہ کی کوئی قید نہیں)\n" +
      "• اردو میں مکمل وضاحتیں\n" +
      "• عنوانات کا تفصیلی تجزیہ\n" +
      "• ون-آن-ون شکوک و شبہات کا حل\n\n" +
      "لیکن سچ یہ ہے: انگریزی میں بھی، میں آپ کی کامیابی کے لیے پوری کوشش کروں گا۔ بہت سے اساتذہ نے مفت پلان استعمال کر کے میرے ساتھ KARTET پاس کیا ہے۔\n\n" +
      "فیصلہ آپ کا ہے۔ میں ہر حال میں آپ کے ساتھ ہوں۔ 💙",

    upgradeButton: "⭐ Mentor+ دیکھیے",
    continueEnglishButton: "➡️ English میں جاری رکھیں",

    testFinished: "✅ *آپ نے ٹیسٹ مکمل کر لیا!*",
    summaryHeading: "📊 *دیکھتے ہیں آپ کی کارکردگی کیسی رہی*",
    scoreLabel: "سکور",
    attemptedLabel: "کوشش کی",
    skippedLabel: "چھوڑ دیے",
    wrongLabel: "غلط",
    accuracyLabel: "درستگی",

    topicPerfTitle: "📚 *عنوان کے لحاظ سے کارکردگی*",
    weakTopicsTitle: "🎯 *وہ عنوانات جنہیں آپ کی توجہ چاہیے*",
    rightAnswersTitle: "✅ *صحیح جوابات*",
    wrongAnswersTitle: "💡 *غلطیوں سے سیکھنا*",
    wrongPreviewTitle: "👀 *غلطیوں پر ایک نظر*",

    noTopicsYet: "ابھی کافی ڈیٹا نہیں ہے۔ چند اور ٹیسٹ دیں، پھر میں آپ کی طاقتوں کا نقشہ بناؤں گا۔",
    noWeakTopics: "سچ کہوں؟ آپ تمام عنوانات میں بہترین جا رہے ہیں۔ اس معیار کو برقرار رکھیں! 🌟",
    noWrongAnswers: "✅ مکمل نمبر!\n\nآپ اس حصے میں امتحان کے لیے تیار ہیں۔ بہترین کام! 🎉",
    noRightAnswers: "یہ مشکل تھا، میں سمجھتا ہوں۔\n\nلیکن میں نے آپ کے بارے میں یہ سیکھا ہے: آپ کوشش نہیں چھوڑتے۔ اور یہی سب سے اہم ہے۔\n\nآئیے مل کر ان تصورات کا جائزہ لیں۔",

    wrongRetakeStart: "آپ کی پچھلی غلطیوں پر توجہ مرکوز کرتے ہوئے ایک سیشن شروع کر رہے ہیں۔\n\nچیمپئن ایسے ہی بنتے ہیں—مشکلات کا سامنا کر کے۔ 💪",
    wrongRetakePerfect: "پچھلی بار آپ نے سب صحیح کیا تھا!\n\nصرف غلطیوں کے ری-ٹیک کی ضرورت نہیں۔ آپ کمال کر رہے ہیں! 🔥",

    freeLimitReached:
      "⏰ *آج کی مفت مشق مکمل ہو گئی*\n\n" +
      `آپ نے آج ${MINI_TEST_SIZE} سوالات کی مشق کی ہے۔\n\n` +
      "میں آپ کو یہ بتانا چاہتا ہوں:\n" +
      "• روزانہ 5 سوالات بھی کافی ہیں، مہینے کے 150 سوالات بنتے ہیں۔\n" +
      "• ایک بار بہت زیادہ پڑھنے سے بہتر ہے کہ روزانہ تھوڑا پڑھا جائے۔\n" +
      "• بہت سے لوگوں نے صرف free plan استعمال کر کے KARTET پاس کیا ہے۔\n\n" +
      "کل پھر آئیے گا۔ میں یہیں ہوں گا، اسی لگن کے ساتھ۔ 💙",

    // Encouragement messages
    comebackMessage: "آپ واپس آگئے! مجھے آج آپ کا انتظار تھا۔ 😊",
    streakBreakMessage: "میں نے محسوس کیا کہ آپ کل نہیں آئے۔\n\nیہ بالکل ٹھیک ہے۔ زندگی میں ایسا ہوتا ہے۔\n\nاہم بات یہ ہے کہ آپ اب یہاں ہیں۔ آئیے نئی شروعات کریں۔ 🌅",
    firstTestEver: "میرے ساتھ یہ آپ کا پہلا ٹیسٹ ہے۔\n\nیاد رکھیں: ہر کوئی کہیں نہ کہیں سے شروعات کرتا ہے۔\n\nآج کوئی سکور غلط نہیں—یہ صرف ایک نقطہ آغاز ہے۔ 💙",
  },
};

// ═══════════════════════════════════════════════════════════════════════
// PSYCHOLOGICAL MOTIVATION ENGINE
// ═══════════════════════════════════════════════════════════════════════

const motivation = {
  en: {
    high: ["Outstanding! You're mastering this.", "Your hard work is clearly showing.", "You are exam ready in this topic! 🎯"],
    med: ["Good progress! A little polish and you'll shine.", "You're on the right path. Keep going.", "Solid effort. Let's fix those few errors."],
    low: ["Mistakes are just proof that you are trying.", "Don't be discouraged. Learning happens here.", "Every wrong answer is a lesson learned for the exam."]
  },
  kn: {
    high: ["ಅದ್ಭುತ! ನೀವು ಇದರಲ್ಲಿ ಪರಿಣತಿ ಪಡೆಯುತ್ತಿದ್ದೀರಿ.", "ನಿಮ್ಮ ಕಠಿಣ ಪರಿಶ್ರಮ ಸ್ಪಷ್ಟವಾಗಿ ಕಾಣುತ್ತಿದೆ.", "ಈ ವಿಷಯದಲ್ಲಿ ನೀವು ಪರೀಕ್ಷೆಗೆ ಸಿದ್ಧರಿದ್ದೀರಿ! 🎯"],
    med: ["ಒಳ್ಳೆಯ ಪ್ರಗತಿ! ಇನ್ನೂ ಸ್ವಲ್ಪ ಅಭ್ಯಾಸ ಮಾಡಿದರೆ ನೀವು ಮಿಂಚುತ್ತೀರಿ.", "ನೀವು ಸರಿಯಾದ ದಾರಿಯಲ್ಲಿದ್ದೀರಿ. ಮುಂದುವರಿಸಿ.", "ಉತ್ತಮ ಪ್ರಯತ್ನ. ಆ ಕೆಲವು ತಪ್ಪುಗಳನ್ನು ಸರಿಪಡಿಸೋಣ."],
    low: ["ತಪ್ಪುಗಳು ನೀವು ಪ್ರಯತ್ನಿಸುತ್ತಿದ್ದೀರಿ ಎಂಬುದಕ್ಕೆ ಸಾಕ್ಷಿ.", "ಧೈರ್ಯಗೆಡಬೇಡಿ. ಕಲಿಕೆ ಇಲ್ಲಿಯೇ ಆಗುತ್ತದೆ.", "ಪ್ರತಿ ತಪ್ಪು ಪರೀಕ್ಷೆಗೆ ಒಂದು ಪಾಠ."]
  },
  ur: {
    high: ["کمال کر دیا! آپ اس میں مہارت حاصل کر رہے ہیں۔", "آپ کی محنت صاف دکھائی دے رہی ہے۔", "آپ اس مضمون میں امتحان کے لیے تیار ہیں! 🎯"],
    med: ["اچھی پیش رفت! تھوڑی سی محنت اور آپ چمک اٹھیں گے۔", "آپ صحیح راستے پر ہیں۔ جاری رکھیں۔", "اچھی کوشش۔ آئیے ان چند غلطیوں کو ٹھیک کریں۔"],
    low: ["غلطیاں اس بات کا ثبوت ہیں کہ آپ کوشش کر رہے ہیں۔", "ہمت نہ ہاریں۔ سیکھنے کا عمل یہیں سے شروع ہوتا ہے۔", "ہر غلط جواب امتحان کے لیے ایک سبق ہے۔"]
  }
};

// ═══════════════════════════════════════════════════════════════════════
// DATABASE LAYER (Atomic, Safe, Persistent)
// ═══════════════════════════════════════════════════════════════════════

const path = require("path");
const DB_FILE = "./botdb.json";

let dbCache = {
  users: {}, // { [userId]: { stats, prefs, history } }
  version: "1.0"
};

// Initialize DB
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    dbCache = JSON.parse(raw);
  }
} catch (e) {
  console.error("DB Load Error, starting fresh:", e);
}

function saveDb() {
  try {
    // Atomic write pattern: Write to .tmp then rename
    // This prevents data corruption if the process crashes mid-write
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(dbCache, null, 2));
    fs.renameSync(tempFile, DB_FILE);
  } catch (e) {
    console.error("DB Save Error:", e);
  }
}

function getUserData(userId) {
  if (!dbCache.users[userId]) {
    dbCache.users[userId] = {
      prefs: { lang: null, mode: 'mixed' },
      stats: {
        totalAttempts: 0,
        totalCorrect: 0,
        streak: 0,
        lastTestDate: null,
        lastFreeDate: null,
        freeTestsToday: 0
      },
      wrongBank: [] // IDs of wrong questions
    };
    saveDb();
  }
  return dbCache.users[userId];
}

function updateUserData(userId, updates) {
  const user = getUserData(userId);
  // Deep merge for simple objects
  Object.keys(updates).forEach(key => {
    if (typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
      user[key] = { ...user[key], ...updates[key] };
    } else {
      user[key] = updates[key];
    }
  });
  saveDb();
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

function t(userId, key) {
  const user = getUserData(userId);
  const lang = user.prefs.lang || 'en'; // Default to English if not set
  return uiText[lang]?.[key] || uiText['en'][key] || "Text Missing";
}

function getMotivation(userId, score, total) {
  const user = getUserData(userId);
  const lang = user.prefs.lang || 'en';
  const percentage = total === 0 ? 0 : (score / total);
  
  const pack = motivation[lang] || motivation['en'];
  
  if (percentage >= 0.8) return pack.high[Math.floor(Math.random() * pack.high.length)];
  if (percentage >= 0.5) return pack.med[Math.floor(Math.random() * pack.med.length)];
  return pack.low[Math.floor(Math.random() * pack.low.length)];
}

function getProgressBar(current, total) {
  const filled = Math.round((current / total) * 10);
  const empty = 10 - filled;
  return "🟩".repeat(filled) + "⬜".repeat(empty);
}

function shuffleArray(array) {
  return array.sort(() => Math.random() - 0.5);
}

// ═══════════════════════════════════════════════════════════════════════
// CORE LOGIC: STARTING A TEST
// ═══════════════════════════════════════════════════════════════════════

async function startDailyPracticeTest(chatId, userId) {
  const user = getUserData(userId);
  const today = new Date().toISOString().slice(0, 10);

  // Free Tier Check
  if (!isPremiumUser(userId)) {
    if (user.stats.lastFreeDate === today && user.stats.freeTestsToday >= FREE_DAILY_MINI_TESTS) {
      await sendWithInlineKeyboard(chatId, t(userId, "freeLimitReached"), { parse_mode: "Markdown" });
      
      // Return to main menu logic
      await showMainMenu(chatId, userId);
      return;
    }
  }

  // Update Free Limit Counters
  if (user.stats.lastFreeDate !== today) {
    updateUserData(userId, { stats: { lastFreeDate: today, freeTestsToday: 1 } });
  } else {
    updateUserData(userId, { stats: { freeTestsToday: user.stats.freeTestsToday + 1 } });
  }

  // Prepare Questions (2 Wrong History + 3 New)
  const wrongHistory = user.wrongBank || [];
  let testQuestions = [];
  
  // Try to get 2 questions from wrong bank
  if (wrongHistory.length > 0) {
    const wrongIds = shuffleArray([...wrongHistory]).slice(0, 2);
    testQuestions = questions.filter(q => wrongIds.includes(q.id));
  }

  // Fill the rest with new questions from the chosen mode
  const mode = user.prefs.mode || 'mixed';
  let pool = questions;
  
  // Filter by mode (simplified logic)
  if (mode !== 'mixed') {
    pool = questions.filter(q => (q.topicId || "").toLowerCase().includes(mode) || (q.categoryId || "").toLowerCase().includes(mode));
    if (pool.length === 0) pool = questions; // Fallback if filter is too strict
  }

  // Remove already selected questions
  const selectedIds = new Set(testQuestions.map(q => q.id));
  const newPool = pool.filter(q => !selectedIds.has(q.id));
  
  // Add 3 (or needed amount) new questions
  const needed = MINI_TEST_SIZE - testQuestions.length;
  const newQuestions = shuffleArray(newPool).slice(0, needed);
  
  testQuestions = [...testQuestions, ...newQuestions];

  // Initialize Session
  sessions[userId] = {
    questions: testQuestions,
    currentIndex: 0,
    score: 0,
    answers: []
  };

  setUserState(userId, UserState.IN_TEST);
  await sendQuestion(chatId, userId);
}

async function sendQuestion(chatId, userId) {
  const session = sessions[userId];
  if (!session) return;

  const q = session.questions[session.currentIndex];
  const total = session.questions.length;
  const progress = session.currentIndex + 1;

  let text = `*Question ${progress}/${total}*\n\n`;
  
  if (q.passage) {
    text += `📜 *Passage:*\n_${q.passage}_\n\n`;
  }
  
  text += `❓ ${q.question}\n\n`;
  
  // Randomize letters for display, but keep track of indices in callback
  const options = q.options.map((opt, i) => ({ text: opt, idx: i }));
  
  text += options.map((opt, i) => `${['a','b','c','d'][i]}) ${opt.text}`).join("\n");

  const inlineKeyboard = [
    [
      { text: "a", callback_data: `${session.currentIndex}:0` },
      { text: "b", callback_data: `${session.currentIndex}:1` },
      { text: "c", callback_data: `${session.currentIndex}:2` },
      { text: "d", callback_data: `${session.currentIndex}:3` }
    ],
    [
      { text: "⏭️ Skip", callback_data: `skip:${session.currentIndex}` },
      { text: "⏹️ Finish", callback_data: `finish:${session.currentIndex}` }
    ]
  ];

  await sendWithInlineKeyboard(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CORE LOGIC: RESULTS & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════

async function sendResult(chatId, userId) {
  const session = sessions[userId];
  const user = getUserData(userId);
  if (!session) return;

  const total = session.questions.length;
  const score = session.score;
  const attempted = session.answers.length;
  const skipped = total - attempted;
  const wrong = attempted - score;

  // 1. Update Persistent Stats
  const today = new Date().toISOString().slice(0, 10);
  let streak = user.stats.streak;
  
  // Streak Logic
  if (user.stats.lastTestDate) {
    const lastDate = new Date(user.stats.lastTestDate);
    const diffTime = Math.abs(new Date(today) - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    if (diffDays === 1) streak++; // Consecutive day
    else if (diffDays > 1) streak = 1; // Broken streak
  } else {
    streak = 1; // First test ever
  }

  updateUserData(userId, {
    stats: {
      totalAttempts: user.stats.totalAttempts + attempted,
      totalCorrect: user.stats.totalCorrect + score,
      streak: streak,
      lastTestDate: today
    }
  });

  // 2. Manage Wrong Bank
  const wrongIds = session.answers.filter(a => !a.isCorrect).map(a => session.questions[a.qIndex].id);
  const correctIds = session.answers.filter(a => a.isCorrect).map(a => session.questions[a.qIndex].id);
  
  let currentWrongBank = user.wrongBank || [];
  // Add new wrongs, remove questions they just got right
  currentWrongBank = [...new Set([...currentWrongBank, ...wrongIds])]; 
  currentWrongBank = currentWrongBank.filter(id => !correctIds.includes(id));
  
  updateUserData(userId, { wrongBank: currentWrongBank });

  // 3. Build Result Message
  const motivationLine = getMotivation(userId, score, attempted);
  const bar = getProgressBar(score, total);

  let msg = `${t(userId, "testFinished")}\n\n`;
  msg += `${t(userId, "summaryHeading")}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏆 ${t(userId, "scoreLabel")}: *${score}/${total}*\n`;
  msg += `⚡ ${t(userId, "accuracyLabel")}: *${attempted > 0 ? Math.round((score/attempted)*100) : 0}%*\n`;
  msg += `🔥 Streak: *${streak} days*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Progress: ${bar}\n\n`;
  msg += `_${motivationLine}_\n`;

  // Store result for review viewing
  lastResults[userId] = session;

  const kb = [
    [{ text: t(userId, "wrongAnswersTitle"), callback_data: "view_wrong" }],
    [{ text: "🏠 Main Menu", callback_data: "done_results" }]
  ];

  await sendWithInlineKeyboard(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: kb }
  });

  // Clear Session
  delete sessions[userId];
  setUserState(userId, UserState.VIEWING_RESULTS);
}

// ═══════════════════════════════════════════════════════════════════════
// UI BUILDERS
// ═══════════════════════════════════════════════════════════════════════

async function showMainMenu(chatId, userId) {
  await clearAllInlineKeyboards(chatId);
  const text = `${t(userId, "welcomeMain")}\n\n${t(userId, "mainMenuIntro")}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: t(userId, "todaysPracticeButton"), callback_data: "menu_practice" },
        { text: t(userId, "myProgressButton"), callback_data: "menu_progress" }
      ],
      [
        { text: t(userId, "myWeakAreasButton"), callback_data: "menu_weak" },
        { text: t(userId, "moreOptionsButton"), callback_data: "menu_more" }
      ]
    ]
  };

  await sendWithInlineKeyboard(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });
}

function buildLanguageKeyboard() {
  return {
    inline_keyboard: [
      [{ text: uiText.en.langEnglishButton, callback_data: "set_lang_en" }],
      [{ text: uiText.en.langKannadaButton, callback_data: "set_lang_kn" }],
      [{ text: uiText.en.langUrduButton, callback_data: "set_lang_ur" }]
    ]
  };
}

// ═══════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await clearAllInlineKeyboards(chatId);
  
  const user = getUserData(userId);
  
  if (!user.prefs.lang) {
    setUserState(userId, UserState.CHOOSING_LANGUAGE);
    const text = `${uiText.en.startGreeting}\n\n${uiText.en.startSub}\n\n*${uiText.en.chooseLanguage}*`;
    await sendWithInlineKeyboard(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: buildLanguageKeyboard()
    });
  } else {
    // Check for streak break or comeback
    const today = new Date().toISOString().slice(0, 10);
    let welcomeMsg = "";
    
    if (user.stats.lastTestDate) {
      const last = new Date(user.stats.lastTestDate);
      const diff = Math.abs(new Date(today) - last);
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
      
      if (days === 1) welcomeMsg = t(userId, "comebackMessage");
      if (days > 1) welcomeMsg = t(userId, "streakBreakMessage");
    } else {
      welcomeMsg = t(userId, "firstTestEver");
    }

    // Send the human touch message first, then the menu
    if (welcomeMsg) {
      await bot.sendMessage(chatId, welcomeMsg);
    }

    setUserState(userId, UserState.IDLE);
    await showMainMenu(chatId, userId);
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  // 1. Validation
  if (!isCallbackValid(query)) {
    await bot.answerCallbackQuery(query.id, { text: "Session expired. /start again.", show_alert: true });
    return;
  }

  // 2. Language Selection
  if (data.startsWith("set_lang_")) {
    const lang = data.split("_")[2];
    
    // Premium Check for Non-English
    if ((lang === 'kn' || lang === 'ur') && !isPremiumUser(userId)) {
      await bot.answerCallbackQuery(query.id);
      const pitch = uiText[lang].premiumLangPitch;
      await sendWithInlineKeyboard(chatId, pitch, {
        parse_mode: "Markdown",
        reply_markup: {
           inline_keyboard: [
             [{ text: uiText[lang].upgradeButton, callback_data: "upgrade_dummy" }],
             [{ text: uiText[lang].continueEnglishButton, callback_data: "set_lang_en" }]
           ]
        }
      });
      return;
    }

    updateUserData(userId, { prefs: { lang: lang } });
    await bot.answerCallbackQuery(query.id, { text: `Language set to ${lang}` });
    
    // Go to main menu
    setUserState(userId, UserState.IDLE);
    await showMainMenu(chatId, userId);
    return;
  }

  // 3. Main Menu Actions
  if (data === "menu_practice") {
    await bot.answerCallbackQuery(query.id);
    await clearAllInlineKeyboards(chatId);
    
    // Mode selection could go here, but for now we jump straight to test
    // to keep the "one click practice" UX smooth
    await startDailyPracticeTest(chatId, userId);
    return;
  }

  if (data === "menu_progress") {
    await bot.answerCallbackQuery(query.id);
    const user = getUserData(userId);
    const text = `📊 *${t(userId, "myProgressButton")}*\n\n` +
                 `🔥 Streak: ${user.stats.streak} days\n` +
                 `📝 Total Questions: ${user.stats.totalAttempts}\n` +
                 `✅ Correct: ${user.stats.totalCorrect}\n\n` +
                 `Keep going! Consistency is key.`;
    
    await sendWithInlineKeyboard(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "done_results" }]] }
    });
    return;
  }
  
  // 4. Test Logic (Answers)
  if (data.includes(":")) {
    const session = sessions[userId];
    if (!session || getUserState(userId) !== UserState.IN_TEST) {
       await bot.answerCallbackQuery(query.id, { text: "Test session invalid.", show_alert: true });
       return;
    }

    // Handle Skip/Finish
    if (data.startsWith("skip:")) {
       await bot.answerCallbackQuery(query.id, { text: "Skipped" });
       session.currentIndex++;
       if (session.currentIndex < session.questions.length) {
         await sendQuestion(chatId, userId);
       } else {
         await sendResult(chatId, userId);
       }
       return;
    }

    if (data.startsWith("finish:")) {
       await bot.answerCallbackQuery(query.id);
       await sendResult(chatId, userId);
       return;
    }

    // Handle Answer
    const [qIdxStr, optIdxStr] = data.split(":");
    const qIdx = parseInt(qIdxStr);
    const optIdx = parseInt(optIdxStr);

    if (qIdx !== session.currentIndex) {
      await bot.answerCallbackQuery(query.id, { text: "Old question.", show_alert: false });
      return;
    }

    const q = session.questions[qIdx];
    const isCorrect = (optIdx === q.correctIndex);
    
    session.answers.push({ qIndex: qIdx, chosen: optIdx, isCorrect: isCorrect });
    if (isCorrect) session.score++;

    await bot.answerCallbackQuery(query.id, {
       text: isCorrect ? "✅ Correct!" : "❌ Oops!",
       show_alert: false
    });

    session.currentIndex++;
    if (session.currentIndex < session.questions.length) {
      await sendQuestion(chatId, userId);
    } else {
      await sendResult(chatId, userId);
    }
    return;
  }

  // 5. Post-Test Reviews
  if (data === "view_wrong") {
     const lastSession = lastResults[userId];
     if (!lastSession) return;
     
     const wrongs = lastSession.answers.filter(a => !a.isCorrect);
     if (wrongs.length === 0) {
       await bot.answerCallbackQuery(query.id, { text: t(userId, "noWrongAnswers"), show_alert: true });
       return;
     }

     let text = `${t(userId, "wrongPreviewTitle")}\n\n`;
     wrongs.forEach(a => {
       const q = lastSession.questions[a.qIndex];
       text += `❓ ${q.question}\n`;
       text += `❌ Your Answer: ${q.options[a.chosen]}\n`;
       text += `✅ Correct: ${q.options[q.correctIndex]}\n\n`;
     });

     await sendWithInlineKeyboard(chatId, text, {
       parse_mode: "Markdown",
       reply_markup: { inline_keyboard: [[{ text: "⬅️ Menu", callback_data: "done_results" }]] }
     });
     return;
  }

  if (data === "done_results") {
    await showMainMenu(chatId, userId);
    return;
  }
});

console.log("🤖 KARTET Mentor Bot is running...");
