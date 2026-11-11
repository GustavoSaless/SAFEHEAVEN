import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { timer } from '../../lib/timer.js'
import { chime, sound } from '../../lib/audio.js'
import { getSocket, onSocket } from '../../lib/socket.js'
import { cancelTask, onTaskAction, scheduleTask } from '../../lib/notify.js'
import { useApp } from '../../App.jsx'
import { APP_NAME, MASCOT_NAME } from '../../config.js'
import Shell from '../../components/Shell.jsx'
import Icon from '../../components/Icon.jsx'
import Mascot from '../../components/Mascot.jsx'
import { Sheet, usePref, useToast } from '../../components/ui.jsx'
import { PatientCtx } from './ctx.js'
import Focus from './Focus.jsx'
import Relief, { Breathing, Grounding } from './Relief.jsx'
import Tasks from './Tasks.jsx'
import Tutor from './Tutor.jsx'
import Care from './Care.jsx'

const TABS = [
  { id: 'focus', icon: 'focus', label: 'Foco' },
  { id: 'relief', icon: 'relief', label: 'Alívio' },
  { id: 'tasks', icon: 'tasks', label: 'Tarefas' },
  { id: 'tutor', icon: 'tutor', label: MASCOT_NAME },
  { id: 'care', icon: 'care', label: 'Terapia' },
]
const hhmm = () => new Date().toTimeString().slice(0, 5)

// Atalho de emergência: respiração e aterramento a um toque, em qualquer tela.
function Sos({ onClose, hasPsy, onTalk }) {
  const [tool, setTool] = useState(null)
  return (
    <Sheet title={tool === 'breath' ? 'Respire comigo' : tool === 'ground' ? 'Aterramento' : 'Vamos passar por isso'} onClose={onClose}>
      {tool === 'breath' && <Breathing autoStart />}
      {tool === 'ground' && <Grounding />}
      {!tool && (
        <>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <Mascot size={80} mood="care" />
            <p className="speech grow">Estou aqui com você. Escolha uma das duas e eu guio o passo a passo.</p>
          </div>
          <button className="btn block" onClick={() => setTool('breath')}><Icon name="wind" size={20} /> Respirar agora</button>
          <button className="btn soft block" onClick={() => setTool('ground')}><Icon name="eye" size={20} /> Voltar para o presente (5-4-3-2-1)</button>
          {hasPsy && <button className="btn ghost block" onClick={onTalk}><Icon name="care" size={20} /> Escrever para minha psicóloga</button>}
          <div className="card stack" style={{ gap: '0.5rem' }}>
            <p className="small"><strong>Se você sente que corre perigo</strong>, fale com uma pessoa agora:</p>
            <a className="btn danger block" href="tel:188"><Icon name="phone" size={20} /> CVV 188, gratuito, 24 horas</a>
            <a className="btn danger block" href="tel:192"><Icon name="phone" size={20} /> SAMU 192, emergência médica</a>
          </div>
        </>
      )}
      {tool && <button className="btn ghost block" onClick={() => setTool(null)}>Outras opções</button>}
    </Sheet>
  )
}

function Feedback({ onClose }) {
  const toast = useToast()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/feedback', { method: 'POST', body: { message } })
      toast('Mensagem enviada. Obrigado por ajudar a melhorar o app.')
      onClose()
    } catch (err) {
      toast(err.message)
      setBusy(false)
    }
  }
  return (
    <Sheet title="Fale com a equipe" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">Sugestões, problemas ou o que você gostaria de ver no {APP_NAME}.</p>
        <textarea className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Escreva aqui" aria-label="Sua mensagem" maxLength={2000} />
        <button className="btn block" disabled={busy || !message.trim()}>Enviar mensagem</button>
      </form>
    </Sheet>
  )
}

export default function PatientApp() {
  const { user, setUser, refreshUser } = useApp()
  const toast = useToast()
  const [tab, setTab] = useState('focus')
  const tabRef = useRef(tab)
  tabRef.current = tab
  const [sheet, setSheet] = useState(null) // 'sos' | 'feedback' | 'checkin'
  const [unread, setUnread] = useState(0)
  const [due, setDue] = useState(null) // tarefa cujo horário chegou

  // ----- mascote -----
  const [mascot, setMascot] = useState({ mood: 'wave', text: `Oi, ${user.name.split(' ')[0]}! Que bom ver você.` })
  const moodTimer = useRef(null)
  const say = useCallback((text, mood = 'happy', ms = 4000) => {
    clearTimeout(moodTimer.current)
    setMascot({ text, mood })
    if (mood !== 'idle') moodTimer.current = setTimeout(() => setMascot((m) => ({ ...m, mood: timer.get().running ? 'focus' : 'idle' })), ms)
  }, [])
  useEffect(() => {
    moodTimer.current = setTimeout(() => setMascot((m) => ({ ...m, mood: 'idle' })), 3000)
    return () => clearTimeout(moodTimer.current)
  }, [])

  // ----- bambus -----
  const [bamboo, setBamboo] = useState(user.bamboo ?? 3)
  const bambooRef = useRef(bamboo)
  const changeBamboo = useCallback(
    (delta) => {
      const next = Math.max(0, bambooRef.current + delta)
      bambooRef.current = next
      setBamboo(next)
      setUser({ ...user, bamboo: next })
      api('/user/bamboo', { method: 'PATCH', body: { bamboo: next } }).catch(() => {})
    },
    [user, setUser],
  )
  const changeBambooRef = useRef(changeBamboo)
  changeBambooRef.current = changeBamboo

  // ----- preferências de som -----
  const [soundWithTimer, setSoundWithTimer] = usePref('soundWithTimer', false)
  const [lastSound, setLastSound] = usePref('lastSound', 'brown')
  const prefs = useMemo(() => ({ soundWithTimer, setSoundWithTimer, lastSound, setLastSound }), [soundWithTimer, setSoundWithTimer, lastSound, setLastSound])
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  // ----- pomodoro -----
  const startFocus = useCallback(
    (task) => {
      if (task !== undefined) timer.setMode('focus', task)
      timer.start()
      const p = prefsRef.current
      if (p.soundWithTimer && timer.get().mode === 'focus' && !sound.get().playing) {
        try {
          sound.play(p.lastSound)
        } catch {}
      }
      if (task !== undefined) {
        setTab('focus')
        setDue(null)
        window.scrollTo(0, 0)
      }
      say(task ? `Vamos lá: ${task}` : 'Foco ligado. Estou aqui do lado.', 'focus', 25 * 60_000)
    },
    [say],
  )
  const pauseFocus = useCallback(() => {
    timer.pause()
    if (prefsRef.current.soundWithTimer) sound.stop()
    say('Pausado. Volte quando quiser.', 'idle')
  }, [say])

  useEffect(
    () =>
      timer.onDone((mode) => {
        chime()
        if (prefsRef.current.soundWithTimer) sound.stop()
        if (mode === 'focus') {
          changeBambooRef.current(1)
          say('Ciclo concluído! Ganhei um bambu. Que tal uma pausa?', 'happy', 6000)
          toast('Ciclo de foco concluído. Mais um bambu!')
          timer.setMode('shortBreak')
        } else {
          say('Descansou? Quando quiser, a gente volta.', 'idle')
          timer.setMode('focus')
        }
      }),
    [say, toast],
  )

  // ----- tarefas -----
  const [taskList, setTaskList] = useState([])
  const [taskState, setTaskState] = useState({ loading: true, error: null })
  useEffect(() => {
    api('/reminders')
      .then((d) => {
        setTaskList(d.reminders)
        setTaskState({ loading: false, error: null })
        d.reminders.filter((t) => !t.done).forEach(scheduleTask)
      })
      .catch((e) => setTaskState({ loading: false, error: e.message }))
  }, [])
  const taskRef = useRef(taskList)
  taskRef.current = taskList

  const addTask = useCallback(
    async ({ text, category, time }) => {
      try {
        const d = await api('/reminders', { method: 'POST', body: { text, category, time: time || '--:--' } })
        setTaskList((l) => [d.reminder, ...l])
        scheduleTask(d.reminder)
        return true
      } catch (e) {
        toast(e.message)
        return false
      }
    },
    [toast],
  )
  const toggleTask = useCallback((id) => {
    const t = taskRef.current.find((x) => x.id === id)
    if (!t) return
    const done = t.done ? 0 : 1
    setTaskList((l) => l.map((x) => (x.id === id ? { ...x, done } : x)))
    if (done) {
      cancelTask(id)
      say('Mais uma feita! Um passo de cada vez.', 'happy')
    } else scheduleTask(t)
    api(`/reminders/${id}`, { method: 'PATCH', body: { done } }).catch(() => {})
  }, [say])
  const removeTask = useCallback((id) => {
    setTaskList((l) => l.filter((x) => x.id !== id))
    cancelTask(id)
    api(`/reminders/${id}`, { method: 'DELETE' }).catch(() => {})
  }, [])
  const tasks = useMemo(() => ({ list: taskList, ...taskState }), [taskList, taskState])

  // Lembrete dentro do app: um sino suave e a oferta de começar o Pomodoro.
  useEffect(() => {
    const alerted = new Set()
    const id = setInterval(() => {
      const now = hhmm()
      const t = taskRef.current.find((x) => !x.done && x.time === now && !alerted.has(`${x.id}-${now}`))
      if (!t) return
      alerted.add(`${t.id}-${now}`)
      chime()
      setDue(t)
    }, 15_000)
    let off = () => {}
    onTaskAction((extra) => startFocus(extra.text || 'Tarefa')).then((fn) => (off = fn))
    return () => {
      clearInterval(id)
      off()
    }
  }, [startFocus])

  // ----- pausa saudável a cada hora de uso -----
  useEffect(() => {
    const id = setInterval(() => setSheet((s) => s ?? 'checkin'), 60 * 60_000)
    return () => clearInterval(id)
  }, [])

  // ----- tempo real -----
  useEffect(() => {
    getSocket()
    const offs = [
      onSocket('live:message', (m) => {
        if (m.senderId === user.id || tabRef.current === 'care') return
        setUnread((n) => n + 1)
        toast('Nova mensagem na sua conversa de terapia.')
      }),
      onSocket('care:changed', () => refreshUser().catch(() => {})),
      onSocket('care:prescriptions', () => tabRef.current !== 'care' && toast('Você recebeu uma nova orientação.')),
    ]
    return () => offs.forEach((off) => off())
  }, [user.id, toast, refreshUser])

  const goto = useCallback((id) => {
    setTab(id)
    if (id === 'care') setUnread(0)
    window.scrollTo(0, 0)
  }, [])

  async function unlink(close) {
    try {
      const d = await api('/user/link', { method: 'DELETE' })
      setUser(d.user)
      toast('Vínculo encerrado.')
      close()
    } catch (e) {
      toast(e.message)
    }
  }

  const ctx = useMemo(
    () => ({ mascot, say, bamboo, changeBamboo, prefs, startFocus, pauseFocus, tasks, addTask, toggleTask, removeTask, goto }),
    [mascot, say, bamboo, changeBamboo, prefs, startFocus, pauseFocus, tasks, addTask, toggleTask, removeTask, goto],
  )

  return (
    <PatientCtx.Provider value={ctx}>
      <Shell
        tabs={TABS}
        tab={tab}
        onTab={goto}
        badges={{ care: unread }}
        actions={
          <button className="sos" onClick={() => setSheet('sos')}>
            <Icon name="life" size={18} /> <span className="sos-long">Preciso de calma</span><span className="sos-short">Calma</span>
          </button>
        }
        menuExtra={(close) => (
          <>
            <button className="btn soft block" onClick={() => { close(); setSheet('feedback') }}><Icon name="inbox" size={20} /> Fale com a equipe</button>
            {user.psychologist && (
              <button className="btn ghost block" onClick={() => unlink(close)}>Encerrar vínculo com {user.psychologist.name}</button>
            )}
          </>
        )}
      >
        {due && (
          <div style={{ padding: '0 1rem', maxWidth: 720, margin: '0 auto', width: '100%' }}>
            <div className="banner" role="alert">
              <Icon name="clock" />
              <div className="grow">
                <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{due.text}</strong>
                <span className="small muted">Chegou a hora que você marcou.</span>
              </div>
              <button className="btn sm" onClick={() => startFocus(due.text)}>Iniciar Pomodoro</button>
              <button className="icon-btn" onClick={() => setDue(null)} aria-label="Agora não"><Icon name="close" /></button>
            </div>
          </div>
        )}

        {tab === 'focus' && <Focus />}
        {tab === 'relief' && <Relief />}
        {tab === 'tasks' && <Tasks />}
        {tab === 'tutor' && <Tutor />}
        {tab === 'care' && <Care />}
      </Shell>

      {sheet === 'sos' && <Sos onClose={() => setSheet(null)} hasPsy={!!user.psychologist} onTalk={() => { setSheet(null); goto('care') }} />}
      {sheet === 'feedback' && <Feedback onClose={() => setSheet(null)} />}
      {sheet === 'checkin' && (
        <Sheet title="Uma hora por aqui. Como você está?" onClose={() => setSheet(null)}>
          <p className="muted">Beber água e esticar o corpo ajudam a manter o foco.</p>
          <button className="btn block" onClick={() => setSheet(null)}>Estou bem, vou continuar</button>
          <button className="btn soft block" onClick={() => { setSheet(null); goto('relief') }}>Quero uma pausa para respirar</button>
        </Sheet>
      )}
    </PatientCtx.Provider>
  )
}
