#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { login, push, schedule, status, uninstall } from './commands.js'
import { appendLog } from './config.js'
import { UserError } from './errors.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const COMMANDS = {
  login: [login, 'Simpan token member dan pasang jadwal (opsi: --token <token> --name <device> --server <url> --no-schedule)'],
  push: [push, 'Kirim data pemakaian ke server sekarang'],
  status: [status, 'Tampilkan status login, jadwal, dan kiriman terakhir'],
  schedule: [schedule, 'Pasang atau lepas jadwal otomatis: schedule on|off'],
  uninstall: [uninstall, 'Lepas jadwal, hapus token dan state dari laptop ini'],
}

function help() {
  const rows = Object.entries(COMMANDS).map(([name, [, desc]]) => `  ${name.padEnd(10)} ${desc}`)
  return `manaflow ${version}\n\nPemakaian: manaflow <perintah>\n\n${rows.join('\n')}\n`
}

const [command, ...args] = process.argv.slice(2)
// --log is passed by the scheduled run, which has no terminal to print to.
const logging = args.includes('--log')
const out = (text) => {
  process.stdout.write(text)
  if (logging) appendLog(text)
}

if (!command || command === '--help' || command === '-h') {
  process.stdout.write(help())
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${version}\n`)
} else if (command in COMMANDS) {
  try {
    await COMMANDS[command][0](args, { version, out })
  } catch (err) {
    if (logging) appendLog(`ERROR ${err.message}`)
    if (!(err instanceof UserError)) throw err
    process.stderr.write(`manaflow: ${err.message}\n`)
    process.exitCode = 1
  }
} else {
  process.stderr.write(`Perintah tidak dikenal: ${command}\n\n${help()}`)
  process.exitCode = 1
}
