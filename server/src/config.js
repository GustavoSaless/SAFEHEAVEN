import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'
  let jwtSecret = env.JWT_SECRET
  if (!jwtSecret) {
    if (production) throw new Error('Defina JWT_SECRET nas variáveis de ambiente antes de subir em produção.')
    jwtSecret = crypto.randomBytes(32).toString('hex')
    console.warn('[aviso] JWT_SECRET não definido: usando um segredo temporário (os logins caem ao reiniciar).')
  }
  return {
    production,
    port: Number(env.PORT) || 5001,
    jwtSecret,
    databaseUrl: env.DATABASE_URL || '',
    dataDir: env.DATA_DIR || path.join(here, '..', 'data', 'pglite'),
    corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true,
    adminEmail: env.ADMIN_EMAIL || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    adminName: env.ADMIN_NAME || 'Administrador',
    keyTtlDays: Number(env.KEY_TTL_DAYS) || 7,
    autoApprovePsychologists: env.AUTO_APPROVE_PSYCHOLOGISTS === 'true',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    aiPerHour: Number(env.AI_MESSAGES_PER_HOUR) || 40,
    rateLimit: env.DISABLE_RATE_LIMIT !== 'true',
  }
}
