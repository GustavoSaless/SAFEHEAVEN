import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'

// ---------- aviso rápido (toast) ----------
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const show = useCallback((text) => {
    clearTimeout(timer.current)
    setMsg(text)
    timer.current = setTimeout(() => setMsg(null), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status" aria-live="polite">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

// ---------- folha que sobe de baixo (vira janela central em telas largas) ----------
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="row between" style={{ minHeight: 48 }}>
      <span>{label}</span>
      <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
    </label>
  )
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Tabs({ value, onChange, options }) {
  return (
    <div className="chips" role="tablist">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" className="chip" aria-selected={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const initials = (name = '') =>
  name
    .replace(/^(dra?\.?|sra?\.?)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')

// Carrega dados de uma função assíncrona e permite recarregar.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const alive = useRef(true)
  const load = useCallback(() => {
    fn()
      .then((data) => alive.current && setState({ data, error: null, loading: false }))
      .catch((error) => alive.current && setState((s) => ({ ...s, error: error.message, loading: false })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    alive.current = true
    load()
    return () => {
      alive.current = false
    }
  }, [load])
  return useMemo(() => ({ ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) }), [state, load])
}

// Preferências guardadas no aparelho (tema, fonte, som automático).
export function usePref(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(`sh_pref_${key}`)
      return raw == null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })
  const save = useCallback(
    (v) => {
      setValue(v)
      try {
        localStorage.setItem(`sh_pref_${key}`, JSON.stringify(v))
      } catch {}
    },
    [key],
  )
  return [value, save]
}
