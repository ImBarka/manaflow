import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// Which Claude account a session belongs to. Claude Code's session files do not
// say, so a session is marked with the account signed in, in the config folder
// the session lives in, when the collector last saw the session change.
// A member who signs in to another account in the same folder is therefore
// told apart to within one push interval, not exactly.

const MAX_LABEL = 60

// "nama@gmail.com" -> "na***@gmail.com". The domain stays: it tells a personal
// address from a work one. Anything that is not an email yields an empty label.
export function maskEmail(email) {
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(String(email ?? '').trim())
  if (!match) return ''
  const [, local, domain] = match
  return `${local.slice(0, 2)}***@${domain}`.slice(0, MAX_LABEL)
}

// The plan as Claude reports it, in plain words.
export function planLabel(oauth) {
  const type = String(oauth.organizationType ?? '')
  const known = { claude_pro: 'Pro', claude_max: 'Max', claude_team: 'Team', claude_enterprise: 'Enterprise', claude_free: 'Free' }
  if (known[type]) return known[type]
  if (oauth.seatTier) return String(oauth.seatTier).slice(0, 20)
  return type.replace(/^claude_/, '').slice(0, 20)
}

// An opaque stable id: the account id itself is not sent.
export function accountId(oauth) {
  const raw = oauth.accountUuid ?? oauth.emailAddress
  return raw ? createHash('sha256').update(`manaflow:${raw}`).digest('hex').slice(0, 12) : null
}

// The organization name, unless it carries an email. Claude names a personal
// organization after the account's email ("name@gmail.com's Organization"), and
// that would undo the masking of the label.
export function safeOrg(name) {
  const text = String(name ?? '').trim()
  return text.includes('@') ? '' : text.slice(0, 60)
}

// What is sent about an account: id, masked email, plan, organization name.
export function describeAccount(oauth) {
  const id = oauth && accountId(oauth)
  if (!id) return null
  return { id, label: maskEmail(oauth.emailAddress), plan: planLabel(oauth), org: safeOrg(oauth.organizationName) }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// The file Claude Code keeps the signed-in account in for a config folder: the
// default folder uses ~/.claude.json, any other uses <folder>/.claude.json.
export function accountFileCandidates(dir, home = homedir()) {
  const isDefault = resolve(dir) === resolve(home, '.claude')
  return isDefault ? [join(home, '.claude.json'), join(dir, '.claude.json')] : [join(dir, '.claude.json')]
}

export function readAccount(dir, home = homedir()) {
  for (const file of accountFileCandidates(dir, home)) {
    const account = describeAccount(readJson(file)?.oauthAccount)
    if (account) return account
  }
  return null
}

// Session id -> the Claude config folder holding its transcript. Folders
// without a `projects` directory (Claude Desktop's cache) are skipped.
export function indexSessions(dirs) {
  const owner = new Map()
  for (const dir of dirs) {
    const projects = join(dir, 'projects')
    if (!existsSync(projects)) continue
    let names
    try {
      names = readdirSync(projects)
    } catch {
      continue
    }
    for (const name of names) {
      let files
      try {
        files = readdirSync(join(projects, name))
      } catch {
        continue
      }
      for (const file of files) if (file.endsWith('.jsonl')) owner.set(file.slice(0, -6), dir)
    }
  }
  return owner
}

// The key a session's mark is stored under.
export const accountMarkKey = (session) => `${session.provider}:${session.sessionId}`

// Marks for the sessions that changed in this push: the account currently
// signed in where each lives. Sessions that did not change keep the mark they
// have, and sessions from before this feature stay unmarked. `accountOf`
// maps a config folder to its current account.
export function markChanged(changed, owner, accountOf, marks) {
  const next = { ...marks }
  for (const session of changed) {
    if (session.provider !== 'claude') continue
    const dir = owner.get(session.sessionId)
    const account = dir ? accountOf.get(dir) : null
    if (account) next[accountMarkKey(session)] = account.id
  }
  return next
}
