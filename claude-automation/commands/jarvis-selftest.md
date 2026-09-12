---
description: Roda todas as suítes de teste da camada de automação do JARVIS (hook, servidor MCP, API do cérebro, supervisor)
---

Rode as quatro suítes de teste da camada de automação e reporte o resultado consolidado. Nenhuma delas toca o mundo real: o servidor MCP é exercitado contra um backend simulado.

```bash
cd claude-automation/hooks && node --test tests/guard-policy.test.mjs
```

```bash
cd mcp-jarvis-core && npm run build && node --test tests/mcpServer.test.mjs
```

```bash
cd jarvis_backend && node --test tests/api.test.mjs
```

```bash
cd claude-automation/supervisor && python test_supervisor_offline.py
```

Ao final, diga quantos testes passaram em cada suíte e destaque qualquer falha com o nome do teste. Se alguma suíte falhar por dependência ausente em vez de defeito de código, diga isso explicitamente em vez de reportar como bug.
