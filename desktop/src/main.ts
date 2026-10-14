// The desktop app: starts the TeslaCam server on this computer and shows it in a window.
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type MenuItemConstructorOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, saveConfig, type Config } from './config'
import { Server } from './server'

// A separate profile for development and testing, so a test run never touches the real library.
if (process.env.TESLACAM_USER_DATA) {
  app.setPath('userData', process.env.TESLACAM_USER_DATA)
  app.setPath('videos', path.join(process.env.TESLACAM_USER_DATA, 'Videos'))
}

const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources')
const iconPath = path.join(__dirname, '..', 'build', 'icon.png')

let config: Config
let server: Server | null = null
let window: BrowserWindow | null = null
let appMenu: Menu | null = null
let quitting = false

const defaultLibraryFolder = () => path.join(app.getPath('videos'), 'TeslaCam Viewer')

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
  if (!config.libraryFolder) config.libraryFolder = defaultLibraryFolder()
  // Only the default folder is created. A folder the user chose may be on a drive that is unplugged right now;
  // creating it would start an empty library in its place, so the app says it is missing instead.
  if (samePath(config.libraryFolder, defaultLibraryFolder())) fs.mkdirSync(config.libraryFolder, { recursive: true })
  // Installs from before the first-run choice existed, with clips already in the library, have made their choice.
  config.welcomed ??= hasEntries(config.libraryFolder)
  saveConfig(config)

  registerIpc()
  buildMenu()
  createWindow()
  await startServer()
  if (config.checkForUpdates && app.isPackaged) checkForUpdates(false)
}

function createWindow() {
  const bounds = config.windowBounds
  window = new BrowserWindow({
    // The app draws its own title bar. macOS keeps its native window buttons, inset into that bar.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : { frame: false }),
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

  // The title bar shows whether the window is maximized, and dims its lights while the window is in the background.
  const sendState = () => window?.webContents.send('window-state', windowState())
  window.on('maximize', sendState)
  window.on('unmaximize', sendState)
  window.on('focus', sendState)
  window.on('blur', sendState)
  window.on('enter-full-screen', sendState)
  window.on('leave-full-screen', sendState)
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

const windowState = () => ({
  maximized: window?.isMaximized() ?? false,
  focused: window?.isFocused() ?? false,
  fullScreen: window?.isFullScreen() ?? false,
})

/**
 * A plain page shown while the server starts, or when it could not. The window has no frame, so this page has a
 * small title bar of its own to move and close it by.
 */
function splash(message: string, detail = '') {
  const lamp = (color: string, action: string, label: string) =>
    `<button title="${label}" aria-label="${label}" onclick="window.teslacamDesktop && window.teslacamDesktop.window.${action}()" style="width:13px;height:13px;border-radius:50%;border:0;padding:0;background:${color};box-shadow:0 0 6px ${color}88;cursor:pointer;-webkit-app-region:no-drag"></button>`
  const lights =
    process.platform === 'darwin'
      ? ''
      : `<div style="position:fixed;top:7px;right:10px;display:flex;gap:9px;padding:5px 9px;border-radius:999px;background:#141416;border:1px solid #2a2a2f">${lamp('#f5a524', 'minimize', 'Minimize')}${lamp('#30c45a', 'toggleMaximize', 'Maximize')}${lamp('#e82127', 'close', 'Close')}</div>`
  const html = `<!doctype html><html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0a0b;color:#f5f5f7;font:15px system-ui,'Segoe UI',sans-serif;gap:14px">
    <div style="position:fixed;inset:0 0 auto 0;height:40px;-webkit-app-region:drag"></div>${lights}
    <svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="22" fill="none" stroke="#f5f5f7" stroke-width="5"/><circle cx="32" cy="32" r="9" fill="#e82127"/></svg>
    <div style="letter-spacing:.22em;font-weight:600">TESLACAM</div>
    <div style="color:#9a9aa3">${escapeHtml(message)}</div>
    ${detail ? `<div style="color:#6b6b73;font-size:13px;max-width:520px;text-align:center">${escapeHtml(detail)}</div>` : ''}
  </body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)

function hasEntries(folder: string) {
  try {
    return fs.readdirSync(folder).length > 0
  } catch {
    return false
  }
}

/**
 * The data folder (index, notes, collections, thumbnails) for a library. Each library keeps its own, so pointing
 * the app at another folder and back again loses nothing. The first library uses the folder earlier versions used.
 */
function dataFolderFor(library: string) {
  const key = process.platform === 'win32' ? path.resolve(library).toLowerCase() : path.resolve(library)
  config.libraryData ??= {}
  if (!config.libraryData[key]) {
    const first = Object.keys(config.libraryData).length === 0
    config.libraryData[key] = first ? 'data' : `data-${createHash('sha1').update(key).digest('hex').slice(0, 10)}`
    saveConfig(config)
  }
  return path.join(app.getPath('userData'), config.libraryData[key])
}

async function startServer() {
  server = new Server({
    resources,
    libraryFolder: config.libraryFolder!,
    dataFolder: dataFolderFor(config.libraryFolder!),
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

  // The web app has already asked which folder, and warned about removable drives, before calling these.
  ipcMain.handle('set-library-folder', async (_event, folder: string) => {
    if (typeof folder !== 'string' || !fs.existsSync(folder)) return false
    if (samePath(folder, config.libraryFolder!)) return true
    config.libraryFolder = folder
    saveConfig(config)
    await restartServer()
    return true
  })
  ipcMain.handle('use-default-library-folder', async () => {
    const folder = defaultLibraryFolder()
    fs.mkdirSync(folder, { recursive: true })
    if (samePath(folder, config.libraryFolder!)) return true
    config.libraryFolder = folder
    saveConfig(config)
    await restartServer()
    return true
  })
  ipcMain.handle('default-library-folder', () => defaultLibraryFolder())
  ipcMain.handle('is-first-run', () => !config.welcomed)
  ipcMain.handle('finish-first-run', () => {
    config.welcomed = true
    saveConfig(config)
  })

  ipcMain.handle('window-control', (_event, action: string) => {
    if (!window) return
    if (action === 'minimize') window.minimize()
    else if (action === 'toggle-maximize') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    } else if (action === 'close') window.close()
  })
  ipcMain.handle('window-state', () => windowState())
  // The window has no menu bar of its own; the title bar's menu button opens the same menu.
  ipcMain.handle('show-app-menu', (_event, x: number, y: number) => {
    if (window && appMenu) appMenu.popup({ window, x: Math.round(x), y: Math.round(y) })
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
  appMenu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(appMenu)
}

app.on('window-all-closed', () => app.quit())

// Stop the server (and any ffmpeg it is running) before the app goes.
app.on('before-quit', (event) => {
  if (quitting || !server) return
  event.preventDefault()
  quitting = true
  server.stop().finally(() => app.quit())
})
