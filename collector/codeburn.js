import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { mergeDaily } from './payload.js'

const run = promisify(execFile)
const require = createRequire(import.meta.url)

function codeburnBin() {
  const pkgPath = require.resolve('codeburn/package.json')
  return join(dirname(pkgPath), require(pkgPath).bin.codeburn)
}

async function codeburnJson(args) {
  const { stdout } = await run(process.execPath, [codeburnBin(), ...args], {
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '--no-deprecation' },
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
