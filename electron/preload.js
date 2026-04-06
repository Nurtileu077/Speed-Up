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
    testConnection: () => ipcRenderer.invoke('bitrix:testConnection')
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
    getStats: () => ipcRenderer.invoke('queue:getStats')
  },

  // Wazzup/WhatsApp
  wazzup: {
    sendMessage: (phone, text) => ipcRenderer.invoke('wazzup:sendMessage', phone, text)
  }
})
