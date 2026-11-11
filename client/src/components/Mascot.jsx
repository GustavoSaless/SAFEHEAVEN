import { memo } from 'react'

/*
  Papp, o panda do SafeHaven.
  Humores: idle | happy | focus | eating | calm | care | wave
  As animações ficam em styles.css (classes m-*), e param sozinhas
  quando o sistema pede "reduzir movimento".
*/

const INK = '#24352C'
const INK_SOFT = '#3E5547'

function Eyes({ mood }) {
  if (mood === 'happy') {
    return (
      <g fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round">
        <path d="M65 86 q8 -9 16 0" />
        <path d="M119 86 q8 -9 16 0" />
      </g>
    )
  }
  if (mood === 'calm' || mood === 'eating') {
    return (
      <g fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round">
        <path d="M65 84 q8 7 16 0" />
        <path d="M119 84 q8 7 16 0" />
      </g>
    )
  }
  const lookY = mood === 'focus' ? 1.5 : 0
  return (
    <g className="m-blink">
      <circle cx="73" cy="84" r="9" fill="#fff" />
      <circle cx="127" cy="84" r="9" fill="#fff" />
      <circle cx="74.5" cy={84.5 + lookY} r="6" fill="#16241C" />
      <circle cx="125.5" cy={84.5 + lookY} r="6" fill="#16241C" />
      <circle cx="76.8" cy={82 + lookY} r="2.3" fill="#fff" />
      <circle cx="127.8" cy={82 + lookY} r="2.3" fill="#fff" />
      <circle cx="72.6" cy={87.2 + lookY} r="1" fill="#fff" opacity=".8" />
      <circle cx="123.6" cy={87.2 + lookY} r="1" fill="#fff" opacity=".8" />
    </g>
  )
}

function Brows({ mood }) {
  if (mood === 'focus') {
    return (
      <g stroke={INK} strokeWidth="3.2" strokeLinecap="round">
        <path d="M58 58 l20 5" />
        <path d="M142 58 l-20 5" />
      </g>
    )
  }
  if (mood === 'care') {
    return (
      <g stroke={INK} strokeWidth="3" strokeLinecap="round">
        <path d="M60 62 l17 -5" />
        <path d="M140 62 l-17 -5" />
      </g>
    )
  }
  return null
}

function Mouth({ mood }) {
  if (mood === 'happy' || mood === 'wave') {
    return (
      <g>
        <path d="M89 108 q11 15 22 0 z" fill="#7A2E2E" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M94 114 q6 5 12 0 q-6 -4 -12 0z" fill="#F19A8E" />
      </g>
    )
  }
  if (mood === 'eating') {
    return <ellipse className="m-chew" cx="100" cy="111" rx="6" ry="4.5" fill="#7A2E2E" stroke={INK} strokeWidth="2.2" />
  }
  if (mood === 'focus') {
    return <path d="M93 110 q7 4 14 0" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
  }
  if (mood === 'care') {
    return <path d="M92 111 q8 5 16 0" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
  }
  return (
    <path d="M100 104 v4 M88 108 q6 8 12 0 q6 8 12 0" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  )
}

function Bamboo() {
  return (
    <g className="m-bamboo">
      <rect x="96" y="112" width="9" height="62" rx="4.5" fill="#6DBE8B" transform="rotate(-24 100 143)" />
      <g transform="rotate(-24 100 143)" stroke="#3E8F60" strokeWidth="2" strokeLinecap="round">
        <path d="M96.5 132 h8" />
        <path d="M96.5 152 h8" />
      </g>
      <path d="M118 116 q14 -12 22 -2 q-12 8 -22 2z" fill="#58B17C" />
      <path d="M121 124 q15 -2 18 9 q-13 2 -18 -9z" fill="#7CCB98" />
    </g>
  )
}

function Mascot({ size = 120, mood = 'idle', title = 'Papp, o panda' }) {
  const eating = mood === 'eating'
  const waving = mood === 'wave'
  return (
    <svg
      className={`mascot m-${mood}`}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={title}
    >
      <defs>
        <radialGradient id="mFur" cx="42%" cy="30%" r="80%">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E9F1EB" />
        </radialGradient>
        <radialGradient id="mDark" cx="35%" cy="25%" r="85%">
          <stop offset="0" stopColor={INK_SOFT} />
          <stop offset="1" stopColor={INK} />
        </radialGradient>
        <linearGradient id="mScarf" x1="0" x2="1">
          <stop offset="0" stopColor="#8FD3AB" />
          <stop offset="1" stopColor="#5DB884" />
        </linearGradient>
      </defs>

      <ellipse cx="100" cy="188" rx="56" ry="7" fill="#1B3A2A" opacity=".1" />

      <g className="m-body">
        {/* pés */}
        <ellipse cx="66" cy="176" rx="20" ry="14" fill="url(#mDark)" />
        <ellipse cx="134" cy="176" rx="20" ry="14" fill="url(#mDark)" />
        <ellipse cx="64" cy="178" rx="8" ry="5.5" fill="#F4B9A0" opacity=".9" />
        <ellipse cx="136" cy="178" rx="8" ry="5.5" fill="#F4B9A0" opacity=".9" />

        {/* corpo */}
        <path d="M52 150 q0 -34 48 -34 q48 0 48 34 q0 32 -48 32 q-48 0 -48 -32z" fill="url(#mFur)" stroke={INK} strokeWidth="2.5" />
        <ellipse cx="100" cy="158" rx="24" ry="17" fill="#fff" opacity=".7" />

        {/* braço esquerdo */}
        <path
          d={eating ? 'M56 132 q-14 16 6 26 q22 6 30 -12 q-6 -18 -36 -14z' : 'M54 130 q-18 14 -8 34 q10 10 20 -2 q6 -20 -12 -32z'}
          fill="url(#mDark)"
        />
        {/* braço direito */}
        <g className={waving ? 'm-wave-arm' : undefined}>
          <path
            d={
              waving
                ? 'M146 132 q22 -8 26 -34 q-2 -12 -14 -8 q-14 16 -24 30z'
                : eating
                  ? 'M144 132 q14 16 -6 26 q-22 6 -30 -12 q6 -18 36 -14z'
                  : 'M146 130 q18 14 8 34 q-10 10 -20 -2 q-6 -20 12 -32z'
            }
            fill="url(#mDark)"
          />
        </g>
      </g>

      <g className="m-head">
        {/* orelhas */}
        <circle cx="50" cy="40" r="22" fill="url(#mDark)" />
        <circle cx="150" cy="40" r="22" fill="url(#mDark)" />
        <circle cx="51" cy="42" r="10" fill="#5B7466" opacity=".55" />
        <circle cx="149" cy="42" r="10" fill="#5B7466" opacity=".55" />

        {/* cabeça */}
        <path d="M36 84 q0 -52 64 -52 q64 0 64 52 q0 46 -64 46 q-64 0 -64 -46z" fill="url(#mFur)" stroke={INK} strokeWidth="2.5" />

        {/* brotinho */}
        <g className="m-leaf">
          <path d="M100 34 v-10" stroke="#3E8F60" strokeWidth="3" strokeLinecap="round" />
          <path d="M100 25 q-16 -12 -22 2 q12 8 22 -2z" fill="#6DBE8B" />
          <path d="M100 25 q14 -14 22 -1 q-11 9 -22 1z" fill="#8FD3AB" />
        </g>

        {/* manchas dos olhos */}
        <ellipse cx="72" cy="84" rx="18" ry="22" transform="rotate(18 72 84)" fill="url(#mDark)" />
        <ellipse cx="128" cy="84" rx="18" ry="22" transform="rotate(-18 128 84)" fill="url(#mDark)" />

        <Brows mood={mood} />
        <Eyes mood={mood} />

        {/* bochechas */}
        <ellipse className="m-cheek" cx="52" cy="106" rx="9" ry="6" fill="#F6A98F" opacity=".6" />
        <ellipse className="m-cheek" cx="148" cy="106" rx="9" ry="6" fill="#F6A98F" opacity=".6" />

        {/* focinho */}
        <ellipse cx="100" cy="106" rx="19" ry="13" fill="#fff" opacity=".9" />
        <path d="M93 98 q7 -4 14 0 q-1 7 -7 8 q-6 -1 -7 -8z" fill={INK} />
        <ellipse cx="98" cy="99.5" rx="2.2" ry="1.1" fill="#fff" opacity=".45" />
        <Mouth mood={mood} />
      </g>

      {/* cachecol */}
      <g>
        <path d="M60 124 q40 16 80 0 q4 8 -2 13 q-38 14 -76 0 q-6 -5 -2 -13z" fill="url(#mScarf)" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M122 136 q8 10 4 24 q-8 3 -13 -1 q4 -12 -1 -20z" fill="#5DB884" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      </g>

      {eating && <Bamboo />}
    </svg>
  )
}

export default memo(Mascot)
