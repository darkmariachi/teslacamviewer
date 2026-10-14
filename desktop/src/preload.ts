// What the web app can ask of the desktop app. Nothing else from Electron or Node reaches the page.
import { contextBridge, ipcRenderer } from 'electron'

const version = process.argv.find((a) => a.startsWith('--teslacam-version='))?.split('=')[1] ?? ''

contextBridge.exposeInMainWorld('teslacamDesktop', {
  version,
  pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('pick-folder', title),
  changeLibraryFolder: (): Promise<boolean> => ipcRenderer.invoke('change-library-folder'),
  showFolder: (folder: string): Promise<void> => ipcRenderer.invoke('show-folder', folder),
  checkForUpdates: (): Promise<string> => ipcRenderer.invoke('check-for-updates'),
})
