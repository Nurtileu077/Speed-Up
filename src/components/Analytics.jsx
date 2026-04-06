import React from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

function BarChart({ data, maxValue, color = 'bg-blue-500', height = 80 }) {
  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center h-20 text-slate-600 text-xs">Нет данных</div>
  )

  const max = maxValue || Math.max(...data.map(d => d.value), 1)

  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((item, i) => (
        <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
          <div
            className={`w-full rounded-t-sm ${color} opacity-80 hover:opacity-100 transition-opacity min-h-[2px]`}
            style={{ height: `${Math.max((item.value / max) * (height - 20), 2)}px` }}
            title={`${item.label}: ${item.value}`}
          />
          <span className="text-[10px] text-slate-600 truncate w-full text-center">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function MetricCard({ label, value, unit = '', trend, color = 'text-slate-100' }) {
  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus
  const trendColor = trend > 0 ? 'text-emerald-400' : trend < 0 ? 'text-red-400' : 'text-slate-500'

  return (
    <div className="metric-card">
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-bold ${color}`}>{value}</span>
        {unit && <span className="text-sm text-slate-500">{unit}</span>}
        {trend !== undefined && (
          <TrendIcon size={14} className={`${trendColor} ml-auto`} />
        )}
      </div>
    </div>
  )
}

export default function Analytics({ stats = {}, chartData = [] }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Минуты разговора"
          value={Math.round(stats.talk_minutes || 0)}
          unit="мин"
          color="text-blue-400"
        />
        <MetricCard
          label="Всего звонков"
          value={stats.total_calls || 0}
          color="text-slate-100"
        />
        <MetricCard
          label="% Дозвона"
          value={stats.total_calls
            ? Math.round((stats.connected / stats.total_calls) * 100)
            : 0}
          unit="%"
          color="text-emerald-400"
        />
        <MetricCard
          label="Средняя оценка AI"
          value={stats.avg_ai_score ? stats.avg_ai_score.toFixed(1) : '—'}
          unit="/10"
          color="text-purple-400"
        />
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <p className="text-xs font-medium text-slate-500 mb-4 uppercase tracking-wide">Звонки по дням</p>
          <BarChart data={chartData} color="bg-blue-500" height={100} />
        </div>
      )}
    </div>
  )
}

export { MetricCard, BarChart }
