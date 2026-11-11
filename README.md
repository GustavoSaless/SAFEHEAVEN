# SafeHaven

App de estudo e bem-estar para estudantes neurodivergentes (antigo PAPP), agora com acompanhamento psicológico.

```
client/   app (React + Vite + Capacitor): o que vira o APK
server/   API (Node + Express + SQLite + Socket.IO)
```

## Perfis de acesso

| Perfil | Como entra | O que vê |
|---|---|---|
| Sem psicóloga | Cadastro normal | Foco, Alívio, Tarefas, Tutor Papp |
| Com psicóloga | Cadastro com a **chave** que recebeu (ou depois, na aba Terapia) | Tudo acima, mais o **chat ao vivo** e as **receitas e orientações** |
| Psicóloga(o) | Cadastro com o CRP; fica **em análise** até o admin aprovar | Pacientes, chat ao vivo, receitas, geração de chaves |
| Admin | Definido no `.env` do servidor | Aprovar CRP, bloquear ou excluir contas, mensagens do "Fale com a equipe" |

Cada chave tem o formato `SH-XXXX-XXXX`, serve para **um paciente só** e vence em 7 dias (ajustável em `KEY_TTL_DAYS`). A psicóloga pode revogar uma chave não usada e encerrar um vínculo a qualquer momento.

Por sigilo profissional, o admin **não** tem acesso a conversas, diários nem receitas. O diário só a própria pessoa lê; nem a psicóloga vê.

## Rodar no computador

```bash
# 1) servidor
cd server
npm install
cp .env.example .env      # preencha JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD e ANTHROPIC_API_KEY
npm run dev               # http://localhost:5001
npm test                  # 9 testes: contas, chaves, chat ao vivo, receitas, admin

# 2) app (em outro terminal)
cd client
npm install
echo "VITE_API_URL=http://localhost:5001/api" > .env
npm run dev               # abra o endereço que aparecer
```

Para testar o chat ao vivo, abra o app em duas janelas (uma anônima): uma com a psicóloga e outra com o paciente.

## Publicar o servidor (Render)

1. Suba a pasta `server` (Build: `npm install`, Start: `npm start`).
2. Em **Environment**, cadastre as variáveis do `.env.example`. `JWT_SECRET` é obrigatória: o servidor não sobe sem ela em produção (`NODE_ENV=production`).
3. Adicione um **Disk** (ex.: montado em `/var/data`) e defina `DB_FILE=/var/data/safehaven.db`. Sem disco persistente, o Render apaga o banco a cada deploy.

Para trazer as contas e tarefas do backend antigo: `npm run import-old -- caminho/papp_database.json`. As senhas antigas continuam valendo.

## Gerar o APK

```bash
cd client
echo "VITE_API_URL=https://SEU-SERVIDOR.onrender.com/api" > .env
npm run build
npx cap add android                         # só na primeira vez
npx @capacitor/assets generate --android    # ícone e splash a partir de client/resources
npm run android                             # build + cap sync
npx cap open android                        # no Android Studio: Build > Build APK(s)
```

O pacote mudou de `com.papp.app` para `com.safehaven.app`, então ele instala como um **app novo**, ao lado do PAPP. Se preferir que ele substitua o PAPP, volte o `appId` em `client/capacitor.config.json` para `com.papp.app` antes do `cap add android`.

Para os lembretes de tarefa com o botão "Iniciar Pomodoro" funcionarem com o app fechado, confira se o `AndroidManifest.xml` gerado tem a permissão `POST_NOTIFICATIONS` (o plugin `@capacitor/local-notifications` costuma adicionar sozinho).

## O que mudou em relação ao PAPP

**Relatório da beta tester (Juliana Souza)**
- **Alimentar o panda:** agora há uma pausa guiada de 4 segundos entre um bambu e outro, com o panda mastigando e uma barra que acompanha a respiração.
- **Máscara sonora:** cinco sons (ruído marrom, chuva, ondas, riacho, brisa), volume ajustável e opção de tocar junto com o Pomodoro. Todos são gerados no aparelho e funcionam sem internet.
- **Atalho de emergência:** botão "Preciso de calma" fixo no topo de todas as telas, com respiração quadrada, aterramento 5-4-3-2-1, contato com a psicóloga e os telefones do CVV (188) e do SAMU (192).
- **Descarrego mental:** duas saídas, "Queimar e soltar" (apaga na hora) ou "Salvar no diário" (fica guardado para reler).
- **Tarefas:** o lembrete toca um sino único (não é mais alarme contínuo) e oferece "Iniciar Pomodoro" com a tarefa já carregada. Cada tarefa também tem um botão de Pomodoro.
- **Tutor de IA:** funciona de verdade agora (resposta da Dúvida 1 do relatório).

**Correções técnicas**
- O tutor chamava a Anthropic direto do celular, sem chave, e por isso sempre falhava. Agora a chamada passa pelo servidor, com a chave protegida, histórico da conversa e limite de mensagens por hora.
- O servidor antigo tinha o segredo do JWT escrito no código e gravava tudo num arquivo JSON a cada requisição. Trocado por variável de ambiente e SQLite.
- O app antigo chamava rotas que o servidor não tinha (`/chat`, `/auth/me`, `/user/bamboo`) e esperava formatos de resposta diferentes. Agora os dois lados batem, e os testes cobrem isso.

**Velocidade e responsividade**
- O app abre direto com a sessão salva, sem esperar o servidor responder.
- Cada perfil carrega só o próprio código (paciente, psicóloga, admin).
- O cronômetro atualiza apenas o mostrador, não a tela inteira, e segue o relógio real, então não atrasa com o app em segundo plano.
- Ações como concluir tarefa, alimentar o panda e enviar mensagem aparecem na hora, antes de o servidor confirmar.
- Quando o servidor gratuito do Render está "dormindo", aparece um aviso em vez de o app parecer travado.
- Layout testado de 320px até desktop (barra lateral em telas largas), com tema escuro, opção de letras maiores e respeito à configuração de "reduzir movimento" do sistema.

## Personalizar

- **Nome do app:** `client/src/config.js`, `client/index.html` e `client/capacitor.config.json`.
- **Cores:** variáveis no topo de `client/src/styles.css`.
- **Mascote:** `client/src/components/Mascot.jsx` (SVG com 7 expressões: idle, happy, focus, eating, calm, care, wave).
- **Personalidade do tutor:** `server/src/ai.js`.
