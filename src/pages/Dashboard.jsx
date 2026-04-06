import React, { useState, useEffect } from 'react'
import { Phone, Clock, Target, Zap, CheckSquare, Bot, MessageCircle, TrendingUp } from 'lucide-react'
import { MetricCard, BarChart } from '../components/Analytics'

const PERIODS = [
  { label: 'Сегодня', value: 'today' },
  { label: 'Неделя', value: 'week' },
  { label: 'Месяц', value: 'month' }
]

function getDateRange(period) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (period) {
    case 'today':
      return { from: today.toISOString(), to: now.toISOString() }
    case 'week': {
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      return { from: weekAgo.toISOString(), to: now.toISOString() }
    }
    case 'month': {
      const monthAgo = new Date(today)
      monthAgo.setMonth(monthAgo.getMonth() - 1)
      return { from: monthAgo.toISOString(), to: now.toISOString() }
    }
    default:
      return { from: today.toISOString(), to: now.toISOString() }
  }
}

function calcStats(attempts) {
  const total = attempts.length
  const connected = attempts.filter(a =>
    ['connected', 'meeting', 'thinking'].includes(a.result)
  ).length
  const meetings = attempts.filter(a => a.result === 'meeting').length
  const talkSec = attempts.filter(a => a.duration_sec > 0).reduce((s, a) => s + a.duration_sec, 0)
  const aiScores = attempts.filter(a => a.ai_score).map(a => a.ai_score)

  return {
    total_calls: total,
    connected,
    talk_minutes: Math.round(talkSec / 60 * 10) / 10,
    connect_rate: total ? Math.round(connected / total * 100) : 0,
    conversion: connected ? Math.round(meetings / connected * 100) : 0,
    avg_ai_score: aiScores.length
      ? Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length * 10) / 10
      : null
  }
}

function buildChartData(attempts, period) {
  const map = {}
  for (const a of attempts) {
    const d = new Date(a.called_at)
    let key
    if (period === 'today') {
      key = `${d.getHours()}:00`
    } else {
      key = `${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}`
    }
    map[key] = (map[key] || 0) + 1
  }
  return Object.entries(map).map(([label, value]) => ({ label, value })).slice(-14)
}

export default function Dashboard() {
  const [period, setPeriod] = useState('today')
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [period])

  async function loadData() {
    setLoading(true)
    try {
      if (window.electronAPI?.db) {
        const { from, to } = getDateRange(period)
        const data = await window.electronAPI.db.getAllCallAttempts({
          dateFrom: from,
          dateTo: to,
          limit: 1000
        })
        setAttempts(data || [])
      }
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  const stats = calcStats(attempts)
  const chartData = buildChartData(attempts, period)

  const metrics = [
    { label: 'Минуты разговора', value: stats.talk_minutes, unit: 'мин', icon: Clock, color: 'text-blue-400' },
    { label: 'Всего звонков', value: stats.total_calls, unit: '', icon: Phone, color: 'text-slate-100' },
    { label: '% Дозвона', value: `${stats.connect_rate}%`, unit: '', icon: TrendingUp, color: 'text-emerald-400' },
    { label: 'Конверсия', value: `${stats.conversion}%`, unit: '', icon: Target, color: 'text-purple-400' },
    { label: 'Оценка AI', value: stats.avg_ai_score || '—', unit: stats.avg_ai_score ? '/10' : '', icon: Bot, color: 'text-amber-400' }
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Дашборд</h1>
            <p className="text-sm text-slate-500 mt-0.5">Статистика звонков</p>
          </div>

          {/* Period filter */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-xl p-1 gap-1">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  period === p.value
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
            Загрузка...
          </div>
        ) : (
          <>
            {/* Metrics grid */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {metrics.map(({ label, value, unit, icon: Icon, color }) => (
                <div key={label} className="metric-card">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={14} className={color} />
                    <p className="text-xs text-slate-500">{label}</p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${color}`}>{value}</span>
                    {unit && <span className="text-sm text-slate-500">{unit}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="card mb-6">
                <p className="text-xs font-medium text-slate-500 mb-4 uppercase tracking-wide">
                  Звонки — {period === 'today' ? 'по часам' : 'по дням'}
                </p>
                <BarChart data={chartData} color="bg-blue-500" height={120} />
              </div>
            )}

            {/* Result breakdown */}
            {attempts.length > 0 && (
              <div className="card">
                <p className="text-xs font-medium text-slate-500 mb-4 uppercase tracking-wide">Результаты</p>
                <div className="flex flex-col gap-2">
                  {[
                    { label: 'Дозвон', key: ['connected', 'meeting', 'thinking'], color: 'bg-emerald-500' },
                    { label: 'Не берёт трубку', key: ['no_answer'], color: 'bg-red-500' },
                    { label: 'Занято / Недоступен', key: ['busy', 'unavailable', 'rejected_call'], color: 'bg-amber-500' }
                  ].map(({ label, key, color }) => {
                    const count = attempts.filter(a => key.includes(a.result)).length
                    const pct = attempts.length ? Math.round(count / attempts.length * 100) : 0
                    return (
                      <div key={label} className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 w-40 flex-shrink-0">{label}</span>
                        <div className="flex-1 bg-slate-700 rounded-full h-2">
                          <div
                            className={`${color} h-2 rounded-full transition-all duration-500`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 w-12 text-right">{count} ({pct}%)</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {attempts.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <Phone size={40} className="text-slate-700" />
                <p className="text-slate-500 text-sm">Нет данных за выбранный период</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
