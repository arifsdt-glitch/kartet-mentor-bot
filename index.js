// index.js

const TelegramBot = require("node-telegram-bot-api");

// ================== CONFIG ==================

// Load English Language II questions
// Make sure this file exists and is valid JSON
const questions = require("./eng_questions.json");

// Premium users (hard-coded for now)
// Add your own Telegram user id here
const premiumUsers = new Set([
  437248254, // example: your id
  // add more ids...
]);

function isPremiumUser(userId) {
  return premiumUsers.has(userId);
}

// Free-plan limits
const FREE_DAILY_MINI_TESTS = 1; // 1 test per day
const MINI_TEST_SIZE = 5;        // 5 questions per free test

// Sound config (Telegram file_id placeholders)
// Step:
// 1. Send a short sound to your bot
// 2. Read the file_id from update
// 3. Paste here
const CORRECT_SOUND_FILE_ID = ""; // e.g. "CQACAgUAAxkBA....."
const WRONG_SOUND_FILE_ID   = ""; // e.g. "CQACAgUAAxkBA....."

// Telegram bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// In-memory stores
const sessions   = {};  // per-chat active test
const lastResults = {}; // per-chat last finished test
const userStats  = {};  // per-user aggregated stats
const userPrefs  = {};  // per-chat preferences: { eng2Mode: 'rc' | 'grammar' | ... }

const letters = ["a", "b", "c", "d"];

// Simple, clean reactions
const correctReactions = ["✅", "🎉", "👏", "🌟"];
const wrongReactions   = ["❌", "😕", "🤔", "📘 Revise this"];

// Main menu keyboard
const mainMenu = {
  reply_markup: {
    keyboard: [
      ["📝 Daily Practice Test", "📚 Full Mock Test"],
      ["🏆 Leaderboard", "❓ Help"],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

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
    const cat   = (q.categoryId || "").toLowerCase();
    const topic = (q.topicId   || "").toLowerCase();

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
      return (
        cat.includes("poetry") ||
        cat.includes("poem") ||
        topic.includes("poem")
      );
    }

    if (lcMode === "pedagogy") {
      return cat.includes("pedagogy") || topic.includes("pedagogy");
    }

    if (lcMode === "vocab") {
      return (
        cat.includes("vocab") ||
        cat.includes("vocabulary") ||
        topic.includes("vocab")
      );
    }

    // fallback
    return true;
  });
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
      mainMenu,
    );
    return;
  }

  const basePool    = prevResult.questionsPool || questions;
  const wrongAnswers = prevResult.answers.filter((a) => !a.correct);
  const uniqueIndices = Array.from(new Set(wrongAnswers.map((a) => a.qIndex)));

  const wrongPool = uniqueIndices
    .map((idx) => basePool[idx])
    .filter((q) => Boolean(q));

  if (!wrongPool.length) {
    bot.sendMessage(
      chatId,
      "Super! You got everything correct in the last test.\nNo wrong-only retest needed. 🎉",
      mainMenu,
    );
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

  bot.sendMessage(
    chatId,
    "Starting a test with only your previous wrong questions. 🔁",
  );

  sendQuestion(chatId);
}

// Ask user which type of English they want
function askEnglishMode(chatId, user) {
  const name = getDisplayName(user);

  const text =
    `Hi ${name}! 👋\n` +
    "You chose *English Language – II*.\n" +
    "Namma practice na swalpa personalise maadona. 😊\n\n" +
    "What would you like to practise today?";

  const inlineKeyboard = [
    [{ text: "📖 Reading Comprehension", callback_data: "eng2_mode_rc" }],
    [{ text: "✍️ Grammar & Structure", callback_data: "eng2_mode_grammar" }],
    [{ text: "🎵 Poetry", callback_data: "eng2_mode_poetry" }],
    [{ text: "🧑‍🏫 Pedagogy", callback_data: "eng2_mode_pedagogy" }],
    [{ text: "📚 Vocabulary", callback_data: "eng2_mode_vocab" }],
    [{ text: "🎲 Mixed (All Types)", callback_data: "eng2_mode_mixed" }],
  ];

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

// Start daily practice (uses mode + free vs premium logic)
function startDailyPracticeTest(chatId, user) {
  const userId = user.id;

  // Read chosen mode (default: mixed)
  const prefs = userPrefs[chatId] || {};
  const mode  = prefs.eng2Mode || "mixed";

  // Filter questions based on mode
  const filteredPool  = filterQuestionsByMode(questions, mode);
  const effectivePool = filteredPool.length ? filteredPool : questions;

  // Premium users → unlimited, full pool (within mode)
  if (isPremiumUser(userId)) {
    startTest(chatId, user, effectivePool, false);
    return;
  }

  // Free users → 1 mini-test per day
  const today = new Date().toISOString().slice(0, 10);

  if (!userStats[userId]) {
    userStats[userId] = {
      id: userId,
      name: getDisplayName(user),
      attempts: 0,
      bestScore: 0,
      lastScore: 0,
      lastFreeDate: null,
      freeTestsToday: 0,
    };
  }

  const stats = userStats[userId];

  // Reset daily counter if new day
  if (stats.lastFreeDate !== today) {
    stats.lastFreeDate = today;
    stats.freeTestsToday = 0;
  }

  if (stats.freeTestsToday >= FREE_DAILY_MINI_TESTS) {
    bot.sendMessage(
      chatId,
      `⚠️ Free limit reached for today.\n\n` +
        `You already used your free ${MINI_TEST_SIZE}-question practice test.\n\n` +
        `Free plan:\n` +
        `• 1 mini-test (${MINI_TEST_SIZE} questions) per day\n\n` +
        `To unlock full access, ask about *Mentor+* after your exam prep. 🙂`,
      { parse_mode: "Markdown", ...mainMenu },
    );
    return;
  }

  stats.freeTestsToday += 1;

  const pretty   = getPrettyModeName(mode);
  const dailyPool = effectivePool.slice(0, MINI_TEST_SIZE);

  bot.sendMessage(
    chatId,
    `📝 Starting today’s *free* ${MINI_TEST_SIZE}-question practice test\nin *${pretty}*...`,
    { parse_mode: "Markdown" },
  );

  startTest(chatId, user, dailyPool, true);
}

function sendQuestion(chatId) {
  const session = sessions[chatId];
  if (!session) return;

  const pool   = session.questionsPool || questions;
  const qIndex = session.currentIndex;

  if (qIndex >= pool.length) {
    sendResult(chatId);
    return;
  }

  const q     = pool[qIndex];
  const total = pool.length;

  let text = `Q${qIndex + 1}/${total}\n\n`;

  // Show passage / poem first if any
  if (q.passage && typeof q.passage === "string" && q.passage.trim().length > 0) {
    text += `📜 *Passage / Poem:*\n${q.passage}\n\n`;
  }

  // Question
  text += `❓ ${q.question}\n\n`;

  // Options
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
  const topicStats = {}; // key: subject|category|topic

  result.answers.forEach((a) => {
    const subjectId  = a.subjectId || "NA_SUBJ";
    const categoryId = a.categoryId || "NA_CAT";
    const topicId    = a.topicId || "NA_TOPIC";
    const key        = `${subjectId}|${categoryId}|${topicId}`;

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

function formatSummaryMessage(result) {
  const pool          = result.questionsPool || questions;
  const totalQuestions = pool.length;
  const attempted     = result.answers.length;
  const correct       = result.answers.filter((a) => a.correct).length;
  const wrong         = attempted - correct;
  const skipped       = totalQuestions - attempted;
  const accuracy      = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  const bar           = makeProgressBar(correct, attempted, 10);

  let msg = "";

  msg += "✅ *Test finished!*\n\n";
  msg += "📊 *Summary*\n\n";
  msg += `⭐ Score: ${correct}/${attempted}\n`;
  msg += `🧪 Attempted: ${attempted}/${totalQuestions}\n`;
  msg += `⏭️ Skipped: ${skipped}\n`;
  msg += `❌ Wrong: ${wrong}\n`;
  msg += `🎯 Accuracy (on attempted): ${accuracy}%\n\n`;
  msg += `Progress: ${bar}\n`;

  if (accuracy === 100 && attempted > 0) {
    // 100% Score
    msg += "\n🤯 **KARTET Ace!** Amazing performance! You've mastered this area. Now, move to a different mode (like Pedagogy or RC) to challenge yourself further. 🚀";
  } else if (accuracy >= 80) {
    // High Performer (80%-99%)
    msg += "\n🔥 **Superb Effort!** Very good! You are on track, maga/magalu. Just polish the few areas you slipped on, and perfection is next! 😊";
  } else if (accuracy >= 40) {
    // Steady Progress (40%-79%)
    msg += "\n👍 **Good Attempt!** This is where the real learning happens. Focus on the wrong answers right now, revise those topics, and turn them into strengths. 💪";
  } else if (accuracy > 0 && accuracy < 40) {
    // Needs Foundation (1%-39%)
    msg += "\n📌 **Revision Needed.** It’s okay! Slow down a bit. We recommend revising the core concepts of your weakest topics before your next attempt. Steady practice is key. 🚶‍♂️";
  } else if (accuracy === 0 && attempted > 0) {
    // 0% Score
    msg += "\n😥 **Hosa Shuruwaat (New Beginning).** Don't worry, this is just the start. Take a break, review the basics of the subject, and come back for a fresh attempt when you feel ready. Keep going! ❤️";
  } else {
    // Default/Skipped (if attempted is 0)
    msg += "\nℹ️ **Tip:** To get a score, try to answer at least one question in your next attempt! 🙂";
  }

  return msg;
}

function formatRightAnswersMessage(result) {
  const pool        = result.questionsPool || questions;
  const rightAnswers = result.answers.filter((a) => a.correct);

  if (!rightAnswers.length) {
    return "You had no fully correct answers in this test.\nNext time it will be better. 💪";
  }

  let text = "✅ *Right Answers (with explanations)*\n\n";

  rightAnswers.forEach((ans, idx) => {
    const q = pool[ans.qIndex];
    if (!q) return;

    const correctOption = q.options[q.correctIndex];
    const correctLetter = letters[q.correctIndex];

    text += `Q${idx + 1}) ${q.question}\n`;
    text += `✔️ *Correct:* ${correctLetter}) ${correctOption}\n`;

    if (q.explanation) {
      text += "ℹ️ *Explanation:*\n";
      text += `• ${q.explanation}\n`;
    }

    text += "\n";
  });

  text +=
    "You can now check wrong answers, topic-wise performance, or retake wrong-only questions. 💡";
  return text;
}

function formatWrongAnswersMessage(result) {
  const pool         = result.questionsPool || questions;
  const wrongAnswers  = result.answers.filter((a) => !a.correct);

  if (!wrongAnswers.length) {
    return "🎉 No wrong answers in this test.\nExcellent work!";
  }

  let text = "❌ *Wrong Answers (with explanations & tips)*\n\n";

  wrongAnswers.forEach((ans, idx) => {
    const q = pool[ans.qIndex];
    if (!q) return;

    const correctOption = q.options[q.correctIndex];
    const correctLetter = letters[q.correctIndex];
    const chosenOption  =
      ans.chosen != null ? q.options[ans.chosen] : "No option selected";
    const chosenLetter  = ans.chosen != null ? letters[ans.chosen] : "-";

    text += `Q${idx + 1}) ${q.question}\n`;
    text += `🧷 *Your answer:* ${chosenLetter}) ${chosenOption}\n`;
    text += `✔️ *Correct:* ${correctLetter}) ${correctOption}\n`;

    if (q.explanation) {
      text += "ℹ️ *Explanation:*\n";
      text += `• ${q.explanation}\n`;
    }

    if (q.tip) {
      text += "🧑‍🏫 *Teaching tip:*\n";
      text += `• ${q.tip}\n`;
    }

    text += "\n";
  });

  text += "Try a wrong-only retake to fix these topics faster. 🔁";
  return text;
}

function formatWrongAnswersPreviewMessage(result) {
  const pool         = result.questionsPool || questions;
  const wrongAnswers  = result.answers.filter((a) => !a.correct);

  if (!wrongAnswers.length) {
    return (
      "🎉 No wrong answers in this test.\n\n" +
      "For full explanations and teaching tips for each question, Mentor+ will help later."
    );
  }

  let text = "❌ *Wrong Answers (preview)*\n\n";

  wrongAnswers.forEach((ans, idx) => {
    const q = pool[ans.qIndex];
    if (!q) return;

    const correctOption = q.options[q.correctIndex];
    const correctLetter = letters[q.correctIndex];
    const chosenOption  =
      ans.chosen != null ? q.options[ans.chosen] : "No option selected";
    const chosenLetter  = ans.chosen != null ? letters[ans.chosen] : "-";

    text += `Q${idx + 1}) ${q.question}\n`;
    text += `🧷 *Your answer:* ${chosenLetter}) ${chosenOption}\n`;
    text += `✔️ *Correct:* ${correctLetter}) ${correctOption}\n`;

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
    "Use this to see where you slipped, and then revise those areas. Namma steady progress style. 🚶‍♂️🚶‍♀️";
  return text;
}

function formatTopicStatsMessage(result) {
  const topicStats = result.topicStats || calculateTopicStats(result);
  const entries    = Object.values(topicStats);

  if (!entries.length) {
    return "📊 *Topic-wise performance*\n\nNot enough data to show topic-wise stats yet.";
  }

  let text = "📊 *Topic-wise performance*\n\n";

  entries.forEach((stat) => {
    const { subjectId, categoryId, topicId, attempted, correct } = stat;
    const accuracy = Math.round((correct / attempted) * 100);
    text += `• *${subjectId}* → _${categoryId}_ → ${topicId}\n`;
    text += `  ✅ ${correct}/${attempted} correct (${accuracy}%)\n\n`;
  });

  text += "Use this to decide which topics need more practice. 🎯";
  return text;
}

function formatWeakTopicsMessage(result) {
  const topicStats  = result.topicStats || calculateTopicStats(result);
  const weakTopics   = result.weakTopics || getWeakTopics(topicStats, 60, 2);

  if (!weakTopics.length) {
    return (
      "🧩 *Weak topics*\n\n" +
      "Right now, no clear weak topics (based on threshold).\nKeep maintaining this level, super!"
    );
  }

  let text = "🧩 *Weak topics (focus here first)*\n\n";

  weakTopics.forEach((w) => {
    text += `• *${w.subjectId}* → _${w.categoryId}_ → ${w.topicId}\n`;
    text += `  ✅ ${w.correct}/${w.attempted} correct (${w.accuracy}%)\n\n`;
  });

  text += "Kandita, revise these first and then move to strong areas. 💪";
  return text;
}

function buildReviewKeyboard(isPremium, hasWrong) {
  if (isPremium) {
    const inlineKeyboard = [
      [
        { text: "✅ Right answers",   callback_data: "view_right" },
        { text: "❌ Wrong answers",   callback_data: "view_wrong" },
      ],
      [
        { text: "📊 Topic-wise",      callback_data: "view_topics" },
        { text: "🧩 Weak topics",     callback_data: "view_weak_topics" },
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
      { text: "ℹ️ Mentor+ info",           callback_data: "upgrade_mentor" },
    ],
    [{ text: "🏠 Main Menu", callback_data: "done_results" }],
  ];

  return { inline_keyboard: inlineKeyboard };
}

// ================== RESULT & LEADERBOARD ==================

function sendResult(chatId) {
  const session = sessions[chatId];
  if (!session) return;

  const pool  = session.questionsPool || questions;
  const total = pool.length;
  const score = session.score;
  const user  = session.user;
  const userId = user.id;
  const name   = getDisplayName(user);
  const isPrem = isPremiumUser(userId);

  // Update leaderboard for normal tests
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
      };
    }

    const stats = userStats[userId];
    stats.name = name;
    stats.attempts += 1;
    stats.lastScore = score;
    if (score > stats.bestScore) {
      stats.bestScore = score;
    }
  }

  const baseResult = {
    answers: session.answers,
    questionsPool: pool,
  };

  const topicStats = calculateTopicStats(baseResult);
  const weakTopics = getWeakTopics(topicStats, 60, 2);

  lastResults[chatId] = {
    ...baseResult,
    topicStats,
    weakTopics,
  };

  const summaryText = formatSummaryMessage(lastResults[chatId]);
  const hasWrong    = lastResults[chatId].answers.some((a) => !a.correct);
  const reviewKeyboard = buildReviewKeyboard(isPrem, hasWrong);

  bot
    .sendMessage(chatId, summaryText, {
      parse_mode: "Markdown",
      reply_markup: reviewKeyboard,
    })
    .catch((err) => {
      console.error("Error sending result summary:", err);
      bot.sendMessage(
        chatId,
        `Test finished!\nScore: ${score}/${total}`,
        mainMenu,
      );
    });

  delete sessions[chatId];
}

function sendLeaderboard(chatId) {
  const list = Object.values(userStats);

  if (!list.length) {
    bot.sendMessage(
      chatId,
      "🏆 Leaderboard\n\nNo tests attempted yet.\nYou start first, nimage advantage. 😉\nTap *Daily Practice Test* to begin.",
      mainMenu,
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
    const badge = isPremiumUser(u.id) ? "💎 " : "";
    text += `${i + 1}. ${badge}${u.name} — Best: ${u.bestScore || 0}/${questions.length}, Attempts: ${u.attempts}\n`;
  });

  bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainMenu });
}

// ================== COMMANDS ==================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const welcome =
    "🙏 Namaskara! Welcome to *Namma KARTET English Mentor* (Language II)\n\n" +
    "I can help you with:\n" +
    "• Daily PYQ practice (mini-test) 📝\n" +
    "• Instant correct / wrong feedback ✅❌\n" +
    "• Simple summary with progress bar 📊\n" +
    "• RC / Grammar / Poetry / Pedagogy / Vocab wise practice 🎯\n\n" +
    "Free plan (for now):\n" +
    `• 1 mini-test (${MINI_TEST_SIZE} questions) per day\n` +
    "• Wrong answer preview + suggestions\n\n" +
    "Use the menu below or commands:\n" +
    "/dailytest – Start daily practice\n" +
    "/leaderboard – See top performers\n" +
    "/status – Check your plan (Free / Premium)\n" +
    "/help – How to use this bot\n";

  bot.sendMessage(chatId, welcome, {
    parse_mode: "Markdown",
    ...mainMenu,
  });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const help =
    "❓ *Help – Namma KARTET English Mentor*\n\n" +
    "Commands:\n" +
    "/start – Show main menu\n" +
    "/dailytest – Start a daily practice test (5Q free)\n" +
    "/leaderboard – View top performers\n" +
    "/status – Check whether you are Free or Premium\n\n" +
    "Daily flow idea:\n" +
    "1️⃣ Choose Daily Practice Test\n" +
    "2️⃣ Select area: RC / Grammar / Poetry / Pedagogy / Vocab / Mixed\n" +
    "3️⃣ Finish 5Qs mini-test\n" +
    "4️⃣ See summary, note weak areas, revise\n\n" +
    "Steady practice, small steps, nimage confidence barutte. 💪";

  bot.sendMessage(chatId, help, {
    parse_mode: "Markdown",
    ...mainMenu,
  });
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isPrem = isPremiumUser(userId);
  const name   = getDisplayName(msg.from);

  const status = isPrem ? "💎 Premium (Mentor+)" : "🟢 Free User";

  let message = "📋 *Your Account Status*\n\n";
  message += `👤 Name: *${name}*\n`;
  message += `📦 Plan: *${status}*\n\n`;

  if (isPrem) {
    message += "You have access to:\n";
    message += "• Unlimited tests & mocks\n";
    message += "• Full explanations & teaching tips\n";
    message += "• Topic-wise & weak-topic analysis\n";
    message += "• Wrong-only practice\n";
    message += "• 💎 Badge on leaderboard\n";
  } else {
    message += "Free plan:\n";
    message += `• 1 mini-test (${MINI_TEST_SIZE} questions) per day\n`;
    message += "• Score + accuracy summary\n";
    message += "• Wrong-answers explanation *preview*\n\n";
    message += "Later, you can decide about Premium based on your comfort. 🙂";
  }

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/dailytest/, (msg) => {
  const chatId = msg.chat.id;
  askEnglishMode(chatId, msg.from);
});

bot.onText(/\/leaderboard/, (msg) => {
  const chatId = msg.chat.id;
  sendLeaderboard(chatId);
});

// ================== MENU BUTTON TEXTS ==================

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text   = (msg.text || "").trim();

  if (text.startsWith("/")) return;

  if (text === "📝 Daily Practice Test") {
    askEnglishMode(chatId, msg.from);
  } else if (text === "📚 Full Mock Test") {
    bot.sendMessage(
      chatId,
      "Full mock tests (big papers) will be added later.\nFor now, use Daily Practice Test regularly. 📚",
      mainMenu,
    );
  } else if (text === "🏆 Leaderboard") {
    sendLeaderboard(chatId);
  } else if (text === "❓ Help") {
    const help =
      "❓ *Help – Namma KARTET English Mentor*\n\n" +
      "Use the menu:\n" +
      "📝 Daily Practice Test – Start English PYQ mini-test\n" +
      "📚 Full Mock Test – Coming later\n" +
      "🏆 Leaderboard – Top students/teachers\n" +
      "❓ Help – Show this message\n";

    bot.sendMessage(chatId, help, {
      parse_mode: "Markdown",
      ...mainMenu,
    });
  }
});

// ================== CALLBACKS ==================

bot.on("callback_query", async (callbackQuery) => {
  try {
    const data   = callbackQuery.data;
    const msg    = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const isPrem = isPremiumUser(userId);

    // ---- Mode selection (RC / Grammar / Poetry / Pedagogy / Vocab / Mixed) ----
    if (data && data.startsWith("eng2_mode_")) {
      const mode = data.replace("eng2_mode_", "");

      if (!userPrefs[chatId]) userPrefs[chatId] = {};
      userPrefs[chatId].eng2Mode = mode;

      const pretty = getPrettyModeName(mode);

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `Mode set to: ${pretty}`,
        show_alert: false,
      });

      await bot.sendMessage(
        chatId,
        `Nice! We’ll practise *${pretty}* questions now. 😊`,
        { parse_mode: "Markdown" },
      );

      startDailyPracticeTest(chatId, callbackQuery.from);
      return;
    }

    // ---- Skip current question ----
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
      const pressedIndex  = parseInt(qIndexStr, 10);

      if (pressedIndex !== session.currentIndex) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "This question is already handled.",
          show_alert: false,
        });
        return;
      }

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "Skipped. Moving ahead. ⏭️",
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

    // ---- Finish test early ----
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
      const pressedIndex  = parseInt(qIndexStr, 10);

      if (pressedIndex !== session.currentIndex) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "This question is already handled.",
          show_alert: false,
        });
        return;
      }

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "Finishing test with attempted questions. 🏁",
        show_alert: false,
      });

      sendResult(chatId);
      return;
    }

    // ---- Upgrade info ----
    if (data === "upgrade_mentor") {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "Sharing Mentor+ info...",
        show_alert: false,
      });

      const upg =
        "ℹ️ *Mentor+ (Premium) – Info*\n\n" +
        "This bot is still in testing phase.\n" +
        "Later, Mentor+ will unlock:\n" +
        "• Unlimited tests & full mocks\n" +
        "• Full explanations & teaching tips\n" +
        "• Topic-wise & weak-topic analysis\n" +
        "• Wrong-only practice\n" +
        "• 💎 Badge on leaderboard\n\n" +
        "For now, just focus on building consistency with the free mini-tests. ❤️";

      await bot.sendMessage(chatId, upg, { parse_mode: "Markdown" });
      return;
    }

    // ---- View right answers ----
    if (data === "view_right") {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: isPrem ? "Showing right answers..." : "Premium-only feature.",
        show_alert: false,
      });

      const result = lastResults[chatId];
      if (!result) {
        await bot.sendMessage(
          chatId,
          "No recent test found. Take a test first. 🙂",
          mainMenu,
        );
        return;
      }

      if (!isPrem) {
        await bot.sendMessage(
          chatId,
          "Full right-answer explanations will be part of Mentor+ later.\nRight now focus on wrong-answer previews and summary. 🙂",
          { parse_mode: "Markdown" },
        );
        return;
      }

      const text = formatRightAnswersMessage(result);
      const hasWrong = result.answers.some((a) => !a.correct);
      const keyboard = buildReviewKeyboard(true, hasWrong);

      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      return;
    }

    // ---- View wrong answers ----
    if (data === "view_wrong") {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: isPrem ? "Showing wrong answers..." : "Showing preview...",
        show_alert: false,
      });

      const result = lastResults[chatId];
      if (!result) {
        await bot.sendMessage(
          chatId,
          "No recent test found. Take a test first. 🙂",
          mainMenu,
        );
        return;
      }

      let text;
      let keyboard;
      if (isPrem) {
        text = formatWrongAnswersMessage(result);
        const hasWrong = result.answers.some((a) => !a.correct);
        keyboard = buildReviewKeyboard(true, hasWrong);
      } else {
        text = formatWrongAnswersPreviewMessage(result);
        const hasWrong = result.answers.some((a) => !a.correct);
        keyboard = buildReviewKeyboard(false, hasWrong);
      }

      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      return;
    }

    // ---- View topic-wise performance ----
    if (data === "view_topics") {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: isPrem ? "Showing topic-wise stats..." : "Premium-only feature.",
        show_alert: false,
      });

      const result = lastResults[chatId];
      if (!result) {
        await bot.sendMessage(
          chatId,
          "No recent test found. Take a test first.",
          mainMenu,
        );
        return;
      }

      if (!isPrem) {
        await bot.sendMessage(
          chatId,
          "Topic-wise performance view will be part of Mentor+.\nFor now, use the summary + wrong previews to guide revision. 🙂",
          { parse_mode: "Markdown" },
        );
        return;
      }

      const text = formatTopicStatsMessage(result);
      const hasWrong = result.answers.some((a) => !a.correct);
      const keyboard = buildReviewKeyboard(true, hasWrong);

      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      return;
    }

    // ---- View weak topics ----
    if (data === "view_weak_topics") {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: isPrem ? "Showing weak topics..." : "Premium-only feature.",
        show_alert: false,
      });

      const result = lastResults[chatId];
      if (!result) {
        await bot.sendMessage(
          chatId,
          "No recent test found. Take a test first.",
          mainMenu,
        );
        return;
      }

      if (!isPrem) {
        await bot.sendMessage(
          chatId,
          "Weak-topic analysis will be part of Mentor+.\nFor now, observe where you went wrong and revise those topics. 📚",
          { parse_mode: "Markdown" },
        );
        return;
      }

      const text = formatWeakTopicsMessage(result);
      const hasWrong = result.answers.some((a) => !a.correct);
      const keyboard = buildReviewKeyboard(true, hasWrong);

      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      return;
    }

    // ---- Retake wrong-only ----
    if (data === "retake_wrong") {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: isPrem ? "Starting wrong-only test..." : "Premium-only feature.",
        show_alert: false,
      });

      if (!isPrem) {
        await bot.sendMessage(
          chatId,
          "Wrong-only retake will be part of Mentor+.\nFor now, you can retake a fresh test in that topic area. 🙂",
          { parse_mode: "Markdown" },
        );
        return;
      }

      startWrongRetake(chatId, callbackQuery.from);
      return;
    }

    // ---- Back to main menu ----
    if (data === "done_results") {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "Back to main menu.",
        show_alert: false,
      });

      await bot.sendMessage(
        chatId,
        "Back to main menu. Choose your next step. 🏠",
        mainMenu,
      );
      return;
    }

    // ---- Answer handling ("qIndex:optIndex") ----
    if (!data.includes(":")) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "Unknown action.",
        show_alert: false,
      });
      return;
    }

    const session = sessions[chatId];
    if (!session) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "No active test. Type /dailytest to start.",
        show_alert: true,
      });
      return;
    }

    const [qIndexStr, optIndexStr] = data.split(":");
    const qIndex      = parseInt(qIndexStr, 10);
    const chosenIndex = parseInt(optIndexStr, 10);

    if (qIndex !== session.currentIndex) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "This question is already answered.",
        show_alert: false,
      });
      return;
    }

    const pool = session.questionsPool || questions;
    const q    = pool[qIndex];

    const isCorrect = chosenIndex === q.correctIndex;
    if (isCorrect) session.score++;

    session.answers.push({
      qIndex,
      chosen: chosenIndex,
      correctIndex: q.correctIndex,
      correct: isCorrect,
      subjectId: q.subjectId,
      categoryId: q.categoryId,
      topicId: q.topicId,
    });

    const reaction = isCorrect
      ? correctReactions[Math.floor(Math.random() * correctReactions.length)]
      : wrongReactions[Math.floor(Math.random() * wrongReactions.length)];

    await bot.answerCallbackQuery(callbackQuery.id, {
      text: isCorrect ? `Correct! ${reaction}` : `Wrong… ${reaction}`,
      show_alert: false,
    });

    // 🔊 Sound feedback
    if (isCorrect && CORRECT_SOUND_FILE_ID) {
      bot.sendAudio(chatId, CORRECT_SOUND_FILE_ID, { caption: "Correct ✅" });
    } else if (!isCorrect && WRONG_SOUND_FILE_ID) {
      bot.sendAudio(chatId, WRONG_SOUND_FILE_ID, { caption: "Wrong ❌" });
    }

    // Move to next question
    setTimeout(() => {
      const activeSession = sessions[chatId];
      if (!activeSession) return;

      const activePool = activeSession.questionsPool || questions;
      activeSession.currentIndex++;

      if (activeSession.currentIndex < activePool.length) {
        sendQuestion(chatId);
      } else {
        sendResult(chatId);
      }
    }, 700);
  } catch (err) {
    console.error("Callback error:", err);
  }
});

console.log(
  "✅ Namma KARTET English Mentor bot is running (with modes, emojis, and sound hooks).",
);
