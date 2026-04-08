import { useState, useEffect, useCallback } from 'react'
import { sipInit, sipCall, sipHangup, sipStop, setStatusHandler } from '../services/sipService'

const STATUS_LABEL = {
  unconfigured: { text: 'SIP не настроен', color: 'text-slate-500' },
  connecting:   { text: 'Подключение...', color: 'text-yellow-400' },
  connected:    { text: 'Подключён', color: 'text-yellow-400' },
  registered:   { text: 'SIP готов ✓', color: 'text-emerald-400' },
  disconnected: { text: 'Нет связи', color: 'text-red-400' },
  unregistered: { text: 'Не зарегистрирован', color: 'text-red-400' },
  error:        { text: 'Ошибка SIP', color: 'text-red-400' },
  calling:      { text: 'Набор...', color: 'text-blue-400' },
  ringing:      { text: 'Идёт звонок...', color: 'text-blue-400' },
  active:       { text: 'Разговор', color: 'text-emerald-400' },
  ended:        { text: 'SIP готов ✓', color: 'text-emerald-400' },
  failed:       { text: 'SIP готов ✓', color: 'text-emerald-400' },
}

function initFromSettings() {
  return window.electronAPI?.db?.getSettings().then(s => {
    if (s?.SIP_USERNAME && s?.SIP_PASSWORD && s?.SIP_WS_URL) {
      return sipInit(s)
    }
  }).catch(() => {})
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

    // Init on mount
    initFromSettings()

    // Re-init when settings are saved
    function onReinit(e) {
      const s = e.detail
      if (s?.SIP_USERNAME && s?.SIP_PASSWORD && s?.SIP_WS_URL) {
        sipInit(s)
      } else {
        sipStop()
        setSipSt('unconfigured')
      }
    }
    window.addEventListener('sip-reinit', onReinit)

    return () => {
      setStatusHandler(null)
      window.removeEventListener('sip-reinit', onReinit)
    }
  }, [])

  const call    = useCallback((phone) => sipCall(phone), [])
  const hangup  = useCallback(() => sipHangup(), [])
  const reconnect = useCallback(() => initFromSettings(), [])

  const label = STATUS_LABEL[sipSt] || STATUS_LABEL.unconfigured

  return { sipSt, sipError, sipLabel: label, call, hangup, reconnect }
}
