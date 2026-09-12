# J.A.R.V.I.S. — Assistente Pessoal Autônomo

Assistente pessoal autônomo, acessado principalmente via WhatsApp, com um app companion (React Native/Expo), agentes "satélite" leves que executam comandos em outras máquinas da rede, e um conjunto de mais de 30 ferramentas (ads, deploy, monitoramento de rede/PCs, automação de conteúdo, etc.).

## Stack

Node.js, LangChain, Google Gemini, ChromaDB, better-sqlite3, whatsapp-web.js, Telegraf (legado), Socket.io, Express, PM2, React Native/Expo, MQTT, SNMP (`net-snmp`), SSH2, Wake-on-LAN, Tavily (busca web), Supabase, API da Vercel, API do Meta Ads, API do Tailscale.

## Arquitetura — 4 módulos

- **`jarvis_backend/`** — o "cérebro": agente (planner/executor/toolLoop sobre Gemini), 30 tools, canais (WhatsApp principal, Telegram legado), memória (SQLite + ChromaDB), automações proativas (briefing, monitor, followup, weekly), camada de segurança (guardExecution, killSwitch, confirmationBroker).
- **`jarvis_app/`** — app companion React Native/Expo. Autentica por PIN → JWT, conecta ao backend via Socket.io.
- **`jarvis_satellite/`** — agente leve (Express) instalado em outras máquinas da rede; recebe comandos do backend via Tailscale, autenticado por token compartilhado.
- **`jarvis_shared/`** — lib compartilhada entre backend e satellite (IoT, rede, execução remota via MQTT/SNMP/SSH2/Wake-on-LAN).

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
