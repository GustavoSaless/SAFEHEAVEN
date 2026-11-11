import { memo, useEffect, useRef, useState } from 'react'
import { MODES, fmt, timer, useTimer } from '../../lib/timer.js'
import { SOUNDS, sound, useSound } from '../../lib/audio.js'
import { MASCOT_NAME } from '../../config.js'
import Icon from '../../components/Icon.jsx'
import Mascot from '../../components/Mascot.jsx'
import { Switch } from '../../components/ui.jsx'
import { usePatient } from './ctx.js'

const CHEW_MS = 4000 // pausa guiada entre um bambu e outro (pedido do parecer clínico)

const MascotCard = memo(function MascotCard() {
  const { mascot, say, bamboo, changeBamboo } = usePatient()
  const [chewing, setChewing] = useState(false)
  const [phase, setPhase] = useState('in')
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  function feed() {
    if (chewing) return
    if (bamboo <= 0) return say('Meus bambus acabaram. Cada ciclo de foco rende mais um.', 'idle')
    changeBamboo(-1)
    setChewing(true)
    setPhase('in')
    say('Nham… mastigando devagar.', 'eating', CHEW_MS)
    timers.current = [
      setTimeout(() => setPhase('out'), CHEW_MS / 2),
      setTimeout(() => {
        setChewing(false)
        say('Obrigado! Comer com calma é mais gostoso.', 'happy')
      }, CHEW_MS),
    ]
  }

  return (
    <section className="card tinted stack">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Mascot size={104} mood={mascot.mood} />
        <div className="grow stack" style={{ gap: '0.5rem' }}>
          <p className="speech" aria-live="polite">{mascot.text}</p>
          <span className="bamboo-count">
            <Icon name="leaf" size={18} /> {bamboo} {bamboo === 1 ? 'bambu' : 'bambus'}
          </span>
        </div>
      </div>
      {chewing ? (
        <div className="stack" style={{ gap: '0.375rem' }} role="status">
          <span className="small" style={{ fontWeight: 700 }}>
            {phase === 'in' ? 'Enquanto ele mastiga, puxe o ar devagar…' : '…e solte o ar sem pressa.'}
          </span>
          <div className="pace" style={{ '--pace': `${CHEW_MS}ms` }}><i /></div>
        </div>
      ) : (
        <button className="btn soft" onClick={feed}>
          Dar um bambu para {MASCOT_NAME}
        </button>
      )}
    </section>
  )
})

const R = 54
const C = 2 * Math.PI * R

function TimerCard() {
  const t = useTimer()
  const { startFocus, pauseFocus } = usePatient()
  const progress = t.total ? 1 - t.remaining / t.total : 0
  return (
    <section className="card stack">
      <div className="chips">
        {Object.entries(MODES).map(([id, m]) => (
          <button key={id} className="chip" aria-pressed={t.mode === id} onClick={() => timer.setMode(id)}>
            {m.label} {m.minutes} min
          </button>
        ))}
      </div>
      <div className="dial" role="timer" aria-label={`${MODES[t.mode].label}: ${fmt(t.remaining)} restantes`}>
        <svg viewBox="0 0 120 120">
          <circle className="track" cx="60" cy="60" r={R} />
          <circle className="bar" cx="60" cy="60" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        </svg>
        <div className="dial-face">
          <span className="dial-time">{fmt(t.remaining)}</span>
          <span className="muted small">{MODES[t.mode].label}</span>
        </div>
      </div>
      {t.task && <p className="center small"><span className="muted">Tarefa:</span> <strong>{t.task}</strong></p>}
      <div className="row">
        {t.running ? (
          <button className="btn soft grow" onClick={pauseFocus}><Icon name="pause" size={20} /> Pausar</button>
        ) : (
          <button className="btn grow" onClick={() => startFocus()}><Icon name="play" size={20} /> {t.remaining < t.total ? 'Continuar' : 'Iniciar'}</button>
        )}
        <button className="icon-btn" onClick={() => timer.reset()} aria-label="Reiniciar o cronômetro"><Icon name="reset" /></button>
      </div>
    </section>
  )
}

const SoundCard = memo(function SoundCard() {
  const s = useSound()
  const { prefs, say } = usePatient()
  const toggle = (id) => {
    try {
      if (s.playing === id) return sound.stop()
      sound.play(id)
      prefs.setLastSound(id)
    } catch {
      say('Não consegui tocar o som neste aparelho.', 'care')
    }
  }
  return (
    <section className="card stack">
      <div>
        <h2>Máscara sonora</h2>
        <p className="muted small">Cobre o barulho do ambiente para você se concentrar.</p>
      </div>
      <div className="stack" style={{ gap: '0.5rem' }}>
        {SOUNDS.map((o) => (
          <button key={o.id} className="choice" aria-pressed={s.playing === o.id} aria-checked={s.playing === o.id} onClick={() => toggle(o.id)}>
            <span className="avatar" style={{ width: 36, height: 36 }}><Icon name={s.playing === o.id ? 'pause' : 'play'} size={18} /></span>
            <span>
              <strong>{o.name}</strong>
              <small>{o.hint}</small>
            </span>
          </button>
        ))}
      </div>
      <label className="row">
        <Icon name="sound" />
        <span className="sr-only">Volume</span>
        <input type="range" min="0.05" max="1" step="0.05" value={s.volume} onChange={(e) => sound.setVolume(Number(e.target.value))} />
      </label>
      <Switch label="Tocar junto com o Pomodoro" checked={prefs.soundWithTimer} onChange={prefs.setSoundWithTimer} />
    </section>
  )
})

export default function Focus() {
  return (
    <div className="page">
      <MascotCard />
      <div className="two-col">
        <TimerCard />
        <SoundCard />
      </div>
    </div>
  )
}
