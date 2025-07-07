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

function getNotificationPrefix(remoteJid, deletedByFormatted) {
  if (remoteJid.includes('status@broadcast')) {
    return `Status Update deleted by ${deletedByFormatted}`;
  } else if (remoteJid.endsWith('@s.whatsapp.net')) {
    return `Private Message deleted by ${deletedByFormatted}`;
  } else {
    return `Group Message deleted by ${deletedByFormatted} in (${remoteJid})`;
  }
}

function getEastAfricaTimestamp() {
  const now = new Date();
  const eastAfricaTime = new Date(now.toLocaleString("en-US", {timeZone: "Africa/Nairobi"}));
  return eastAfricaTime.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
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

  
  const notificationPrefix = getNotificationPrefix(remoteJid, deletedByFormatted);
  const timestamp = getEastAfricaTimestamp();

  let notificationText = `_ANTIDELETE_\n\n${notificationPrefix}\n\nTime: ${timestamp}\n\n`;

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

  
    const getMediaReply = (mediaMessage) => {
      const caption = mediaMessage.caption || '';
      const finalCaption = caption ? `${notificationText}\n\nCaption: ${caption}` : notificationText;

      return {
        caption: finalCaption,
        contextInfo: {
          externalAdReply: {
            title: notificationPrefix,
            body: `Time: ${timestamp}`,
            thumbnailUrl: "https://files.catbox.moe/z34m2h.jpg",
            sourceUrl: '',
            mediaType: 1,
            renderLargerThumbnail: false
          }
        }
      };
    };

    // Handle different media types
    if (m.imageMessage) {
      const buffer = await client.downloadMediaMessage(m.imageMessage);
      const mediaReply = getMediaReply(m.imageMessage);
      return await client.sendMessage(userJid, { image: buffer, ...mediaReply });
    }

    if (m.videoMessage) {
      const buffer = await client.downloadMediaMessage(m.videoMessage);
      const mediaReply = getMediaReply(m.videoMessage);
      return await client.sendMessage(userJid, { video: buffer, ...mediaReply });
    }

    if (m.stickerMessage) {
      const buffer = await client.downloadMediaMessage(m.stickerMessage);
      return await client.sendMessage(userJid, { 
        sticker: buffer,
        contextInfo: {
          externalAdReply: {
            title: notificationPrefix,
            body: `Time: ${timestamp}`,
            thumbnailUrl: "https://files.catbox.moe/z34m2h.jpg",
            sourceUrl: '',
            mediaType: 1,
            renderLargerThumbnail: false
          }
        }
      });
    }

    if (m.documentMessage) {
      const buffer = await client.downloadMediaMessage(m.documentMessage);
      const mediaReply = getMediaReply(m.documentMessage);
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
        caption: notificationText,
        contextInfo: {
          externalAdReply: {
            title: notificationPrefix,
            body: `Time: ${timestamp}`,
            thumbnailUrl: "https://files.catbox.moe/z34m2h.jpg",
            sourceUrl: '',
            mediaType: 1,
            renderLargerThumbnail: false
          }
        }
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