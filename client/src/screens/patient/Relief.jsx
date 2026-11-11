import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import Icon from '../../components/Icon.jsx'
import Mascot from '../../components/Mascot.jsx'
import { Sheet, useLoad, useToast } from '../../components/ui.jsx'

// ---------- respiração quadrada ----------
const PHASES = [
  { name: 'Puxe o ar', big: true },
  { name: 'Segure', big: true },
  { name: 'Solte o ar', big: false },
  { name: 'Segure vazio', big: false },
]

export function Breathing({ autoStart = false }) {
  const [on, setOn] = useState(autoStart)
  const [step, setStep] = useState(0) // segundos desde o início
  useEffect(() => {
    if (!on) return
    setStep(0)
    const id = setInterval(() => setStep((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [on])
  const phase = PHASES[Math.floor(step / 4) % 4]
  const count = 4 - (step % 4)
  const cycles = Math.floor(step / 16)
  return (
    <div className="stack">
      <p className="muted">Quatro tempos de 4 segundos. Acompanhe o círculo: ele cresce quando você puxa o ar.</p>
      <div className="breath">
        <div className={`breath-orb ${on && phase.big ? 'big' : ''}`} aria-live="polite">
          {on ? (
            <div>
              <span>{count}</span>
              {phase.name}
            </div>
          ) : (
            'Pronto?'
          )}
        </div>
      </div>
      {on && <p className="center muted small">{cycles === 0 ? 'Primeiro ciclo' : `${cycles} ${cycles === 1 ? 'ciclo completo' : 'ciclos completos'}`}</p>}
      <button className={`btn block ${on ? 'soft' : ''}`} onClick={() => setOn(!on)}>
        {on ? 'Parar' : 'Começar a respirar'}
      </button>
    </div>
  )
}

// ---------- aterramento 5-4-3-2-1 ----------
const SENSES = [
  { n: 5, verb: 'vê', tip: 'Olhe em volta. Pode ser a cor da parede, um objeto, a luz.' },
  { n: 4, verb: 'pode tocar', tip: 'A roupa na pele, a cadeira, o chão sob os pés.' },
  { n: 3, verb: 'ouve', tip: 'Sons de perto e de longe. O silêncio também conta.' },
  { n: 2, verb: 'cheira', tip: 'Se não sentir nada, lembre de dois cheiros de que gosta.' },
  { n: 1, verb: 'saboreia', tip: 'O gosto na boca agora, ou um gole de água.' },
]

export function Grounding() {
  const [i, setI] = useState(0)
  const [found, setFound] = useState(0)
  if (i >= SENSES.length) {
    return (
      <div className="stack center" style={{ alignItems: 'center' }}>
        <Mascot size={120} mood="happy" />
        <h3>Você voltou para o agora.</h3>
        <p className="muted">Sentir o mundo físico ajuda o corpo a entender que está em segurança.</p>
        <button className="btn soft" onClick={() => { setI(0); setFound(0) }}>Fazer de novo</button>
      </div>
    )
  }
  const s = SENSES[i]
  const next = () => { setI(i + 1); setFound(0) }
  return (
    <div className="stack">
      <div className="steps" aria-hidden="true">{SENSES.map((_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}</div>
      <div>
        <h3 style={{ fontSize: '1.25rem' }}>{s.n} {s.n === 1 ? 'coisa' : 'coisas'} que você {s.verb}</h3>
        <p className="muted">{s.tip}</p>
      </div>
      <p className="small">Toque num círculo a cada coisa que notar. Não precisa escrever.</p>
      <div className="row wrap" style={{ justifyContent: 'center', gap: '0.625rem' }}>
        {Array.from({ length: s.n }, (_, k) => (
          <button key={k} className="check" style={{ width: 48, height: 48, borderRadius: '50%' }} role="checkbox" aria-checked={k < found} aria-label={`Coisa ${k + 1}`} onClick={() => setFound(k < found ? k : k + 1)}>
            <Icon name="check" />
          </button>
        ))}
      </div>
      <button className="btn block" onClick={next}>{i === SENSES.length - 1 ? 'Concluir' : 'Próximo sentido'}</button>
    </div>
  )
}

// ---------- descarrego mental: queimar ou guardar ----------
export function Release({ onSaved }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [burning, setBurning] = useState(false)
  const [saving, setSaving] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const empty = !text.trim()

  function burn() {
    setBurning(true)
    timer.current = setTimeout(() => {
      setText('')
      setBurning(false)
      toast('Soltou. Esse texto não ficou guardado em lugar nenhum.')
    }, 1600)
  }
  async function save() {
    setSaving(true)
    try {
      await api('/journal', { method: 'POST', body: { text } })
      setText('')
      toast('Salvo no seu diário.')
      onSaved?.()
    } catch (e) {
      toast(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      <p className="muted">Escreva sem filtro. Depois você escolhe o que fazer com o texto.</p>
      <textarea className={`input ${burning ? 'burning' : ''}`} style={{ minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="O que está pesando agora?" aria-label="Seu texto" disabled={burning} />
      <div className="two-col" style={{ gap: '0.75rem' }}>
        <div className="stack" style={{ gap: '0.375rem' }}>
          <button className="btn block" onClick={burn} disabled={empty || burning || saving}><Icon name="flame" size={20} /> Queimar e soltar</button>
          <p className="small muted">Apaga na hora. Bom para pensamentos que ficam dando voltas.</p>
        </div>
        <div className="stack" style={{ gap: '0.375rem' }}>
          <button className="btn soft block" onClick={save} disabled={empty || burning || saving}><Icon name="book" size={20} /> Salvar no diário</button>
          <p className="small muted">Guarda para reler depois e acompanhar como você tem estado.</p>
        </div>
      </div>
    </div>
  )
}

// ---------- diário ----------
export function Journal() {
  const toast = useToast()
  const { data, loading, error, setData } = useLoad(() => api('/journal').then((d) => d.entries))
  async function remove(id) {
    setData((list) => list.filter((e) => e.id !== id))
    api(`/journal/${id}`, { method: 'DELETE' }).catch((e) => toast(e.message))
  }
  if (loading) return <p className="empty">Abrindo o diário…</p>
  if (error) return <p className="error">{error}</p>
  return (
    <div className="stack">
      <p className="note">Só você lê o diário. Sua psicóloga ou psicólogo não tem acesso a ele.</p>
      {data.length === 0 && <p className="empty">Nada por aqui ainda. Use o descarrego mental e escolha “Salvar no diário”.</p>}
      {data.map((e) => (
        <article key={e.id} className="card stack" style={{ gap: '0.375rem' }}>
          <div className="row between">
            <time className="small muted">{new Date(e.createdAt).toLocaleString('pt-BR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</time>
            <button className="icon-btn" onClick={() => remove(e.id)} aria-label="Apagar esta anotação"><Icon name="trash" size={20} /></button>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.text}</p>
        </article>
      ))}
    </div>
  )
}

const TOOLS = [
  { id: 'breath', icon: 'wind', title: 'Respiração quadrada', hint: 'Acalma o corpo em cerca de um minuto.', view: () => <Breathing /> },
  { id: 'ground', icon: 'eye', title: 'Aterramento 5-4-3-2-1', hint: 'Traz a atenção de volta para o presente.', view: () => <Grounding /> },
  { id: 'release', icon: 'flame', title: 'Descarrego mental', hint: 'Tire da cabeça: queime o texto ou guarde no diário.', view: () => <Release /> },
  { id: 'journal', icon: 'book', title: 'Meu diário', hint: 'O que você escolheu guardar.', view: () => <Journal /> },
]

export default function Relief() {
  const [open, setOpen] = useState(null)
  const tool = TOOLS.find((t) => t.id === open)
  return (
    <div className="page">
      <div className="page-head">
        <h1>Alívio</h1>
        <p className="muted">Ferramentas curtas para quando a ansiedade apertar.</p>
      </div>
      <div className="card list" style={{ paddingBlock: '0.25rem' }}>
        {TOOLS.map((t) => (
          <button key={t.id} className="item" onClick={() => setOpen(t.id)}>
            <span className="avatar"><Icon name={t.icon} size={20} /></span>
            <span className="grow">
              <strong style={{ display: 'block' }}>{t.title}</strong>
              <span className="muted small">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {tool && <Sheet title={tool.title} onClose={() => setOpen(null)}>{tool.view()}</Sheet>}
    </div>
  )
}
