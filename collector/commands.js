import { randomUUID } from 'node:crypto'
import { hostname, platform } from 'node:os'
import { createInterface } from 'node:readline/promises'

import { collect, collectionWindow, contextTree, resetDailyCache, usagePayload } from './codeburn.js'
import { configDir, loadConfig, loadState, removeAll, saveConfig, saveState } from './config.js'
import { UserError } from './errors.js'
import { MAX_SESSIONS_PER_REQUEST, chunk, dayKey, diff, sessionKey, toDay, toSession } from './payload.js'
import { INTERVAL_MINUTES, installSchedule, removeSchedule, scheduleInstalled, schedulerLabel } from './schedule.js'
import {
  CONTEXT_BATCH,
  CONTEXT_BUDGET_MS,
  contextKey,
  contextMarker,
  duePeriods,
  historyIsStale,
  payloadFingerprint,
  pendingContextSessions,
  stripContextTree,
  stripUsagePayload,
} from './usage.js'

// The team's server, so a member only has to paste a token. Another deployment
// is reached with --server or MANAFLOW_SERVER.
const DEFAULT_SERVER = 'https://manaflow.manaflow-server.workers.dev'

// Claude Code keeps session files for 30 days; a few extra days cover late pushes.
const WINDOW_DAYS = 35

const NOTICE = `
Manaflow mengirim data pemakaian AI coding dari laptop ini ke dashboard tim.

  Dikirim       : judul sesi, nama project, tool, model, jumlah call dan turn,
                  token, biaya, kategori task, waktu mulai dan selesai.
  Tidak dikirim : isi prompt, jawaban model, kode, isi file.
  Dilihat oleh  : lead dan orang yang diberi akses dashboard.
  Disimpan      : 3 bulan.

Judul sesi dan nama project ikut terkirim apa adanya.
`

function flag(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function normalizeServerUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new UserError(`URL server tidak valid: ${input}`)
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new UserError('URL server harus https.')
  }
  return url.origin
}

async function post(config, path, body) {
  let res
  try {
    res = await fetch(`${config.serverUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    throw new UserError(`Server tidak terjangkau (${err.cause?.code ?? err.name}).`)
  }
  if (res.status === 401) throw new UserError('Token ditolak server. Jalankan `manaflow login` lagi.')
  if (res.status === 403) throw new UserError('Device ini terdaftar atas member lain.')
  if (!res.ok) {
    const detail = await res.json().then((data) => data.error, () => '')
    throw new UserError(`Server menjawab HTTP ${res.status}${detail ? ` (${detail})` : ''} untuk ${path}.`)
  }
  return res.json()
}

function device(config) {
  return { id: config.deviceId, name: config.deviceName, os: platform(), version: config.version }
}

export async function login(args, { version, out }) {
  const previous = loadConfig()
  const serverUrl = normalizeServerUrl(
    flag(args, '--server') ?? process.env.MANAFLOW_SERVER ?? previous?.serverUrl ?? DEFAULT_SERVER,
  )
  let token = flag(args, '--token') ?? process.env.MANAFLOW_TOKEN

  out(NOTICE)
  out(`\nServer: ${serverUrl}\n`)
  if (!token) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      token = await rl.question('Token member: ')
    } finally {
      rl.close()
    }
  }
  token = token.trim()
  if (!token) throw new UserError('Token kosong.')

  const config = {
    serverUrl,
    token,
    deviceId: previous?.deviceId ?? randomUUID(),
    deviceName: flag(args, '--name') ?? previous?.deviceName ?? hostname(),
    version,
  }
  // Registers the device and proves the token works before anything is saved.
  await post(config, '/v1/ingest', { device: device(config) })
  saveConfig(config)
  out(`\nLogin berhasil. Device: ${config.deviceName}\n`)
  if (args.includes('--no-schedule')) {
    out('Jadwal otomatis tidak dipasang. Kirim manual dengan `manaflow push`.\n')
  } else {
    installSchedule()
    out(`Jadwal otomatis terpasang (${schedulerLabel()}): kirim tiap ${INTERVAL_MINUTES} menit.\n`)
  }
  out('Jalankan `manaflow push` untuk kiriman pertama.\n')
}

export async function push(_args, { version, out }) {
  const config = loadConfig()
  if (!config) throw new UserError('Belum login. Jalankan `manaflow login`.')
  config.version = version

  const collected = await collect(collectionWindow(WINDOW_DAYS))
  const state = loadState()
  const { changedSessions, changedDays, seen } = diff(collected.sessions.map(toSession), collected.daily.map(toDay), state.sent)

  // Fingerprints are recorded per accepted batch, so a failure midway resends
  // only what the server has not confirmed.
  const sent = Object.fromEntries(Object.entries(state.sent).filter(([key]) => key in seen))
  const batches = chunk(changedSessions, MAX_SESSIONS_PER_REQUEST).map((sessions) => ({ sessions, daily: [] }))
  if (changedDays.length) batches.push({ sessions: [], daily: changedDays })

  let rejected = 0
  try {
    for (const batch of batches) {
      const result = await post(config, '/v1/ingest', { device: device(config), ...batch })
      rejected += result.rejected ?? 0
      for (const s of batch.sessions) sent[sessionKey(s)] = seen[sessionKey(s)]
      for (const d of batch.daily) sent[dayKey(d)] = seen[dayKey(d)]
    }
  } finally {
    Object.assign(state, { sent, lastPush: batches.length ? new Date().toISOString() : state.lastPush })
    saveState(state)
  }

  out(
    `Terkirim: ${changedSessions.length} sesi, ${changedDays.length} hari` +
      (rejected ? ` (${rejected} ditolak server)` : '') +
      `. Tidak berubah: ${collected.sessions.length - changedSessions.length} sesi.\n`,
  )

  // The per-member Usage and Context views. Sent after the core data so a
  // failure here never costs the sessions above.
  try {
    const periods = await pushUsage(config, state, collected.daily)
    const trees = await pushContexts(config, state, collected.sessions)
    out(`Usage: ${periods} periode. Context: ${trees.sent} sesi${trees.waiting ? ` (${trees.waiting} menunggu kiriman berikutnya)` : ''}.\n`)
  } finally {
    saveState(state)
  }
}

async function pushUsage(config, state, daily) {
  const usage = (state.usage ??= { sentAt: {}, prints: {} })
  let healed = false
  let sentCount = 0
  for (const period of duePeriods(usage.sentAt)) {
    let payload = await usagePayload(period)
    if (!healed && historyIsStale(payload, daily)) {
      resetDailyCache()
      healed = true
      payload = await usagePayload(period)
    }
    const stripped = stripUsagePayload(payload)
    const print = payloadFingerprint(stripped)
    if (usage.prints[period] !== print) {
      await post(config, '/v1/ingest/usage', { device: { id: config.deviceId }, period, payload: stripped })
      usage.prints[period] = print
      sentCount += 1
    }
    usage.sentAt[period] = Date.now()
  }
  return sentCount
}

async function pushContexts(config, state, sessions) {
  delete state.contexts // superseded by contextMarkers
  const markers = (state.contextMarkers ??= {})
  const pending = pendingContextSessions(sessions, markers)
  const deadline = Date.now() + CONTEXT_BUDGET_MS
  const built = { claude: [], codex: [] }
  const done = []
  for (const session of pending) {
    if (Date.now() >= deadline) break
    const tree = await contextTree(session.provider, session.sessionId)
    done.push(session)
    // No tree means codeburn has no transcript for it; it is retried only if the session changes.
    if (!tree) continue
    built[session.provider].push({
      sessionId: session.sessionId,
      title: session.title,
      project: session.project,
      mtimeMs: tree.session?.mtimeMs ?? Date.parse(session.endedAt),
      sizeBytes: tree.session?.sizeBytes ?? 0,
      tree: stripContextTree(tree),
    })
  }

  let sent = 0
  for (const [provider, trees] of Object.entries(built)) {
    for (const batch of chunk(trees, CONTEXT_BATCH)) {
      await post(config, '/v1/ingest/context', { device: { id: config.deviceId }, provider, sessions: batch })
      sent += batch.length
    }
  }
  for (const session of done) markers[contextKey(session)] = contextMarker(session)
  // Sessions that left the collection window drop out, so the state file stays bounded.
  const current = new Set(sessions.map(contextKey))
  for (const key of Object.keys(markers)) if (!current.has(key)) delete markers[key]
  return { sent, waiting: pending.length - done.length }
}

export async function status(_args, { out }) {
  const config = loadConfig()
  if (!config) {
    out('Belum login.\n')
    return
  }
  const state = loadState()
  const sessions = Object.keys(state.sent).filter((key) => key.startsWith('s:')).length
  const scheduled = scheduleInstalled() ? `aktif, tiap ${INTERVAL_MINUTES} menit (${schedulerLabel()})` : 'tidak terpasang'
  out(
    `Server        : ${config.serverUrl}\n` +
      `Device        : ${config.deviceName} (${config.deviceId})\n` +
      `Token         : ${config.token.slice(0, 6)}…\n` +
      `Kiriman akhir : ${state.lastPush ?? 'belum pernah'}\n` +
      `Sesi terlacak : ${sessions}\n` +
      `Jadwal        : ${scheduled}\n` +
      `Folder config : ${configDir()}\n`,
  )
}

export async function schedule(args, { out }) {
  const [action] = args
  if (action === 'on') {
    installSchedule()
    out(`Jadwal otomatis terpasang (${schedulerLabel()}): kirim tiap ${INTERVAL_MINUTES} menit.\n`)
  } else if (action === 'off') {
    removeSchedule()
    out('Jadwal otomatis dilepas.\n')
  } else {
    throw new UserError('Pemakaian: manaflow schedule on|off')
  }
}

export async function uninstall(_args, { out }) {
  removeSchedule()
  removeAll()
  out(`Jadwal dilepas; token dan state dihapus dari ${configDir()}.\nData yang sudah terkirim tetap ada di server.\n`)
}
