import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Phone, PhoneOff, CheckCircle, XCircle, ChevronRight, RefreshCw, Zap } from 'lucide-react'

const STATUS = {
  PENDING: 'pending',
  DIALING: 'dialing',
  ACTIVE: 'active',
  DONE: 'done',
  SKIPPED: 'skipped'
}

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

const QUICK_RESULTS = [
  { id: 'no_answer', label: 'Не берёт', color: 'slate', icon: PhoneOff },
  { id: 'busy', label: 'Занято', color: 'orange', icon: PhoneOff },
  { id: 'meeting', label: 'Встреча', color: 'emerald', icon: CheckCircle },
  { id: 'thinking', label: 'Думает', color: 'blue', icon: CheckCircle },
  { id: 'rejected', label: 'Отказ', color: 'red', icon: XCircle }
]

const RESULT_LABEL = {
  no_answer: 'Не берёт', busy: 'Занято', unavailable: 'Недоступен',
  meeting: 'Встреча', thinking: 'Думает', rejected: 'Отказ', skipped: 'Пропущен'
}

const COLOR_MAP = {
  slate: 'bg-slate-700 hover:bg-slate-600 text-slate-200',
  orange: 'bg-orange-600/30 hover:bg-orange-600/50 text-orange-300 border border-orange-500/30',
  emerald: 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30',
  blue: 'bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/30',
  red: 'bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/30'
}

const RESULT_BADGE = {
  no_answer: 'bg-slate-700 text-slate-400',
  busy: 'bg-orange-600/20 text-orange-400',
  meeting: 'bg-emerald-600/20 text-emerald-400',
  thinking: 'bg-blue-600/20 text-blue-400',
  rejected: 'bg-red-600/20 text-red-400',
  skipped: 'bg-slate-700 text-slate-500'
}

export default function PowerDialer() {
  const [leads, setLeads] = useState([]) // [{lead, status, result, durationSec}]
  const [currentIndex, setCurrentIndex] = useState(0)
  const [dialCountdown, setDialCountdown] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [batchSize] = useState(5)
  const [sessionDone, setSessionDone] = useState(false)

  const currentItem = leads[currentIndex] || null
  const isActive = currentItem?.status === STATUS.ACTIVE
  const isDialing = currentItem?.status === STATUS.DIALING

  const timer = useTimer(isActive)

  // Auto-dial countdown when status = DIALING
  useEffect(() => {
    if (!isRunning || !currentItem || currentItem.status !== STATUS.DIALING) {
      setDialCountdown(null)
      return
    }
    setDialCountdown(3)
  }, [currentIndex, isRunning, leads])

  useEffect(() => {
    if (dialCountdown === null) return
    if (dialCountdown <= 0) {
      triggerCall()
      return
    }
    const t = setTimeout(() => setDialCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [dialCountdown])

  async function loadBatch() {
    setLoading(true)
    setSessionDone(false)
    setIsRunning(false)
    setCurrentIndex(0)
    try {
      const batch = await window.electronAPI?.queue?.getBatch(batchSize) || []
      if (batch.length === 0) {
        setLeads([])
        setLoading(false)
        return
      }
      setLeads(batch.map(lead => ({
        lead: lead.data
          ? { ...lead.data, phone: lead.phone, name: lead.name, id: lead.id, entityType: lead.entityType }
          : lead,
        status: STATUS.PENDING,
        result: null,
        durationSec: 0
      })))
    } catch (err) {
      console.error('PowerDialer batch error:', err)
    } finally {
      setLoading(false)
    }
  }

  function startSession() {
    if (leads.length === 0) return
    setCurrentIndex(0)
    setLeads(prev => prev.map((item, i) =>
      i === 0 ? { ...item, status: STATUS.DIALING } : { ...item, status: STATUS.PENDING }
    ))
    setIsRunning(true)
  }

  async function triggerCall() {
    const item = leads[currentIndex]
    if (!item) return
    const phone = getPhone(item.lead)
    if (phone) {
      try {
        await window.electronAPI?.dialer?.call(phone)
      } catch {}
    }
    setLeads(prev => prev.map((it, i) =>
      i === currentIndex ? { ...it, status: STATUS.ACTIVE } : it
    ))
    setDialCountdown(null)
  }

  async function markResult(resultId) {
    const item = leads[currentIndex]
    if (!item) return
    const durationSec = timer.seconds
    const lead = item.lead
    const leadId = lead?.ID || lead?.id
    const phone = getPhone(lead)
    const name = getName(lead)
    const isConnected = ['meeting', 'thinking'].includes(resultId)

    // Save to DB
    try {
      const attempts = await window.electronAPI?.db?.getCallAttempts(String(leadId)) || []
      const attemptNum = attempts.length + 1
      let nextCallAt = null
      if (!isConnected) {
        try { nextCallAt = await window.electronAPI?.scheduler?.calcNextAttempt(attemptNum) } catch {}
      }
      await window.electronAPI?.db?.saveCallAttempt({
        lead_id: String(leadId),
        manager_id: 'current',
        attempt_num: attemptNum,
        called_at: new Date().toISOString(),
        duration_sec: durationSec,
        result: resultId,
        next_call_at: nextCallAt,
        lead_name: name,
        lead_phone: phone,
        bitrix_call_id: null
      })
    } catch {}

    // Bitrix comment
    try {
      const labels = { no_answer: 'Не берёт', busy: 'Занято', meeting: 'Встреча', thinking: 'Думает', rejected: 'Отказ' }
      const text = isConnected
        ? `✅ Дозвон [Пакетный]\nДлительность: ${durationSec}с\nРезультат: ${labels[resultId]}`
        : `📞 Недозвон [Пакетный]\nРезультат: ${labels[resultId]}`
      await window.electronAPI?.bitrix?.addComment(String(leadId), text)
    } catch {}

    // Mark done and advance
    setLeads(prev => prev.map((it, i) =>
      i === currentIndex ? { ...it, status: STATUS.DONE, result: resultId, durationSec } : it
    ))

    advanceToNext()
  }

  function skipCurrent() {
    setLeads(prev => prev.map((it, i) =>
      i === currentIndex ? { ...it, status: STATUS.SKIPPED, result: 'skipped' } : it
    ))
    advanceToNext()
  }

  function advanceToNext() {
    const nextIndex = currentIndex + 1
    if (nextIndex >= leads.length) {
      setIsRunning(false)
      setSessionDone(true)
      return
    }
    setCurrentIndex(nextIndex)
    setLeads(prev => prev.map((it, i) =>
      i === nextIndex ? { ...it, status: STATUS.DIALING } : it
    ))
  }

  const doneCount = leads.filter(l => l.status === STATUS.DONE || l.status === STATUS.SKIPPED).length
  const connected = leads.filter(l => ['meeting', 'thinking'].includes(l.result)).length

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Lead list */}
      <div className="w-72 border-r border-slate-700/50 flex flex-col bg-slate-900/50">
        <div className="px-4 py-4 border-b border-slate-700/50">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} className="text-yellow-400" />
            <span className="text-sm font-semibold text-slate-200">Пакетный дозвон</span>
          </div>

          <button
            onClick={loadBatch}
            disabled={loading || isRunning}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-all disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Загрузка...' : `Загрузить ${batchSize} контактов`}
          </button>
        </div>

        {/* Leads list */}
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {leads.length === 0 && (
            <div className="text-center text-slate-600 text-xs py-8">
              Нажмите «Загрузить контакты»
            </div>
          )}
          {leads.map((item, i) => {
            const phone = getPhone(item.lead)
            const name = getName(item.lead)
            const isCurrent = i === currentIndex && isRunning
            return (
              <div
                key={i}
                className={`rounded-lg px-3 py-2.5 transition-all ${
                  isCurrent
                    ? 'bg-blue-600/20 border border-blue-500/40'
                    : item.status === STATUS.DONE
                    ? 'bg-slate-800/30 opacity-60'
                    : item.status === STATUS.SKIPPED
                    ? 'bg-slate-800/20 opacity-40'
                    : 'bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{name}</p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{formatPhone(phone)}</p>
                  </div>
                  <div className="ml-2 flex-shrink-0">
                    {item.status === STATUS.PENDING && (
                      <span className="text-xs text-slate-600">#{i + 1}</span>
                    )}
                    {isCurrent && (item.status === STATUS.DIALING || item.status === STATUS.ACTIVE) && (
                      <span className="flex items-center gap-1 text-xs text-blue-400">
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                        {item.status === STATUS.DIALING ? 'Набор' : 'Разговор'}
                      </span>
                    )}
                    {(item.status === STATUS.DONE || item.status === STATUS.SKIPPED) && item.result && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${RESULT_BADGE[item.result] || 'bg-slate-700 text-slate-400'}`}>
                        {RESULT_LABEL[item.result] || item.result}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Stats bar */}
        {leads.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-700/50 flex gap-4 text-xs text-slate-500">
            <span>{doneCount}/{leads.length} готово</span>
            <span className="text-emerald-400">{connected} дозвон</span>
          </div>
        )}
      </div>

      {/* Right: Active call panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        {!isRunning && !sessionDone && leads.length === 0 && (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-yellow-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Zap size={28} className="text-yellow-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-100 mb-2">Пакетный дозвон</h2>
            <p className="text-slate-500 text-sm mb-6">
              Загружает {batchSize} контактов из очереди и автоматически набирает каждый номер по очереди
            </p>
            <button
              onClick={loadBatch}
              disabled={loading}
              className="px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold rounded-xl transition-all active:scale-95"
            >
              {loading ? 'Загрузка...' : 'Загрузить контакты'}
            </button>
          </div>
        )}

        {!isRunning && !sessionDone && leads.length > 0 && (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Phone size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-100 mb-1">Готово к обзвону</h2>
            <p className="text-slate-500 text-sm mb-6">
              {leads.length} контактов загружено. Нажмите «Начать» — система будет автоматически набирать каждый номер.
            </p>
            <button
              onClick={startSession}
              className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-all active:scale-95 text-lg"
            >
              <span className="flex items-center gap-2"><Phone size={18} /> Начать обзвон</span>
            </button>
          </div>
        )}

        {sessionDone && (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={28} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-100 mb-2">Сессия завершена</h2>
            <div className="flex gap-6 justify-center mb-6 text-sm">
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-100">{doneCount}</p>
                <p className="text-slate-500">обработано</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-400">{connected}</p>
                <p className="text-slate-500">дозвонов</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-400">{doneCount - connected}</p>
                <p className="text-slate-500">недозвонов</p>
              </div>
            </div>
            <button
              onClick={loadBatch}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all active:scale-95"
            >
              Новый пакет
            </button>
          </div>
        )}

        {isRunning && currentItem && (
          <div className="w-full max-w-md flex flex-col gap-5">
            {/* Current lead info */}
            <div className="text-center">
              <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">
                Контакт {currentIndex + 1} из {leads.length}
              </p>
              <h2 className="text-2xl font-bold text-slate-100">{getName(currentItem.lead)}</h2>
              <p className="text-2xl font-mono text-blue-300 mt-2 tracking-wider">
                {formatPhone(getPhone(currentItem.lead))}
              </p>
            </div>

            {/* Dialing countdown */}
            {currentItem.status === STATUS.DIALING && (
              <div className="bg-blue-600/20 border border-blue-500/30 rounded-2xl p-6 text-center">
                <p className="text-blue-300 text-sm mb-2">Автонабор через...</p>
                <p className="text-6xl font-bold text-blue-200">{dialCountdown ?? '...'}</p>
                <button
                  onClick={triggerCall}
                  className="mt-4 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-all"
                >
                  Позвонить сейчас
                </button>
              </div>
            )}

            {/* Active call */}
            {currentItem.status === STATUS.ACTIVE && (
              <div className="bg-emerald-600/10 border border-emerald-500/20 rounded-2xl p-5 text-center">
                <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm mb-1">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  Звонок идёт
                </div>
                <p className="text-4xl font-mono font-bold text-slate-100">{timer.display}</p>
              </div>
            )}

            {/* Quick result buttons */}
            {currentItem.status === STATUS.ACTIVE && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-slate-500 text-center uppercase tracking-wide">Результат звонка</p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_RESULTS.map(({ id, label, color, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => markResult(id)}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 ${COLOR_MAP[color]}`}
                    >
                      <Icon size={15} />
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={skipCurrent}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-all"
                  >
                    <ChevronRight size={15} /> Пропустить
                  </button>
                </div>
              </div>
            )}

            {currentItem.status === STATUS.DIALING && (
              <button
                onClick={skipCurrent}
                className="text-sm text-slate-600 hover:text-slate-400 text-center transition-colors"
              >
                Пропустить этот контакт →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
