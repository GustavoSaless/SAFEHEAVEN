// Cronômetro Pomodoro fora do React: só quem mostra o tempo redesenha a cada segundo.
import { useSyncExternalStore } from 'react'

export const MODES = {
  focus: { label: 'Foco', minutes: 25 },
  shortBreak: { label: 'Pausa', minutes: 5 },
  longBreak: { label: 'Pausa longa', minutes: 15 },
}

let state = { mode: 'focus', total: 1500, remaining: 1500, running: false, task: null }
let endsAt = 0
let ticker = null
const listeners = new Set()
const doneListeners = new Set()

const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function tick() {
  const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
  if (remaining !== state.remaining) set({ remaining })
  if (remaining <= 0) {
    stopTicker()
    const finished = state.mode
    set({ running: false })
    doneListeners.forEach((l) => l(finished))
  }
}
const stopTicker = () => {
  clearInterval(ticker)
  ticker = null
}

export const timer = {
  get: () => state,
  subscribe(l) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  onDone(l) {
    doneListeners.add(l)
    return () => doneListeners.delete(l)
  },
  setMode(mode, task = null) {
    stopTicker()
    const total = MODES[mode].minutes * 60
    set({ mode, total, remaining: total, running: false, task })
  },
  start() {
    if (state.running || state.remaining <= 0) return
    // Usa o relógio, não a contagem de ticks: continua certo se o app ficar em segundo plano.
    endsAt = Date.now() + state.remaining * 1000
    set({ running: true })
    ticker = setInterval(tick, 250)
  },
  pause() {
    stopTicker()
    set({ running: false })
  },
  reset() {
    this.setMode(state.mode, state.task)
  },
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.running) tick()
})

export const useTimer = () => useSyncExternalStore(timer.subscribe, timer.get)
export const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
