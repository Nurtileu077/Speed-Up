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

/**
 * Get call recording URL.
 * For SIP/Beeline connector — the recording URL comes directly in the webhook body (RECORD_URL).
 * Fallback: search crm.activity.list for a call activity with the matching call ID.
 */
async function getCallRecording(callId) {
  // Try to find the recording via CRM activity
  // The call activity has RECORD_URL field when recording is available
  try {
    const activities = await call('crm.activity.list', {
      filter: {
        TYPE_ID: 2,          // 2 = Phone call
        SETTINGS: { CALL_ID: callId }
      },
      select: ['ID', 'SETTINGS', 'SUBJECT']
    })

    if (Array.isArray(activities) && activities.length > 0) {
      const settings = activities[0].SETTINGS
      if (settings?.RECORD_URL) return settings.RECORD_URL
      if (settings?.record_url) return settings.record_url
    }
  } catch (err) {
    console.warn('[Bitrix] getCallRecording via activity failed:', err.message)
  }

  return null // Recording URL comes from webhook body (RECORD_URL field)
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
