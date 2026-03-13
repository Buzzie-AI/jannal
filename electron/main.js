const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron')
const { fork } = require('child_process')
const path = require('path')
const http = require('http')

// Auto-updates via GitHub Releases
const { autoUpdater } = require('electron-updater')

const PORT = process.env.JANNAL_PORT || 4455
const IS_DEV = !app.isPackaged

let serverProcess
let mainWindow
let tray

// Current state from server
let profiles = {}
let activeProfile = 'All Tools'

// ─── Server lifecycle ───────────────────────────────────────────────────────

function startServer() {
  const serverPath = IS_DEV
    ? path.join(__dirname, '..', 'server.js')
    : path.join(process.resourcesPath, 'app', 'server.js')

  serverProcess = fork(serverPath, [], {
    env: { ...process.env, JANNAL_PORT: String(PORT) },
    silent: true,
  })
  serverProcess.stdout?.pipe(process.stdout)
  serverProcess.stderr?.pipe(process.stderr)
  serverProcess.on('error', (err) => {
    console.error('Server process error:', err)
  })
  serverProcess.on('exit', (code) => {
    console.log(`Server exited with code ${code}`)
    serverProcess = null
  })
}

function waitForServer(timeout = 10000) {
  const url = `http://localhost:${PORT}/health`
  const start = Date.now()

  return new Promise((resolve, reject) => {
    function poll() {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200) {
          resolve()
        } else {
          retry()
        }
      })
      req.on('error', retry)
      req.setTimeout(1000, () => { req.destroy(); retry() })
    }

    function retry() {
      if (Date.now() - start > timeout) {
        reject(new Error('Server failed to start within timeout'))
        return
      }
      setTimeout(poll, 100)
    }

    poll()
  })
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
}

// ─── Server API helpers ─────────────────────────────────────────────────────

function fetchJSON(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${urlPath}`, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function postJSON(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(payload)
    req.end()
  })
}

async function refreshProfiles() {
  try {
    const data = await fetchJSON('/api/profiles')
    profiles = data.profiles || {}
    activeProfile = data.active || 'All Tools'
  } catch (err) {
    console.error('Failed to fetch profiles:', err.message)
  }
}

async function switchProfile(name) {
  try {
    await postJSON('/api/active-profile', { name })
    activeProfile = name
    rebuildTrayMenu()
  } catch (err) {
    console.error('Failed to switch profile:', err.message)
  }
}

// ─── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a18',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(`http://localhost:${PORT}`)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Hide instead of close — app lives in the tray
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── Tray ───────────────────────────────────────────────────────────────────

function createTray() {
  // Template image for macOS menu bar (white, 16x16)
  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('Jannal — Context Window Inspector')

  // Click tray icon → show/hide inspector window
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      createWindow()
    }
  })

  rebuildTrayMenu()
}

function createTrayIcon() {
  // Create a simple "J" icon as a template image for macOS menu bar
  // Template images are automatically colored by macOS (dark/light mode)
  const size = 22
  const canvas = Buffer.alloc(size * size * 4, 0) // RGBA

  // Draw a simple "J" shape (pixel art style for 22x22)
  const pixels = [
    // Top bar of J (row 4-5, cols 7-16)
    ...range(4, 6).flatMap(r => range(7, 17).map(c => [r, c])),
    // Stem of J (rows 6-14, cols 11-14)
    ...range(6, 15).flatMap(r => range(11, 15).map(c => [r, c])),
    // Bottom curve of J (rows 15-16, cols 6-14)
    ...range(15, 17).flatMap(r => range(6, 14).map(c => [r, c])),
    // Left hook (rows 13-14, cols 4-6)
    ...range(13, 17).flatMap(r => range(4, 7).map(c => [r, c])),
  ]

  for (const [r, c] of pixels) {
    const idx = (r * size + c) * 4
    canvas[idx] = 255     // R
    canvas[idx + 1] = 255 // G
    canvas[idx + 2] = 255 // B
    canvas[idx + 3] = 255 // A
  }

  const img = nativeImage.createFromBuffer(canvas, { width: size, height: size })
  img.setTemplateImage(true)
  return img
}

function range(start, end) {
  return Array.from({ length: end - start }, (_, i) => start + i)
}

function rebuildTrayMenu() {
  if (!tray) return

  const profileNames = Object.keys(profiles)
  const profileItems = profileNames.map(name => ({
    label: name,
    type: 'radio',
    checked: name === activeProfile,
    click: () => switchProfile(name),
  }))

  const isFiltering = activeProfile !== 'All Tools'

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isFiltering ? `Profile: ${activeProfile}` : 'Jannal',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Profiles',
      submenu: profileItems.length > 0 ? profileItems : [{ label: 'No profiles', enabled: false }],
    },
    { type: 'separator' },
    {
      label: 'Open Inspector',
      click: () => createWindow(),
    },
    {
      label: `Copy Proxy URL`,
      click: () => {
        require('electron').clipboard.writeText(`http://localhost:${PORT}`)
      },
    },
    { type: 'separator' },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked })
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Jannal',
      click: () => {
        app.isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  // Update tray title (shows next to icon on macOS)
  if (isFiltering) {
    tray.setTitle(activeProfile, { fontType: 'monospacedDigit' })
  } else {
    tray.setTitle('')
  }
}

// Poll server for profile changes (in case changed from the web UI)
let profilePollInterval
function startProfilePolling() {
  profilePollInterval = setInterval(async () => {
    const prevActive = activeProfile
    await refreshProfiles()
    if (activeProfile !== prevActive) {
      rebuildTrayMenu()
    }
  }, 3000)
}

// ─── macOS App Menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        {
          label: 'About Jannal',
          click: () => {
            dialog.showMessageBox(mainWindow || undefined, {
              type: 'info',
              title: 'About Jannal',
              message: 'Jannal',
              detail: `Version ${app.getVersion()}\n\nContext window inspector & optimizer for Claude.\n\nhttps://github.com/Buzzie-AI/jannal`,
            })
          },
        },
        { label: 'Check for Updates...', click: () => autoUpdater.checkForUpdatesAndNotify() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'GitHub Repository',
          click: () => shell.openExternal('https://github.com/Buzzie-AI/jannal'),
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/Buzzie-AI/jannal/issues'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ─── Auto-updates ───────────────────────────────────────────────────────────

function setupAutoUpdater() {
  if (IS_DEV) return

  autoUpdater.logger = console
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: v${info.version}`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    const win = mainWindow || undefined
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Ready',
      message: `Jannal v${info.version} has been downloaded.`,
      detail: 'It will be installed when you quit the app.',
      buttons: ['Restart Now', 'Later'],
    }).then((result) => {
      if (result.response === 0) {
        app.isQuitting = true
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  autoUpdater.checkForUpdatesAndNotify()
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000)
}

// ─── App lifecycle ──────────────────────────────────────────────────────────

// Keep app running when all windows are closed (tray app)
app.isQuitting = false

app.setAboutPanelOptions({
  applicationName: 'Jannal',
  applicationVersion: app.getVersion(),
  copyright: 'Copyright © 2026 Arvind Naidu',
  website: 'https://github.com/Buzzie-AI/jannal',
})

// Hide dock icon — Jannal lives in the menu bar
if (process.platform === 'darwin') {
  app.dock.hide()
}

app.whenReady().then(async () => {
  buildMenu()
  startServer()

  try {
    await waitForServer()
  } catch (err) {
    console.error(err.message)
    dialog.showErrorBox('Jannal', 'Failed to start the proxy server. Please check the logs.')
    app.quit()
    return
  }

  await refreshProfiles()
  createTray()
  startProfilePolling()
  setupAutoUpdater()

  // Don't open the window on launch — just the tray icon.
  // User clicks tray icon or "Open Inspector" to see the window.
})

app.on('window-all-closed', () => {
  // Don't quit — app lives in the tray
})

app.on('activate', () => {
  createWindow()
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (profilePollInterval) clearInterval(profilePollInterval)
  stopServer()
})
