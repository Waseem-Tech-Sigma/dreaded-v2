const fs = require("fs");
const wordListPath = require("word-list");
const words = fs.readFileSync(wordListPath, "utf-8").split("\n").map(w => w.trim().toLowerCase()).filter(w => w.length >= 3 && w.length <= 6 && /^[a-z]+$/.test(w));

const sessions = {}; 

function pickRandomWord() {
    const length = Math.floor(Math.random() * 4) + 3;
    const end = Math.random() < 0.5 ? null : String.fromCharCode(97 + Math.floor(Math.random() * 26));
    let pool = words.filter(w => w.length === length);
    if (end) pool = pool.filter(w => w.endsWith(end));
    if (pool.length === 0) return pickRandomWord();
    const word = pool[Math.floor(Math.random() * pool.length)];
    return { word, length, end };
}

module.exports = async (context) => {
    const { client, m, groupSender, prefix } = context;
    const groupId = m.chat;
    const senderId = m.sender;
    const text = m.text.trim();
    const args = text.split(" ").slice(1);

    if (!sessions[groupId]) {
        sessions[groupId] = {
            players: {},
            started: false,
            finished: false,
            questionCount: 0,
            currentAnswer: null,
            currentClue: null,
            currentMsgId: null,
            timeoutRef: null,
            listenerAttached: false
        };
    }

    const session = sessions[groupId];

    const sub = args[0]?.toLowerCase();

    if (!sub) {
        return await client.sendMessage(groupId, {
            text: `🧠 *Word Guessing Game*

2 players compete to guess the word based on a clue.

📘 *Commands:*
• ${prefix}gword join — join the game
• ${prefix}gword leave — leave the game
• ${prefix}gword scores — view scores
• ${prefix}gword start — start game with 2 players`
        }, { quoted: m });
    }

    if (sub === "join") {
        if (session.started) return await client.sendMessage(groupId, { text: `🚫 Game already started.`, mentions: [senderId] }, { quoted: m });
        if (session.players[senderId]) return await client.sendMessage(groupId, { text: `🕹️ You've already joined.`, mentions: [senderId] }, { quoted: m });
        if (Object.keys(session.players).length >= 2) return await client.sendMessage(groupId, { text: `❌ Game is full (2 players).`, mentions: [senderId] }, { quoted: m });

        session.players[senderId] = { score: 0 };
        const joined = Object.keys(session.players).map(jid => `@${jid.split("@")[0]}`).join(" and ");
        return await client.sendMessage(groupId, {
            text: `✅ ${joined} joined the game.`,
            mentions: Object.keys(session.players)
        }, { quoted: m });
    }

    if (sub === "leave") {
        if (!session.players[senderId]) return await client.sendMessage(groupId, { text: `🙅 You're not in this game.`, mentions: [senderId] }, { quoted: m });
        clearTimeout(session.timeoutRef);
        delete sessions[groupId];
        return await client.sendMessage(groupId, {
            text: `🚪 ${senderId.split("@")[0]} left. Game cancelled.`
        }, { quoted: m });
    }

    if (sub === "scores") {
        if (!session.started) return await client.sendMessage(groupId, { text: `ℹ️ Game hasn't started yet.`, mentions: [senderId] }, { quoted: m });
        const scoreText = Object.entries(session.players).map(([jid, p]) => `@${jid.split("@")[0]}: ${p.score}`).join("\n");
        return await client.sendMessage(groupId, {
            text: `📊 Scores:\n${scoreText}`,
            mentions: Object.keys(session.players)
        }, { quoted: m });
    }

    if (sub === "start") {
        if (session.started) return await client.sendMessage(groupId, { text: `🕹️ Game already in progress.`, mentions: [senderId] }, { quoted: m });
        const playerIds = Object.keys(session.players);
        if (playerIds.length < 2) return await client.sendMessage(groupId, { text: `❌ Need 2 players to start.`, mentions: [senderId] }, { quoted: m });

        session.started = true;
        await client.sendMessage(groupId, {
            text: `🎮 Game starting! First to answer correctly gets the point.\n⏱️ You have 40s per round.`,
            mentions: playerIds
        }, { quoted: m });

        askNextQuestion(groupId, context);
    }
};

async function askNextQuestion(groupId, context) {
    const { client } = context;
    const session = sessions[groupId];
    if (!session || session.finished) return;

    const { word, length, end } = pickRandomWord();
    session.currentAnswer = word;
    session.questionCount++;

    let clue = `🧠 Guess a ${length}-letter word`;
    if (end) clue += ` ending with "${end}"`;
    clue += `!`;
    session.currentClue = clue;

    const msg = await client.sendMessage(groupId, {
        text: clue,
        mentions: Object.keys(session.players)
    });
    session.currentMsgId = msg.key.id;

    if (!session.listenerAttached) {
        client.ev.on("messages.upsert", async (update) => {
            const message = update.messages?.[0];
            if (!message?.message || !sessions[groupId]?.started) return;
            const text = message.message.conversation || message.message.extendedTextMessage?.text;
            const from = message.key.remoteJid;
            const sender = message.key.participant || message.key.remoteJid;
            const body = text?.trim().toLowerCase();

            if (from !== groupId || !Object.keys(session.players).includes(sender)) return;
            if (!body || body.length < 3 || body.length > 6) return;

            if (body === session.currentAnswer) {
                clearTimeout(session.timeoutRef);
                session.players[sender].score++;
                await client.sendMessage(groupId, {
                    text: `✅ @${sender.split("@")[0]} got it right! The word was *${session.currentAnswer}*.`,
                    mentions: [sender]
                }, { quoted: message });

                if (session.questionCount >= 10) {
                    session.finished = true;
                    const scoreText = Object.entries(session.players).map(([jid, p]) => `@${jid.split("@")[0]}: ${p.score}`).join("\n");
                    await client.sendMessage(groupId, {
                        text: `🏁 Game Over!\n\n📊 Final Scores:\n${scoreText}`,
                        mentions: Object.keys(session.players)
                    });
                    delete sessions[groupId];
                } else {
                    askNextQuestion(groupId, context);
                }
            }
        });
        session.listenerAttached = true;
    }

    session.timeoutRef = setTimeout(async () => {
        await client.sendMessage(groupId, {
            text: `⏱️ Time's up! The word was *${session.currentAnswer}*.`
        });

        if (session.questionCount >= 10) {
            session.finished = true;
            const scoreText = Object.entries(session.players).map(([jid, p]) => `@${jid.split("@")[0]}: ${p.score}`).join("\n");
            await client.sendMessage(groupId, {
                text: `🏁 Game Over!\n\n📊 Final Scores:\n${scoreText}`,
                mentions: Object.keys(session.players)
            });
            delete sessions[groupId];
        } else {
            askNextQuestion(groupId, context);
        }
    }, 40000);
}