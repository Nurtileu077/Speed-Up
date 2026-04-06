import React, { useState } from 'react'
import { MessageCircle, Send, X, Check, Loader } from 'lucide-react'

export default function WaMessage({ lead, template, onSend, onSkip }) {
  const phone = Array.isArray(lead?.PHONE)
    ? lead.PHONE[0]?.VALUE
    : lead?.phone || lead?.PHONE || ''

  const [text, setText] = useState(template || '')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [error, setError] = useState('')

  async function handleSend() {
    if (!text.trim() || !phone) return
    setStatus('sending')
    setError('')

    try {
      if (window.electronAPI?.wazzup) {
        await window.electronAPI.wazzup.sendMessage(phone, text)
      }
      setStatus('sent')
      setTimeout(() => onSend?.(), 1200)
    } catch (err) {
      setStatus('error')
      setError(err.message || 'Ошибка отправки')
    }
  }

  return (
    <div className="card flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-600/20 rounded-lg flex items-center justify-center">
            <MessageCircle size={16} className="text-emerald-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-100 text-sm">WhatsApp сообщение</p>
            <p className="text-xs text-slate-500">{phone || 'Нет номера'}</p>
          </div>
        </div>
        {onSkip && (
          <button
            onClick={onSkip}
            className="text-slate-500 hover:text-slate-300 transition-colors p-1"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Text area */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={status === 'sending' || status === 'sent'}
        rows={5}
        className="input resize-none text-sm leading-relaxed"
        placeholder="Введите сообщение..."
      />

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 bg-red-600/10 border border-red-600/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {onSkip && (
          <button
            onClick={onSkip}
            disabled={status === 'sending'}
            className="btn-ghost flex-1 text-sm"
          >
            Пропустить
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={!text.trim() || !phone || status === 'sending' || status === 'sent'}
          className={`flex-1 flex items-center justify-center gap-2 font-semibold py-3 rounded-xl transition-all duration-150 active:scale-95 text-sm ${
            status === 'sent'
              ? 'bg-emerald-600 text-white'
              : 'btn-success'
          }`}
        >
          {status === 'sending' && <Loader size={16} className="animate-spin" />}
          {status === 'sent' && <Check size={16} />}
          {status === 'sending' ? 'Отправка...' : status === 'sent' ? 'Отправлено!' : (
            <>
              <Send size={16} />
              Отправить в WhatsApp
            </>
          )}
        </button>
      </div>
    </div>
  )
}
