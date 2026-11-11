import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { useApp } from '../../App.jsx'
import Shell from '../../components/Shell.jsx'
import Icon from '../../components/Icon.jsx'
import { Sheet, Tabs, initials, useLoad, useToast } from '../../components/ui.jsx'

const TABS = [
  { id: 'overview', icon: 'chart', label: 'Visão geral' },
  { id: 'users', icon: 'users', label: 'Usuários' },
  { id: 'inbox', icon: 'inbox', label: 'Mensagens' },
]
const ROLE = { patient: 'Paciente', psychologist: 'Psicologia', admin: 'Admin' }

function Overview({ onPending }) {
  const { data, loading, error } = useLoad(() => api('/admin/stats'))
  if (loading) return <div className="page"><p className="empty">Carregando…</p></div>
  if (error) return <div className="page"><p className="error">{error}</p></div>
  const cards = [
    ['Pacientes', data.patients],
    ['Com acompanhamento', data.patientsLinked],
    ['Profissionais ativos', data.psychologists],
    ['Contas novas em 7 dias', data.newThisWeek],
    ['Contas bloqueadas', data.blocked],
    ['Mensagens recebidas', data.feedback],
  ]
  return (
    <div className="page">
      <div className="page-head">
        <h1>Visão geral</h1>
      </div>
      {data.pending > 0 && (
        <div className="banner">
          <Icon name="shield" />
          <span className="grow">
            <strong>{data.pending} {data.pending === 1 ? 'cadastro profissional aguarda' : 'cadastros profissionais aguardam'} conferência do CRP.</strong>
          </span>
          <button className="btn sm" onClick={onPending}>Conferir</button>
        </div>
      )}
      <div className="stat-grid">
        {cards.map(([label, n]) => (
          <div key={label} className="card stat">
            <b>{n}</b>
            <span className="muted small">{label}</span>
          </div>
        ))}
      </div>
      <p className="note">Por sigilo profissional, conversas, diários e receitas não aparecem na administração.</p>
    </div>
  )
}

const FILTERS = [
  { id: 'pending', label: 'Aguardando', query: 'status=pending' },
  { id: 'psychologist', label: 'Profissionais', query: 'role=psychologist' },
  { id: 'patient', label: 'Pacientes', query: 'role=patient' },
  { id: 'all', label: 'Todos', query: '' },
]

function Users({ initial }) {
  const toast = useToast()
  const [filter, setFilter] = useState(initial)
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [confirm, setConfirm] = useState(null)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 300)
    return () => clearTimeout(id)
  }, [term])
  const query = [FILTERS.find((f) => f.id === filter).query, debounced && `q=${encodeURIComponent(debounced)}`].filter(Boolean).join('&')
  const { data, loading, error, setData, reload } = useLoad(() => api(`/admin/users?${query}`).then((d) => d.users), [query])

  async function setStatus(u, status) {
    try {
      const d = await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status } })
      setData((l) => l.map((x) => (x.id === u.id ? { ...x, ...d.user } : x)))
      toast(status === 'active' ? `${u.name} liberado.` : `${u.name} bloqueado.`)
    } catch (e) {
      toast(e.message)
    }
  }
  async function remove(u) {
    setConfirm(null)
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' })
      toast('Conta excluída.')
      reload()
    } catch (e) {
      toast(e.message)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Usuários</h1>
      </div>
      <Tabs value={filter} onChange={setFilter} options={FILTERS} />
      <input className="input" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuário" />
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="empty">{filter === 'pending' ? 'Nenhum cadastro aguardando conferência.' : 'Ninguém encontrado.'}</p>}
      {data && data.length > 0 && (
        <div className="card list" style={{ paddingBlock: '0.25rem' }}>
          {data.map((u) => (
            <div key={u.id} className="item" style={{ flexWrap: 'wrap' }}>
              <span className="avatar">{initials(u.name)}</span>
              <div className="grow" style={{ minWidth: 150 }}>
                <strong className="ellipsis" style={{ display: 'block' }}>{u.name}</strong>
                <span className="muted small ellipsis" style={{ display: 'block' }}>{u.email}</span>
                <span className="row wrap" style={{ gap: '0.375rem', marginTop: 4 }}>
                  <span className="tag">{ROLE[u.role]}</span>
                  {u.crp && <span className="tag">CRP {u.crp}</span>}
                  {u.role === 'psychologist' && u.status === 'active' && <span className="tag">{u.patientCount} {u.patientCount === 1 ? 'paciente' : 'pacientes'}</span>}
                  {u.status === 'pending' && <span className="tag warn">Aguardando</span>}
                  {u.status === 'blocked' && <span className="tag off">Bloqueada</span>}
                </span>
              </div>
              {u.role !== 'admin' && (
                <span className="row" style={{ gap: '0.25rem' }}>
                  {u.status === 'pending' && <button className="btn sm" onClick={() => setStatus(u, 'active')}>Aprovar</button>}
                  {u.status === 'active' && <button className="btn ghost sm" onClick={() => setStatus(u, 'blocked')}>Bloquear</button>}
                  {u.status === 'blocked' && <button className="btn soft sm" onClick={() => setStatus(u, 'active')}>Desbloquear</button>}
                  <button className="icon-btn" onClick={() => setConfirm(u)} aria-label={`Excluir a conta de ${u.name}`}><Icon name="trash" size={20} /></button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {confirm && (
        <Sheet title="Excluir esta conta?" onClose={() => setConfirm(null)}>
          <p>A conta de <strong>{confirm.name}</strong> e todos os dados dela (tarefas, diário, conversas) serão apagados. Não dá para desfazer.</p>
          <button className="btn danger block" onClick={() => remove(confirm)}>Excluir conta</button>
          <button className="btn soft block" onClick={() => setConfirm(null)}>Cancelar</button>
        </Sheet>
      )}
    </div>
  )
}

function Inbox() {
  const toast = useToast()
  const { data, loading, error, setData } = useLoad(() => api('/admin/feedback').then((d) => d.feedback))
  function remove(id) {
    setData((l) => l.filter((f) => f.id !== id))
    api(`/admin/feedback/${id}`, { method: 'DELETE' }).catch((e) => toast(e.message))
  }
  return (
    <div className="page">
      <div className="page-head">
        <h1>Mensagens</h1>
        <p className="muted">O que as pessoas enviaram pelo “Fale com a equipe”.</p>
      </div>
      {loading && <p className="empty">Carregando…</p>}
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="empty">Nenhuma mensagem por enquanto.</p>}
      {data?.map((f) => (
        <article key={f.id} className="card stack" style={{ gap: '0.375rem' }}>
          <div className="row between">
            <span className="small muted ellipsis">{f.userName || 'Conta removida'}{f.userEmail ? `, ${f.userEmail}` : ''}</span>
            <button className="icon-btn" onClick={() => remove(f.id)} aria-label="Apagar mensagem"><Icon name="trash" size={20} /></button>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.message}</p>
          <time className="small muted">{new Date(f.createdAt.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</time>
        </article>
      ))}
    </div>
  )
}

export default function AdminApp() {
  useApp()
  const [tab, setTab] = useState('overview')
  const [userFilter, setUserFilter] = useState('all')
  return (
    <Shell tabs={TABS} tab={tab} onTab={(t) => { setUserFilter('all'); setTab(t) }}>
      {tab === 'overview' && <Overview onPending={() => { setUserFilter('pending'); setTab('users') }} />}
      {tab === 'users' && <Users key={userFilter} initial={userFilter} />}
      {tab === 'inbox' && <Inbox />}
    </Shell>
  )
}
