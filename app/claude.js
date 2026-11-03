import { spawn } from 'node:child_process';
import { t } from './i18n.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { buildCommentaryInstructions } from './prompts.js';
import { getModel } from './models.js';

export function subscriptionEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^ANTHROPIC_/i.test(key) || /^CLAUDE_CODE_(OAUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY|API_KEY_HELPER|SIMPLE)$/i.test(key)) delete env[key];
  }
  // Authentication comes from the user's existing Claude login, never an API key.
  return env;
}

export function executable() {
  if (process.env.CLAUDE_EXECUTABLE) return process.env.CLAUDE_EXECUTABLE;
  const local = path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(local) ? local : 'claude';
}

export function runCli(args, { input = '', signal, timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable(), args, { env: subscriptionEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errorOutput = '', failure;
    const stop = message => { failure = new Error(message); child.kill(); };
    const timer = setTimeout(() => stop(t('claudeTimeout')), timeoutMs);
    const abort = () => stop(t('generationAborted'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', error => { failure = error; });
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) stop(t('claudeTooLong')); });
    child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(-4000); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error(t('claudeFailed'))); return; }
      try { resolve(JSON.parse(output)); }
      catch { reject(new Error(t('claudeUnreadable'))); }
    });
  });
}

const restricted = ['--restricted', '--setting-sources', ''];

export async function checkAuthentication() {
  const auth = await runCli([...restricted, 'auth', 'status'], { timeoutMs: 10000 });
  return validateSubscription(auth);
}

export function validateSubscription(auth) {
  if (!auth.loggedIn || auth.authMethod !== 'claude.ai' || auth.apiProvider !== 'firstParty' || !['pro', 'max', 'ultra', 'team', 'enterprise'].includes(auth.subscriptionType)) {
    throw new Error(t('loginRequired'));
  }
  return { loggedIn: true, plan: auth.subscriptionType };
}

export function parseComment(response) {
  if (response.is_error || response.subtype && response.subtype !== 'success') {
    throw new Error(t('claudeIncomplete'));
  }
  let value = response.structured_output;
  if (!value && typeof response.result === 'string') {
    try { value = JSON.parse(response.result); } catch { /* rejected below */ }
  }
  if (!value || typeof value.speak !== 'boolean' || typeof value.comment !== 'string') throw new Error(t('badCaptionFormat'));
  const text = value.comment.trim();
  if (text.length > 180 || text.includes('\n')) throw new Error(t('captionTooLong'));
  if (value.speak && !text) throw new Error(t('captionEmpty'));
  return { speak: value.speak, comment: text };
}

export function parseModelComment(result, model) {
  const selectedModel = getModel(model);
  const resolvedModels = Object.keys(result.modelUsage ?? {});
  if (!resolvedModels.some(name => name.startsWith(`claude-${selectedModel.cliName}-`))) {
    throw new Error(t('modelNotConfirmed', { label: selectedModel.label }));
  }
  return { ...parseComment(result), model, resolvedModels };
}

let lastAuthCheck = 0;

export async function generateComment(payload, { signal, model = 'sonnet', instructions = buildCommentaryInstructions() } = {}) {
  const selectedModel = getModel(model);
  // The watcher authenticates at start; re-verify only occasionally to avoid an extra CLI launch per comment.
  if (Date.now() - lastAuthCheck > 10 * 60_000) { await checkAuthentication(); lastAuthCheck = Date.now(); }
  if (signal?.aborted) throw new Error(t('generationAborted'));
  const schema = { type: 'object', properties: { speak: { type: 'boolean' }, comment: { type: 'string', maxLength: 180 } }, required: ['speak', 'comment'], additionalProperties: false };
  const result = await runCli([
    ...restricted, '-p', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands', '--no-chrome', '--no-session-persistence',
    '--model', selectedModel.cliName, '--effort', selectedModel.effort, '--output-format', 'json',
    '--json-schema', JSON.stringify(schema), '--system-prompt', instructions,
  ], { input: JSON.stringify(payload), signal });
  return parseModelComment(result, model);
}
