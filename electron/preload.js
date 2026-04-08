const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Bitrix24 API
  bitrix: {
    getLeads: (filter) => ipcRenderer.invoke('bitrix:getLeads', filter),
    getTasks: (userId) => ipcRenderer.invoke('bitrix:getTasks', userId),
    initiateCall: (leadId, phone) => ipcRenderer.invoke('bitrix:initiateCall', leadId, phone),
    finishCall: (callId, result) => ipcRenderer.invoke('bitrix:finishCall', callId, result),
    createTask: (data) => ipcRenderer.invoke('bitrix:createTask', data),
    addComment: (leadId, text) => ipcRenderer.invoke('bitrix:addComment', leadId, text),
    updateLead: (leadId, data) => ipcRenderer.invoke('bitrix:updateLead', leadId, data),
    updateEntity: (entityId, fields, entityType) => ipcRenderer.invoke('bitrix:updateEntity', entityId, fields, entityType),
    testConnection: () => ipcRenderer.invoke('bitrix:testConnection'),
    getPortalUrl: () => ipcRenderer.invoke('bitrix:getPortalUrl')
  },

  // Database operations
  db: {
    getCallAttempts: (leadId) => ipcRenderer.invoke('db:getCallAttempts', leadId),
    saveCallAttempt: (data) => ipcRenderer.invoke('db:saveCallAttempt', data),
    getSettings: () => ipcRenderer.invoke('db:getSettings'),
    saveSettings: (data) => ipcRenderer.invoke('db:saveSettings', data),
    getAllCallAttempts: (filters) => ipcRenderer.invoke('db:getAllCallAttempts', filters),
    getManagerStats: (managerId, date) => ipcRenderer.invoke('db:getManagerStats', managerId, date)
  },

  // Queue management
  queue: {
    getNext: () => ipcRenderer.invoke('queue:getNext'),
    refresh: () => ipcRenderer.invoke('queue:refresh'),
    getStats: () => ipcRenderer.invoke('queue:getStats'),
    getBatch: (count) => ipcRenderer.invoke('queue:getBatch', count)
  },

  // Wazzup/WhatsApp
  wazzup: {
    sendMessage: (phone, text) => ipcRenderer.invoke('wazzup:sendMessage', phone, text),
    sendFile: (phone, text, fileUrl) => ipcRenderer.invoke('wazzup:sendFile', phone, text, fileUrl)
  },

  // AI Analysis
  ai: {
    runAnalysis: (data) => ipcRenderer.invoke('ai:runAnalysis', data),
    getAnalyses: (leadId) => ipcRenderer.invoke('ai:getAnalyses', leadId)
  },

  // Scheduler
  scheduler: {
    calcNextAttempt: (attemptNum) => ipcRenderer.invoke('scheduler:calcNextAttempt', attemptNum),
    isWorkingHours: () => ipcRenderer.invoke('scheduler:isWorkingHours')
  },

  // Scheduled WhatsApp
  wa: {
    schedule: (data) => ipcRenderer.invoke('wa:schedule', data)
  },

  // Auto-dialer — triggers tel: URI to open SIP client
  dialer: {
    call: (phone) => ipcRenderer.invoke('dialer:call', phone)
  },

  // Navigation from tray
  onNavigate: (callback) => ipcRenderer.on('navigate', (_, route) => callback(route))
})
