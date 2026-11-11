import { Server } from 'socket.io'

/*
  Chat ao vivo entre paciente e psicóloga.
  Cada par conversa numa sala "care:<id do paciente>". Só entra na sala quem faz parte do vínculo.
*/
export function attachLive({ server, db, config, userFromToken, carePair }) {
  const io = new Server(server, { cors: { origin: config.corsOrigin } })
  const online = new Map() // userId -> quantidade de conexões abertas
  const room = (patientId) => `care:${patientId}`
  const own = (userId) => `user:${userId}`

  const out = (m) => ({
    id: m.id,
    patientId: m.patient_id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: m.created_at,
    readAt: m.read_at,
  })

  function history(pair, limit = 300) {
    return db
      .prepare(
        `SELECT * FROM (SELECT * FROM live_messages WHERE patient_id = ? AND psychologist_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id`,
      )
      .all(pair.patientId, pair.psychologistId, limit)
      .map(out)
  }

  function send(pair, senderId, body) {
    const info = db
      .prepare('INSERT INTO live_messages (patient_id, psychologist_id, sender_id, body) VALUES (?, ?, ?, ?)')
      .run(pair.patientId, pair.psychologistId, senderId, body)
    const message = out(db.prepare('SELECT * FROM live_messages WHERE id = ?').get(info.lastInsertRowid))
    io.to(room(pair.patientId)).emit('live:message', message)
    return message
  }

  function markRead(pair, readerId) {
    const info = db
      .prepare(
        `UPDATE live_messages SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE patient_id = ? AND psychologist_id = ? AND sender_id != ? AND read_at IS NULL`,
      )
      .run(pair.patientId, pair.psychologistId, readerId)
    if (info.changes) io.to(room(pair.patientId)).emit('live:read', { patientId: pair.patientId, readerId })
  }

  const isOnline = (userId) => (online.get(userId) || 0) > 0

  // Quem precisa saber que este usuário entrou ou saiu.
  function presenceRooms(user) {
    if (user.role === 'patient') return [room(user.id)]
    if (user.role === 'psychologist')
      return db.prepare('SELECT id FROM users WHERE psychologist_id = ?').all(user.id).map((p) => room(p.id))
    return []
  }

  io.use((socket, next) => {
    const user = userFromToken(socket.handshake.auth?.token || '')
    if (!user || user.status === 'blocked') return next(new Error('unauthorized'))
    socket.data.userId = user.id
    next()
  })

  io.on('connection', (socket) => {
    const userId = socket.data.userId
    const me = () => db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    const user = me()
    if (!user) return socket.disconnect(true)

    socket.join(own(userId))
    const rooms = presenceRooms(user)
    if (user.role !== 'patient' || user.psychologist_id) rooms.forEach((r) => socket.join(r))

    online.set(userId, (online.get(userId) || 0) + 1)
    if (online.get(userId) === 1) rooms.forEach((r) => socket.to(r).emit('presence', { userId, online: true }))

    socket.on('live:send', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      const fresh = me()
      const pair = fresh && fresh.status !== 'blocked' ? carePair(fresh, payload?.patientId) : null
      const body = typeof payload?.body === 'string' ? payload.body.trim().slice(0, 2000) : ''
      if (!pair) return reply({ ok: false, error: 'Você não participa desta conversa.' })
      if (!body) return reply({ ok: false, error: 'Mensagem vazia.' })
      reply({ ok: true, message: send(pair, userId, body) })
    })

    socket.on('live:typing', (payload) => {
      const fresh = me()
      const pair = fresh ? carePair(fresh, payload?.patientId) : null
      if (pair) socket.to(room(pair.patientId)).emit('live:typing', { patientId: pair.patientId, userId })
    })

    socket.on('live:read', (payload) => {
      const fresh = me()
      const pair = fresh ? carePair(fresh, payload?.patientId) : null
      if (pair) markRead(pair, userId)
    })

    socket.on('disconnect', () => {
      const left = (online.get(userId) || 1) - 1
      if (left > 0) return online.set(userId, left)
      online.delete(userId)
      const fresh = me()
      if (fresh) presenceRooms(fresh).forEach((r) => io.to(r).emit('presence', { userId, online: false }))
    })
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
