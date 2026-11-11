# SafeHaven

App de estudo e bem-estar para estudantes neurodivergentes (antigo PAPP), agora com acompanhamento psicológico.

```
client/   app (React + Vite + Capacitor): o que vira o APK
server/   API (Node + Express + Postgres + Socket.IO)
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

Precisa só do Node.js 24. O banco é um Postgres embutido (PGlite), que grava em `server/data/pglite`: não é preciso instalar banco nenhum.

```bash
cd server
npm install
cp .env.example .env      # preencha JWT_SECRET, ADMIN_EMAIL e ADMIN_PASSWORD (deixe DATABASE_URL vazio)
npm run dev               # API em http://localhost:5001
npm test                  # 9 testes: contas, chaves, chat ao vivo, receitas, admin

# em outro terminal
cd client
npm install
echo "VITE_API_URL=http://localhost:5001/api" > .env
npm run dev               # app em http://localhost:5173
```

No Windows, crie o `.env` com o Bloco de Notas, não com `echo` no PowerShell (ele salva num formato que o Node não lê).

## Publicar de graça (Render + Neon)

O servidor entrega o app e a API no mesmo endereço, então é **um serviço só** no Render.

1. **Banco:** crie um projeto no [Neon](https://neon.com) (grátis, sem cartão) e copie a connection string `postgresql://...`.
   O Postgres gratuito do próprio Render também funciona, mas é apagado depois de 30 dias.
2. **Código:** suba esta pasta para um repositório no GitHub (pode ser privado). **Não envie** `node_modules`, `.env` nem `server/data`.
3. **Render:** New > **Blueprint** > escolha o repositório. Ele lê o `render.yaml` e pede:
   - `DATABASE_URL`: a connection string do Neon
   - `ADMIN_EMAIL` e `ADMIN_PASSWORD`: seu login de administrador
   - `ANTHROPIC_API_KEY`: opcional, liga o tutor Papp
4. Em alguns minutos o app fica em `https://safehaven-XXXX.onrender.com`. Mande esse link para quem for testar: abre no navegador do celular.

O plano gratuito do Render "dorme" após 15 minutos sem uso. A primeira visita depois disso leva cerca de 1 minuto; o app mostra um aviso enquanto o servidor acorda.

Para atualizar o app depois, envie os arquivos alterados ao GitHub: o Render publica sozinho.

## Gerar o APK

```bash
cd client
echo "VITE_API_URL=https://SEU-APP.onrender.com/api" > .env
npm run build
npx cap add android                         # só na primeira vez
npx @capacitor/assets generate --android    # ícone e splash a partir de client/resources
npm run android                             # build + cap sync
npx cap open android                        # no Android Studio: Build > Build APK(s)
```

O pacote é `com.safehaven.app` (instala ao lado do PAPP antigo). Desde setembro de 2026, no Brasil, apps instalados por fora da Play Store precisam vir de um desenvolvedor verificado no Android Developer Console.

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
- O servidor antigo tinha o segredo do JWT escrito no código e gravava tudo num arquivo JSON a cada requisição. Trocado por variável de ambiente e Postgres.
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
- **Banco de dados:** tabelas em `server/src/db.js`.
