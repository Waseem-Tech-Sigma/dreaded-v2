module.exports = async (context) => {
  const { client, m } = context;
  const fs = require('fs');
  const axios = require('axios');
  const FormData = require('form-data');
  const path = require('path');

  const q = m.quoted ? m.quoted : m;
  const mime = (q.msg || q).mimetype || '';

  if (!mime) return m.reply('❌ Reply to a media file to upload.');

  const mediaBuffer = await q.download();
  if (mediaBuffer.length > 100 * 1024 * 1024) return m.reply('❌ File too large (limit 100 MB).');

  const tempFile = path.join(__dirname, `upload_${Date.now()}`);
  fs.writeFileSync(tempFile, mediaBuffer);

  m.reply('⏳ Uploading file, please wait...');

  const providers = [
    async () => {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFile));
      const res = await axios.post('https://pixeldrain.com/api/file/anonymous', form, {
        headers: form.getHeaders()
      });
      const id = res.data.id;
      return {
        name: 'Pixeldrain',
        page: `https://pixeldrain.com/u/${id}`,
        direct: `https://pixeldrain.com/api/file/${id}`
      };
    },
    async () => {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFile));
      const res = await axios.post('https://file.io/', form, {
        headers: form.getHeaders()
      });
      if (!res.data.success) throw new Error('File.io failed');
      return {
        name: 'File.io',
        page: res.data.link,
        direct: res.data.link
      };
    },
    async () => {
      const fileName = `upload_${Date.now()}.bin`;
      const res = await axios.put(`https://transfer.sh/${fileName}`, fs.createReadStream(tempFile), {
        headers: { 'Content-Type': 'application/octet-stream' }
      });
      return {
        name: 'Transfer.sh',
        page: res.data,
        direct: res.data
      };
    },
    async () => {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFile));
      const res = await axios.post('https://uguu.se/upload.php', form, {
        headers: form.getHeaders()
      });
      if (!res.data.files || res.data.files.length === 0) throw new Error('Uguu failed');
      return {
        name: 'Uguu.se',
        page: res.data.files[0].url,
        direct: res.data.files[0].url
      };
    },
    async () => {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFile));
      const res = await axios.post('https://api.bayfiles.com/upload', form, {
        headers: form.getHeaders()
      });
      const fileData = res.data.data.file;
      return {
        name: 'Bayfiles',
        page: fileData.url.short,
        direct: fileData.url.full
      };
    }
  ];

  for (let provider of providers) {
    try {
      const result = await provider();
      fs.unlinkSync(tempFile);
      return m.reply(`✅ Uploaded to ${result.name}!\n\n🌐 Page: ${result.page}\n📥 Direct: ${result.direct}`);
    } catch (err) {
      console.error(`[Uploader] ${provider.name || 'Provider'} failed:`, err.message);
    }
  }

  fs.unlinkSync(tempFile);
  m.reply('❌ All upload providers failed. Please try again later.');
};