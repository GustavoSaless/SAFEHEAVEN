import { Server } from 'socket.io'

/*
  Chat ao vivo entre paciente e psicóloga.
  Cada par conversa numa sala "care:<id do paciente>". Só entra na sala quem faz parte do vínculo.
*/
export function attachLive({ server, db, config, userFromToken, userById, carePair }) {
  const io = new Server(server, { cors: { origin: config.corsOrigin } })
  const online = new Map() // userId -> quantidade de conexões abertas
  const room = (patientId) => `care:${patientId}`
  const own = (userId) => `user:${userId}`
  const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null)

  const out = (m) => ({
    id: m.id,
    patientId: m.patient_id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: iso(m.created_at),
    readAt: iso(m.read_at),
  })

  async function history(pair, limit = 300) {
    const rows = await db.all(
      `SELECT * FROM (SELECT * FROM live_messages WHERE patient_id = $1 AND psychologist_id = $2 ORDER BY id DESC LIMIT $3) t ORDER BY id`,
      [pair.patientId, pair.psychologistId, limit],
    )
    return rows.map(out)
  }

  async function send(pair, senderId, body) {
    const row = await db.one(
      'INSERT INTO live_messages (patient_id, psychologist_id, sender_id, body) VALUES ($1, $2, $3, $4) RETURNING *',
      [pair.patientId, pair.psychologistId, senderId, body],
    )
    const message = out(row)
    io.to(room(pair.patientId)).emit('live:message', message)
    return message
  }

  async function markRead(pair, readerId) {
    const { changes } = await db.run(
      `UPDATE live_messages SET read_at = now()
       WHERE patient_id = $1 AND psychologist_id = $2 AND sender_id != $3 AND read_at IS NULL`,
      [pair.patientId, pair.psychologistId, readerId],
    )
    if (changes) io.to(room(pair.patientId)).emit('live:read', { patientId: pair.patientId, readerId })
  }

  const isOnline = (userId) => (online.get(userId) || 0) > 0

  // Quem precisa saber que este usuário entrou ou saiu.
  async function presenceRooms(user) {
    if (user.role === 'patient') return [room(user.id)]
    if (user.role === 'psychologist') {
      const rows = await db.all('SELECT id FROM users WHERE psychologist_id = $1', [user.id])
      return rows.map((p) => room(p.id))
    }
    return []
  }

  // Confere de novo no banco a cada ação: vínculo encerrado ou conta bloqueada param na hora.
  async function pairFor(userId, patientId) {
    const fresh = await userById(userId)
    return fresh && fresh.status !== 'blocked' ? carePair(fresh, patientId) : null
  }

  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth?.token || '')
      if (!user || user.status === 'blocked') return next(new Error('unauthorized'))
      socket.data.userId = user.id
      next()
    } catch {
      next(new Error('unavailable'))
    }
  })

  io.on('connection', async (socket) => {
    const userId = socket.data.userId
    // Registra os eventos antes de qualquer espera, para não perder mensagens enviadas logo na conexão.
    socket.on('live:send', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const pair = await pairFor(userId, payload?.patientId)
        const body = typeof payload?.body === 'string' ? payload.body.trim().slice(0, 2000) : ''
        if (!pair) return reply({ ok: false, error: 'Você não participa desta conversa.' })
        if (!body) return reply({ ok: false, error: 'Mensagem vazia.' })
        reply({ ok: true, message: await send(pair, userId, body) })
      } catch (err) {
        console.error('[chat]', err)
        reply({ ok: false, error: 'Não foi possível enviar. Tente de novo.' })
      }
    })

    socket.on('live:typing', async (payload) => {
      const pair = await pairFor(userId, payload?.patientId).catch(() => null)
      if (pair) socket.to(room(pair.patientId)).emit('live:typing', { patientId: pair.patientId, userId })
    })

    socket.on('live:read', async (payload) => {
      const pair = await pairFor(userId, payload?.patientId).catch(() => null)
      if (pair) await markRead(pair, userId).catch(() => {})
    })

    socket.on('disconnect', async () => {
      const left = (online.get(userId) || 1) - 1
      if (left > 0) return online.set(userId, left)
      online.delete(userId)
      try {
        const fresh = await userById(userId)
        if (fresh) (await presenceRooms(fresh)).forEach((r) => io.to(r).emit('presence', { userId, online: false }))
      } catch {}
    })

    socket.join(own(userId))
    online.set(userId, (online.get(userId) || 0) + 1)
    try {
      const user = await userById(userId)
      if (!user) return socket.disconnect(true)
      const rooms = await presenceRooms(user)
      if (user.role !== 'patient' || user.psychologist_id) rooms.forEach((r) => socket.join(r))
      if (online.get(userId) === 1) rooms.forEach((r) => socket.to(r).emit('presence', { userId, online: true }))
      socket.emit('ready')
    } catch (err) {
      console.error('[chat]', err)
    }
  })

  return {
    io,
    history,
    send,
    markRead,
    isOnline,
    notify: (userId, event, data = {}) => io.to(own(userId)).emit(event, data),
    patientLinked(psychologistId, patientId) {
      io.in(own(psychologistId)).socketsJoin(room(patientId))
      io.in(own(patientId)).socketsJoin(room(patientId))
      io.to(own(psychologistId)).emit('patients:changed')
      io.to(own(patientId)).emit('care:changed')
    },
    patientUnlinked(psychologistId, patientId) {
      io.in(own(psychologistId)).socketsLeave(room(patientId))
      io.in(own(patientId)).socketsLeave(room(patientId))
      io.to(own(psychologistId)).emit('patients:changed')
      io.to(own(patientId)).emit('care:changed')
    },
    disconnectUser: (userId) => io.in(own(userId)).disconnectSockets(true),
  }
}
