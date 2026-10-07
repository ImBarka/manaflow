import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'

import worker, { purge } from '../src/index.js'

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
  const res = await call('POST', '/v1/admin/members', { token: ADMIN_TOKEN, body: { name, position: 'Data Engineer' } })
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

test('admin routes all require the admin token', async () => {
  const member = await createMember('Plain')
  for (const [method, path] of [['GET', '/v1/admin/members'], ['GET', '/v1/admin/viewers'], ['POST', `/v1/admin/members/${member.id}/revoke`]]) {
    assert.equal((await call(method, path)).status, 401)
    assert.equal((await call(method, path, { token: member.token })).status, 401)
  }
})

test('a revoked member can no longer push, and a rotated token restores access', async () => {
  const member = await createMember('Rotating')
  const device = { id: '66666666-6666-4666-8666-666666666666', name: 'F' }
  assert.equal((await call('POST', '/v1/ingest', { token: member.token, body: { device } })).status, 200)

  assert.equal((await call('POST', `/v1/admin/members/${member.id}/revoke`, { token: ADMIN_TOKEN })).status, 200)
  assert.equal((await call('POST', '/v1/ingest', { token: member.token, body: { device } })).status, 401)

  const rotated = await (await call('POST', `/v1/admin/members/${member.id}/token`, { token: ADMIN_TOKEN })).json()
  assert.notEqual(rotated.token, member.token)
  assert.equal((await call('POST', '/v1/ingest', { token: member.token, body: { device } })).status, 401)
  assert.equal((await call('POST', '/v1/ingest', { token: rotated.token, body: { device } })).status, 200)
})

test('admin can rename a member and sees device counts in the list', async () => {
  const member = await createMember('Old Name')
  const device = { id: '77777777-7777-4777-8777-777777777777', name: 'G' }
  await call('POST', '/v1/ingest', { token: member.token, body: { device } })
  assert.equal((await call('POST', `/v1/admin/members/${member.id}`, { token: ADMIN_TOKEN, body: { name: 'New Name', position: 'IT Support' } })).status, 200)
  assert.equal((await call('POST', '/v1/admin/members/999999', { token: ADMIN_TOKEN, body: { name: 'x' } })).status, 404)

  const { members } = await (await call('GET', '/v1/admin/members', { token: ADMIN_TOKEN })).json()
  const row = members.find((m) => m.id === member.id)
  assert.deepEqual({ name: row.name, position: row.position, devices: row.devices }, { name: 'New Name', position: 'IT Support', devices: 1 })
  assert.ok(!('token_hash' in row) && !('tokenHash' in row))
})

test('a revoked dashboard token stops working', async () => {
  const viewer = await createViewer('Temp')
  assert.equal((await call('GET', '/v1/dashboard', { token: viewer.token })).status, 200)
  assert.equal((await call('POST', `/v1/admin/viewers/${viewer.id}/revoke`, { token: ADMIN_TOKEN })).status, 200)
  assert.equal((await call('GET', '/v1/dashboard', { token: viewer.token })).status, 401)
})

test('purge deletes data older than the retention window and keeps the rest', async () => {
  const member = await createMember('Retention')
  const device = { id: '88888888-8888-4888-8888-888888888888', name: 'H' }
  const sessions = [
    session({ sessionId: 'old', endedAt: '2026-01-01T00:00:00.000Z' }),
    session({ sessionId: 'recent', endedAt: '2026-06-20T00:00:00.000Z' }),
  ]
  const daily = [{ day: '2026-01-01', cost: 1 }, { day: '2026-06-20', cost: 1 }]
  await call('POST', '/v1/ingest', { token: member.token, body: { device, sessions, daily } })

  await purge(env, new Date('2026-07-01T00:00:00.000Z'))

  const left = await env.DB.prepare('SELECT session_id FROM sessions WHERE device_id = ?').bind(device.id).all()
  assert.deepEqual(left.results.map((r) => r.session_id), ['recent'])
  const days = await env.DB.prepare('SELECT day FROM daily WHERE device_id = ?').bind(device.id).all()
  assert.deepEqual(days.results.map((r) => r.day), ['2026-06-20'])
})

test('a member can be deleted only while it has no device', async () => {
  const empty = await createMember('Mistake')
  const used = await createMember('Used')
  await call('POST', '/v1/ingest', { token: used.token, body: { device: { id: '99999999-9999-4999-8999-999999999999', name: 'I' } } })

  assert.equal((await call('DELETE', `/v1/admin/members/${empty.id}`)).status, 401)
  assert.equal((await call('DELETE', `/v1/admin/members/${used.id}`, { token: ADMIN_TOKEN })).status, 409)
  assert.equal((await call('DELETE', `/v1/admin/members/${empty.id}`, { token: ADMIN_TOKEN })).status, 200)
  assert.equal((await call('DELETE', `/v1/admin/members/${empty.id}`, { token: ADMIN_TOKEN })).status, 404)

  const { members } = await (await call('GET', '/v1/admin/members', { token: ADMIN_TOKEN })).json()
  assert.ok(!members.some((m) => m.id === empty.id))
  assert.ok(members.some((m) => m.id === used.id))
})

test('usage payloads and context trees are stored per device and readable only by a viewer', async () => {
  const member = await createMember('Payloads')
  const other = await createMember('Intruder')
  const viewer = await createViewer('Lead 3')
  const device = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'J' }
  const payload = { generated: 'now', current: { label: 'Today', cost: 1.25 }, history: { daily: [] } }

  const early = await call('POST', '/v1/ingest/usage', { token: member.token, body: { device, period: 'today', payload } })
  assert.equal(early.status, 400, 'device must be registered through /v1/ingest first')

  await call('POST', '/v1/ingest', { token: member.token, body: { device } })
  assert.equal((await call('POST', '/v1/ingest/usage', { token: member.token, body: { device, period: 'today', payload } })).status, 200)
  assert.equal((await call('POST', '/v1/ingest/usage', { token: other.token, body: { device, period: 'today', payload } })).status, 403)
  assert.equal((await call('POST', '/v1/ingest/usage', { token: member.token, body: { device, period: 'decade', payload } })).status, 400)

  const tree = { model: 'Opus 5', effective: { tokens: 1000 } }
  const sent = await call('POST', '/v1/ingest/context', {
    token: member.token,
    body: { device, provider: 'claude', sessions: [{ sessionId: 'ctx-1', title: 'T', project: 'p', mtimeMs: 5, sizeBytes: 9, tree }, { sessionId: '', tree }] },
  })
  assert.deepEqual(await sent.json(), { accepted: 1, rejected: 1 })

  assert.equal((await call('GET', `/v1/usage?device=${device.id}&period=today`, { token: member.token })).status, 401)
  const usage = await (await call('GET', `/v1/usage?device=${device.id}&period=today`, { token: viewer.token })).json()
  assert.deepEqual(usage.payload, payload)
  assert.equal((await call('GET', `/v1/usage?device=${device.id}&period=week`, { token: viewer.token })).status, 404)

  const list = await (await call('GET', `/v1/context/sessions?device=${device.id}&provider=claude`, { token: viewer.token })).json()
  assert.deepEqual(list.sessions, [{ provider: 'claude', sessionId: 'ctx-1', title: 'T', project: 'p', mtimeMs: 5, sizeBytes: 9 }])
  const got = await (await call('GET', `/v1/context/tree?device=${device.id}&provider=claude&id=ctx-1`, { token: viewer.token })).json()
  assert.deepEqual(got, tree)
})

test('dashboard reports how many sessions each member had per day', async () => {
  const member = await createMember('PerDay')
  const viewer = await createViewer('Lead 4')
  const device = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'K' }
  const seg = (day) => ({ day, category: 'coding', models: { 'Opus 5': { cost: 1, calls: 1, inputTokens: 1, outputTokens: 1 } } })
  const sessions = [
    session({ sessionId: 'a', segments: [seg('2026-08-20'), seg('2026-08-21')] }),
    session({ sessionId: 'b', segments: [seg('2026-08-21')] }),
  ]
  await call('POST', '/v1/ingest', { token: member.token, body: { device, sessions } })
  const data = await (await call('GET', '/v1/dashboard?from=2026-08-01&to=2026-08-31', { token: viewer.token })).json()
  const mine = data.sessionDays.filter((d) => d.memberId === member.id).sort((x, y) => x.day.localeCompare(y.day))
  assert.deepEqual(mine.map((d) => [d.day, d.sessions]), [['2026-08-20', 1], ['2026-08-21', 2]])
})
