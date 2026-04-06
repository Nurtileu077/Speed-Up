/**
 * Phase 2 + 3 + 5: Full scheduler for auto-dial, WhatsApp, and Telegram alerts
 *
 * Runs inside Electron main process.
 * - Every 60s checks for overdue retries, scheduled WA, and alert conditions.
 * - Respects work hours (09:00–19:00).
 * - Sends Telegram alerts for overdue leads, missed calls, low AI scores.
 */

const axios = require('axios')

let db = null
let bitrix = null
let wazzup = null
let interval = null

function configure(deps) {
  db = deps.db
  bitrix = deps.bitrix
  wazzup = deps.wazzup
}

// ─── Work Hours ────────────────────────────────────────────────

function getWorkHours() {
  const settings = db?.getSettings() || {}
  return {
    start: settings.WORK_HOURS_START || '09:00',
    end: settings.WORK_HOURS_END || '19:00'
  }
}

function isWorkingHours(date = new Date()) {
  const { start, end } = getWorkHours()
  const [sH, sM] = start.split(':').map(Number)
  const [eH, eM] = end.split(':').map(Number)
  const mins = date.getHours() * 60 + date.getMinutes()
  return mins >= sH * 60 + sM && mins < eH * 60 + eM
}

function nextWorkingDay09(date = new Date()) {
  const { start } = getWorkHours()
  const [h, m] = start.split(':').map(Number)
  const next = new Date(date)
  next.setDate(next.getDate() + 1)
  next.setHours(h, m, 0, 0)
  return next
}

// ─── Retry Schedule (6 attempts) ──────────────────────────────
// #1 — immediately
// #2 — +2 hours
// #3 — +3 hours (+auto WA)
// #4 — next day 09:00
// #5 — next day 13:00
// #6 — next day 17:00 (+auto WA)

function calcNextAttemptTime(attemptNum) {
  const now = new Date()
  let next

  switch (attemptNum) {
    case 1:
      next = new Date(now.getTime() + 2 * 3600000)
      break
    case 2:
      next = new Date(now.getTime() + 3 * 3600000)
      break
    case 3: {
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)
      next = tomorrow
      break
    }
    case 4: {
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(13, 0, 0, 0)
      next = tomorrow
      break
    }
    case 5: {
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(17, 0, 0, 0)
      next = tomorrow
      break
    }
    default:
      next = null // No more attempts
  }

  // If outside work hours, push to next work day
  if (next && !isWorkingHours(next)) {
    next = nextWorkingDay09(next)
  }

  return next ? next.toISOString() : null
}

// ─── Telegram Alerts ──────────────────────────────────────────

async function sendTelegramAlert(message, type = 'general') {
  const settings = db?.getSettings() || {}
  const botToken = settings.TELEGRAM_BOT_TOKEN
  const chatId = settings.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) return false

  try {
    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { chat_id: chatId, text: message, parse_mode: 'HTML' },
      { timeout: 5000 }
    )
    db?.saveAlert(type, message)
    return true
  } catch (err) {
    console.error('[Scheduler] Telegram alert failed:', err.message)
    return false
  }
}

// ─── Scheduled WhatsApp ───────────────────────────────────────

async function processScheduledWa() {
  if (!db || !wazzup) return

  const pending = db.getPendingWa()
  for (const msg of pending) {
    try {
      await wazzup.sendMessage(msg.phone, msg.message)
      db.markWaScheduledSent(msg.id)
      console.log(`[Scheduler] WA sent to ${msg.phone} for lead ${msg.lead_id}`)
    } catch (err) {
      console.error(`[Scheduler] WA send failed for lead ${msg.lead_id}:`, err.message)
    }
  }
}

// ─── Alert Checks ─────────────────────────────────────────────

async function checkOverdueLeads() {
  if (!db || !bitrix) return

  try {
    const newLeads = await bitrix.getNewLeads()
    if (!Array.isArray(newLeads)) return

    const twoHoursAgo = new Date(Date.now() - 2 * 3600000)

    for (const lead of newLeads) {
      if (new Date(lead.DATE_CREATE) > twoHoursAgo) continue
      const attempts = db.getAttemptCount(lead.ID)
      if (attempts === 0) {
        const name = [lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ') || lead.TITLE
        await sendTelegramAlert(
          `🚨 Лид #${lead.ID} (${name}) висит без звонка более 2 часов!`,
          'overdue_lead'
        )
      }
    }
  } catch (err) {
    console.error('[Scheduler] checkOverdueLeads error:', err.message)
  }
}

async function checkOverdueTasks() {
  if (!db || !bitrix) return

  try {
    const settings = db.getSettings()
    const userId = settings.BITRIX_USER_ID
    if (!userId) return

    const result = await bitrix.getOverdueTasks(userId)
    const tasks = Array.isArray(result) ? result : result?.tasks || []
    const oneHourAgo = new Date(Date.now() - 3600000)

    for (const task of tasks) {
      if (new Date(task.DEADLINE) < oneHourAgo) {
        await sendTelegramAlert(
          `🚨 Задача "${task.TITLE}" просрочена более чем на 1 час!`,
          'overdue_task'
        )
      }
    }
  } catch (err) {
    console.error('[Scheduler] checkOverdueTasks error:', err.message)
  }
}

async function checkExceededAttempts() {
  if (!db) return

  const exceeded = db.getLeadsExceededAttempts()
  for (const lead of exceeded) {
    await sendTelegramAlert(
      `🚨 Лид ${lead.lead_name || '#' + lead.lead_id} — 6 недозвонов. Нужно решение руководителя.`,
      'exceeded_attempts'
    )
  }
}

async function checkLowAiScores() {
  if (!db) return

  try {
    const today = new Date().toISOString().slice(0, 10)
    const attempts = db.getAllCallAttempts({ dateFrom: today + 'T00:00:00', limit: 100 })

    for (const a of attempts) {
      if (a.ai_score && a.ai_score < 4) {
        await sendTelegramAlert(
          `🚨 Оценка AI звонка ${a.ai_score}/10 у лида ${a.lead_name || '#' + a.lead_id}. Нужен разбор с менеджером.`,
          'low_ai_score'
        )
      }
    }
  } catch (err) {
    console.error('[Scheduler] checkLowAiScores error:', err.message)
  }
}

// ─── Main Tick ────────────────────────────────────────────────

async function tick() {
  if (!isWorkingHours()) return

  try {
    await processScheduledWa()
    await checkOverdueLeads()
    await checkOverdueTasks()
    await checkExceededAttempts()
    await checkLowAiScores()
  } catch (err) {
    console.error('[Scheduler] Tick error:', err.message)
  }
}

function start() {
  console.log('[Scheduler] Started (60s interval)')
  // First tick after 10s
  setTimeout(tick, 10_000)
  interval = setInterval(tick, 60_000)
}

function stop() {
  if (interval) { clearInterval(interval); interval = null }
  console.log('[Scheduler] Stopped')
}

module.exports = {
  configure, start, stop,
  calcNextAttemptTime, isWorkingHours, sendTelegramAlert,
  tick
}
