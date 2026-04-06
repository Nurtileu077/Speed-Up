const { app, BrowserWindow, ipcMain, Menu, shell, nativeImage } = require('electron')
const path = require('path')
const isDev = require('electron-is-dev')
const { createTray } = require('./tray')

let mainWindow
let tray = null

function startExpressServer() {
  // Run Express inline inside Electron — no child process needed
  // This works both in dev and in packaged .app
  try {
    const serverApp = require('../server/index.js')
    console.log('[Server] Express started inline')
  } catch (err) {
    console.error('[Server] Failed to start inline:', err.message)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f172a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '../assets/icon.png')
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  setupMenu()
}

function setupMenu() {
  const template = [
    {
      label: 'Nobilis Dialer',
      submenu: [
        { label: 'О программе', role: 'about' },
        { type: 'separator' },
        { label: 'Скрыть', role: 'hide' },
        { label: 'Показать все', role: 'unhide' },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', role: 'undo' },
        { label: 'Повторить', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Обновить', role: 'reload' },
        { label: 'Принудительное обновление', role: 'forceReload' },
        { type: 'separator' },
        { label: 'Во весь экран', role: 'togglefullscreen' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// IPC Handlers - Database operations
ipcMain.handle('db:getSettings', async () => {
  try {
    const db = require('../src/services/db-main')
    return db.getSettings()
  } catch (err) {
    console.error('db:getSettings error', err)
    return {}
  }
})

ipcMain.handle('db:saveSettings', async (event, data) => {
  try {
    const db = require('../src/services/db-main')
    for (const [key, value] of Object.entries(data)) {
      db.saveSettings(key, String(value))
    }
    return { success: true }
  } catch (err) {
    console.error('db:saveSettings error', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('db:getCallAttempts', async (event, leadId) => {
  try {
    const db = require('../src/services/db-main')
    return db.getCallAttempts(leadId)
  } catch (err) {
    console.error('db:getCallAttempts error', err)
    return []
  }
})

ipcMain.handle('db:saveCallAttempt', async (event, data) => {
  try {
    const db = require('../src/services/db-main')
    return db.saveCallAttempt(data)
  } catch (err) {
    console.error('db:saveCallAttempt error', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('db:getAllCallAttempts', async (event, filters) => {
  try {
    const db = require('../src/services/db-main')
    return db.getAllCallAttempts(filters)
  } catch (err) {
    console.error('db:getAllCallAttempts error', err)
    return []
  }
})

ipcMain.handle('db:getManagerStats', async (event, managerId, date) => {
  try {
    const db = require('../src/services/db-main')
    return db.getManagerStats(managerId, date)
  } catch (err) {
    console.error('db:getManagerStats error', err)
    return null
  }
})

// IPC Handlers - Bitrix24 operations
ipcMain.handle('bitrix:getLeads', async (event, filter) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    return await bitrix.getLeads(filter)
  } catch (err) {
    console.error('bitrix:getLeads error', err)
    return { error: err.message }
  }
})

ipcMain.handle('bitrix:getTasks', async (event, userId) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    return await bitrix.getTasks(userId)
  } catch (err) {
    console.error('bitrix:getTasks error', err)
    return { error: err.message }
  }
})

ipcMain.handle('bitrix:initiateCall', async (event, leadId, phone) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    return await bitrix.initiateCall(leadId, phone, settings.MANAGER_ID || '1')
  } catch (err) {
    console.error('bitrix:initiateCall error', err)
    return { error: err.message }
  }
})

ipcMain.handle('bitrix:finishCall', async (event, callId, result) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    return await bitrix.finishCall(callId, result.status, result.duration)
  } catch (err) {
    console.error('bitrix:finishCall error', err)
    return { error: err.message }
  }
})

ipcMain.handle('bitrix:createTask', async (event, data) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    return await bitrix.createTask(data)
  } catch (err) {
    console.error('bitrix:createTask error', err)
    return { error: err.message }
  }
})

ipcMain.handle('bitrix:addComment', async (event, leadId, text) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    return await bitrix.addTimelineComment(leadId, text)
  } catch (err) {
    console.error('bitrix:addComment error', err)
    return { error: err.message }
  }
})

ipcMain.handle('bitrix:updateLead', async (event, leadId, data) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    return await bitrix.updateLead(leadId, data)
  } catch (err) {
    console.error('bitrix:updateLead error', err)
    return { error: err.message }
  }
})

ipcMain.handle('bitrix:testConnection', async () => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    const result = await bitrix.getLeads({ limit: 1 })
    return { success: !result.error, error: result.error }
  } catch (err) {
    console.error('bitrix:testConnection error', err)
    return { success: false, error: err.message }
  }
})

// IPC Handlers - Queue operations
ipcMain.handle('queue:getNext', async () => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    const db = require('../src/services/db-main')
    bitrix.configure(settings)
    const queue = require('../src/services/queue-main')
    queue.configure(bitrix, db)
    return await queue.getNextLead()
  } catch (err) {
    console.error('queue:getNext error', err)
    return { error: err.message }
  }
})

ipcMain.handle('queue:refresh', async () => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    const db = require('../src/services/db-main')
    bitrix.configure(settings)
    const queue = require('../src/services/queue-main')
    queue.configure(bitrix, db)
    return await queue.buildQueue()
  } catch (err) {
    console.error('queue:refresh error', err)
    return { error: err.message }
  }
})

ipcMain.handle('queue:getBatch', async (event, count) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    const db = require('../src/services/db-main')
    bitrix.configure(settings)
    const queue = require('../src/services/queue-main')
    queue.configure(bitrix, db)
    return await queue.getNextBatch(count || 5)
  } catch (err) {
    console.error('queue:getBatch error', err)
    return []
  }
})

ipcMain.handle('queue:getStats', async () => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const bitrix = require('../src/services/bitrix-main')
    const db = require('../src/services/db-main')
    bitrix.configure(settings)
    const queue = require('../src/services/queue-main')
    queue.configure(bitrix, db)
    return await queue.getQueueStats()
  } catch (err) {
    console.error('queue:getStats error', err)
    return { total: 0, overdue: 0, new: 0, error: err.message }
  }
})

// IPC Handlers - Wazzup/WhatsApp
ipcMain.handle('wazzup:sendMessage', async (event, phone, text) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const wazzup = require('../src/services/wazzup-main')
    wazzup.configure(settings)
    return await wazzup.sendMessage(phone, text)
  } catch (err) {
    console.error('wazzup:sendMessage error', err)
    return { error: err.message }
  }
})

ipcMain.handle('wazzup:sendFile', async (event, phone, text, fileUrl) => {
  try {
    const settings = require('../src/services/db-main').getSettings()
    const wazzup = require('../src/services/wazzup-main')
    wazzup.configure(settings)
    return await wazzup.sendFile(phone, text, fileUrl)
  } catch (err) {
    console.error('wazzup:sendFile error', err)
    return { error: err.message }
  }
})

// IPC Handlers - AI Pipeline
ipcMain.handle('ai:runAnalysis', async (event, { callId, leadId, durationSec }) => {
  try {
    const db = require('../src/services/db-main')
    const settings = db.getSettings()
    const bitrix = require('../src/services/bitrix-main')
    bitrix.configure(settings)
    const pipeline = require('../src/services/ai-pipeline')
    return await pipeline.runPipeline({ callId, leadId, durationSec, db, bitrix })
  } catch (err) {
    console.error('ai:runAnalysis error', err)
    return { error: err.message }
  }
})

ipcMain.handle('ai:getAnalyses', async (event, leadId) => {
  try {
    const db = require('../src/services/db-main')
    return db.getAiAnalyses(leadId)
  } catch (err) {
    console.error('ai:getAnalyses error', err)
    return []
  }
})

// IPC Handlers - Scheduler
ipcMain.handle('scheduler:calcNextAttempt', async (event, attemptNum) => {
  const scheduler = require('../src/services/scheduler-main')
  return scheduler.calcNextAttemptTime(attemptNum)
})

ipcMain.handle('scheduler:isWorkingHours', async () => {
  const scheduler = require('../src/services/scheduler-main')
  return scheduler.isWorkingHours()
})

// IPC Handlers - Scheduled WhatsApp
ipcMain.handle('wa:schedule', async (event, { leadId, phone, message, sendAt }) => {
  try {
    const db = require('../src/services/db-main')
    db.scheduleWa(leadId, phone, message, sendAt)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// IPC Handlers - Portal URL
ipcMain.handle('bitrix:getPortalUrl', async () => {
  const settings = require('../src/services/db-main').getSettings()
  return settings.BITRIX_PORTAL || ''
})

app.whenReady().then(() => {
  // Initialize DB first
  try {
    const db = require('../src/services/db-main')
    db.initDB()
    console.log('[Main] Database initialized')

    // Initialize and start scheduler (Phase 2 + 5)
    const settings = db.getSettings()
    const bitrix = require('../src/services/bitrix-main')
    const wazzup = require('../src/services/wazzup-main')

    if (settings.BITRIX_WEBHOOK) bitrix.configure(settings)
    if (settings.WAZZUP_API_KEY) wazzup.configure(settings)

    const scheduler = require('../src/services/scheduler-main')
    scheduler.configure({ db, bitrix, wazzup })
    scheduler.start()
  } catch (err) {
    console.error('[Main] Init error', err)
  }

  startExpressServer()
  createWindow()

  // Create tray icon (Phase 6)
  try {
    tray = createTray(mainWindow)
  } catch (err) {
    console.warn('[Main] Tray creation failed:', err.message)
  }

  // Auto-start on login (Phase 6 — macOS)
  if (!isDev && process.platform === 'darwin') {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow) {
      mainWindow.show()
    }
  })
})

// macOS: minimize to tray instead of quitting
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  try {
    const scheduler = require('../src/services/scheduler-main')
    scheduler.stop()
  } catch {}
})
