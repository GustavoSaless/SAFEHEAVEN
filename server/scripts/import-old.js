// Traz as contas e tarefas do antigo papp_database.json para o banco novo.
// Uso: npm run import-old -- caminho/para/papp_database.json
// Usa o mesmo banco do servidor: DATABASE_URL do .env, ou o Postgres embutido em server/data/pglite.
import fs from 'node:fs'
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
if (!config.databaseUrl) fs.mkdirSync(config.dataDir, { recursive: true })
const db = await openDb(config.databaseUrl ? { url: config.databaseUrl } : { dir: config.dataDir })

const { users, reminders } = await db.tx(async (t) => {
  const ids = new Map()
  let users = 0
  let reminders = 0
  for (const u of old.users || []) {
    const email = String(u.email).toLowerCase()
    const exists = await t.one('SELECT id FROM users WHERE email = $1', [email])
    if (exists) {
      ids.set(u.id, exists.id)
      continue
    }
    const bamboo = old.stats?.[u.id]?.bambooCount ?? 3
    const row = await t.one('INSERT INTO users (name, email, password_hash, bamboo) VALUES ($1, $2, $3, $4) RETURNING id', [u.name, email, u.password, bamboo])
    ids.set(u.id, row.id)
    users++
  }
  for (const r of old.reminders || []) {
    const userId = ids.get(r.userId)
    if (!userId) continue
    await t.run('INSERT INTO reminders (user_id, text, category, time, done) VALUES ($1, $2, $3, $4, $5)', [
      userId,
      r.text,
      r.category || 'Estudos',
      r.time || '--:--',
      r.completed ? 1 : 0,
    ])
    reminders++
  }
  return { users, reminders }
})
await db.close()
console.log(`Importado: ${users} contas e ${reminders} tarefas. As senhas antigas continuam valendo.`)
