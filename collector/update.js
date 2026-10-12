import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { UserError } from './errors.js'

const run = promisify(execFile)

// Where `npm install -g` gets the collector from, and where the newest version
// number is read. Whoever can push to this repository's main branch decides
// what runs on every laptop that has auto-update on.
const PACKAGE_SPEC = 'github:ImBarka/manaflow'
const LATEST_URL = 'https://raw.githubusercontent.com/ImBarka/manaflow/main/package.json'
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

export async function latestVersion() {
  const res = await fetch(LATEST_URL, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()).version
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

// Installs the newest collector over this one. The running process keeps the
// code it already loaded; the next run starts the new version.
export async function installLatest() {
  const cli = npmCli()
  if (!cli) throw new UserError('npm tidak ditemukan di samping Node; perbarui manual dengan `npm install -g github:ImBarka/manaflow`.')
  try {
    await run(process.execPath, [cli, 'install', '-g', '--no-audit', '--no-fund', PACKAGE_SPEC], {
      timeout: 5 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (err) {
    const reason = String(err.stderr || err.message).trim().split('\n').slice(-2).join(' ')
    throw new UserError(`Pembaruan gagal: ${reason}`)
  }
}

// Returns the version moved to, or null when there was nothing to do.
export async function updateIfNewer(current) {
  const latest = await latestVersion()
  if (!isNewer(latest, current)) return null
  await installLatest()
  return latest
}
