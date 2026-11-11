import { useState } from 'react'
import { api } from '../lib/api.js'
import { useApp } from '../App.jsx'
import { APP_NAME, MASCOT_NAME } from '../config.js'
import Mascot from '../components/Mascot.jsx'
import { Field } from '../components/ui.jsx'

const PROFILES = [
  { id: 'solo', title: 'Não tenho acompanhamento psicológico', hint: 'Foco, alívio da ansiedade, tarefas e tutor.' },
  { id: 'linked', title: 'Tenho psicóloga ou psicólogo', hint: 'Use a chave que recebeu para liberar o chat ao vivo e as receitas.' },
  { id: 'pro', title: 'Sou psicóloga ou psicólogo', hint: 'Atenda seus pacientes. O cadastro passa por conferência do CRP.' },
]

export default function Auth() {
  const { login } = useApp()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', accessKey: '', crp: '' })
  const [profile, setProfile] = useState('solo')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const register = mode === 'register'

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.email || !form.password || (register && !form.name)) return setError('Preencha todos os campos.')
    if (register && profile === 'linked' && !form.accessKey.trim()) return setError('Digite a chave que sua psicóloga ou psicólogo passou.')
    setBusy(true)
    try {
      const body = register
        ? {
            name: form.name,
            email: form.email,
            password: form.password,
            role: profile === 'pro' ? 'psychologist' : 'patient',
            crp: profile === 'pro' ? form.crp : undefined,
            accessKey: profile === 'linked' ? form.accessKey : undefined,
          }
        : { email: form.email, password: form.password }
      const d = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body })
      login(d.token, d.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <form className="auth-box" onSubmit={submit} noValidate>
        <div className="auth-hero">
          <Mascot size={112} mood="wave" />
          <div>
            <h1>{APP_NAME}</h1>
            <p className="muted">{register ? `${MASCOT_NAME} guarda um lugar calmo para você.` : 'Seu lugar calmo para estudar e respirar.'}</p>
          </div>
        </div>

        {register && (
          <Field label="Nome">
            <input value={form.name} onChange={set('name')} autoComplete="name" placeholder="Como quer ser chamado" />
          </Field>
        )}
        <Field label="E-mail">
          <input type="email" inputMode="email" value={form.email} onChange={set('email')} autoComplete="email" autoCapitalize="none" placeholder="voce@email.com" />
        </Field>
        <Field label="Senha">
          <input type="password" value={form.password} onChange={set('password')} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'Pelo menos 8 caracteres' : 'Sua senha'} />
        </Field>

        {register && (
          <div className="stack" role="radiogroup" aria-label="Como você vai usar o app">
            <span className="small" style={{ fontWeight: 700 }}>Como você vai usar o {APP_NAME}?</span>
            {PROFILES.map((p) => (
              <button type="button" key={p.id} className="choice" role="radio" aria-checked={profile === p.id} onClick={() => setProfile(p.id)}>
                <i className="dot" />
                <span>
                  <strong>{p.title}</strong>
                  <small>{p.hint}</small>
                </span>
              </button>
            ))}
            {profile === 'linked' && (
              <Field label="Chave de acesso">
                <input className="code" value={form.accessKey} onChange={set('accessKey')} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="SH-XXXX-XXXX" />
              </Field>
            )}
            {profile === 'pro' && (
              <Field label="Número do CRP">
                <input value={form.crp} onChange={set('crp')} inputMode="numeric" autoComplete="off" placeholder="06/123456" />
              </Field>
            )}
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <button className="btn block" disabled={busy}>
          {busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar'}
        </button>
        <button type="button" className="btn ghost block" onClick={() => { setMode(register ? 'login' : 'register'); setError('') }}>
          {register ? 'Já tenho conta' : 'Criar uma conta'}
        </button>
      </form>
    </main>
  )
}
