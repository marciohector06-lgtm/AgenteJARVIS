import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateToolCall, evaluateHookInput, normalizeToolName } from '../guard-policy.mjs';

const hookScriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'guard-state-changing-tools.mjs');

function runHookScript(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(typeof payload === 'string' ? payload : JSON.stringify(payload));
    child.stdin.end();
  });
}

test('normalizeToolName extrai o nome puro de uma ferramenta MCP prefixada', () => {
  assert.equal(normalizeToolName('mcp__jarvis-core__whatsapp_send_message'), 'whatsapp_send_message');
  assert.equal(normalizeToolName('whatsapp_send_message'), 'whatsapp_send_message');
  assert.equal(normalizeToolName(''), '');
  assert.equal(normalizeToolName(undefined), '');
});

test('whatsapp_send_message sem confirmed e bloqueado', () => {
  const decision = evaluateToolCall({
    toolName: 'mcp__jarvis-core__whatsapp_send_message',
    toolInput: { to: '5561999999999', message: 'oi' },
  });
  assert.equal(decision.permissionDecision, 'deny');
  assert.match(decision.permissionDecisionReason, /confirmed=true/);
});

test('whatsapp_send_message com confirmed=true e liberado', () => {
  const decision = evaluateToolCall({
    toolName: 'mcp__jarvis-core__whatsapp_send_message',
    toolInput: { to: '5561999999999', message: 'oi', confirmed: true },
  });
  assert.equal(decision.permissionDecision, 'allow');
});

test('confirmed com valor que nao e booleano true nao libera', () => {
  for (const valorSuspeito of ['true', 1, 'sim', {}, [], null]) {
    const decision = evaluateToolCall({
      toolName: 'whatsapp_send_message',
      toolInput: { to: '5561999999999', message: 'oi', confirmed: valorSuspeito },
    });
    assert.equal(decision.permissionDecision, 'deny', `confirmed=${JSON.stringify(valorSuspeito)} nao deveria liberar`);
  }
});

test('network_run_remote_command e trigger_deploy sao bloqueados sem confirmed', () => {
  assert.equal(
    evaluateToolCall({ toolName: 'network_run_remote_command', toolInput: { clinic: 'clinica1', command_id: 'restart_print_spooler' } })
      .permissionDecision,
    'deny'
  );
  assert.equal(
    evaluateToolCall({ toolName: 'trigger_deploy', toolInput: { repo_url: 'x', project_name: 'y' } }).permissionDecision,
    'deny'
  );
});

test('ferramentas somente leitura passam sem atrito', () => {
  const readOnlyCalls = [
    { toolName: 'mcp__jarvis-core__memory_search', toolInput: { query: 'orcamento' } },
    { toolName: 'mcp__jarvis-core__network_clinic_status', toolInput: {} },
    { toolName: 'mcp__jarvis-core__business_tool_status', toolInput: { tool: 'vercel' } },
    { toolName: 'mcp__jarvis-core__whatsapp_recent_messages', toolInput: { limit: 5 } },
    { toolName: 'Read', toolInput: { file_path: '/tmp/x' } },
  ];
  for (const call of readOnlyCalls) {
    assert.equal(evaluateToolCall(call).permissionDecision, 'allow', `${call.toolName} deveria passar`);
  }
});

test('comandos de producao no Bash sao bloqueados', () => {
  const comandosBloqueados = [
    'vercel --prod',
    'vercel deploy --prod --yes',
    'railway up',
    'railway deploy',
    'npx prisma migrate deploy',
    'npx prisma migrate reset --force',
    'supabase db push',
    'git push --force origin main',
    'git push -f origin main',
    'pm2 restart jarvis-whatsapp',
    'tailscale ssh consultorio1 -- shutdown /r',
    'docker compose -f docker-compose.prod.yml up -d',
  ];
  for (const command of comandosBloqueados) {
    const decision = evaluateToolCall({ toolName: 'Bash', toolInput: { command } });
    assert.equal(decision.permissionDecision, 'deny', `deveria bloquear: ${command}`);
  }
});

test('comandos cotidianos no Bash nao sao bloqueados', () => {
  const comandosLiberados = [
    'npm run build',
    'npm test',
    'git status',
    'git push origin feature/nova-rota',
    'npx prisma migrate dev --name init',
    'docker compose up -d',
    'ls -la',
  ];
  for (const command of comandosLiberados) {
    const decision = evaluateToolCall({ toolName: 'Bash', toolInput: { command } });
    assert.equal(decision.permissionDecision, 'allow', `nao deveria bloquear: ${command}`);
  }
});

test('entrada invalida cai em ask em vez de liberar silenciosamente', () => {
  assert.equal(evaluateHookInput(null).permissionDecision, 'ask');
  assert.equal(evaluateHookInput('lixo').permissionDecision, 'ask');
});

test('ponta a ponta: o script do hook bloqueia de verdade via stdin', async () => {
  const { code, stdout } = await runHookScript({
    session_id: 'teste',
    transcript_path: '/tmp/t',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__jarvis-core__whatsapp_send_message',
    tool_input: { to: '5561999999999', message: 'mensagem que nao pode sair' },
    tool_use_id: 'toolu_teste',
  });
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
});

test('ponta a ponta: o script do hook libera leitura via stdin', async () => {
  const { code, stdout } = await runHookScript({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__jarvis-core__network_clinic_status',
    tool_input: {},
    tool_use_id: 'toolu_teste2',
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'allow');
});

test('ponta a ponta: stdin corrompido nao libera a ferramenta', async () => {
  const { code, stdout } = await runHookScript('{isso nao e json');
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'ask');
});
