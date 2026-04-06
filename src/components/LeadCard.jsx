import React from 'react'
import { User, Phone, MapPin, Target, CheckCircle, XCircle } from 'lucide-react'

const SOURCE_LABELS = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  WEB: 'Сайт',
  CALL: 'Звонок',
  PARTNER: 'Партнёр',
  REFERRAL: 'Рекомендация',
  OTHER: 'Другое'
}

const RESULT_LABELS = {
  connected: { label: 'Дозвон', color: 'text-emerald-400', icon: CheckCircle },
  no_answer: { label: 'Не берёт трубку', color: 'text-red-400', icon: XCircle },
  busy: { label: 'Занято', color: 'text-amber-400', icon: XCircle },
  unavailable: { label: 'Недоступен', color: 'text-slate-400', icon: XCircle },
  rejected: { label: 'Сбросил', color: 'text-red-400', icon: XCircle }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })
}

export default function LeadCard({ lead, attempts = [], attemptCount = 0, maxAttempts = 6 }) {
  if (!lead) return null

  const phone = Array.isArray(lead.PHONE)
    ? lead.PHONE[0]?.VALUE
    : lead.phone || lead.PHONE || ''

  const source = SOURCE_LABELS[lead.SOURCE_ID] || lead.source || 'Неизвестно'
  const comments = lead.COMMENTS || lead.comments || ''

  return (
    <div className="card flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-600/20 border border-blue-600/30 rounded-xl flex items-center justify-center">
            <User size={22} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              {lead.name || lead.TITLE || `Лид #${lead.ID}`}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Phone size={13} className="text-slate-500" />
              <span className="text-sm text-slate-400 font-mono">{phone || 'Нет номера'}</span>
            </div>
          </div>
        </div>

        {/* Attempt badge */}
        <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
          attemptCount >= 5 ? 'bg-red-600/20 text-red-400 border border-red-600/30' :
          attemptCount >= 3 ? 'bg-amber-600/20 text-amber-400 border border-amber-600/30' :
          'bg-slate-700 text-slate-400'
        }`}>
          Звонок #{attemptCount + 1} из {maxAttempts}
        </div>
      </div>

      {/* Source & interest */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <MapPin size={14} className="text-slate-500" />
          <span className="text-slate-400">{source}</span>
        </div>
        {comments && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Target size={14} className="text-slate-500 flex-shrink-0" />
            <span className="text-slate-400 truncate">{comments}</span>
          </div>
        )}
      </div>

      {/* Call history */}
      {attempts.length > 0 && (
        <div className="border-t border-slate-700 pt-3">
          <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">История звонков</p>
          <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto">
            {attempts.slice(0, 5).map((attempt, i) => {
              const res = RESULT_LABELS[attempt.result] || { label: attempt.result, color: 'text-slate-400', icon: XCircle }
              const Icon = res.icon
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Icon size={12} className={res.color} />
                  <span className="text-slate-500">{formatDate(attempt.called_at)}</span>
                  <span className={`${res.color} font-medium`}>{res.label}</span>
                  {attempt.duration_sec > 0 && (
                    <span className="text-slate-600 ml-auto">
                      {Math.floor(attempt.duration_sec / 60)}:{String(attempt.duration_sec % 60).padStart(2, '0')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
