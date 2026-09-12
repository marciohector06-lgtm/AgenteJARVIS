export const STATE_CHANGING_TOOLS = new Map([
  ['whatsapp_send_message', 'envia uma mensagem real de WhatsApp para uma pessoa'],
  ['network_run_remote_command', 'executa um comando em uma maquina de clinica real'],
  ['trigger_deploy', 'cria recursos de nuvem reais e publica em producao'],
]);

export const PRODUCTION_COMMAND_PATTERNS = [
  { pattern: /\bvercel\b[^\n]*--prod\b/, reason: 'deploy de producao na Vercel' },
  { pattern: /\brailway\s+(?:up|deploy|redeploy)\b/, reason: 'deploy de producao na Railway' },
  { pattern: /\bprisma\s+migrate\s+(?:deploy|reset)\b/, reason: 'migration contra banco de producao' },
  { pattern: /\bsupabase\s+db\s+(?:push|reset)\b/, reason: 'alteracao de schema no Supabase remoto' },
  { pattern: /\bgit\s+push\b[^\n]*(?:--force|--force-with-lease|(?:^|\s)-f(?:\s|$))/, reason: 'reescrita de historico no repositorio remoto' },
  { pattern: /\bpm2\s+(?:restart|stop|delete|kill)\b/, reason: 'derruba ou reinicia um processo em execucao' },
  { pattern: /\btailscale\b[^\n]*\bssh\b/, reason: 'execucao remota em maquina da rede via Tailscale' },
  { pattern: /\bssh\b[^\n]*\b(?:shutdown|reboot|restart-service|Restart-Computer)\b/, reason: 'reinicializacao de maquina remota' },
  { pattern: /\bdocker\b[^\n]*\bcompose\b[^\n]*-f\s+\S*prod/, reason: 'stack docker de producao' },
];

const COMMAND_CARRYING_TOOLS = new Set(['Bash', 'PowerShell']);

const ALLOW = { permissionDecision: 'allow', permissionDecisionReason: '' };

export function normalizeToolName(rawToolName) {
  if (typeof rawToolName !== 'string' || rawToolName.length === 0) return '';
  const segments = rawToolName.split('__');
  return segments[segments.length - 1] ?? '';
}

export function evaluateToolCall({ toolName, toolInput }) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const bareName = normalizeToolName(toolName);

  const stateChangingReason = STATE_CHANGING_TOOLS.get(bareName);
  if (stateChangingReason) {
    if (input.confirmed === true) {
      return {
        permissionDecision: 'allow',
        permissionDecisionReason: `'${bareName}' liberada: confirmed=true presente nos argumentos.`,
      };
    }
    return {
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Bloqueado pelo guard do JARVIS: '${bareName}' ${stateChangingReason}. ` +
        'Apresente ao usuario exatamente o que sera feito, obtenha aprovacao explicita em linguagem natural, ' +
        'e so entao chame de novo incluindo confirmed=true nos argumentos.',
    };
  }

  if (COMMAND_CARRYING_TOOLS.has(toolName)) {
    const command = typeof input.command === 'string' ? input.command : '';
    for (const { pattern, reason } of PRODUCTION_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        return {
          permissionDecision: 'deny',
          permissionDecisionReason:
            `Bloqueado pelo guard do JARVIS: o comando toca ambiente de producao (${reason}). ` +
            'Nao existe escape via argumento aqui: relate o comando exato ao usuario e deixe que ele execute, ' +
            'ou peca que ele remova este bloqueio conscientemente.',
        };
      }
    }
  }

  return ALLOW;
}

export function buildHookOutput(decision) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.permissionDecision,
      permissionDecisionReason: decision.permissionDecisionReason,
    },
  };
}

export function evaluateHookInput(hookInput) {
  if (!hookInput || typeof hookInput !== 'object') {
    return {
      permissionDecision: 'ask',
      permissionDecisionReason:
        'Guard do JARVIS nao conseguiu interpretar a entrada do hook. Decisao entregue ao humano por seguranca.',
    };
  }
  return evaluateToolCall({ toolName: hookInput.tool_name, toolInput: hookInput.tool_input });
}
