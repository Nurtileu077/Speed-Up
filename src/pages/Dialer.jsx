import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Phone, PhoneOff, PhoneCall, RefreshCw, ExternalLink,
  AlertTriangle, MessageCircle, CheckCircle, Clock, ChevronRight, Copy
} from 'lucide-react'
import ScriptPanel from '../components/ScriptPanel'
import useSip from '../hooks/useSip'

const SCREEN = {
  WAITING: 'waiting',
  LOADING: 'loading',
  DIALING: 'dialing',
  ACTIVE: 'active',
  NO_ANSWER: 'no_answer',
  CONNECTED: 'connected'
}

const NO_ANSWER_REASONS = [
  { id: 'no_answer', label: 'Не берёт трубку' },
  { id: 'busy', label: 'Занято' },
  { id: 'unavailable', label: 'Недоступен' },
  { id: 'rejected_call', label: 'Сбросил вызов' }
]

const CONNECTED_RESULTS = [
  { id: 'meeting', label: '🤝 Встреча назначена', color: 'emerald' },
  { id: 'thinking', label: '💭 Думает, перезвонит', color: 'blue' },
  { id: 'rejected', label: '❌ Отказал', color: 'red' }
]

function useTimer(running) {
  const [seconds, setSeconds] = useState(0)
  const ref = useRef(null)
  useEffect(() => {
    if (running) {
      setSeconds(0)
      ref.current = setInterval(() => setSeconds(s => s + 1), 1000)
    } else {
      clearInterval(ref.current)
    }
    return () => clearInterval(ref.current)
  }, [running])
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return { seconds, display: `${mm}:${ss}` }
}

function getPhone(lead) {
  if (!lead) return ''
  const p = lead.phone || lead.PHONE
  if (!p) return ''
  if (Array.isArray(p)) return p[0]?.VALUE || ''
  return p
}

function getName(lead) {
  if (!lead) return ''
  const parts = [lead.NAME, lead.LAST_NAME].filter(Boolean)
  if (parts.length) return parts.join(' ')
  return lead.name || lead.TITLE || `#${lead.ID || lead.id || ''}`
}

function formatPhone(phone) {
  if (!phone) return 'Нет номера'
  const c = String(phone).replace(/\D/g, '')
  if (c.length === 11) return `+${c[0]} ${c.slice(1,4)} ${c.slice(4,7)} ${c.slice(7,9)} ${c.slice(9)}`
  if (c.length === 10) return `+7 ${c.slice(0,3)} ${c.slice(3,6)} ${c.slice(6,8)} ${c.slice(8)}`
  return phone
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m} мин ${s} сек` : `${s} сек`
}

function formatNoAnswerComment(reason, attemptNum, nextCallAt, managerName) {
  const labels = { no_answer: 'Не берёт трубку', busy: 'Занято', unavailable: 'Недоступен', rejected_call: 'Сбросил вызов' }
  let text = `📞 Автодозвон #${attemptNum} — Недозвон\nВремя: ${new Date().toLocaleString('ru')}\nРезультат: ${labels[reason] || reason}`
  if (nextCallAt) text += `\nСледующая попытка: ${new Date(nextCallAt).toLocaleString('ru')}`
  return text
}

function formatConnectedComment(result, durationSec) {
  const labels = { meeting: 'Встреча назначена', thinking: 'Думает, перезвонит', rejected: 'Отказал' }
  return `✅ Дозвон\nВремя: ${new Date().toLocaleString('ru')}\nДлительность: ${formatDuration(durationSec)}\nРезультат: ${labels[result] || result}`
}

function getWaTemplate(attemptNum, name, result) {
  if (result === 'thinking') return `Здравствуйте, ${name}! Как ваше решение?\nГотов ответить на любые вопросы.`
  if (result === 'meeting') return `Здравствуйте, ${name}! Спасибо за разговор!\nОжидаем вас на встрече. Если будут вопросы — напишите.`
  if (attemptNum === 3) return `Здравствуйте, ${name}! Мы пробовали вам позвонить.\nУдобно ли созвониться сейчас?`
  if (attemptNum >= 6) return `Здравствуйте, ${name}! Никак не можем дозвониться.\nУдобнее общаться в WhatsApp?`
  return ''
}

export default function Dialer() {
  const [screen, setScreen] = useState(SCREEN.WAITING)
  const [queueStats, setQueueStats] = useState({ total: 0, overdue: 0 })
  const [currentLead, setCurrentLead] = useState(null)
  const [attemptCount, setAttemptCount] = useState(0)
  const [activeCallId, setActiveCallId] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const { sipSt, sipLabel, call: sipCall, hangup: sipHangup, reconnect: sipReconnect } = useSip({
    onCallActive: () => { if (screen === SCREEN.DIALING) setScreen(SCREEN.ACTIVE) },
    onCallEnded:  () => { if (screen === SCREEN.DIALING) handleNoAnswer() },
    onCallFailed: () => { if (screen === SCREEN.DIALING) handleNoAnswer() }
  })

  // No answer state
  const [naReason, setNaReason] = useState('')
  const [naSaved, setNaSaved] = useState(false)
  const [waText, setWaText] = useState('')
  const [waSent, setWaSent] = useState(false)
  const [waSending, setWaSending] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDeadline, setTaskDeadline] = useState('')
  const [taskCreated, setTaskCreated] = useState(false)
  const [taskCreating, setTaskCreating] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [settings, setSettings] = useState({})

  // Connected state
  const [connResult, setConnResult] = useState('')
  const [connWaText, setConnWaText] = useState('')
  const [connWaSent, setConnWaSent] = useState(false)
  const [connWaSending, setConnWaSending] = useState(false)
  const [connSaved, setConnSaved] = useState(false)

  const timer = useTimer(screen === SCREEN.ACTIVE)

  // Load settings
  useEffect(() => {
    window.electronAPI?.db?.getSettings().then(s => setSettings(s || {})).catch(() => {})
  }, [])

  // Auto-dial immediately when DIALING screen appears
  useEffect(() => {
    if (screen !== SCREEN.DIALING || !currentLead) return
    const phone = getPhone(currentLead)
    if (!phone) return
    window.electronAPI?.dialer?.call(phone).catch(() => {})
  }, [screen, currentLead])

  // Countdown auto-advance (no-answer)
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) { handleAutoAdvance(); return }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const loadQueueStats = useCallback(async () => {
    try {
      const stats = await window.electronAPI?.queue?.getStats()
      setQueueStats(stats || { total: 0, overdue: 0 })
    } catch {}
  }, [])

  useEffect(() => {
    loadQueueStats()
    const iv = setInterval(loadQueueStats, 30000)
    return () => clearInterval(iv)
  }, [loadQueueStats])

  function resetState() {
    setCurrentLead(null)
    setAttemptCount(0)
    setActiveCallId(null)
    setNaReason('')
    setNaSaved(false)
    setWaText('')
    setWaSent(false)
    setWaSending(false)
    setTaskTitle('')
    setTaskDeadline('')
    setTaskCreated(false)
    setTaskCreating(false)
    setCountdown(null)
    setConnResult('')
    setConnWaText('')
    setConnWaSent(false)
    setConnWaSending(false)
    setConnSaved(false)
    setError('')
  }

  async function handleReady() {
    setScreen(SCREEN.LOADING)
    setError('')
    try {
      const lead = await window.electronAPI?.queue?.getNext()
      if (!lead) {
        setError('Очередь пуста. Новых сделок и задач нет.')
        setScreen(SCREEN.WAITING)
        return
      }
      const attempts = await window.electronAPI?.db?.getCallAttempts(lead.id) || []
      setAttemptCount(attempts.length)
      setCurrentLead(lead.data ? { ...lead.data, phone: lead.phone, name: lead.name, id: lead.id, entityType: lead.entityType } : lead)
      setScreen(SCREEN.DIALING)
    } catch (err) {
      setError(err.message || 'Ошибка загрузки')
      setScreen(SCREEN.WAITING)
    }
  }

  function handleStartCall() {
    setScreen(SCREEN.ACTIVE)
  }

  async function handleNoAnswer() {
    sipHangup()
    if (activeCallId) {
      try { await window.electronAPI?.bitrix?.finishCall(activeCallId, 'no_answer', timer.seconds) } catch {}
    }
    const name = getName(currentLead)
    const attempt = attemptCount + 1
    setWaText(getWaTemplate(attempt, name, null))
    setTaskTitle(`Перезвонить — ${name} (попытка #${attempt + 1})`)
    const nextDay = new Date(); nextDay.setDate(nextDay.getDate() + 1); nextDay.setHours(9, 0, 0, 0)
    setTaskDeadline(nextDay.toISOString().slice(0, 16))
    setScreen(SCREEN.NO_ANSWER)
  }

  async function handleConnected() {
    sipHangup()
    if (activeCallId) {
      try { await window.electronAPI?.bitrix?.finishCall(activeCallId, 'connected', timer.seconds) } catch {}
    }
    setScreen(SCREEN.CONNECTED)
  }

  async function handleSaveNoAnswer(reason) {
    if (naSaved) return
    const leadId = currentLead?.ID || currentLead?.id
    const phone = getPhone(currentLead)
    const attempt = attemptCount + 1
    setNaReason(reason)

    let nextCallAt = null
    try { nextCallAt = await window.electronAPI?.scheduler?.calcNextAttempt(attempt) } catch {}

    try {
      await window.electronAPI?.db?.saveCallAttempt({
        lead_id: String(leadId),
        manager_id: 'current',
        attempt_num: attempt,
        called_at: new Date().toISOString(),
        duration_sec: timer.seconds,
        result: reason,
        next_call_at: nextCallAt,
        lead_name: getName(currentLead),
        lead_phone: phone,
        bitrix_call_id: activeCallId
      })
    } catch {}

    const entityType = currentLead?.entityType || 'deal'
    const name = getName(currentLead)
    const comment = formatNoAnswerComment(reason, attempt, nextCallAt)
    try { await window.electronAPI?.bitrix?.addComment(String(leadId), comment) } catch {}

    // Stage update
    const noAnswerStage = settings?.STAGE_NO_ANSWER || ''
    if (noAnswerStage) {
      try { await window.electronAPI?.bitrix?.updateEntity(String(leadId), { STAGE_ID: noAnswerStage }, entityType) } catch {}
    }

    // Task — always create
    const crmLink = entityType === 'deal' ? `D_${leadId}` : `L_${leadId}`
    const deadline = nextCallAt || (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9,0,0,0); return d.toISOString() })()
    try {
      await window.electronAPI?.bitrix?.createTask({
        TITLE: `Перезвонить: ${name} (попытка #${attempt + 1})`,
        RESPONSIBLE_ID: settings?.BITRIX_USER_ID || '1',
        DEADLINE: deadline,
        UF_CRM_TASK: [crmLink],
        DESCRIPTION: comment
      })
    } catch {}

    setNaSaved(true)
    setCountdown(5)
  }

  async function handleSendWa() {
    const phone = getPhone(currentLead)
    if (!phone || !waText.trim()) return
    setWaSending(true)
    try {
      await window.electronAPI?.wazzup?.sendMessage(phone, waText)
      setWaSent(true)
    } catch (err) {
      console.warn('WA send error:', err.message)
    } finally {
      setWaSending(false)
    }
  }

  async function handleCreateTask() {
    const leadId = currentLead?.ID || currentLead?.id
    const entityType = currentLead?.entityType || 'deal'
    if (!taskTitle) return
    setTaskCreating(true)
    try {
      await window.electronAPI?.bitrix?.createTask({
        TITLE: taskTitle,
        DEADLINE: taskDeadline ? new Date(taskDeadline).toISOString() : null,
        UF_CRM_TASK: [entityType === 'deal' ? `D_${leadId}` : `L_${leadId}`]
      })
      setTaskCreated(true)
    } catch (err) {
      console.warn('createTask error:', err.message)
    } finally {
      setTaskCreating(false)
    }
  }

  async function handleAutoAdvance() {
    resetState()
    await handleReady()
  }

  function handleSelectConnResult(result) {
    setConnResult(result)
    const name = getName(currentLead)
    setConnWaText(getWaTemplate(attemptCount + 1, name, result))
  }

  async function handleSaveConnected() {
    if (connSaved) return
    const leadId = currentLead?.ID || currentLead?.id
    const phone = getPhone(currentLead)
    const entityType = currentLead?.entityType || 'deal'
    const attempt = attemptCount + 1

    try {
      await window.electronAPI?.db?.saveCallAttempt({
        lead_id: String(leadId),
        manager_id: 'current',
        attempt_num: attempt,
        called_at: new Date().toISOString(),
        duration_sec: timer.seconds,
        result: connResult || 'connected',
        lead_name: getName(currentLead),
        lead_phone: phone,
        bitrix_call_id: activeCallId
      })
    } catch {}

    const name = getName(currentLead)
    const comment = formatConnectedComment(connResult, timer.seconds)
    try { await window.electronAPI?.bitrix?.addComment(String(leadId), comment) } catch {}

    // Stage update from settings
    const stageMap = {
      meeting:  settings?.STAGE_MEETING  || '',
      thinking: settings?.STAGE_THINKING || '',
      rejected: settings?.STAGE_REJECTED || 'LOSE'
    }
    const newStage = connResult && stageMap[connResult]
    if (newStage) {
      try { await window.electronAPI?.bitrix?.updateEntity(String(leadId), { STAGE_ID: newStage }, entityType) } catch {}
    }

    // Task based on result
    const crmLink = entityType === 'deal' ? `D_${leadId}` : `L_${leadId}`
    const taskDefs = {
      meeting:  { title: `Подготовка к встрече: ${name}`,   days: 1,  hour: 9 },
      thinking: { title: `Следить за клиентом: ${name}`,    days: 2,  hour: 10 },
      rejected: { title: `Финальный отказ — причина: ${name}`, days: 7, hour: 10 }
    }
    const td = connResult && taskDefs[connResult]
    if (td) {
      const d = new Date(); d.setDate(d.getDate() + td.days); d.setHours(td.hour, 0, 0, 0)
      try {
        await window.electronAPI?.bitrix?.createTask({
          TITLE: td.title,
          RESPONSIBLE_ID: settings?.BITRIX_USER_ID || '1',
          DEADLINE: d.toISOString(),
          UF_CRM_TASK: [crmLink],
          DESCRIPTION: comment
        })
      } catch {}
    }

    if (activeCallId && timer.seconds >= 30) {
      window.electronAPI?.ai?.runAnalysis({ callId: activeCallId, leadId: String(leadId), durationSec: timer.seconds })
        .catch(() => {})
    }

    setConnSaved(true)
  }

  async function handleConnSendWa() {
    const phone = getPhone(currentLead)
    if (!phone || !connWaText.trim()) return
    setConnWaSending(true)
    try {
      await window.electronAPI?.wazzup?.sendMessage(phone, connWaText)
      setConnWaSent(true)
    } catch {} finally {
      setConnWaSending(false)
    }
  }

  async function openInBitrix() {
    const entityId = currentLead?.ID || currentLead?.id
    if (!entityId) return
    try {
      const portal = await window.electronAPI?.bitrix?.getPortalUrl() || ''
      const settings = await window.electronAPI?.db?.getSettings() || {}
      const type = settings.CRM_TYPE || 'deal'
      window.open?.(`${portal}/crm/${type}/details/${entityId}/`, '_blank')
    } catch {}
  }

  function copyPhone() {
    const phone = getPhone(currentLead)
    if (phone) navigator.clipboard?.writeText(phone).catch(() => {})
  }

  // ─── WAITING ──────────────────────────────────────────────────
  if (screen === SCREEN.WAITING || screen === SCREEN.LOADING) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-8 px-8">
        <div className="text-center">
          <div className="w-20 h-20 bg-blue-600/20 border border-blue-600/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Phone size={36} className="text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Nobilis Power Dialer</h1>
          <p className="text-slate-500">Готов к работе</p>
        </div>

        <div className="flex gap-4">
          <div className="text-center px-6 py-4 bg-slate-800 border border-slate-700 rounded-xl">
            <p className="text-3xl font-bold text-slate-100">{queueStats.total}</p>
            <p className="text-xs text-slate-500 mt-1">В очереди</p>
          </div>
          {queueStats.overdue > 0 && (
            <div className="text-center px-6 py-4 bg-amber-600/10 border border-amber-600/30 rounded-xl">
              <div className="flex items-center gap-1.5 justify-center">
                <AlertTriangle size={16} className="text-amber-400" />
                <p className="text-3xl font-bold text-amber-400">{queueStats.overdue}</p>
              </div>
              <p className="text-xs text-amber-600 mt-1">Просрочено</p>
            </div>
          )}
        </div>

        {error && (
          <div className="max-w-sm w-full bg-red-600/10 border border-red-600/20 rounded-xl px-4 py-3 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* SIP status */}
        <div className={`flex items-center justify-between w-full max-w-xs px-4 py-2.5 rounded-xl border ${
          sipSt === 'registered' ? 'bg-emerald-600/10 border-emerald-600/20' :
          sipSt === 'unconfigured' ? 'bg-slate-800 border-slate-700' :
          ['connecting','connected'].includes(sipSt) ? 'bg-yellow-600/10 border-yellow-600/20' :
          'bg-red-600/10 border-red-600/20'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              sipSt === 'registered' ? 'bg-emerald-400 animate-pulse' :
              ['connecting','connected'].includes(sipSt) ? 'bg-yellow-400 animate-pulse' :
              sipSt === 'unconfigured' ? 'bg-slate-500' : 'bg-red-400'
            }`}/>
            <span className={`text-xs font-medium ${sipLabel.color}`}>{sipLabel.text}</span>
          </div>
          {sipSt !== 'registered' && (
            <button onClick={sipReconnect} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Переподключить
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={handleReady}
            disabled={screen === SCREEN.LOADING}
            className="w-full text-lg py-4 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-semibold transition-all active:scale-95"
          >
            {screen === SCREEN.LOADING
              ? <><RefreshCw size={18} className="animate-spin" /> Загрузка...</>
              : <><Phone size={18} /> Я ГОТОВ</>}
          </button>
          <button
            onClick={async () => { setRefreshing(true); await window.electronAPI?.queue?.refresh(); await loadQueueStats(); setRefreshing(false) }}
            disabled={refreshing}
            className="w-full text-sm py-2.5 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 rounded-xl transition-all"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Обновить очередь
          </button>
        </div>
      </div>
    )
  }

  // ─── DIALING ──────────────────────────────────────────────────
  if (screen === SCREEN.DIALING) {
    const phone = getPhone(currentLead)
    const name = getName(currentLead)
    const attempt = attemptCount + 1

    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          Звонок #{attempt} из 6
        </div>

        <div className="text-center">
          <p className="text-2xl font-bold text-slate-100">{name}</p>
          <p className="text-sm text-slate-500 mt-1">{currentLead?.SOURCE_ID || currentLead?.STAGE_ID || ''}</p>
        </div>

        <button
          onClick={copyPhone}
          className="bg-slate-800 border-2 border-blue-500/40 hover:border-blue-500/70 rounded-2xl px-8 py-5 transition-colors text-center group w-full max-w-xs"
        >
          <p className="text-3xl font-mono font-bold text-blue-300 tracking-wider">{formatPhone(phone)}</p>
          <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-slate-600 group-hover:text-slate-400 transition-colors">
            <Copy size={11} /> скопировать
          </div>
        </button>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-5 py-4 text-center max-w-xs w-full">
          <div className="flex items-center justify-center gap-2 mb-1">
            <PhoneCall size={16} className={`animate-pulse ${sipLabel.color}`} />
            <span className={`text-sm font-medium ${sipLabel.color}`}>{sipLabel.text}</span>
          </div>
          {sipSt === 'unconfigured'
            ? <p className="text-xs text-slate-500">Настройте SIP в разделе Настройки → звонок пойдёт прямо через приложение</p>
            : <p className="text-xs text-slate-500">Когда клиент ответил — нажмите «Ответил»</p>
          }
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={handleStartCall}
            className="w-full text-lg py-4 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all active:scale-95"
          >
            <Phone size={20} /> Ответил
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleNoAnswer}
              className="py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5">
              <PhoneOff size={14}/> Не берёт
            </button>
            <button onClick={handleNoAnswer}
              className="py-3 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/30 text-orange-300 text-sm font-semibold rounded-xl transition-all">
              Занято
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={openInBitrix} className="flex-1 text-sm py-2.5 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 rounded-xl transition-all">
              <ExternalLink size={13} /> Bitrix24
            </button>
            <button onClick={() => { resetState(); setScreen(SCREEN.WAITING) }} className="flex-1 text-sm py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-500 rounded-xl transition-all">
              Пропустить
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── ACTIVE ───────────────────────────────────────────────────
  if (screen === SCREEN.ACTIVE) {
    const phone = getPhone(currentLead)
    const name = getName(currentLead)

    return (
      <div className="h-full flex flex-col gap-4 p-5 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-2xl font-mono font-bold text-emerald-400">{timer.display}</span>
          </div>
          <button onClick={openInBitrix} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            <ExternalLink size={12} /> Bitrix24
          </button>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="font-bold text-slate-100 text-lg">{name}</p>
          <p className="text-blue-400 font-mono text-sm mt-1">{formatPhone(phone)}</p>
          <p className="text-xs text-slate-500 mt-1">Попытка #{attemptCount + 1} из 6</p>
        </div>

        <ScriptPanel lead={currentLead} attemptNum={attemptCount + 1} />

        <div className="flex gap-3 mt-auto pt-2">
          <button
            onClick={handleNoAnswer}
            className="flex-1 py-4 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-lg transition-all active:scale-95"
          >
            <PhoneOff size={20} /> НЕДОЗВОН
          </button>
          <button
            onClick={handleConnected}
            className="flex-1 py-4 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-lg transition-all active:scale-95"
          >
            <PhoneCall size={20} /> ДОЗВОН
          </button>
        </div>
      </div>
    )
  }

  // ─── NO_ANSWER ────────────────────────────────────────────────
  if (screen === SCREEN.NO_ANSWER) {
    const phone = getPhone(currentLead)
    const name = getName(currentLead)
    const attempt = attemptCount + 1
    const showWaTemplate = attempt === 3 || attempt >= 6

    return (
      <div className="h-full flex flex-col gap-4 p-5 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-600/20 border border-red-600/30 rounded-xl flex items-center justify-center">
            <PhoneOff size={18} className="text-red-400" />
          </div>
          <div>
            <p className="font-bold text-slate-100">{name}</p>
            <p className="text-xs text-slate-500">Недозвон #{attempt} из 6</p>
          </div>
        </div>

        {/* Reason */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Причина</p>
          <div className="grid grid-cols-2 gap-2">
            {NO_ANSWER_REASONS.map(r => (
              <button
                key={r.id}
                onClick={() => !naSaved && handleSaveNoAnswer(r.id)}
                className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-all ${
                  naReason === r.id
                    ? 'bg-red-600/20 border-red-500 text-red-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* WhatsApp */}
        {naReason && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={15} className="text-green-400" />
              <p className="text-sm font-semibold text-slate-300">WhatsApp сообщение</p>
              {waSent && <CheckCircle size={14} className="text-emerald-400 ml-auto" />}
            </div>
            <textarea
              value={waText}
              onChange={e => setWaText(e.target.value)}
              placeholder={showWaTemplate ? '' : 'Напишите сообщение вручную (необязательно)'}
              rows={3}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 resize-none focus:outline-none focus:border-blue-500"
            />
            {!waSent ? (
              <button
                onClick={handleSendWa}
                disabled={waSending || !waText.trim() || !phone}
                className="mt-2 w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm rounded-lg font-semibold transition-all"
              >
                {waSending ? 'Отправка...' : 'Отправить в WhatsApp'}
              </button>
            ) : (
              <p className="mt-2 text-xs text-emerald-400 text-center">✓ Сообщение отправлено</p>
            )}
          </div>
        )}

        {/* Task */}
        {naReason && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={15} className="text-blue-400" />
              <p className="text-sm font-semibold text-slate-300">Задача в Bitrix24</p>
              {taskCreated && <CheckCircle size={14} className="text-emerald-400 ml-auto" />}
            </div>
            <input
              value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)}
              placeholder="Название задачи"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 mb-2"
            />
            <input
              type="datetime-local"
              value={taskDeadline}
              onChange={e => setTaskDeadline(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            />
            {!taskCreated ? (
              <button
                onClick={handleCreateTask}
                disabled={taskCreating || !taskTitle}
                className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded-lg font-semibold transition-all"
              >
                {taskCreating ? 'Создание...' : 'Создать задачу'}
              </button>
            ) : (
              <p className="mt-2 text-xs text-emerald-400 text-center">✓ Задача создана</p>
            )}
          </div>
        )}

        {/* Auto advance */}
        {naReason && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between mt-auto">
            <div>
              <p className="text-sm text-slate-400">
                {countdown !== null && countdown > 0
                  ? `Следующий лид через ${countdown}...`
                  : 'Переход к следующему лиду'}
              </p>
            </div>
            <button
              onClick={handleAutoAdvance}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-semibold transition-all"
            >
              Следующий <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ─── CONNECTED ────────────────────────────────────────────────
  if (screen === SCREEN.CONNECTED) {
    const phone = getPhone(currentLead)
    const name = getName(currentLead)

    return (
      <div className="h-full flex flex-col gap-4 p-5 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600/20 border border-emerald-600/30 rounded-xl flex items-center justify-center">
            <PhoneCall size={18} className="text-emerald-400" />
          </div>
          <div>
            <p className="font-bold text-slate-100">{name}</p>
            <p className="text-xs text-emerald-500">Дозвон · {formatDuration(timer.seconds)}</p>
          </div>
        </div>

        {/* Result */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Результат разговора</p>
          <div className="flex flex-col gap-2">
            {CONNECTED_RESULTS.map(r => (
              <button
                key={r.id}
                onClick={() => !connSaved && handleSelectConnResult(r.id)}
                className={`py-3 px-4 rounded-xl text-sm font-semibold border text-left transition-all ${
                  connResult === r.id
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* WhatsApp */}
        {connResult && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle size={15} className="text-green-400" />
              <p className="text-sm font-semibold text-slate-300">WhatsApp</p>
              {connWaSent && <CheckCircle size={14} className="text-emerald-400 ml-auto" />}
            </div>
            <textarea
              value={connWaText}
              onChange={e => setConnWaText(e.target.value)}
              placeholder="Сообщение клиенту (необязательно)"
              rows={3}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 resize-none focus:outline-none focus:border-blue-500"
            />
            {!connWaSent && connWaText.trim() && (
              <button
                onClick={handleConnSendWa}
                disabled={connWaSending || !phone}
                className="mt-2 w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm rounded-lg font-semibold transition-all"
              >
                {connWaSending ? 'Отправка...' : 'Отправить в WhatsApp'}
              </button>
            )}
            {connWaSent && <p className="mt-2 text-xs text-emerald-400 text-center">✓ Отправлено</p>}
          </div>
        )}

        {/* Finish */}
        {connResult && (
          <button
            onClick={async () => { await handleSaveConnected(); resetState(); setScreen(SCREEN.WAITING); loadQueueStats() }}
            className="w-full py-3.5 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all active:scale-95 mt-auto"
          >
            Завершить и следующий лид <ChevronRight size={18} />
          </button>
        )}
      </div>
    )
  }

  return null
}
