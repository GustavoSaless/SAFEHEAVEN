import { io } from 'socket.io-client'
import { SOCKET_URL, session } from './api.js'

let socket = null

export function getSocket() {
  if (!socket && session.token) {
    socket = io(SOCKET_URL, {
      auth: (cb) => cb({ token: session.token }),
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 8000,
    })
  }
  return socket
}

export function closeSocket() {
  socket?.close()
  socket = null
}

window.addEventListener('sh:signout', closeSocket)

// Assina um evento e devolve a função para cancelar (pronta para useEffect).
export function onSocket(event, handler) {
  const s = getSocket()
  if (!s) return () => {}
  s.on(event, handler)
  return () => s.off(event, handler)
}
