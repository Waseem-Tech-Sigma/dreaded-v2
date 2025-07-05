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
    const res = await axios.post('https://store1.gofile.io/uploadFile', form, {
      headers: form.getHeaders()
    });

    fs.unlinkSync(filePath);

    if (res.data.status === 'ok') {
      const link = res.data.data.downloadPage;
      const fileName = res.data.data.fileName;
      m.reply(`Upload Successful!\n\nFile: ${fileName}\nLink: ${link}`);
    } else {
      m.reply('Failed to upload to gofile.io.');
    }
  } catch (err) {
    console.error(err);
    m.reply('Upload error:\n' + err.message);
  }
};