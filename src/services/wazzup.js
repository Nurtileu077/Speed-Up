const axios = require('axios')

const WAZZUP_BASE = 'https://api.wazzup24.com/v3'

function getConfig() {
  let apiKey = process.env.WAZZUP_API_KEY || ''
  let channelId = process.env.WAZZUP_CHANNEL_ID || ''

  try {
    const db = require('./db')
    const settings = db.getAllSettings()
    if (settings.WAZZUP_API_KEY) apiKey = settings.WAZZUP_API_KEY
    if (settings.WAZZUP_CHANNEL_ID) channelId = settings.WAZZUP_CHANNEL_ID
  } catch {}

  return { apiKey, channelId }
}

async function sendMessage(phone, text) {
  const { apiKey, channelId } = getConfig()
  if (!apiKey) throw new Error('Wazzup API key not configured')

  // Normalize phone: remove non-digits, ensure starts with country code
  const normalizedPhone = phone.replace(/\D/g, '')

  const response = await axios.post(
    `${WAZZUP_BASE}/message`,
    {
      channelId,
      chatType: 'whatsapp',
      chatId: normalizedPhone,
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
  const { apiKey, channelId } = getConfig()
  if (!apiKey) throw new Error('Wazzup API key not configured')

  const normalizedPhone = phone.replace(/\D/g, '')

  const response = await axios.post(
    `${WAZZUP_BASE}/message`,
    {
      channelId,
      chatType: 'whatsapp',
      chatId: normalizedPhone,
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

// ---- Message Templates ----

function templateNoAnswerAttempt3(name, topic) {
  return `Здравствуйте, ${name}! Мы пробовали вам позвонить насчёт ${topic || 'вашей заявки'}.\nУдобно ли созвониться сейчас?`
}

function templateNoAnswerAttempt6(name) {
  return `Здравствуйте, ${name}! Никак не можем дозвониться.\nУдобнее общаться в WhatsApp?`
}

function templateFollowUpThinking(name, topic) {
  return `Здравствуйте, ${name}! Как ваше решение по ${topic || 'нашему предложению'}?\nГотов ответить на любые вопросы.`
}

function templatePresentation(name) {
  return `Здравствуйте, ${name}, как и обещали — наша программа.\nЕсли есть вопросы — напишите!`
}

function templateAfterMeeting(name, summary) {
  return `Здравствуйте, ${name}, спасибо за встречу!\nВот что мы обсудили: ${summary || '...'}`
}

function getTemplateForAttempt(attemptNum, name, topic) {
  if (attemptNum === 3) return templateNoAnswerAttempt3(name, topic)
  if (attemptNum >= 6) return templateNoAnswerAttempt6(name)
  return null
}

module.exports = {
  sendMessage,
  sendFile,
  templateNoAnswerAttempt3,
  templateNoAnswerAttempt6,
  templateFollowUpThinking,
  templatePresentation,
  templateAfterMeeting,
  getTemplateForAttempt
}
