import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { accountFileCandidates, describeAccount, safeOrg, indexSessions, markChanged, maskEmail, planLabel, readAccount } from '../accounts.js'

test('an email is masked to its first two characters and keeps its domain', () => {
  assert.equal(maskEmail('nama.panjang@gmail.com'), 'na***@gmail.com')
  assert.equal(maskEmail('a@kantor.co.id'), 'a***@kantor.co.id')
  assert.equal(maskEmail('bukan email'), '')
  assert.equal(maskEmail(undefined), '')
})

test('the plan is named from the organization type', () => {
  assert.equal(planLabel({ organizationType: 'claude_pro' }), 'Pro')
  assert.equal(planLabel({ organizationType: 'claude_max' }), 'Max')
  assert.equal(planLabel({ organizationType: 'claude_team' }), 'Team')
  assert.equal(planLabel({ organizationType: 'claude_something_new' }), 'something_new')
  assert.equal(planLabel({ organizationType: null, seatTier: 'premium' }), 'premium')
})

test('an account is described without its id or full email', () => {
  const oauth = { accountUuid: 'uuid-1', emailAddress: 'nama@gmail.com', organizationType: 'claude_pro', organizationName: 'Nama Org' }
  const account = describeAccount(oauth)
  assert.deepEqual({ label: account.label, plan: account.plan, org: account.org }, { label: 'na***@gmail.com', plan: 'Pro', org: 'Nama Org' })
  assert.match(account.id, /^[0-9a-f]{12}$/)
  assert.ok(!JSON.stringify(account).includes('uuid-1') && !JSON.stringify(account).includes('nama@'))
  assert.equal(describeAccount({ accountUuid: 'uuid-1', emailAddress: 'x@y.z' }).id, describeAccount({ accountUuid: 'uuid-1' }).id)
  assert.notEqual(describeAccount({ accountUuid: 'uuid-2' }).id, account.id)
  assert.equal(describeAccount({}), null)
  assert.equal(describeAccount(undefined), null)
})

test('the default folder reads ~/.claude.json first, another folder reads its own', () => {
  assert.deepEqual(accountFileCandidates(join('H', '.claude'), 'H'), [join('H', '.claude.json'), join('H', '.claude', '.claude.json')])
  assert.deepEqual(accountFileCandidates(join('X', 'work'), 'H'), [join('X', 'work', '.claude.json')])
})

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'mf-acc-'))
  const work = join(home, 'work-claude')
  for (const dir of [join(home, '.claude'), work]) mkdirSync(join(dir, 'projects', 'p1'), { recursive: true })
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'personal', emailAddress: 'me@gmail.com', organizationType: 'claude_pro' } }))
  writeFileSync(join(work, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'work', emailAddress: 'me@kantor.id', organizationType: 'claude_team' } }))
  writeFileSync(join(home, '.claude', 'projects', 'p1', 's-personal.jsonl'), '')
  writeFileSync(join(work, 'projects', 'p1', 's-work.jsonl'), '')
  return { home, work }
}

test('two config folders give two accounts, and each session is marked with its own folder account', () => {
  const { home, work } = makeHome()
  const dirs = [join(home, '.claude'), work]
  const accountOf = new Map(dirs.map((dir) => [dir, readAccount(dir, home)]))
  assert.deepEqual([accountOf.get(dirs[0]).plan, accountOf.get(dirs[1]).plan], ['Pro', 'Team'])

  const owner = indexSessions(dirs)
  const changed = [
    { provider: 'claude', sessionId: 's-personal' },
    { provider: 'claude', sessionId: 's-work' },
    { provider: 'claude', sessionId: 's-unknown' },
    { provider: 'codex', sessionId: 's-personal' },
  ]
  const marks = markChanged(changed, owner, accountOf, { 'claude:old': 'keep' })
  assert.deepEqual(marks, {
    'claude:old': 'keep',
    'claude:s-personal': accountOf.get(dirs[0]).id,
    'claude:s-work': accountOf.get(dirs[1]).id,
  })
})

test('a changed session takes the account signed in now; one that did not change keeps its mark', () => {
  const { home } = makeHome()
  const dir = join(home, '.claude')
  const owner = indexSessions([dir])
  const first = new Map([[dir, { id: 'accountA' }]])
  const second = new Map([[dir, { id: 'accountB' }]])
  let marks = markChanged([{ provider: 'claude', sessionId: 's-personal' }], owner, first, {})
  assert.equal(marks['claude:s-personal'], 'accountA')
  marks = markChanged([], owner, second, marks)
  assert.equal(marks['claude:s-personal'], 'accountA')
  marks = markChanged([{ provider: 'claude', sessionId: 's-personal' }], owner, second, marks)
  assert.equal(marks['claude:s-personal'], 'accountB')
})

test('a folder without an account file or without projects is ignored', () => {
  const home = mkdtempSync(join(tmpdir(), 'mf-acc-empty-'))
  assert.equal(readAccount(join(home, 'nothing'), home), null)
  assert.equal(indexSessions([join(home, 'nothing')]).size, 0)
})

test('an organization named after an email is not sent, a company name is', () => {
  assert.equal(safeOrg("nama@gmail.com's Organization"), '')
  assert.equal(safeOrg('Erdigma Group'), 'Erdigma Group')
  assert.equal(safeOrg(undefined), '')
  const account = describeAccount({ accountUuid: 'u', emailAddress: 'nama@gmail.com', organizationName: "nama@gmail.com's Organization" })
  assert.equal(account.org, '')
  assert.ok(!JSON.stringify(account).includes('nama@gmail.com'))
})
