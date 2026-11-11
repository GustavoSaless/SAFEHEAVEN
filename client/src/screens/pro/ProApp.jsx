import { useCallback, useEffect, useState } from 'react'
import { api, today } from '../../lib/api.js'
import { getSocket, onSocket } from '../../lib/socket.js'
import { useApp } from '../../App.jsx'
import Shell from '../../components/Shell.jsx'
import Icon from '../../components/Icon.jsx'
import Mascot from '../../components/Mascot.jsx'
import LiveChat from '../../components/LiveChat.jsx'
import { Field, Sheet, Tabs, initials, useLoad, useToast } from '../../components/ui.jsx'

const TABS = [
  { id: 'patients', icon: 'users', label: 'Pacientes' },
  { id: 'keys', icon: 'key', label: 'Chaves' },
]

function Pending() {
  const { refreshUser, logout } = useApp()
  const toast = useToast()
  const check = () => refreshUser().then((u) => u.status !== 'active' && toast('Ainda em análise.')).catch((e) => toast(e.message))
  return (
    <main className="auth">
      <div className="auth-box center" style={{ alignItems: 'center' }}>
        <Mascot size={140} mood="calm" />
        <h1>Cadastro em análise</h1>
        <p className="muted">A administração confere o CRP antes de liberar o atendimento. Você pode fechar o app; quando voltar, é só entrar de novo.</p>
        <button className="btn block" onClick={check}>Verificar agora</button>
        <button className="btn ghost block" onClick={logout}>Sair</button>
      </div>
    </main>
  )
}

// ---------- chaves de acesso ----------
const KEY_STATUS = {
  available: { label: 'Disponível', cls: '' },
  used: { label: 'Usada', cls: 'warn' },
  expired: { label: 'Expirada', cls: 'off' },
  revoked: { label: 'Revogada', cls: 'off' },
}

function Keys() {
  const toast = useToast()
  const { data, loading, error, setData } = useLoad(() => api('/pro/keys').then((d) => d.keys))
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const d = await api('/pro/keys', { method: 'POST', body: { label } })
      setData((l) => [d.key, ...(l || [])])
      setLabel('')
      copy(d.key.code)
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function copy(code) {
    try {
      await navigator.clipboard.writeText(code)
      toast(`Chave ${code} copiada.`)
    } catch {
      toast(`Chave gerada: ${code}`)
    }
  }
  function revoke(k) {
    setData((l) => l.map((x) => (x.id === k.id ? { ...x, status: 'revoked' } : x)))
    api(`/pro/keys/${k.id}`, { method: 'DELETE' }).catch((e) => toast(e.message))
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Chaves de acesso</h1>
        <p className="muted">Cada chave libera o chat ao vivo e as receitas para um paciente. Vale por 7 dias e só pode ser usada uma vez.</p>
      </div>
      <form className="card stack" onSubmit={create}>
        <Field label="Para quem é (opcional, só você vê)">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Marina, terças às 15h" maxLength={60} />
        </Field>
        <button className="btn block" disabled={busy}><Icon name="key" size={20} /> Gerar chave</button>
      </form>

      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="empty">Nenhuma chave gerada ainda.</p>}
      {data && data.length > 0 && (
        <div className="card list" style={{ paddingBlock: '0.25rem' }}>
          {data.map((k) => {
            const st = KEY_STATUS[k.status]
            return (
              <div key={k.id} className="item">
                <div className="grow">
                  <span className="code" style={k.status === 'available' ? undefined : { opacity: 0.55 }}>{k.code}</span>
                  <span className="muted small ellipsis" style={{ display: 'block' }}>
                    {k.status === 'used' ? `Usada por ${k.usedBy || 'paciente removido'}` : k.label || 'Sem anotação'}
                    {k.status === 'available' && `, vale até ${new Date(k.expiresAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`}
                  </span>
                </div>
                <span className={`tag ${st.cls}`}>{st.label}</span>
                {k.status === 'available' && (
                  <>
                    <button className="icon-btn" onClick={() => copy(k.code)} aria-label={`Copiar a chave ${k.code}`}><Icon name="copy" size={20} /></button>
                    <button className="icon-btn" onClick={() => revoke(k)} aria-label={`Revogar a chave ${k.code}`}><Icon name="trash" size={20} /></button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------- receitas e orientações de um paciente ----------
function PatientPrescriptions({ patient }) {
  const toast = useToast()
  const { data, loading, error, setData } = useLoad(() => api(`/pro/patients/${patient.id}/prescriptions?day=${today()}`).then((d) => d.prescriptions), [patient.id])
  const [form, setForm] = useState({ title: '', frequency: '', body: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function create(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const d = await api(`/pro/patients/${patient.id}/prescriptions`, { method: 'POST', body: form })
      setData((l) => [d.prescription, ...(l || [])])
      setForm({ title: '', frequency: '', body: '' })
      toast('Orientação enviada ao paciente.')
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  function archive(p) {
    setData((l) => l.map((x) => (x.id === p.id ? { ...x, active: !p.active } : x)))
    api(`/pro/prescriptions/${p.id}`, { method: 'PATCH', body: { active: !p.active } }).catch((e) => toast(e.message))
  }
  function remove(p) {
    setData((l) => l.filter((x) => x.id !== p.id))
    api(`/pro/prescriptions/${p.id}`, { method: 'DELETE' }).catch((e) => toast(e.message))
  }

  return (
    <div className="two-col">
      <form className="card stack" onSubmit={create}>
        <h2>Nova orientação</h2>
        <Field label="Título">
          <input value={form.title} onChange={set('title')} placeholder="Ex.: Respiração quadrada" maxLength={120} />
        </Field>
        <Field label="Frequência (opcional)">
          <input value={form.frequency} onChange={set('frequency')} placeholder="Ex.: 2 vezes ao dia" maxLength={60} />
        </Field>
        <Field label="Como fazer">
          <textarea value={form.body} onChange={set('body')} placeholder="Descreva o exercício, a tarefa ou a recomendação." maxLength={3000} />
        </Field>
        <button className="btn block" disabled={busy || !form.title.trim()}>Enviar para {patient.name.split(' ')[0]}</button>
      </form>
      <div className="stack">
        {loading && <p className="empty">Carregando…</p>}
        {error && <p className="error">{error}</p>}
        {data && data.length === 0 && <p className="empty">Nenhuma orientação enviada a este paciente.</p>}
        {data?.map((p) => (
          <article key={p.id} className="card stack" style={{ gap: '0.5rem', opacity: p.active ? 1 : 0.6 }}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <h3 style={{ overflowWrap: 'anywhere' }}>{p.title}</h3>
              {p.active ? p.frequency && <span className="tag" style={{ flex: 'none' }}>{p.frequency}</span> : <span className="tag off" style={{ flex: 'none' }}>Arquivada</span>}
            </div>
            {p.body && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.body}</p>}
            <div className="row between wrap">
              <span className="small muted">Feita em {p.doneLast7} dos últimos 7 dias{p.doneToday ? ', inclusive hoje' : ''}</span>
              <span className="row" style={{ gap: 0 }}>
                <button className="btn ghost sm" onClick={() => archive(p)}>{p.active ? 'Arquivar' : 'Reativar'}</button>
                <button className="icon-btn" onClick={() => remove(p)} aria-label={`Apagar: ${p.title}`}><Icon name="trash" size={20} /></button>
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function PatientView({ patient, onBack, onChanged }) {
  const { user } = useApp()
  const toast = useToast()
  const [tab, setTab] = useState('chat')
  const [confirm, setConfirm] = useState(false)
  async function unlink() {
    try {
      await api(`/pro/patients/${patient.id}`, { method: 'DELETE' })
      toast('Vínculo encerrado.')
      onChanged()
      onBack()
    } catch (e) {
      toast(e.message)
    }
  }
  return (
    <div className="page">
      <div className="row">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar para a lista"><Icon name="back" /></button>
        <span className="avatar">{initials(patient.name)}</span>
        <div className="grow">
          <h1 className="ellipsis" style={{ fontSize: '1.25rem' }}>{patient.name}</h1>
          <p className="muted small ellipsis">{patient.email}</p>
        </div>
      </div>
      <div className="row between wrap">
        <Tabs value={tab} onChange={setTab} options={[{ id: 'chat', label: 'Conversa' }, { id: 'rx', label: 'Receitas e orientações' }]} />
        <button className="btn ghost sm" onClick={() => setConfirm(true)}>Encerrar vínculo</button>
      </div>
      {tab === 'chat' ? (
        <div className="chat-wrap">
          <LiveChat patientId={patient.id} meId={user.id} peerId={patient.id} peerName={patient.name.split(' ')[0]} />
        </div>
      ) : (
        <PatientPrescriptions patient={patient} />
      )}
      {confirm && (
        <Sheet title="Encerrar o vínculo?" onClose={() => setConfirm(false)}>
          <p>{patient.name} perde o acesso ao chat ao vivo e às receitas. Para voltar, será preciso gerar uma nova chave.</p>
          <button className="btn danger block" onClick={unlink}>Encerrar vínculo</button>
          <button className="btn soft block" onClick={() => setConfirm(false)}>Manter</button>
        </Sheet>
      )}
    </div>
  )
}

function Patients({ list, onOpen, onKeys }) {
  const { data, loading, error } = list
  return (
    <div className="page">
      <div className="page-head">
        <h1>Pacientes</h1>
        <p className="muted">Quem usou uma chave sua aparece aqui.</p>
      </div>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && (
        <div className="card empty">
          <Mascot size={96} mood="idle" />
          <p>Nenhum paciente vinculado ainda. Gere uma chave e passe para o paciente na sessão.</p>
          <button className="btn" onClick={onKeys}><Icon name="key" size={20} /> Gerar chave</button>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="card list" style={{ paddingBlock: '0.25rem' }}>
          {data.map((p) => (
            <button key={p.id} className="item" onClick={() => onOpen(p.id)}>
              <span className="avatar">{initials(p.name)}{p.online && <i className="on" title="Online" />}</span>
              <span className="grow">
                <strong className="ellipsis" style={{ display: 'block' }}>{p.name}</strong>
                <span className="muted small ellipsis" style={{ display: 'block' }}>
                  {p.lastMessage ? `${p.lastMessage.mine ? 'Você: ' : ''}${p.lastMessage.body}` : 'Sem mensagens ainda'}
                </span>
              </span>
              {p.unread > 0 && <span className="badge" style={{ position: 'static' }}>{p.unread}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ProApp() {
  const { user } = useApp()
  const toast = useToast()
  const active = user.status === 'active'
  const [tab, setTab] = useState('patients')
  const [openId, setOpenId] = useState(null)
  const fetchPatients = useCallback(() => (active ? api('/pro/patients').then((d) => d.patients) : Promise.resolve([])), [active])
  const list = useLoad(fetchPatients, [fetchPatients])
  const { reload, setData } = list

  useEffect(() => {
    if (!active) return
    getSocket()
    const offs = [
      onSocket('patients:changed', reload),
      onSocket('connect', reload),
      onSocket('presence', (p) => setData((l) => l?.map((x) => (x.id === p.userId ? { ...x, online: p.online } : x)))),
      onSocket('live:message', (m) => {
        reload()
        if (m.senderId !== user.id && openId !== m.patientId) toast('Nova mensagem de paciente.')
      }),
      onSocket('live:read', reload),
    ]
    return () => offs.forEach((off) => off())
  }, [active, reload, setData, user.id, openId, toast])

  if (!active) return <Pending />

  const open = list.data?.find((p) => p.id === openId)
  const unread = (list.data || []).reduce((n, p) => n + p.unread, 0)

  return (
    <Shell tabs={TABS} tab={tab} onTab={(t) => { setTab(t); setOpenId(null) }} badges={{ patients: unread }}>
      {tab === 'keys' && <Keys />}
      {tab === 'patients' && (open ? <PatientView patient={open} onBack={() => setOpenId(null)} onChanged={reload} /> : <Patients list={list} onOpen={setOpenId} onKeys={() => setTab('keys')} />)}
    </Shell>
  )
}
