const countries = [
    { country: "Kenya", capital: "Nairobi" },
    { country: "Nigeria", capital: "Abuja" },
    { country: "France", capital: "Paris" },
    { country: "Brazil", capital: "Brasília" },
    { country: "Japan", capital: "Tokyo" }
];

const sessions = {};

module.exports = async (context) => {
    const { client, m, groupSender, prefix } = context;
    const groupId = m.chat;
    const senderId = groupSender;
    const body = m.text?.toLowerCase().trim();

    if (!sessions[groupId]) {
        sessions[groupId] = {
            players: {},
            started: false,
            finished: false,
            turn: null
        };
    }

    const session = sessions[groupId];

    if (body === `${prefix}players`) {
        if (!session.started) return await m.reply("⏳ Game hasn't started yet.");
        const list = Object.keys(session.players).map(p => `- ${p.split("@")[0]}`).join("\n");
        return await m.reply(`👥 Players:\n${list}`);
    }

    if (body === `${prefix}score`) {
        if (!session.started) return await m.reply("⏳ Game hasn't started yet.");
        const scores = Object.entries(session.players).map(([p, d]) => `- ${p.split("@")[0]}: ${d.score}/5`).join("\n");
        return await m.reply(`📊 Current Scores:\n${scores}`);
    }

    if (body === `${prefix}leavegame`) {
        if (!session.started || !session.players[senderId]) {
            return await m.reply("❌ You're not in an active game.");
        }
        const opponent = Object.keys(session.players).find(p => p !== senderId);
        if (opponent) {
            await m.reply(`🚪 ${senderId.split("@")[0]} left the game.\n🏆 ${opponent.split("@")[0]} wins by default!`);
        } else {
            await m.reply("You left the game.");
        }
        delete sessions[groupId];
        return;
    }

    if (!session.started) {
        if (session.players[senderId]) {
            return await m.reply(`🕹️ You're already in the game.`);
        }
        if (Object.keys(session.players).length >= 2) {
            return await m.reply(`🚫 This game already has 2 players.`);
        }

        session.players[senderId] = {
            score: 0,
            asked: [],
            current: null,
            awaitingAnswer: false,
            questionIndex: 0
        };

        await m.reply(`✅ ${senderId.split("@")[0]} joined the game!`);

        if (Object.keys(session.players).length === 2) {
            session.started = true;
            const players = Object.keys(session.players);
            session.turn = players[Math.floor(Math.random() * 2)];
            await m.reply(
                `🎮 Game started with 2 players!\n` +
                `First turn: ${session.turn.split("@")[0]}\n\n` +
                `📌 Available commands:\n` +
                `• ${prefix}score – Show current scores\n` +
                `• ${prefix}players – Show who's playing\n` +
                `• ${prefix}leavegame – Leave the game (opponent wins)\n`
            );
            askQuestion(groupId, session.turn, context);
        }
        return;
    }

    if (!session.started || session.finished) return;
    if (session.turn !== senderId) return;

    const player = session.players[senderId];

    if (player.awaitingAnswer) {
        const correctCapital = countries[player.current].capital.toLowerCase();
        const userAnswer = m.text.trim().toLowerCase();

        if (userAnswer === correctCapital) {
            player.score++;
            await m.reply(`✅ Correct!`);
        } else {
            await m.reply(`❌ Wrong! Correct answer: *${countries[player.current].capital}*`);
        }

        player.awaitingAnswer = false;
        player.questionIndex++;

        const allDone = Object.values(session.players).every(p => p.questionIndex >= 5);
        if (allDone) {
            session.finished = true;
            const [p1, p2] = Object.keys(session.players);
            const s1 = session.players[p1].score;
            const s2 = session.players[p2].score;
            const winner =
                s1 === s2 ? "🤝 It's a tie!" :
                s1 > s2 ? `🏆 Winner: ${p1.split("@")[0]}` :
                          `🏆 Winner: ${p2.split("@")[0]}`;
            await m.reply(`🏁 Game Over!\n\nScores:\n- ${p1.split("@")[0]}: ${s1}/5\n- ${p2.split("@")[0]}: ${s2}/5\n\n${winner}`);
            delete sessions[groupId];
            return;
        }

        const nextPlayer = Object.keys(session.players).find(p => p !== senderId);
        session.turn = nextPlayer;
        await m.reply(`🎯 ${nextPlayer.split("@")[0]}'s turn!`);
        askQuestion(groupId, nextPlayer, context);
        return;
    }
};

async function askQuestion(groupId, playerId, context) {
    const { client } = context;
    const session = sessions[groupId];
    const player = session.players[playerId];

    let nextIndex;
    do {
        nextIndex = Math.floor(Math.random() * countries.length);
    } while (player.asked.includes(nextIndex));

    player.current = nextIndex;
    player.asked.push(nextIndex);
    player.awaitingAnswer = true;

    const country = countries[nextIndex].country;
    await client.sendMessage(groupId, {
        text: `🌍 ${playerId.split("@")[0]}, what is the capital of *${country}*?`
    });
}