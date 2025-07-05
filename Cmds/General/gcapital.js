const fs = require("fs");
const path = require("path");

const countries = JSON.parse(fs.readFileSync(path.join(__dirname, "countries.json")));
const sessions = {};

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
            turn: null,
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
                `🎯 *Capital City Game*\n\n` +
                `2 players required. Turn-based quiz.\n\n` +
                `📘 *Usage:*\n` +
                `• ${prefix}gcapital join — join game\n` +
                `• ${prefix}gcapital leave — leave game\n` +
                `• ${prefix}gcapital players — view players\n` +
                `• ${prefix}gcapital scores — view scores\n` +
                `• Reply to question messages with just the capital city name!`
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
            score: 0,
            asked: [],
            current: null,
            awaitingAnswer: false,
            questionIndex: 0
        };

        if (Object.keys(session.players).length === 1) {
            return await client.sendMessage(groupId, {
                text: `✅ You joined.\n⏳ Waiting for opponent...`
            }, { quoted: m });
        }

        session.started = true;
        const players = Object.keys(session.players);
        session.turn = players[Math.floor(Math.random() * 2)];
        const currentDisplay = session.players[session.turn].display;

        return await client.sendMessage(groupId, {
            text: `✅ @${displayId.split("@")[0]} joined.\n\n🎮 Game starting!\n🔄 First turn: @${currentDisplay.split("@")[0]}\n\nReply to question messages with just the capital city name!`,
            mentions: [displayId, currentDisplay]
        });
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
            text: `❌ Please reply to the question message with just the capital city name!`
        }, { quoted: m });
    }
};

async function askQuestion(groupId, playerId, context) {
    const { client } = context;
    const session = sessions[groupId];
    const player = session.players[playerId];

    let index;
    do {
        index = Math.floor(Math.random() * countries.length);
    } while (player.asked.includes(index));

    player.current = index;
    player.asked.push(index);
    player.awaitingAnswer = true;

    const country = countries[index].country;

    const questionMessage = await client.sendMessage(groupId, {
        text: `🌍 ${player.display.split("@")[0]}, what is the capital of *${country}*?\n📝 Reply to this message with your answer!`
    });

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

        if (isReplyToQuestion && chatId === groupId && responderId === playerId) {
            client.ev.off("messages.upsert", eventHandler);
            session.eventListenerActive = false;

            await client.sendMessage(chatId, {
                react: { text: '🤖', key: messageContent.key }
            });

            const userAnswer = (message.conversation || message.extendedTextMessage?.text || "").toLowerCase().trim();
            return await processAnswer(userAnswer, playerId, groupId, context);
        }
    };

    session._eventHandler = eventHandler;
    client.ev.on("messages.upsert", session._eventHandler);

    session.timeoutRef = setTimeout(async () => {
        if (!player.awaitingAnswer) return;

        client.ev.off("messages.upsert", session._eventHandler);
        session.eventListenerActive = false;

        player.awaitingAnswer = false;
        player.questionIndex++;

        await client.sendMessage(groupId, {
            text: `⏱️ Time's up for @${player.display.split("@")[0]}!`,
            mentions: [player.display]
        });

        const allDone = Object.values(session.players).every(p => p.questionIndex >= 10);
        if (allDone) {
            await endGame(client, groupId, session);
            return;
        }

        const next = Object.keys(session.players).find(p => p !== playerId);
        session.turn = next;
        return await askQuestion(groupId, next, context);
    }, 60000);
}

async function processAnswer(userAnswer, senderId, groupId, context) {
    const { client, m } = context;
    const session = sessions[groupId];
    const player = session.players[senderId];

    if (!player || !player.awaitingAnswer) return;

    clearTimeout(session.timeoutRef);
    session.eventListenerActive = false;

    const correct = countries[player.current].capital.toLowerCase();

    if (userAnswer === correct) {
        player.score++;
        await client.sendMessage(groupId, {
            text: `✅ Correct!`
        }, { quoted: m });
    } else {
        await client.sendMessage(groupId, {
            text: `❌ Incorrect. Correct answer: *${countries[player.current].capital}*`
        }, { quoted: m });
    }

    player.awaitingAnswer = false;
    player.questionIndex++;

    const allDone = Object.values(session.players).every(p => p.questionIndex >= 10);
    if (allDone) {
        await endGame(client, groupId, session);
        return;
    }

    const next = Object.keys(session.players).find(p => p !== senderId);
    session.turn = next;
    return await askQuestion(groupId, next, context);
}

async function endGame(client, groupId, session) {
    session.finished = true;
    const [p1, p2] = Object.keys(session.players);
    const s1 = session.players[p1].score;
    const s2 = session.players[p2].score;
    const d1 = session.players[p1].display;
    const d2 = session.players[p2].display;

    const winner = s1 === s2 ? "🤝 It's a tie!" :
                   s1 > s2 ? `🏆 Winner: @${d1.split("@")[0]}` :
                             `🏆 Winner: @${d2.split("@")[0]}`;

    await client.sendMessage(groupId, {
        text: `🏁 Game Over!\n\nScores:\n- @${d1.split("@")[0]}: ${s1}/10\n- @${d2.split("@")[0]}: ${s2}/10\n\n${winner}`,
        mentions: [d1, d2]
    });

    delete sessions[groupId];
}