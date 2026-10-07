const MAX_BODY_BYTES = 256 * 1024
const MAX_SESSIONS = 50
const MAX_DAYS = 100
const MAX_SEGMENTS_BYTES = 16 * 1024

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function bearer(request) {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const b64 = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `mf_${b64}`
}

async function readJson(request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return null
  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

function str(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function int(value) {
  return Math.round(num(value))
}

// Tokens are high-entropy random strings, so a fast hash is enough and keeps
// auth inside the 10 ms CPU budget of the free plan.
async function isAdmin(request, env) {
  const token = bearer(request)
  if (!token || !env.ADMIN_TOKEN) return false
  return (await sha256Hex(token)) === (await sha256Hex(env.ADMIN_TOKEN))
}

async function createMember(request, env) {
  if (!(await isAdmin(request, env))) return json(401, { error: 'unauthorized' })
  const body = await readJson(request)
  const name = str(body?.name, 80).trim()
  if (!name) return json(400, { error: 'name is required' })
  const team = str(body.team, 80).trim()

  const token = newToken()
  const row = await env.DB.prepare(
    'INSERT INTO members (name, team, token_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id',
  )
    .bind(name, team, await sha256Hex(token), new Date().toISOString())
    .first()
  // The token is returned once and never stored in clear.
  return json(201, { id: row.id, name, team, token })
}

function sessionStatement(db, memberId, deviceId, s, now) {
  const sessionId = str(s?.sessionId, 200)
  const provider = str(s?.provider, 40)
  if (!sessionId || !provider) return null
  const segments = JSON.stringify(Array.isArray(s.segments) ? s.segments : [])
  if (segments.length > MAX_SEGMENTS_BYTES) return null
  const models = JSON.stringify((Array.isArray(s.models) ? s.models : []).slice(0, 20).map((m) => str(m, 80)))
  return db
    .prepare(
      `INSERT INTO sessions (device_id, provider, session_id, member_id, title, project, models, cost, calls, turns,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, started_at, ended_at, duration_ms,
         segments, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (device_id, provider, session_id) DO UPDATE SET
         title = excluded.title, project = excluded.project, models = excluded.models, cost = excluded.cost,
         calls = excluded.calls, turns = excluded.turns, input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens, cache_read_tokens = excluded.cache_read_tokens,
         cache_write_tokens = excluded.cache_write_tokens, started_at = excluded.started_at,
         ended_at = excluded.ended_at, duration_ms = excluded.duration_ms, segments = excluded.segments,
         updated_at = excluded.updated_at`,
    )
    .bind(
      deviceId,
      provider,
      sessionId,
      memberId,
      str(s.title, 300),
      str(s.project, 200),
      models,
      num(s.cost),
      int(s.calls),
      int(s.turns),
      int(s.inputTokens),
      int(s.outputTokens),
      int(s.cacheReadTokens),
      int(s.cacheWriteTokens),
      str(s.startedAt, 40),
      str(s.endedAt, 40),
      int(s.durationMs),
      segments,
      now,
    )
}

function dailyStatement(db, memberId, deviceId, d, now) {
  if (!DAY.test(d?.day ?? '')) return null
  return db
    .prepare(
      `INSERT INTO daily (device_id, day, member_id, cost, calls, turns, edit_turns, one_shot_turns, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (device_id, day) DO UPDATE SET
         cost = excluded.cost, calls = excluded.calls, turns = excluded.turns, edit_turns = excluded.edit_turns,
         one_shot_turns = excluded.one_shot_turns, updated_at = excluded.updated_at`,
    )
    .bind(deviceId, d.day, memberId, num(d.cost), int(d.calls), int(d.turns), int(d.editTurns), int(d.oneShotTurns), now)
}

async function ingest(request, env) {
  const token = bearer(request)
  if (!token) return json(401, { error: 'unauthorized' })
  const member = await env.DB.prepare('SELECT id FROM members WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await sha256Hex(token))
    .first()
  if (!member) return json(401, { error: 'unauthorized' })

  const body = await readJson(request)
  if (!body) return json(400, { error: 'invalid or oversized JSON body' })
  const deviceId = str(body.device?.id, 36)
  if (!DEVICE_ID.test(deviceId)) return json(400, { error: 'device.id must be a UUID' })
  const sessions = Array.isArray(body.sessions) ? body.sessions : []
  const days = Array.isArray(body.daily) ? body.daily : []
  if (sessions.length > MAX_SESSIONS) return json(400, { error: `at most ${MAX_SESSIONS} sessions per request` })
  if (days.length > MAX_DAYS) return json(400, { error: `at most ${MAX_DAYS} days per request` })

  const owner = await env.DB.prepare('SELECT member_id FROM devices WHERE id = ?').bind(deviceId).first()
  if (owner && owner.member_id !== member.id) return json(403, { error: 'device belongs to another member' })

  const now = new Date().toISOString()
  const statements = [
    env.DB.prepare(
      `INSERT INTO devices (id, member_id, name, os, collector_version, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, os = excluded.os, collector_version = excluded.collector_version,
         last_seen = excluded.last_seen`,
    ).bind(deviceId, member.id, str(body.device.name, 80) || 'unknown', str(body.device.os, 20), str(body.device.version, 20), now, now),
  ]
  let rejected = 0
  for (const s of sessions) {
    const stmt = sessionStatement(env.DB, member.id, deviceId, s, now)
    if (stmt) statements.push(stmt)
    else rejected += 1
  }
  for (const d of days) {
    const stmt = dailyStatement(env.DB, member.id, deviceId, d, now)
    if (stmt) statements.push(stmt)
    else rejected += 1
  }
  await env.DB.batch(statements)
  return json(200, { accepted: statements.length - 1, rejected })
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/v1/health') return json(200, { ok: true })
    if (request.method === 'POST' && pathname === '/v1/ingest') return ingest(request, env)
    if (request.method === 'POST' && pathname === '/v1/admin/members') return createMember(request, env)
    return json(404, { error: 'not found' })
  },
}
