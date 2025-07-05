module.exports = async (context) => {
  const { client, m } = context;
  const fs = require('fs');
  const axios = require('axios');
  const FormData = require('form-data');

  const q = m.quoted ? m.quoted : m;
  const mime = (q.msg || q).mimetype || '';

  if (!mime) return m.reply('Quote a file (image, document, etc) to upload using *.gofile*');

  const mediaBuffer = await q.download();
  if (mediaBuffer.length > 100 * 1024 * 1024) return m.reply('File is too large.');

  const filePath = await client.downloadAndSaveMediaMessage(q);
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));

  m.reply('Uploading to gofile.io, please wait...');

  try {
    const serverRes = await axios.get('https://api.gofile.io/getServer');
    const server = serverRes.data.data.server;

    const res = await axios.post(`https://${server}.gofile.io/uploadFile`, form, {
      headers: form.getHeaders()
    });

    fs.unlinkSync(filePath);

    if (res.data.status === 'ok') {
      const pageLink = res.data.data.downloadPage;
      const fileId = Object.keys(res.data.data.files)[0];
      const directLink = res.data.data.files[fileId].link;

      let mediaType = 'Media';
      if (mime.startsWith('image/')) mediaType = 'Image';
      else if (mime.startsWith('video/')) mediaType = 'Video';
      else if (mime.startsWith('application/')) mediaType = 'Document';

      m.reply(`✅ ${mediaType} uploaded successfully!\n\n🌐 Page: ${pageLink}\n📥 Direct: ${directLink}`);
    } else {
      m.reply('Failed to upload to gofile.io.');
    }
  } catch (err) {
    console.error(err);
    m.reply('Upload error:\n' + err.message);
  }
};