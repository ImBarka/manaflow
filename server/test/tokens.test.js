import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'

import worker from '../src/index.js'

const ADMIN_TOKEN = 'test-admin-token'

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
  const res = await call('POST', '/v1/admin/members', { token: ADMIN_TOKEN, body: { name, position: 'Tester' } })
  assert.equal(res.status, 201)
  return res.json()
}

const push = (token, device) => call('POST', '/v1/ingest', { token, body: { device } }).then((res) => res.status)

test('an extra token adds a laptop without disconnecting the first, and rotation ends both', async () => {
  const member = await createMember('Two Laptops')
  const first = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'L1' }
  const second = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'L2' }

  assert.equal((await call('POST', `/v1/admin/members/${member.id}/extra-token`)).status, 401)
  const extra = await (await call('POST', `/v1/admin/members/${member.id}/extra-token`, { token: ADMIN_TOKEN })).json()
  assert.notEqual(extra.token, member.token)

  assert.equal(await push(member.token, first), 200)
  assert.equal(await push(extra.token, second), 200)
  // Same member behind both tokens, so either may push for either device.
  assert.equal(await push(extra.token, first), 200)

  const { members } = await (await call('GET', '/v1/admin/members', { token: ADMIN_TOKEN })).json()
  const row = members.find((m) => m.id === member.id)
  assert.deepEqual({ devices: row.devices, tokens: row.tokens }, { devices: 2, tokens: 2 })

  const rotated = await (await call('POST', `/v1/admin/members/${member.id}/token`, { token: ADMIN_TOKEN })).json()
  assert.equal(await push(member.token, first), 401)
  assert.equal(await push(extra.token, second), 401)
  assert.equal(await push(rotated.token, second), 200)
})

test('a revoked member cannot be given an extra token, and its extra tokens stop working', async () => {
  const member = await createMember('Revoked Extra')
  const extra = await (await call('POST', `/v1/admin/members/${member.id}/extra-token`, { token: ADMIN_TOKEN })).json()
  await call('POST', `/v1/admin/members/${member.id}/revoke`, { token: ADMIN_TOKEN })
  assert.equal(await push(extra.token, { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'M' }), 401)
  assert.equal((await call('POST', `/v1/admin/members/${member.id}/extra-token`, { token: ADMIN_TOKEN })).status, 404)
})

test('one member with two laptops is not double counted as two people', async () => {
  const member = await createMember('Counted Once')
  const extra = await (await call('POST', `/v1/admin/members/${member.id}/extra-token`, { token: ADMIN_TOKEN })).json()
  await push(member.token, { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'N1' })
  await push(extra.token, { id: 'abababab-abab-4bab-8bab-abababababab', name: 'N2' })
  const devices = await env.DB.prepare('SELECT DISTINCT member_id FROM devices WHERE name IN (?, ?)').bind('N1', 'N2').all()
  assert.deepEqual(devices.results, [{ member_id: member.id }])
})
