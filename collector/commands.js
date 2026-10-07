import { randomUUID } from 'node:crypto'
import { hostname, platform } from 'node:os'
import { createInterface } from 'node:readline/promises'

import { collect, collectionWindow } from './codeburn.js'
import { configDir, loadConfig, loadState, removeAll, saveConfig, saveState } from './config.js'
import { UserError } from './errors.js'
import { MAX_SESSIONS_PER_REQUEST, chunk, dayKey, diff, sessionKey, toDay, toSession } from './payload.js'
import { INTERVAL_MINUTES, installSchedule, removeSchedule, scheduleInstalled, schedulerLabel } from './schedule.js'

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

async function post(config, body) {
  let res
  try {
    res = await fetch(`${config.serverUrl}/v1/ingest`, {
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
  if (!res.ok) throw new UserError(`Server menjawab HTTP ${res.status}.`)
  return res.json()
}

function device(config) {
  return { id: config.deviceId, name: config.deviceName, os: platform(), version: config.version }
}

export async function login(args, { version, out }) {
  const previous = loadConfig()
  let serverUrl = flag(args, '--server')
  let token = flag(args, '--token') ?? process.env.MANAFLOW_TOKEN

  out(NOTICE)
  if (!serverUrl || !token) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      serverUrl ??= await rl.question(`\nURL server${previous ? ` [${previous.serverUrl}]` : ''}: `)
      token ??= await rl.question('Token member: ')
    } finally {
      rl.close()
    }
  }
  serverUrl = normalizeServerUrl(serverUrl.trim() || previous?.serverUrl || '')
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
  await post(config, { device: device(config) })
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
      const result = await post(config, { device: device(config), ...batch })
      rejected += result.rejected ?? 0
      for (const s of batch.sessions) sent[sessionKey(s)] = seen[sessionKey(s)]
      for (const d of batch.daily) sent[dayKey(d)] = seen[dayKey(d)]
    }
  } finally {
    saveState({ sent, lastPush: batches.length ? new Date().toISOString() : state.lastPush })
  }

  out(
    `Terkirim: ${changedSessions.length} sesi, ${changedDays.length} hari` +
      (rejected ? ` (${rejected} ditolak server)` : '') +
      `. Tidak berubah: ${collected.sessions.length - changedSessions.length} sesi.\n`,
  )
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
