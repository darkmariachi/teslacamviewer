// The desktop app: starts the TeslaCam server on this computer and shows it in a window.
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type MenuItemConstructorOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, saveConfig, type Config } from './config'
import { Server } from './server'

// A separate profile for development and testing, so a test run never touches the real library.
if (process.env.TESLACAM_USER_DATA) app.setPath('userData', process.env.TESLACAM_USER_DATA)

const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources')
const iconPath = path.join(__dirname, '..', 'build', 'icon.png')

let config: Config
let server: Server | null = null
let window: BrowserWindow | null = null
let quitting = false

// One copy at a time: a second launch brings the first window forward instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.whenReady().then(start)
}

async function start() {
  config = loadConfig()
  if (!config.libraryFolder) {
    config.libraryFolder = path.join(app.getPath('videos'), 'TeslaCam Viewer')
    saveConfig(config)
  }
  fs.mkdirSync(config.libraryFolder, { recursive: true })

  registerIpc()
  buildMenu()
  createWindow()
  await startServer()
  if (config.checkForUpdates && app.isPackaged) checkForUpdates(false)
}

function createWindow() {
  const bounds = config.windowBounds
  window = new BrowserWindow({
    width: bounds?.width ?? 1400,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 380,
    minHeight: 500,
    title: 'TeslaCam Viewer',
    backgroundColor: '#0a0a0b',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--teslacam-version=${app.getVersion()}`],
    },
  })
  if (bounds?.maximized) window.maximize()
  window.once('ready-to-show', () => window?.show())
  window.loadURL(splash('Starting…'))

  // Only the app itself opens in the window; every other link goes to the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !isAppUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url) || url.startsWith('data:')) return
    event.preventDefault()
    if (/^https?:/.test(url)) shell.openExternal(url)
  })

  window.on('close', () => {
    if (!window) return
    config.windowBounds = { ...window.getNormalBounds(), maximized: window.isMaximized() }
    saveConfig(config)
  })
  window.on('closed', () => {
    window = null
  })
}

const isAppUrl = (url: string) => server?.baseUrl != null && url.startsWith(server.baseUrl)

/** A plain page shown while the server starts, or when it could not. */
function splash(message: string, detail = '') {
  const html = `<!doctype html><html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0a0b;color:#f5f5f7;font:15px system-ui,'Segoe UI',sans-serif;gap:14px">
    <svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="22" fill="none" stroke="#f5f5f7" stroke-width="5"/><circle cx="32" cy="32" r="9" fill="#e82127"/></svg>
    <div style="letter-spacing:.22em;font-weight:600">TESLACAM</div>
    <div style="color:#9a9aa3">${escapeHtml(message)}</div>
    ${detail ? `<div style="color:#6b6b73;font-size:13px;max-width:520px;text-align:center">${escapeHtml(detail)}</div>` : ''}
  </body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

async function startServer() {
  server = new Server({
    resources,
    libraryFolder: config.libraryFolder!,
    dataFolder: path.join(app.getPath('userData'), 'data'),
    logFolder: path.join(app.getPath('userData'), 'logs'),
  })
  server.onExit = (code) => {
    if (quitting) return
    window?.loadURL(splash('TeslaCam stopped unexpectedly.', `Exit code ${code}. The log is in ${server?.logFile}. Restart the app to try again.`))
  }
  try {
    await server.start()
    // The window proves who it is with this cookie; the server refuses everything else.
    await session.defaultSession.cookies.set({
      url: server.baseUrl!,
      name: 'teslacam_desktop',
      value: server.token,
      httpOnly: true,
      sameSite: 'strict',
    })
    await window?.loadURL(server.baseUrl!)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    window?.loadURL(splash("TeslaCam couldn't start.", `${message} The log is in ${server.logFile}.`))
  }
}

async function restartServer() {
  window?.loadURL(splash('Restarting…'))
  await server?.stop()
  await startServer()
}

function registerIpc() {
  ipcMain.handle('pick-folder', async (_event, title: string) => {
    const result = await dialog.showOpenDialog(window!, { title, properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('change-library-folder', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose where to keep your clips',
      defaultPath: config.libraryFolder,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths[0] === config.libraryFolder) return false
    const choice = await dialog.showMessageBox(window!, {
      type: 'question',
      buttons: ['Use this folder', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: `Keep clips in ${result.filePaths[0]}?`,
      detail:
        'The library will show the clips in that folder. Clips in the current folder are not moved; move them yourself if you want them in the new one.',
    })
    if (choice.response !== 0) return false
    config.libraryFolder = result.filePaths[0]
    saveConfig(config)
    await restartServer()
    return true
  })

  ipcMain.handle('show-folder', (_event, folder: string) => shell.openPath(folder))
  ipcMain.handle('check-for-updates', () => checkForUpdates(true))
}

/** Asks GitHub for a newer release. The Windows installer and the AppImage can update themselves. */
async function checkForUpdates(userAsked: boolean): Promise<string> {
  if (!app.isPackaged) return 'Updates are only checked in the installed app.'
  try {
    const result = await autoUpdater.checkForUpdatesAndNotify()
    const latest = result?.updateInfo.version
    if (!latest || latest === app.getVersion()) {
      if (userAsked) dialog.showMessageBox(window!, { message: `You have the newest version (${app.getVersion()}).` })
      return 'up-to-date'
    }
    return `Version ${latest} is downloading and will be installed when you quit.`
  } catch (error) {
    if (userAsked) dialog.showMessageBox(window!, { type: 'warning', message: "Couldn't check for updates.", detail: String(error) })
    return 'failed'
  }
}

function buildMenu() {
  const go = (route: string) => server?.baseUrl && window?.loadURL(server.baseUrl + route)
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Events', accelerator: 'CmdOrCtrl+1', click: () => go('/') },
        { label: 'Map', accelerator: 'CmdOrCtrl+2', click: () => go('/map') },
        { label: 'Admin', accelerator: 'CmdOrCtrl+,', click: () => go('/admin') },
        { type: 'separator' },
        { label: 'Open the library folder', click: () => config.libraryFolder && shell.openPath(config.libraryFolder) },
        { label: 'Open the log folder', click: () => shell.openPath(path.join(app.getPath('userData'), 'logs')) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Guide', click: () => go('/help') },
        { label: 'Website', click: () => shell.openExternal('https://darkmariachi.github.io/teslacamviewer/') },
        { label: 'Report a problem', click: () => shell.openExternal('https://github.com/darkmariachi/teslacamviewer/issues') },
        { type: 'separator' },
        { label: 'Check for updates', click: () => checkForUpdates(true) },
        {
          label: 'Check for updates automatically',
          type: 'checkbox',
          checked: config.checkForUpdates,
          click: (item) => {
            config.checkForUpdates = item.checked
            saveConfig(config)
          },
        },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.on('window-all-closed', () => app.quit())

// Stop the server (and any ffmpeg it is running) before the app goes.
app.on('before-quit', (event) => {
  if (quitting || !server) return
  event.preventDefault()
  quitting = true
  server.stop().finally(() => app.quit())
})
