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

    const uploadRes = await axios.post(`https://${server}.gofile.io/uploadFile`, form, {
      headers: form.getHeaders()
    });

    fs.unlinkSync(filePath);

    const result = uploadRes.data;
    if (result.status !== 'ok') return m.reply('Failed to upload to gofile.io.');

    const fileName = result.data.fileName;
    const directLink = result.data.downloadPage.replace('/d/', '/download/');
    m.reply(`Upload Successful!\n\nFile: ${fileName}\nLink: ${directLink}`);
  } catch (err) {
    console.error(err);
    m.reply('Upload error:\n' + err.message);
  }
};