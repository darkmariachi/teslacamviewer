// What the web app can ask of the desktop app. Nothing else from Electron or Node reaches the page.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const version = process.argv.find((a) => a.startsWith('--teslacam-version='))?.split('=')[1] ?? ''

type WindowState = { maximized: boolean; focused: boolean; fullScreen: boolean }

contextBridge.exposeInMainWorld('teslacamDesktop', {
  version,
  platform: process.platform,
  pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('pick-folder', title),
  setLibraryFolder: (folder: string): Promise<boolean> => ipcRenderer.invoke('set-library-folder', folder),
  useDefaultLibraryFolder: (): Promise<boolean> => ipcRenderer.invoke('use-default-library-folder'),
  defaultLibraryFolder: (): Promise<string> => ipcRenderer.invoke('default-library-folder'),
  isFirstRun: (): Promise<boolean> => ipcRenderer.invoke('is-first-run'),
  finishFirstRun: (): Promise<void> => ipcRenderer.invoke('finish-first-run'),
  showFolder: (folder: string): Promise<void> => ipcRenderer.invoke('show-folder', folder),
  checkForUpdates: (): Promise<string> => ipcRenderer.invoke('check-for-updates'),
  showAppMenu: (x: number, y: number): Promise<void> => ipcRenderer.invoke('show-app-menu', x, y),
  window: {
    minimize: () => ipcRenderer.invoke('window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window-control', 'toggle-maximize'),
    close: () => ipcRenderer.invoke('window-control', 'close'),
    state: (): Promise<WindowState> => ipcRenderer.invoke('window-state'),
    /** Calls back when the window is maximized, restored, focused or sent to the background. Returns an unsubscribe. */
    onState: (callback: (state: WindowState) => void) => {
      const listener = (_event: IpcRendererEvent, state: WindowState) => callback(state)
      ipcRenderer.on('window-state', listener)
      return () => ipcRenderer.removeListener('window-state', listener)
    },
  },
})
