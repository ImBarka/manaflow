import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'

import worker from '../src/index.js'

const ADMIN_TOKEN = 'test-admin-token'
const DEVICE_A = '11111111-1111-4111-8111-111111111111'
const DEVICE_B = '22222222-2222-4222-8222-222222222222'

let proxy
let env

before(async () => {
  proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('../wrangler.toml', import.meta.url)), persist: false })
  env = { ...proxy.env, ADMIN_TOKEN }
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8')
    const statements = sql.replace(/^--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
    for (const statement of statements) await env.DB.prepare(statement).run()
  }
})

after(async () => {
  await proxy.dispose()
})

function call(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return worker.fetch(new Request(`https://manaflow.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env)
}

async function createMember(name) {
  const res = await call('POST', '/v1/admin/members', { token: ADMIN_TOKEN, body: { name, team: 'data' } })
  assert.equal(res.status, 201)
  return res.json()
}

function session(overrides = {}) {
  return {
    sessionId: 's-1',
    provider: 'claude',
    title: 'Fix login bug',
    project: 'webapp',
    models: ['Opus 5'],
    cost: 1.5,
    calls: 10,
    turns: 4,
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 3000,
    cacheWriteTokens: 400,
    startedAt: '2026-10-06T01:00:00.000Z',
    endedAt: '2026-10-06T02:00:00.000Z',
    durationMs: 3600000,
    segments: [{ day: '2026-10-06', category: 'coding', models: { 'Opus 5': 1.5 } }],
    ...overrides,
  }
}

test('health responds without auth', async () => {
  const res = await call('GET', '/v1/health')
  assert.equal(res.status, 200)
})

test('admin endpoint rejects a wrong token', async () => {
  const res = await call('POST', '/v1/admin/members', { token: 'nope', body: { name: 'x' } })
  assert.equal(res.status, 401)
})

test('ingest rejects a missing or unknown token', async () => {
  assert.equal((await call('POST', '/v1/ingest', { body: {} })).status, 401)
  assert.equal((await call('POST', '/v1/ingest', { token: 'mf_unknown', body: {} })).status, 401)
})

test('member token is stored hashed, never in clear', async () => {
  const member = await createMember('Hashed')
  assert.match(member.token, /^mf_/)
  const row = await env.DB.prepare('SELECT token_hash FROM members WHERE id = ?').bind(member.id).first()
  assert.notEqual(row.token_hash, member.token)
  assert.match(row.token_hash, /^[0-9a-f]{64}$/)
})

test('ingest stores sessions and daily rows, and resending updates instead of duplicating', async () => {
  const member = await createMember('Ayu')
  const device = { id: DEVICE_A, name: 'LAPTOP-A', os: 'win32', version: '0.1.0' }
  const daily = [{ day: '2026-10-06', cost: 1.5, calls: 10, turns: 4, editTurns: 2, oneShotTurns: 2 }]

  const first = await call('POST', '/v1/ingest', { token: member.token, body: { device, sessions: [session()], daily } })
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { accepted: 2, rejected: 0 })

  const second = await call('POST', '/v1/ingest', {
    token: member.token,
    body: { device, sessions: [session({ cost: 2.25, calls: 15 })], daily },
  })
  assert.equal(second.status, 200)

  const rows = await env.DB.prepare('SELECT cost, calls, title, models FROM sessions WHERE device_id = ?').bind(DEVICE_A).all()
  assert.equal(rows.results.length, 1)
  assert.equal(rows.results[0].cost, 2.25)
  assert.equal(rows.results[0].calls, 15)
  assert.deepEqual(JSON.parse(rows.results[0].models), ['Opus 5'])

  const days = await env.DB.prepare('SELECT edit_turns, one_shot_turns FROM daily WHERE device_id = ?').bind(DEVICE_A).all()
  assert.equal(days.results.length, 1)
  assert.equal(days.results[0].one_shot_turns, 2)
})

test('a device cannot be claimed by a second member', async () => {
  const owner = await createMember('Owner')
  const other = await createMember('Other')
  const device = { id: DEVICE_B, name: 'LAPTOP-B' }
  assert.equal((await call('POST', '/v1/ingest', { token: owner.token, body: { device } })).status, 200)
  assert.equal((await call('POST', '/v1/ingest', { token: other.token, body: { device } })).status, 403)
})

test('ingest validates the device id and the batch size', async () => {
  const member = await createMember('Validator')
  const bad = await call('POST', '/v1/ingest', { token: member.token, body: { device: { id: 'not-a-uuid' } } })
  assert.equal(bad.status, 400)

  const tooMany = Array.from({ length: 51 }, (_, i) => session({ sessionId: `s-${i}` }))
  const res = await call('POST', '/v1/ingest', {
    token: member.token,
    body: { device: { id: '33333333-3333-4333-8333-333333333333', name: 'C' }, sessions: tooMany },
  })
  assert.equal(res.status, 400)
})

test('a session without an id is rejected but the rest of the batch is kept', async () => {
  const member = await createMember('Partial')
  const device = { id: '44444444-4444-4444-8444-444444444444', name: 'D' }
  const res = await call('POST', '/v1/ingest', {
    token: member.token,
    body: { device, sessions: [session({ sessionId: '' }), session({ sessionId: 'ok' })] },
  })
  assert.deepEqual(await res.json(), { accepted: 1, rejected: 1 })
})

async function createViewer(name) {
  const res = await call('POST', '/v1/admin/viewers', { token: ADMIN_TOKEN, body: { name } })
  assert.equal(res.status, 201)
  return res.json()
}

test('dashboard and sessions reject a member token and a missing token', async () => {
  const member = await createMember('NotAViewer')
  assert.equal((await call('GET', '/v1/dashboard')).status, 401)
  assert.equal((await call('GET', '/v1/dashboard', { token: member.token })).status, 401)
  assert.equal((await call('GET', '/v1/sessions?member=1', { token: member.token })).status, 401)
})

test('dashboard aggregates usage per member, model and category inside the range', async () => {
  const member = await createMember('Dewi')
  const viewer = await createViewer('Lead')
  const device = { id: '55555555-5555-4555-8555-555555555555', name: 'LAPTOP-E', os: 'darwin', version: '0.1.0' }
  const sessions = [
    session({
      sessionId: 'in-range',
      segments: [
        { day: '2026-08-10', category: 'coding', models: { 'Opus 5': { cost: 2, calls: 4, inputTokens: 10, outputTokens: 20 } } },
        { day: '2026-08-11', category: 'coding', models: { 'Opus 5': { cost: 1, calls: 1, inputTokens: 5, outputTokens: 5 }, 'Sonnet 5.5': { cost: 0.5, calls: 2, inputTokens: 1, outputTokens: 1 } } },
      ],
    }),
    session({ sessionId: 'out-of-range', segments: [{ day: '2026-07-01', category: 'coding', models: { 'Opus 5': { cost: 99, calls: 9, inputTokens: 0, outputTokens: 0 } } }] }),
  ]
  const daily = [
    { day: '2026-08-10', cost: 2, calls: 4, turns: 2, editTurns: 2, oneShotTurns: 1 },
    { day: '2026-07-01', cost: 99, calls: 9, turns: 1, editTurns: 0, oneShotTurns: 0 },
  ]
  assert.equal((await call('POST', '/v1/ingest', { token: member.token, body: { device, sessions, daily } })).status, 200)

  const res = await call('GET', '/v1/dashboard?from=2026-08-01&to=2026-08-31', { token: viewer.token })
  assert.equal(res.status, 200)
  const data = await res.json()

  const usage = data.usage.filter((u) => u.memberId === member.id)
  const opus = usage.find((u) => u.model === 'Opus 5')
  assert.deepEqual({ cost: opus.cost, calls: opus.calls, provider: opus.provider, category: opus.category }, { cost: 3, calls: 5, provider: 'claude', category: 'coding' })
  assert.equal(usage.find((u) => u.model === 'Sonnet 5.5').cost, 0.5)

  assert.deepEqual(data.daily.filter((d) => d.memberId === member.id).map((d) => d.day), ['2026-08-10'])
  assert.equal(data.sessions.find((s) => s.memberId === member.id).sessions, 1)
  assert.ok(data.members.some((m) => m.id === member.id && m.name === 'Dewi'))
  assert.ok(data.devices.some((d) => d.id === device.id && d.name === 'LAPTOP-E'))

  const list = await call('GET', `/v1/sessions?member=${member.id}&from=2026-08-01&to=2026-08-31`, { token: viewer.token })
  const rows = (await list.json()).sessions
  assert.deepEqual(rows.map((r) => r.sessionId), ['in-range'])
  assert.deepEqual(rows[0].models, ['Opus 5'])
})

test('dashboard rejects a malformed range', async () => {
  const viewer = await createViewer('Lead 2')
  assert.equal((await call('GET', '/v1/dashboard?from=yesterday&to=2026-08-31', { token: viewer.token })).status, 400)
  assert.equal((await call('GET', '/v1/dashboard?from=2026-09-01&to=2026-08-31', { token: viewer.token })).status, 400)
})
