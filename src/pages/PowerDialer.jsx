import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Phone, PhoneOff, CheckCircle, XCircle, ChevronRight, RefreshCw, Zap, PhoneCall } from 'lucide-react'
import useSip from '../hooks/useSip'

const STATUS = {
  PENDING:  'pending',
  DIALING:  'dialing',   // tel: fired, waiting for manager to say connected/no-answer
  ACTIVE:   'active',    // timer running
  DONE:     'done',
  SKIPPED:  'skipped'
}

// ─── Result definitions ────────────────────────────────────────
const RESULTS = [
  { id: 'meeting',   label: 'Встреча',    color: 'emerald', connected: true },
  { id: 'thinking',  label: 'Думает',     color: 'blue',    connected: true },
  { id: 'no_answer', label: 'Не берёт',   color: 'slate',   connected: false },
  { id: 'busy',      label: 'Занято',     color: 'orange',  connected: false },
  { id: 'rejected',  label: 'Отказ',      color: 'red',     connected: true }
]

const RESULT_LABEL = {
  meeting: 'Встреча', thinking: 'Думает', no_answer: 'Не берёт',
  busy: 'Занято', rejected: 'Отказ', skipped: 'Пропущен'
}

const COLOR_BTN = {
  emerald: 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30',
  blue:    'bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/30',
  slate:   'bg-slate-700 hover:bg-slate-600 text-slate-300',
  orange:  'bg-orange-600/30 hover:bg-orange-600/50 text-orange-300 border border-orange-500/30',
  red:     'bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/30'
}

const BADGE = {
  meeting: 'bg-emerald-600/20 text-emerald-400',
  thinking: 'bg-blue-600/20 text-blue-400',
  no_answer: 'bg-slate-700 text-slate-400',
  busy: 'bg-orange-600/20 text-orange-400',
  rejected: 'bg-red-600/20 text-red-400',
  skipped: 'bg-slate-700 text-slate-500'
}

// ─── Helpers ───────────────────────────────────────────────────
function getPhone(lead) {
  if (!lead) return ''
  const p = lead.phone || lead.PHONE
  if (!p) return ''
  if (Array.isArray(p)) return p[0]?.VALUE || ''
  return String(p)
}

function getName(lead) {
  if (!lead) return ''
  if (lead.name) return lead.name
  const parts = [lead.NAME, lead.LAST_NAME].filter(Boolean)
  if (parts.length) return parts.join(' ')
  return lead.TITLE || `#${lead.ID || lead.id || ''}`
}

function formatPhone(phone) {
  if (!phone) return '—'
  const c = String(phone).replace(/\D/g, '')
  if (c.length === 11) return `+${c[0]} (${c.slice(1,4)}) ${c.slice(4,7)}-${c.slice(7,9)}-${c.slice(9)}`
  if (c.length === 10) return `+7 (${c.slice(0,3)}) ${c.slice(3,6)}-${c.slice(6,8)}-${c.slice(8)}`
  return phone
}

function useTimer(running) {
  const [seconds, setSeconds] = useState(0)
  const ref = useRef(null)
  useEffect(() => {
    if (running) { setSeconds(0); ref.current = setInterval(() => setSeconds(s => s + 1), 1000) }
    else clearInterval(ref.current)
    return () => clearInterval(ref.current)
  }, [running])
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return { seconds, display: `${mm}:${ss}` }
}

// ─── Save result to Bitrix24 + DB ──────────────────────────────
async function saveResult({ lead, resultId, durationSec, attemptNum, settings }) {
  const leadId    = String(lead?.ID || lead?.id || '')
  const phone     = getPhone(lead)
  const name      = getName(lead)
  const entityType = lead?.entityType || 'deal'
  const isConnected = ['meeting', 'thinking', 'rejected'].includes(resultId)

  // 1. Save call attempt to local DB
  let nextCallAt = null
  try {
    if (!isConnected) nextCallAt = await window.electronAPI?.scheduler?.calcNextAttempt(attemptNum)
  } catch {}

  try {
    await window.electronAPI?.db?.saveCallAttempt({
      lead_id: leadId, manager_id: 'current',
      attempt_num: attemptNum,
      called_at: new Date().toISOString(),
      duration_sec: durationSec, result: resultId,
      next_call_at: nextCallAt,
      lead_name: name, lead_phone: phone, bitrix_call_id: null
    })
  } catch {}

  // 2. Bitrix24 comment
  const LABELS = { meeting: 'Встреча', thinking: 'Думает', no_answer: 'Не берёт', busy: 'Занято', rejected: 'Отказ' }
  const commentText = isConnected
    ? `✅ Дозвон #${attemptNum}\nДлительность: ${durationSec}с\nРезультат: ${LABELS[resultId]}`
    : `📞 Недозвон #${attemptNum}\nРезультат: ${LABELS[resultId]}${nextCallAt ? `\nСледующий звонок: ${new Date(nextCallAt).toLocaleString('ru')}` : ''}`
  try { await window.electronAPI?.bitrix?.addComment(leadId, commentText) } catch {}

  // 3. Stage update
  const stageMap = {
    meeting:   settings?.STAGE_MEETING,
    thinking:  settings?.STAGE_THINKING,
    rejected:  settings?.STAGE_REJECTED || 'LOSE',
    no_answer: settings?.STAGE_NO_ANSWER || ''
  }
  const newStage = stageMap[resultId]
  if (newStage) {
    try { await window.electronAPI?.bitrix?.updateEntity(leadId, { STAGE_ID: newStage }, entityType) } catch {}
  }

  // 4. Create follow-up task
  const userId = settings?.BITRIX_USER_ID || '1'
  const crmLink = entityType === 'deal' ? `D_${leadId}` : `L_${leadId}`
  let taskTitle = '', taskDeadline = ''

  if (resultId === 'meeting') {
    taskTitle = `Подготовка к встрече: ${name}`
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
    taskDeadline = d.toISOString()
  } else if (resultId === 'thinking') {
    taskTitle = `Следить за клиентом: ${name}`
    const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(10, 0, 0, 0)
    taskDeadline = d.toISOString()
  } else if (resultId === 'rejected') {
    taskTitle = `Финальный отказ — уточнить причину: ${name}`
    const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0)
    taskDeadline = d.toISOString()
  } else {
    // no_answer / busy
    taskTitle = `Перезвонить: ${name} (попытка #${attemptNum + 1})`
    taskDeadline = nextCallAt || (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString() })()
  }

  try {
    await window.electronAPI?.bitrix?.createTask({
      TITLE: taskTitle,
      RESPONSIBLE_ID: userId,
      DEADLINE: taskDeadline,
      DESCRIPTION: commentText,
      UF_CRM_TASK: [crmLink]
    })
  } catch {}
}

// ─── Component ─────────────────────────────────────────────────
export default function PowerDialer() {
  const [leads, setLeads]           = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isRunning, setIsRunning]   = useState(false)
  const [loading, setLoading]       = useState(false)
  const [sessionDone, setSessionDone] = useState(false)
  const [settings, setSettings]     = useState({})
  const batchSize = 5

  const currentItem = leads[currentIndex] || null
  const timer = useTimer(currentItem?.status === STATUS.ACTIVE)

  const { sipSt, sipLabel, call: sipCall, hangup: sipHangup } = useSip({
    onCallActive: () => {
      setLeads(prev => prev.map((it, i) =>
        i === currentIndex && it.status === STATUS.DIALING ? { ...it, status: STATUS.ACTIVE } : it
      ))
    },
    onCallEnded:  () => {
      const item = leads[currentIndex]
      if (item?.status === STATUS.DIALING) quickNoAnswer('no_answer')
    },
    onCallFailed: () => {
      const item = leads[currentIndex]
      if (item?.status === STATUS.DIALING) quickNoAnswer('no_answer')
    }
  })

  // Load settings once
  useEffect(() => {
    window.electronAPI?.db?.getSettings().then(s => setSettings(s || {})).catch(() => {})
  }, [])

  // When current lead becomes DIALING — immediately fire tel: call
  useEffect(() => {
    if (!isRunning) return
    const item = leads[currentIndex]
    if (item?.status !== STATUS.DIALING) return
    const phone = getPhone(item.lead)
    if (phone) {
      window.electronAPI?.dialer?.call(phone).catch(() => {})
    }
  }, [currentIndex, isRunning, leads])

  async function loadBatch() {
    setLoading(true)
    setSessionDone(false)
    setIsRunning(false)
    setCurrentIndex(0)
    try {
      const batch = await window.electronAPI?.queue?.getBatch(batchSize) || []
      setLeads(batch.map(lead => ({
        lead: lead.data
          ? { ...lead.data, phone: lead.phone, name: lead.name, id: lead.id, entityType: lead.entityType }
          : lead,
        status: STATUS.PENDING, result: null, durationSec: 0
      })))
    } catch {}
    setLoading(false)
  }

  function startSession() {
    if (!leads.length) return
    setCurrentIndex(0)
    setLeads(prev => prev.map((it, i) =>
      i === 0 ? { ...it, status: STATUS.DIALING } : { ...it, status: STATUS.PENDING }
    ))
    setIsRunning(true)
  }

  // Manager says call connected → start timer
  function callConnected() {
    setLeads(prev => prev.map((it, i) =>
      i === currentIndex ? { ...it, status: STATUS.ACTIVE } : it
    ))
  }

  async function markResult(resultId) {
    sipHangup()
    const item = leads[currentIndex]
    if (!item) return
    const durationSec = timer.seconds
    const attempts = await window.electronAPI?.db?.getCallAttempts(String(item.lead?.ID || item.lead?.id)) || []
    const attemptNum = attempts.length + 1

    setLeads(prev => prev.map((it, i) =>
      i === currentIndex ? { ...it, status: STATUS.DONE, result: resultId, durationSec } : it
    ))

    // Fire-and-forget save
    saveResult({ lead: item.lead, resultId, durationSec, attemptNum, settings }).catch(() => {})

    advanceToNext()
  }

  // No-answer shortcut from DIALING screen
  async function quickNoAnswer(resultId) {
    const item = leads[currentIndex]
    if (!item) return
    const attempts = await window.electronAPI?.db?.getCallAttempts(String(item.lead?.ID || item.lead?.id)) || []
    const attemptNum = attempts.length + 1

    setLeads(prev => prev.map((it, i) =>
      i === currentIndex ? { ...it, status: STATUS.DONE, result: resultId, durationSec: 0 } : it
    ))
    saveResult({ lead: item.lead, resultId, durationSec: 0, attemptNum, settings }).catch(() => {})
    advanceToNext()
  }

  function skipCurrent() {
    setLeads(prev => prev.map((it, i) =>
      i === currentIndex ? { ...it, status: STATUS.SKIPPED, result: 'skipped' } : it
    ))
    advanceToNext()
  }

  function advanceToNext() {
    const next = currentIndex + 1
    if (next >= leads.length) { setIsRunning(false); setSessionDone(true); return }
    setCurrentIndex(next)
    setLeads(prev => prev.map((it, i) =>
      i === next ? { ...it, status: STATUS.DIALING } : it
    ))
  }

  const doneCount   = leads.filter(l => l.status === STATUS.DONE || l.status === STATUS.SKIPPED).length
  const connected   = leads.filter(l => ['meeting', 'thinking'].includes(l.result)).length
  const isDialing   = currentItem?.status === STATUS.DIALING
  const isActive    = currentItem?.status === STATUS.ACTIVE

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Lead list sidebar ── */}
      <div className="w-64 border-r border-slate-700/50 flex flex-col bg-slate-900/50 flex-shrink-0">
        <div className="px-4 py-4 border-b border-slate-700/50">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-yellow-400" />
            <span className="text-sm font-semibold text-slate-200">Пакетный дозвон</span>
          </div>
          <button
            onClick={loadBatch}
            disabled={loading || isRunning}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-all disabled:opacity-40"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Загрузка...' : `Загрузить ${batchSize} контактов`}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {leads.length === 0 && (
            <p className="text-center text-slate-600 text-xs py-8">Нажмите «Загрузить контакты»</p>
          )}
          {leads.map((item, i) => {
            const isCur = i === currentIndex && isRunning
            return (
              <div key={i} className={`rounded-lg px-3 py-2.5 transition-all ${
                isCur ? 'bg-blue-600/20 border border-blue-500/40'
                  : item.status === STATUS.DONE    ? 'bg-slate-800/30 opacity-60'
                  : item.status === STATUS.SKIPPED ? 'bg-slate-800/20 opacity-35'
                  : 'bg-slate-800/50'
              }`}>
                <div className="flex items-center justify-between gap-1">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{getName(item.lead)}</p>
                    <p className="text-xs text-slate-500 font-mono">{formatPhone(getPhone(item.lead))}</p>
                  </div>
                  <div className="flex-shrink-0">
                    {item.status === STATUS.PENDING && <span className="text-xs text-slate-600">#{i+1}</span>}
                    {isCur && isDialing && <span className="flex items-center gap-1 text-xs text-yellow-400"><span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse"/>Набор</span>}
                    {isCur && isActive  && <span className="flex items-center gap-1 text-xs text-emerald-400"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"/>Разговор</span>}
                    {(item.status === STATUS.DONE || item.status === STATUS.SKIPPED) && item.result && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${BADGE[item.result] || ''}`}>{RESULT_LABEL[item.result]}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {leads.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-700/50 flex gap-4 text-xs text-slate-500">
            <span>{doneCount}/{leads.length} готово</span>
            <span className="text-emerald-400">{connected} дозвон</span>
          </div>
        )}
      </div>

      {/* ── Active panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">

        {/* Empty state */}
        {!isRunning && !sessionDone && leads.length === 0 && (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-yellow-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Zap size={28} className="text-yellow-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-100 mb-2">Пакетный дозвон</h2>
            <p className="text-slate-500 text-sm mb-6">Загружает {batchSize} контактов из очереди и автоматически набирает каждый номер. После каждого звонка — смена этапа и задача в Bitrix24.</p>
            <button onClick={loadBatch} disabled={loading} className="px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold rounded-xl transition-all active:scale-95">
              {loading ? 'Загрузка...' : 'Загрузить контакты'}
            </button>
          </div>
        )}

        {/* Loaded but not started */}
        {!isRunning && !sessionDone && leads.length > 0 && (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Phone size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-100 mb-1">Готово к обзвону</h2>
            <p className="text-slate-500 text-sm mb-6">{leads.length} контактов. Нажмите «Начать» — автонабор каждого, смена этапа + задача в Bitrix24.</p>
            <button onClick={startSession} className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-lg transition-all active:scale-95 flex items-center gap-2 mx-auto">
              <Phone size={18} /> Начать обзвон
            </button>
          </div>
        )}

        {/* Session done */}
        {sessionDone && (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-100 mb-4">Сессия завершена</h2>
            <div className="flex gap-8 justify-center mb-6">
              <div className="text-center"><p className="text-3xl font-bold text-slate-100">{doneCount}</p><p className="text-slate-500 text-sm">обработано</p></div>
              <div className="text-center"><p className="text-3xl font-bold text-emerald-400">{connected}</p><p className="text-slate-500 text-sm">дозвон</p></div>
              <div className="text-center"><p className="text-3xl font-bold text-slate-400">{doneCount - connected}</p><p className="text-slate-500 text-sm">недозвон</p></div>
            </div>
            <button onClick={loadBatch} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all active:scale-95">Новый пакет</button>
          </div>
        )}

        {/* Active session */}
        {isRunning && currentItem && (
          <div className="w-full max-w-md flex flex-col gap-5">

            {/* Contact info */}
            <div className="text-center">
              <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">Контакт {currentIndex + 1} из {leads.length}</p>
              <h2 className="text-2xl font-bold text-slate-100">{getName(currentItem.lead)}</h2>
              <p className="text-2xl font-mono text-blue-300 mt-2 tracking-wider">{formatPhone(getPhone(currentItem.lead))}</p>
            </div>

            {/* DIALING — call fired, waiting for answer */}
            {isDialing && (
              <>
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 text-center">
                  <div className="flex items-center justify-center gap-2 text-yellow-400 mb-2">
                    <PhoneCall size={18} className="animate-pulse" />
                    <span className="text-sm font-medium">Идёт набор номера...</span>
                  </div>
                  <p className="text-xs text-slate-500">SIP-клиент набирает номер. Когда клиент ответил — нажмите «Ответил»</p>
                </div>

                <div className="flex flex-col gap-2">
                  <button onClick={callConnected}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2">
                    <Phone size={20}/> Ответил
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => quickNoAnswer('no_answer')}
                      className="py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5">
                      <PhoneOff size={14}/> Не берёт
                    </button>
                    <button onClick={() => quickNoAnswer('busy')}
                      className="py-3 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 text-sm font-semibold rounded-xl transition-all">
                      Занято
                    </button>
                  </div>
                  <button onClick={skipCurrent} className="text-xs text-slate-600 hover:text-slate-400 text-center py-1 transition-colors">
                    Пропустить →
                  </button>
                </div>
              </>
            )}

            {/* ACTIVE — timer + result */}
            {isActive && (
              <>
                <div className="bg-emerald-600/10 border border-emerald-500/20 rounded-2xl p-5 text-center">
                  <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm mb-1">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"/>
                    Разговор
                  </div>
                  <p className="text-4xl font-mono font-bold text-slate-100">{timer.display}</p>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-xs text-slate-500 text-center uppercase tracking-wide">Результат</p>
                  <div className="grid grid-cols-2 gap-2">
                    {RESULTS.map(({ id, label, color }) => (
                      <button key={id} onClick={() => markResult(id)}
                        className={`py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 ${COLOR_BTN[color]}`}>
                        {label}
                      </button>
                    ))}
                    <button onClick={skipCurrent}
                      className="py-3 rounded-xl text-sm text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-all flex items-center justify-center gap-1">
                      <ChevronRight size={14}/> Пропустить
                    </button>
                  </div>
                </div>
              </>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
