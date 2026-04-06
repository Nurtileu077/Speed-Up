const axios = require('axios')

const WAZZUP_BASE = 'https://api.wazzup24.com/v3'

let apiKey = ''
let channelId = ''

function configure(settings) {
  if (settings.WAZZUP_API_KEY) apiKey = settings.WAZZUP_API_KEY
  if (settings.WAZZUP_CHANNEL_ID) channelId = settings.WAZZUP_CHANNEL_ID
}

function normalizePhone(phone) {
  return String(phone).replace(/\D/g, '')
}

async function sendMessage(phone, text) {
  if (!apiKey) throw new Error('Wazzup API key not configured. Go to Settings.')

  const response = await axios.post(
    `${WAZZUP_BASE}/message`,
    {
      channelId,
      chatType: 'whatsapp',
      chatId: normalizePhone(phone),
      text
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  )
  return response.data
}

async function sendFile(phone, text, fileUrl) {
  if (!apiKey) throw new Error('Wazzup API key not configured')

  const response = await axios.post(
    `${WAZZUP_BASE}/message`,
    {
      channelId,
      chatType: 'whatsapp',
      chatId: normalizePhone(phone),
      text,
      contentUri: fileUrl
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  )
  return response.data
}

// ─── Templates ────────────────────────────────────────────────

function noAnswerAttempt3(name, topic) {
  return `Здравствуйте, ${name || ''}! Мы пробовали вам позвонить насчёт ${topic || 'вашей заявки'}.\nУдобно ли созвониться сейчас?`
}

function noAnswerAttempt6(name) {
  return `Здравствуйте, ${name || ''}! Никак не можем дозвониться.\nУдобнее общаться в WhatsApp?`
}

function followUpThinking(name, topic) {
  return `Здравствуйте, ${name || ''}! Как ваше решение по ${topic || 'нашему предложению'}?\nГотов ответить на любые вопросы.`
}

function presentation(name) {
  return `Здравствуйте, ${name || ''}, как и обещали — наша программа.\nЕсли есть вопросы — напишите!`
}

function afterMeeting(name) {
  return `Здравствуйте, ${name || ''}, спасибо за встречу!\nВот что мы обсудили: ...`
}

function getAutoTemplate(attemptNum, name, topic) {
  if (attemptNum === 3) return noAnswerAttempt3(name, topic)
  if (attemptNum >= 6) return noAnswerAttempt6(name)
  return null
}

module.exports = {
  configure, sendMessage, sendFile,
  noAnswerAttempt3, noAnswerAttempt6, followUpThinking, presentation, afterMeeting,
  getAutoTemplate
}
