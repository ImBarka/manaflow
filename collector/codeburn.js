import { execFile } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { configDir } from './config.js'
import { mergeDaily } from './payload.js'

const run = promisify(execFile)
const require = createRequire(import.meta.url)

// manaflow keeps its own codeburn cache, apart from the one the member's own
// codeburn uses, so it can be rebuilt without touching theirs.
function cacheDir() {
  return join(configDir(), 'cache')
}

function codeburnBin() {
  const pkgPath = require.resolve('codeburn/package.json')
  return join(dirname(pkgPath), require(pkgPath).bin.codeburn)
}

async function codeburnJson(args) {
  const { stdout } = await run(process.execPath, [codeburnBin(), ...args], {
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '--no-deprecation', CODEBURN_CACHE_DIR: cacheDir() },
    windowsHide: true,
  })
  return JSON.parse(stdout)
}

function isoDay(date) {
  return date.toLocaleDateString('en-CA')
}

// Explicit dates on purpose: codeburn's named periods do not cover the same
// range across commands.
export function collectionWindow(days, now = new Date()) {
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { from: isoDay(from), to: isoDay(now) }
}

export async function collect({ from, to }) {
  const range = ['--from', from, '--to', to, '--format', 'json']
  const sessions = await codeburnJson(['sessions', ...range, '--contributions'])
  // One report per provider: codeburn's all-provider report was seen dropping
  // whole days (0.9.25) that the per-provider reports and `sessions` include.
  const reports = []
  for (const provider of new Set(sessions.map((s) => s.provider))) {
    reports.push(await codeburnJson(['report', ...range, '--provider', provider]))
  }
  return { sessions, daily: mergeDaily(reports.map((r) => r.daily ?? [])) }
}

export function usagePayload(period) {
  return codeburnJson(['status', '--format', 'menubar-json', '--period', period, '--no-optimize'])
}

// Recent sessions that have a context tree; empty when the tool is not in use.
export async function contextList(provider) {
  try {
    const listed = await codeburnJson(['context', '--list', '--json', '--provider', provider])
    return Array.isArray(listed.sessions) ? listed.sessions : []
  } catch {
    return []
  }
}

export async function contextTree(provider, sessionId) {
  try {
    return await codeburnJson(['context', sessionId, '--json', '--provider', provider])
  } catch {
    return null
  }
}

// Drops codeburn's durable daily history so the next run rebuilds it from the
// session files. Only ever touches manaflow's own cache directory.
export function resetDailyCache() {
  for (const file of readdirSync(cacheDir())) {
    if (file.startsWith('daily-cache')) rmSync(join(cacheDir(), file), { force: true })
  }
}
