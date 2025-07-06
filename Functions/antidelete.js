const fs = require('fs');
const path = require('path');

const baseDir = 'message_data';
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir);
}

function loadChatData(remoteJid, messageId) {
  const chatFilePath = path.join(baseDir, remoteJid, `${messageId}.json`);
  try {
    const data = fs.readFileSync(chatFilePath, 'utf8');
    return JSON.parse(data) || [];
  } catch {
    return [];
  }
}

function saveChatData(remoteJid, messageId, chatData) {
  const chatDir = path.join(baseDir, remoteJid);
  if (!fs.existsSync(chatDir)) {
    fs.mkdirSync(chatDir, { recursive: true });
  }
  const chatFilePath = path.join(chatDir, `${messageId}.json`);
  try {
    fs.writeFileSync(chatFilePath, JSON.stringify(chatData, null, 2));
  } catch (error) {
    console.error('Error saving chat data:', error);
  }
}

function handleIncomingMessage(message) {
  const remoteJid = message.key.remoteJid;
  const messageId = message.key.id;

  const chatData = loadChatData(remoteJid, messageId);
  chatData.push(message);
  saveChatData(remoteJid, messageId, chatData);
}

async function handleMessageRevocation(client, revocationMessage, botNumber) {
  const remoteJid = revocationMessage.key.remoteJid;
  const messageId = revocationMessage.message.protocolMessage.key.id;

  const chatData = loadChatData(remoteJid, messageId);
  const originalMessage = chatData[0];

  if (!originalMessage) return;

  const deletedBy = revocationMessage.participant || revocationMessage.key.participant || revocationMessage.key.remoteJid;
  const sentBy = originalMessage.key.participant || originalMessage.key.remoteJid;

  if (deletedBy.includes(botNumber)) return;

  const deletedByFormatted = `@${deletedBy.split('@')[0]}`;
  const sentByFormatted = `@${sentBy.split('@')[0]}`;

  let notificationText = `DREADED ANTIDELETE REPORT\n\n` +
    `Deleted by: ${deletedByFormatted}\n\n`;

  try {
    const m = originalMessage.message;
    const userJid = client.user.id;

    if (m.conversation) {
      notificationText += `Deleted Message: ${m.conversation}`;
      return await client.sendMessage(userJid, { text: notificationText });
    }

    if (m.extendedTextMessage) {
      notificationText += `Deleted Content: ${m.extendedTextMessage.text}`;
      return await client.sendMessage(userJid, { text: notificationText });
    }

    const mediaReply = {
      caption: notificationText,
      contextInfo: {
        externalAdReply: {
          title: notificationText,
          body: `Deleted by: ${deletedByFormatted}`,
          thumbnailUrl: "https://files.catbox.moe/7f98vp.jpg",
          sourceUrl: '',
          mediaType: 1,
          renderLargerThumbnail: false
        }
      }
    };

    if (m.imageMessage) {
      const buffer = await client.downloadMediaMessage(m.imageMessage);
      return await client.sendMessage(userJid, { image: buffer, ...mediaReply });
    }

    if (m.videoMessage) {
      const buffer = await client.downloadMediaMessage(m.videoMessage);
      return await client.sendMessage(userJid, { video: buffer, ...mediaReply });
    }

    if (m.stickerMessage) {
      const buffer = await client.downloadMediaMessage(m.stickerMessage);
      return await client.sendMessage(userJid, { sticker: buffer, ...mediaReply });
    }

    if (m.documentMessage) {
      const buffer = await client.downloadMediaMessage(m.documentMessage);
      return await client.sendMessage(userJid, {
        document: buffer,
        fileName: m.documentMessage.fileName,
        mimetype: m.documentMessage.mimetype,
        ...mediaReply
      });
    }

    if (m.audioMessage) {
      const buffer = await client.downloadMediaMessage(m.audioMessage);
      return await client.sendMessage(userJid, {
        audio: buffer,
        mimetype: 'audio/mpeg',
        ptt: m.audioMessage.ptt === true,
        ...mediaReply
      });
    }

  } catch (error) {
    console.error('Error handling deleted message:', error);
    notificationText += `\n\n⚠️ Error recovering deleted content.`;
    await client.sendMessage(client.user.id, { text: notificationText });
  }
}

module.exports = {
  handleIncomingMessage,
  handleMessageRevocation
};