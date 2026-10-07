import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  const sql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
  const statements = sql.replace(/^--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
  for (const statement of statements) await env.DB.prepare(statement).run()
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
