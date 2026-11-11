import fs from 'node:fs'
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { createApp, seedAdmin } from './app.js'

try {
  process.loadEnvFile?.() // lê o arquivo .env, se existir
} catch {}

const config = loadConfig()
if (!config.databaseUrl) fs.mkdirSync(config.dataDir, { recursive: true })
const db = await openDb(config.databaseUrl ? { url: config.databaseUrl } : { dir: config.dataDir })
console.log(`Banco: ${db.kind}`)

if (await seedAdmin(db, config)) console.log(`Administrador pronto: ${config.adminEmail}`)
else console.warn('[aviso] ADMIN_EMAIL e ADMIN_PASSWORD não definidos: nenhum administrador foi criado.')
if (!config.anthropicKey) console.warn('[aviso] ANTHROPIC_API_KEY não definida: o tutor de IA fica desligado.')

const { server } = createApp({ db, config })
server.listen(config.port, () => console.log(`SafeHaven no ar na porta ${config.port}`))
