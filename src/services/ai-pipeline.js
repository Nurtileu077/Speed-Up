/**
 * Phase 4: Full AI analysis pipeline
 * Runs in Electron main process.
 *
 * Flow:
 * 1. Get call recording URL from Bitrix24
 * 2. Download and transcribe via OpenAI Whisper
 * 3. Analyze with Claude API
 * 4. Save to SQLite
 * 5. Post comment to Bitrix24 timeline
 * 6. Update custom lead fields
 */

const axios = require('axios')
const fs = require('fs')
const path = require('path')
const os = require('os')

const ANALYSIS_PROMPT = `Ты эксперт по продажам образовательных услуг. Оцени звонок менеджера по 6 критериям.

КРИТЕРИИ ОЦЕНКИ (каждый от 0 до 10):
1. Приветствие и представление (10%) — назвал своё имя и компанию?
2. Выяснение потребности (20%) — спросил о цели, дедлайне, уровне клиента?
3. Презентация решения (20%) — рассказал программу под конкретный запрос?
4. Работа с возражениями (20%) — отработал "дорого", "подумаю", "не сейчас"?
5. Закрытие на следующий шаг (20%) — назначил встречу или конкретную договорённость?
6. Тон и профессионализм (10%) — уверен, вежлив, не давил?

ТРАНСКРИПТ ЗВОНКА:
{transcript}

ИНФОРМАЦИЯ О ЛИДЕ:
{leadInfo}

Верни ТОЛЬКО JSON:
{
  "score": <общая оценка 1-10>,
  "criteria": {
    "greeting": <0-10>,
    "needs_discovery": <0-10>,
    "presentation": <0-10>,
    "objection_handling": <0-10>,
    "closing": <0-10>,
    "tone": <0-10>
  },
  "client_goal": "<цель клиента>",
  "client_deadline": "<дедлайн клиента или null>",
  "objection": "<главное возражение или null>",
  "agreement": "<договорённость или null>",
  "next_step": "<следующий шаг или null>",
  "client_mood": "<заинтересован|нейтрален|скептичен|отказал>",
  "summary": "<краткое резюме разговора, 1-2 предложения>",
  "improvement": "<главная рекомендация менеджеру>"
}`

async function transcribeAudio(audioUrl, openaiKey) {
  const tmpPath = path.join(os.tmpdir(), `nobilis_call_${Date.now()}.mp3`)

  try {
    // Download
    const audioRes = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 60000
    })
    fs.writeFileSync(tmpPath, Buffer.from(audioRes.data))

    // Transcribe with Whisper
    const FormData = require('form-data')
    const form = new FormData()
    form.append('file', fs.createReadStream(tmpPath), { filename: 'call.mp3', contentType: 'audio/mpeg' })
    form.append('model', 'whisper-1')
    form.append('language', 'ru')
    form.append('response_format', 'text')

    const whisperRes = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: { Authorization: `Bearer ${openaiKey}`, ...form.getHeaders() },
        timeout: 120000,
        maxContentLength: 50 * 1024 * 1024
      }
    )

    return whisperRes.data
  } finally {
    try { fs.unlinkSync(tmpPath) } catch {}
  }
}

async function analyzeWithClaude(transcript, leadInfo, anthropicKey) {
  const leadInfoText = typeof leadInfo === 'string'
    ? leadInfo
    : Object.entries(leadInfo || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n') || 'Не указана'

  const prompt = ANALYSIS_PROMPT
    .replace('{transcript}', transcript)
    .replace('{leadInfo}', leadInfoText)

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 45000
    }
  )

  const text = response.data?.content?.[0]?.text || ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude returned no JSON')
  return JSON.parse(jsonMatch[0])
}

function formatBitrixComment(analysis, durationSec) {
  const dur = durationSec
    ? `${Math.floor(durationSec / 60)} мин ${durationSec % 60} сек`
    : 'неизвестно'

  return `✅ Дозвон — Итог разговора
Длительность: ${dur}
Цель клиента: ${analysis.client_goal || '—'}
Возражение: ${analysis.objection || '—'}
Договорённость: ${analysis.agreement || '—'}
Следующий шаг: ${analysis.next_step || '—'}
Оценка звонка: ${analysis.score}/10 — ${analysis.improvement || analysis.summary}`
}

/**
 * Run full pipeline:
 *  recording URL → Whisper → Claude → SQLite + Bitrix24
 */
async function runPipeline({ callId, leadId, durationSec, recordUrl: providedRecordUrl, db, bitrix }) {
  const settings = db.getSettings()
  const openaiKey = settings.OPENAI_API_KEY
  const anthropicKey = settings.ANTHROPIC_API_KEY

  if (!openaiKey || !anthropicKey) {
    console.log('[AI] Missing API keys — skipping analysis')
    return null
  }

  console.log(`[AI] Starting pipeline for call ${callId}, lead ${leadId}`)

  // Step 1: Get recording URL
  // For SIP/Beeline: URL comes directly in webhook body (providedRecordUrl)
  // Fallback: search via crm.activity.list
  let recordUrl = providedRecordUrl || null

  if (!recordUrl) {
    try {
      recordUrl = await bitrix.getCallRecording(callId)
    } catch (err) {
      console.warn('[AI] Could not fetch recording via activity:', err.message)
    }
  }

  if (!recordUrl) {
    console.log('[AI] No recording URL available — skipping analysis')
    return null
  }

  // Step 2: Transcribe
  console.log('[AI] Transcribing...')
  const transcript = await transcribeAudio(recordUrl, openaiKey)
  console.log(`[AI] Transcript: ${transcript.length} chars`)

  if (transcript.length < 20) {
    console.log('[AI] Transcript too short — skipping')
    return null
  }

  // Step 3: Analyze
  console.log('[AI] Analyzing with Claude...')
  const leadInfo = {}
  try {
    const lead = await bitrix.getLead(leadId)
    if (lead) {
      leadInfo.name = [lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ')
      leadInfo.source = lead.SOURCE_ID
      leadInfo.comments = lead.COMMENTS
    }
  } catch {}

  const analysis = await analyzeWithClaude(transcript, leadInfo, anthropicKey)
  console.log(`[AI] Score: ${analysis.score}/10`)

  // Step 4: Save to SQLite
  const attempts = db.getCallAttempts(leadId)
  if (attempts.length > 0) {
    db.updateAiScore(attempts[0].id, analysis.score, analysis.summary)
  }

  db.saveAiAnalysis({
    lead_id: String(leadId),
    call_attempt_id: attempts.length > 0 ? attempts[0].id : null,
    score: analysis.score,
    criteria: analysis.criteria,
    client_goal: analysis.client_goal,
    client_deadline: analysis.client_deadline,
    objection: analysis.objection,
    agreement: analysis.agreement,
    next_step: analysis.next_step,
    client_mood: analysis.client_mood,
    summary: analysis.summary,
    improvement: analysis.improvement,
    transcript
  })

  // Step 5: Post comment to Bitrix24 timeline
  const comment = formatBitrixComment(analysis, durationSec)
  try {
    await bitrix.addTimelineComment(leadId, comment)
  } catch (err) {
    console.error('[AI] Failed to post comment:', err.message)
  }

  // Step 6: Update custom lead fields
  try {
    await bitrix.updateLead(leadId, {
      UF_CRM_AI_SCORE: String(analysis.score),
      UF_CRM_CLIENT_GOAL: analysis.client_goal || '',
      UF_CRM_CLIENT_DEADLINE: analysis.client_deadline || '',
      UF_CRM_OBJECTION: analysis.objection || '',
      UF_CRM_CLIENT_MOOD: analysis.client_mood || '',
      UF_CRM_AGREEMENT: analysis.agreement || '',
      COMMENTS: `AI: ${analysis.summary}`
    })
  } catch (err) {
    console.error('[AI] Failed to update lead fields:', err.message)
  }

  // Step 7: Check for low score alert
  if (analysis.score < 4) {
    const scheduler = require('./scheduler-main')
    await scheduler.sendTelegramAlert(
      `🚨 AI оценка ${analysis.score}/10 — Лид #${leadId}\n${analysis.improvement}`,
      'low_ai_score'
    )
  }

  console.log(`[AI] Pipeline complete for lead ${leadId}`)
  return analysis
}

module.exports = { runPipeline, transcribeAudio, analyzeWithClaude, formatBitrixComment }
