const axios = require('axios')

let db, bitrix, wazzup

function loadServices() {
  try {
    db = db || require('../src/services/db')
    bitrix = bitrix || require('../src/services/bitrix')
    wazzup = wazzup || require('../src/services/wazzup')
  } catch (err) {
    console.warn('[Scheduler] Service load warning:', err.message)
  }
}

function getWorkHours() {
  let start = process.env.WORK_HOURS_START || '09:00'
  let end = process.env.WORK_HOURS_END || '19:00'

  try {
    const settings = db?.getAllSettings() || {}
    if (settings.WORK_HOURS_START) start = settings.WORK_HOURS_START
    if (settings.WORK_HOURS_END) end = settings.WORK_HOURS_END
  } catch {}

  return { start, end }
}

function isWorkingHours(date = new Date()) {
  const { start, end } = getWorkHours()
  const [startH, startM] = start.split(':').map(Number)
  const [endH, endM] = end.split(':').map(Number)

  const hour = date.getHours()
  const minute = date.getMinutes()
  const timeVal = hour * 60 + minute

  return timeVal >= (startH * 60 + startM) && timeVal < (endH * 60 + endM)
}

function nextWorkingTime(date = new Date()) {
  const { start } = getWorkHours()
  const [startH, startM] = start.split(':').map(Number)

  const next = new Date(date)
  next.setDate(next.getDate() + 1)
  next.setHours(startH, startM, 0, 0)
  return next
}

function calcNextAttemptTime(attemptNum) {
  // Retry intervals: 2h, 3h, next day 09:00, +4h, +4h
  const intervals = [0, 2, 3, 0, 4, 4] // hours
  const now = new Date()
  let next

  if (attemptNum <= 3) {
    const hoursToAdd = intervals[attemptNum] || 2
    next = new Date(now.getTime() + hoursToAdd * 3600000)
  } else {
    // Attempts 4,5,6 — specific times next day
    const times = ['09:00', '13:00', '17:00']
    const timeStr = times[attemptNum - 4] || '09:00'
    const [h, m] = timeStr.split(':').map(Number)
    next = new Date(now)
    next.setDate(next.getDate() + 1)
    next.setHours(h, m, 0, 0)
  }

  // If next time is outside working hours, push to next working day 09:00
  if (!isWorkingHours(next)) {
    next = nextWorkingTime(next)
  }

  return next.toISOString()
}

async function sendTelegramAlert(message) {
  let botToken, chatId

  try {
    const settings = db?.getAllSettings() || {}
    botToken = settings.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
    chatId = settings.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID
  } catch {
    botToken = process.env.TELEGRAM_BOT_TOKEN
    chatId = process.env.TELEGRAM_CHAT_ID
  }

  if (!botToken || !chatId) return

  try {
    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { chat_id: chatId, text: message, parse_mode: 'HTML' },
      { timeout: 5000 }
    )
  } catch (err) {
    console.error('[Scheduler] Telegram alert failed:', err.message)
  }
}

async function checkOverdueLeads() {
  if (!db || !bitrix) return

  try {
    const now = new Date()
    const twoHoursAgo = new Date(now - 2 * 3600000).toISOString()

    // Get leads with no calls in 2+ hours
    const newLeads = await bitrix.getNewLeads()
    if (!Array.isArray(newLeads)) return

    for (const lead of newLeads) {
      const attempts = db.getAttemptCount(lead.ID)
      if (attempts === 0 && new Date(lead.DATE_CREATE) < new Date(twoHoursAgo)) {
        await sendTelegramAlert(
          `🚨 Лид #${lead.ID} (${lead.TITLE}) висит без звонка более 2 часов после создания!`
        )
      }
    }
  } catch (err) {
    console.error('[Scheduler] checkOverdueLeads error:', err.message)
  }
}

let interval = null

function start() {
  loadServices()
  console.log('[Scheduler] Started')

  // Check every minute
  interval = setInterval(async () => {
    loadServices()
    if (isWorkingHours()) {
      await checkOverdueLeads()
    }
  }, 60 * 1000)
}

function stop() {
  if (interval) {
    clearInterval(interval)
    interval = null
    console.log('[Scheduler] Stopped')
  }
}

module.exports = {
  start,
  stop,
  calcNextAttemptTime,
  isWorkingHours,
  nextWorkingTime,
  sendTelegramAlert
}
