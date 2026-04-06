import React from 'react'
import { FileText, ChevronDown, ChevronUp } from 'lucide-react'

const SCRIPTS = {
  attempt1: (name, topic) => `Здравствуйте, ${name || 'это вы?'}!

Меня зовут [имя менеджера], я из Nobilis Education.

Вы оставляли заявку на ${topic || 'наши курсы'}. Это актуально?

[Выслушать ответ]

Расскажите, пожалуйста — какой у вас целевой балл? К какому сроку хотите подготовиться?

[Выслушать → презентовать подходящую программу]

Что вас останавливает от того, чтобы начать сейчас?`,

  attempt2plus: (name, attemptNum) => `Здравствуйте, ${name || ''}!

Это [имя менеджера] из Nobilis Education, мы с вами уже общались.

Просто хотел уточнить — вы рассматриваете ещё нашу программу?

[Выслушать → напомнить о ключевых преимуществах]

Могу ответить на любые вопросы, которые появились. Что важно для вас?`,

  reconnect: (name) => `Здравствуйте, ${name || ''}!

Мы несколько раз пробовали до вас дозвониться — хотел убедиться, что у вас всё в порядке.

Ваша заявка ещё актуальна? Когда вам удобно пообщаться?`
}

export default function ScriptPanel({ lead, attemptNum = 1 }) {
  const [expanded, setExpanded] = React.useState(true)

  const name = lead?.name || lead?.NAME || ''
  const topic = lead?.COMMENTS || lead?.comments || 'IELTS'

  let scriptText
  if (attemptNum === 1) {
    scriptText = SCRIPTS.attempt1(name, topic)
  } else if (attemptNum >= 4) {
    scriptText = SCRIPTS.reconnect(name)
  } else {
    scriptText = SCRIPTS.attempt2plus(name, attemptNum)
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-slate-300">Скрипт разговора</span>
          <span className="text-xs text-slate-500">Попытка #{attemptNum}</span>
        </div>
        {expanded
          ? <ChevronUp size={16} className="text-slate-500" />
          : <ChevronDown size={16} className="text-slate-500" />
        }
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <pre className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed font-sans max-h-44 overflow-y-auto">
            {scriptText}
          </pre>
        </div>
      )}
    </div>
  )
}
