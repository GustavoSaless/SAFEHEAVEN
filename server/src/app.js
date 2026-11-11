import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { askPapp, AiUnavailable } from './ai.js'
import { attachLive } from './live.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const CRP_RE = /^\d{2}\/\d{4,6}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sem 0/O, 1/I/L

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const bad = (msg) => new HttpError(400, msg)

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const normalizeKey = (v) => clean(v, 40).toUpperCase().replace(/[^A-Z0-9]/g, '')
const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null)

function newKeyCode() {
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('')
  return `SH-${pick(4)}-${pick(4)}`
}

export function createApp({ db, config }) {
  const app = express()
  const server = http.createServer(app)

  app.set('trust proxy', 1)
  app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }))
  app.use(cors({ origin: config.corsOrigin }))
  app.use(express.json({ limit: '100kb' }))

  const userById = (id, t = db) => t.one('SELECT * FROM users WHERE id = $1', [id])

  const publicUser = async (u) => {
    const psy = u.psychologist_id ? await userById(u.psychologist_id) : null
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      crp: u.crp || null,
      bamboo: u.bamboo,
      psychologist: psy ? { id: psy.id, name: psy.name, crp: psy.crp } : null,
      createdAt: iso(u.created_at),
    }
  }
  const sign = (u) => jwt.sign({ id: u.id }, config.jwtSecret, { expiresIn: '30d' })
  const reminderOut = (r) => ({ id: r.id, text: r.text, category: r.category, cat: r.category, time: r.time, done: r.done })

  // Vincula um paciente à psicóloga dona da chave, dentro da transação t. Lança HttpError se a chave não servir.
  async function redeemKey(t, patientId, rawCode) {
    const code = normalizeKey(rawCode)
    const invalid = bad('Chave inválida ou expirada. Confira com a sua psicóloga.')
    if (!code) throw invalid
    // FOR UPDATE trava a chave: duas pessoas não conseguem usar a mesma ao mesmo tempo.
    const key = await t.one("SELECT * FROM access_keys WHERE replace(code, '-', '') = $1 FOR UPDATE", [code])
    if (!key || key.revoked || key.used_by || new Date(key.expires_at) < new Date()) throw invalid
    const psy = await userById(key.psychologist_id, t)
    if (!psy || psy.role !== 'psychologist' || psy.status !== 'active') throw invalid
    await t.run('UPDATE access_keys SET used_by = $1, used_at = now() WHERE id = $2', [patientId, key.id])
    await t.run('UPDATE users SET psychologist_id = $1 WHERE id = $2', [psy.id, patientId])
    return psy
  }

  // ---------- middlewares ----------
  const limiter = (max, minutes) =>
    config.rateLimit
      ? rateLimit({
          windowMs: minutes * 60_000,
          limit: max,
          standardHeaders: true,
          legacyHeaders: false,
          message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
        })
      : (_req, _res, next) => next()
  const authLimiter = limiter(30, 15)

  async function userFromToken(token) {
    let id
    try {
      id = jwt.verify(token, config.jwtSecret).id
    } catch {
      return null
    }
    return (await userById(id)) || null
  }

  async function auth(req, _res, next) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const user = token ? await userFromToken(token) : null
    if (!user) throw new HttpError(401, 'Sessão expirada. Entre de novo.')
    if (user.status === 'blocked') throw new HttpError(403, 'Esta conta foi bloqueada. Fale com o suporte.')
    req.user = user
    next()
  }
  const role = (...roles) => (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'Você não tem acesso a esta área.')
    if (req.user.role === 'psychologist' && req.user.status !== 'active')
      throw new HttpError(403, 'Seu cadastro profissional ainda está em análise.')
    next()
  }

  // Devolve o par paciente/psicóloga se quem pede faz parte dele.
  async function carePair(user, patientId) {
    const pid = Number(patientId)
    if (!Number.isInteger(pid)) return null
    if (user.role === 'patient' && user.id === pid && user.psychologist_id)
      return { patientId: pid, psychologistId: user.psychologist_id }
    if (user.role === 'psychologist' && user.status === 'active') {
      const p = await userById(pid)
      if (p && p.psychologist_id === user.id) return { patientId: pid, psychologistId: user.id }
    }
    return null
  }

  const live = attachLive({ server, db, config, userFromToken, userById, carePair })

  const api = express.Router()
  app.use('/api', api)

  api.get('/health', (_req, res) => res.json({ ok: true, name: 'SafeHaven' }))

  // ---------- conta ----------
  api.post('/auth/register', authLimiter, async (req, res) => {
    const name = clean(req.body.name, 80)
    const email = clean(req.body.email, 160).toLowerCase()
    const password = typeof req.body.password === 'string' ? req.body.password : ''
    const wantsPro = req.body.role === 'psychologist'
    const crp = clean(req.body.crp, 12)
    const accessKey = clean(req.body.accessKey, 40)

    if (name.length < 2) throw bad('Digite seu nome.')
    if (!EMAIL_RE.test(email)) throw bad('Digite um e-mail válido.')
    if (password.length < 8) throw bad('A senha precisa ter pelo menos 8 caracteres.')
    if (wantsPro && !CRP_RE.test(crp)) throw bad('Informe o CRP no formato 06/123456.')
    if (await db.one('SELECT 1 FROM users WHERE email = $1', [email])) throw bad('Este e-mail já está cadastrado.')

    const hash = await bcrypt.hash(password, 10)
    // Chave errada cancela o cadastro inteiro: a pessoa corrige e tenta de novo.
    const { user, psy } = await db
      .tx(async (t) => {
        const user = await t.one(
          'INSERT INTO users (name, email, password_hash, role, status, crp) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [
            name,
            email,
            hash,
            wantsPro ? 'psychologist' : 'patient',
            wantsPro && !config.autoApprovePsychologists ? 'pending' : 'active',
            wantsPro ? crp : null,
          ],
        )
        const psy = !wantsPro && accessKey ? await redeemKey(t, user.id, accessKey) : null
        return { user, psy }
      })
      .catch((err) => {
        if (err.code === '23505') throw bad('Este e-mail já está cadastrado.') // cadastro duplo ao mesmo tempo
        throw err
      })
    const fresh = await userById(user.id)
    if (psy) live.patientLinked(psy.id, user.id)
    res.status(201).json({ token: sign(fresh), user: await publicUser(fresh) })
  })

  api.post('/auth/login', authLimiter, async (req, res) => {
    const email = clean(req.body.email, 160).toLowerCase()
    const password = typeof req.body.password === 'string' ? req.body.password : ''
    if (!email || !password) throw bad('Preencha e-mail e senha.')
    const user = await db.one('SELECT * FROM users WHERE email = $1', [email])
    const ok = user && (await bcrypt.compare(password, user.password_hash))
    if (!ok) throw bad('E-mail ou senha incorretos.')
    if (user.status === 'blocked') throw new HttpError(403, 'Esta conta foi bloqueada. Fale com o suporte.')
    res.json({ token: sign(user), user: await publicUser(user) })
  })

  api.get('/auth/me', auth, async (req, res) => res.json({ user: await publicUser(req.user) }))

  api.patch('/user/bamboo', auth, async (req, res) => {
    const bamboo = Number(req.body.bamboo)
    if (!Number.isInteger(bamboo) || bamboo < 0 || bamboo > 9999) throw bad('Valor inválido.')
    await db.run('UPDATE users SET bamboo = $1 WHERE id = $2', [bamboo, req.user.id])
    res.json({ bamboo })
  })

  api.post('/user/link', auth, role('patient'), authLimiter, async (req, res) => {
    if (req.user.psychologist_id) throw bad('Você já está vinculado a uma psicóloga.')
    const psy = await db.tx((t) => redeemKey(t, req.user.id, req.body.accessKey))
    live.patientLinked(psy.id, req.user.id)
    res.json({ user: await publicUser(await userById(req.user.id)) })
  })

  api.delete('/user/link', auth, role('patient'), async (req, res) => {
    const psyId = req.user.psychologist_id
    await db.run('UPDATE users SET psychologist_id = NULL WHERE id = $1', [req.user.id])
    if (psyId) live.patientUnlinked(psyId, req.user.id)
    res.json({ user: await publicUser(await userById(req.user.id)) })
  })

  // ---------- tarefas ----------
  api.get('/reminders', auth, async (req, res) => {
    const rows = await db.all('SELECT * FROM reminders WHERE user_id = $1 ORDER BY id DESC', [req.user.id])
    res.json({ reminders: rows.map(reminderOut) })
  })

  api.post('/reminders', auth, async (req, res) => {
    const text = clean(req.body.text, 200)
    if (!text) throw bad('Escreva a tarefa.')
    const time = /^\d{2}:\d{2}$/.test(req.body.time) ? req.body.time : '--:--'
    const category = clean(req.body.category, 30) || 'Estudos'
    const row = await db.one('INSERT INTO reminders (user_id, text, category, time) VALUES ($1, $2, $3, $4) RETURNING *', [
      req.user.id,
      text,
      category,
      time,
    ])
    res.status(201).json({ reminder: reminderOut(row) })
  })

  api.patch('/reminders/:id', auth, async (req, res) => {
    const done = req.body.done ? 1 : 0
    const row = await db.one('UPDATE reminders SET done = $1 WHERE id = $2 AND user_id = $3 RETURNING *', [done, Number(req.params.id) || 0, req.user.id])
    if (!row) throw new HttpError(404, 'Tarefa não encontrada.')
    res.json({ reminder: reminderOut(row) })
  })

  api.delete('/reminders/:id', auth, async (req, res) => {
    await db.run('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [Number(req.params.id) || 0, req.user.id])
    res.json({ success: true })
  })

  // ---------- tutor de IA ----------
  const aiMessages = (userId, limit = 200) =>
    db.all('SELECT id, role, message FROM (SELECT * FROM ai_messages WHERE user_id = $1 ORDER BY id DESC LIMIT $2) t ORDER BY id', [userId, limit])

  api.get('/chat', auth, async (req, res) => res.json({ messages: await aiMessages(req.user.id) }))

  api.post('/chat', auth, async (req, res) => {
    const message = clean(req.body.message, 4000)
    const r = req.body.role === 'ai' ? 'ai' : 'user'
    if (!message) throw bad('Mensagem vazia.')
    await db.run('INSERT INTO ai_messages (user_id, role, message) VALUES ($1, $2, $3)', [req.user.id, r, message])
    res.status(201).json({ success: true })
  })

  api.delete('/chat', auth, async (req, res) => {
    await db.run('DELETE FROM ai_messages WHERE user_id = $1', [req.user.id])
    res.json({ success: true })
  })

  const aiUse = new Map() // userId -> horários das últimas mensagens
  api.post('/ai', auth, async (req, res) => {
    const message = clean(req.body.message, 2000)
    if (!message) throw bad('Escreva uma mensagem.')
    const now = Date.now()
    const recent = (aiUse.get(req.user.id) || []).filter((t) => now - t < 3_600_000)
    if (recent.length >= config.aiPerHour) throw new HttpError(429, 'Você conversou bastante por agora. Que tal uma pausa? O tutor volta em alguns minutos.')
    recent.push(now)
    aiUse.set(req.user.id, recent)

    const history = [...(await aiMessages(req.user.id, 12)), { role: 'user', message }]
    let reply
    try {
      reply = await askPapp(config, history)
    } catch (err) {
      if (err instanceof AiUnavailable) throw new HttpError(503, err.message)
      throw new HttpError(503, 'O tutor demorou para responder. Tente de novo em instantes.')
    }
    await db.run('INSERT INTO ai_messages (user_id, role, message) VALUES ($1, $2, $3)', [req.user.id, 'user', message])
    const saved = await db.one('INSERT INTO ai_messages (user_id, role, message) VALUES ($1, $2, $3) RETURNING id', [req.user.id, 'ai', reply])
    res.json({ reply, id: saved.id })
  })

  // ---------- diário (só a própria pessoa lê) ----------
  const entryOut = (e) => ({ id: e.id, text: e.text, mood: e.mood, createdAt: iso(e.created_at) })

  api.get('/journal', auth, async (req, res) => {
    const rows = await db.all('SELECT * FROM journal WHERE user_id = $1 ORDER BY id DESC LIMIT 300', [req.user.id])
    res.json({ entries: rows.map(entryOut) })
  })

  api.post('/journal', auth, async (req, res) => {
    const text = clean(req.body.text, 5000)
    if (!text) throw bad('Escreva algo antes de salvar.')
    const mood = clean(req.body.mood, 20) || null
    const row = await db.one('INSERT INTO journal (user_id, text, mood) VALUES ($1, $2, $3) RETURNING *', [req.user.id, text, mood])
    res.status(201).json({ entry: entryOut(row) })
  })

  api.delete('/journal/:id', auth, async (req, res) => {
    await db.run('DELETE FROM journal WHERE id = $1 AND user_id = $2', [Number(req.params.id) || 0, req.user.id])
    res.json({ success: true })
  })

  // ---------- fale conosco ----------
  api.post('/feedback', auth, async (req, res) => {
    const message = clean(req.body.message, 2000)
    if (!message) throw bad('Escreva sua mensagem.')
    await db.run('INSERT INTO feedback (user_id, message) VALUES ($1, $2)', [req.user.id, message])
    res.status(201).json({ success: true })
  })

  // ---------- chat ao vivo (histórico e envio por HTTP, caso o socket caia) ----------
  api.get('/live/:patientId/messages', auth, async (req, res) => {
    const pair = await carePair(req.user, req.params.patientId)
    if (!pair) throw new HttpError(403, 'Você não participa desta conversa.')
    await live.markRead(pair, req.user.id)
    const peerId = req.user.id === pair.patientId ? pair.psychologistId : pair.patientId
    res.json({ messages: await live.history(pair), peerOnline: live.isOnline(peerId) })
  })

  api.post('/live/:patientId/messages', auth, async (req, res) => {
    const pair = await carePair(req.user, req.params.patientId)
    if (!pair) throw new HttpError(403, 'Você não participa desta conversa.')
    const body = clean(req.body.body, 2000)
    if (!body) throw bad('Mensagem vazia.')
    res.status(201).json({ message: await live.send(pair, req.user.id, body) })
  })

  // ---------- receitas: lado do paciente ----------
  const prescriptionOut = async (p, today) => {
    const [{ done_today, last7 }] = await db.all(
      `SELECT bool_or(day = $2::date) AS done_today,
              count(*) FILTER (WHERE day > $2::date - 7 AND day <= $2::date)::int AS last7
       FROM prescription_logs WHERE prescription_id = $1`,
      [p.id, today],
    )
    return {
      id: p.id,
      title: p.title,
      body: p.body,
      frequency: p.frequency,
      active: !!p.active,
      createdAt: iso(p.created_at),
      doneToday: !!done_today,
      doneLast7: last7,
    }
  }
  const dayOf = (req) => {
    const d = req.query.day || req.body?.day
    return DAY_RE.test(d) ? d : new Date().toISOString().slice(0, 10)
  }

  api.get('/care/prescriptions', auth, role('patient'), async (req, res) => {
    if (!req.user.psychologist_id) return res.json({ prescriptions: [] })
    const rows = await db.all(
      'SELECT * FROM prescriptions WHERE patient_id = $1 AND psychologist_id = $2 AND active = 1 ORDER BY id DESC',
      [req.user.id, req.user.psychologist_id],
    )
    res.json({ prescriptions: await Promise.all(rows.map((p) => prescriptionOut(p, dayOf(req)))) })
  })

  api.post('/care/prescriptions/:id/check', auth, role('patient'), async (req, res) => {
    const p = await db.one('SELECT * FROM prescriptions WHERE id = $1 AND patient_id = $2', [Number(req.params.id) || 0, req.user.id])
    if (!p || p.psychologist_id !== req.user.psychologist_id) throw new HttpError(404, 'Orientação não encontrada.')
    const day = dayOf(req)
    if (req.body.done === false) await db.run('DELETE FROM prescription_logs WHERE prescription_id = $1 AND day = $2', [p.id, day])
    else await db.run('INSERT INTO prescription_logs (prescription_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, day])
    res.json({ prescription: await prescriptionOut(p, day) })
  })

  // ---------- área da psicóloga ----------
  const pro = express.Router()
  api.use('/pro', auth, role('psychologist'), pro)

  const keyOut = (k) => {
    const status = k.revoked ? 'revoked' : k.used_by || k.used_at ? 'used' : new Date(k.expires_at) < new Date() ? 'expired' : 'available'
    return { id: k.id, code: k.code, label: k.label, status, usedBy: k.used_by_name || null, expiresAt: iso(k.expires_at), createdAt: iso(k.created_at) }
  }

  pro.get('/keys', async (req, res) => {
    const rows = await db.all(
      `SELECT k.*, u.name AS used_by_name FROM access_keys k LEFT JOIN users u ON u.id = k.used_by
       WHERE k.psychologist_id = $1 ORDER BY k.id DESC LIMIT 200`,
      [req.user.id],
    )
    res.json({ keys: rows.map(keyOut) })
  })

  pro.post('/keys', async (req, res) => {
    const { n } = await db.one(
      'SELECT count(*)::int AS n FROM access_keys WHERE psychologist_id = $1 AND used_by IS NULL AND revoked = 0 AND expires_at > now()',
      [req.user.id],
    )
    if (n >= 50) throw bad('Você já tem muitas chaves em aberto. Revogue algumas antes de gerar outra.')
    const row = await db.one(
      `INSERT INTO access_keys (code, psychologist_id, label, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING *`,
      [newKeyCode(), req.user.id, clean(req.body.label, 60) || null, config.keyTtlDays],
    )
    res.status(201).json({ key: keyOut(row) })
  })

  pro.delete('/keys/:id', async (req, res) => {
    await db.run('UPDATE access_keys SET revoked = 1 WHERE id = $1 AND psychologist_id = $2 AND used_by IS NULL', [Number(req.params.id) || 0, req.user.id])
    res.json({ success: true })
  })

  pro.get('/patients', async (req, res) => {
    const rows = await db.all(
      `SELECT u.id, u.name, u.email,
         (SELECT row_to_json(m) FROM (
            SELECT body, sender_id, created_at FROM live_messages
            WHERE patient_id = u.id AND psychologist_id = $1 ORDER BY id DESC LIMIT 1) m) AS last,
         (SELECT count(*)::int FROM live_messages
            WHERE patient_id = u.id AND psychologist_id = $1 AND sender_id = u.id AND read_at IS NULL) AS unread
       FROM users u WHERE u.psychologist_id = $1 ORDER BY u.name`,
      [req.user.id],
    )
    const patients = rows.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      online: live.isOnline(p.id),
      unread: p.unread,
      lastMessage: p.last ? { body: p.last.body, mine: p.last.sender_id === req.user.id, createdAt: iso(p.last.created_at) } : null,
    }))
    res.json({ patients })
  })

  const ownPatient = async (req) => {
    const p = await userById(Number(req.params.id) || 0)
    if (!p || p.psychologist_id !== req.user.id) throw new HttpError(404, 'Paciente não encontrado.')
    return p
  }

  pro.delete('/patients/:id', async (req, res) => {
    const p = await ownPatient(req)
    await db.run('UPDATE users SET psychologist_id = NULL WHERE id = $1', [p.id])
    live.patientUnlinked(req.user.id, p.id)
    res.json({ success: true })
  })

  pro.get('/patients/:id/prescriptions', async (req, res) => {
    const p = await ownPatient(req)
    const rows = await db.all('SELECT * FROM prescriptions WHERE patient_id = $1 AND psychologist_id = $2 ORDER BY active DESC, id DESC', [p.id, req.user.id])
    res.json({ prescriptions: await Promise.all(rows.map((r) => prescriptionOut(r, dayOf(req)))) })
  })

  pro.post('/patients/:id/prescriptions', async (req, res) => {
    const p = await ownPatient(req)
    const title = clean(req.body.title, 120)
    if (!title) throw bad('Dê um título para a orientação.')
    const row = await db.one(
      'INSERT INTO prescriptions (patient_id, psychologist_id, title, body, frequency) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [p.id, req.user.id, title, clean(req.body.body, 3000), clean(req.body.frequency, 60)],
    )
    live.notify(p.id, 'care:prescriptions')
    res.status(201).json({ prescription: await prescriptionOut(row, dayOf(req)) })
  })

  const ownPrescription = async (req) => {
    const row = await db.one('SELECT * FROM prescriptions WHERE id = $1 AND psychologist_id = $2', [Number(req.params.id) || 0, req.user.id])
    if (!row) throw new HttpError(404, 'Orientação não encontrada.')
    return row
  }

  pro.patch('/prescriptions/:id', async (req, res) => {
    const row = await ownPrescription(req)
    const next = {
      title: req.body.title !== undefined ? clean(req.body.title, 120) || row.title : row.title,
      body: req.body.body !== undefined ? clean(req.body.body, 3000) : row.body,
      frequency: req.body.frequency !== undefined ? clean(req.body.frequency, 60) : row.frequency,
      active: req.body.active !== undefined ? (req.body.active ? 1 : 0) : row.active,
    }
    await db.run('UPDATE prescriptions SET title = $1, body = $2, frequency = $3, active = $4 WHERE id = $5', [
      next.title,
      next.body,
      next.frequency,
      next.active,
      row.id,
    ])
    live.notify(row.patient_id, 'care:prescriptions')
    res.json({ prescription: await prescriptionOut({ ...row, ...next }, dayOf(req)) })
  })

  pro.delete('/prescriptions/:id', async (req, res) => {
    const row = await ownPrescription(req)
    await db.run('DELETE FROM prescriptions WHERE id = $1', [row.id])
    live.notify(row.patient_id, 'care:prescriptions')
    res.json({ success: true })
  })

  // ---------- administração ----------
  // O admin gerencia contas. Conversas, diários e receitas ficam fora do alcance dele (sigilo profissional).
  const admin = express.Router()
  api.use('/admin', auth, role('admin'), admin)

  admin.get('/stats', async (_req, res) => {
    const s = await db.one(`SELECT
      (SELECT count(*)::int FROM users WHERE role = 'patient') AS patients,
      (SELECT count(*)::int FROM users WHERE role = 'patient' AND psychologist_id IS NOT NULL) AS "patientsLinked",
      (SELECT count(*)::int FROM users WHERE role = 'psychologist' AND status = 'active') AS psychologists,
      (SELECT count(*)::int FROM users WHERE role = 'psychologist' AND status = 'pending') AS pending,
      (SELECT count(*)::int FROM users WHERE status = 'blocked') AS blocked,
      (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS "newThisWeek",
      (SELECT count(*)::int FROM feedback) AS feedback`)
    res.json(s)
  })

  admin.get('/users', async (req, res) => {
    const where = []
    const args = []
    const add = (sql, value) => {
      args.push(value)
      where.push(sql.replace('?', `$${args.length}`))
    }
    if (['patient', 'psychologist', 'admin'].includes(req.query.role)) add('role = ?', req.query.role)
    if (['active', 'pending', 'blocked'].includes(req.query.status)) add('status = ?', req.query.status)
    const term = clean(req.query.q, 80)
    if (term) {
      args.push(`%${term}%`)
      where.push(`(name ILIKE $${args.length} OR email ILIKE $${args.length})`)
    }
    const rows = await db.all(
      `SELECT u.*, (SELECT count(*)::int FROM users p WHERE p.psychologist_id = u.id) AS patient_count
       FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (status = 'pending') DESC, id DESC LIMIT 300`,
      args,
    )
    const users = await Promise.all(
      rows.map(async (u) => ({ ...(await publicUser(u)), patientCount: u.role === 'psychologist' ? u.patient_count : undefined })),
    )
    res.json({ users })
  })

  const manageable = async (req) => {
    const u = await userById(Number(req.params.id) || 0)
    if (!u) throw new HttpError(404, 'Usuário não encontrado.')
    if (u.role === 'admin') throw bad('Contas de administrador não podem ser alteradas por aqui.')
    return u
  }

  admin.patch('/users/:id', async (req, res) => {
    const u = await manageable(req)
    if (!['active', 'blocked'].includes(req.body.status)) throw bad('Status inválido.')
    await db.run('UPDATE users SET status = $1 WHERE id = $2', [req.body.status, u.id])
    if (req.body.status === 'blocked') live.disconnectUser(u.id)
    res.json({ user: await publicUser(await userById(u.id)) })
  })

  admin.delete('/users/:id', async (req, res) => {
    const u = await manageable(req)
    live.disconnectUser(u.id)
    await db.run('DELETE FROM users WHERE id = $1', [u.id])
    res.json({ success: true })
  })

  admin.get('/feedback', async (_req, res) => {
    const rows = await db.all(
      `SELECT f.id, f.message, f.created_at, u.name AS user_name, u.email AS user_email
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 300`,
    )
    res.json({
      feedback: rows.map((f) => ({ id: f.id, message: f.message, createdAt: iso(f.created_at), userName: f.user_name, userEmail: f.user_email })),
    })
  })

  admin.delete('/feedback/:id', async (req, res) => {
    await db.run('DELETE FROM feedback WHERE id = $1', [Number(req.params.id) || 0])
    res.json({ success: true })
  })

  // ---------- erros ----------
  api.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.')))

  // ---------- o próprio app (client/dist), quando ele foi gerado com "npm run build" ----------
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist')
  if (fs.existsSync(path.join(web, 'index.html'))) {
    app.use(express.static(web, { index: false, maxAge: '7d' }))
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(web, 'index.html'), { maxAge: 0 }))
  }
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requisição inválida.' })
    if (!(err instanceof HttpError)) console.error(err)
    res.status(err.status || 500).json({ error: err instanceof HttpError ? err.message : 'Erro interno. Tente de novo.' })
  })

  return { app, server, io: live.io }
}

// Cria ou atualiza o administrador a partir das variáveis de ambiente.
export async function seedAdmin(db, config) {
  if (!config.adminEmail || !config.adminPassword) return false
  const email = config.adminEmail.toLowerCase()
  const hash = await bcrypt.hash(config.adminPassword, 10)
  await db.run(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'active', password_hash = EXCLUDED.password_hash`,
    [config.adminName, email, hash],
  )
  return true
}
