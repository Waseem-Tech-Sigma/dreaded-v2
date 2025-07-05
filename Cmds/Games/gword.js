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
    const senderLid = m.sender;
    const senderJid = groupSender;
    const text = m.text.trim();
    const args = text.split(" ").slice(1);

    if (!sessions[groupId]) {
        sessions[groupId] = {
            players: {},      
            scores: {},       
            started: false,
            finished: false,
            questionId: null,
            answer: null,
            round: 0,
            listenerAttached: false,
            timeoutRef: null
        };
    }

    const session = sessions[groupId];

    const sub = args[0]?.toLowerCase();

    if (!sub) {
        return await client.sendMessage(groupId, {
            text: `🔤 *Word Guessing Game*

👥 2 players compete to guess a word based on a clue.

📘 *Commands:*
• ${prefix}gword join — join game
• ${prefix}gword leave — leave game
• ${prefix}gword scores — view scores
• ${prefix}gword start — start game (after 2 joined)`
        }, { quoted: m });
    }

    if (sub === "join") {
        if (session.started) {
            return await client.sendMessage(groupId, {
                text: `🚫 Game already in progress.`,
                mentions: [senderJid]
            }, { quoted: m });
        }
        if (session.players[senderLid]) {
            return await client.sendMessage(groupId, {
                text: `🕹️ You've already joined.`,
                mentions: [senderJid]
            }, { quoted: m });
        }
        if (Object.keys(session.players).length >= 2) {
            return await client.sendMessage(groupId, {
                text: `❌ 2 players already joined.`,
                mentions: [senderJid]
            }, { quoted: m });
        }

        session.players[senderLid] = senderJid;
        session.scores[senderLid] = 0;

        const mentions = Object.values(session.players);
        return await client.sendMessage(groupId, {
            text: `✅ ${mentions.length === 1 ? "You joined.\n⏳ Waiting for opponent..." : `@${senderJid.split("@")[0]} joined.\n\n🎮 Game ready!\nType *${prefix}gword start* to begin.`}`,
            mentions
        }, { quoted: m });
    }

    if (sub === "leave") {
        if (!session.players[senderLid]) {
            return await client.sendMessage(groupId, {
                text: `🙅 You're not in this game.`,
                mentions: [senderJid]
            }, { quoted: m });
        }
        clearTimeout(session.timeoutRef);
        delete sessions[groupId];
        return await client.sendMessage(groupId, {
            text: `🚪 @${senderJid.split("@")[0]} left. Game cancelled.`,
            mentions: [senderJid]
        }, { quoted: m });
    }

    if (sub === "scores") {
        if (!session.started) {
            return await client.sendMessage(groupId, {
                text: `ℹ️ Game hasn't started yet.`,
                mentions: [senderJid]
            }, { quoted: m });
        }

        const scoreText = Object.entries(session.scores).map(([lid, score]) => {
            const name = session.players[lid].split("@")[0];
            return `@${name}: ${score}`;
        }).join("\n");

        return await client.sendMessage(groupId, {
            text: `📊 Scores:\n${scoreText}`,
            mentions: Object.values(session.players)
        }, { quoted: m });
    }

    if (sub === "start") {
        if (session.started) {
            return await client.sendMessage(groupId, {
                text: `⏳ Game already running.`,
                mentions: [senderJid]
            }, { quoted: m });
        }

        const lids = Object.keys(session.players);
        if (lids.length < 2) {
            return await client.sendMessage(groupId, {
                text: `❌ 2 players required.`,
                mentions: [senderJid]
            }, { quoted: m });
        }

        session.started = true;
        await client.sendMessage(groupId, {
            text: `🎮 Game started!\nReply to each word clue to score.\n⏱️ 40s per round, first to answer wins the point.`,
            mentions: Object.values(session.players)
        }, { quoted: m });

        askWord(groupId, context);
    }

    if (!session.started || session.finished) return;
};

async function askWord(groupId, context) {
    const { client } = context;
    const session = sessions[groupId];
    if (!session) return;

    const { word, clue } = pickWord();
    session.answer = word;
    session.round++;

    const msg = await client.sendMessage(groupId, {
        text: `🔤 Round ${session.round}/10\n${clue}`,
        mentions: Object.values(session.players)
    });
    session.questionId = msg.key.id;

    if (!session.listenerAttached) {
        client.ev.on("messages.upsert", async (update) => {
            const message = update.messages?.[0];
            if (!message?.message || !sessions[groupId]?.started) return;
            const session = sessions[groupId];
            const text = message.message.conversation || message.message.extendedTextMessage?.text;
            const lid = message.key.participant || message.key.remoteJid;
            const chat = message.key.remoteJid;
            const replyTo = message.message?.extendedTextMessage?.contextInfo?.stanzaId;

            if (chat !== groupId) return;
            if (!session.players[lid]) return;
            if (replyTo !== session.questionId) return;

            if (text?.toLowerCase().trim() === session.answer) {
                clearTimeout(session.timeoutRef);
                session.scores[lid]++;
                await client.sendMessage(groupId, {
                    text: `✅ @${session.players[lid].split("@")[0]} got it! The word was *${session.answer}*.`,
                    mentions: [session.players[lid]]
                }, { quoted: message });

                if (session.round >= 10) {
                    session.finished = true;
                    const results = Object.entries(session.scores).map(([lid, score]) => {
                        const jid = session.players[lid];
                        return `@${jid.split("@")[0]}: ${score}`;
                    }).join("\n");

                    await client.sendMessage(groupId, {
                        text: `🏁 Game Over!\n\n📊 Final Scores:\n${results}`,
                        mentions: Object.values(session.players)
                    });

                    delete sessions[groupId];
                } else {
                    askWord(groupId, context);
                }
            }
        });
        session.listenerAttached = true;
    }

    session.timeoutRef = setTimeout(async () => {
        await client.sendMessage(groupId, {
            text: `⏱️ Time’s up! The word was *${session.answer}*.`
        });

        if (session.round >= 10) {
            session.finished = true;
            const results = Object.entries(session.scores).map(([lid, score]) => {
                const jid = session.players[lid];
                return `@${jid.split("@")[0]}: ${score}`;
            }).join("\n");

            await client.sendMessage(groupId, {
                text: `🏁 Game Over!\n\n📊 Final Scores:\n${results}`,
                mentions: Object.values(session.players)
            });

            delete sessions[groupId];
        } else {
            askWord(groupId, context);
        }
    }, 40000);
}