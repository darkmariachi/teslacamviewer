// The desktop app's own settings, kept next to its data. The library's settings live in the server.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface Config {
  /** Where imported clips are kept. */
  libraryFolder?: string
  checkForUpdates: boolean
  windowBounds?: { x: number; y: number; width: number; height: number; maximized: boolean }
}

const file = () => path.join(app.getPath('userData'), 'config.json')

export function loadConfig(): Config {
  try {
    return { checkForUpdates: true, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }
  } catch {
    return { checkForUpdates: true }
  }
}

export function saveConfig(config: Config) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(config, null, 2))
}
