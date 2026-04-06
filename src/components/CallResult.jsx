import React from 'react'
import { CheckCircle, XCircle, Calendar, Clock, ThumbsDown, PhoneOff, PhoneMissed, WifiOff } from 'lucide-react'

const CONNECTED_RESULTS = [
  {
    id: 'meeting',
    label: 'Заинтересован — назначил встречу',
    description: 'Клиент готов, дата встречи согласована',
    icon: Calendar,
    color: 'emerald'
  },
  {
    id: 'thinking',
    label: 'Заинтересован — думает',
    description: 'Клиент заинтересован, нужно время',
    icon: Clock,
    color: 'blue'
  },
  {
    id: 'rejected',
    label: 'Отказал — не интересно',
    description: 'Клиент отказался от предложения',
    icon: ThumbsDown,
    color: 'red'
  }
]

const NO_ANSWER_RESULTS = [
  {
    id: 'no_answer',
    label: 'Не берёт трубку',
    description: 'Звонок не был принят',
    icon: PhoneMissed,
    color: 'red'
  },
  {
    id: 'busy',
    label: 'Занято',
    description: 'Линия занята',
    icon: PhoneOff,
    color: 'amber'
  },
  {
    id: 'unavailable',
    label: 'Недоступен / вне зоны',
    description: 'Телефон недоступен',
    icon: WifiOff,
    color: 'slate'
  },
  {
    id: 'rejected_call',
    label: 'Сбросил вызов',
    description: 'Клиент сбросил звонок',
    icon: XCircle,
    color: 'orange'
  }
]

const COLOR_CLASSES = {
  emerald: 'bg-emerald-600/10 border-emerald-600/30 hover:bg-emerald-600/20 text-emerald-400',
  blue: 'bg-blue-600/10 border-blue-600/30 hover:bg-blue-600/20 text-blue-400',
  red: 'bg-red-600/10 border-red-600/30 hover:bg-red-600/20 text-red-400',
  amber: 'bg-amber-600/10 border-amber-600/30 hover:bg-amber-600/20 text-amber-400',
  orange: 'bg-orange-600/10 border-orange-600/30 hover:bg-orange-600/20 text-orange-400',
  slate: 'bg-slate-700/50 border-slate-600 hover:bg-slate-700 text-slate-400'
}

export default function CallResult({ mode, onResult, onBack }) {
  const results = mode === 'connected' ? CONNECTED_RESULTS : NO_ANSWER_RESULTS
  const title = mode === 'connected' ? 'Результат разговора' : 'Причина недозвона'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-100">{title}</h3>
        {onBack && (
          <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            Назад
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {results.map(({ id, label, description, icon: Icon, color }) => (
          <button
            key={id}
            onClick={() => onResult(id)}
            className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-150 text-left active:scale-[0.98] ${COLOR_CLASSES[color]}`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-current/10`}>
              <Icon size={20} />
            </div>
            <div>
              <p className="font-semibold text-slate-100">{label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
