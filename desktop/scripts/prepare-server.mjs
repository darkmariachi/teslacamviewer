// Builds the web app and a self-contained server into resources/server, and checks ffmpeg is in resources/ffmpeg.
// Usage: node scripts/prepare-server.mjs [--rid win-x64|linux-x64]
// ffmpeg comes from scripts/fetch-ffmpeg.mjs, or from the folder in FFMPEG_DIR for local builds.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.join(desktop, '..')
const ridArg = process.argv.indexOf('--rid')
const rid = ridArg > 0 ? process.argv[ridArg + 1] : process.platform === 'win32' ? 'win-x64' : 'linux-x64'
const windows = rid.startsWith('win')
const run = (command, cwd) => {
  console.log(`> ${command}`)
  execSync(command, { cwd, stdio: 'inherit' })
}

// 1. The web app, which the server serves from its wwwroot folder.
if (!fs.existsSync(path.join(repo, 'web', 'node_modules'))) run('npm ci', path.join(repo, 'web'))
run('npm run build', path.join(repo, 'web'))

// 2. The server, with the .NET runtime included so nothing has to be installed.
const serverOut = path.join(desktop, 'resources', 'server')
fs.rmSync(serverOut, { recursive: true, force: true })
run(
  `dotnet publish server/TeslaCam.csproj -c Release -r ${rid} --self-contained true -p:DebugType=none -p:GenerateDocumentationFile=false -o "${serverOut}"`,
  repo,
)

// 3. ffmpeg and ffprobe.
const ffmpegOut = path.join(desktop, 'resources', 'ffmpeg')
const exe = (name) => (windows ? `${name}.exe` : name)
if (process.env.FFMPEG_DIR) {
  fs.mkdirSync(ffmpegOut, { recursive: true })
  for (const name of ['ffmpeg', 'ffprobe']) fs.copyFileSync(path.join(process.env.FFMPEG_DIR, exe(name)), path.join(ffmpegOut, exe(name)))
  console.log(`ffmpeg copied from ${process.env.FFMPEG_DIR}`)
}
for (const name of ['ffmpeg', 'ffprobe']) {
  if (!fs.existsSync(path.join(ffmpegOut, exe(name)))) {
    console.error(`resources/ffmpeg/${exe(name)} is missing. Run "npm run fetch-ffmpeg", or set FFMPEG_DIR to a folder with ffmpeg in it.`)
    process.exit(1)
  }
}
console.log(`Server for ${rid} is ready in ${serverOut}`)
