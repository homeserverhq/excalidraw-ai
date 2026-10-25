#!/usr/bin/env node

// Fork-only wire checks for DISABLED_TOOLS. Drives dist/index.js over stdio
// with and without the env var and asserts which tools are advertised. This
// file is additive; upstream's own wire checks are untouched.

import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'index.js');
const runtime = process.env.MCP_RUNTIME || process.execPath;
const runtimeName = basename(runtime).toLowerCase();
const runtimeArgs = runtimeName.includes('bun') ? ['run', serverPath] : [serverPath];

const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSION = '2025-06-18';
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const RESPONSE_TIMEOUT_MS = 20000;
const DISABLED = 'get_canvas_screenshot';

function envelope() {
  return {
    [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION,
    [CLIENT_CAPABILITIES_META_KEY]: {},
    [CLIENT_INFO_META_KEY]: { name: 'disabled-tools-test', version: '0.0.0' }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Runs one stdio connection and resolves once `expected` responses arrive. */
function exchange(messages, expected, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, runtimeArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ENABLE_CANVAS_SYNC: 'false',
        EXCALIDRAW_NO_AUTOSTART: '1',
        LOG_LEVEL: 'error',
        ...extraEnv
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const responses = [];
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      if (error) reject(error);
      else resolve({ responses, stderr });
    };

    const timer = setTimeout(() => {
      finish(new Error(
        `Timed out waiting for ${expected} response(s); got ${responses.length}.` +
        `${stderr ? `\nstderr:\n${stderr}` : ''}`
      ));
    }, RESPONSE_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch {
          finish(new Error(`Non-JSON line on stdout: ${line}`));
          return;
        }
      }
      if (responses.length >= expected) finish();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => finish(error));
    child.on('exit', code => {
      if (responses.length >= expected) finish();
      else finish(new Error(
        `Server exited with code ${code} before answering.${stderr ? `\nstderr:\n${stderr}` : ''}`
      ));
    });

    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  });
}

function resultOf(response, label) {
  assert(response !== undefined, `${label}: no response`);
  assert(response.error === undefined, `${label}: unexpected error ${JSON.stringify(response.error)}`);
  assert(response.result !== undefined, `${label}: response carried no result`);
  return response.result;
}

function toolNames(result) {
  assert(Array.isArray(result.tools), 'tools/list: expected a tools array');
  return result.tools.map(tool => tool.name);
}

async function legacyToolNames(extraEnv) {
  const { responses } = await exchange([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LEGACY_VERSION,
        capabilities: {},
        clientInfo: { name: 'disabled-tools-test', version: '0.0.0' }
      }
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
  ], 2, extraEnv);
  return toolNames(resultOf(responses.find(response => response.id === 2), 'legacy tools/list'));
}

async function modernToolNames(extraEnv) {
  const { responses } = await exchange([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: envelope() } }
  ], 1, extraEnv);
  return toolNames(resultOf(responses[0], 'modern tools/list'));
}

/** Returns the JSON-RPC error (if any) for a direct tools/call. */
async function legacyCallError(name, extraEnv) {
  const { responses } = await exchange([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LEGACY_VERSION,
        capabilities: {},
        clientInfo: { name: 'disabled-tools-test', version: '0.0.0' }
      }
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } }
  ], 2, extraEnv);
  const response = responses.find(candidate => candidate.id === 2);
  assert(response !== undefined, 'legacy tools/call: no response');
  return response.error;
}

async function main() {
  const checks = [];

  const defaultLegacy = await legacyToolNames({});
  checks.push(['default: get_canvas_screenshot is advertised', defaultLegacy.includes(DISABLED)]);
  checks.push(['default: unrelated tool is advertised', defaultLegacy.includes('read_diagram_guide')]);

  const disabledLegacy = await legacyToolNames({ DISABLED_TOOLS: DISABLED });
  checks.push(['disabled: get_canvas_screenshot is hidden (legacy)', !disabledLegacy.includes(DISABLED)]);
  checks.push(['disabled: unrelated tool remains (legacy)', disabledLegacy.includes('read_diagram_guide')]);

  const disabledModern = await modernToolNames({ DISABLED_TOOLS: DISABLED });
  checks.push(['disabled: get_canvas_screenshot is hidden (modern)', !disabledModern.includes(DISABLED)]);
  checks.push(['disabled: unrelated tool remains (modern)', disabledModern.includes('read_diagram_guide')]);

  const multiple = await legacyToolNames({ DISABLED_TOOLS: ` ${DISABLED} , export_to_image ` });
  checks.push(['multiple + whitespace: get_canvas_screenshot hidden', !multiple.includes(DISABLED)]);
  checks.push(['multiple + whitespace: export_to_image hidden', !multiple.includes('export_to_image')]);
  checks.push(['multiple + whitespace: unrelated tool remains', multiple.includes('read_diagram_guide')]);

  const empty = await legacyToolNames({ DISABLED_TOOLS: '' });
  checks.push(['empty DISABLED_TOOLS: all tools advertised', empty.includes(DISABLED)]);

  const callError = await legacyCallError(DISABLED, { DISABLED_TOOLS: DISABLED });
  checks.push([
    'disabled: direct tools/call is refused',
    callError !== undefined && /not found|disabled/i.test(callError.message)
  ]);

  const unknown = await legacyToolNames({ DISABLED_TOOLS: 'not_a_real_tool' });
  checks.push(['unknown DISABLED_TOOLS name does not hide tools', unknown.includes(DISABLED)]);

  let failed = 0;
  for (const [label, ok] of checks) {
    if (ok) console.log(`ok   ${label}`);
    else {
      failed++;
      console.error(`FAIL ${label}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} disabled-tools check(s) failed`);
    process.exit(1);
  }

  console.log('\nAll disabled-tools checks passed');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
