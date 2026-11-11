// Camada de rede: token, cache da sessão e aviso de servidor lento.
// Sem VITE_API_URL, o app fala com o próprio endereço onde está hospedado (o servidor entrega o app e a API juntos).
// No APK, defina VITE_API_URL=https://SEU-APP.onrender.com/api antes do build.
export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
export const SOCKET_URL = API_URL.replace(/\/api$/, '') || undefined

const TOKEN_KEY = 'sh_token'
const USER_KEY = 'sh_user'

const read = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {}
}

export const session = {
  get token() {
    return read(TOKEN_KEY)
  },
  get cachedUser() {
    try {
      return JSON.parse(read(USER_KEY) || 'null')
    } catch {
      return null
    }
  },
  save(token, user) {
    if (token) write(TOKEN_KEY, token)
    write(USER_KEY, JSON.stringify(user))
  },
  clear() {
    write(TOKEN_KEY, null)
    write(USER_KEY, null)
  },
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

// O servidor gratuito "dorme" quando fica parado; avisamos em vez de parecer travado.
let pendingSlow = 0
const setSlow = (on) => window.dispatchEvent(new CustomEvent('sh:slow', { detail: on }))

export async function api(path, { method = 'GET', body, timeout = 60_000 } = {}) {
  const ctrl = new AbortController()
  const kill = setTimeout(() => ctrl.abort(), timeout)
  let flagged = false
  const slow = setTimeout(() => {
    flagged = true
    if (++pendingSlow === 1) setSlow(true)
  }, 3500)

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (session.token) headers.Authorization = `Bearer ${session.token}`
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401 && session.token) window.dispatchEvent(new Event('sh:logout'))
      throw new ApiError(data.error || 'Algo deu errado. Tente de novo.', res.status)
    }
    return data
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(
      err.name === 'AbortError' ? 'O servidor demorou para responder. Tente de novo.' : 'Sem conexão com o servidor. Confira sua internet.',
      0,
    )
  } finally {
    clearTimeout(kill)
    clearTimeout(slow)
    if (flagged && --pendingSlow === 0) setSlow(false)
  }
}

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
