import { brand, dateTime, h } from './dom.js'

const TOKEN_KEY = 'manaflow.token'
const SVG_NS = 'http://www.w3.org/2000/svg'
const PERIODS = [7, 30, 90]

const app = document.getElementById('app')
const tooltip = document.getElementById('tooltip')

const state = {
  token: localStorage.getItem(TOKEN_KEY) ?? '',
  days: 30,
  position: '',
  memberId: null,
  sort: 'cost',
  openDay: null,
  data: null,
  sessions: null,
  error: '',
}

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  el.append(...children.flat())
  return el
}

const money = (v) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v)
const compact = (v) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
const count = (v) => new Intl.NumberFormat('id-ID').format(v)
const percent = (part, whole, digits = 0) => (whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '—')
const localDay = (date) => date.toLocaleDateString('en-CA')
const dayLabel = (day) => new Date(`${day}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
const titleCase = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '—')

function duration(ms) {
  const minutes = Math.round(ms / 60_000)
  return minutes < 60 ? `${minutes} mnt` : `${Math.floor(minutes / 60)} j ${minutes % 60} mnt`
}

function range() {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - (state.days - 1))
  return { from: localDay(from), to: localDay(to) }
}

function daysBetween({ from, to }) {
  const days = []
  for (let d = new Date(`${from}T00:00:00`); localDay(d) <= to; d.setDate(d.getDate() + 1)) days.push(localDay(d))
  return days
}

function showTip(event, text) {
  tooltip.textContent = text
  tooltip.hidden = false
  const { width, height } = tooltip.getBoundingClientRect()
  tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - width - 8)}px`
  tooltip.style.top = `${Math.max(event.clientY - height - 12, 8)}px`
}

const hideTip = () => {
  tooltip.hidden = true
}

const tip = (text) => ({ onmousemove: (event) => showTip(event, text), onmouseleave: hideTip })

async function api(path) {
  const res = await fetch(path, { headers: { authorization: `Bearer ${state.token}` } })
  if (res.status === 401) {
    logout('Token ditolak.')
    throw new Error('unauthorized')
  }
  if (!res.ok) throw new Error(`Server menjawab HTTP ${res.status}`)
  return res.json()
}

function logout(error = '') {
  localStorage.removeItem(TOKEN_KEY)
  Object.assign(state, { token: '', data: null, sessions: null, memberId: null, error })
  render()
}

async function load() {
  const { from, to } = range()
  try {
    state.data = await api(`/v1/dashboard?from=${from}&to=${to}`)
    state.error = ''
  } catch (err) {
    if (err.message === 'unauthorized') return
    state.error = err.message
  }
  render()
  if (state.memberId != null) loadSessions()
}

async function loadSessions() {
  const { from, to } = range()
  const memberId = state.memberId
  state.sessions = null
  try {
    const { sessions } = await api(`/v1/sessions?member=${memberId}&from=${from}&to=${to}`)
    if (state.memberId === memberId) state.sessions = sessions
  } catch {
    return
  }
  render()
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (row[field] ?? 0), 0)
}

function groupBy(rows, key) {
  const groups = new Map()
  for (const row of rows) {
    const name = row[key] ?? '—'
    const group = groups.get(name) ?? { name, cost: 0, calls: 0 }
    group.cost += row.cost ?? 0
    group.calls += row.calls ?? 0
    groups.set(name, group)
  }
  return [...groups.values()].sort((a, b) => b.cost - a.cost)
}

function summarize(memberIds) {
  const { data } = state
  const usage = data.usage.filter((row) => memberIds.has(row.memberId))
  const daily = data.daily.filter((row) => memberIds.has(row.memberId))
  const sessions = data.sessions.filter((row) => memberIds.has(row.memberId))
  const input = sum(sessions, 'inputTokens')
  const cacheRead = sum(sessions, 'cacheReadTokens')
  return {
    usage,
    daily,
    cost: sum(usage, 'cost'),
    calls: sum(usage, 'calls'),
    sessions: sum(sessions, 'sessions'),
    editTurns: sum(daily, 'editTurns'),
    oneShotTurns: sum(daily, 'oneShotTurns'),
    cacheHit: percent(cacheRead, input + cacheRead, 1),
  }
}

function niceMax(value) {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 2.5, 5, 10].map((step) => step * power).find((candidate) => candidate >= value)
}

function columnChart(points) {
  const W = 900
  const H = 220
  const left = 48
  const right = 8
  const top = 10
  const bottom = 24
  const plotW = W - left - right
  const plotH = H - top - bottom
  const max = niceMax(Math.max(...points.map((p) => p.cost)))
  const slot = plotW / points.length
  const width = Math.max(1, Math.min(24, slot - 2))
  const y = (value) => top + plotH - (value / max) * plotH
  const labelEvery = Math.ceil(points.length / 8)
  const tick = (value) => `$${value.toLocaleString('en-US', { maximumFractionDigits: max >= 10 ? 0 : 2 })}`

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Biaya per hari' })
  for (let i = 0; i <= 4; i += 1) {
    const value = (max / 4) * i
    chart.append(
      svg('line', { class: i === 0 ? 'baseline' : 'gridline', x1: left, x2: W - right, y1: y(value), y2: y(value) }),
      svg('text', { class: 'tick', x: left - 6, y: y(value) + 4, 'text-anchor': 'end' }, tick(value)),
    )
  }
  points.forEach((point, index) => {
    const x = left + slot * index + (slot - width) / 2
    const barH = (point.cost / max) * plotH
    const r = Math.min(4, width / 2, barH)
    const base = top + plotH
    const column = svg('path', {
      class: 'column',
      d: `M${x},${base} V${base - barH + r} Q${x},${base - barH} ${x + r},${base - barH} H${x + width - r} Q${x + width},${base - barH} ${x + width},${base - barH + r} V${base} Z`,
    })
    const hit = svg('rect', { class: 'hit', x: left + slot * index, y: top, width: slot, height: plotH })
    const group = svg('g', { class: 'slot' }, hit, column)
    const text = `${dayLabel(point.day)}\n${money(point.cost)} · ${count(point.calls)} calls`
    group.addEventListener('mousemove', (event) => showTip(event, text))
    group.addEventListener('mouseleave', hideTip)
    chart.append(group)
    if (index % labelEvery === 0) {
      chart.append(svg('text', { class: 'tick', x: x + width / 2, y: H - 6, 'text-anchor': 'middle' }, dayLabel(point.day)))
    }
  })
  return chart
}

function barList(items, limit = 8) {
  if (!items.length) return h('div', { class: 'empty' }, 'Belum ada data pada periode ini.')
  const top = items.slice(0, limit)
  const rest = items.slice(limit)
  if (rest.length) top.push({ name: `Lainnya (${rest.length})`, cost: sum(rest, 'cost'), calls: sum(rest, 'calls') })
  const total = sum(items, 'cost')
  const max = Math.max(...top.map((item) => item.cost))
  return h(
    'div',
    { class: 'hbars' },
    top.map((item) =>
      h(
        'div',
        { class: 'row', ...tip(`${item.name}\n${money(item.cost)} (${percent(item.cost, total)}) · ${count(item.calls)} calls`) },
        h('div', { class: 'name' }, item.name),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${max > 0 ? (item.cost / max) * 100 : 0}%` })),
        h('div', { class: 'num' }, money(item.cost)),
      ),
    ),
  )
}

// One row per active day, newest first; an opened day lists that day's members.
function dailyRecap(members) {
  const { data } = state
  const names = new Map(members.map((member) => [member.id, member.name]))
  const days = new Map()
  const cell = (day, memberId) => {
    const perMember = days.get(day) ?? new Map()
    days.set(day, perMember)
    const entry = perMember.get(memberId) ?? { cost: 0, calls: 0, sessions: 0, editTurns: 0, oneShotTurns: 0 }
    perMember.set(memberId, entry)
    return entry
  }
  for (const row of data.daily) {
    if (!names.has(row.memberId)) continue
    const entry = cell(row.day, row.memberId)
    entry.cost += row.cost
    entry.calls += row.calls
    entry.editTurns += row.editTurns
    entry.oneShotTurns += row.oneShotTurns
  }
  for (const row of data.sessionDays ?? []) {
    if (names.has(row.memberId)) cell(row.day, row.memberId).sessions += row.sessions
  }
  if (!days.size) return h('div', { class: 'empty' }, 'Belum ada data pada periode ini.')

  const body = []
  for (const day of [...days.keys()].sort().reverse()) {
    const perMember = [...days.get(day).entries()].map(([memberId, entry]) => ({ name: names.get(memberId), ...entry }))
    const open = state.openDay === day
    body.push(
      h(
        'tr',
        { class: 'clickable', 'aria-expanded': String(open), onclick: () => { state.openDay = open ? null : day; render() } },
        h('td', {}, `${open ? '▾' : '▸'} ${dayLabel(day)}`),
        h('td', { class: 'num' }, money(sum(perMember, 'cost'))),
        h('td', { class: 'num' }, count(sum(perMember, 'calls'))),
        h('td', { class: 'num' }, count(sum(perMember, 'sessions'))),
        h('td', { class: 'num' }, oneShot({ editTurns: sum(perMember, 'editTurns'), oneShotTurns: sum(perMember, 'oneShotTurns') })),
        h('td', { class: 'num' }, count(perMember.length)),
      ),
    )
    if (!open) continue
    for (const entry of perMember.sort((a, b) => b.cost - a.cost)) {
      body.push(
        h(
          'tr',
          { class: 'sub' },
          h('td', {}, entry.name),
          h('td', { class: 'num' }, money(entry.cost)),
          h('td', { class: 'num' }, count(entry.calls)),
          h('td', { class: 'num' }, count(entry.sessions)),
          h('td', { class: 'num' }, oneShot(entry)),
          h('td', {}),
        ),
      )
    }
  }
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Tanggal'),
          h('th', { class: 'num' }, 'Biaya'),
          h('th', { class: 'num' }, 'Calls'),
          h('th', { class: 'num' }, 'Sesi'),
          h('th', { class: 'num' }, 'One-shot'),
          h('th', { class: 'num' }, 'Member aktif'),
        ),
      ),
      h('tbody', {}, body),
    ),
  )
}

function tile(label, value, note, hero = false) {
  return h(
    'div',
    { class: `card tile${hero ? ' hero' : ''}` },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    note ? h('div', { class: 'note' }, note) : null,
  )
}

function oneShot(summary) {
  return summary.editTurns ? `${percent(summary.oneShotTurns, summary.editTurns)}` : '—'
}

function memberRows(members) {
  const { data } = state
  const rows = members.map((member) => {
    const summary = summarize(new Set([member.id]))
    const devices = data.devices.filter((device) => device.memberId === member.id)
    return {
      member,
      summary,
      devices: devices.length,
      lastSeen: devices.map((device) => device.lastSeen).sort().at(-1),
      topModel: groupBy(summary.usage, 'model')[0]?.name ?? '—',
    }
  })
  const by = {
    cost: (a, b) => b.summary.cost - a.summary.cost,
    calls: (a, b) => b.summary.calls - a.summary.calls,
    sessions: (a, b) => b.summary.sessions - a.summary.sessions,
    name: (a, b) => a.member.name.localeCompare(b.member.name),
  }
  return rows.sort(by[state.sort])
}

function sortHeader(label, key, numeric = true) {
  return h(
    'th',
    { class: numeric ? 'num' : '', 'aria-sort': state.sort === key ? 'descending' : null },
    h('button', { onclick: () => { state.sort = key; render() } }, `${label}${state.sort === key ? ' ↓' : ''}`),
  )
}

function membersTable(members) {
  const rows = memberRows(members)
  const max = Math.max(...rows.map((row) => row.summary.cost), 0)
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          sortHeader('Nama', 'name', false),
          h('th', {}, 'Posisi'),
          sortHeader('Biaya', 'cost'),
          sortHeader('Calls', 'calls'),
          sortHeader('Sesi', 'sessions'),
          h('th', { class: 'num' }, 'One-shot'),
          h('th', { class: 'num' }, 'Cache hit'),
          h('th', {}, 'Model utama'),
          h('th', { class: 'num' }, 'Device'),
          h('th', {}, 'Kiriman terakhir'),
        ),
      ),
      h(
        'tbody',
        {},
        rows.map(({ member, summary, devices, lastSeen, topModel }) =>
          h(
            'tr',
            {
              class: 'clickable',
              'aria-selected': String(state.memberId === member.id),
              onclick: () => {
                state.memberId = state.memberId === member.id ? null : member.id
                state.sessions = null
                render()
                if (state.memberId != null) loadSessions()
              },
            },
            h('td', {}, member.name, member.revoked ? h('span', { class: 'muted' }, ' (dicabut)') : null),
            h('td', {}, member.position || '—'),
            h(
              'td',
              { class: 'num' },
              h('span', { class: 'cellbar', style: `width:${max > 0 ? (summary.cost / max) * 60 : 0}px` }),
              money(summary.cost),
            ),
            h('td', { class: 'num' }, count(summary.calls)),
            h('td', { class: 'num' }, count(summary.sessions)),
            h('td', { class: 'num', ...tip(`${summary.oneShotTurns} dari ${summary.editTurns} turn edit sekali jadi`) }, oneShot(summary)),
            h('td', { class: 'num' }, summary.cacheHit),
            h('td', {}, topModel),
            h('td', { class: 'num' }, count(devices)),
            h('td', {}, dateTime(lastSeen)),
          ),
        ),
      ),
    ),
  )
}

function memberDetail(member) {
  const { data } = state
  const summary = summarize(new Set([member.id]))
  const devices = data.devices.filter((device) => device.memberId === member.id)
  const deviceName = new Map(devices.map((device) => [device.id, device.name]))
  const sessions = state.sessions

  return h(
    'section',
    {},
    h('div', { class: 'bar' }, h('h1', {}, member.name), h('span', { class: 'muted' }, member.position || '')),
    h(
      'div',
      { class: 'grid two' },
      h('div', { class: 'card' }, h('h2', {}, 'Biaya per model'), barList(groupBy(summary.usage, 'model'))),
      h('div', { class: 'card' }, h('h2', {}, 'Biaya per kategori task'), barList(groupBy(summary.usage.map((u) => ({ ...u, category: titleCase(u.category) })), 'category'))),
    ),
    h(
      'div',
      { class: 'grid two' },
      h('div', { class: 'card' }, h('h2', {}, 'Biaya per tool'), barList(groupBy(summary.usage, 'provider'))),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Device'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Nama'), h('th', {}, 'OS'), h('th', { class: 'num' }, 'Biaya'), h('th', {}, 'Kiriman terakhir'), h('th', {}, ''))),
            h(
              'tbody',
              {},
              devices.map((device) =>
                h(
                  'tr',
                  {},
                  h('td', {}, device.name),
                  h('td', {}, device.os || '—'),
                  h('td', { class: 'num' }, money(sum(summary.usage.filter((u) => u.deviceId === device.id), 'cost'))),
                  h('td', {}, dateTime(device.lastSeen)),
                  h('td', {}, h('a', { class: 'btn', href: `u/?device=${encodeURIComponent(device.id)}` }, 'Usage & Context →')),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, `Sesi${sessions ? ` (${sessions.length})` : ''}`),
      !sessions
        ? h('div', { class: 'empty' }, 'Memuat…')
        : !sessions.length
          ? h('div', { class: 'empty' }, 'Tidak ada sesi pada periode ini.')
          : h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                {},
                h(
                  'thead',
                  {},
                  h(
                    'tr',
                    {},
                    h('th', {}, 'Mulai'),
                    h('th', {}, 'Judul'),
                    h('th', {}, 'Project'),
                    h('th', {}, 'Tool'),
                    h('th', {}, 'Model'),
                    h('th', { class: 'num' }, 'Biaya'),
                    h('th', { class: 'num' }, 'Calls'),
                    h('th', { class: 'num' }, 'Durasi'),
                    h('th', {}, 'Device'),
                  ),
                ),
                h(
                  'tbody',
                  {},
                  sessions.map((s) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, dateTime(s.startedAt)),
                      h('td', { class: 'wrap' }, s.title || '—'),
                      h('td', {}, s.project || '—'),
                      h('td', {}, s.provider),
                      h('td', {}, s.models.join(', ') || '—'),
                      h('td', { class: 'num' }, money(s.cost)),
                      h('td', { class: 'num' }, count(s.calls)),
                      h('td', { class: 'num' }, duration(s.durationMs)),
                      h('td', {}, deviceName.get(s.deviceId) ?? '—'),
                    ),
                  ),
                ),
              ),
            ),
    ),
  )
}

function loginView() {
  const input = h('input', { type: 'password', placeholder: 'Token dashboard', autocomplete: 'off', 'aria-label': 'Token dashboard' })
  const submit = (event) => {
    event.preventDefault()
    state.token = input.value.trim()
    if (!state.token) return
    localStorage.setItem(TOKEN_KEY, state.token)
    load()
  }
  return h(
    'form',
    { class: 'card login', onsubmit: submit },
    brand(),
    h('div', { class: 'muted' }, 'Masukkan token dashboard untuk melihat pemakaian tim.'),
    input,
    state.error ? h('div', { class: 'error' }, state.error) : null,
    h('button', { class: 'btn', type: 'submit' }, 'Masuk'),
  )
}

function dashboardView() {
  const { data } = state
  const positions = [...new Set(data.members.map((member) => member.position).filter(Boolean))].sort()
  const members = data.members.filter((member) => !state.position || member.position === state.position)
  const team = summarize(new Set(members.map((member) => member.id)))
  const active = new Set(team.usage.map((row) => row.memberId)).size
  const selected = members.find((member) => member.id === state.memberId)

  const perDay = new Map(daysBetween(data).map((day) => [day, { day, cost: 0, calls: 0 }]))
  for (const row of team.daily) {
    const point = perDay.get(row.day)
    if (!point) continue
    point.cost += row.cost
    point.calls += row.calls
  }
  const points = [...perDay.values()]

  return [
    h(
      'div',
      { class: 'bar topbar' },
      brand('tim'),
      h('div', { class: 'spacer' }),
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'Periode' },
        PERIODS.map((days) =>
          h('button', { 'aria-pressed': String(state.days === days), onclick: () => { state.days = days; load() } }, `${days} hari`),
        ),
      ),
      h(
        'select',
        { 'aria-label': 'Posisi', onchange: (event) => { state.position = event.target.value; state.memberId = null; render() } },
        h('option', { value: '' }, 'Semua posisi'),
        positions.map((name) => h('option', { value: name, selected: state.position === name ? '' : null }, name)),
      ),
      h('a', { class: 'btn', href: 'u/' }, 'Usage & Context'),
      h('button', { class: 'btn', onclick: () => logout() }, 'Keluar'),
    ),
    state.error ? h('div', { class: 'error' }, state.error) : null,
    h(
      'div',
      { class: 'grid tiles' },
      tile('Total biaya', money(team.cost), 'setara tarif API', true),
      tile('Calls', compact(team.calls)),
      tile('Sesi', count(team.sessions)),
      tile('Member aktif', `${active} / ${members.length}`),
      tile('One-shot', oneShot(team), team.editTurns ? `${count(team.editTurns)} turn edit` : 'belum ada turn edit'),
      tile('Cache hit', team.cacheHit),
    ),
    h(
      'div',
      { class: 'card chart', style: 'margin-bottom:12px' },
      h('h2', {}, `Biaya per hari · ${dayLabel(data.from)} – ${dayLabel(data.to)}`),
      columnChart(points),
    ),
    h(
      'div',
      { class: 'card', style: 'margin-bottom:12px' },
      h('h2', {}, 'Rekap harian · klik tanggal untuk rincian per member'),
      dailyRecap(members),
    ),
    h(
      'div',
      { class: 'grid two' },
      h('div', { class: 'card' }, h('h2', {}, 'Biaya per model'), barList(groupBy(team.usage, 'model'))),
      h('div', { class: 'card' }, h('h2', {}, 'Biaya per tool'), barList(groupBy(team.usage, 'provider'))),
    ),
    h(
      'div',
      { class: 'card', style: 'margin-bottom:24px' },
      h('h2', {}, 'Member · klik baris untuk rincian'),
      members.length ? membersTable(members) : h('div', { class: 'empty' }, 'Belum ada member.'),
    ),
    selected ? memberDetail(selected) : null,
  ]
}

function render() {
  hideTip()
  if (!state.token) app.replaceChildren(loginView())
  else if (!state.data) app.replaceChildren(h('div', { class: 'empty' }, state.error || 'Memuat…'))
  else app.replaceChildren(...dashboardView().filter(Boolean))
}

render()
if (state.token) load()
