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

  m.reply('⏳ Starting upload...');

  const providers = [
    {
      name: 'Catbox.moe',
      upload: async () => {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(tempFile));
        const res = await axios.post('https://catbox.moe/user/api.php', form, {
          headers: form.getHeaders()
        });
        if (!res.data.startsWith('https://')) throw new Error('Invalid Catbox response');
        return { page: res.data, direct: res.data };
      }
    },
    {
      name: 'Pixeldrain',
      upload: async () => {
        const form = new FormData();
        form.append('file', fs.createReadStream(tempFile));
        const res = await axios.post('https://pixeldrain.com/api/file/anonymous', form, {
          headers: form.getHeaders()
        });
        const id = res.data.id;
        return {
          page: `https://pixeldrain.com/u/${id}`,
          direct: `https://pixeldrain.com/api/file/${id}`
        };
      }
    },
    {
      name: 'File.io',
      upload: async () => {
        const form = new FormData();
        form.append('file', fs.createReadStream(tempFile));
        const res = await axios.post('https://file.io/', form, {
          headers: form.getHeaders()
        });
        if (!res.data.success) throw new Error('Upload failed');
        return { page: res.data.link, direct: res.data.link };
      }
    },
    {
      name: 'Transfer.sh',
      upload: async () => {
        const fileName = `upload_${Date.now()}.bin`;
        const res = await axios.put(`https://transfer.sh/${fileName}`, fs.createReadStream(tempFile), {
          headers: { 'Content-Type': 'application/octet-stream' }
        });
        return { page: res.data, direct: res.data };
      }
    },
    {
      name: 'Uguu.se',
      upload: async () => {
        const form = new FormData();
        form.append('file', fs.createReadStream(tempFile));
        const res = await axios.post('https://uguu.se/upload.php', form, {
          headers: form.getHeaders()
        });
        if (!res.data.files || res.data.files.length === 0) throw new Error('No file returned');
        return {
          page: res.data.files[0].url,
          direct: res.data.files[0].url
        };
      }
    },
    {
      name: 'Bayfiles',
      upload: async () => {
        const form = new FormData();
        form.append('file', fs.createReadStream(tempFile));
        const res = await axios.post('https://api.bayfiles.com/upload', form, {
          headers: form.getHeaders()
        });
        const fileData = res.data.data.file;
        return {
          page: fileData.url.short,
          direct: fileData.url.full
        };
      }
    }
  ];

  for (let i = 0; i < providers.length; i++) {
    const { name, upload } = providers[i];
    try {
      await m.reply(`📡 Trying ${name}...`);
      const result = await upload();
      fs.unlinkSync(tempFile);
      return m.reply(`✅ Uploaded to ${name}!\n\n🌐 Page: ${result.page}\n📥 Direct: ${result.direct}`);
    } catch (err) {
      const next = providers[i + 1] ? providers[i + 1].name : 'no other providers';
      await m.reply(`⚠️ ${name} failed: ${err.message}\n🔁 Trying ${next}...`);
    }
  }

  fs.unlinkSync(tempFile);
  m.reply('❌ All upload providers failed. Please try again later.');
};