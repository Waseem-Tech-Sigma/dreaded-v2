const fs = require("fs");
const path = require("path");

const countries = JSON.parse(fs.readFileSync(path.join(__dirname, "countries.json")));
const sessions = {};

module.exports = async (context) => {
    const { client, m, groupSender, prefix } = context;
    const groupId = m.chat;
    const senderId = groupSender;
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
        return await m.reply(
            `🎯 *Capital City Game*\n\n` +
            `2 players required. Turn-based quiz.\n\n` +
            `📘 *Usage:*\n` +
            `• ${prefix}gcapital join — join game\n` +
            `• ${prefix}gcapital leave — leave game\n` +
            `• ${prefix}gcapital players — view players\n` +
            `• ${prefix}gcapital scores — view scores\n` +
            `• Reply to question messages with just the capital city name!`
        );
    }

    const sub = args[0].toLowerCase();

    if (sub === "join") {
        if (session.players[senderId]) return await m.reply("🕹️ You've already joined.");
        if (Object.keys(session.players).length >= 2) return await m.reply("❌ 2 players already joined.");

        session.players[senderId] = {
            score: 0,
            asked: [],
            current: null,
            awaitingAnswer: false,
            questionIndex: 0
        };

        console.log(`[JOIN] ${senderId} joined game in group ${groupId}`);

        if (Object.keys(session.players).length === 1) {
            return await m.reply("✅ You joined.\n⏳ Waiting for opponent...");
        }

        session.started = true;
        const players = Object.keys(session.players);
        session.turn = players[Math.floor(Math.random() * 2)];

        await m.reply(
            `✅ ${senderId.split("@")[0]} joined.\n\n` +
            `🎮 Game starting!\n` +
            `🔄 First turn: ${session.turn.split("@")[0]}\n\n` +
            `Reply to question messages with just the capital city name!`
        );

        return await askQuestion(groupId, session.turn, context);
    }

    if (sub === "leave") {
        if (!session.players[senderId]) return await m.reply("🚫 You're not in this game.");

        const opponent = Object.keys(session.players).find(p => p !== senderId);
        clearTimeout(session.timeoutRef);
        session.eventListenerActive = false;

        if (session._eventHandler) {
            client.ev.off("messages.upsert", session._eventHandler);
        }

        delete sessions[groupId];

        console.log(`[LEAVE] ${senderId} left the game in ${groupId}`);

        if (opponent) {
            return await m.reply(`🚪 You left the game.\n🏆 ${opponent.split("@")[0]} wins by default!`);
        } else {
            return await m.reply("🚪 You left the game.");
        }
    }

    if (sub === "players") {
        const players = Object.keys(session.players);
        if (players.length === 0) return await m.reply("No one has joined.");
        const list = players.map(p => `- ${p.split("@")[0]}`).join("\n");
        return await m.reply(`👥 Players:\n${list}`);
    }

    if (sub === "scores") {
        if (!session.started) return await m.reply("Game hasn't started yet.");
        const scores = Object.entries(session.players).map(
            ([p, d]) => `- ${p.split("@")[0]}: ${d.score}/10`
        ).join("\n");
        return await m.reply(`📊 Scores:\n${scores}`);
    }

    if (!session.started || session.finished) return;
    return await m.reply("❌ Please reply to the question message with just the capital city name!");
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

    console.log(`[ASK] Asking ${playerId} in group ${groupId} about: ${country}`);

    const questionMessage = await client.sendMessage(groupId, {
        text: `🌍 ${playerId.split("@")[0]}, what is the capital of *${country}*?\n📝 Reply to this message with your answer!`
    });

    session.questionMessageId = questionMessage.key.id;
    session.eventListenerActive = true;

    if (session._eventHandler) {
        client.ev.off("messages.upsert", session._eventHandler);
        console.log(`[LISTENER] Removed previous event handler for ${groupId}`);
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

        console.log(`[LISTENER] Message received in ${chatId} from ${responderId}`);
        console.log(`[LISTENER] Message reply ID: ${stanzaId}`);
        console.log(`[LISTENER] Expected question ID: ${session.questionMessageId}`);

        const isReplyToQuestion = stanzaId === session.questionMessageId;

        if (isReplyToQuestion && chatId === groupId && responderId === playerId) {
            console.log(`[LISTENER] Valid reply detected from ${playerId}`);
            client.ev.off("messages.upsert", eventHandler);
            session.eventListenerActive = false;

            await client.sendMessage(chatId, {
                react: { text: '🤖', key: messageContent.key }
            });

            const userAnswer = (message.conversation || message.extendedTextMessage?.text || "").toLowerCase().trim();
            console.log(`[ANSWER] User replied: ${userAnswer}`);
            return await processAnswer(userAnswer, playerId, groupId, context);
        }
    };

    session._eventHandler = eventHandler;
    client.ev.on("messages.upsert", session._eventHandler);
    console.log(`[LISTENER] Attached event handler for ${playerId}`);

    session.timeoutRef = setTimeout(async () => {
        if (!player.awaitingAnswer) return;

        client.ev.off("messages.upsert", session._eventHandler);
        session.eventListenerActive = false;

        player.awaitingAnswer = false;
        player.questionIndex++;

        console.log(`[TIMEOUT] No answer from ${playerId}. Moving to next turn.`);

        await client.sendMessage(groupId, {
            text: `⏱️ Time's up for ${playerId.split("@")[0]}!`
        });

        const allDone = Object.values(session.players).every(p => p.questionIndex >= 10);
        if (allDone) {
            session.finished = true;
            const [p1, p2] = Object.keys(session.players);
            const s1 = session.players[p1].score;
            const s2 = session.players[p2].score;
            const winner = s1 === s2 ? "🤝 It's a tie!" :
                           s1 > s2 ? `🏆 Winner: ${p1.split("@")[0]}` :
                                     `🏆 Winner: ${p2.split("@")[0]}`;
            await client.sendMessage(groupId, {
                text: `🏁 Game Over!\n\nScores:\n- ${p1.split("@")[0]}: ${s1}/10\n- ${p2.split("@")[0]}: ${s2}/10\n\n${winner}`
            });
            delete sessions[groupId];
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
        await m.reply("✅ Correct!");
        console.log(`[CORRECT] ${senderId} answered correctly.`);
    } else {
        await m.reply(`❌ Incorrect. Correct answer: *${countries[player.current].capital}*`);
        console.log(`[WRONG] ${senderId} answered incorrectly. Correct: ${correct}`);
    }

    player.awaitingAnswer = false;
    player.questionIndex++;

    const allDone = Object.values(session.players).every(p => p.questionIndex >= 10);
    if (allDone) {
        session.finished = true;
        const [p1, p2] = Object.keys(session.players);
        const s1 = session.players[p1].score;
        const s2 = session.players[p2].score;
        const winner = s1 === s2 ? "🤝 It's a tie!" :
                       s1 > s2 ? `🏆 Winner: ${p1.split("@")[0]}` :
                                 `🏆 Winner: ${p2.split("@")[0]}`;
        await client.sendMessage(groupId, {
            text: `🏁 Game Over!\n\nScores:\n- ${p1.split("@")[0]}: ${s1}/10\n- ${p2.split("@")[0]}: ${s2}/10\n\n${winner}`
        });
        delete sessions[groupId];
        return;
    }

    const next = Object.keys(session.players).find(p => p !== senderId);
    session.turn = next;
    return await askQuestion(groupId, next, context);
}