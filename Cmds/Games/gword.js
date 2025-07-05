const fs = require("fs");
const path = require("path");

const wordListPath = path.resolve(__dirname, "../../node_modules/word-list/words.txt");
const wordPool = fs.readFileSync(wordListPath, "utf-8")
    .split("\n")
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length >= 3 && w.length <= 6 && /^[a-z]+$/.test(w));

const sessions = {};

function pickWord() {
    const length = Math.floor(Math.random() * 4) + 3; 
    const end = Math.random() < 0.5 ? null : String.fromCharCode(97 + Math.floor(Math.random() * 26));
    let pool = wordPool.filter(w => w.length === length);
    if (end) pool = pool.filter(w => w.endsWith(end));
    if (pool.length === 0) return pickWord();
    const word = pool[Math.floor(Math.random() * pool.length)];
    return { word, clue: `🧠 Guess a ${length}-letter word${end ? ` ending with "${end}"` : ""}!` };
}

module.exports = async (context) => {
    const { client, m, groupSender, prefix } = context;
    const groupId = m.chat;
    const senderId = m.sender;
    const displayId = groupSender;
    const text = m.text.trim();
    const args = text.split(" ").slice(1);

    if (!sessions[groupId]) {
        sessions[groupId] = {
            players: {},
            started: false,
            finished: false,
            currentWord: null,
            currentClue: null,
            round: 0,
            timeoutRef: null,
            questionMessageId: null,
            eventListenerActive: false,
            _eventHandler: null
        };
    }

    const session = sessions[groupId];

    if (args.length === 0) {
        return await client.sendMessage(groupId, {
            text:
                `🔤 *Word Guessing Game*\n\n` +
                `2 players required. First to answer wins the point.\n\n` +
                `📘 *Usage:*\n` +
                `• ${prefix}gword join — join game\n` +
                `• ${prefix}gword leave — leave game\n` +
                `• ${prefix}gword players — view players\n` +
                `• ${prefix}gword scores — view scores\n` +
                `• Reply to question messages with your guess!`
        }, { quoted: m });
    }

    const sub = args[0].toLowerCase();

    if (sub === "join") {
        if (session.players[senderId]) {
            return await client.sendMessage(groupId, {
                text: `🕹️ You've already joined.`
            }, { quoted: m });
        }

        if (Object.keys(session.players).length >= 2) {
            return await client.sendMessage(groupId, {
                text: `❌ 2 players already joined.`
            }, { quoted: m });
        }

        session.players[senderId] = {
            display: displayId,
            score: 0
        };

        if (Object.keys(session.players).length === 1) {
            return await client.sendMessage(groupId, {
                text: `✅ You joined.\n⏳ Waiting for opponent...`
            }, { quoted: m });
        }

        session.started = true;
        const players = Object.values(session.players);

        const introMessage = await client.sendMessage(groupId, {
            text: `✅ @${displayId.split("@")[0]} joined.\n\n🎮 Game starting!\n\n⚡ First to answer gets the point!\nReply to question messages with your guess!`,
            mentions: [displayId]
        }, { quoted: m });

        return await askQuestion(groupId, { ...context, m: introMessage });
    }

    if (sub === "leave") {
        if (!session.players[senderId]) {
            return await client.sendMessage(groupId, {
                text: `🚫 You're not in this game.`
            }, { quoted: m });
        }

        const opponent = Object.keys(session.players).find(p => p !== senderId);
        clearTimeout(session.timeoutRef);
        session.eventListenerActive = false;

        if (session._eventHandler) {
            client.ev.off("messages.upsert", session._eventHandler);
        }

        delete sessions[groupId];

        if (opponent) {
            return await client.sendMessage(groupId, {
                text: `🚪 You left the game.\n🏆 @${session.players[opponent].display.split("@")[0]} wins by default!`,
                mentions: [session.players[opponent].display]
            }, { quoted: m });
        } else {
            return await client.sendMessage(groupId, {
                text: `🚪 You left the game.`
            }, { quoted: m });
        }
    }

    if (sub === "players") {
        const playerList = Object.values(session.players);
        if (playerList.length === 0) {
            return await client.sendMessage(groupId, {
                text: `No one has joined.`
            }, { quoted: m });
        }

        const textList = playerList.map(p => `- @${p.display.split("@")[0]}`).join("\n");
        return await client.sendMessage(groupId, {
            text: `👥 Players:\n${textList}`,
            mentions: playerList.map(p => p.display)
        }, { quoted: m });
    }

    if (sub === "scores") {
        if (!session.started) {
            return await client.sendMessage(groupId, {
                text: `Game hasn't started yet.`
            }, { quoted: m });
        }

        const scoresText = Object.values(session.players).map(
            p => `- @${p.display.split("@")[0]}: ${p.score}/10`
        ).join("\n");

        return await client.sendMessage(groupId, {
            text: `📊 Scores:\n${scoresText}`,
            mentions: Object.values(session.players).map(p => p.display)
        }, { quoted: m });
    }

    if (!session.started || session.finished) {
        return await client.sendMessage(groupId, {
            text: `❌ Please reply to the question message with your guess!`
        }, { quoted: m });
    }
};

async function askQuestion(groupId, context) {
    const { client, m } = context;
    const session = sessions[groupId];

    if (!session || session.finished) return;

    const { word, clue } = pickWord();
    session.currentWord = word;
    session.currentClue = clue;
    session.round++;

    const questionMessage = await client.sendMessage(groupId, {
        text: `🔤 Round ${session.round}/10\n${clue}\n📝 Reply to this message with your guess!`,
        mentions: Object.values(session.players).map(p => p.display)
    }, { quoted: m });

    session.questionMessageId = questionMessage.key.id;
    session.eventListenerActive = true;

    if (session._eventHandler) {
        client.ev.off("messages.upsert", session._eventHandler);
    }

    const eventHandler = async (update) => {
        if (!update || !update.messages || !Array.isArray(update.messages)) return;
        if (!session.eventListenerActive) return;

        const messageContent = update.messages[0];
        if (!messageContent.message) return;

        const message = messageContent.message;
        const chatId = messageContent.key.remoteJid;
        const responderId = messageContent.key.participant || messageContent.key.remoteJid;
        const contextInfo = message.extendedTextMessage?.contextInfo;
        const stanzaId = contextInfo?.stanzaId;

        const isReplyToQuestion = stanzaId === session.questionMessageId;

        if (isReplyToQuestion && chatId === groupId && session.players[responderId]) {
            client.ev.off("messages.upsert", eventHandler);
            session.eventListenerActive = false;

            await client.sendMessage(chatId, {
                react: { text: '🤖', key: messageContent.key }
            });

            const userAnswer = (message.conversation || message.extendedTextMessage?.text || "").toLowerCase().trim();
            return await processAnswer(userAnswer, responderId, groupId, context);
        }
    };

    session._eventHandler = eventHandler;
    client.ev.on("messages.upsert", session._eventHandler);

    session.timeoutRef = setTimeout(async () => {
        if (!session.eventListenerActive) return;

        client.ev.off("messages.upsert", session._eventHandler);
        session.eventListenerActive = false;

        await client.sendMessage(groupId, {
            text: `⏱️ Time's up! The word was *${session.currentWord}*.`
        });

        if (session.round >= 10) {
            await endGame(client, groupId, session);
            return;
        }

        return await askQuestion(groupId, context);
    }, 40000);
}

async function processAnswer(userAnswer, senderId, groupId, context) {
    const { client, m } = context;
    const session = sessions[groupId];
    const player = session.players[senderId];

    if (!player || !session.eventListenerActive) return;

    clearTimeout(session.timeoutRef);
    session.eventListenerActive = false;

    if (userAnswer === session.currentWord) {
        player.score++;
        await client.sendMessage(groupId, {
            text: `✅ @${player.display.split("@")[0]} got it! The word was *${session.currentWord}*.`,
            mentions: [player.display]
        }, { quoted: m });
    } else {
        await client.sendMessage(groupId, {
            text: `❌ Incorrect. The word was *${session.currentWord}*.`
        }, { quoted: m });
    }

    if (session.round >= 10) {
        await endGame(client, groupId, session);
        return;
    }

    return await askQuestion(groupId, context);
}

async function endGame(client, groupId, session) {
    session.finished = true;
    const players = Object.values(session.players);
    const [p1, p2] = players;
    const s1 = p1.score;
    const s2 = p2.score;
    const d1 = p1.display;
    const d2 = p2.display;

    const winner = s1 === s2 ? "🤝 It's a tie!" :
                   s1 > s2 ? `🏆 Winner: @${d1.split("@")[0]}` :
                             `🏆 Winner: @${d2.split("@")[0]}`;

    await client.sendMessage(groupId, {
        text: `🏁 Game Over!\n\nScores:\n- @${d1.split("@")[0]}: ${s1}/10\n\n- @${d2.split("@")[0]}: ${s2}/10\n\n${winner} 🎉`,
        mentions: [d1, d2]
    });

    delete sessions[groupId];
}