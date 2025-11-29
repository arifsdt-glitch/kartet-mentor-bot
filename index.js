// index.js  — Ultimate Namma KARTET English Mentor (Lang-II)
// Final Integrated Version (Fixes SyntaxError: Identifier 'fs' has already been declared)

// ═══════════════════════════════════════════════════════════════════════
// INITIAL SETUP (Assuming this part was in your original file)
// ═══════════════════════════════════════════════════════════════════════
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs"); // <--- DO NOT DUPLICATE THIS LINE
const path = require("path");

// Placeholder for your question data (Replace with actual JSON file content later)
const questions = [
  { id: 1, question: "Identify the figure of speech: 'Life is a walking shadow.'", correctIndex: 2, options: ["Simile", "Metaphor", "Personification", "Hyperbole"], topicId: "Poetry" },
  { id: 2, question: "Which tense is used in the sentence: 'She has been studying since morning.'", correctIndex: 3, options: ["Simple Present", "Present Continuous", "Present Perfect", "Present Perfect Continuous"], topicId: "Grammar" },
  { id: 3, question: "Select the correct article: 'He is ___ honest man.'", correctIndex: 1, options: ["a", "an", "the", "no article"], topicId: "Grammar" },
  { id: 4, question: "Choose the correct preposition: 'He lives ___ Mumbai.'", correctIndex: 2, options: ["at", "on", "in", "by"], topicId: "Grammar" },
  { id: 5, question: "Find the synonym for 'Eradicate'.", correctIndex: 0, options: ["Abolish", "Establish", "Promote", "Ignore"], topicId: "Vocabulary" },
];

const premiumUsers = new Set([
  // 437248254, // Example premium ID
]);

function isPremiumUser(userId) {
  return premiumUsers.has(userId);
}

const FREE_DAILY_MINI_TESTS = 1;
const MINI_TEST_SIZE = 5;

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN_HERE"; 
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on("polling_error", (err) => {
  console.error("❌ Polling error:", err.message || err);
});

// ═══════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT (CRITICAL FIXES)
// ═══════════════════════════════════════════════════════════════════════

const UserState = {
  IDLE: 'idle',
  CHOOSING_LANGUAGE: 'choosing_language',
  CHOOSING_MODE: 'choosing_mode',
  IN_TEST: 'in_test',
  VIEWING_RESULTS: 'viewing_results',
};

const sessions = {}; // Keyed by userId
const lastResults = {}; // Keyed by userId for post-test review
const userContext = {}; // Keyed by userId
const activeInlineMessages = {}; // Keyed by chatId: [msgId1, msgId2, ...]

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

/**
 * Validates callback to prevent old/stale button presses.
 */
function isCallbackValid(callbackQuery) {
  const messageDate = callbackQuery.message.date * 1000;
  const now = Date.now();
  
  // Reject callbacks older than 5 minutes
  if (now - messageDate > 5 * 60 * 1000) {
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// KEYBOARD MANAGEMENT (CRITICAL FIXES)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Edits all tracked inline keyboard messages to remove the buttons.
 * This fixes the "old keys still working" bug.
 */
async function clearAllInlineKeyboards(chatId) {
  const msgIds = activeInlineMessages[chatId] || [];
  
  const clearPromises = msgIds.map(msgId => 
    bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: msgId }
    ).catch(() => {}) // Ignore errors (message deleted, too old, etc.)
  );
  
  await Promise.all(clearPromises);
  activeInlineMessages[chatId] = [];
}

/**
 * Tracks a new message containing an inline keyboard.
 */
function trackInlineMessage(chatId, msgId) {
  if (!activeInlineMessages[chatId]) {
    activeInlineMessages[chatId] = [];
  }
  activeInlineMessages[chatId].push(msgId);
  
  // Keep only the last 10-20 to prevent memory bloat
  if (activeInlineMessages[chatId].length > 15) {
    activeInlineMessages[chatId].shift(); 
  }
}

/**
 * Send message with inline keyboard and track it.
 */
async function sendWithInlineKeyboard(chatId, text, options = {}) {
  const sentMsg = await bot.sendMessage(chatId, text, options);
  if (options.reply_markup?.inline_keyboard) {
    trackInlineMessage(chatId, sentMsg.message_id);
  }
  return sentMsg;
}

// ═══════════════════════════════════════════════════════════════════════
// MULTILINGUAL UI TEXT (Full Integration)
// ═══════════════════════════════════════════════════════════════════════

const uiText = {
  en: {
    langName: "English",
    startGreeting: "🙏 Welcome, my dear student!\n\nI'm not just a bot—I'm your *personal English mentor* for KARTET.",
    startSub: "First, let's talk in the language that feels most like home to you.\n\n_The questions will be in English (just like the exam), but I'll guide you in your native language._",
    chooseLanguage: "Which language feels most natural for you?",

    langEnglishButton: "🇬🇧 English",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    welcomeMain: "I'm here with you every day. 💙\n\nTogether, with small, consistent steps, we will master *English Language II*.\n\nNo rush. No pressure. Just continuous improvement.",

    todaysPracticeButton: "🎯 Today's Practice",
    myProgressButton: "📊 My Journey",
    myWeakAreasButton: "🔍 Focus Topics",
    moreOptionsButton: "📂 More Options",

    mainMenuIntro: "What would you like to do today?",

    premiumLangPitch:
      "🌟 *Learn in Your Mother Tongue*\n\n" +
      "I see you prefer a regional language. I deeply respect that.\n\n" +
      "Mentor+ allows me to explain everything in your language—just like a teacher sitting next to you.\n\n" +
      "*What Mentor+ unlocks:*\n" +
      "• Unlimited practice (no daily limit)\n" +
      "• Full explanations in your chosen language\n" +
      "• Detailed topic breakdown\n" +
      "• One-on-one doubt clarification\n\n" +
      "But the truth is: even in English, I will do my best for your success. Many teachers have passed KARTET with me using the free plan.\n\n" +
      "The choice is yours. I'm with you either way. 💙",

    upgradeButton: "⭐ Explore Mentor+",
    continueEnglishButton: "➡️ Continue in English",

    testFinished: "✅ *You have completed the test!*",
    summaryHeading: "📊 *Let's see how you did*",
    scoreLabel: "Score",
    attemptedLabel: "Attempted",
    skippedLabel: "Skipped",
    wrongLabel: "Wrong",
    accuracyLabel: "Accuracy",

    topicPerfTitle: "📚 *Performance by Topic*",
    weakTopicsTitle: "🎯 *Topics that need your love*",
    rightAnswersTitle: "✅ *Questions you got right*",
    wrongAnswersTitle: "💡 *Learning from Mistakes*",
    wrongPreviewTitle: "👀 *Quick look at Mistakes*",

    noTopicsYet: "Not enough data yet. Take a few more tests, and I'll map your strengths.",
    noWeakTopics: "Honestly? You're doing great in all topics. Keep this standard! 🌟",
    noWrongAnswers: "✅ Perfect score!\n\nYou are exam ready in this area. Beautiful work! 🎉",
    noRightAnswers: "This was a tough one, I know.\n\nBut here's what I learned about you: You show up. And that is the most important thing.\n\nLet's review these concepts together.",

    freeLimitReached:
      "⏰ *Today's free practice is complete*\n\n" +
      `You have practiced ${MINI_TEST_SIZE} questions today.\n\n` +
      "I want to tell you this:\n" +
      "• Even 5 questions a day is 150 questions a month\n" +
      "• Consistency beats intensity, every time\n" +
      "• Many have passed KARTET using only the free plan\n\n" +
      "Come back tomorrow. I'll be here, with the same dedication. 💙",

    // Encouragement messages
    comebackMessage: "Welcome back! I was looking forward to seeing you today. 😊",
    streakBreakMessage: "I noticed you didn't come yesterday.\n\nThat's okay. Life happens.\n\nThe important thing is you are here now. Let's start fresh. 🌅",
    firstTestEver: "This is your very first test with me.\n\nRemember: Everyone has to start somewhere.\n\nNo score is wrong today—it's just a starting point. 💙",
  },

  // START OF KANNADA TEXT INTEGRATION
  kn: {
    langName: "ಕನ್ನಡ",
    startGreeting: "🙏 ಸ್ವಾಗತ, ನನ್ನ ಆತ್ಮೀಯ ವಿದ್ಯಾರ್ಥಿ!\n\nನಾನು ಕೇವಲ ಒಂದು ಬಾಟ್ ಅಲ್ಲ—ನಾನು KARTET ಗಾಗಿ ನಿಮ್ಮ *ವೈಯಕ್ತಿಕ ಇಂಗ್ಲಿಷ್ ಮಾರ್ಗದರ್ಶಕ*.",
    startSub: "ಮೊದಲಿಗೆ, ನಿಮಗೆ ಮನೆಯಂತಹ ಭಾವನೆ ನೀಡುವ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡೋಣ.\n\n_ಪ್ರಶ್ನೆಗಳು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿರುತ್ತವೆ (ಪರೀಕ್ಷೆಯಂತೆಯೇ), ಆದರೆ ನಾನು ನಿಮ್ಮ ಮಾತೃಭಾಷೆಯಲ್ಲಿ ನಿಮಗೆ ಮಾರ್ಗದರ್ಶನ ನೀಡುತ್ತೇನೆ._",
    chooseLanguage: "ನಿಮಗೆ ಯಾವ ಭಾಷೆ ಹೆಚ್ಚು ಸಹಜವೆಂದು ಅನಿಸುತ್ತದೆ?",

    langEnglishButton: "🇬🇧 English",
    langKannadaButton: "🇮🇳 ಕನ್ನಡ (Mentor+)",
    langUrduButton: "🇮🇳 اردو (Mentor+)",

    welcomeMain: "ನಾನು ಪ್ರತಿದಿನವೂ ನಿಮ್ಮೊಂದಿಗೆ ಇರುತ್ತೇನೆ. 💙\n\nನಾವು ಒಟ್ಟಾಗಿ, ಸಣ್ಣ ಮತ್ತು ಸ್ಥಿರ ಹೆಜ್ಜೆಗಳೊಂದಿಗೆ *ಇಂಗ್ಲಿಷ್ ಭಾಷೆ II* ಅನ್ನು ಕರಗತ ಮಾಡಿಕೊಳ್ಳೋಣ.\n\nಯಾವುದೇ ಆತುರವಿಲ್ಲ. ಯಾವುದೇ ಒತ್ತಡವಿಲ್ಲ. ಕೇವಲ ನಿರಂತರ ಸುಧಾರಣೆ.",

    todaysPracticeButton: "🎯 ಇಂದಿನ ಅಭ್ಯಾಸ",
    myProgressButton: "📊 ನನ್ನ ಪ್ರಯಾಣ",
    myWeakAreasButton: "🔍 ಗಮನ ಹರಿಸಬೇಕಾದ ವಿಷಯಗಳು",
    moreOptionsButton: "📂 ಹೆಚ್ಚಿನ ಆಯ್ಕೆಗಳು",

    mainMenuIntro: "ಇಂದು ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?",

    premiumLangPitch:
      "🌟 *ನಿಮ್ಮ ಮಾತೃಭಾಷೆಯಲ್ಲಿ ಕಲಿಯಿರಿ*\n\n" +
      "ನೀವು ಪ್ರಾದೇಶಿಕ ಭಾಷೆಯನ್ನು ಬಯಸುತ್ತೀರಿ ಎಂದು ನನಗೆ ತಿಳಿದಿದೆ. ನಾನು ಅದನ್ನು ಆಳವಾಗಿ ಗೌರವಿಸುತ್ತೇನೆ.\n\n" +
      "Mentor+ ನನಗೆ ಎಲ್ಲವನ್ನೂ ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ವಿವರಿಸಲು ಅನುಮತಿಸುತ್ತದೆ—ನೀವು ಒಬ್ಬ ಶಿಕ್ಷಕರೊಂದಿಗೆ ಪಕ್ಕದಲ್ಲಿ ಕುಳಿತಿರುವಂತೆ.\n\n" +
      "*Mentor+ ನಿಮಗೆ ಏನು ನೀಡುತ್ತದೆ:*\n" +
      "• ಅನಿಯಮಿತ ಅಭ್ಯಾಸ (ದೈನಂದಿನ ಮಿತಿ ಇಲ್ಲ)\n" +
      "• ನಿಮ್ಮ ಆಯ್ದ ಭಾಷೆಯಲ್ಲಿ ಪೂರ್ಣ ವಿವರಣೆಗಳು\n" +
      "• ವಿವರವಾದ ವಿಷಯ ವಿಶ್ಲೇಷಣೆ\n" +
      "• ಒಂದು-ಒಂದರಲ್ಲಿ ಸಂದೇಹ ಸ್ಪಷ್ಟೀಕರಣ\n\n" +
      "ಆದರೆ ಸತ್ಯವೇನೆಂದರೆ: ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿಯೂ ಸಹ, ನಿಮ್ಮ ಯಶಸ್ಸಿಗಾಗಿ ನಾನು ನನ್ನ ಅತ್ಯುತ್ತಮ ಪ್ರಯತ್ನ ಮಾಡುತ್ತೇನೆ. ಅನೇಕ ಶಿಕ್ಷಕರು ಉಚಿತ ಯೋಜನೆಯನ್ನು ಬಳಸಿ ನನ್ನೊಂದಿಗೆ KARTET ಪಾಸ್ ಮಾಡಿದ್ದಾರೆ.\n\n" +
      "ಆಯ್ಕೆ ನಿಮ್ಮದು. ನಾನು ಎರಡರಲ್ಲೂ ನಿಮ್ಮೊಂದಿಗೆ ಇರುತ್ತೇನೆ. 💙",

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
    noRightAnswers: "ಇದು ಕಠಿಣವಾಗಿತ್ತು, ನನಗೆ ಗೊತ್ತು.\n\nಆದರೆ ನಾನು ನಿಮ್ಮ ಬಗ್ಗೆ ಕಲಿತದ್ದು: ನೀವು ಹಾಜರಾಗುತ್ತೀರಿ. ಮತ್ತು ಅದು ಅತ್ಯಂತ ಮುಖ್ಯವಾದುದು.\n\nಪರಿಕಲ್ಪನೆಗಳನ್ನು ಒಟ್ಟಾಗಿ ಪರಿಶೀಲಿಸೋಣ.",

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

  // START OF URDU TEXT INTEGRATION
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

// const fs = require("fs"); // REMOVED: Declaration is at the top of the file.
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
  const lang = user.prefs.lang || 'en'; // Use the user's preferred language
  const percentage = total === 0 ? 0 : (score / total);
  
  const pack = motivation[lang] || motivation['en'];
  
  // Custom logic: if streak is high but accuracy is low, give personalized feedback
  if (user.stats.streak >= 7 && percentage < 0.6) {
    return (lang === 'kn') ? 
           "ನೀವು ಸ್ಥಿರವಾಗಿ ಬರುತ್ತಿದ್ದೀರಿ—ಇದು ಅತ್ಯಂತ ಕಷ್ಟಕರ ಭಾಗ. ಈಗ ನಿಖರತೆಯ ಮೇಲೆ ಗಮನ ಹರಿಸೋಣ. 🧠" : 
           (lang === 'ur') ? 
           "آپ مسلسل آ رہے ہیں—یہ سب سے مشکل حصہ ہے۔ اب درستگی پر توجہ مرکوز کرتے ہیں۔ 🧠" :
           "You're showing up consistently—that's the hardest part. Now let's focus on accuracy. 🧠";
  }

  // Time-based encouragement
  const hour = new Date().getHours();
  if (hour >= 22 || hour <= 5) {
      return (lang === 'kn') ?
             "ರಾತ್ರಿ ಅಧ್ಯಯನ? ಸಾಕಷ್ಟು ನಿದ್ರೆಯನ್ನು ಸಹ ಪಡೆಯಿರಿ. ವಿಶ್ರಾಂತ ಮನಸ್ಸು ಉತ್ತಮವಾಗಿ ಕಲಿಯುತ್ತದೆ. 🌙" :
             (lang === 'ur') ?
             "دیر رات پڑھائی؟ یقینی بنائیں کہ آپ کافی نیند بھی لیں۔ آرام دہ دماغ بہتر سیکھتا ہے۔ 🌙" :
             "Late night studying? Make sure to get enough sleep too. Rested minds learn better. 🌙";
  }
  
  // Default motivation based on performance
  if (percentage >= 0.8) return pack.high[Math.floor(Math.random() * pack.high.length)];
  if (percentage >= 0.5) return pack.med[Math.floor(Math.random() * pack.med.length)];
  return pack.low[Math.floor(Math.random() * pack.low.length)];
}

function getProgressBar(current, total) {
  const filled = Math.round((current / total) * 10);
  const empty = 10 - filled;
  // Use emojis for better visualization (UX Improvement 2)
  return "🟩".repeat(filled) + "⬜".repeat(empty) + ` (${current}/${total})`; 
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
      
      setUserState(userId, UserState.IDLE);
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

  // Prepare Questions (2 Wrong History + 3 New) - Smart Revision Prompts
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
  
  if (mode !== 'mixed') {
    pool = questions.filter(q => (q.topicId || "").toLowerCase().includes(mode) || (q.categoryId || "").toLowerCase().includes(mode));
    if (pool.length === 0) pool = questions;
  }

  const selectedIds = new Set(testQuestions.map(q => q.id));
  const newPool = pool.filter(q => !selectedIds.has(q.id));
  
  const needed = MINI_TEST_SIZE - testQuestions.length;
  const newQuestions = shuffleArray(newPool).slice(0, needed);
  
  testQuestions = [...testQuestions, ...newQuestions];

  // Initialize Session using userId as key (CRITICAL FIX)
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

  await clearAllInlineKeyboards(chatId); // Fix keyboard bug before sending new question

  let text = `*Question ${progress}/${total}*\n\n`;
  
  if (q.passage) {
    text += `📜 *Passage:*\n_${q.passage}_\n\n`;
  }
  
  text += `❓ ${q.question}\n\n`;
  
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
  const wrong = attempted - score;

  // 1. Update Persistent Stats & Streak (Priority 2: Data Integrity)
  const today = new Date().toISOString().slice(0, 10);
  let streak = user.stats.streak;
  
  if (user.stats.lastTestDate) {
    const lastDate = new Date(user.stats.lastTestDate);
    const diffTime = Math.abs(new Date(today) - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    if (diffDays === 1) streak++; 
    else if (diffDays > 1) streak = 1; 
  } else {
    streak = 1; 
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
  currentWrongBank = [...new Set([...currentWrongBank, ...wrongIds])]; 
  currentWrongBank = currentWrongBank.filter(id => !correctIds.includes(id));
  
  updateUserData(userId, { wrongBank: currentWrongBank });

  // 3. Build Result Message (UX Improvement 2 & 3)
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
  msg += `*Mentor Note:* _${motivationLine}_\n`;

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

  // Clear Session & Set State
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

// UX Improvement 4: /reset command
bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    clearUserState(userId);
    delete sessions[userId];
    await clearAllInlineKeyboards(chatId);
    await bot.sendMessage(chatId, "🛠️ Session cleared. You can start fresh.");
    await showMainMenu(chatId, userId);
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // UX Improvement 4: Clear stuck sessions
  clearUserState(userId); 
  await clearAllInlineKeyboards(chatId);
  
  const user = getUserData(userId);
  
  if (!user.prefs.lang) {
    // Onboarding Flow Step 1: Language selection
    setUserState(userId, UserState.CHOOSING_LANGUAGE);
    const text = `${uiText.en.startGreeting}\n\n${uiText.en.startSub}\n\n*${uiText.en.chooseLanguage}*`;
    await sendWithInlineKeyboard(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: buildLanguageKeyboard()
    });
  } else {
    // Human Touch: Check for streak break or comeback
    const today = new Date().toISOString().slice(0, 10);
    let welcomeMsg = "";
    
    if (user.stats.totalAttempts === 0) {
        welcomeMsg = t(userId, "firstTestEver");
    } else if (user.stats.lastTestDate) {
      const last = new Date(user.stats.lastTestDate);
      const diff = Math.abs(new Date(today) - last);
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
      
      if (days === 1) welcomeMsg = t(userId, "comebackMessage");
      if (days > 1) welcomeMsg = t(userId, "streakBreakMessage");
    }

    if (welcomeMsg) {
      await bot.sendMessage(chatId, welcomeMsg);
    }

    // UX Improvement 1: Quick Tutorial for returning user (Skip if already seen)
    if (user.stats.totalAttempts < 3) {
      await bot.sendMessage(chatId, "📚 *Quick Tip:*\nFree plan gives 1 mini-test (5Q) per day. Consistency is the key to cracking KARTET! Ready? 👇");
    }

    setUserState(userId, UserState.IDLE);
    await showMainMenu(chatId, userId);
  }
});

bot.on("callback_query", async (query) => {
  try {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    // 1. Validation (CRITICAL FIXES: State Machine)
    if (!isCallbackValid(query)) {
      await bot.answerCallbackQuery(query.id, { text: "This button is stale or the session expired. Use /start again.", show_alert: true });
      return;
    }

    // 2. Language Selection
    if (data.startsWith("set_lang_")) {
      await bot.answerCallbackQuery(query.id); // Answer query immediately
      const lang = data.split("_")[2];
      
      if ((lang === 'kn' || lang === 'ur') && !isPremiumUser(userId)) {
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
      
      // Onboarding Flow Step 2 & 3: Quick Tutorial & Main Menu
      await bot.sendMessage(chatId, "📚 *Quick Tutorial*\n\n1. This bot helps you practice KARTET English daily.\n2. *Free Plan:* 1 mini-test (5 questions) per day.\n3. Ready? Let's start practice or check your progress!");

      setUserState(userId, UserState.IDLE);
      await showMainMenu(chatId, userId);
      return;
    }

    // 3. Main Menu Actions
    if (data === "menu_practice") {
      await bot.answerCallbackQuery(query.id);
      await startDailyPracticeTest(chatId, userId);
      return;
    }

    if (data === "menu_progress") {
      await bot.answerCallbackQuery(query.id);
      const user = getUserData(userId);
      const accuracy = user.stats.totalAttempts > 0 ? Math.round((user.stats.totalCorrect/user.stats.totalAttempts)*100) : 0;
      
      const text = `📊 *${t(userId, "myProgressButton")}*\n\n` +
                   `🔥 Current Streak: *${user.stats.streak} days*\n` +
                   `📝 Total Questions Attempted: *${user.stats.totalAttempts}*\n` +
                   `✅ Overall Accuracy: *${accuracy}%*\n\n` +
                   `Keep going! You are building a powerful habit.`;
      
      await sendWithInlineKeyboard(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Menu", callback_data: "done_results" }]] }
      });
      return;
    }
    
    // 4. Test Logic (Answers)
    if (data.includes(":")) {
      const session = sessions[userId];
      
      if (!session || getUserState(userId) !== UserState.IN_TEST) {
         await bot.answerCallbackQuery(query.id, { text: "Session invalid. Please use /start.", show_alert: true });
         return;
      }

      // Handle Skip/Finish
      if (data.startsWith("skip:")) {
         await bot.answerCallbackQuery(query.id, { text: "Skipped" });
         session.currentIndex++;
      } else if (data.startsWith("finish:")) {
         await bot.answerCallbackQuery(query.id, { text: "Finishing test..." });
         // No index increment, will go straight to result
      } else {
        // Handle Answer
        const [qIdxStr, optIdxStr] = data.split(":");
        const qIdx = parseInt(qIdxStr);
        const optIdx = parseInt(optIdxStr);

        if (qIdx !== session.currentIndex) {
          await bot.answerCallbackQuery(query.id, { text: "Old question. Answering the current one.", show_alert: false });
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
      }
      
      // Check if test is over
      if (session.currentIndex >= session.questions.length) {
        await sendResult(chatId, userId);
      } else {
        await sendQuestion(chatId, userId);
      }
      return;
    }

    // 5. Post-Test Review & Menu Return
    if (data === "view_wrong") {
       await bot.answerCallbackQuery(query.id);
       const lastSession = lastResults[userId];
       if (!lastSession) return;
       
       const wrongs = lastSession.answers.filter(a => !a.isCorrect);
       if (wrongs.length === 0) {
         await bot.answerCallbackQuery(query.id, { text: t(userId, "noWrongAnswers"), show_alert: true });
         return;
       }

       let text = `*${t(userId, "wrongPreviewTitle")}* (${wrongs.length} mistakes)\n\n`;
       
       // UX Improvement: Show explanation in user's language (if premium)
       const isPremium = isPremiumUser(userId);
       const lang = getUserData(userId).prefs.lang;
       
       wrongs.forEach(a => {
         const q = lastSession.questions[a.qIndex];
         text += `--- *Q: ${q.id}* ---\n`;
         text += `❓ ${q.question}\n`;
         text += `❌ Your Answer: ${q.options[a.chosen]}\n`;
         text += `✅ Correct: *${q.options[q.correctIndex]}*\n`;
         
         if (isPremium && q.explanation && lang !== 'en') {
             // Placeholder for translated explanation (Future Enhancement)
             text += `🌐 Explanation (in ${lang}): [Translation Placeholder]\n`;
         } else if (q.explanation) {
             text += `💡 Explanation: ${q.explanation}\n`;
         }
         text += "\n";
       });

       await sendWithInlineKeyboard(chatId, text, {
         parse_mode: "Markdown",
         reply_markup: { inline_keyboard: [[{ text: "⬅️ Menu", callback_data: "done_results" }]] }
       });
       return;
    }

    if (data === "done_results") {
      await bot.answerCallbackQuery(query.id);
      setUserState(userId, UserState.IDLE);
      await showMainMenu(chatId, userId);
      return;
    }

    if (data === "upgrade_dummy") {
        await bot.answerCallbackQuery(query.id, { text: "Mentor+ features are coming soon! Keep practicing.", show_alert: true });
        return;
    }
    
  } catch (err) {
    console.error("❌ Error in callback_query handler:", err);
    // Error Recovery: Send a helpful message
    await bot.sendMessage(chatId, `Oops! Something went wrong. If you're stuck, please try the /reset command. (Error: ${err.message})`);
  }
});

console.log("🤖 KARTET Mentor Bot is running...");
