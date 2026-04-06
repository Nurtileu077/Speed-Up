import React, { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Clock, Filter, Download } from 'lucide-react'

const RESULT_CONFIG = {
  connected: { label: 'Дозвон', color: 'text-emerald-400', bg: 'bg-emerald-600/10', icon: CheckCircle },
  no_answer: { label: 'Не берёт', color: 'text-red-400', bg: 'bg-red-600/10', icon: XCircle },
  busy: { label: 'Занято', color: 'text-amber-400', bg: 'bg-amber-600/10', icon: XCircle },
  unavailable: { label: 'Недоступен', color: 'text-slate-400', bg: 'bg-slate-700', icon: XCircle },
  rejected: { label: 'Отказал', color: 'text-red-400', bg: 'bg-red-600/10', icon: XCircle },
  rejected_call: { label: 'Сбросил', color: 'text-orange-400', bg: 'bg-orange-600/10', icon: XCircle },
  meeting: { label: 'Встреча', color: 'text-emerald-400', bg: 'bg-emerald-600/10', icon: CheckCircle },
  thinking: { label: 'Думает', color: 'text-blue-400', bg: 'bg-blue-600/10', icon: Clock }
}

function formatDate(dt) {
  return new Date(dt).toLocaleString('ru', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

function formatDuration(sec) {
  if (!sec) return '—'
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export default function History() {
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ result: '', dateFrom: '', dateTo: '' })

  useEffect(() => {
    loadAttempts()
  }, [filters])

  async function loadAttempts() {
    setLoading(true)
    try {
      if (window.electronAPI?.db) {
        const data = await window.electronAPI.db.getAllCallAttempts(filters)
        setAttempts(data || [])
      }
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setLoading(false)
    }
  }

  function exportCSV() {
    const headers = ['ID лида', 'Менеджер', 'Попытка №', 'Время', 'Длительность', 'Результат', 'Оценка AI']
    const rows = attempts.map(a => [
      a.lead_id, a.manager_id, a.attempt_num,
      formatDate(a.called_at), formatDuration(a.duration_sec),
      a.result, a.ai_score || ''
    ])

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `calls_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const stats = {
    total: attempts.length,
    connected: attempts.filter(a => a.result === 'connected' || a.result === 'meeting' || a.result === 'thinking').length,
    avgDuration: attempts.filter(a => a.duration_sec > 0).reduce((s, a) => s + a.duration_sec, 0) /
                 (attempts.filter(a => a.duration_sec > 0).length || 1)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-100">История звонков</h1>
            <p className="text-sm text-slate-500 mt-0.5">{attempts.length} записей</p>
          </div>
          <button onClick={exportCSV} className="btn-ghost text-sm flex items-center gap-2">
            <Download size={14} />
            CSV
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-end">
          <div>
            <label className="label text-xs">С даты</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
              className="input text-sm w-36"
            />
          </div>
          <div>
            <label className="label text-xs">По дату</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
              className="input text-sm w-36"
            />
          </div>
          <div>
            <label className="label text-xs">Результат</label>
            <select
              value={filters.result}
              onChange={e => setFilters(f => ({ ...f, result: e.target.value }))}
              className="input text-sm w-40"
            >
              <option value="">Все</option>
              {Object.entries(RESULT_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex gap-4 mt-3">
          <span className="text-xs text-slate-500">Итого: <b className="text-slate-300">{stats.total}</b></span>
          <span className="text-xs text-slate-500">Дозвонов: <b className="text-emerald-400">{stats.connected}</b></span>
          <span className="text-xs text-slate-500">
            % дозвона: <b className="text-blue-400">
              {stats.total ? Math.round(stats.connected / stats.total * 100) : 0}%
            </b>
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
            Загрузка...
          </div>
        ) : attempts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Clock size={32} className="text-slate-700" />
            <p className="text-slate-500 text-sm">История пуста</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Лид</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Время</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Попытка</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Результат</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Длительность</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">AI</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map(attempt => {
                const res = RESULT_CONFIG[attempt.result] || { label: attempt.result, color: 'text-slate-400', bg: 'bg-slate-700', icon: Clock }
                const Icon = res.icon
                return (
                  <tr key={attempt.id} className="border-b border-slate-700/50 hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs">#{attempt.lead_id}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{formatDate(attempt.called_at)}</td>
                    <td className="px-4 py-3 text-slate-400">#{attempt.attempt_num}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${res.bg} ${res.color}`}>
                        <Icon size={11} />
                        {res.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{formatDuration(attempt.duration_sec)}</td>
                    <td className="px-4 py-3">
                      {attempt.ai_score ? (
                        <span className={`text-xs font-bold ${
                          attempt.ai_score >= 7 ? 'text-emerald-400' :
                          attempt.ai_score >= 4 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {attempt.ai_score}/10
                        </span>
                      ) : (
                        <span className="text-slate-700 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
