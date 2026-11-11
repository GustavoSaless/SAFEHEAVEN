import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, session } from './lib/api.js'
import { ToastProvider, usePref } from './components/ui.jsx'
import Mascot from './components/Mascot.jsx'
import Auth from './screens/Auth.jsx'

// Cada perfil carrega só o próprio código.
const PatientApp = lazy(() => import('./screens/patient/PatientApp.jsx'))
const ProApp = lazy(() => import('./screens/pro/ProApp.jsx'))
const AdminApp = lazy(() => import('./screens/admin/AdminApp.jsx'))

const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

function Splash() {
  return (
    <div className="auth">
      <Mascot size={120} mood="calm" />
    </div>
  )
}

export default function App() {
  // Abre direto com a sessão guardada; a conferência com o servidor acontece em segundo plano.
  const [user, setUserState] = useState(() => (session.token ? session.cachedUser : null))
  const [checking, setChecking] = useState(() => !!session.token && !session.cachedUser)
  const [slow, setSlow] = useState(false)
  const [theme, setTheme] = usePref('theme', 'light')
  const [font, setFont] = usePref('font', 'normal')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.font = font
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0e1a14' : '#eef7f1')
  }, [theme, font])

  const setUser = useCallback((u) => {
    setUserState(u)
    if (u) session.save(null, u)
  }, [])

  const logout = useCallback(() => {
    window.dispatchEvent(new Event('sh:signout')) // fecha o chat ao vivo, se estiver aberto
    session.clear()
    setUserState(null)
  }, [])

  const login = useCallback((token, u) => {
    session.save(token, u)
    setUserState(u)
  }, [])

  const refreshUser = useCallback(
    () =>
      api('/auth/me').then((d) => {
        setUser(d.user)
        return d.user
      }),
    [setUser],
  )

  useEffect(() => {
    if (session.token) refreshUser().catch(() => {}).finally(() => setChecking(false))
    const onLogout = () => logout()
    const onSlow = (e) => setSlow(e.detail)
    window.addEventListener('sh:logout', onLogout)
    window.addEventListener('sh:slow', onSlow)
    return () => {
      window.removeEventListener('sh:logout', onLogout)
      window.removeEventListener('sh:slow', onSlow)
    }
  }, [refreshUser, logout])

  const ctx = useMemo(
    () => ({ user, setUser, refreshUser, login, logout, theme, setTheme, font, setFont }),
    [user, setUser, refreshUser, login, logout, theme, setTheme, font, setFont],
  )

  let screen
  if (checking) screen = <Splash />
  else if (!user) screen = <Auth />
  else if (user.role === 'admin') screen = <AdminApp />
  else if (user.role === 'psychologist') screen = <ProApp />
  else screen = <PatientApp />

  return (
    <AppCtx.Provider value={ctx}>
      <ToastProvider>
        {slow && (
          <div className="wake" role="status">
            Acordando o servidor… a primeira resposta pode levar até um minuto.
          </div>
        )}
        <Suspense fallback={<Splash />}>{screen}</Suspense>
      </ToastProvider>
    </AppCtx.Provider>
  )
}
