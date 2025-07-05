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
    const form = new FormData();
    form.append('file', buffer, { filename: `upload_${Date.now()}.${ext}` });

    const upload = await axios.post('https://api.anonfiles.com/upload', form, {
      headers: form.getHeaders(),
    });

    const response = upload.data;

    if (response.status !== true || !response.data?.file?.url?.full) {
      return m.reply('❌ Failed to upload to Anonfiles.');
    }

    const fileUrl = response.data.file.url.full;
    const fileName = response.data.file.metadata.name;
    const fileSize = response.data.file.metadata.size.readable;

    m.reply(`✅ Upload successful:\n\n📁 *${fileName}* (${fileSize})\n🔗 ${fileUrl}`);
  } catch (err) {
    console.error(err);
    m.reply('⚠️ Upload error:\n' + err.message);
  }
};