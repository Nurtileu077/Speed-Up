const axios = require('axios')

let webhookUrl = process.env.BITRIX_WEBHOOK || ''

function setWebhook(url) {
  webhookUrl = url
}

async function call(method, params = {}) {
  if (!webhookUrl) throw new Error('Bitrix24 webhook URL not configured')

  const url = `${webhookUrl.replace(/\/$/, '')}/${method}`
  const response = await axios.post(url, params, { timeout: 15000 })

  if (response.data?.error) {
    throw new Error(`Bitrix24 error: ${response.data.error} — ${response.data.error_description || ''}`)
  }

  return response.data?.result
}

// ---- Leads ----

async function getLeads(filter = {}) {
  return call('crm.lead.list', {
    filter,
    select: ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'PHONE', 'SOURCE_ID', 'STATUS_ID',
             'ASSIGNED_BY_ID', 'DATE_CREATE', 'UF_CRM_*', 'COMMENTS'],
    order: { DATE_CREATE: 'DESC' }
  })
}

async function getNewLeads() {
  return getLeads({ STATUS_ID: 'NEW' })
}

async function updateLead(leadId, data) {
  return call('crm.lead.update', { id: leadId, fields: data })
}

async function getLeadActivities(leadId) {
  return call('crm.activity.list', {
    filter: { ENTITY_TYPE_ID: 1, ENTITY_ID: leadId },
    order: { CREATED: 'DESC' }
  })
}

// ---- Tasks ----

async function getTasks(userId, filter = {}) {
  const now = new Date().toISOString()
  return call('tasks.task.list', {
    filter: {
      RESPONSIBLE_ID: userId,
      '<=DEADLINE': now,
      STATUS: [2, 3], // In progress, waiting
      ...filter
    },
    select: ['ID', 'TITLE', 'DEADLINE', 'DESCRIPTION', 'STATUS', 'UF_CRM_TASK'],
    order: { DEADLINE: 'ASC' }
  })
}

async function createTask(data) {
  return call('tasks.task.add', { fields: data })
}

async function updateTask(taskId, data) {
  return call('tasks.task.update', { taskId, fields: data })
}

// ---- Telephony ----

async function initiateCall(leadId, phone, userId, callerId = '') {
  return call('telephony.externalcall.register', {
    USER_ID: userId,
    PHONE_NUMBER: phone,
    CALL_START_DATE: new Date().toISOString(),
    CRM_CREATE: 'N',
    CRM_ENTITY_TYPE: 'LEAD',
    CRM_ENTITY_ID: leadId,
    SHOW: 'Y',
    LINE_NUMBER: callerId
  })
}

async function finishCall(callId, status, duration) {
  // status: 200=answered, 304=busy, 603=declined, 480=unavailable
  const statusMap = {
    connected: 200,
    no_answer: 304,
    busy: 486,
    unavailable: 480,
    rejected: 603
  }

  return call('telephony.externalcall.finish', {
    CALL_ID: callId,
    USER_ID: null,
    DURATION: duration || 0,
    STATUS_CODE: statusMap[status] || 304
  })
}

async function getCallRecording(callId) {
  return call('voximplant.statistic.get', {
    filter: { CALL_ID: callId }
  })
}

// ---- Timeline ----

async function addTimelineComment(leadId, text) {
  return call('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID: leadId,
      ENTITY_TYPE: 'lead',
      COMMENT: text
    }
  })
}

// ---- Utils ----

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

module.exports = {
  setWebhook,
  call,
  getLeads,
  getNewLeads,
  updateLead,
  getLeadActivities,
  getTasks,
  createTask,
  updateTask,
  initiateCall,
  finishCall,
  getCallRecording,
  addTimelineComment,
  testConnection,
  getCurrentUser
}
