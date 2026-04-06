let bitrix = null
let db = null
let queueCache = []
let lastRefresh = null
const CACHE_TTL = 60_000

function configure(bitrixClient, dbClient) {
  bitrix = bitrixClient
  db = dbClient
}

function getCrmType() {
  const settings = db?.getSettings() || {}
  return settings.CRM_TYPE || 'deal' // 'deal' | 'lead'
}

function calcPriority(entity, attemptCount, lastAttempt) {
  const now = new Date()
  const createdAt = new Date(entity.DATE_CREATE)
  const ageMinutes = (now - createdAt) / 60000
  const yesterday = new Date(now - 86400000).toDateString()

  if (ageMinutes < 30 && attemptCount === 0) return 100
  if (createdAt.toDateString() === now.toDateString() && attemptCount < 3) return 60

  if (lastAttempt) {
    const lastDate = new Date(lastAttempt.called_at).toDateString()
    const noAnswers = ['no_answer', 'busy', 'unavailable', 'rejected', 'rejected_call']
    if (lastDate === yesterday && noAnswers.includes(lastAttempt.result)) return 50
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

function getPhone(entity) {
  if (!entity.PHONE) return null
  if (Array.isArray(entity.PHONE)) return entity.PHONE[0]?.VALUE || null
  return entity.PHONE
}

function getName(entity) {
  const parts = [entity.NAME, entity.LAST_NAME].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  return entity.TITLE || `#${entity.ID}`
}

async function buildQueue() {
  if (!bitrix || !db) throw new Error('Queue not configured')

  const crmType = getCrmType()
  const settings = db.getSettings()
  const userId = settings.BITRIX_USER_ID

  const items = []

  // ── Source 1: New deals/leads from Bitrix24 ───────────────────
  try {
    let entities = []
    if (crmType === 'deal') {
      entities = await bitrix.getNewDeals(userId) || []
    } else {
      entities = await bitrix.getNewLeads(userId) || []
    }

    for (const entity of entities) {
      const id = String(entity.ID)
      const attemptCount = db.getAttemptCount(id)
      if (attemptCount >= 6) continue

      const lastAttempt = db.getLastAttempt(id)
      if (lastAttempt?.next_call_at && new Date(lastAttempt.next_call_at) > new Date()) continue

      // Get phone — for deals may need to fetch from contact
      let phone = getPhone(entity)
      let name = getName(entity)

      if (crmType === 'deal' && !phone && entity.CONTACT_ID) {
        try {
          phone = await bitrix.getDealPhone(entity)
          name = await bitrix.getDealName(entity)
        } catch {}
      }

      items.push({
        type: crmType,
        id,
        entityType: crmType,
        priority: calcPriority(entity, attemptCount, lastAttempt),
        data: entity,
        attemptCount,
        lastAttempt,
        phone,
        name,
        source: entity.SOURCE_ID || 'unknown',
        comments: entity.COMMENTS || '',
        stageId: entity.STAGE_ID || entity.STATUS_ID || ''
      })
    }
  } catch (err) {
    console.error(`[Queue] ${crmType} fetch error:`, err.message)
  }

  // ── Source 2: Tasks with arrived deadline ─────────────────────
  try {
    if (userId) {
      const result = await bitrix.getOverdueTasks(userId)
      const tasks = result?.tasks || result || []
      if (Array.isArray(tasks)) {
        for (const task of tasks) {
          const crmRefs = task.UF_CRM_TASK || []
          // Support both deal (D_) and lead (L_) references
          const ref = crmRefs.find(r => r?.startsWith?.('D_') || r?.startsWith?.('L_'))
          if (!ref) continue
          const entityId = ref.replace(/^[DL]_/, '')
          if (items.find(i => i.id === entityId)) continue

          items.push({
            type: 'task',
            id: entityId,
            entityType: ref.startsWith('D_') ? 'deal' : 'lead',
            taskId: task.ID,
            priority: calcTaskPriority(task),
            data: { ID: entityId, TITLE: task.TITLE, DATE_CREATE: task.CREATED_DATE },
            attemptCount: db.getAttemptCount(entityId),
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

  // ── Source 3: Pending retries from SQLite ─────────────────────
  try {
    const retries = db.getPendingRetries()
    for (const retry of retries) {
      if (items.find(i => i.id === retry.lead_id)) continue
      items.push({
        type: 'retry',
        id: retry.lead_id,
        entityType: crmType,
        priority: 50,
        data: { ID: retry.lead_id, TITLE: retry.lead_name || `#${retry.lead_id}` },
        attemptCount: retry.attempt_num,
        phone: retry.lead_phone,
        name: retry.lead_name || `#${retry.lead_id}`,
        source: 'retry',
        comments: ''
      })
    }
  } catch (err) {
    console.error('[Queue] Retries error:', err.message)
  }

  items.sort((a, b) => b.priority - a.priority)
  queueCache = items
  lastRefresh = Date.now()
  console.log(`[Queue] Built: ${items.length} items (${crmType} mode)`)
  return items
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

// Get next N leads for predictive mode
async function getNextBatch(count = 5) {
  const queue = await getQueue(true)
  return queue.slice(0, count)
}

function removeFromQueue(entityId) {
  queueCache = queueCache.filter(l => l.id !== String(entityId))
}

module.exports = {
  configure, buildQueue, getQueue, getNextLead, getNextBatch,
  removeFromQueue, getQueueStats, getCrmType
}
