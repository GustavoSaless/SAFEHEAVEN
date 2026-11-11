import { useEffect, useState } from 'react'
import { api, today } from '../../lib/api.js'
import { onSocket } from '../../lib/socket.js'
import { useApp } from '../../App.jsx'
import Icon from '../../components/Icon.jsx'
import Mascot from '../../components/Mascot.jsx'
import LiveChat from '../../components/LiveChat.jsx'
import { Field, Tabs, initials, useLoad, useToast } from '../../components/ui.jsx'

function LinkWithKey() {
  const { setUser } = useApp()
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const d = await api('/user/link', { method: 'POST', body: { accessKey: key } })
      setUser(d.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <h1>Terapia</h1>
        <p className="muted">Converse ao vivo com quem acompanha você e veja as orientações que recebeu.</p>
      </div>
      <form className="card stack" onSubmit={submit}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Mascot size={72} mood="care" />
          <p className="grow">
            Sua psicóloga ou psicólogo gera uma <strong>chave de acesso</strong> no app e passa para você. Ela vale para uma pessoa só.
          </p>
        </div>
        <Field label="Chave de acesso">
          <input className="code" value={key} onChange={(e) => setKey(e.target.value)} placeholder="SH-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </Field>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn block" disabled={busy || !key.trim()}>{busy ? 'Conferindo…' : 'Liberar chat e receitas'}</button>
      </form>
      <p className="note">
        Não faz terapia? Tudo bem. O restante do app funciona igual, e você pode vincular uma chave quando quiser.
      </p>
    </div>
  )
}

function Prescriptions() {
  const toast = useToast()
  const { data, loading, error, reload, setData } = useLoad(() => api(`/care/prescriptions?day=${today()}`).then((d) => d.prescriptions))
  useEffect(() => onSocket('care:prescriptions', reload), [reload])

  async function check(p) {
    const done = !p.doneToday
    setData((list) => list.map((x) => (x.id === p.id ? { ...x, doneToday: done, doneLast7: x.doneLast7 + (done ? 1 : -1) } : x)))
    try {
      await api(`/care/prescriptions/${p.id}/check`, { method: 'POST', body: { day: today(), done } })
    } catch (e) {
      toast(e.message)
      reload()
    }
  }

  if (loading) return <p className="empty">Carregando…</p>
  if (error) return <p className="error">{error}</p>
  if (data.length === 0) return <p className="empty"><Icon name="note" size={28} />Nenhuma orientação por enquanto. Quando houver, ela aparece aqui.</p>
  return (
    <div className="stack">
      {data.map((p) => (
        <article key={p.id} className="card stack" style={{ gap: '0.5rem' }}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <h3 style={{ overflowWrap: 'anywhere' }}>{p.title}</h3>
            {p.frequency && <span className="tag" style={{ flex: 'none' }}>{p.frequency}</span>}
          </div>
          {p.body && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.body}</p>}
          <div className="row between">
            <span className="small muted">Feita em {p.doneLast7} dos últimos 7 dias</span>
            <button className={`btn sm ${p.doneToday ? '' : 'soft'}`} aria-pressed={p.doneToday} onClick={() => check(p)}>
              <Icon name="check" size={16} /> {p.doneToday ? 'Feita hoje' : 'Marcar como feita hoje'}
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

export default function Care() {
  const { user } = useApp()
  const [tab, setTab] = useState('chat')
  if (!user.psychologist) return <LinkWithKey />
  const psy = user.psychologist
  return (
    <div className="page">
      <div className="row">
        <span className="avatar">{initials(psy.name)}</span>
        <div className="grow">
          <h1 className="ellipsis" style={{ fontSize: '1.25rem' }}>{psy.name}</h1>
          <p className="muted small">CRP {psy.crp}</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} options={[{ id: 'chat', label: 'Conversa' }, { id: 'rx', label: 'Receitas e orientações' }]} />
      {tab === 'chat' ? (
        <div className="chat-wrap">
          <LiveChat patientId={user.id} meId={user.id} peerId={psy.id} peerName={psy.name} showCrisisNote />
        </div>
      ) : (
        <Prescriptions />
      )}
    </div>
  )
}
