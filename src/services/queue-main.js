let bitrix = null
let db = null
let queueCache = []
let lastRefresh = null
const CACHE_TTL = 60_000

function configure(bitrixClient, dbClient) {
  bitrix = bitrixClient
  db = dbClient
}

function calcLeadPriority(lead, attemptCount, lastAttempt) {
  const now = new Date()
  const createdAt = new Date(lead.DATE_CREATE)
  const ageMinutes = (now - createdAt) / 60000
  const today = now.toDateString()
  const yesterday = new Date(now - 86400000).toDateString()

  if (ageMinutes < 30 && attemptCount === 0) return 100
  if (createdAt.toDateString() === today && attemptCount < 3) return 60

  if (lastAttempt) {
    const lastDate = new Date(lastAttempt.called_at).toDateString()
    const noAnswerResults = ['no_answer', 'busy', 'unavailable', 'rejected', 'rejected_call']
    if (lastDate === yesterday && noAnswerResults.includes(lastAttempt.result)) return 50
  }

  if (attemptCount > 0 && attemptCount < 6) return 30
  return 10
}

function calcTaskPriority(task) {
  const now = new Date()
  const deadline = new Date(task.DEADLINE)
  const overdueHours = (now - deadline) / 3600000
  if (overdueHours > 1) return 90
  if (overdueHours >= 0) return 80
  return 30
}

function getLeadPhone(lead) {
  if (!lead.PHONE) return null
  if (Array.isArray(lead.PHONE)) return lead.PHONE[0]?.VALUE || null
  return lead.PHONE
}

function getLeadName(lead) {
  const parts = [lead.NAME, lead.LAST_NAME].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : lead.TITLE || `Лид #${lead.ID}`
}

async function buildQueue() {
  if (!bitrix || !db) throw new Error('Queue not configured')

  const leads = []

  // Source 1: New leads from Bitrix24 funnels
  try {
    const newLeads = await bitrix.getNewLeads()
    if (Array.isArray(newLeads)) {
      for (const lead of newLeads) {
        const attemptCount = db.getAttemptCount(lead.ID)
        if (attemptCount >= 6) continue

        const lastAttempt = db.getLastAttempt(lead.ID)
        if (lastAttempt?.next_call_at && new Date(lastAttempt.next_call_at) > new Date()) continue

        leads.push({
          type: 'lead',
          id: String(lead.ID),
          priority: calcLeadPriority(lead, attemptCount, lastAttempt),
          data: lead,
          attemptCount,
          lastAttempt,
          phone: getLeadPhone(lead),
          name: getLeadName(lead),
          source: lead.SOURCE_ID || 'unknown',
          comments: lead.COMMENTS || ''
        })
      }
    }
  } catch (err) {
    console.error('[Queue] New leads error:', err.message)
  }

  // Source 2: Tasks with arrived deadline
  try {
    const settings = db.getSettings()
    const userId = settings.BITRIX_USER_ID
    if (userId) {
      const result = await bitrix.getOverdueTasks(userId)
      const tasks = result?.tasks || result || []
      if (Array.isArray(tasks)) {
        for (const task of tasks) {
          const crmRefs = task.UF_CRM_TASK || []
          const leadRef = crmRefs.find(r => r?.startsWith?.('L_'))
          if (!leadRef) continue
          const leadId = leadRef.replace('L_', '')
          if (leads.find(l => l.id === leadId)) continue

          leads.push({
            type: 'task',
            id: leadId,
            taskId: task.ID,
            priority: calcTaskPriority(task),
            data: { ID: leadId, TITLE: task.TITLE, DATE_CREATE: task.CREATED_DATE },
            attemptCount: db.getAttemptCount(leadId),
            phone: null,
            name: task.TITLE,
            source: 'task',
            comments: task.DESCRIPTION || ''
          })
        }
      }
    }
  } catch (err) {
    console.error('[Queue] Tasks error:', err.message)
  }

  // Source 3: Missed calls from SQLite needing retry
  try {
    const retries = db.getPendingRetries()
    for (const retry of retries) {
      if (leads.find(l => l.id === retry.lead_id)) continue

      leads.push({
        type: 'retry',
        id: retry.lead_id,
        priority: 50,
        data: {
          ID: retry.lead_id,
          TITLE: retry.lead_name || `Лид #${retry.lead_id}`,
          PHONE: retry.lead_phone
        },
        attemptCount: retry.attempt_num,
        phone: retry.lead_phone,
        name: retry.lead_name || `Лид #${retry.lead_id}`,
        source: 'retry',
        comments: ''
      })
    }
  } catch (err) {
    console.error('[Queue] Retries error:', err.message)
  }

  leads.sort((a, b) => b.priority - a.priority)
  queueCache = leads
  lastRefresh = Date.now()
  return leads
}

async function getQueueStats() {
  const queue = await getQueue()
  return {
    total: queue.length,
    overdue: queue.filter(l => l.priority >= 90).length,
    hot: queue.filter(l => l.priority >= 100).length,
    regular: queue.filter(l => l.priority >= 30 && l.priority < 90).length,
    cold: queue.filter(l => l.priority < 30).length
  }
}

async function getQueue(forceRefresh = false) {
  const expired = !lastRefresh || (Date.now() - lastRefresh) > CACHE_TTL
  if (forceRefresh || expired || queueCache.length === 0) {
    return buildQueue()
  }
  return queueCache
}

async function getNextLead() {
  const queue = await getQueue(true)
  return queue.length > 0 ? queue[0] : null
}

function removeFromQueue(leadId) {
  queueCache = queueCache.filter(l => l.id !== String(leadId))
}

module.exports = {
  configure, buildQueue, getQueue, getNextLead, removeFromQueue, getQueueStats
}
