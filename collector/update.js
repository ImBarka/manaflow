import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { UserError } from './errors.js'

const run = promisify(execFile)

// Releases are git tags named vX.Y.Z. Updating installs a tag, never the tip
// of a branch, so merging to main does not by itself change what laptops run.
// Whoever can push tags to this repository decides what an update installs.
const REPOSITORY = 'ImBarka/manaflow'
const TAGS_URL = `https://api.github.com/repos/${REPOSITORY}/tags?per_page=100`
const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const here = dirname(fileURLToPath(import.meta.url))

export function isNewer(candidate, current) {
  const parts = (version) => String(version).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [a, b] = [parts(candidate), parts(current)]
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export function dueForCheck(lastCheckedAt, now = Date.now()) {
  return now - (lastCheckedAt ?? 0) >= CHECK_INTERVAL_MS
}

// A copy placed by `npm install -g` lives under node_modules; a git checkout
// does not, and must never be overwritten by an update.
export function isNpmInstall(path = here) {
  return path.split(sep).includes('node_modules')
}

// The highest released version among the given tag names, or null.
export function newestRelease(tagNames) {
  return tagNames
    .map((name) => RELEASE_TAG.exec(name)?.[1])
    .filter(Boolean)
    .reduce((best, version) => (best && !isNewer(version, best) ? best : version), null)
}

export async function latestVersion() {
  const res = await fetch(TAGS_URL, { headers: { 'user-agent': 'manaflow' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return newestRelease((await res.json()).map((tag) => tag.name))
}

// npm is run through its JavaScript entry point with the current Node, which
// avoids a shell and the .cmd wrapper on Windows.
function npmCli() {
  const nodeDir = dirname(process.execPath)
  return [join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(existsSync)
}

export function installedVersion() {
  return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
}

// Installs the given release over this copy. The running process keeps the
// code it already loaded; the next run starts the new version.
export async function install(version) {
  const cli = npmCli()
  if (!cli) throw new UserError('npm tidak ditemukan di samping Node; perbarui manual dengan `npm install -g github:ImBarka/manaflow`.')
  try {
    await run(process.execPath, [cli, 'install', '-g', '--no-audit', '--no-fund', `github:${REPOSITORY}#v${version}`], {
      timeout: 5 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (err) {
    const reason = String(err.stderr || err.message).trim().split('\n').slice(-2).join(' ')
    throw new UserError(`Pembaruan gagal: ${reason}`)
  }
}

// The released version newer than `current`, or null when up to date.
export async function newerRelease(current) {
  const latest = await latestVersion()
  return latest && isNewer(latest, current) ? latest : null
}
