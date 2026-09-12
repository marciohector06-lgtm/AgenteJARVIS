import asyncio
import json
import os
import shutil
from pathlib import Path

from claude_agent_sdk import (
    AgentDefinition,
    AssistantMessage,
    ClaudeAgentOptions,
    HookMatcher,
    ResultMessage,
    TextBlock,
    query,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MCP_SERVER_ENTRY = REPO_ROOT / "mcp-jarvis-core" / "dist" / "index.js"
GUARD_SCRIPT = REPO_ROOT / "claude-automation" / "hooks" / "guard-state-changing-tools.mjs"

SUPERVISOR_MODEL = "claude-sonnet-5"
MAX_TURNS = 12
MAX_BUDGET_USD = float(os.environ.get("JARVIS_SUPERVISOR_MAX_BUDGET_USD", "0.50"))

NODE_BINARY = os.environ.get("JARVIS_NODE_BINARY") or shutil.which("node") or "node"

WHATSAPP_TOOLS = [
    "mcp__jarvis-core__whatsapp_status",
    "mcp__jarvis-core__whatsapp_recent_messages",
    "mcp__jarvis-core__whatsapp_send_message",
]
NETWORK_TOOLS = [
    "mcp__jarvis-core__network_clinic_status",
    "mcp__jarvis-core__network_list_commands",
    "mcp__jarvis-core__network_run_remote_command",
]
BUSINESS_TOOLS = [
    "mcp__jarvis-core__business_tool_status",
    "mcp__jarvis-core__memory_search",
]
ALL_JARVIS_TOOLS = WHATSAPP_TOOLS + NETWORK_TOOLS + BUSINESS_TOOLS


def build_mcp_servers():
    server_env = {
        "JARVIS_API_URL": os.environ.get("JARVIS_API_URL", "http://127.0.0.1:4000"),
    }
    if os.environ.get("JARVIS_DEVICE_PIN"):
        server_env["JARVIS_DEVICE_PIN"] = os.environ["JARVIS_DEVICE_PIN"]
    if os.environ.get("JARVIS_API_TOKEN"):
        server_env["JARVIS_API_TOKEN"] = os.environ["JARVIS_API_TOKEN"]

    return {
        "jarvis-core": {
            "type": "stdio",
            "command": NODE_BINARY,
            "args": [str(MCP_SERVER_ENTRY)],
            "env": server_env,
        }
    }


def build_agents():
    return {
        "whatsapp_agent": AgentDefinition(
            description=(
                "Cuida de comunicação por WhatsApp: checar se a sessão está no ar, ler histórico de conversa "
                "e enviar mensagens. Use quando o pedido envolver contatos ou mensagens de WhatsApp."
            ),
            prompt=(
                "Você cuida do canal de WhatsApp do Márcio através do cérebro do JARVIS. "
                "Antes de qualquer envio, apresente ao usuário o destinatário e o texto exato e espere aprovação "
                "explícita: um hook de segurança bloqueia o envio até que você repita a chamada com confirmed=true. "
                "Nunca invente um número de destinatário. Ao ler histórico, deixe claro que é a conversa com o agente "
                "e não a caixa de entrada do WhatsApp."
            ),
            tools=WHATSAPP_TOOLS,
            mcpServers=["jarvis-core"],
            model=SUPERVISOR_MODEL,
        ),
        "network_agent": AgentDefinition(
            description=(
                "Cuida da rede das clínicas: status das máquinas Windows via Tailscale e manutenção remota "
                "com comandos do catálogo aprovado."
            ),
            prompt=(
                "Você monitora e mantém a rede das clínicas. Consultas de status são livres e não exigem confirmação. "
                "Para manutenção remota, liste primeiro o catálogo com network_list_commands e use apenas um "
                "command_id existente: comando shell livre não é aceito por design. Qualquer comando marcado como "
                "destrutivo exige que você diga qual clínica e qual comando e obtenha aprovação humana explícita "
                "antes de repetir a chamada com confirmed=true. Se a resposta trouxer tailscaleError, não afirme que "
                "as clínicas caíram: relate que a leitura do Tailscale falhou."
            ),
            tools=NETWORK_TOOLS,
            mcpServers=["jarvis-core"],
            model=SUPERVISOR_MODEL,
        ),
        "business_agent": AgentDefinition(
            description=(
                "Cuida das integrações de negócio: Meta Ads, Vercel, Supabase, promptSellTool e tiktokShopTool, "
                "além da memória de longo prazo do JARVIS."
            ),
            prompt=(
                "Você opera as integrações de negócio do Márcio. ABO manual é o padrão em campanhas: nunca sugira "
                "Advantage+ nem CBO a menos que seja pedido explicitamente, e nunca recomende recarga automática de "
                "pagamento em conta de anúncio. Ao reportar status de integração, seja preciso: a checagem prova "
                "apenas que a variável de ambiente existe, não que a credencial é válida nem que o serviço está no ar."
            ),
            tools=BUSINESS_TOOLS,
            mcpServers=["jarvis-core"],
            model=SUPERVISOR_MODEL,
        ),
    }


SUPERVISOR_SYSTEM_PROMPT = (
    "Você é o supervisor do JARVIS, assistente do Márcio — desenvolvedor, gestor de tráfego e empreendedor em "
    "Brasília, que opera pela H&M Engenharia. Encaminhe cada pedido ao especialista certo: whatsapp_agent para "
    "mensagens, network_agent para as máquinas das clínicas, business_agent para integrações de negócio e memória. "
    "Para pedidos ambíguos ou que cruzem domínios, coordene os subagentes você mesmo. "
    "Nunca tome uma ação irreversível sem aprovação humana explícita: isso é garantido por um hook que bloqueia a "
    "chamada, mas você também deve pedir em linguagem clara antes. "
    "Responda em português, de forma direta e sem enfeite."
)


HOOK_DECISIONS = []


def _record_decision(tool_name, decision):
    HOOK_DECISIONS.append(
        {
            "tool_name": tool_name,
            "permissionDecision": decision.get("hookSpecificOutput", {}).get("permissionDecision"),
            "permissionDecisionReason": decision.get("hookSpecificOutput", {}).get("permissionDecisionReason"),
        }
    )
    return decision


async def guard_state_changing_tools(input_data, tool_use_id, context):
    payload = json.dumps(
        {
            "hook_event_name": "PreToolUse",
            "tool_name": input_data.get("tool_name"),
            "tool_input": input_data.get("tool_input") or {},
            "tool_use_id": tool_use_id,
        }
    )

    process = await asyncio.create_subprocess_exec(
        NODE_BINARY,
        str(GUARD_SCRIPT),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await process.communicate(payload.encode("utf-8"))

    try:
        decision = json.loads(stdout.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        decision = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": (
                    "O guard do JARVIS não respondeu de forma legível. Decisão entregue ao humano por segurança."
                ),
            }
        }

    return _record_decision(input_data.get("tool_name"), decision)


def build_options():
    return ClaudeAgentOptions(
        model=SUPERVISOR_MODEL,
        system_prompt=SUPERVISOR_SYSTEM_PROMPT,
        mcp_servers=build_mcp_servers(),
        agents=build_agents(),
        hooks={"PreToolUse": [HookMatcher(hooks=[guard_state_changing_tools])]},
        allowed_tools=ALL_JARVIS_TOOLS + ["Task"],
        disallowed_tools=["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch"],
        permission_mode="bypassPermissions",
        max_turns=MAX_TURNS,
        max_budget_usd=MAX_BUDGET_USD,
        cwd=str(REPO_ROOT),
    )


async def ask_supervisor(prompt):
    texts = []
    final_result = None
    blocked_tools = []

    async for message in query(prompt=prompt, options=build_options()):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    texts.append(block.text)
        elif isinstance(message, ResultMessage):
            final_result = getattr(message, "result", None)

    return {
        "answer": final_result or "\n".join(texts).strip(),
        "streamed_text": texts,
        "blocked_tools": blocked_tools,
    }


PROACTIVE_CHECK_PROMPT = (
    "Faça uma checagem proativa e apenas relate, sem corrigir nada: status de todas as máquinas das clínicas na "
    "rede, e status de cada integração de negócio (meta_ads, vercel, supabase, prompt_sell_tool, tiktok_shop_tool). "
    "Aponte qualquer coisa offline ou sem credencial."
)


async def run_proactive_check():
    return await ask_supervisor(PROACTIVE_CHECK_PROMPT)


async def main():
    import sys

    if len(sys.argv) > 1:
        prompt = " ".join(sys.argv[1:])
        if prompt.strip() == "/proactive-check":
            outcome = await run_proactive_check()
        else:
            outcome = await ask_supervisor(prompt)
        print(outcome["answer"])
        return

    while True:
        try:
            prompt = input("jarvis> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if prompt.lower() in ("quit", "exit"):
            break
        if not prompt:
            continue
        outcome = await run_proactive_check() if prompt == "/proactive-check" else await ask_supervisor(prompt)
        print(outcome["answer"])


if __name__ == "__main__":
    asyncio.run(main())
