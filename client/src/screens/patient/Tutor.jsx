import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { MASCOT_NAME } from '../../config.js'
import Icon from '../../components/Icon.jsx'
import Mascot from '../../components/Mascot.jsx'
import { useToast } from '../../components/ui.jsx'

const HELLO = { id: 'hello', role: 'ai', message: `Oi! Sou o ${MASCOT_NAME}. Posso ajudar a organizar os estudos, dividir uma tarefa grande ou pensar numa pausa. 🐼` }
const IDEAS = ['Não sei por onde começar a estudar', 'Divide esta tarefa em passos pequenos', 'Estou sem foco hoje']

export default function Tutor() {
  const toast = useToast()
  const [messages, setMessages] = useState([HELLO])
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const logRef = useRef(null)

  useEffect(() => {
    api('/chat').then((d) => d.messages.length && setMessages(d.messages)).catch(() => {})
  }, [])
  useLayoutEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking])

  async function send(raw) {
    const message = (raw ?? text).trim()
    if (!message || thinking) return
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', message }])
    setText('')
    setThinking(true)
    try {
      const d = await api('/ai', { method: 'POST', body: { message } })
      setMessages((m) => [...m, { id: d.id, role: 'ai', message: d.reply }])
    } catch (e) {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'ai', message: e.message }])
    } finally {
      setThinking(false)
    }
  }

  function clear() {
    setMessages([HELLO])
    api('/chat', { method: 'DELETE' }).catch((e) => toast(e.message))
  }

  return (
    <div className="page">
      <div className="row">
        <Mascot size={52} mood={thinking ? 'focus' : 'idle'} />
        <div className="grow">
          <h1>Tutor {MASCOT_NAME}</h1>
          <p className="muted small">Inteligência artificial. Pode errar e não substitui acompanhamento profissional.</p>
        </div>
        {messages.length > 1 && <button className="btn ghost sm" onClick={clear}>Limpar</button>}
      </div>

      <div className="chat-wrap">
        <div className="chat">
          <div className="chat-log" ref={logRef} aria-live="polite">
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role === 'user' ? 'me' : 'them'}`}>{m.message}</div>
            ))}
            {thinking && <div className="typing">{MASCOT_NAME} está pensando…</div>}
            {messages.length === 1 && (
              <div className="stack" style={{ gap: '0.5rem', marginTop: '0.5rem', alignItems: 'flex-start' }}>
                {IDEAS.map((i) => <button key={i} className="chip" onClick={() => send(i)}>{i}</button>)}
              </div>
            )}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
            <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Pergunte ao ${MASCOT_NAME}`} aria-label="Sua pergunta" maxLength={2000} />
            <button className="btn" disabled={!text.trim() || thinking} aria-label="Enviar"><Icon name="send" size={20} /></button>
          </form>
        </div>
      </div>
    </div>
  )
}
