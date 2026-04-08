import React, { useState, useEffect } from 'react'
import { Save, CheckCircle, XCircle, Loader, Eye, EyeOff } from 'lucide-react'

const SETTINGS_FIELDS = [
  { section: 'Bitrix24', fields: [
    { key: 'BITRIX_PORTAL', label: 'Портал Bitrix24', placeholder: 'https://nobilis.bitrix24.kz', type: 'text' },
    { key: 'BITRIX_WEBHOOK', label: 'Вебхук URL', placeholder: 'https://nobilis.bitrix24.kz/rest/1/xxxxx/', type: 'password' },
    { key: 'BITRIX_USER_ID', label: 'ID менеджера в Bitrix24', placeholder: '1', type: 'text' },
    { key: 'CRM_TYPE', label: 'Тип CRM', placeholder: 'deal', type: 'select',
      options: [{ value: 'deal', label: 'Сделки (Deals)' }, { value: 'lead', label: 'Лиды (Leads)' }] }
  ]},
  { section: 'SIP (встроенный телефон)', fields: [
    { key: 'SIP_WS_URL',      label: 'WebSocket URL сервера', placeholder: 'wss://sip.beeline.kz:8089/ws', type: 'text' },
    { key: 'SIP_SERVER',      label: 'SIP домен (если отличается)', placeholder: 'sip.beeline.kz', type: 'text' },
    { key: 'SIP_USERNAME',    label: 'Логин (номер/extension)', placeholder: '1001', type: 'text' },
    { key: 'SIP_PASSWORD',    label: 'Пароль SIP', placeholder: '••••••••', type: 'password' },
    { key: 'SIP_DISPLAY_NAME',label: 'Имя сотрудника', placeholder: 'Менеджер Алматы', type: 'text' }
  ]},
  { section: 'Wazzup (WhatsApp)', fields: [
    { key: 'WAZZUP_API_KEY', label: 'API Key', placeholder: 'your_wazzup_api_key', type: 'password' },
    { key: 'WAZZUP_CHANNEL_ID', label: 'Channel ID', placeholder: 'your_channel_id', type: 'text' }
  ]},
  { section: 'AI интеграции', fields: [
    { key: 'OPENAI_API_KEY', label: 'OpenAI API Key (Whisper)', placeholder: 'sk-...', type: 'password' },
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key (Claude)', placeholder: 'sk-ant-...', type: 'password' }
  ]},
  { section: 'Telegram алерты', fields: [
    { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', placeholder: '123456:ABC...', type: 'password' },
    { key: 'TELEGRAM_CHAT_ID', label: 'Chat ID руководителя', placeholder: '-100123456789', type: 'text' }
  ]},
  { section: 'Этапы Bitrix24 (после звонка)', fields: [
    { key: 'STAGE_MEETING', label: 'Этап «Встреча назначена»', placeholder: 'C1:PREPARATION', type: 'text' },
    { key: 'STAGE_THINKING', label: 'Этап «Думает / перезвонит»', placeholder: 'C1:NEW', type: 'text' },
    { key: 'STAGE_REJECTED', label: 'Этап «Отказ»', placeholder: 'LOSE', type: 'text' },
    { key: 'STAGE_NO_ANSWER', label: 'Этап «Недозвон» (пусто = не менять)', placeholder: '', type: 'text' }
  ]},
  { section: 'Расписание', fields: [
    { key: 'WORK_HOURS_START', label: 'Начало рабочего дня', placeholder: '09:00', type: 'text' },
    { key: 'WORK_HOURS_END', label: 'Конец рабочего дня', placeholder: '19:00', type: 'text' },
    { key: 'MAX_ATTEMPTS_PER_DAY', label: 'Макс. попыток в день', placeholder: '6', type: 'text' }
  ]}
]

function PasswordField({ value, onChange, placeholder, disabled }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className="input pr-10 text-sm font-mono"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

export default function Settings() {
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        if (window.electronAPI?.db) {
          const settings = await window.electronAPI.db.getSettings()
          setValues(settings || {})
        }
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }
    load()
  }, [])

  function handleChange(key, val) {
    setValues(v => ({ ...v, [key]: val }))
    setSaved(false)
    setTestResult(null)
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (window.electronAPI?.db) {
        await window.electronAPI.db.saveSettings(values)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      // Re-init SIP if credentials changed
      window.dispatchEvent(new CustomEvent('sip-reinit', { detail: values }))
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleTestBitrix() {
    setTesting(true)
    setTestResult(null)
    try {
      if (window.electronAPI?.bitrix) {
        const result = await window.electronAPI.bitrix.testConnection()
        setTestResult(result)
      } else {
        setTestResult({ success: false, error: 'API недоступен' })
      }
    } catch (err) {
      setTestResult({ success: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Настройки</h1>
            <p className="text-slate-500 text-sm mt-1">API ключи и параметры системы</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 active:scale-95 ${
              saved
                ? 'bg-emerald-600 text-white'
                : 'btn-primary'
            }`}
          >
            {saving ? <Loader size={15} className="animate-spin" /> : saved ? <CheckCircle size={15} /> : <Save size={15} />}
            {saving ? 'Сохраняю...' : saved ? 'Сохранено!' : 'Сохранить'}
          </button>
        </div>

        <div className="flex flex-col gap-8">
          {SETTINGS_FIELDS.map(({ section, fields }) => (
            <div key={section}>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4 border-b border-slate-700 pb-2">
                {section}
              </h2>
              <div className="flex flex-col gap-4">
                {fields.map(({ key, label, placeholder, type, options }) => (
                  <div key={key}>
                    <label className="label">{label}</label>
                    {type === 'password' ? (
                      <PasswordField
                        value={values[key] || ''}
                        onChange={e => handleChange(key, e.target.value)}
                        placeholder={placeholder}
                        disabled={saving}
                      />
                    ) : type === 'select' ? (
                      <select
                        value={values[key] || options[0]?.value || ''}
                        onChange={e => handleChange(key, e.target.value)}
                        disabled={saving}
                        className="input text-sm bg-slate-800"
                      >
                        {options.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={values[key] || ''}
                        onChange={e => handleChange(key, e.target.value)}
                        placeholder={placeholder}
                        disabled={saving}
                        className="input text-sm"
                      />
                    )}
                  </div>
                ))}

                {/* Test connection button for Bitrix section */}
                {section === 'Bitrix24' && (
                  <div>
                    <button
                      onClick={handleTestBitrix}
                      disabled={testing || !values.BITRIX_WEBHOOK}
                      className="btn-ghost text-sm flex items-center gap-2"
                    >
                      {testing ? <Loader size={14} className="animate-spin" /> : null}
                      {testing ? 'Проверка...' : 'Проверить соединение'}
                    </button>

                    {testResult && (
                      <div className={`mt-3 flex items-start gap-2 text-sm px-3 py-2.5 rounded-lg border ${
                        testResult.success
                          ? 'bg-emerald-600/10 border-emerald-600/20 text-emerald-400'
                          : 'bg-red-600/10 border-red-600/20 text-red-400'
                      }`}>
                        {testResult.success
                          ? <CheckCircle size={15} className="flex-shrink-0 mt-0.5" />
                          : <XCircle size={15} className="flex-shrink-0 mt-0.5" />
                        }
                        <span>
                          {testResult.success
                            ? `Подключено! Пользователь: ${testResult.user?.NAME || testResult.user?.LAST_NAME || 'OK'}`
                            : `Ошибка: ${testResult.error}`
                          }
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
