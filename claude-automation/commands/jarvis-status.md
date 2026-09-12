---
description: Checagem proativa do JARVIS — máquinas das clínicas e integrações de negócio, somente leitura
---

Faça uma checagem proativa do JARVIS e apenas relate, sem corrigir nada.

1. Use `network_clinic_status` para listar o estado de todas as máquinas das clínicas. Se a resposta trouxer `tailscaleError`, não afirme que as clínicas caíram — relate que a leitura do Tailscale falhou e diga o motivo.
2. Use `business_tool_status` para cada integração: `meta_ads`, `vercel`, `supabase`, `prompt_sell_tool` e `tiktok_shop_tool`. Ao reportar, deixe explícito que a checagem prova apenas a presença da variável de ambiente, não que a credencial é válida.
3. Use `whatsapp_status` para dizer se a sessão do WhatsApp está pronta.

Entregue um resumo curto em português, separando o que está no ar, o que está sem credencial e o que não pôde ser verificado. Não tome nenhuma ação corretiva.
