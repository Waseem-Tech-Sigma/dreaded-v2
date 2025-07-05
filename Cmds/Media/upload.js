module.exports = async (context) => {
  const { client, m } = context;
  const axios = require('axios');
  const FormData = require('form-data');

  const media = m.quoted || m;
  const mime = (media.msg || media).mimetype || '';
  if (!mime) return m.reply('❌ Send or reply to a media file (image, video, or document) to upload.');

  try {
    const buffer = await client.downloadMediaMessage(media);
    const ext = mime.split('/')[1];
    const form = new FormData();
    form.append('file', buffer, { filename: `upload_${Date.now()}.${ext}` });

    const upload = await axios.post('https://cloudgood.web.id/upload.php', form, {
      headers: form.getHeaders(),
    });

    const uploaded = upload.data;
    if (!uploaded.url) return m.reply('❌ Failed to upload media to CloudGood.');

    const mediaUrl = uploaded.url;
    m.reply(`✅ Upload successful:\n\n🔗 ${mediaUrl}`);
  } catch (err) {
    console.error(err);
    m.reply('⚠️ Upload error:\n' + err.message);
  }
};