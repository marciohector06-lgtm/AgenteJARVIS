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

## Pendências / o que não dá pra confirmar só lendo o código

- Quais das 30 tools já foram efetivamente testadas/usadas em produção vs. só implementadas.
- Se alguma automação proativa (briefing/monitor/followup/weekly) já foi ativada em algum ambiente.
- Status real da integração com os 13 PCs monitorados (`MONITORED_WINDOWS_PCS`) — depende de configuração de ambiente não visível no repositório.
- Confirmar com Márcio se a "migração WhatsApp" mencionada anteriormente já está de fato concluída (o código sugere que sim) ou se há algo pendente que não aparece no código.
