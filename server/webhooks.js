const express = require('express')
const router = express.Router()

// These require() calls are safe — db and bitrix run in the server context
let db, bitrix, whisper, aiAnalysis, wazzup

try {
  db = require('../src/services/db')
  bitrix = require('../src/services/bitrix')
  whisper = require('../src/services/whisper')
  aiAnalysis = require('../src/services/aiAnalysis')
  wazzup = require('../src/services/wazzup')
} catch (err) {
  console.warn('[Webhooks] Service import warning:', err.message)
}

// Bitrix24 sends event data as POST with body
router.post('/webhook/bitrix', async (req, res) => {
  try {
    const body = req.body
    console.log('[Webhook] Received Bitrix24 event:', JSON.stringify(body).slice(0, 200))

    // Call completion event
    if (body.event === 'ONCALLFINISH' || body.data?.CALL_ID) {
      await handleCallFinish(body.data || body)
    }

    // Lead created event
    if (body.event === 'ONCRMLEIDADD' || body.event === 'ONCRMLEADADD') {
      console.log('[Webhook] New lead created:', body.data?.FIELDS?.ID)
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Webhook] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

async function handleCallFinish(data) {
  const callId = data.CALL_ID
  const duration = parseInt(data.CALL_DURATION) || 0
  const recordUrl = data.RECORD_URL

  console.log(`[Webhook] Call finished: ${callId}, duration: ${duration}s, recording: ${!!recordUrl}`)

  if (!recordUrl || duration < 30) {
    console.log('[Webhook] No recording or too short — skipping AI analysis')
    return
  }

  // Run AI analysis in background
  setImmediate(async () => {
    try {
      console.log('[AI] Starting analysis for call:', callId)

      // Step 1: Transcribe
      const transcript = await whisper.transcribeAudio(recordUrl)
      console.log('[AI] Transcription complete, length:', transcript.length)

      // Step 2: Find which lead this call belongs to
      const leadId = data.ENTITY_ID || data.CRM_ENTITY_ID

      // Step 3: Analyze with Claude
      const analysis = await aiAnalysis.analyzeCall(transcript, { leadId })
      console.log('[AI] Analysis complete, score:', analysis.score)

      // Step 4: Save to SQLite
      if (db && leadId) {
        const attempts = db.getCallAttempts(leadId)
        if (attempts.length > 0) {
          db.updateAiScore(attempts[0].id, analysis.score, analysis.summary)
        }
      }

      // Step 5: Post comment to Bitrix24 timeline
      if (bitrix && leadId) {
        const comment = aiAnalysis.formatBitrixComment(analysis, duration)
        await bitrix.addTimelineComment(leadId, comment)

        // Step 6: Update custom lead fields
        await bitrix.updateLead(leadId, {
          UF_CRM_CLIENT_GOAL: analysis.client_goal,
          UF_CRM_OBJECTION: analysis.objection,
          UF_CRM_AGREEMENT: analysis.agreement,
          UF_CRM_CLIENT_MOOD: analysis.client_mood,
          UF_CRM_AI_SCORE: String(analysis.score)
        })
      }

      console.log('[AI] Analysis pipeline complete for lead:', leadId)
    } catch (err) {
      console.error('[AI] Analysis pipeline failed:', err.message)
    }
  })
}

module.exports = router
