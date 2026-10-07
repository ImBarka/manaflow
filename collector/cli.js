#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { UserError, login, push, status, uninstall } from './commands.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const COMMANDS = {
  login: [login, 'Simpan token member (opsi: --server <url> --token <token> --name <nama device>)'],
  push: [push, 'Kirim data pemakaian ke server sekarang'],
  status: [status, 'Tampilkan status login dan kiriman terakhir'],
  uninstall: [uninstall, 'Hapus token dan state dari laptop ini'],
}

function help() {
  const rows = Object.entries(COMMANDS).map(([name, [, desc]]) => `  ${name.padEnd(10)} ${desc}`)
  return `manaflow ${version}\n\nPemakaian: manaflow <perintah>\n\n${rows.join('\n')}\n`
}

const [command, ...args] = process.argv.slice(2)

if (!command || command === '--help' || command === '-h') {
  process.stdout.write(help())
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${version}\n`)
} else if (command in COMMANDS) {
  try {
    await COMMANDS[command][0](args, { version })
  } catch (err) {
    if (!(err instanceof UserError)) throw err
    process.stderr.write(`manaflow: ${err.message}\n`)
    process.exitCode = 1
  }
} else {
  process.stderr.write(`Perintah tidak dikenal: ${command}\n\n${help()}`)
  process.exitCode = 1
}
