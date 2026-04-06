const axios = require('axios')

let webhookUrl = ''
let portalUrl = ''

function configure(settings) {
  if (settings.BITRIX_WEBHOOK) webhookUrl = settings.BITRIX_WEBHOOK.replace(/\/$/, '')
  if (settings.BITRIX_PORTAL) portalUrl = settings.BITRIX_PORTAL.replace(/\/$/, '')
}

async function call(method, params = {}) {
  if (!webhookUrl) throw new Error('Bitrix24 webhook URL not configured. Go to Settings.')
  const url = `${webhookUrl}/${method}`
  const response = await axios.post(url, params, { timeout: 15000 })
  if (response.data?.error) {
    throw new Error(`Bitrix24: ${response.data.error} — ${response.data.error_description || ''}`)
  }
  return response.data?.result
}

// ─── Deals (Сделки) ───────────────────────────────────────────

async function getDeals(filter = {}) {
  return call('crm.deal.list', {
    filter: { '!STAGE_ID': ['WON', 'LOSE'], ...filter },
    select: [
      'ID', 'TITLE', 'CONTACT_ID', 'COMPANY_ID',
      'SOURCE_ID', 'STAGE_ID', 'ASSIGNED_BY_ID',
      'DATE_CREATE', 'DATE_MODIFY', 'COMMENTS',
      'OPPORTUNITY', 'CURRENCY_ID',
      'UF_*'
    ],
    order: { DATE_CREATE: 'DESC' },
    start: 0
  })
}

async function getNewDeals(assignedUserId) {
  const filter = { '!STAGE_ID': ['WON', 'LOSE'] }
  if (assignedUserId) filter.ASSIGNED_BY_ID = assignedUserId
  return getDeals(filter)
}

async function getDeal(dealId) {
  return call('crm.deal.get', { id: dealId })
}

async function updateDeal(dealId, fields) {
  return call('crm.deal.update', { id: dealId, fields })
}

async function getDealContact(contactId) {
  if (!contactId) return null
  try {
    return await call('crm.contact.get', { id: contactId })
  } catch { return null }
}

async function getDealPhone(deal) {
  // Try direct phone on deal first (custom fields)
  if (deal.PHONE) {
    if (Array.isArray(deal.PHONE)) return deal.PHONE[0]?.VALUE || null
    return deal.PHONE
  }
  // Fetch from linked contact
  if (deal.CONTACT_ID) {
    const contact = await getDealContact(deal.CONTACT_ID)
    if (contact?.PHONE) {
      if (Array.isArray(contact.PHONE)) return contact.PHONE[0]?.VALUE || null
      return contact.PHONE
    }
  }
  return null
}

async function getDealName(deal) {
  if (deal.CONTACT_ID) {
    try {
      const contact = await getDealContact(deal.CONTACT_ID)
      if (contact) {
        const parts = [contact.NAME, contact.LAST_NAME].filter(Boolean)
        if (parts.length > 0) return parts.join(' ')
      }
    } catch {}
  }
  return deal.TITLE || `Сделка #${deal.ID}`
}

// ─── Leads (Лиды) — kept for backward compat ──────────────────

async function getLeads(filter = {}) {
  return call('crm.lead.list', {
    filter,
    select: ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'PHONE', 'SOURCE_ID', 'STATUS_ID', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'DATE_MODIFY', 'COMMENTS', 'UF_*'],
    order: { DATE_CREATE: 'DESC' },
    start: 0
  })
}

async function getNewLeads(assignedUserId) {
  const filter = { STATUS_ID: 'NEW' }
  if (assignedUserId) filter.ASSIGNED_BY_ID = assignedUserId
  return getLeads(filter)
}

async function getLead(leadId) {
  return call('crm.lead.get', { id: leadId })
}

async function updateLead(leadId, fields) {
  return call('crm.lead.update', { id: leadId, fields })
}

// ─── Universal update (auto-detect lead vs deal) ──────────────

async function updateEntity(entityId, fields, entityType = 'deal') {
  if (entityType === 'lead') return updateLead(entityId, fields)
  return updateDeal(entityId, fields)
}

// ─── Tasks ────────────────────────────────────────────────────

async function getTasks(userId, filter = {}) {
  return call('tasks.task.list', {
    filter: { RESPONSIBLE_ID: userId, STATUS: [2, 3], ...filter },
    select: ['ID', 'TITLE', 'DEADLINE', 'DESCRIPTION', 'STATUS', 'UF_CRM_TASK', 'CREATED_DATE'],
    order: { DEADLINE: 'ASC' }
  })
}

async function getOverdueTasks(userId) {
  return call('tasks.task.list', {
    filter: { RESPONSIBLE_ID: userId, '<=DEADLINE': new Date().toISOString(), STATUS: [2, 3] },
    select: ['ID', 'TITLE', 'DEADLINE', 'UF_CRM_TASK'],
    order: { DEADLINE: 'ASC' }
  })
}

async function createTask(data) {
  return call('tasks.task.add', { fields: data })
}

async function updateTask(taskId, data) {
  return call('tasks.task.update', { taskId, fields: data })
}

// ─── Telephony ────────────────────────────────────────────────

async function initiateCall(entityId, phone, userId, entityType = 'deal') {
  return call('telephony.externalcall.register', {
    USER_ID: userId || '1',
    PHONE_NUMBER: phone,
    CALL_START_DATE: new Date().toISOString(),
    CRM_CREATE: 'N',
    CRM_ENTITY_TYPE: entityType.toUpperCase(),
    CRM_ENTITY_ID: entityId,
    SHOW: 'Y',
    TYPE: 1
  })
}

async function finishCall(callId, status, duration) {
  const statusMap = {
    connected: 200, no_answer: 304, busy: 486,
    unavailable: 480, rejected: 603, rejected_call: 603
  }
  return call('telephony.externalcall.finish', {
    CALL_ID: callId,
    DURATION: duration || 0,
    STATUS_CODE: statusMap[status] || 304
  })
}

async function getCallRecording(callId) {
  try {
    const activities = await call('crm.activity.list', {
      filter: { TYPE_ID: 2, SETTINGS: { CALL_ID: callId } },
      select: ['ID', 'SETTINGS']
    })
    if (Array.isArray(activities) && activities.length > 0) {
      return activities[0].SETTINGS?.RECORD_URL || null
    }
  } catch {}
  return null
}

// ─── Timeline Comments ────────────────────────────────────────

async function addTimelineComment(entityId, text, entityType = 'deal') {
  return call('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID: entityId,
      ENTITY_TYPE: entityType, // 'deal' or 'lead'
      COMMENT: text
    }
  })
}

async function getLeadActivities(entityId, entityTypeId = 2) {
  // entityTypeId: 1=lead, 2=deal
  return call('crm.activity.list', {
    filter: { ENTITY_TYPE_ID: entityTypeId, ENTITY_ID: entityId },
    order: { CREATED: 'DESC' }
  })
}

// ─── Utils ────────────────────────────────────────────────────

async function testConnection() {
  try {
    const result = await call('profile')
    return { success: true, user: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

async function getCurrentUser() {
  return call('profile')
}

function getPortalUrl() { return portalUrl }

module.exports = {
  configure, call,
  getDeals, getNewDeals, getDeal, updateDeal, getDealPhone, getDealName, getDealContact,
  getLeads, getNewLeads, getLead, updateLead,
  updateEntity,
  getTasks, getOverdueTasks, createTask, updateTask,
  initiateCall, finishCall, getCallRecording,
  addTimelineComment, getLeadActivities,
  testConnection, getCurrentUser, getPortalUrl
}
