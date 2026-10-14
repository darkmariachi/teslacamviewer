// Downloads an LGPL build of ffmpeg for the given platform into resources/ffmpeg.
// LGPL builds can be shipped with an MIT app; the GPL ones would bind the app to the GPL.
// Builds come from https://github.com/BtbN/FFmpeg-Builds, the Windows and Linux builds ffmpeg.org links to.
// Usage: node scripts/fetch-ffmpeg.mjs [--platform win64|linux64]
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const platformArg = process.argv.indexOf('--platform')
const platform = platformArg > 0 ? process.argv[platformArg + 1] : process.platform === 'win32' ? 'win64' : 'linux64'
const windows = platform === 'win64'

const headers = { 'User-Agent': 'teslacamviewer-build', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }
const release = await (await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest', { headers })).json()
// Release builds look like ffmpeg-n7.1-latest-win64-lgpl-7.1.zip; take the newest version.
const pattern = new RegExp(String.raw`^ffmpeg-n([\d.]+)-latest-${platform}-lgpl-[\d.]+\.(zip|tar\.xz)$`)
const asset = release.assets
  .filter((a) => pattern.test(a.name))
  .sort((a, b) => compareVersions(b.name.match(pattern)[1], a.name.match(pattern)[1]))[0]
if (!asset) throw new Error(`No LGPL ${platform} build found in BtbN/FFmpeg-Builds`)
console.log(`Downloading ${asset.name}`)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-'))
const archive = path.join(work, asset.name)
fs.writeFileSync(archive, Buffer.from(await (await fetch(asset.browser_download_url, { headers })).arrayBuffer()))
if (asset.name.endsWith('.zip')) {
  execSync(windows ? `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${archive}' -DestinationPath '${work}'"` : `unzip -q "${archive}" -d "${work}"`)
} else {
  execSync(`tar -xJf "${archive}" -C "${work}"`)
}

const bin = path.join(work, asset.name.replace(/\.(zip|tar\.xz)$/, ''), 'bin')
const out = path.join(desktop, 'resources', 'ffmpeg')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = windows ? `${name}.exe` : name
  fs.copyFileSync(path.join(bin, file), path.join(out, file))
  if (!windows) fs.chmodSync(path.join(out, file), 0o755)
}
// The LGPL asks that people can find the source of the exact build they received.
fs.writeFileSync(
  path.join(out, 'SOURCE.txt'),
  `ffmpeg ${asset.name}\nLicensed under the LGPL 2.1 or later: https://www.ffmpeg.org/legal.html\n` +
    `Build: ${asset.browser_download_url}\nBuild scripts and source references: https://github.com/BtbN/FFmpeg-Builds\nffmpeg source: https://github.com/FFmpeg/FFmpeg\n`,
)
fs.rmSync(work, { recursive: true, force: true })
console.log(`ffmpeg is in ${out}`)

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}
