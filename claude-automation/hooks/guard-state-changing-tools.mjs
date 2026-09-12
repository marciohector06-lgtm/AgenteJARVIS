#!/usr/bin/env node
import { evaluateHookInput, buildHookOutput } from './guard-policy.mjs';

const STDIN_READ_TIMEOUT_MS = 5000;

function readStdinUntilClosed() {
  return new Promise((resolve) => {
    let buffer = '';
    let alreadyResolved = false;
    const resolveOnce = () => {
      if (alreadyResolved) return;
      alreadyResolved = true;
      resolve(buffer);
    };
    const timer = setTimeout(resolveOnce, STDIN_READ_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolveOnce();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolveOnce();
    });
  });
}

const rawInput = await readStdinUntilClosed();

let decision;
try {
  decision = evaluateHookInput(JSON.parse(rawInput));
} catch {
  decision = {
    permissionDecision: 'ask',
    permissionDecisionReason:
      'Guard do JARVIS recebeu uma entrada de hook que nao e JSON valido. Decisao entregue ao humano por seguranca.',
  };
}

process.stdout.write(JSON.stringify(buildHookOutput(decision)));
process.exit(0);
