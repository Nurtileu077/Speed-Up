const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')

let db = null

function getDbPath() {
  try {
    const userDataPath = app ? app.getPath('userData') : path.join(process.cwd(), 'data')
    return path.join(userDataPath, 'nobilis-dialer.db')
  } catch {
    return path.join(process.cwd(), 'nobilis-dialer.db')
  }
}

function initDB() {
  if (db) return db

  const dbPath = getDbPath()
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
      ai_summary   TEXT
    );

    CREATE TABLE IF NOT EXISTS manager_sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      manager_id   TEXT NOT NULL,
      date         DATE NOT NULL,
      total_calls  INTEGER DEFAULT 0,
      connected    INTEGER DEFAULT 0,
      talk_minutes REAL DEFAULT 0,
      avg_ai_score REAL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  return db
}

function getDB() {
  if (!db) initDB()
  return db
}

// ---- Call Attempts ----

function saveCallAttempt(data) {
  const database = getDB()
  const stmt = database.prepare(`
    INSERT INTO call_attempts
      (lead_id, manager_id, attempt_num, called_at, duration_sec, result, next_call_at, wa_sent)
    VALUES
      (@lead_id, @manager_id, @attempt_num, @called_at, @duration_sec, @result, @next_call_at, @wa_sent)
  `)
  const result = stmt.run({
    lead_id: data.lead_id,
    manager_id: data.manager_id,
    attempt_num: data.attempt_num,
    called_at: data.called_at || new Date().toISOString(),
    duration_sec: data.duration_sec || 0,
    result: data.result,
    next_call_at: data.next_call_at || null,
    wa_sent: data.wa_sent ? 1 : 0
  })
  return result.lastInsertRowid
}

function getCallAttempts(leadId) {
  const database = getDB()
  return database.prepare(
    'SELECT * FROM call_attempts WHERE lead_id = ? ORDER BY called_at DESC'
  ).all(leadId)
}

function getAttemptCount(leadId) {
  const database = getDB()
  const row = database.prepare(
    'SELECT COUNT(*) as count FROM call_attempts WHERE lead_id = ?'
  ).get(leadId)
  return row ? row.count : 0
}

function getLastAttempt(leadId) {
  const database = getDB()
  return database.prepare(
    'SELECT * FROM call_attempts WHERE lead_id = ? ORDER BY called_at DESC LIMIT 1'
  ).get(leadId)
}

function updateNextCallTime(id, nextCallAt) {
  const database = getDB()
  database.prepare(
    'UPDATE call_attempts SET next_call_at = ? WHERE id = ?'
  ).run(nextCallAt, id)
}

function updateAiScore(id, aiScore, aiSummary) {
  const database = getDB()
  database.prepare(
    'UPDATE call_attempts SET ai_score = ?, ai_summary = ? WHERE id = ?'
  ).run(aiScore, aiSummary, id)
}

function markWaSent(leadId) {
  const database = getDB()
  database.prepare(
    'UPDATE call_attempts SET wa_sent = 1 WHERE lead_id = ? AND id = (SELECT MAX(id) FROM call_attempts WHERE lead_id = ?)'
  ).run(leadId, leadId)
}

function getPendingRetries() {
  const database = getDB()
  const now = new Date().toISOString()
  return database.prepare(`
    SELECT ca.* FROM call_attempts ca
    INNER JOIN (
      SELECT lead_id, MAX(id) as max_id FROM call_attempts GROUP BY lead_id
    ) latest ON ca.id = latest.max_id
    WHERE ca.result IN ('no_answer', 'busy', 'unavailable', 'rejected')
      AND ca.attempt_num < 6
      AND ca.next_call_at <= ?
      AND ca.next_call_at IS NOT NULL
  `).all(now)
}

function getAllCallAttempts(filters = {}) {
  const database = getDB()
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

  query += ' ORDER BY called_at DESC'
  if (filters.limit) {
    query += ` LIMIT ${parseInt(filters.limit)}`
  }

  return database.prepare(query).all(...params)
}

// ---- Settings ----

function saveSettings(key, value) {
  const database = getDB()
  database.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).run(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
}

function getSetting(key) {
  const database = getDB()
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : null
}

function getAllSettings() {
  const database = getDB()
  const rows = database.prepare('SELECT key, value FROM settings').all()
  const result = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}

function saveAllSettings(data) {
  const database = getDB()
  const upsert = database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const upsertMany = database.transaction((settings) => {
    for (const [key, value] of Object.entries(settings)) {
      upsert.run(key, String(value))
    }
  })
  upsertMany(data)
}

// ---- Manager Stats ----

function getManagerStats(managerId, date) {
  const database = getDB()
  return database.prepare(
    'SELECT * FROM manager_sessions WHERE manager_id = ? AND date = ?'
  ).get(managerId, date)
}

function updateManagerStats(managerId, date, data) {
  const database = getDB()
  const existing = getManagerStats(managerId, date)

  if (existing) {
    database.prepare(`
      UPDATE manager_sessions SET
        total_calls = total_calls + ?,
        connected = connected + ?,
        talk_minutes = talk_minutes + ?,
        avg_ai_score = ?
      WHERE manager_id = ? AND date = ?
    `).run(
      data.total_calls || 0,
      data.connected || 0,
      data.talk_minutes || 0,
      data.avg_ai_score || null,
      managerId,
      date
    )
  } else {
    database.prepare(`
      INSERT INTO manager_sessions (manager_id, date, total_calls, connected, talk_minutes, avg_ai_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      managerId, date,
      data.total_calls || 0,
      data.connected || 0,
      data.talk_minutes || 0,
      data.avg_ai_score || null
    )
  }
}

function getAllManagerStats(filters = {}) {
  const database = getDB()
  let query = 'SELECT * FROM manager_sessions WHERE 1=1'
  const params = []

  if (filters.managerId) {
    query += ' AND manager_id = ?'
    params.push(filters.managerId)
  }
  if (filters.dateFrom) {
    query += ' AND date >= ?'
    params.push(filters.dateFrom)
  }
  if (filters.dateTo) {
    query += ' AND date <= ?'
    params.push(filters.dateTo)
  }

  query += ' ORDER BY date DESC'
  return database.prepare(query).all(...params)
}

module.exports = {
  initDB,
  getDB,
  saveCallAttempt,
  getCallAttempts,
  getAttemptCount,
  getLastAttempt,
  updateNextCallTime,
  updateAiScore,
  markWaSent,
  getPendingRetries,
  getAllCallAttempts,
  saveSettings,
  getSetting,
  getAllSettings,
  saveAllSettings,
  getManagerStats,
  updateManagerStats,
  getAllManagerStats
}
