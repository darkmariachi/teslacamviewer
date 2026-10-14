// Runs the bundled TeslaCam server on a private port that only this computer can reach.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export interface ServerOptions {
  /** Folder holding server/ and ffmpeg/. */
  resources: string
  libraryFolder: string
  dataFolder: string
  logFolder: string
}

const MaxLogBytes = 5 * 1024 * 1024

export class Server {
  /** Proves to the server that a request comes from this app's window. */
  readonly token = randomBytes(32).toString('hex')
  readonly logFile: string
  baseUrl: string | null = null
  onExit: (code: number | null) => void = () => {}
  private process: ChildProcess | null = null

  constructor(private readonly options: ServerOptions) {
    this.logFile = path.join(options.logFolder, 'server.log')
  }

  async start() {
    const { resources, libraryFolder, dataFolder, logFolder } = this.options
    const serverDir = path.join(resources, 'server')
    const exe = path.join(serverDir, process.platform === 'win32' ? 'TeslaCam.exe' : 'TeslaCam')
    if (!fs.existsSync(exe)) throw new Error(`The server is missing from ${serverDir}.`)
    const ffmpegDir = path.join(resources, 'ffmpeg')

    fs.mkdirSync(dataFolder, { recursive: true })
    fs.mkdirSync(logFolder, { recursive: true })
    // Keep one previous log; start fresh when it gets large.
    if (fs.existsSync(this.logFile) && fs.statSync(this.logFile).size > MaxLogBytes) fs.renameSync(this.logFile, this.logFile + '.1')
    const log = fs.openSync(this.logFile, 'a')
    fs.writeSync(log, `\n--- ${new Date().toISOString()} starting\n`)

    const port = await freePort()
    this.baseUrl = `http://127.0.0.1:${port}`
    this.process = spawn(exe, [], {
      cwd: serverDir,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        TESLACAM_ROOT: libraryFolder,
        TESLACAM_DATA: dataFolder,
        ...(fs.existsSync(ffmpegDir) ? { TESLACAM_FFMPEG: ffmpegDir } : {}),
        TESLACAM_DESKTOP_TOKEN: this.token,
        ASPNETCORE_URLS: this.baseUrl,
        ASPNETCORE_ENVIRONMENT: 'Production',
        DOTNET_gcServer: '0',
      },
    })
    fs.closeSync(log)

    let exited = false
    this.process.on('exit', (code) => {
      exited = true
      this.process = null
      this.onExit(code)
    })

    // The server is ready once it answers its health check.
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      if (exited) throw new Error('The server stopped while starting.')
      try {
        const response = await fetch(`${this.baseUrl}/api/health`)
        if (response.ok) return
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('The server did not start within a minute.')
  }

  /** Stops the server and anything it started, such as ffmpeg. */
  stop(): Promise<void> {
    const child = this.process
    if (!child?.pid) return Promise.resolve()
    this.onExit = () => {}
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 8000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      if (process.platform === 'win32') {
        // Windows has no gentle signal for a console-less process; end the whole tree.
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        // The server cancels its jobs, and with them ffmpeg, on SIGTERM.
        child.kill('SIGTERM')
      }
    })
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}
