const bitrix = require('./bitrix')
const db = require('./db')

/**
 * Priority scoring algorithm:
 * +100 — New lead created < 30 min ago
 * +90  — Task overdue > 1 hour
 * +80  — Task active, call time arrived
 * +75  — Client replied in WhatsApp
 * +60  — Lead created today, < 3 attempts
 * +50  — Yesterday no answer, today first attempt
 * +30  — Regular working leads
 * +10  — Cold leads without activity
 */

let queueCache = []
let lastRefresh = null
const CACHE_TTL_MS = 60 * 1000 // 1 minute

function calcLeadPriority(lead, attemptCount, lastAttempt) {
  const now = new Date()
  const createdAt = new Date(lead.DATE_CREATE)
  const ageMinutes = (now - createdAt) / 60000
  const ageHours = ageMinutes / 60
  const today = new Date().toDateString()
  const yesterday = new Date(now - 86400000).toDateString()

  // New hot lead (< 30 min)
  if (ageMinutes < 30 && attemptCount === 0) return 100

  // Lead created today, fewer than 3 attempts
  if (createdAt.toDateString() === today && attemptCount < 3) return 60

  // Yesterday no answer, today first attempt of the day
  if (lastAttempt) {
    const lastDate = new Date(lastAttempt.called_at).toDateString()
    if (lastDate === yesterday && ['no_answer', 'busy', 'unavailable', 'rejected'].includes(lastAttempt.result)) {
      return 50
    }
  }

  // Regular working lead
  if (attemptCount > 0 && attemptCount < 6) return 30

  // Cold lead
  return 10
}

function calcTaskPriority(task) {
  const now = new Date()
  const deadline = new Date(task.DEADLINE)
  const overdueHours = (now - deadline) / 3600000

  if (overdueHours > 1) return 90   // Overdue > 1h
  if (overdueHours >= 0) return 80  // Deadline arrived
  return 30
}

async function buildQueue() {
  const leads = []

  // Source 1: New leads from Bitrix24
  try {
    const newLeads = await bitrix.getNewLeads()
    if (Array.isArray(newLeads)) {
      for (const lead of newLeads) {
        const attemptCount = db.getAttemptCount(lead.ID)
        const lastAttempt = db.getLastAttempt(lead.ID)

        // Skip if next call time hasn't arrived yet
        if (lastAttempt?.next_call_at && new Date(lastAttempt.next_call_at) > new Date()) {
          continue
        }

        const priority = calcLeadPriority(lead, attemptCount, lastAttempt)
        leads.push({
          type: 'lead',
          id: lead.ID,
          priority,
          data: lead,
          attemptCount,
          lastAttempt,
          phone: getLeadPhone(lead),
          name: getLeadName(lead),
          source: lead.SOURCE_ID || 'unknown'
        })
      }
    }
  } catch (err) {
    console.error('[Queue] Failed to fetch new leads:', err.message)
  }

  // Source 2: Tasks with arrived deadline
  try {
    const settings = db.getAllSettings()
    const userId = settings.BITRIX_USER_ID
    if (userId) {
      const tasks = await bitrix.getTasks(userId)
      if (Array.isArray(tasks)) {
        for (const task of tasks) {
          const crmEntityId = task.UF_CRM_TASK?.[0]?.replace('L_', '')
          if (!crmEntityId) continue

          // Don't duplicate if lead is already in queue
          if (leads.find(l => l.id === crmEntityId)) continue

          const priority = calcTaskPriority(task)
          leads.push({
            type: 'task',
            id: crmEntityId,
            taskId: task.ID,
            priority,
            data: { ID: crmEntityId, TITLE: task.TITLE },
            attemptCount: db.getAttemptCount(crmEntityId),
            lastAttempt: db.getLastAttempt(crmEntityId),
            phone: null, // Will be fetched when needed
            name: task.TITLE,
            source: 'task'
          })
        }
      }
    }
  } catch (err) {
    console.error('[Queue] Failed to fetch tasks:', err.message)
  }

  // Source 3: Missed calls from SQLite needing retry
  try {
    const pendingRetries = db.getPendingRetries()
    for (const retry of pendingRetries) {
      // Don't duplicate
      if (leads.find(l => l.id === retry.lead_id)) continue

      leads.push({
        type: 'retry',
        id: retry.lead_id,
        priority: 50,
        data: { ID: retry.lead_id },
        attemptCount: retry.attempt_num,
        lastAttempt: retry,
        phone: null,
        name: `Лид #${retry.lead_id}`,
        source: 'retry'
      })
    }
  } catch (err) {
    console.error('[Queue] Failed to fetch pending retries:', err.message)
  }

  // Sort by priority descending
  leads.sort((a, b) => b.priority - a.priority)

  queueCache = leads
  lastRefresh = Date.now()

  return leads
}

async function getQueueStats() {
  const queue = await getQueue()
  const overdue = queue.filter(l => l.type === 'task' && l.priority >= 90)

  return {
    total: queue.length,
    overdue: overdue.length,
    hot: queue.filter(l => l.priority >= 100).length,
    regular: queue.filter(l => l.priority < 100 && l.priority >= 30).length
  }
}

async function getQueue(forceRefresh = false) {
  const cacheExpired = !lastRefresh || (Date.now() - lastRefresh) > CACHE_TTL_MS
  if (forceRefresh || cacheExpired || queueCache.length === 0) {
    return buildQueue()
  }
  return queueCache
}

async function getNextLead() {
  const queue = await getQueue()
  return queue.length > 0 ? queue[0] : null
}

function removeFromQueue(leadId) {
  queueCache = queueCache.filter(l => l.id !== String(leadId))
}

function getLeadPhone(lead) {
  if (!lead.PHONE) return null
  if (Array.isArray(lead.PHONE)) {
    return lead.PHONE[0]?.VALUE || null
  }
  return lead.PHONE
}

function getLeadName(lead) {
  const parts = [lead.NAME, lead.LAST_NAME].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : lead.TITLE || `Лид #${lead.ID}`
}

module.exports = {
  buildQueue,
  getQueue,
  getNextLead,
  removeFromQueue,
  getQueueStats
}
