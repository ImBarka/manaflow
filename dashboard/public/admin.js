import { dateTime, h } from './dom.js'

// The admin token is kept for this tab only; closing the tab forgets it.
const TOKEN_KEY = 'manaflow.admin'

const app = document.getElementById('app')

const state = {
  token: sessionStorage.getItem(TOKEN_KEY) ?? '',
  members: [],
  viewers: [],
  // Tokens are shown once, right after they are issued; the server keeps only a hash.
  issued: [],
  error: '',
  busy: false,
}

async function api(method, path, body) {
  const res = await fetch(`/v1/admin/${path}`, {
    method,
    headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    logout('Token admin ditolak.')
    throw new Error('unauthorized')
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

function logout(error = '') {
  sessionStorage.removeItem(TOKEN_KEY)
  Object.assign(state, { token: '', members: [], viewers: [], issued: [], error, busy: false })
  render()
}

async function refresh() {
  const [{ members }, { viewers }] = await Promise.all([api('GET', 'members'), api('GET', 'viewers')])
  Object.assign(state, { members, viewers })
}

// Runs an admin action, then reloads the lists; errors land in the banner.
async function run(action) {
  state.busy = true
  state.error = ''
  render()
  try {
    await action()
    await refresh()
  } catch (err) {
    if (err.message === 'unauthorized') return
    state.error = err.message
  }
  state.busy = false
  render()
}

function parseBulk(text) {
  return text
    .split('\n')
    .map((line) => line.split(/[;\t]/).map((part) => part.trim()))
    .filter(([name]) => name)
    .map(([name, position = '']) => ({ name, position }))
}

function addMembers(rows) {
  return run(async () => {
    for (const row of rows) {
      const created = await api('POST', 'members', row)
      state.issued.push({ kind: 'Member', name: created.name, position: created.position, token: created.token })
    }
  })
}

function loginCommand(token) {
  return `manaflow login --server ${location.origin} --token ${token}`
}

function downloadCsv() {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`
  const lines = [['jenis', 'nama', 'posisi', 'token'], ...state.issued.map((row) => [row.kind, row.name, row.position, row.token])]
  const blob = new Blob([lines.map((line) => line.map(quote).join(',')).join('\n')], { type: 'text/csv' })
  const link = h('a', { href: URL.createObjectURL(blob), download: 'manaflow-token.csv' })
  link.click()
  URL.revokeObjectURL(link.href)
}

function copyButton(text, label = 'Salin') {
  const button = h('button', { class: 'btn', type: 'button' }, label)
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(text)
    button.textContent = 'Tersalin'
    setTimeout(() => { button.textContent = label }, 1500)
  })
  return button
}

function issuedPanel() {
  if (!state.issued.length) return null
  return h(
    'div',
    { class: 'card', style: 'margin-bottom:12px' },
    h('h2', {}, 'Token baru · hanya tampil sekali, simpan sekarang'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Jenis'), h('th', {}, 'Nama'), h('th', {}, 'Posisi'), h('th', {}, 'Token'), h('th', {}, ''))),
        h(
          'tbody',
          {},
          state.issued.map((row) =>
            h(
              'tr',
              {},
              h('td', {}, row.kind),
              h('td', {}, row.name),
              h('td', {}, row.position || '—'),
              h('td', {}, h('code', {}, row.token)),
              h(
                'td',
                {},
                copyButton(row.token, 'Salin token'),
                ' ',
                row.kind === 'Member' ? copyButton(loginCommand(row.token), 'Salin perintah login') : null,
              ),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'bar', style: 'margin:12px 0 0' },
      h('button', { class: 'btn', type: 'button', onclick: downloadCsv }, 'Unduh CSV'),
      h('button', { class: 'btn', type: 'button', onclick: () => { state.issued = []; render() } }, 'Sudah disimpan, sembunyikan'),
    ),
  )
}

function membersCard() {
  const name = h('input', { placeholder: 'Nama', 'aria-label': 'Nama member' })
  const position = h('input', { placeholder: 'Posisi', 'aria-label': 'Posisi' })
  const bulk = h('textarea', { rows: '5', placeholder: 'Satu member per baris: Nama; Posisi', 'aria-label': 'Tambah banyak member' })

  const edit = (member) => {
    const newName = prompt('Nama', member.name)
    if (newName == null) return
    const newPosition = prompt('Posisi', member.position)
    if (newPosition == null) return
    run(() => api('POST', `members/${member.id}`, { name: newName, position: newPosition }))
  }
  const rotate = (member) => {
    if (!confirm(`Buat token baru untuk ${member.name}? Token lamanya langsung tidak berlaku.`)) return
    run(async () => {
      const { token } = await api('POST', `members/${member.id}/token`)
      state.issued.push({ kind: 'Member', name: member.name, position: member.position, token })
    })
  }
  const revoke = (member) => {
    if (!confirm(`Cabut token ${member.name}? Laptopnya berhenti bisa mengirim; data lama tetap ada.`)) return
    run(() => api('POST', `members/${member.id}/revoke`))
  }

  // Offered only while the member has no device, i.e. nothing was ever pushed.
  const remove = (member) => {
    if (!confirm(`Hapus ${member.name}? Tidak bisa dibatalkan.`)) return
    run(() => api('DELETE', `members/${member.id}`))
  }

  return h(
    'div',
    { class: 'card', style: 'margin-bottom:12px' },
    h('h2', {}, `Member (${state.members.length})`),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, 'Nama'), h('th', {}, 'Posisi'), h('th', { class: 'num' }, 'Device'), h('th', {}, 'Kiriman terakhir'), h('th', {}, 'Status'), h('th', {}, '')),
        ),
        h(
          'tbody',
          {},
          state.members.map((member) =>
            h(
              'tr',
              {},
              h('td', {}, member.name),
              h('td', {}, member.position || '—'),
              h('td', { class: 'num' }, String(member.devices)),
              h('td', {}, dateTime(member.lastSeen)),
              h('td', {}, member.revokedAt ? 'Dicabut' : member.devices ? 'Aktif' : 'Belum login'),
              h(
                'td',
                {},
                h('button', { class: 'btn', type: 'button', onclick: () => edit(member) }, 'Ubah'),
                ' ',
                h('button', { class: 'btn', type: 'button', onclick: () => rotate(member) }, 'Token baru'),
                ' ',
                member.revokedAt ? null : h('button', { class: 'btn', type: 'button', onclick: () => revoke(member) }, 'Cabut'),
                ' ',
                member.devices ? null : h('button', { class: 'btn', type: 'button', onclick: () => remove(member) }, 'Hapus'),
              ),
            ),
          ),
        ),
      ),
    ),
    h(
      'form',
      {
        class: 'bar',
        style: 'margin:16px 0 0',
        onsubmit: (event) => {
          event.preventDefault()
          if (name.value.trim()) addMembers([{ name: name.value.trim(), position: position.value.trim() }])
        },
      },
      name,
      position,
      h('button', { class: 'btn', type: 'submit' }, 'Tambah member'),
    ),
    h(
      'details',
      {},
      h('summary', {}, 'Tambah banyak sekaligus'),
      bulk,
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            const rows = parseBulk(bulk.value)
            if (rows.length && confirm(`Buat ${rows.length} member?`)) addMembers(rows)
          },
        },
        'Buat semua',
      ),
    ),
  )
}

function viewersCard() {
  const name = h('input', { placeholder: 'Nama', 'aria-label': 'Nama pemegang akses' })
  const revoke = (viewer) => {
    if (!confirm(`Cabut akses dashboard ${viewer.name}?`)) return
    run(() => api('POST', `viewers/${viewer.id}/revoke`))
  }
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, `Akses dashboard (${state.viewers.length})`),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Nama'), h('th', {}, 'Dibuat'), h('th', {}, 'Status'), h('th', {}, ''))),
        h(
          'tbody',
          {},
          state.viewers.map((viewer) =>
            h(
              'tr',
              {},
              h('td', {}, viewer.name),
              h('td', {}, dateTime(viewer.createdAt)),
              h('td', {}, viewer.revokedAt ? 'Dicabut' : 'Aktif'),
              h('td', {}, viewer.revokedAt ? null : h('button', { class: 'btn', type: 'button', onclick: () => revoke(viewer) }, 'Cabut')),
            ),
          ),
        ),
      ),
    ),
    h(
      'form',
      {
        class: 'bar',
        style: 'margin:16px 0 0',
        onsubmit: (event) => {
          event.preventDefault()
          const value = name.value.trim()
          if (!value) return
          run(async () => {
            const created = await api('POST', 'viewers', { name: value })
            state.issued.push({ kind: 'Dashboard', name: created.name, position: '', token: created.token })
          })
        },
      },
      name,
      h('button', { class: 'btn', type: 'submit' }, 'Beri akses'),
    ),
  )
}

function loginView() {
  const input = h('input', { type: 'password', placeholder: 'Token admin', autocomplete: 'off', 'aria-label': 'Token admin' })
  return h(
    'form',
    {
      class: 'card login',
      onsubmit: (event) => {
        event.preventDefault()
        state.token = input.value.trim()
        if (!state.token) return
        sessionStorage.setItem(TOKEN_KEY, state.token)
        run(async () => {})
      },
    },
    h('h1', {}, 'Manaflow · Admin'),
    h('div', { class: 'muted' }, 'Kelola member dan akses dashboard.'),
    input,
    state.error ? h('div', { class: 'error' }, state.error) : null,
    h('button', { class: 'btn', type: 'submit' }, 'Masuk'),
  )
}

function render() {
  if (!state.token) {
    app.replaceChildren(loginView())
    return
  }
  app.replaceChildren(
    ...[
      h(
        'div',
        { class: 'bar' },
        h('h1', {}, 'Manaflow · Admin'),
        h('div', { class: 'spacer' }),
        state.busy ? h('span', { class: 'muted' }, 'Memproses…') : null,
        h('a', { class: 'btn', href: './' }, 'Dashboard'),
        h('button', { class: 'btn', type: 'button', onclick: () => logout() }, 'Keluar'),
      ),
      state.error ? h('div', { class: 'error', style: 'margin-bottom:12px' }, state.error) : null,
      issuedPanel(),
      membersCard(),
      viewersCard(),
    ].filter(Boolean),
  )
}

render()
if (state.token) run(async () => {})
