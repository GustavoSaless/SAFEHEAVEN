// Lembretes de tarefa. No celular usa notificação local com o botão "Iniciar Pomodoro";
// no navegador (ou sem o plugin) o app mostra o aviso na própria tela.
import { Capacitor } from '@capacitor/core'

let plugin = null
let ready = null

async function setup() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('LocalNotifications')) return null
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  const perm = await LocalNotifications.requestPermissions()
  if (perm.display !== 'granted') return null
  await LocalNotifications.registerActionTypes({
    types: [{ id: 'TASK', actions: [{ id: 'pomodoro', title: 'Iniciar Pomodoro', foreground: true }, { id: 'later', title: 'Depois', destructive: false }] }],
  })
  plugin = LocalNotifications
  return plugin
}
const get = () => (ready ??= setup().catch(() => null))

const idOf = (taskId) => Math.abs(Number(taskId) | 0) || 1

function nextAt(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const at = new Date()
  at.setHours(h, m, 0, 0)
  if (at <= new Date()) at.setDate(at.getDate() + 1)
  return at
}

export async function scheduleTask(task) {
  if (!/^\d{2}:\d{2}$/.test(task.time)) return
  const p = await get()
  if (!p) return
  await p.schedule({
    notifications: [
      { id: idOf(task.id), title: 'Hora da tarefa', body: task.text, schedule: { at: nextAt(task.time), allowWhileIdle: true }, actionTypeId: 'TASK', extra: { taskId: task.id, text: task.text } },
    ],
  }).catch(() => {})
}

export async function cancelTask(taskId) {
  const p = await get()
  if (p) await p.cancel({ notifications: [{ id: idOf(taskId) }] }).catch(() => {})
}

// Chama onPomodoro quando a pessoa toca em "Iniciar Pomodoro" na notificação.
export async function onTaskAction(onPomodoro) {
  const p = await get()
  if (!p) return () => {}
  const handle = await p.addListener('localNotificationActionPerformed', (ev) => {
    if (ev.actionId === 'pomodoro') onPomodoro(ev.notification?.extra || {})
  })
  return () => handle.remove()
}

export const hasNativeNotifications = async () => !!(await get())
