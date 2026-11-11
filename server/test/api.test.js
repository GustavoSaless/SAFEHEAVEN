import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { io as ioClient } from 'socket.io-client'
import { openDb } from '../src/db.js'
import { loadConfig } from '../src/config.js'
import { createApp, seedAdmin } from '../src/app.js'

let base, server, fakeAi, db
const aiCalls = []

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)))

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json() }
}
const socketFor = (token) =>
  new Promise((resolve, reject) => {
    const s = ioClient(base, { auth: { token }, transports: ['websocket'], reconnection: false })
    s.on('connect', () => resolve(s))
    s.on('connect_error', reject)
  })
const once = (s, ev) => new Promise((r) => s.once(ev, r))

before(async () => {
  fakeAi = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      aiCalls.push({ headers: req.headers, body: JSON.parse(raw) })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'Vamos por partes 🐼' }] }))
    })
  })
  const aiPort = await listen(fakeAi)
  const config = loadConfig({
    JWT_SECRET: 'teste',
    ADMIN_EMAIL: 'admin@safehaven.app',
    ADMIN_PASSWORD: 'admin-senha-forte',
    ANTHROPIC_API_KEY: 'sk-teste',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`,
    DISABLE_RATE_LIMIT: 'true',
  })
  db = await openDb()
  await seedAdmin(db, config)
  server = createApp({ db, config }).server
  base = `http://127.0.0.1:${await listen(server)}`
})

after(async () => {
  await db.close()
  server.closeAllConnections?.()
  server.close()
  fakeAi.close()
})

const state = {}

test('cadastro valida os campos', async () => {
  assert.equal((await call('/auth/register', { method: 'POST', body: { name: 'A', email: 'x@x.com', password: '12345678' } })).status, 400)
  assert.equal((await call('/auth/register', { method: 'POST', body: { name: 'Ana', email: 'ruim', password: '12345678' } })).status, 400)
  assert.equal((await call('/auth/register', { method: 'POST', body: { name: 'Ana', email: 'ana@x.com', password: '123' } })).status, 400)
  const noCrp = await call('/auth/register', { method: 'POST', body: { name: 'Dra', email: 'dra@x.com', password: '12345678', role: 'psychologist' } })
  assert.equal(noCrp.status, 400)
})

test('paciente sem psicóloga se cadastra e usa o app', async () => {
  const r = await call('/auth/register', { method: 'POST', body: { name: 'Bia Solo', email: 'bia@x.com', password: 'senha-da-bia' } })
  assert.equal(r.status, 201)
  assert.equal(r.data.user.role, 'patient')
  assert.equal(r.data.user.psychologist, null)
  assert.equal(r.data.user.bamboo, 3)
  state.bia = r.data

  const dup = await call('/auth/register', { method: 'POST', body: { name: 'Bia', email: 'BIA@x.com', password: 'senha-da-bia' } })
  assert.equal(dup.status, 400)

  const login = await call('/auth/login', { method: 'POST', body: { email: 'bia@x.com', password: 'senha-da-bia' } })
  assert.equal(login.status, 200)
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'bia@x.com', password: 'errada' } })).status, 400)
  assert.equal((await call('/auth/me')).status, 401)
  assert.equal((await call('/auth/me', { token: login.data.token })).data.user.email, 'bia@x.com')

  const t = state.bia.token
  assert.equal((await call('/user/bamboo', { method: 'PATCH', token: t, body: { bamboo: 5 } })).data.bamboo, 5)
  assert.equal((await call('/user/bamboo', { method: 'PATCH', token: t, body: { bamboo: -1 } })).status, 400)

  const rem = await call('/reminders', { method: 'POST', token: t, body: { text: 'Ler capítulo 2', category: 'Estudos', time: '14:30' } })
  assert.equal(rem.status, 201)
  assert.equal(rem.data.reminder.done, 0)
  const id = rem.data.reminder.id
  assert.equal((await call(`/reminders/${id}`, { method: 'PATCH', token: t, body: { done: 1 } })).data.reminder.done, 1)
  assert.equal((await call('/reminders', { token: t })).data.reminders.length, 1)
  await call(`/reminders/${id}`, { method: 'DELETE', token: t })
  assert.equal((await call('/reminders', { token: t })).data.reminders.length, 0)

  const j = await call('/journal', { method: 'POST', token: t, body: { text: 'Hoje foi puxado.', mood: 'cansada' } })
  assert.equal(j.status, 201)
  assert.equal((await call('/journal', { token: t })).data.entries.length, 1)

  assert.equal((await call('/feedback', { method: 'POST', token: t, body: { message: 'Amei o panda' } })).status, 201)

  // sem vínculo: nada de chat ao vivo nem receitas
  assert.equal((await call(`/live/${state.bia.user.id}/messages`, { token: t })).status, 403)
  assert.deepEqual((await call('/care/prescriptions', { token: t })).data.prescriptions, [])
  assert.equal((await call('/pro/keys', { token: t })).status, 403)
  assert.equal((await call('/admin/stats', { token: t })).status, 403)
})

test('tutor de IA responde pelo servidor, com a chave fora do app', async () => {
  const t = state.bia.token
  const r = await call('/ai', { method: 'POST', token: t, body: { message: 'Como começo a estudar?' } })
  assert.equal(r.status, 200)
  assert.equal(r.data.reply, 'Vamos por partes 🐼')
  assert.equal(aiCalls[0].headers['x-api-key'], 'sk-teste')
  assert.equal(aiCalls[0].body.messages.at(-1).content, 'Como começo a estudar?')
  await call('/ai', { method: 'POST', token: t, body: { message: 'E depois?' } })
  assert.deepEqual(aiCalls[1].body.messages.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.equal((await call('/chat', { token: t })).data.messages.length, 4)
  await call('/chat', { method: 'DELETE', token: t })
  assert.equal((await call('/chat', { token: t })).data.messages.length, 0)
})

test('psicóloga fica em análise até o admin aprovar', async () => {
  const r = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Dra. Carla', email: 'carla@x.com', password: 'senha-carla', role: 'psychologist', crp: '06/123456' },
  })
  assert.equal(r.status, 201)
  assert.equal(r.data.user.status, 'pending')
  state.carla = r.data
  assert.equal((await call('/pro/keys', { method: 'POST', token: r.data.token, body: {} })).status, 403)

  const admin = await call('/auth/login', { method: 'POST', body: { email: 'admin@safehaven.app', password: 'admin-senha-forte' } })
  assert.equal(admin.data.user.role, 'admin')
  state.admin = admin.data
  const stats = await call('/admin/stats', { token: admin.data.token })
  assert.equal(stats.data.pending, 1)
  const pend = await call('/admin/users?status=pending', { token: admin.data.token })
  assert.equal(pend.data.users.length, 1)
  const ok = await call(`/admin/users/${r.data.user.id}`, { method: 'PATCH', token: admin.data.token, body: { status: 'active' } })
  assert.equal(ok.data.user.status, 'active')
  assert.equal((await call('/admin/feedback', { token: admin.data.token })).data.feedback[0].message, 'Amei o panda')
  // admin não entra em conversas clínicas
  assert.equal((await call(`/live/${state.bia.user.id}/messages`, { token: admin.data.token })).status, 403)
  assert.equal((await call(`/admin/users/${admin.data.user.id}`, { method: 'DELETE', token: admin.data.token })).status, 400)
})

test('chave de acesso: gera, vincula uma única vez, recusa inválidas', async () => {
  const pt = state.carla.token
  const k1 = (await call('/pro/keys', { method: 'POST', token: pt, body: { label: 'Davi' } })).data.key
  assert.match(k1.code, /^SH-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.equal(k1.status, 'available')

  const wrong = await call('/auth/register', { method: 'POST', body: { name: 'Davi', email: 'davi@x.com', password: 'senha-davi', accessKey: 'SH-AAAA-BBBB' } })
  assert.equal(wrong.status, 400)
  // chave errada não deixa conta órfã para trás
  assert.equal((await db.one("SELECT count(*)::int AS n FROM users WHERE email = 'davi@x.com'")).n, 0)

  const davi = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Davi', email: 'davi@x.com', password: 'senha-davi', accessKey: k1.code.toLowerCase().replaceAll('-', ' ') },
  })
  assert.equal(davi.status, 201)
  assert.equal(davi.data.user.psychologist.name, 'Dra. Carla')
  state.davi = davi.data

  // a mesma chave não serve para outra pessoa
  const reuse = await call('/user/link', { method: 'POST', token: state.bia.token, body: { accessKey: k1.code } })
  assert.equal(reuse.status, 400)

  const k2 = (await call('/pro/keys', { method: 'POST', token: pt, body: {} })).data.key
  await call(`/pro/keys/${k2.id}`, { method: 'DELETE', token: pt })
  assert.equal((await call('/user/link', { method: 'POST', token: state.bia.token, body: { accessKey: k2.code } })).status, 400)

  const k3 = (await call('/pro/keys', { method: 'POST', token: pt, body: {} })).data.key
  await db.run("UPDATE access_keys SET expires_at = '2020-01-01T00:00:00Z' WHERE id = $1", [k3.id])
  assert.equal((await call('/user/link', { method: 'POST', token: state.bia.token, body: { accessKey: k3.code } })).status, 400)

  const keys = (await call('/pro/keys', { token: pt })).data.keys
  assert.deepEqual(keys.map((k) => k.status), ['expired', 'revoked', 'used'])
  assert.equal(keys[2].usedBy, 'Davi')

  const patients = (await call('/pro/patients', { token: pt })).data.patients
  assert.deepEqual(patients.map((p) => p.name), ['Davi'])
})

test('receitas: psicóloga escreve, paciente vê e marca como feita', async () => {
  const pt = state.carla.token
  const dt = state.davi.token
  const pid = state.davi.user.id
  const made = await call(`/pro/patients/${pid}/prescriptions`, {
    method: 'POST',
    token: pt,
    body: { title: 'Respiração quadrada', body: '4 ciclos ao acordar e antes de dormir.', frequency: '2x ao dia' },
  })
  assert.equal(made.status, 201)
  const id = made.data.prescription.id

  // não dá para escrever receita para quem não é seu paciente
  assert.equal((await call(`/pro/patients/${state.bia.user.id}/prescriptions`, { method: 'POST', token: pt, body: { title: 'x' } })).status, 404)

  const list = await call('/care/prescriptions?day=2026-11-11', { token: dt })
  assert.equal(list.data.prescriptions.length, 1)
  assert.equal(list.data.prescriptions[0].doneToday, false)
  const done = await call(`/care/prescriptions/${id}/check`, { method: 'POST', token: dt, body: { day: '2026-11-11' } })
  assert.equal(done.data.prescription.doneToday, true)
  const seen = await call(`/pro/patients/${pid}/prescriptions?day=2026-11-11`, { token: pt })
  assert.equal(seen.data.prescriptions[0].doneLast7, 1)
  // outra paciente não marca a receita do Davi
  assert.equal((await call(`/care/prescriptions/${id}/check`, { method: 'POST', token: state.bia.token, body: {} })).status, 404)

  await call(`/pro/prescriptions/${id}`, { method: 'PATCH', token: pt, body: { active: false } })
  assert.equal((await call('/care/prescriptions', { token: dt })).data.prescriptions.length, 0)
})

test('chat ao vivo: entrega em tempo real, leitura, presença e isolamento', async () => {
  const pid = state.davi.user.id
  const sPsy = await socketFor(state.carla.token)
  const sDavi = await socketFor(state.davi.token)
  const sBia = await socketFor(state.bia.token)
  await assert.rejects(socketFor('token-invalido'))

  let leaked = false
  sBia.on('live:message', () => (leaked = true))

  const arrives = once(sPsy, 'live:message')
  const ack = await sDavi.emitWithAck('live:send', { patientId: pid, body: '  Oi, doutora  ' })
  assert.equal(ack.ok, true)
  const got = await arrives
  assert.equal(got.body, 'Oi, doutora')
  assert.equal(got.senderId, pid)

  const typing = once(sDavi, 'live:typing')
  sPsy.emit('live:typing', { patientId: pid })
  assert.equal((await typing).userId, state.carla.user.id)

  const back = once(sDavi, 'live:message')
  await sPsy.emitWithAck('live:send', { patientId: pid, body: 'Oi, Davi! Como foi a semana?' })
  assert.equal((await back).senderId, state.carla.user.id)

  // quem não é do vínculo não envia nem lê
  const intruder = await sBia.emitWithAck('live:send', { patientId: pid, body: 'invadi' })
  assert.equal(intruder.ok, false)
  assert.equal((await call(`/live/${pid}/messages`, { token: state.bia.token })).status, 403)

  const list = (await call('/pro/patients', { token: state.carla.token })).data.patients[0]
  assert.equal(list.unread, 1)
  assert.equal(list.online, true)

  const read = once(sDavi, 'live:read')
  const hist = await call(`/live/${pid}/messages`, { token: state.carla.token })
  assert.equal(hist.data.messages.length, 2)
  assert.equal(hist.data.peerOnline, true)
  await read
  assert.equal((await call('/pro/patients', { token: state.carla.token })).data.patients[0].unread, 0)

  // envio por HTTP também chega no socket
  const viaHttp = once(sPsy, 'live:message')
  await call(`/live/${pid}/messages`, { method: 'POST', token: state.davi.token, body: { body: 'Mandei pelo HTTP' } })
  assert.equal((await viaHttp).body, 'Mandei pelo HTTP')

  const gone = once(sPsy, 'presence')
  sDavi.close()
  assert.deepEqual(await gone, { userId: pid, online: false })

  await new Promise((r) => setTimeout(r, 50))
  assert.equal(leaked, false)
  sPsy.close()
  sBia.close()
})

test('vincular depois do cadastro avisa a psicóloga na hora', async () => {
  const sPsy = await socketFor(state.carla.token)
  const k = (await call('/pro/keys', { method: 'POST', token: state.carla.token, body: {} })).data.key
  const changed = once(sPsy, 'patients:changed')
  const linked = await call('/user/link', { method: 'POST', token: state.bia.token, body: { accessKey: k.code } })
  assert.equal(linked.data.user.psychologist.name, 'Dra. Carla')
  await changed
  const arrives = once(sPsy, 'live:message')
  await call(`/live/${state.bia.user.id}/messages`, { method: 'POST', token: state.bia.token, body: { body: 'Cheguei' } })
  assert.equal((await arrives).body, 'Cheguei')

  await call('/user/link', { method: 'DELETE', token: state.bia.token })
  assert.equal((await call(`/live/${state.bia.user.id}/messages`, { token: state.carla.token })).status, 403)
  sPsy.close()
})

test('admin bloqueia e a conta para de funcionar', async () => {
  const at = state.admin.token
  await call(`/admin/users/${state.davi.user.id}`, { method: 'PATCH', token: at, body: { status: 'blocked' } })
  assert.equal((await call('/auth/me', { token: state.davi.token })).status, 403)
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'davi@x.com', password: 'senha-davi' } })).status, 403)
  await call(`/admin/users/${state.davi.user.id}`, { method: 'DELETE', token: at })
  assert.equal((await call('/pro/patients', { token: state.carla.token })).data.patients.length, 0)
})
