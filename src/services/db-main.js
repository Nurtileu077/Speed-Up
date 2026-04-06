const Database = require('better-sqlite3')
const path = require('path')

let db = null
let dbPath = null

function getDefaultDbPath() {
  try {
    const { app } = require('electron')
    return path.join(app.getPath('userData'), 'nobilis-dialer.db')
  } catch {
    return path.join(process.cwd(), 'data', 'nobilis-dialer.db')
  }
}

function initDB(customPath) {
  if (db) return db

  dbPath = customPath || getDefaultDbPath()

  // Ensure directory exists
  const dir = path.dirname(dbPath)
  const fs = require('fs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS call_attempts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id      TEXT NOT NULL,
      manager_id   TEXT NOT NULL,
      attempt_num  INTEGER NOT NULL,
      called_at    DATETIME NOT NULL,
      duration_sec INTEGER DEFAULT 0,
      result       TEXT NOT NULL,
      next_call_at DATETIME,
      wa_sent      BOOLEAN DEFAULT 0,
      ai_score     INTEGER,
      ai_summary   TEXT,
      bitrix_call_id TEXT,
      lead_name    TEXT,
      lead_phone   TEXT
    );

    CREATE TABLE IF NOT EXISTS manager_sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      manager_id   TEXT NOT NULL,
      date         DATE NOT NULL,
      total_calls  INTEGER DEFAULT 0,
      connected    INTEGER DEFAULT 0,
      talk_minutes REAL DEFAULT 0,
      avg_ai_score REAL,
      wa_sent      INTEGER DEFAULT 0,
      meetings     INTEGER DEFAULT 0,
      tasks_done   INTEGER DEFAULT 0,
      tasks_total  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wa_scheduled (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id      TEXT NOT NULL,
      phone        TEXT NOT NULL,
      message      TEXT NOT NULL,
      send_at      DATETIME NOT NULL,
      sent         BOOLEAN DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_analyses (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id      TEXT NOT NULL,
      call_attempt_id INTEGER,
      score        INTEGER,
      criteria     TEXT,
      client_goal  TEXT,
      client_deadline TEXT,
      objection    TEXT,
      agreement    TEXT,
      next_step    TEXT,
      client_mood  TEXT,
      summary      TEXT,
      improvement  TEXT,
      transcript   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (call_attempt_id) REFERENCES call_attempts(id)
    );

    CREATE TABLE IF NOT EXISTS telegram_alerts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      message      TEXT NOT NULL,
      sent         BOOLEAN DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_call_attempts_lead ON call_attempts(lead_id);
    CREATE INDEX IF NOT EXISTS idx_call_attempts_manager ON call_attempts(manager_id);
    CREATE INDEX IF NOT EXISTS idx_call_attempts_date ON call_attempts(called_at);
    CREATE INDEX IF NOT EXISTS idx_wa_scheduled_send ON wa_scheduled(send_at, sent);
  `)

  console.log('[DB] Initialized at', dbPath)
  return db
}

function getDB() {
  if (!db) initDB()
  return db
}

// ─── Call Attempts ────────────────────────────────────────────

function saveCallAttempt(data) {
  const database = getDB()
  const stmt = database.prepare(`
    INSERT INTO call_attempts
      (lead_id, manager_id, attempt_num, called_at, duration_sec, result, next_call_at, wa_sent, bitrix_call_id, lead_name, lead_phone)
    VALUES
      (@lead_id, @manager_id, @attempt_num, @called_at, @duration_sec, @result, @next_call_at, @wa_sent, @bitrix_call_id, @lead_name, @lead_phone)
  `)
  return stmt.run({
    lead_id: data.lead_id,
    manager_id: data.manager_id || 'default',
    attempt_num: data.attempt_num || 1,
    called_at: data.called_at || new Date().toISOString(),
    duration_sec: data.duration_sec || 0,
    result: data.result,
    next_call_at: data.next_call_at || null,
    wa_sent: data.wa_sent ? 1 : 0,
    bitrix_call_id: data.bitrix_call_id || null,
    lead_name: data.lead_name || null,
    lead_phone: data.lead_phone || null
  })
}

function getCallAttempts(leadId) {
  return getDB().prepare(
    'SELECT * FROM call_attempts WHERE lead_id = ? ORDER BY called_at DESC'
  ).all(String(leadId))
}

function getAttemptCount(leadId) {
  const row = getDB().prepare(
    'SELECT COUNT(*) as count FROM call_attempts WHERE lead_id = ?'
  ).get(String(leadId))
  return row ? row.count : 0
}

function getLastAttempt(leadId) {
  return getDB().prepare(
    'SELECT * FROM call_attempts WHERE lead_id = ? ORDER BY called_at DESC LIMIT 1'
  ).get(String(leadId))
}

function updateNextCallTime(id, nextCallAt) {
  getDB().prepare('UPDATE call_attempts SET next_call_at = ? WHERE id = ?').run(nextCallAt, id)
}

function updateAiScore(id, aiScore, aiSummary) {
  getDB().prepare('UPDATE call_attempts SET ai_score = ?, ai_summary = ? WHERE id = ?').run(aiScore, aiSummary, id)
}

function markWaSent(id) {
  getDB().prepare('UPDATE call_attempts SET wa_sent = 1 WHERE id = ?').run(id)
}

function getPendingRetries() {
  const now = new Date().toISOString()
  return getDB().prepare(`
    SELECT ca.* FROM call_attempts ca
    INNER JOIN (
      SELECT lead_id, MAX(id) as max_id FROM call_attempts GROUP BY lead_id
    ) latest ON ca.id = latest.max_id
    WHERE ca.result IN ('no_answer', 'busy', 'unavailable', 'rejected', 'rejected_call')
      AND ca.attempt_num < 6
      AND ca.next_call_at IS NOT NULL
      AND ca.next_call_at <= ?
    ORDER BY ca.next_call_at ASC
  `).all(now)
}

function getLeadsExceededAttempts() {
  return getDB().prepare(`
    SELECT ca.lead_id, ca.lead_name, ca.lead_phone, ca.attempt_num
    FROM call_attempts ca
    INNER JOIN (
      SELECT lead_id, MAX(id) as max_id FROM call_attempts GROUP BY lead_id
    ) latest ON ca.id = latest.max_id
    WHERE ca.attempt_num >= 6
      AND ca.result != 'connected'
      AND ca.result != 'meeting'
      AND ca.result != 'thinking'
  `).all()
}

function getAllCallAttempts(filters = {}) {
  let query = 'SELECT * FROM call_attempts WHERE 1=1'
  const params = []

  if (filters.dateFrom) {
    query += ' AND called_at >= ?'
    params.push(filters.dateFrom)
  }
  if (filters.dateTo) {
    query += ' AND called_at <= ?'
    params.push(filters.dateTo)
  }
  if (filters.result) {
    query += ' AND result = ?'
    params.push(filters.result)
  }
  if (filters.managerId) {
    query += ' AND manager_id = ?'
    params.push(filters.managerId)
  }
  if (filters.leadId) {
    query += ' AND lead_id = ?'
    params.push(filters.leadId)
  }

  query += ' ORDER BY called_at DESC'
  if (filters.limit) {
    query += ` LIMIT ${parseInt(filters.limit)}`
  }

  return getDB().prepare(query).all(...params)
}

// ─── Settings ─────────────────────────────────────────────────

function saveSettings(key, value) {
  getDB().prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).run(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
}

function getSetting(key) {
  const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : null
}

function getSettings() {
  const rows = getDB().prepare('SELECT key, value FROM settings').all()
  const result = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}

function saveAllSettings(data) {
  const upsert = getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const tx = getDB().transaction((settings) => {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined && value !== null) {
        upsert.run(key, String(value))
      }
    }
  })
  tx(data)
}

// ─── Manager Stats ────────────────────────────────────────────

function getManagerStats(managerId, date) {
  return getDB().prepare(
    'SELECT * FROM manager_sessions WHERE manager_id = ? AND date = ?'
  ).get(managerId, date)
}

function updateManagerStats(managerId, date, data) {
  const existing = getManagerStats(managerId, date)

  if (existing) {
    getDB().prepare(`
      UPDATE manager_sessions SET
        total_calls = total_calls + ?,
        connected = connected + ?,
        talk_minutes = talk_minutes + ?,
        wa_sent = wa_sent + ?,
        meetings = meetings + ?
      WHERE manager_id = ? AND date = ?
    `).run(
      data.total_calls || 0,
      data.connected || 0,
      data.talk_minutes || 0,
      data.wa_sent || 0,
      data.meetings || 0,
      managerId, date
    )
  } else {
    getDB().prepare(`
      INSERT INTO manager_sessions (manager_id, date, total_calls, connected, talk_minutes, avg_ai_score, wa_sent, meetings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(managerId, date, data.total_calls || 0, data.connected || 0,
           data.talk_minutes || 0, data.avg_ai_score || null,
           data.wa_sent || 0, data.meetings || 0)
  }
}

function getAllManagerStats(filters = {}) {
  let query = 'SELECT * FROM manager_sessions WHERE 1=1'
  const params = []

  if (filters.managerId) { query += ' AND manager_id = ?'; params.push(filters.managerId) }
  if (filters.dateFrom) { query += ' AND date >= ?'; params.push(filters.dateFrom) }
  if (filters.dateTo) { query += ' AND date <= ?'; params.push(filters.dateTo) }

  query += ' ORDER BY date DESC'
  return getDB().prepare(query).all(...params)
}

// ─── Scheduled WhatsApp ───────────────────────────────────────

function scheduleWa(leadId, phone, message, sendAt) {
  getDB().prepare(`
    INSERT INTO wa_scheduled (lead_id, phone, message, send_at)
    VALUES (?, ?, ?, ?)
  `).run(String(leadId), phone, message, sendAt)
}

function getPendingWa() {
  const now = new Date().toISOString()
  return getDB().prepare(
    'SELECT * FROM wa_scheduled WHERE sent = 0 AND send_at <= ? ORDER BY send_at ASC'
  ).all(now)
}

function markWaScheduledSent(id) {
  getDB().prepare('UPDATE wa_scheduled SET sent = 1 WHERE id = ?').run(id)
}

// ─── AI Analyses ──────────────────────────────────────────────

function saveAiAnalysis(data) {
  return getDB().prepare(`
    INSERT INTO ai_analyses
      (lead_id, call_attempt_id, score, criteria, client_goal, client_deadline,
       objection, agreement, next_step, client_mood, summary, improvement, transcript)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.lead_id, data.call_attempt_id || null, data.score,
    typeof data.criteria === 'object' ? JSON.stringify(data.criteria) : data.criteria,
    data.client_goal, data.client_deadline, data.objection,
    data.agreement, data.next_step, data.client_mood,
    data.summary, data.improvement, data.transcript
  )
}

function getAiAnalyses(leadId) {
  return getDB().prepare(
    'SELECT * FROM ai_analyses WHERE lead_id = ? ORDER BY created_at DESC'
  ).all(String(leadId))
}

// ─── Telegram Alerts ──────────────────────────────────────────

function saveAlert(type, message) {
  getDB().prepare(
    'INSERT INTO telegram_alerts (type, message) VALUES (?, ?)'
  ).run(type, message)
}

function markAlertSent(id) {
  getDB().prepare('UPDATE telegram_alerts SET sent = 1 WHERE id = ?').run(id)
}

module.exports = {
  initDB, getDB,
  saveCallAttempt, getCallAttempts, getAttemptCount, getLastAttempt,
  updateNextCallTime, updateAiScore, markWaSent,
  getPendingRetries, getLeadsExceededAttempts, getAllCallAttempts,
  saveSettings, getSetting, getSettings, saveAllSettings,
  getManagerStats, updateManagerStats, getAllManagerStats,
  scheduleWa, getPendingWa, markWaScheduledSent,
  saveAiAnalysis, getAiAnalyses,
  saveAlert, markAlertSent
}
