---
description: Prova que o hook de segurança bloqueia de verdade uma ação irreversível do JARVIS
---

Verifique, na prática, que o guard do JARVIS bloqueia ações irreversíveis. Rode os comandos abaixo e mostre a saída crua de cada um.

Deve ser NEGADO (envio real de WhatsApp sem confirmação):

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"mcp__jarvis-core__whatsapp_send_message","tool_input":{"to":"5561999999999","message":"teste"}}' | node claude-automation/hooks/guard-state-changing-tools.mjs
```

Deve ser NEGADO (comando que toca produção):

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"vercel --prod"}}' | node claude-automation/hooks/guard-state-changing-tools.mjs
```

Deve ser LIBERADO (consulta somente leitura):

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"mcp__jarvis-core__network_clinic_status","tool_input":{}}' | node claude-automation/hooks/guard-state-changing-tools.mjs
```

Confirme que os dois primeiros retornaram `"permissionDecision":"deny"` e o terceiro `"allow"`. Se algum resultado divergir disso, trate como falha de segurança e avise em destaque.
