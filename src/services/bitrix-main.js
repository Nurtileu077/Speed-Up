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

// ─── Leads ────────────────────────────────────────────────────

async function getLeads(filter = {}) {
  return call('crm.lead.list', {
    filter,
    select: [
      'ID', 'TITLE', 'NAME', 'LAST_NAME', 'PHONE', 'EMAIL',
      'SOURCE_ID', 'STATUS_ID', 'ASSIGNED_BY_ID',
      'DATE_CREATE', 'DATE_MODIFY', 'COMMENTS',
      'UF_*'
    ],
    order: { DATE_CREATE: 'DESC' },
    start: 0
  })
}

async function getNewLeads() {
  return getLeads({ STATUS_ID: 'NEW' })
}

async function getLead(leadId) {
  return call('crm.lead.get', { id: leadId })
}

async function updateLead(leadId, fields) {
  return call('crm.lead.update', { id: leadId, fields })
}

async function getLeadActivities(leadId) {
  return call('crm.activity.list', {
    filter: { ENTITY_TYPE_ID: 1, ENTITY_ID: leadId },
    order: { CREATED: 'DESC' }
  })
}

// ─── Tasks ────────────────────────────────────────────────────

async function getTasks(userId, filter = {}) {
  return call('tasks.task.list', {
    filter: {
      RESPONSIBLE_ID: userId,
      STATUS: [2, 3],
      ...filter
    },
    select: ['ID', 'TITLE', 'DEADLINE', 'DESCRIPTION', 'STATUS', 'UF_CRM_TASK', 'CREATED_DATE'],
    order: { DEADLINE: 'ASC' }
  })
}

async function getOverdueTasks(userId) {
  const now = new Date().toISOString()
  return call('tasks.task.list', {
    filter: {
      RESPONSIBLE_ID: userId,
      '<=DEADLINE': now,
      STATUS: [2, 3]
    },
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

async function completeTask(taskId) {
  return call('tasks.task.complete', { taskId })
}

// ─── Telephony ────────────────────────────────────────────────

async function initiateCall(leadId, phone, userId, callerId) {
  return call('telephony.externalcall.register', {
    USER_ID: userId || '1',
    PHONE_NUMBER: phone,
    CALL_START_DATE: new Date().toISOString(),
    CRM_CREATE: 'N',
    CRM_ENTITY_TYPE: 'LEAD',
    CRM_ENTITY_ID: leadId,
    SHOW: 'Y',
    LINE_NUMBER: callerId || '',
    TYPE: 1 // outgoing
  })
}

async function finishCall(callId, status, duration) {
  const statusMap = {
    connected: 200,
    no_answer: 304,
    busy: 486,
    unavailable: 480,
    rejected: 603,
    rejected_call: 603
  }

  return call('telephony.externalcall.finish', {
    CALL_ID: callId,
    DURATION: duration || 0,
    STATUS_CODE: statusMap[status] || 304
  })
}

async function getCallRecording(callId) {
  const stats = await call('voximplant.statistic.get', {
    filter: { CALL_ID: callId },
    SORT: 'CALL_START_DATE',
    ORDER: 'DESC'
  })
  if (Array.isArray(stats) && stats.length > 0) {
    return stats[0].RECORD_URL || null
  }
  return null
}

// ─── Timeline ─────────────────────────────────────────────────

async function addTimelineComment(leadId, text) {
  return call('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID: leadId,
      ENTITY_TYPE: 'lead',
      COMMENT: text
    }
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

function getPortalUrl() {
  return portalUrl
}

module.exports = {
  configure, call,
  getLeads, getNewLeads, getLead, updateLead, getLeadActivities,
  getTasks, getOverdueTasks, createTask, updateTask, completeTask,
  initiateCall, finishCall, getCallRecording,
  addTimelineComment,
  testConnection, getCurrentUser, getPortalUrl
}
