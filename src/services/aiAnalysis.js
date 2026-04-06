const axios = require('axios')

const ANALYSIS_PROMPT = `Ты эксперт по продажам образовательных услуг. Оцени звонок менеджера по 6 критериям.

КРИТЕРИИ ОЦЕНКИ:
1. Приветствие и представление (10%) — назвал своё имя и компанию?
2. Выяснение потребности (20%) — спросил о цели, дедлайне, уровне клиента?
3. Презентация решения (20%) — рассказал программу под конкретный запрос клиента?
4. Работа с возражениями (20%) — отработал "дорого", "подумаю", "не сейчас"?
5. Закрытие на следующий шаг (20%) — назначил встречу или договорился о чём-то конкретном?
6. Тон и профессионализм (10%) — уверен, вежлив, не давил?

ТРАНСКРИПТ ЗВОНКА:
{transcript}

ИНФОРМАЦИЯ О ЛИДЕ:
{leadInfo}

Верни ТОЛЬКО JSON без пояснений:
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
  "client_mood": "<заинтересован|нейтрален|отказал>",
  "summary": "<краткое резюме 1-2 предложения>",
  "improvement": "<что улучшить менеджеру>"
}`

async function analyzeCall(transcript, leadInfo = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('Anthropic API key not configured')

  const leadInfoText = Object.entries(leadInfo)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  const prompt = ANALYSIS_PROMPT
    .replace('{transcript}', transcript)
    .replace('{leadInfo}', leadInfoText || 'Не указана')

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 30000
    }
  )

  const text = response.data?.content?.[0]?.text || ''

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI returned invalid JSON')

  return JSON.parse(jsonMatch[0])
}

function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const db = require('./db')
    return db.getSetting('ANTHROPIC_API_KEY') || null
  } catch {
    return null
  }
}

function formatBitrixComment(analysis, durationSec) {
  const duration = durationSec
    ? `${Math.floor(durationSec / 60)} мин ${durationSec % 60} сек`
    : 'неизвестно'

  return `✅ Дозвон — Итог разговора
Длительность: ${duration}
Цель клиента: ${analysis.client_goal || '—'}
Возражение: ${analysis.objection || '—'}
Договорённость: ${analysis.agreement || '—'}
Следующий шаг: ${analysis.next_step || '—'}
Оценка звонка: ${analysis.score}/10 — ${analysis.improvement || analysis.summary}`
}

module.exports = { analyzeCall, formatBitrixComment }
