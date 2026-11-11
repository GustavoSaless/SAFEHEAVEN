import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getSocket, onSocket } from '../lib/socket.js'
import Icon from './Icon.jsx'
import { useToast } from './ui.jsx'

const timeOf = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayOf = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86_400_000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })
}

/*
  Conversa em tempo real entre paciente e psicóloga(o).
  patientId identifica a conversa; meId é quem está usando o app; peerId é o outro lado.
*/
export default function LiveChat({ patientId, meId, peerId, peerName, showCrisisNote }) {
  const toast = useToast()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [online, setOnline] = useState(false)
  const [typing, setTyping] = useState(false)
  const logRef = useRef(null)
  const typingTimer = useRef(null)
  const lastTypingSent = useRef(0)

  const add = useCallback((m) => setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])), [])

  const load = useCallback(() => {
    api(`/live/${patientId}/messages`)
      .then((d) => {
        setMessages(d.messages)
        setOnline(d.peerOnline)
        setError('')
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [patientId])

  useEffect(() => {
    setLoading(true)
    load()
    const socket = getSocket()
    const offs = [
      onSocket('live:message', (m) => {
        if (m.patientId !== patientId) return
        add(m)
        if (m.senderId !== meId) {
          setTyping(false)
          if (!document.hidden) socket?.emit('live:read', { patientId })
        }
      }),
      onSocket('live:typing', (t) => {
        if (t.patientId !== patientId || t.userId === meId) return
        setTyping(true)
        clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setTyping(false), 3000)
      }),
      onSocket('live:read', (r) => {
        if (r.patientId !== patientId || r.readerId === meId) return
        const at = new Date().toISOString()
        setMessages((list) => list.map((m) => (m.senderId === meId && !m.readAt ? { ...m, readAt: at } : m)))
      }),
      onSocket('presence', (p) => p.userId === peerId && setOnline(p.online)),
      onSocket('connect', load), // voltou a conexão: busca o que perdeu
    ]
    return () => {
      offs.forEach((off) => off())
      clearTimeout(typingTimer.current)
    }
  }, [patientId, meId, peerId, add, load])

  useLayoutEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, typing])

  function onType(e) {
    setText(e.target.value)
    const now = Date.now()
    if (now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now
      getSocket()?.emit('live:typing', { patientId })
    }
  }

  async function send() {
    const body = text.trim()
    if (!body) return
    const temp = { id: `tmp-${Date.now()}`, patientId, senderId: meId, body, createdAt: new Date().toISOString(), pending: true }
    setMessages((list) => [...list, temp])
    setText('')
    const dropTemp = () => setMessages((list) => list.filter((m) => m.id !== temp.id))
    try {
      const socket = getSocket()
      let saved
      if (socket?.connected) {
        const ack = await socket.timeout(6000).emitWithAck('live:send', { patientId, body })
        if (!ack.ok) throw new Error(ack.error)
        saved = ack.message
      } else {
        saved = (await api(`/live/${patientId}/messages`, { method: 'POST', body: { body } })).message
      }
      dropTemp()
      add(saved)
    } catch (err) {
      dropTemp()
      setText(body)
      toast(err.message?.includes('participa') ? err.message : 'Não foi possível enviar. Tente de novo.')
    }
  }

  const lastMine = [...messages].reverse().find((m) => m.senderId === meId && !m.pending)
  let prevDay = ''

  return (
    <div className="chat">
      <div className="row small muted" style={{ gap: '0.375rem' }}>
        <i className={`status-dot ${online ? 'on' : ''}`} />
        {online ? `${peerName} está online` : `${peerName} não está online agora`}
      </div>

      <div className="chat-log" ref={logRef} aria-live="polite">
        {loading && <p className="empty">Carregando a conversa…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && messages.length === 0 && <p className="empty">Nenhuma mensagem ainda. Escreva quando quiser.</p>}
        {messages.map((m) => {
          const day = dayOf(m.createdAt)
          const showDay = day !== prevDay
          prevDay = day
          const mine = m.senderId === meId
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <div className="day">{day}</div>}
              <div className={`bubble ${mine ? 'me' : 'them'}`} style={m.pending ? { opacity: 0.6 } : undefined}>
                {m.body}
                <time>
                  {timeOf(m.createdAt)}
                  {mine && lastMine?.id === m.id && m.readAt ? ', lida' : ''}
                </time>
              </div>
            </div>
          )
        })}
        <div className="typing">{typing ? `${peerName} está digitando…` : ''}</div>
      </div>

      {showCrisisNote && (
        <p className="small muted">
          Este chat não é atendimento de emergência. Em crise, ligue 188 (CVV) ou 192 (SAMU).
        </p>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea
          rows={1}
          value={text}
          onChange={onType}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.innerWidth >= 900) { e.preventDefault(); send() } }}
          placeholder="Escreva uma mensagem"
          aria-label="Mensagem"
        />
        <button className="btn" disabled={!text.trim()} aria-label="Enviar">
          <Icon name="send" size={20} />
        </button>
      </form>
    </div>
  )
}
