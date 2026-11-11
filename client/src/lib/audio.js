// Sons gerados na hora com Web Audio: nada para baixar, funciona offline.
import { useSyncExternalStore } from 'react'

export const SOUNDS = [
  { id: 'brown', name: 'Ruído marrom', hint: 'Grave e constante, abafa conversas' },
  { id: 'rain', name: 'Chuva leve', hint: 'Chiado suave e contínuo' },
  { id: 'waves', name: 'Ondas do mar', hint: 'Vai e volta devagar' },
  { id: 'stream', name: 'Riacho', hint: 'Água corrente, mais agudo' },
  { id: 'forest', name: 'Brisa na mata', hint: 'Vento baixo entre as folhas' },
]

let ctx = null
let master = null
let nodes = []
let state = { playing: null, volume: 0.5 }
const listeners = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) throw new Error('Áudio indisponível neste aparelho.')
    ctx = new AC()
    master = ctx.createGain()
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function noiseBuffer(kind) {
  const c = getCtx()
  const buf = c.createBuffer(1, c.sampleRate * 4, c.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) {
    const white = Math.random() * 2 - 1
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02
      d[i] = last * 3.5
    } else d[i] = white
  }
  return buf
}

function source(kind) {
  const src = getCtx().createBufferSource()
  src.buffer = noiseBuffer(kind)
  src.loop = true
  src.start()
  nodes.push(src)
  return src
}
const filter = (type, freq, q = 0.7) => {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}
const gain = (v) => {
  const g = ctx.createGain()
  g.gain.value = v
  return g
}
// Oscilador lento que faz o volume (ou o filtro) subir e descer, como onda ou vento.
function sway(param, rate, depth) {
  const lfo = ctx.createOscillator()
  lfo.frequency.value = rate
  const amount = gain(depth)
  lfo.connect(amount).connect(param)
  lfo.start()
  nodes.push(lfo)
}

const recipes = {
  brown() {
    source('brown').connect(gain(0.55)).connect(master)
  },
  rain() {
    source('white').connect(filter('highpass', 1200)).connect(filter('lowpass', 7000)).connect(gain(0.16)).connect(master)
    source('brown').connect(gain(0.12)).connect(master)
  },
  waves() {
    const g = gain(0.28)
    source('brown').connect(filter('lowpass', 900)).connect(g).connect(master)
    sway(g.gain, 0.11, 0.22)
    const foam = gain(0.03)
    source('white').connect(filter('bandpass', 2500, 0.5)).connect(foam).connect(master)
    sway(foam.gain, 0.11, 0.03)
  },
  stream() {
    const band = filter('bandpass', 1800, 1.2)
    source('white').connect(band).connect(gain(0.2)).connect(master)
    sway(band.frequency, 0.7, 500)
    source('brown').connect(filter('highpass', 300)).connect(gain(0.15)).connect(master)
  },
  forest() {
    const band = filter('bandpass', 600, 0.6)
    const g = gain(0.3)
    source('brown').connect(band).connect(g).connect(master)
    sway(band.frequency, 0.07, 250)
    sway(g.gain, 0.05, 0.15)
  },
}

function silence() {
  nodes.forEach((n) => {
    try {
      n.stop()
      n.disconnect()
    } catch {}
  })
  nodes = []
}

export const sound = {
  get: () => state,
  subscribe(l) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  play(id) {
    getCtx()
    silence()
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(0, ctx.currentTime)
    master.gain.linearRampToValueAtTime(state.volume, ctx.currentTime + 1.2) // entra aos poucos, sem susto
    recipes[id]()
    set({ playing: id })
  },
  stop() {
    if (!ctx || !state.playing) return
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.15)
    setTimeout(() => !state.playing && silence(), 700)
    set({ playing: null })
  },
  setVolume(volume) {
    set({ volume })
    if (ctx && state.playing) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05)
  },
}

export const useSound = () => useSyncExternalStore(sound.subscribe, sound.get)

// Um único sino suave (não é alarme contínuo).
export function chime() {
  try {
    const c = getCtx()
    ;[528, 792].forEach((freq, i) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      const t = c.currentTime + i * 0.18
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.04)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6)
      o.connect(g).connect(c.destination)
      o.start(t)
      o.stop(t + 1.7)
    })
  } catch {}
}
