import { useState } from 'react'
import { useApp } from '../App.jsx'
import { APP_NAME } from '../config.js'
import Icon from './Icon.jsx'
import Mascot from './Mascot.jsx'
import { Sheet, Switch } from './ui.jsx'

// Moldura comum aos três perfis: barra do topo, navegação e folha de conta.
export default function Shell({ tabs, tab, onTab, badges = {}, actions, menuExtra, children }) {
  const { user, logout, theme, setTheme, font, setFont } = useApp()
  const [menu, setMenu] = useState(false)
  const roleName = { patient: 'Conta pessoal', psychologist: `CRP ${user.crp || ''}`, admin: 'Administração' }[user.role]

  return (
    <div className={`app ${tabs ? 'has-nav' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Mascot size={30} mood="idle" title="" />
          </span>
          <span className="brand-name">{APP_NAME}</span>
        </div>
        {actions}
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Conta e ajustes">
          <Icon name="menu" />
        </button>
      </header>

      {children}

      {tabs && (
        <nav className="nav" aria-label="Seções">
          {tabs.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
              <span className="nav-ico">
                <Icon name={t.icon} />
              </span>
              {t.label}
              {badges[t.id] > 0 && <span className="badge">{badges[t.id]}</span>}
            </button>
          ))}
        </nav>
      )}

      {menu && (
        <Sheet title="Conta e ajustes" onClose={() => setMenu(false)}>
          <div className="row">
            <span className="avatar"><Icon name="user" size={20} /></span>
            <div className="grow">
              <strong className="ellipsis" style={{ display: 'block' }}>{user.name}</strong>
              <span className="muted small ellipsis" style={{ display: 'block' }}>{roleName}</span>
            </div>
          </div>
          <div className="card stack" style={{ gap: 0 }}>
            <Switch label="Tema escuro" checked={theme === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} />
            <Switch label="Letras maiores" checked={font === 'large'} onChange={(v) => setFont(v ? 'large' : 'normal')} />
          </div>
          {typeof menuExtra === 'function' ? menuExtra(() => setMenu(false)) : menuExtra}
          <button className="btn soft block" onClick={logout}>
            <Icon name="logout" size={20} /> Sair da conta
          </button>
        </Sheet>
      )}
    </div>
  )
}
