#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const COMMANDS = {
  login: 'Simpan token member dan pasang jadwal kirim',
  push: 'Kirim data pemakaian ke server sekarang',
  status: 'Tampilkan status login, jadwal, dan kiriman terakhir',
  uninstall: 'Hapus jadwal dan token dari laptop ini',
}

function help() {
  const rows = Object.entries(COMMANDS).map(([name, desc]) => `  ${name.padEnd(10)} ${desc}`)
  return `manaflow ${version}\n\nPemakaian: manaflow <perintah>\n\n${rows.join('\n')}\n`
}

const [command] = process.argv.slice(2)

if (!command || command === '--help' || command === '-h') {
  process.stdout.write(help())
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${version}\n`)
} else if (command in COMMANDS) {
  process.stderr.write(`manaflow ${command}: belum diimplementasi\n`)
  process.exitCode = 1
} else {
  process.stderr.write(`Perintah tidak dikenal: ${command}\n\n${help()}`)
  process.exitCode = 1
}
