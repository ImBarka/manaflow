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

function newToken(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const b64 = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `${prefix}_${b64}`
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
  const body = await readJson(request)
  const name = str(body?.name, 80).trim()
  if (!name) return json(400, { error: 'name is required' })
  const position = str(body.position, 80).trim()

  const token = newToken('mf')
  const row = await env.DB.prepare(
    'INSERT INTO members (name, position, token_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id',
  )
    .bind(name, position, await sha256Hex(token), new Date().toISOString())
    .first()
  // The token is returned once and never stored in clear.
  return json(201, { id: row.id, name, position, token })
}

async function createViewer(request, env) {
  const body = await readJson(request)
  const name = str(body?.name, 80).trim()
  if (!name) return json(400, { error: 'name is required' })

  const token = newToken('mfv')
  const row = await env.DB.prepare('INSERT INTO viewers (name, token_hash, created_at) VALUES (?, ?, ?) RETURNING id')
    .bind(name, await sha256Hex(token), new Date().toISOString())
    .first()
  return json(201, { id: row.id, name, token })
}

async function listMembers(env) {
  const rows = await env.DB.prepare(
    `SELECT m.id, m.name, m.position, m.created_at AS createdAt, m.revoked_at AS revokedAt,
            COUNT(d.id) AS devices, MAX(d.last_seen) AS lastSeen
     FROM members m LEFT JOIN devices d ON d.member_id = m.id
     GROUP BY m.id ORDER BY m.name COLLATE NOCASE`,
  ).all()
  return json(200, { members: rows.results })
}

async function updateMember(request, env, id) {
  const body = await readJson(request)
  const name = str(body?.name, 80).trim()
  if (!name) return json(400, { error: 'name is required' })
  const result = await env.DB.prepare('UPDATE members SET name = ?, position = ? WHERE id = ?')
    .bind(name, str(body.position, 80).trim(), id)
    .run()
  return result.meta.changes ? json(200, { ok: true }) : json(404, { error: 'not found' })
}

// Issues a fresh token and lifts any revocation; the old token stops working.
async function rotateMemberToken(env, id) {
  const token = newToken('mf')
  const result = await env.DB.prepare('UPDATE members SET token_hash = ?, revoked_at = NULL WHERE id = ?')
    .bind(await sha256Hex(token), id)
    .run()
  return result.meta.changes ? json(200, { id, token }) : json(404, { error: 'not found' })
}

// Only for entries made by mistake: a member that has pushed data keeps it, and
// is revoked instead.
async function deleteMember(env, id) {
  const device = await env.DB.prepare('SELECT 1 FROM devices WHERE member_id = ? LIMIT 1').bind(id).first()
  if (device) return json(409, { error: 'member has devices; revoke instead' })
  const result = await env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id).run()
  return result.meta.changes ? json(200, { ok: true }) : json(404, { error: 'not found' })
}

async function listViewers(env) {
  const rows = await env.DB.prepare(
    'SELECT id, name, created_at AS createdAt, revoked_at AS revokedAt FROM viewers ORDER BY name COLLATE NOCASE',
  ).all()
  return json(200, { viewers: rows.results })
}

async function revoke(env, table, id) {
  const result = await env.DB.prepare(`UPDATE ${table} SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(new Date().toISOString(), id)
    .run()
  return json(200, { ok: true, changed: result.meta.changes > 0 })
}

const ADMIN_PATH = /^\/v1\/admin\/(members|viewers)(?:\/(\d+)(?:\/(revoke|token))?)?$/

async function admin(request, env, [, kind, rawId, action]) {
  if (!(await isAdmin(request, env))) return json(401, { error: 'unauthorized' })
  const id = rawId ? Number(rawId) : null
  const route = `${request.method} ${kind}${id ? '/:id' : ''}${action ? `/${action}` : ''}`
  if (route === 'GET members') return listMembers(env)
  if (route === 'POST members') return createMember(request, env)
  if (route === 'POST members/:id') return updateMember(request, env, id)
  if (route === 'DELETE members/:id') return deleteMember(env, id)
  if (route === 'POST members/:id/revoke') return revoke(env, 'members', id)
  if (route === 'POST members/:id/token') return rotateMemberToken(env, id)
  if (route === 'GET viewers') return listViewers(env)
  if (route === 'POST viewers') return createViewer(request, env)
  if (route === 'POST viewers/:id/revoke') return revoke(env, 'viewers', id)
  return json(404, { error: 'not found' })
}

const RETENTION_DAYS = 92

async function purge(env, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE ended_at != '' AND ended_at < ?").bind(cutoff),
    env.DB.prepare('DELETE FROM daily WHERE day < ?').bind(cutoff.slice(0, 10)),
  ])
}

async function isViewer(request, env) {
  const token = bearer(request)
  if (!token) return false
  const viewer = await env.DB.prepare('SELECT id FROM viewers WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await sha256Hex(token))
    .first()
  return Boolean(viewer)
}

function isoDay(date) {
  return date.toISOString().slice(0, 10)
}

function dayRange(url) {
  const to = url.searchParams.get('to') ?? isoDay(new Date())
  const from = url.searchParams.get('from') ?? isoDay(new Date(Date.now() - 29 * 86_400_000))
  return DAY.test(from) && DAY.test(to) && from <= to ? { from, to } : null
}

// A session belongs to a range when one of its per-day segments falls in it.
const IN_RANGE = `EXISTS (SELECT 1 FROM json_each(s.segments) seg WHERE json_extract(seg.value, '$.day') BETWEEN ? AND ?)`

async function dashboard(request, env, url) {
  if (!(await isViewer(request, env))) return json(401, { error: 'unauthorized' })
  const range = dayRange(url)
  if (!range) return json(400, { error: 'from and to must be YYYY-MM-DD, from <= to' })
  const { from, to } = range

  const [members, devices, daily, usage, sessions] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, position, revoked_at IS NOT NULL AS revoked FROM members'),
    env.DB.prepare('SELECT id, member_id AS memberId, name, os, collector_version AS version, last_seen AS lastSeen FROM devices'),
    env.DB.prepare(
      `SELECT day, member_id AS memberId, device_id AS deviceId, cost, calls, turns,
              edit_turns AS editTurns, one_shot_turns AS oneShotTurns
       FROM daily WHERE day BETWEEN ? AND ?`,
    ).bind(from, to),
    env.DB.prepare(
      `SELECT s.member_id AS memberId, s.device_id AS deviceId, s.provider,
              json_extract(seg.value, '$.category') AS category, m.key AS model,
              SUM(json_extract(m.value, '$.cost')) AS cost, SUM(json_extract(m.value, '$.calls')) AS calls,
              SUM(json_extract(m.value, '$.inputTokens')) AS inputTokens,
              SUM(json_extract(m.value, '$.outputTokens')) AS outputTokens
       FROM sessions s, json_each(s.segments) seg, json_each(json_extract(seg.value, '$.models')) m
       WHERE json_extract(seg.value, '$.day') BETWEEN ? AND ?
       GROUP BY 1, 2, 3, 4, 5`,
    ).bind(from, to),
    env.DB.prepare(
      `SELECT s.member_id AS memberId, s.device_id AS deviceId, COUNT(*) AS sessions,
              SUM(s.input_tokens) AS inputTokens, SUM(s.cache_read_tokens) AS cacheReadTokens,
              SUM(s.cache_write_tokens) AS cacheWriteTokens
       FROM sessions s WHERE ${IN_RANGE} GROUP BY 1, 2`,
    ).bind(from, to),
  ])
  return json(200, {
    from,
    to,
    members: members.results,
    devices: devices.results,
    daily: daily.results,
    usage: usage.results,
    sessions: sessions.results,
  })
}

async function memberSessions(request, env, url) {
  if (!(await isViewer(request, env))) return json(401, { error: 'unauthorized' })
  const range = dayRange(url)
  const memberId = Number(url.searchParams.get('member'))
  if (!range || !Number.isInteger(memberId)) return json(400, { error: 'member, from and to are required' })

  const rows = await env.DB.prepare(
    `SELECT s.provider, s.session_id AS sessionId, s.device_id AS deviceId, s.title, s.project, s.models, s.cost,
            s.calls, s.turns, s.input_tokens AS inputTokens, s.output_tokens AS outputTokens,
            s.cache_read_tokens AS cacheReadTokens, s.cache_write_tokens AS cacheWriteTokens,
            s.started_at AS startedAt, s.ended_at AS endedAt, s.duration_ms AS durationMs
     FROM sessions s WHERE s.member_id = ? AND ${IN_RANGE}
     ORDER BY s.started_at DESC LIMIT 500`,
  )
    .bind(memberId, range.from, range.to)
    .all()
  return json(200, { sessions: rows.results.map((row) => ({ ...row, models: JSON.parse(row.models) })) })
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

export { purge }

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const route = `${request.method} ${url.pathname}`
    if (route === 'GET /v1/health') return json(200, { ok: true })
    if (route === 'POST /v1/ingest') return ingest(request, env)
    if (route === 'GET /v1/dashboard') return dashboard(request, env, url)
    if (route === 'GET /v1/sessions') return memberSessions(request, env, url)
    const adminRoute = url.pathname.match(ADMIN_PATH)
    if (adminRoute) return admin(request, env, adminRoute)
    return json(404, { error: 'not found' })
  },
  // Daily cron: drop data past the retention window.
  async scheduled(_event, env) {
    await purge(env)
  },
}
