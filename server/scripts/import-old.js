// Traz as contas e tarefas do antigo papp_database.json para o banco novo.
// Uso: npm run import-old -- caminho/para/papp_database.json
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../src/config.js'
import { openDb } from '../src/db.js'

try {
  process.loadEnvFile?.()
} catch {}

const file = process.argv[2]
if (!file || !fs.existsSync(file)) {
  console.error('Informe o caminho do papp_database.json antigo.')
  process.exit(1)
}

const old = JSON.parse(fs.readFileSync(file, 'utf-8'))
const config = loadConfig({ ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'import' })
fs.mkdirSync(path.dirname(config.dbFile), { recursive: true })
const db = openDb(config.dbFile)

let users = 0
let reminders = 0
db.transaction(() => {
  const ids = new Map()
  for (const u of old.users || []) {
    const email = String(u.email).toLowerCase()
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    if (exists) {
      ids.set(u.id, exists.id)
      continue
    }
    const bamboo = old.stats?.[u.id]?.bambooCount ?? 3
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, bamboo) VALUES (?, ?, ?, ?)')
      .run(u.name, email, u.password, bamboo)
    ids.set(u.id, Number(info.lastInsertRowid))
    users++
  }
  for (const r of old.reminders || []) {
    const userId = ids.get(r.userId)
    if (!userId) continue
    db.prepare('INSERT INTO reminders (user_id, text, category, time, done) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      r.text,
      r.category || 'Estudos',
      r.time || '--:--',
      r.completed ? 1 : 0,
    )
    reminders++
  }
})()

console.log(`Importado: ${users} contas e ${reminders} tarefas. As senhas antigas continuam valendo.`)
