import { useState, useEffect, useCallback } from 'react'
import { sipInit, sipCall, sipHangup, setStatusHandler } from '../services/sipService'

const STATUS_LABEL = {
  unconfigured: { text: 'SIP не настроен', color: 'text-slate-500' },
  connecting:   { text: 'Подключение...', color: 'text-yellow-400' },
  connected:    { text: 'Подключён', color: 'text-yellow-400' },
  registered:   { text: 'SIP готов', color: 'text-emerald-400' },
  disconnected: { text: 'Нет связи', color: 'text-red-400' },
  unregistered: { text: 'Не зарегистрирован', color: 'text-red-400' },
  error:        { text: 'Ошибка SIP', color: 'text-red-400' },
  calling:      { text: 'Набор...', color: 'text-blue-400' },
  ringing:      { text: 'Идёт звонок...', color: 'text-blue-400' },
  active:       { text: 'Разговор', color: 'text-emerald-400' },
  ended:        { text: 'SIP готов', color: 'text-emerald-400' },
  failed:       { text: 'SIP готов', color: 'text-emerald-400' },
}

export default function useSip({ onCallActive, onCallEnded, onCallFailed } = {}) {
  const [sipSt, setSipSt] = useState('unconfigured')
  const [sipError, setSipError] = useState('')

  useEffect(() => {
    setStatusHandler((status, data) => {
      setSipSt(status)
      if (status === 'error') setSipError(data || 'Ошибка')
      else setSipError('')

      if (status === 'active')  onCallActive?.()
      if (status === 'ended')   onCallEnded?.()
      if (status === 'failed')  onCallFailed?.(data)
    })

    // Init SIP on mount using saved settings
    window.electronAPI?.db?.getSettings().then(s => {
      if (s?.SIP_USERNAME && s?.SIP_PASSWORD && s?.SIP_WS_URL) {
        sipInit(s)
      } else {
        setSipSt('unconfigured')
      }
    }).catch(() => {})

    return () => setStatusHandler(null)
  }, [])

  const call = useCallback((phone) => {
    return sipCall(phone)
  }, [])

  const hangup = useCallback(() => {
    sipHangup()
  }, [])

  const label = STATUS_LABEL[sipSt] || STATUS_LABEL.unconfigured

  return { sipSt, sipError, sipLabel: label, call, hangup }
}
