const { Tray, Menu, app } = require('electron')
const path = require('path')

let tray = null

function createTray(mainWindow) {
  const iconPath = path.join(__dirname, '../assets/tray-icon.png')

  try {
    tray = new Tray(iconPath)
  } catch (err) {
    console.warn('[Tray] Could not load tray icon:', err.message)
    return
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Nobilis Power Dialer',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Показать окно',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: 'Дозвонщик',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
          mainWindow.webContents.send('navigate', '/dialer')
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('Nobilis Power Dialer')
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  return tray
}

module.exports = { createTray }
