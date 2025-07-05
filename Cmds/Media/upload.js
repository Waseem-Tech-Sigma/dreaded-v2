module.exports = async (context) => {
  const { client, m } = context;
  const axios = require('axios');
  const FormData = require('form-data');

  const media = m.quoted || m;
  const mime = (media.msg || media).mimetype || '';
  if (!mime) return m.reply('❌ Send or reply to a media file (image, video, or document) to upload.');

  try {
    const buffer = await client.downloadMediaMessage(media);
    const ext = mime.split('/')[1] || 'bin';
    const fileName = `upload_${Date.now()}.${ext}`;

    const form = new FormData();
    form.append('file', buffer, { filename: fileName });

    const upload = await axios.post('https://pixeldrain.com/api/file', form, {
      headers: form.getHeaders(),
    });

    const res = upload.data;

    if (!res || !res.success || !res.id) {
      return m.reply('❌ Failed to upload to Pixeldrain.');
    }

    const fileUrl = `https://pixeldrain.com/u/${res.id}`;
    m.reply(`✅ Upload successful:\n\n📁 *${fileName}*\n🔗 ${fileUrl}`);
  } catch (err) {
    console.error(err);
    m.reply('⚠️ Upload error:\n' + err.message);
  }
};