import React from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { Phone, BarChart2, Settings, Clock, Zap } from 'lucide-react'
import Dialer from './pages/Dialer'
import Dashboard from './pages/Dashboard'
import SettingsPage from './pages/Settings'
import History from './pages/History'
import PowerDialer from './pages/PowerDialer'

function Sidebar() {
  const navItems = [
    { to: '/dialer', icon: Phone, label: 'Дозвон' },
    { to: '/power', icon: Zap, label: 'Пакет' },
    { to: '/dashboard', icon: BarChart2, label: 'Дашборд' },
    { to: '/history', icon: Clock, label: 'История' },
    { to: '/settings', icon: Settings, label: 'Настройки' }
  ]

  return (
    <aside className="w-20 bg-slate-900 border-r border-slate-700/50 flex flex-col items-center py-6 gap-2 flex-shrink-0">
      {/* Logo */}
      <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center mb-4">
        <Phone size={18} className="text-white" />
      </div>

      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 w-16 py-3 px-2 rounded-xl transition-all duration-150 text-xs font-medium ${
              isActive
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'
            }`
          }
        >
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
    </aside>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen w-screen overflow-hidden bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/dialer" replace />} />
            <Route path="/dialer" element={<Dialer />} />
            <Route path="/power" element={<PowerDialer />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
