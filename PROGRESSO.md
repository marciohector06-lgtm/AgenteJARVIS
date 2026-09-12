# Progresso — J.A.R.V.I.S.

## Nota sobre este documento

Reconstruído em 12/09/2026 a partir da inspeção do código-fonte (não existia README.md nem PROGRESSO.md no repositório até esta data). O que está descrito abaixo reflete o que existe implementado no código; itens marcados como "não verificado" não puderam ser confirmados sem acesso ao ambiente rodando.

## Módulos

- **jarvis_backend** (cérebro): implementado — agente completo (planner/executor/toolLoop sobre Gemini) e 30 tools.
- **jarvis_app** (companion mobile): implementado — Expo/React Native, autenticação por PIN, conexão via Socket.io.
- **jarvis_satellite** (agentes de rede): implementado — protocolo de registro por token compartilhado + heartbeat.
- **jarvis_shared**: implementado — lib de IoT/rede/execução remota compartilhada entre backend e satélites.

## Canais de comunicação

- **WhatsApp** (`whatsapp-web.js`): canal principal atual.
- **Telegram** (`telegraf`): **legado** — o próprio `.env.example` documenta que "não sobe mais por padrão"; mantido só para o alerta de falha do backup automático.

Isso diverge do que estava registrado anteriormente ("Fase 2 — migração WhatsApp — parcial"): pelo código, WhatsApp já é o canal padrão e Telegram já foi rebaixado a legado, não uma migração em andamento. Vale confirmar com Márcio se ainda falta algo específico dessa migração que não aparece só lendo o código.

## Automações proativas (crons) — todas desligadas por padrão

Implementadas em `src/proactive/`: briefing diário, monitor de infraestrutura, follow-up, relatório semanal. Porém `BRIEFING_ENABLED`, `MONITOR_ENABLED`, `FOLLOWUP_ENABLED` e `WEEKLY_ENABLED` vêm como `false` no `.env.example` — não é possível confirmar apenas pelo código se alguma já foi ativada em produção.

## Ferramentas do agente (30, em `src/tools/`)

Presentes no código; funcionamento real em produção não verificado nesta reconstrução.

- **Marketing/conteúdo**: `metaAdsTool`, `tiktokProductHunter`, `tiktokShopTool`, `viralTrendSearch`, `promptSellTool` (parece ser a base do sistema "PROMPT SELL MASTER" referenciado para o @sodre.luxe), `copyGeneratorTool`, `sportsDataTool`.
- **Infraestrutura/deploy**: `vercelTool`, `supabaseTool`, `dockerDeployTool`, `disasterRecoveryTool`, `remoteExecutionTool`, `terminalExecutor`, `qaEngineerTool`, `localCodeRagTool`, `logReader`.
- **Rede doméstica/PCs** (os "13 PCs" citados no `.env.example`): `networkScanTool`, `networkOrchestratorTool`, `networkPing`, `wakeOnLan`, `windowsRemoteTool`, `windowsCleanupTool`, `gamingOptimizerTool`, `intelbrasManagerTool`, `smartIoTTool`, `satelliteDeviceControlTool`, `tailscaleManagerTool`, `infraMonitorTool`, `serverStatus`, `systemStatus`.
- **Streaming**: `vMixControl`.

## Segurança

- `guardExecution` — exige confirmação (`REQUIRE_CONFIRM=true` por padrão) antes de tools destrutivas.
- `killSwitch`, `confirmationBroker`, `sessionContext` — implementados em `src/security/`.

## Camada de automação MCP + Agent SDK (12/09/2026)

### Premissa do plano original que não se confirmou

O plano assumia que o servidor MCP seria "uma casca fina sobre a API HTTP que o jarvis_backend já expõe". **Essa API não existia.** O backend tinha 4 rotas (`/auth/token` e três de satélite), nenhuma ligada a WhatsApp, rede, memória ou negócio, e nenhuma rota Express validava JWT. Também não existia catálogo de comandos remotos: o sistema aceitava comando shell arbitrário em máquina remota. As duas coisas tiveram de ser construídas antes de o servidor MCP fazer sentido.

### Concluído e testado

- **API HTTP `/api/v1` no cérebro** (`src/api/`) — autenticação JWT, status das clínicas, catálogo e execução de comandos remotos, status de integrações, busca na memória, leitura de kill switch e histórico de WhatsApp.
- **Ponte de processo para o WhatsApp** (`src/bot/whatsappBridge.js`) — Express escutando só em loopback dentro do processo `jarvis-whatsapp`, porque o client do whatsapp-web.js é singleton daquele processo. Importá-lo do `server.js` abriria uma segunda sessão disputando a mesma pasta `LocalAuth` e duplicaria os crons proativos.
- **Catálogo fechado de comandos remotos** (`src/api/remoteCommandCatalog.js`) — 9 comandos de string fixa, 5 de leitura e 4 destrutivos.
- **Servidor MCP `mcp-jarvis-core`** — 8 ferramentas, autenticação PIN→JWT com refresh em 401, timeout de 130s nas chamadas que podem aguardar a confirmação humana de 120s.
- **Hook PreToolUse** (`claude-automation/hooks/`) — política pura separada do adaptador de stdin, para o supervisor Python reusar a mesma regra por subprocesso em vez de duplicá-la.
- **Supervisor** (`claude-automation/supervisor/`) — três subagentes com ferramentas disjuntas por domínio, teto de turnos e teto de custo.
- **Plugin instalável** — `.claude-plugin/plugin.json` na raiz do repositório, empacotando servidor MCP, hook e três comandos de teste.

**47 testes automatizados passando**, nenhum com efeito real: 12 do hook, 9 de integração MCP sobre stdio contra backend simulado, 15 de invariantes do backend, 11 do supervisor.

### Correções de comportamento embutidas

- O casamento dos PCs monitorados agora também compara IP do Tailscale. Antes, comparava só hostname, então uma máquina configurada como `nome:100.x.x.x` aparecia como offline mesmo ligada.
- O parser de `MONITORED_WINDOWS_PCS` deixou de truncar host com porta ou IPv6.

### Pendente de credencial ou de confirmação humana

- **Login do CLI do Agent SDK**: o supervisor não conseguiu rodar as três perguntas de teste ao vivo (`Not logged in`). A lógica do hook foi verificada sem depender disso.
- **`WHATSAPP_BRIDGE_TOKEN`, `WINDOWS_REMOTE_USERNAME`, `WINDOWS_REMOTE_PASSWORD`**: não existem no `.env.example`. Sem eles, envio de WhatsApp e execução remota respondem erro explícito em vez de falhar em silêncio.
- **Nenhum envio real de WhatsApp nem comando remoto real foi executado** — aguardam confirmação explícita.

## Pendências / o que não dá pra confirmar só lendo o código

- Quais das 30 tools já foram efetivamente testadas/usadas em produção vs. só implementadas.
- Se alguma automação proativa (briefing/monitor/followup/weekly) já foi ativada em algum ambiente.
- Status real da integração com os 13 PCs monitorados (`MONITORED_WINDOWS_PCS`) — depende de configuração de ambiente não visível no repositório.
- Confirmar com Márcio se a "migração WhatsApp" mencionada anteriormente já está de fato concluída (o código sugere que sim) ou se há algo pendente que não aparece no código.
