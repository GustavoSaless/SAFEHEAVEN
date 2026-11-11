import http from 'node:http'
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

function newKeyCode() {
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('')
  return `SH-${pick(4)}-${pick(4)}`
}

export function createApp({ db, config }) {
  const app = express()
  const server = http.createServer(app)

  app.set('trust proxy', 1)
  app.use(helmet({ crossOriginResourcePolicy: false }))
  app.use(cors({ origin: config.corsOrigin }))
  app.use(express.json({ limit: '100kb' }))

  // ---------- consultas preparadas ----------
  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare(
      'INSERT INTO users (name, email, password_hash, role, status, crp) VALUES (@name, @email, @hash, @role, @status, @crp)',
    ),
    keyByCode: db.prepare("SELECT * FROM access_keys WHERE replace(code, '-', '') = ?"),
  }

  const publicUser = (u) => {
    const psy = u.psychologist_id ? q.userById.get(u.psychologist_id) : null
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      crp: u.crp || null,
      bamboo: u.bamboo,
      psychologist: psy ? { id: psy.id, name: psy.name, crp: psy.crp } : null,
      createdAt: u.created_at,
    }
  }
  const sign = (u) => jwt.sign({ id: u.id }, config.jwtSecret, { expiresIn: '30d' })
  const reminderOut = (r) => ({ id: r.id, text: r.text, category: r.category, cat: r.category, time: r.time, done: r.done })

  // Vincula um paciente à psicóloga dona da chave. Lança HttpError se a chave não servir.
  const redeemKey = db.transaction((patientId, rawCode) => {
    const code = normalizeKey(rawCode)
    const key = code ? q.keyByCode.get(code) : null
    const invalid = bad('Chave inválida ou expirada. Confira com a sua psicóloga.')
    if (!key || key.revoked || key.used_by || key.expires_at < new Date().toISOString()) throw invalid
    const psy = q.userById.get(key.psychologist_id)
    if (!psy || psy.role !== 'psychologist' || psy.status !== 'active') throw invalid
    db.prepare("UPDATE access_keys SET used_by = ?, used_at = datetime('now') WHERE id = ?").run(patientId, key.id)
    db.prepare('UPDATE users SET psychologist_id = ? WHERE id = ?').run(psy.id, patientId)
    return psy
  })

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

  function userFromToken(token) {
    try {
      const { id } = jwt.verify(token, config.jwtSecret)
      return q.userById.get(id) || null
    } catch {
      return null
    }
  }

  function auth(req, _res, next) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const user = token ? userFromToken(token) : null
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
  function carePair(user, patientId) {
    const pid = Number(patientId)
    if (user.role === 'patient' && user.id === pid && user.psychologist_id)
      return { patientId: pid, psychologistId: user.psychologist_id }
    if (user.role === 'psychologist' && user.status === 'active') {
      const p = q.userById.get(pid)
      if (p && p.psychologist_id === user.id) return { patientId: pid, psychologistId: user.id }
    }
    return null
  }

  const live = attachLive({ server, db, config, userFromToken, carePair })

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
    if (q.userByEmail.get(email)) throw bad('Este e-mail já está cadastrado.')

    const hash = await bcrypt.hash(password, 10)
    const create = db.transaction(() => {
      const info = q.insertUser.run({
        name,
        email,
        hash,
        role: wantsPro ? 'psychologist' : 'patient',
        status: wantsPro && !config.autoApprovePsychologists ? 'pending' : 'active',
        crp: wantsPro ? crp : null,
      })
      const id = Number(info.lastInsertRowid)
      // Chave errada cancela o cadastro inteiro: a pessoa corrige e tenta de novo.
      const psy = !wantsPro && accessKey ? redeemKey(id, accessKey) : null
      return { id, psy }
    })
    const { id, psy } = create()
    const user = q.userById.get(id)
    if (psy) live.patientLinked(psy.id, id)
    res.status(201).json({ token: sign(user), user: publicUser(user) })
  })

  api.post('/auth/login', authLimiter, async (req, res) => {
    const email = clean(req.body.email, 160).toLowerCase()
    const password = typeof req.body.password === 'string' ? req.body.password : ''
    if (!email || !password) throw bad('Preencha e-mail e senha.')
    const user = q.userByEmail.get(email)
    const ok = user && (await bcrypt.compare(password, user.password_hash))
    if (!ok) throw bad('E-mail ou senha incorretos.')
    if (user.status === 'blocked') throw new HttpError(403, 'Esta conta foi bloqueada. Fale com o suporte.')
    res.json({ token: sign(user), user: publicUser(user) })
  })

  api.get('/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }))

  api.patch('/user/bamboo', auth, (req, res) => {
    const bamboo = Number(req.body.bamboo)
    if (!Number.isInteger(bamboo) || bamboo < 0 || bamboo > 9999) throw bad('Valor inválido.')
    db.prepare('UPDATE users SET bamboo = ? WHERE id = ?').run(bamboo, req.user.id)
    res.json({ bamboo })
  })

  api.post('/user/link', auth, role('patient'), authLimiter, (req, res) => {
    if (req.user.psychologist_id) throw bad('Você já está vinculado a uma psicóloga.')
    const psy = redeemKey(req.user.id, req.body.accessKey)
    live.patientLinked(psy.id, req.user.id)
    res.json({ user: publicUser(q.userById.get(req.user.id)) })
  })

  api.delete('/user/link', auth, role('patient'), (req, res) => {
    const psyId = req.user.psychologist_id
    db.prepare('UPDATE users SET psychologist_id = NULL WHERE id = ?').run(req.user.id)
    if (psyId) live.patientUnlinked(psyId, req.user.id)
    res.json({ user: publicUser(q.userById.get(req.user.id)) })
  })

  // ---------- tarefas ----------
  api.get('/reminders', auth, (req, res) => {
    const rows = db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY id DESC').all(req.user.id)
    res.json({ reminders: rows.map(reminderOut) })
  })

  api.post('/reminders', auth, (req, res) => {
    const text = clean(req.body.text, 200)
    if (!text) throw bad('Escreva a tarefa.')
    const time = /^\d{2}:\d{2}$/.test(req.body.time) ? req.body.time : '--:--'
    const category = clean(req.body.category, 30) || 'Estudos'
    const info = db
      .prepare('INSERT INTO reminders (user_id, text, category, time) VALUES (?, ?, ?, ?)')
      .run(req.user.id, text, category, time)
    res.status(201).json({ reminder: reminderOut(db.prepare('SELECT * FROM reminders WHERE id = ?').get(info.lastInsertRowid)) })
  })

  api.patch('/reminders/:id', auth, (req, res) => {
    const row = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!row) throw new HttpError(404, 'Tarefa não encontrada.')
    const done = req.body.done ? 1 : 0
    db.prepare('UPDATE reminders SET done = ? WHERE id = ?').run(done, row.id)
    res.json({ reminder: reminderOut({ ...row, done }) })
  })

  api.delete('/reminders/:id', auth, (req, res) => {
    db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
    res.json({ success: true })
  })

  // ---------- tutor de IA ----------
  const aiMessages = (userId, limit = 200) =>
    db
      .prepare('SELECT id, role, message FROM (SELECT * FROM ai_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id')
      .all(userId, limit)

  api.get('/chat', auth, (req, res) => res.json({ messages: aiMessages(req.user.id) }))

  api.post('/chat', auth, (req, res) => {
    const message = clean(req.body.message, 4000)
    const r = req.body.role === 'ai' ? 'ai' : 'user'
    if (!message) throw bad('Mensagem vazia.')
    db.prepare('INSERT INTO ai_messages (user_id, role, message) VALUES (?, ?, ?)').run(req.user.id, r, message)
    res.status(201).json({ success: true })
  })

  api.delete('/chat', auth, (req, res) => {
    db.prepare('DELETE FROM ai_messages WHERE user_id = ?').run(req.user.id)
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

    const history = [...aiMessages(req.user.id, 12), { role: 'user', message }]
    let reply
    try {
      reply = await askPapp(config, history)
    } catch (err) {
      if (err instanceof AiUnavailable) throw new HttpError(503, err.message)
      throw new HttpError(503, 'O tutor demorou para responder. Tente de novo em instantes.')
    }
    const insert = db.prepare('INSERT INTO ai_messages (user_id, role, message) VALUES (?, ?, ?)')
    insert.run(req.user.id, 'user', message)
    const info = insert.run(req.user.id, 'ai', reply)
    res.json({ reply, id: Number(info.lastInsertRowid) })
  })

  // ---------- diário (só a própria pessoa lê) ----------
  api.get('/journal', auth, (req, res) => {
    const entries = db
      .prepare('SELECT id, text, mood, created_at AS createdAt FROM journal WHERE user_id = ? ORDER BY id DESC LIMIT 300')
      .all(req.user.id)
    res.json({ entries })
  })

  api.post('/journal', auth, (req, res) => {
    const text = clean(req.body.text, 5000)
    if (!text) throw bad('Escreva algo antes de salvar.')
    const mood = clean(req.body.mood, 20) || null
    const info = db.prepare('INSERT INTO journal (user_id, text, mood) VALUES (?, ?, ?)').run(req.user.id, text, mood)
    const entry = db.prepare('SELECT id, text, mood, created_at AS createdAt FROM journal WHERE id = ?').get(info.lastInsertRowid)
    res.status(201).json({ entry })
  })

  api.delete('/journal/:id', auth, (req, res) => {
    db.prepare('DELETE FROM journal WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
    res.json({ success: true })
  })

  // ---------- fale conosco ----------
  api.post('/feedback', auth, (req, res) => {
    const message = clean(req.body.message, 2000)
    if (!message) throw bad('Escreva sua mensagem.')
    db.prepare('INSERT INTO feedback (user_id, message) VALUES (?, ?)').run(req.user.id, message)
    res.status(201).json({ success: true })
  })

  // ---------- chat ao vivo (histórico e envio por HTTP, caso o socket caia) ----------
  api.get('/live/:patientId/messages', auth, (req, res) => {
    const pair = carePair(req.user, req.params.patientId)
    if (!pair) throw new HttpError(403, 'Você não participa desta conversa.')
    live.markRead(pair, req.user.id)
    const peerId = req.user.id === pair.patientId ? pair.psychologistId : pair.patientId
    res.json({ messages: live.history(pair), peerOnline: live.isOnline(peerId) })
  })

  api.post('/live/:patientId/messages', auth, (req, res) => {
    const pair = carePair(req.user, req.params.patientId)
    if (!pair) throw new HttpError(403, 'Você não participa desta conversa.')
    const body = clean(req.body.body, 2000)
    if (!body) throw bad('Mensagem vazia.')
    res.status(201).json({ message: live.send(pair, req.user.id, body) })
  })

  // ---------- receitas: lado do paciente ----------
  const prescriptionOut = (p, today) => ({
    id: p.id,
    title: p.title,
    body: p.body,
    frequency: p.frequency,
    active: !!p.active,
    createdAt: p.created_at,
    doneToday: !!db.prepare('SELECT 1 FROM prescription_logs WHERE prescription_id = ? AND day = ?').get(p.id, today),
    doneLast7: db
      .prepare("SELECT COUNT(*) AS n FROM prescription_logs WHERE prescription_id = ? AND day > date(?, '-7 day') AND day <= ?")
      .get(p.id, today, today).n,
  })
  const dayOf = (req) => {
    const d = req.query.day || req.body?.day
    return DAY_RE.test(d) ? d : new Date().toISOString().slice(0, 10)
  }

  api.get('/care/prescriptions', auth, role('patient'), (req, res) => {
    if (!req.user.psychologist_id) return res.json({ prescriptions: [] })
    const rows = db
      .prepare('SELECT * FROM prescriptions WHERE patient_id = ? AND psychologist_id = ? AND active = 1 ORDER BY id DESC')
      .all(req.user.id, req.user.psychologist_id)
    res.json({ prescriptions: rows.map((p) => prescriptionOut(p, dayOf(req))) })
  })

  api.post('/care/prescriptions/:id/check', auth, role('patient'), (req, res) => {
    const p = db.prepare('SELECT * FROM prescriptions WHERE id = ? AND patient_id = ?').get(req.params.id, req.user.id)
    if (!p || p.psychologist_id !== req.user.psychologist_id) throw new HttpError(404, 'Orientação não encontrada.')
    const day = dayOf(req)
    if (req.body.done === false) db.prepare('DELETE FROM prescription_logs WHERE prescription_id = ? AND day = ?').run(p.id, day)
    else db.prepare('INSERT OR IGNORE INTO prescription_logs (prescription_id, day) VALUES (?, ?)').run(p.id, day)
    res.json({ prescription: prescriptionOut(p, day) })
  })

  // ---------- área da psicóloga ----------
  const pro = express.Router()
  api.use('/pro', auth, role('psychologist'), pro)

  const keyOut = (k) => {
    const usedBy = k.used_by ? q.userById.get(k.used_by) : null
    const status = k.revoked ? 'revoked' : k.used_by || k.used_at ? 'used' : k.expires_at < new Date().toISOString() ? 'expired' : 'available'
    return { id: k.id, code: k.code, label: k.label, status, usedBy: usedBy?.name || null, expiresAt: k.expires_at, createdAt: k.created_at }
  }

  pro.get('/keys', (req, res) => {
    const rows = db.prepare('SELECT * FROM access_keys WHERE psychologist_id = ? ORDER BY id DESC LIMIT 200').all(req.user.id)
    res.json({ keys: rows.map(keyOut) })
  })

  pro.post('/keys', (req, res) => {
    const open = db
      .prepare('SELECT COUNT(*) AS n FROM access_keys WHERE psychologist_id = ? AND used_by IS NULL AND revoked = 0 AND expires_at > ?')
      .get(req.user.id, new Date().toISOString()).n
    if (open >= 50) throw bad('Você já tem muitas chaves em aberto. Revogue algumas antes de gerar outra.')
    const expires = new Date(Date.now() + config.keyTtlDays * 86_400_000).toISOString()
    const info = db
      .prepare('INSERT INTO access_keys (code, psychologist_id, label, expires_at) VALUES (?, ?, ?, ?)')
      .run(newKeyCode(), req.user.id, clean(req.body.label, 60) || null, expires)
    res.status(201).json({ key: keyOut(db.prepare('SELECT * FROM access_keys WHERE id = ?').get(info.lastInsertRowid)) })
  })

  pro.delete('/keys/:id', (req, res) => {
    db.prepare('UPDATE access_keys SET revoked = 1 WHERE id = ? AND psychologist_id = ? AND used_by IS NULL').run(req.params.id, req.user.id)
    res.json({ success: true })
  })

  pro.get('/patients', (req, res) => {
    const rows = db.prepare('SELECT id, name, email, created_at FROM users WHERE psychologist_id = ? ORDER BY name').all(req.user.id)
    const patients = rows.map((p) => {
      const last = db
        .prepare('SELECT body, sender_id, created_at FROM live_messages WHERE patient_id = ? AND psychologist_id = ? ORDER BY id DESC LIMIT 1')
        .get(p.id, req.user.id)
      const unread = db
        .prepare('SELECT COUNT(*) AS n FROM live_messages WHERE patient_id = ? AND psychologist_id = ? AND sender_id = ? AND read_at IS NULL')
        .get(p.id, req.user.id, p.id).n
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        online: live.isOnline(p.id),
        unread,
        lastMessage: last ? { body: last.body, mine: last.sender_id === req.user.id, createdAt: last.created_at } : null,
      }
    })
    res.json({ patients })
  })

  const ownPatient = (req) => {
    const p = q.userById.get(req.params.id)
    if (!p || p.psychologist_id !== req.user.id) throw new HttpError(404, 'Paciente não encontrado.')
    return p
  }

  pro.delete('/patients/:id', (req, res) => {
    const p = ownPatient(req)
    db.prepare('UPDATE users SET psychologist_id = NULL WHERE id = ?').run(p.id)
    live.patientUnlinked(req.user.id, p.id)
    res.json({ success: true })
  })

  pro.get('/patients/:id/prescriptions', (req, res) => {
    const p = ownPatient(req)
    const rows = db.prepare('SELECT * FROM prescriptions WHERE patient_id = ? AND psychologist_id = ? ORDER BY active DESC, id DESC').all(p.id, req.user.id)
    res.json({ prescriptions: rows.map((r) => prescriptionOut(r, dayOf(req))) })
  })

  pro.post('/patients/:id/prescriptions', (req, res) => {
    const p = ownPatient(req)
    const title = clean(req.body.title, 120)
    if (!title) throw bad('Dê um título para a orientação.')
    const info = db
      .prepare('INSERT INTO prescriptions (patient_id, psychologist_id, title, body, frequency) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, req.user.id, title, clean(req.body.body, 3000), clean(req.body.frequency, 60))
    const row = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(info.lastInsertRowid)
    live.notify(p.id, 'care:prescriptions')
    res.status(201).json({ prescription: prescriptionOut(row, dayOf(req)) })
  })

  const ownPrescription = (req) => {
    const row = db.prepare('SELECT * FROM prescriptions WHERE id = ? AND psychologist_id = ?').get(req.params.id, req.user.id)
    if (!row) throw new HttpError(404, 'Orientação não encontrada.')
    return row
  }

  pro.patch('/prescriptions/:id', (req, res) => {
    const row = ownPrescription(req)
    const next = {
      title: req.body.title !== undefined ? clean(req.body.title, 120) || row.title : row.title,
      body: req.body.body !== undefined ? clean(req.body.body, 3000) : row.body,
      frequency: req.body.frequency !== undefined ? clean(req.body.frequency, 60) : row.frequency,
      active: req.body.active !== undefined ? (req.body.active ? 1 : 0) : row.active,
    }
    db.prepare('UPDATE prescriptions SET title = @title, body = @body, frequency = @frequency, active = @active WHERE id = @id').run({ ...next, id: row.id })
    live.notify(row.patient_id, 'care:prescriptions')
    res.json({ prescription: prescriptionOut({ ...row, ...next }, dayOf(req)) })
  })

  pro.delete('/prescriptions/:id', (req, res) => {
    const row = ownPrescription(req)
    db.prepare('DELETE FROM prescriptions WHERE id = ?').run(row.id)
    live.notify(row.patient_id, 'care:prescriptions')
    res.json({ success: true })
  })

  // ---------- administração ----------
  // O admin gerencia contas. Conversas, diários e receitas ficam fora do alcance dele (sigilo profissional).
  const admin = express.Router()
  api.use('/admin', auth, role('admin'), admin)

  admin.get('/stats', (_req, res) => {
    const n = (sql, ...a) => db.prepare(sql).get(...a).n
    res.json({
      patients: n("SELECT COUNT(*) AS n FROM users WHERE role = 'patient'"),
      patientsLinked: n("SELECT COUNT(*) AS n FROM users WHERE role = 'patient' AND psychologist_id IS NOT NULL"),
      psychologists: n("SELECT COUNT(*) AS n FROM users WHERE role = 'psychologist' AND status = 'active'"),
      pending: n("SELECT COUNT(*) AS n FROM users WHERE role = 'psychologist' AND status = 'pending'"),
      blocked: n("SELECT COUNT(*) AS n FROM users WHERE status = 'blocked'"),
      newThisWeek: n("SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now', '-7 day')"),
      feedback: n('SELECT COUNT(*) AS n FROM feedback'),
    })
  })

  admin.get('/users', (req, res) => {
    const where = []
    const args = []
    if (['patient', 'psychologist', 'admin'].includes(req.query.role)) where.push('role = ?'), args.push(req.query.role)
    if (['active', 'pending', 'blocked'].includes(req.query.status)) where.push('status = ?'), args.push(req.query.status)
    const term = clean(req.query.q, 80)
    if (term) where.push('(name LIKE ? OR email LIKE ?)'), args.push(`%${term}%`, `%${term}%`)
    const rows = db
      .prepare(`SELECT * FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (status = 'pending') DESC, id DESC LIMIT 300`)
      .all(...args)
    res.json({
      users: rows.map((u) => ({
        ...publicUser(u),
        patientCount: u.role === 'psychologist' ? db.prepare('SELECT COUNT(*) AS n FROM users WHERE psychologist_id = ?').get(u.id).n : undefined,
      })),
    })
  })

  const manageable = (req) => {
    const u = q.userById.get(req.params.id)
    if (!u) throw new HttpError(404, 'Usuário não encontrado.')
    if (u.role === 'admin') throw bad('Contas de administrador não podem ser alteradas por aqui.')
    return u
  }

  admin.patch('/users/:id', (req, res) => {
    const u = manageable(req)
    if (!['active', 'blocked'].includes(req.body.status)) throw bad('Status inválido.')
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(req.body.status, u.id)
    if (req.body.status === 'blocked') live.disconnectUser(u.id)
    res.json({ user: publicUser(q.userById.get(u.id)) })
  })

  admin.delete('/users/:id', (req, res) => {
    const u = manageable(req)
    live.disconnectUser(u.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
    res.json({ success: true })
  })

  admin.get('/feedback', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT f.id, f.message, f.created_at AS createdAt, u.name AS userName, u.email AS userEmail
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 300`,
      )
      .all()
    res.json({ feedback: rows })
  })

  admin.delete('/feedback/:id', (req, res) => {
    db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  })

  // ---------- erros ----------
  api.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.')))
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
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) db.prepare("UPDATE users SET role = 'admin', status = 'active', password_hash = ? WHERE id = ?").run(hash, existing.id)
  else db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(config.adminName, email, hash)
  return true
}
