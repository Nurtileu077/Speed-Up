const axios = require('axios')
const fs = require('fs')
const path = require('path')
const os = require('os')

async function transcribeAudio(audioUrl) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API key not configured')

  // Download audio file
  const tmpPath = path.join(os.tmpdir(), `call_${Date.now()}.mp3`)

  try {
    const response = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 60000
    })

    fs.writeFileSync(tmpPath, Buffer.from(response.data))

    // Send to Whisper API using form-data
    const FormData = require('form-data')
    const form = new FormData()
    form.append('file', fs.createReadStream(tmpPath), {
      filename: 'audio.mp3',
      contentType: 'audio/mpeg'
    })
    form.append('model', 'whisper-1')
    form.append('language', 'ru')

    const whisperResponse = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders()
        },
        timeout: 120000
      }
    )

    return whisperResponse.data.text

  } finally {
    try { fs.unlinkSync(tmpPath) } catch {}
  }
}

function getApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  try {
    const db = require('./db')
    return db.getSetting('OPENAI_API_KEY') || null
  } catch {
    return null
  }
}

module.exports = { transcribeAudio }
