import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import jarvis_supervisor as supervisor


class ConfiguracaoDoSupervisor(unittest.TestCase):
    def test_servidor_mcp_aponta_para_o_build_compilado(self):
        servidores = supervisor.build_mcp_servers()
        self.assertIn("jarvis-core", servidores)
        jarvis = servidores["jarvis-core"]
        self.assertEqual(jarvis["type"], "stdio")
        self.assertTrue(jarvis["args"][0].endswith("dist\\index.js") or jarvis["args"][0].endswith("dist/index.js"))
        self.assertIn("JARVIS_API_URL", jarvis["env"])

    def test_cada_subagente_recebe_apenas_as_ferramentas_do_seu_dominio(self):
        agentes = supervisor.build_agents()
        self.assertEqual(set(agentes), {"whatsapp_agent", "network_agent", "business_agent"})

        for nome, agente in agentes.items():
            self.assertTrue(agente.tools, f"{nome} deveria ter ferramentas explicitas")
            self.assertEqual(agente.mcpServers, ["jarvis-core"])
            for ferramenta in agente.tools:
                self.assertTrue(ferramenta.startswith("mcp__jarvis-core__"), ferramenta)

        whatsapp = set(agentes["whatsapp_agent"].tools)
        rede = set(agentes["network_agent"].tools)
        negocio = set(agentes["business_agent"].tools)
        self.assertEqual(whatsapp & rede, set())
        self.assertEqual(rede & negocio, set())
        self.assertEqual(whatsapp & negocio, set())

    def test_agente_de_rede_nao_alcanca_envio_de_whatsapp(self):
        agentes = supervisor.build_agents()
        self.assertNotIn("mcp__jarvis-core__whatsapp_send_message", agentes["network_agent"].tools)
        self.assertNotIn("mcp__jarvis-core__network_run_remote_command", agentes["whatsapp_agent"].tools)

    def test_opcoes_tem_hook_teto_de_turnos_e_teto_de_custo(self):
        opcoes = supervisor.build_options()
        self.assertIn("PreToolUse", opcoes.hooks)
        self.assertEqual(opcoes.hooks["PreToolUse"][0].hooks[0], supervisor.guard_state_changing_tools)
        self.assertGreater(opcoes.max_turns, 0)
        self.assertGreater(opcoes.max_budget_usd, 0)
        self.assertLessEqual(opcoes.max_budget_usd, 5)

    def test_supervisor_nao_pode_usar_ferramentas_de_sistema(self):
        opcoes = supervisor.build_options()
        for proibida in ["Bash", "Write", "Edit"]:
            self.assertIn(proibida, opcoes.disallowed_tools)


class GuardDoSupervisor(unittest.IsolatedAsyncioTestCase):
    async def avaliar(self, tool_name, tool_input):
        return await supervisor.guard_state_changing_tools(
            {"tool_name": tool_name, "tool_input": tool_input}, "toolu_teste", None
        )

    def decisao(self, resposta):
        return resposta["hookSpecificOutput"]["permissionDecision"]

    async def test_envio_de_whatsapp_sem_confirmacao_e_negado(self):
        resposta = await self.avaliar(
            "mcp__jarvis-core__whatsapp_send_message", {"to": "5561999999999", "message": "oi"}
        )
        self.assertEqual(self.decisao(resposta), "deny")
        self.assertIn("confirmed=true", resposta["hookSpecificOutput"]["permissionDecisionReason"])

    async def test_envio_de_whatsapp_com_confirmacao_e_liberado(self):
        resposta = await self.avaliar(
            "mcp__jarvis-core__whatsapp_send_message", {"to": "5561999999999", "message": "oi", "confirmed": True}
        )
        self.assertEqual(self.decisao(resposta), "allow")

    async def test_comando_remoto_sem_confirmacao_e_negado(self):
        resposta = await self.avaliar(
            "mcp__jarvis-core__network_run_remote_command",
            {"clinic": "consultorio1", "command_id": "restart_print_spooler"},
        )
        self.assertEqual(self.decisao(resposta), "deny")

    async def test_leitura_passa_sem_atrito(self):
        resposta = await self.avaliar("mcp__jarvis-core__network_clinic_status", {})
        self.assertEqual(self.decisao(resposta), "allow")

    async def test_comando_de_producao_no_bash_e_negado(self):
        resposta = await self.avaliar("Bash", {"command": "vercel --prod"})
        self.assertEqual(self.decisao(resposta), "deny")

    async def test_decisoes_ficam_registradas_para_auditoria(self):
        antes = len(supervisor.HOOK_DECISIONS)
        await self.avaliar("mcp__jarvis-core__whatsapp_send_message", {"to": "5561999999999", "message": "oi"})
        self.assertEqual(len(supervisor.HOOK_DECISIONS), antes + 1)
        self.assertEqual(supervisor.HOOK_DECISIONS[-1]["permissionDecision"], "deny")


if __name__ == "__main__":
    unittest.main(verbosity=2)
