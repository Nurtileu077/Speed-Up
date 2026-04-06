const express = require('express')
const router = express.Router()

let db, bitrix

function loadServices() {
  try {
    if (!db) db = require('../src/services/db-main')
    if (!bitrix) bitrix = require('../src/services/bitrix-main')
  } catch (err) {
    console.warn('[Webhooks] Service load warning:', err.message)
  }
}

// ─── Bitrix24 Webhook ─────────────────────────────────────────

router.post('/webhook/bitrix', async (req, res) => {
  loadServices()

  try {
    const body = req.body
    console.log('[Webhook] Bitrix24 event:', JSON.stringify(body).slice(0, 300))

    // Call completion events (various Bitrix24 telephony formats)
    const callEvents = ['ONCALLFINISH', 'ONEXTERNALCALLFINISH', 'ONEXTERNALCALLBACKSTART']
    if (callEvents.includes(body.event) || body.data?.CALL_ID) {
      handleCallFinish(body.data || body)
    }

    // New lead event
    if (body.event === 'ONCRMLEADADD') {
      console.log('[Webhook] New lead:', body.data?.FIELDS?.ID)
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Webhook] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

async function handleCallFinish(data) {
  const callId = data.CALL_ID
  const duration = parseInt(data.CALL_DURATION) || parseInt(data.DURATION) || 0
  const leadId = data.CRM_ENTITY_ID || data.ENTITY_ID || data.CRM_ENTITY

  // Recording URL comes directly in webhook body for SIP/Beeline connector
  const recordUrl = data.RECORD_URL || data.record_url || null

  console.log(`[Webhook] Call finished: id=${callId} lead=${leadId} duration=${duration}s recording=${!!recordUrl}`)

  if (!callId || !leadId) {
    console.log('[Webhook] Missing callId or leadId — skipping')
    return
  }
  if (duration < 30) {
    console.log('[Webhook] Call too short — skipping AI analysis')
    return
  }

  // Run AI pipeline in background
  setImmediate(async () => {
    try {
      loadServices()
      const settings = db.getSettings()
      bitrix.configure(settings)
      const pipeline = require('../src/services/ai-pipeline')
      // Pass recordUrl directly so pipeline doesn't need to fetch it separately
      await pipeline.runPipeline({ callId, leadId, durationSec: duration, recordUrl, db, bitrix })
    } catch (err) {
      console.error('[Webhook] AI pipeline error:', err.message)
    }
  })
}

// ─── Widget API (for Bitrix24 sidebar) ────────────────────────

router.get('/api/lead-widget/:leadId', async (req, res) => {
  loadServices()

  try {
    const leadId = req.params.leadId
    const attempts = db ? db.getCallAttempts(leadId) : []
    const lastAttempt = attempts[0] || null

    const waSent = attempts.filter(a => a.wa_sent).length
    const aiScores = attempts.filter(a => a.ai_score).map(a => a.ai_score)
    const avgAi = aiScores.length
      ? Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length * 10) / 10
      : null

    res.json({
      leadId,
      attempts: attempts.slice(0, 10),
      nextCall: lastAttempt?.next_call_at || null,
      stats: {
        totalAttempts: attempts.length,
        waSent,
        aiScore: avgAi
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Manager Stats API (for dashboard) ────────────────────────

router.get('/api/stats', async (req, res) => {
  loadServices()

  try {
    const { managerId, dateFrom, dateTo } = req.query
    const attempts = db ? db.getAllCallAttempts({ managerId, dateFrom, dateTo, limit: 5000 }) : []

    const total = attempts.length
    const connected = attempts.filter(a => ['connected', 'meeting', 'thinking'].includes(a.result)).length
    const talkSec = attempts.filter(a => a.duration_sec > 0).reduce((s, a) => s + a.duration_sec, 0)
    const aiScores = attempts.filter(a => a.ai_score).map(a => a.ai_score)

    res.json({
      total_calls: total,
      connected,
      talk_minutes: Math.round(talkSec / 60 * 10) / 10,
      connect_rate: total ? Math.round(connected / total * 100) : 0,
      avg_ai_score: aiScores.length
        ? Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length * 10) / 10
        : null
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
