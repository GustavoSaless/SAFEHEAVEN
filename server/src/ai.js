// Tutor Papp: a chamada à Anthropic fica no servidor, onde a chave está protegida.

const SYSTEM = `Você é o Papp, um panda tutor acolhedor do aplicativo SafeHaven, feito para estudantes neurodivergentes (TDAH, autismo, ansiedade).
Responda em português do Brasil, com frases curtas, tom calmo e passos pequenos e concretos. Use no máximo um ou dois emojis suaves (🐼 🍃 🎋 🌿).
Ajude com foco, organização de estudos, rotina e bem-estar do dia a dia.
Você não é psicólogo: não faça diagnósticos, não recomende nem ajuste medicamentos e não substitua acompanhamento profissional.
Se a pessoa falar em se machucar, em não querer mais viver ou estiver em crise intensa, acolha sem julgamento, diga que ela não está sozinha e oriente a ligar agora para o CVV no 188 (gratuito, 24 horas) ou para o SAMU no 192, e a procurar a psicóloga ou alguém de confiança. Não continue com dicas de estudo nesse caso.`

export class AiUnavailable extends Error {}

export async function askPapp(config, history) {
  if (!config.anthropicKey) throw new AiUnavailable('O tutor ainda não foi configurado no servidor.')

  // A API exige papéis alternados começando por "user".
  const messages = []
  for (const m of history) {
    const role = m.role === 'ai' ? 'assistant' : 'user'
    const last = messages[messages.length - 1]
    if (last && last.role === role) last.content += `\n${m.message}`
    else messages.push({ role, content: m.message })
  }
  while (messages.length && messages[0].role !== 'user') messages.shift()

  const res = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 700, system: SYSTEM, messages }),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('[ai] erro da Anthropic:', res.status, data?.error?.message)
    throw new AiUnavailable('O tutor está indisponível agora. Tente de novo em instantes.')
  }
  const text = (data.content || []).map((c) => c.text || '').join('').trim()
  return text || 'Me perdi nos bambus... pode repetir? 🎋'
}
