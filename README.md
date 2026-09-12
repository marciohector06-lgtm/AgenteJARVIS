# J.A.R.V.I.S. — Assistente Pessoal Autônomo

Assistente pessoal autônomo, acessado principalmente via WhatsApp, com um app companion (React Native/Expo), agentes "satélite" leves que executam comandos em outras máquinas da rede, e um conjunto de mais de 30 ferramentas (ads, deploy, monitoramento de rede/PCs, automação de conteúdo, etc.).

## Stack

Node.js, LangChain, Google Gemini, ChromaDB, better-sqlite3, whatsapp-web.js, Telegraf (legado), Socket.io, Express, PM2, React Native/Expo, MQTT, SNMP (`net-snmp`), SSH2, Wake-on-LAN, Tavily (busca web), Supabase, API da Vercel, API do Meta Ads, API do Tailscale.

## Arquitetura — 4 módulos do assistente + camada de automação

- **`jarvis_backend/`** — o "cérebro": agente (planner/executor/toolLoop sobre Gemini), 30 tools, canais (WhatsApp principal, Telegram legado), memória (SQLite + ChromaDB), automações proativas (briefing, monitor, followup, weekly), camada de segurança (guardExecution, killSwitch, confirmationBroker). Expõe também a **API HTTP `/api/v1`** consumida pelo servidor MCP.
- **`jarvis_app/`** — app companion React Native/Expo. Autentica por PIN → JWT, conecta ao backend via Socket.io.
- **`jarvis_satellite/`** — agente leve (Express) instalado em outras máquinas da rede; recebe comandos do backend via Tailscale, autenticado por token compartilhado.
- **`jarvis_shared/`** — lib compartilhada entre backend e satellite (IoT, rede, execução remota via MQTT/SNMP/SSH2/Wake-on-LAN).
- **`mcp-jarvis-core/`** — servidor MCP (TypeScript) que expõe o cérebro como ferramentas para qualquer cliente MCP.
- **`claude-automation/`** — hook de segurança PreToolUse, supervisor em Python (Claude Agent SDK), comandos de teste e empacotamento como plugin.

## Camada de automação (MCP + Agent SDK)

### Como as peças se encaixam

```
Claude Code / supervisor Python
        │  (protocolo MCP, stdio)
        ▼
mcp-jarvis-core ──HTTP+JWT──▶ jarvis_backend /api/v1  (processo jarvis-server)
                                      │
                                      └──ponte loopback──▶ jarvis-whatsapp (sessão whatsapp-web.js)
```

O servidor MCP é uma casca fina: toda regra de segurança vive no cérebro. Isso é deliberado — o hook PreToolUse só existe no cliente Claude Code, então um `curl` direto na API ou outro cliente MCP não executaria hook nenhum. A trava de servidor é obrigatória; o hook é defesa em profundidade.

### Ferramentas MCP expostas

| Ferramenta | Efeito | Confirmação |
|---|---|---|
| `whatsapp_status` | leitura | não |
| `whatsapp_recent_messages` | leitura | não |
| `whatsapp_send_message` | envia mensagem real | **sim** |
| `network_clinic_status` | leitura | não |
| `network_list_commands` | leitura | não |
| `network_run_remote_command` | altera máquina remota | **sim**, quando o comando é destrutivo |
| `business_tool_status` | leitura | não |
| `memory_search` | leitura | não |

### Decisões de segurança

- **Execução remota usa catálogo fechado, nunca shell livre.** `network_run_remote_command` só aceita um `command_id` de `src/api/remoteCommandCatalog.js`, onde cada comando é uma string fixa. Nenhum texto vindo do cliente chega ao template PowerShell do `jarvis_shared/src/remoteExec.js`, que escapa apenas aspas duplas.
- **Credenciais de execução remota vêm do ambiente do cérebro** (`WINDOWS_REMOTE_USERNAME` / `WINDOWS_REMOTE_PASSWORD`), nunca do cliente MCP.
- **Toda rota `/api/v1` exige JWT** obtido em `POST /auth/token`. Antes desta camada, nenhuma rota Express do projeto validava JWT.
- **`guardExecution` é chamado explicitamente** dentro de `runWithSession("device", ...)`. Ele não é um dispatcher central — chamar as libs direto pularia kill switch, confirmação e auditoria.
- **`confirmed` do MCP vira `destructive: !confirmed`** no guard, evitando dupla confirmação sem abrir mão do kill switch, cuja checagem é incondicional.

### Setup da camada

```bash
cd mcp-jarvis-core && npm install && npm run build
pip install claude-agent-sdk
```

Variáveis adicionais no `jarvis_backend/.env`:

| Variável | Para quê |
|---|---|
| `WHATSAPP_BRIDGE_TOKEN` | segredo compartilhado entre `jarvis-server` e `jarvis-whatsapp`; sem ele a ponte não sobe e o envio via MCP fica indisponível |
| `WHATSAPP_BRIDGE_PORT` | porta loopback da ponte (padrão 4010) |
| `WINDOWS_REMOTE_USERNAME` / `WINDOWS_REMOTE_PASSWORD` | credenciais de WinRM para o catálogo de manutenção remota |

E para o servidor MCP: `JARVIS_API_URL`, e `JARVIS_DEVICE_PIN` (ou `JARVIS_API_TOKEN` com um JWT já emitido).

### Instalar como plugin

A raiz do repositório é a raiz do plugin (`.claude-plugin/plugin.json`), então o servidor MCP compilado viaja junto. Rode `npm run build` em `mcp-jarvis-core/` antes de instalar.

### Testes

Nenhuma suíte toca o mundo real — o servidor MCP é exercitado contra um backend simulado.

```bash
cd claude-automation/hooks && node --test tests/guard-policy.test.mjs
cd mcp-jarvis-core && node --test tests/mcpServer.test.mjs
cd jarvis_backend && node --test tests/api.test.mjs
cd claude-automation/supervisor && python test_supervisor_offline.py
```

## Setup

### Backend (cérebro)
```bash
cd jarvis_backend
cp .env.example .env   # preencher GEMINI_API_KEY no mínimo
npm install
npm run start:server   # ou: npm start (bot standalone)
npm run start:bg       # produção, via PM2
```

### App (companion)
```bash
cd jarvis_app
cp .env.example .env
npm install
npm start   # Expo
```

### Satélite (uma vez por máquina da rede)
```bash
cd jarvis_satellite
cp .env.example .env   # SATELLITE_TOKEN e SATELLITE_ID devem ser únicos por satélite
npm install
npm run start:bg       # PM2
```

## Variáveis de ambiente

Cada `.env.example` (um por módulo) já traz comentário explicando o propósito e o efeito de cada variável — use-o como referência primária ao configurar. Resumo por categoria (`jarvis_backend/.env.example`):

| Categoria | Variáveis |
|---|---|
| Núcleo (LLM) | `GEMINI_API_KEY`, `TAVILY_API_KEY` |
| WhatsApp (canal principal) | `WHATSAPP_OWNER_NUMBER`, `ALLOWED_WHATSAPP_NUMBERS` |
| Telegram (legado) | `TELEGRAM_BOT_TOKEN`, `ALLOWED_TELEGRAM_USER_IDS` |
| Memória | `SQLITE_PATH`, `CHROMA_URL`, `CHROMA_PATH` |
| App/servidor | `PORT`, `JWT_SECRET`, `DEVICE_PIN` |
| Segurança | `REQUIRE_CONFIRM` |
| Crons proativos (todos `false` por padrão) | `BRIEFING_ENABLED`, `MONITOR_ENABLED`, `FOLLOWUP_ENABLED`, `WEEKLY_ENABLED` |
| Monitor de infra | `MONITOR_HOSTS`, `MONITOR_UPS_HOST`, `MONITOR_UPS_OID`, `MONITOR_UPS_BATTERY_VALUE` |
| Backup automático | `BACKUP_PASSWORD`, `BACKUP_DESTINATION` |
| Satélites | `SATELLITE_REGISTRATION_SECRET` |
| Rede/PCs Windows | `MONITORED_WINDOWS_PCS` |
| Tailscale | `TAILSCALE_API_KEY`, `TAILSCALE_TAILNET` |
| Meta Ads | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_ADS_MONITOR_ENABLED`, `META_CPM_ALERT_INCREASE_PERCENT`, `META_CTR_ALERT_THRESHOLD` |
| Vercel | `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECTS`, `VERCEL_BRIEFING_PROJECTS` |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECTS` |
| Opcionais | `OPENAI_API_KEY` (transcrição de áudio), `VMIX_API_URL` (controle de câmera/replay) |

`jarvis_app/.env.example` e `jarvis_satellite/.env.example` têm suas próprias variáveis de pareamento/identidade — ver cada arquivo.

## Estrutura de pastas

```
jarvis_backend/src/
  agent/       — planner, executor, toolLoop, systemPrompt, modelFallback (Gemini)
  bot/         — canais (WhatsApp, Telegram)
  tools/       — 30 ferramentas (ads, deploy, rede, conteúdo, administração de PCs, etc.)
  memory/      — SQLite + ChromaDB, perfis de usuário
  proactive/   — briefing, monitor, followup, weekly (crons)
  security/    — guardExecution, killSwitch, confirmationBroker, sessionContext
  audio/ media/ scraper/ dashboard/ satellite/ (comunicação com jarvis_satellite)

jarvis_app/src/
  components/ constants/ hooks/ screens/ services/

jarvis_satellite/src/
  index.js  remoteGuard.js

jarvis_shared/src/
  index.js  iot.js  network.js  remoteExec.js
```

Ver [PROGRESSO.md](./PROGRESSO.md) para o estado atual de cada módulo/funcionalidade.
