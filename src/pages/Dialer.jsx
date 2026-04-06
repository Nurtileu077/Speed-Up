import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Phone, PhoneOff, PhoneCall, RefreshCw, ExternalLink, AlertTriangle, Users } from 'lucide-react'
import LeadCard from '../components/LeadCard'
import CallResult from '../components/CallResult'
import ScriptPanel from '../components/ScriptPanel'
import WaMessage from '../components/WaMessage'

// Dialer screens
const SCREEN = {
  WAITING: 'waiting',
  LOADING: 'loading',
  ACTIVE: 'active',
  RESULT: 'result',
  WHATSAPP: 'whatsapp'
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

function formatPhone(phone) {
  if (!phone) return 'Нет номера'
  const clean = phone.replace(/\D/g, '')
  if (clean.length === 11) {
    return `+${clean[0]} ${clean.slice(1,4)} ${clean.slice(4,7)} ${clean.slice(7,9)} ${clean.slice(9)}`
  }
  return phone
}

export default function Dialer() {
  const [screen, setScreen] = useState(SCREEN.WAITING)
  const [queueStats, setQueueStats] = useState({ total: 0, overdue: 0 })
  const [currentLead, setCurrentLead] = useState(null)
  const [callAttempts, setCallAttempts] = useState([])
  const [attemptCount, setAttemptCount] = useState(0)
  const [callMode, setCallMode] = useState(null) // 'connected' | 'no_answer'
  const [callResult, setCallResult] = useState(null)
  const [activeCallId, setActiveCallId] = useState(null)
  const [waTemplate, setWaTemplate] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const timer = useTimer(screen === SCREEN.ACTIVE)

  const loadQueueStats = useCallback(async () => {
    try {
      if (window.electronAPI?.queue) {
        const stats = await window.electronAPI.queue.getStats()
        setQueueStats(stats || { total: 0, overdue: 0 })
      }
    } catch (err) {
      console.error('Failed to load queue stats:', err)
    }
  }, [])

  useEffect(() => {
    loadQueueStats()
    const interval = setInterval(loadQueueStats, 30000)
    return () => clearInterval(interval)
  }, [loadQueueStats])

  async function handleReady() {
    setScreen(SCREEN.LOADING)
    setError('')

    try {
      // Get next lead from queue
      const lead = await window.electronAPI?.queue?.getNext()

      if (!lead) {
        setError('Очередь пуста. Новых лидов и задач нет.')
        setScreen(SCREEN.WAITING)
        return
      }

      // Load call history for this lead
      const attempts = await window.electronAPI?.db?.getCallAttempts(lead.id || lead.data?.ID)
      setCallAttempts(attempts || [])
      setAttemptCount(attempts?.length || 0)
      setCurrentLead(lead.data || lead)

      // Initiate call via Bitrix24
      const phone = lead.phone || (Array.isArray(lead.data?.PHONE) ? lead.data.PHONE[0]?.VALUE : lead.data?.PHONE)

      if (phone && window.electronAPI?.bitrix) {
        try {
          const callResult = await window.electronAPI.bitrix.initiateCall(
            lead.id,
            phone
          )
          setActiveCallId(callResult?.CALL_ID || null)
        } catch (callErr) {
          console.warn('Call initiation failed:', callErr.message)
          // Continue without call ID — manual calling mode
        }
      }

      setScreen(SCREEN.ACTIVE)
    } catch (err) {
      setError(err.message || 'Ошибка загрузки лида')
      setScreen(SCREEN.WAITING)
    }
  }

  async function handleCallEnd(mode) {
    setCallMode(mode)
    setScreen(SCREEN.RESULT)

    // Finish call in Bitrix24
    if (activeCallId && window.electronAPI?.bitrix) {
      try {
        await window.electronAPI.bitrix.finishCall(
          activeCallId,
          mode === 'connected' ? 'connected' : 'no_answer',
          timer.seconds
        )
      } catch (err) {
        console.warn('finishCall error:', err.message)
      }
    }
  }

  async function handleResult(resultId) {
    setCallResult(resultId)
    const leadId = currentLead?.ID || currentLead?.id

    if (!leadId) {
      setScreen(SCREEN.WAITING)
      return
    }

    // Calculate next attempt time for no-answer cases
    const nextAttempt = attemptCount + 1
    const now = new Date().toISOString()
    let nextCallAt = null

    if (callMode !== 'connected' && nextAttempt < 6) {
      try {
        nextCallAt = await window.electronAPI?.scheduler?.calcNextAttempt(nextAttempt)
      } catch {}
    }

    // Save attempt to DB
    const phone = Array.isArray(currentLead?.PHONE)
      ? currentLead.PHONE[0]?.VALUE
      : currentLead?.phone || currentLead?.PHONE || ''

    if (window.electronAPI?.db) {
      await window.electronAPI.db.saveCallAttempt({
        lead_id: String(leadId),
        manager_id: 'current',
        attempt_num: nextAttempt,
        called_at: now,
        duration_sec: timer.seconds,
        result: resultId,
        next_call_at: nextCallAt,
        lead_name: leadName,
        lead_phone: phone,
        bitrix_call_id: activeCallId
      })
    }

    const leadName = currentLead?.name || currentLead?.NAME || currentLead?.TITLE || ''
    const leadTopic = currentLead?.COMMENTS || 'вашей заявки'

    if (callMode === 'connected') {
      // Show WhatsApp compose for connected calls
      let template = ''
      if (resultId === 'thinking') {
        template = `Здравствуйте, ${leadName}! Как ваше решение по ${leadTopic}?\nГотов ответить на любые вопросы.`
      } else if (resultId === 'meeting') {
        template = `Здравствуйте, ${leadName}! Спасибо за разговор!\nОжидаем вас на встрече. Если будут вопросы — напишите.`
      }

      // Create task in Bitrix24
      if (window.electronAPI?.bitrix) {
        const deadline = new Date()
        if (resultId === 'meeting') {
          deadline.setDate(deadline.getDate() + 1)
        } else if (resultId === 'thinking') {
          deadline.setDate(deadline.getDate() + 2)
        } else {
          deadline.setDate(deadline.getDate() + 7)
        }

        const taskLabels = {
          meeting: 'Провести встречу',
          thinking: 'Перезвонить (думает)',
          rejected: 'Финальная попытка'
        }

        try {
          await window.electronAPI.bitrix.createTask({
            TITLE: `${taskLabels[resultId] || 'Задача'} — ${leadName}`,
            DEADLINE: deadline.toISOString(),
            UF_CRM_TASK: [`L_${leadId}`],
            DESCRIPTION: `Результат звонка: ${resultId}`
          })
        } catch (err) {
          console.warn('createTask error:', err.message)
        }
      }

      // Add Bitrix comment
      if (window.electronAPI?.bitrix) {
        const resultLabels = {
          meeting: 'Заинтересован — назначил встречу',
          thinking: 'Заинтересован — думает, перезвонит',
          rejected: 'Отказал — не интересно'
        }
        const comment = `✅ Дозвон\nВремя: ${new Date().toLocaleString('ru')}\nДлительность: ${Math.floor(timer.seconds/60)} мин ${timer.seconds%60} сек\nРезультат: ${resultLabels[resultId] || resultId}`
        try {
          await window.electronAPI.bitrix.addComment(String(leadId), comment)
        } catch (err) {
          console.warn('addComment error:', err.message)
        }
      }

      // Schedule "thinking" follow-up WA in 2 days
      if (resultId === 'thinking' && phone && window.electronAPI?.wa) {
        const followUpDate = new Date()
        followUpDate.setDate(followUpDate.getDate() + 2)
        followUpDate.setHours(10, 0, 0, 0)
        try {
          await window.electronAPI.wa.schedule({
            leadId: String(leadId),
            phone,
            message: `Здравствуйте, ${leadName}! Как ваше решение по ${leadTopic}?\nГотов ответить на любые вопросы.`,
            sendAt: followUpDate.toISOString()
          })
        } catch {}
      }

      // Run AI analysis in background for connected calls
      if (activeCallId && timer.seconds >= 30 && window.electronAPI?.ai) {
        window.electronAPI.ai.runAnalysis({
          callId: activeCallId,
          leadId: String(leadId),
          durationSec: timer.seconds
        }).catch(err => console.warn('AI analysis error:', err))
      }

      if (template) {
        setWaTemplate(template)
        setScreen(SCREEN.WHATSAPP)
      } else {
        resetToWaiting()
      }
    } else {
      // No answer — add comment and schedule retry
      const resultLabels = {
        no_answer: 'Не берёт трубку',
        busy: 'Занято',
        unavailable: 'Недоступен / вне зоны',
        rejected_call: 'Сбросил вызов'
      }

      if (window.electronAPI?.bitrix) {
        let comment = `📞 Автодозвон #${nextAttempt} — Недозвон\nВремя: ${new Date().toLocaleString('ru')}\nМенеджер: текущий\nРезультат: ${resultLabels[resultId] || resultId}`
        if (nextCallAt) {
          const nextDate = new Date(nextCallAt)
          comment += `\nСледующая попытка: ${nextDate.toLocaleString('ru')}`
        }
        try {
          await window.electronAPI.bitrix.addComment(String(leadId), comment)
        } catch (err) {
          console.warn('addComment error:', err.message)
        }

        // Create "Перезвонить" task for next attempt
        if (nextCallAt) {
          try {
            await window.electronAPI.bitrix.createTask({
              TITLE: `Перезвонить — ${leadName} (попытка #${nextAttempt + 1})`,
              DEADLINE: nextCallAt,
              UF_CRM_TASK: [`L_${leadId}`],
              DESCRIPTION: `Автодозвон: предыдущий результат — ${resultLabels[resultId]}`
            })
          } catch {}
        }
      }

      // After 6 failed attempts → update lead status
      if (nextAttempt >= 6 && window.electronAPI?.bitrix) {
        try {
          await window.electronAPI.bitrix.updateLead(String(leadId), {
            STATUS_ID: 'UC_REFUSE',
            COMMENTS: 'Автодозвон: 6 попыток, не берёт трубку'
          })
        } catch {}
      }

      // Auto-WhatsApp on attempt 3 or 6
      if (nextAttempt === 3 || nextAttempt >= 6) {
        const phone = Array.isArray(currentLead?.PHONE)
          ? currentLead.PHONE[0]?.VALUE
          : currentLead?.phone || currentLead?.PHONE || ''

        const name = currentLead?.name || currentLead?.NAME || ''
        const topic = currentLead?.COMMENTS || 'вашей заявки'

        let template
        if (nextAttempt === 3) {
          template = `Здравствуйте, ${name}! Мы пробовали вам позвонить насчёт ${topic}.\nУдобно ли созвониться сейчас?`
        } else {
          template = `Здравствуйте, ${name}! Никак не можем дозвониться.\nУдобнее общаться в WhatsApp?`
        }

        setWaTemplate(template)
        setScreen(SCREEN.WHATSAPP)
        return
      }

      resetToWaiting()
    }
  }

  function resetToWaiting() {
    setScreen(SCREEN.WAITING)
    setCurrentLead(null)
    setCallAttempts([])
    setAttemptCount(0)
    setCallMode(null)
    setCallResult(null)
    setActiveCallId(null)
    setWaTemplate('')
    loadQueueStats()
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await window.electronAPI?.queue?.refresh()
      await loadQueueStats()
    } finally {
      setRefreshing(false)
    }
  }

  function openInBitrix() {
    const leadId = currentLead?.ID || currentLead?.id
    if (!leadId) return
    const portal = localStorage.getItem('BITRIX_PORTAL') || 'https://nobilis.bitrix24.kz'
    window.open?.(`${portal}/crm/lead/details/${leadId}/`, '_blank')
  }

  // ─── SCREEN: WAITING ───────────────────────────────────────────
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

        {/* Queue stats */}
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

        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={handleReady}
            disabled={screen === SCREEN.LOADING}
            className="btn-primary w-full text-lg py-4 flex items-center justify-center gap-2"
          >
            {screen === SCREEN.LOADING ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Загрузка...
              </>
            ) : (
              <>
                <Phone size={18} />
                Я ГОТОВ
              </>
            )}
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-ghost w-full text-sm flex items-center justify-center gap-2"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Обновить очередь
          </button>
        </div>
      </div>
    )
  }

  // ─── SCREEN: ACTIVE CALL ────────────────────────────────────────
  if (screen === SCREEN.ACTIVE) {
    const phone = Array.isArray(currentLead?.PHONE)
      ? currentLead.PHONE[0]?.VALUE
      : currentLead?.phone || currentLead?.PHONE || ''

    return (
      <div className="h-full flex flex-col gap-4 p-6 overflow-y-auto">
        {/* Timer & actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-xl font-mono font-bold text-emerald-400">{timer.display}</span>
            <span className="text-sm text-slate-500">Звонок активен</span>
          </div>
          <button
            onClick={openInBitrix}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ExternalLink size={14} />
            Bitrix24
          </button>
        </div>

        {/* Lead card */}
        <LeadCard
          lead={currentLead}
          attempts={callAttempts}
          attemptCount={attemptCount}
          maxAttempts={6}
        />

        {/* Script */}
        <ScriptPanel lead={currentLead} attemptNum={attemptCount + 1} />

        {/* Call end buttons */}
        <div className="flex gap-3 mt-auto pt-2">
          <button
            onClick={() => handleCallEnd('no_answer')}
            className="btn-danger flex-1 flex items-center justify-center gap-2"
          >
            <PhoneOff size={18} />
            Недозвон
          </button>
          <button
            onClick={() => handleCallEnd('connected')}
            className="btn-success flex-1 flex items-center justify-center gap-2"
          >
            <PhoneCall size={18} />
            Дозвон
          </button>
        </div>
      </div>
    )
  }

  // ─── SCREEN: RESULT ─────────────────────────────────────────────
  if (screen === SCREEN.RESULT) {
    return (
      <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto">
        {/* Lead name */}
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            callMode === 'connected'
              ? 'bg-emerald-600/20 border border-emerald-600/30'
              : 'bg-red-600/20 border border-red-600/30'
          }`}>
            {callMode === 'connected'
              ? <PhoneCall size={18} className="text-emerald-400" />
              : <PhoneOff size={18} className="text-red-400" />
            }
          </div>
          <div>
            <p className="font-bold text-slate-100">
              {currentLead?.name || currentLead?.NAME || currentLead?.TITLE}
            </p>
            <p className="text-xs text-slate-500">
              {callMode === 'connected' ? `Разговор ${timer.display}` : 'Не удалось дозвониться'}
            </p>
          </div>
        </div>

        <CallResult
          mode={callMode}
          onResult={handleResult}
          onBack={() => setScreen(SCREEN.ACTIVE)}
        />
      </div>
    )
  }

  // ─── SCREEN: WHATSAPP ────────────────────────────────────────────
  if (screen === SCREEN.WHATSAPP) {
    return (
      <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold text-slate-100">Отправить сообщение</h2>
          <p className="text-sm text-slate-500 mt-1">
            {currentLead?.name || currentLead?.NAME || 'Клиент'}
          </p>
        </div>
        <WaMessage
          lead={currentLead}
          template={waTemplate}
          onSend={resetToWaiting}
          onSkip={resetToWaiting}
        />
      </div>
    )
  }

  return null
}
