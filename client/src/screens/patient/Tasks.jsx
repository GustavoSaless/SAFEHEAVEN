import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { usePatient } from './ctx.js'

const CATEGORIES = ['Estudos', 'Casa', 'Saúde', 'Pessoal']

export default function Tasks() {
  const { tasks, addTask, toggleTask, removeTask, startFocus } = usePatient()
  const [text, setText] = useState('')
  const [category, setCategory] = useState('Estudos')
  const [time, setTime] = useState('')

  async function submit(e) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    const at = time
    // Limpa na hora para a pessoa já digitar a próxima; devolve o texto se der erro.
    setText('')
    setTime('')
    const ok = await addTask({ text: value, category, time: at })
    if (!ok) {
      setText((cur) => cur || value)
      setTime((cur) => cur || at)
    }
  }

  const pending = tasks.list.filter((t) => !t.done)
  const done = tasks.list.filter((t) => t.done)

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tarefas</h1>
        <p className="muted">Uma de cada vez. Na hora marcada, o app oferece começar um Pomodoro.</p>
      </div>

      <form className="card stack" onSubmit={submit}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="O que você precisa fazer?" aria-label="Nova tarefa" maxLength={200} />
        <div className="row wrap">
          <select className="input grow" style={{ minWidth: 120 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="input" style={{ width: 'auto', flex: '1 0 110px' }} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Horário do lembrete (opcional)" />
          <button className="btn" disabled={!text.trim()}><Icon name="plus" size={20} /> Adicionar</button>
        </div>
      </form>

      {tasks.loading && <p className="empty">Carregando suas tarefas…</p>}
      {tasks.error && <p className="error">{tasks.error}</p>}
      {!tasks.loading && tasks.list.length === 0 && <p className="empty">Nenhuma tarefa ainda. Comece pela menor que você tiver.</p>}

      {pending.length > 0 && (
        <div className="card list" style={{ paddingBlock: '0.25rem' }}>
          {pending.map((t) => (
            <div key={t.id} className="item" style={{ flexWrap: 'wrap' }}>
              <button className="check" role="checkbox" aria-checked="false" aria-label={`Concluir: ${t.text}`} onClick={() => toggleTask(t.id)}><Icon name="check" size={18} /></button>
              <div className="task-text">
                <span style={{ overflowWrap: 'anywhere' }}>{t.text}</span>
                <span className="muted small" style={{ display: 'block' }}>
                  {t.category || t.cat}{t.time && t.time !== '--:--' ? `, às ${t.time}` : ''}
                </span>
              </div>
              <button className="btn soft sm" onClick={() => startFocus(t.text)}><Icon name="play" size={16} /> Pomodoro</button>
              <button className="icon-btn" onClick={() => removeTask(t.id)} aria-label={`Apagar: ${t.text}`}><Icon name="trash" size={20} /></button>
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <section className="stack" style={{ gap: '0.5rem' }}>
          <h2 className="muted" style={{ fontSize: '0.875rem' }}>Concluídas</h2>
          <div className="card list" style={{ paddingBlock: '0.25rem' }}>
            {done.map((t) => (
              <div key={t.id} className="item">
                <button className="check" role="checkbox" aria-checked="true" aria-label={`Reabrir: ${t.text}`} onClick={() => toggleTask(t.id)}><Icon name="check" size={18} /></button>
                <span className="grow done-text" style={{ overflowWrap: 'anywhere' }}>{t.text}</span>
                <button className="icon-btn" onClick={() => removeTask(t.id)} aria-label={`Apagar: ${t.text}`}><Icon name="trash" size={20} /></button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
