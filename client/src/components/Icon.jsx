import { memo } from 'react'

// Ícones de traço, desenhados à mão para o app (24x24).
const PATHS = {
  focus: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></>,
  relief: <><path d="M12 21c-4-3-8-6-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5-4 8-8 11z" /></>,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  tutor: <><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 4v-4a3 3 0 0 1-3-3z" /><path d="M9 9h6M9 12.5h3.5" /></>,
  care: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M17 7.5a3 3 0 0 1 0 5.5M18.5 15.5a5.5 5.5 0 0 1 3 4.5" /></>,
  key: <><circle cx="8" cy="15" r="4.5" /><path d="M11.5 11.5L20 3M16 7l3 3M13.5 9.5l2 2" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.5a5 5 0 0 1 4.5 5" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>,
  inbox: <><path d="M3 13l3-8h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 13h5a4 4 0 0 0 8 0h5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  back: <><path d="M15 5l-7 7 7 7" /></>,
  send: <><path d="M4 12l16-8-6 16-3-7z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  play: <><path d="M7 4.5v15l12-7.5z" /></>,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  reset: <><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5" /></>,
  sound: <><path d="M4 10v4h3l5 4V6l-5 4z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
  wind: <><path d="M3 9h10a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h6" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  flame: <><path d="M12 21a6 6 0 0 0 6-6c0-4-3-5-3-9-3 1-5 4-5 6-1-1-2-2-2-4-2 2-2 5-2 7a6 6 0 0 0 6 6z" /></>,
  book: <><path d="M5 4h10a4 4 0 0 1 4 4v12H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  life: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" /></>,
  phone: <><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  leaf: <><path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l8-8" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  logout: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4.5" /></>,
  note: <><path d="M6 3h9l4 4v14H6z" /><path d="M9 11h7M9 15h7M14 3v5h5" /></>,
}

function Icon({ name, size = 22, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
export default memo(Icon)
