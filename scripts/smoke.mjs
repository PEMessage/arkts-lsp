#!/usr/bin/env node
/*
 * End-to-end smoke test for the arkts-lsp server.
 *
 * Spawns the LSP server over stdio and exercises the handshake that a real
 * editor performs, printing what came back:
 *
 *   initialize -> initialized -> didOpen -> documentSymbol
 *              -> workspace/symbol -> hover
 *
 * Usage:
 *   node scripts/smoke.mjs [--project DIR] [--file FILE.ets]
 *                          [--line N] [--char N]
 *                          [--command "arkts-lsp"] [--timeout MS]
 *
 * Exit code 0 when initialize + documentSymbol succeed.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const opts = { command: 'arkts-lsp', project: process.cwd(), file: null, line: 0, char: 0, timeout: 30000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--project') opts.project = path.resolve(val());
    else if (a === '--file') opts.file = path.resolve(val());
    else if (a === '--line') opts.line = Number(val());
    else if (a === '--char') opts.char = Number(val());
    else if (a === '--command') opts.command = val();
    else if (a === '--timeout') opts.timeout = Number(val());
    else if (a === '-h' || a === '--help') {
      process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*/, ''));
      process.exit(0);
    } else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function findFirstEts(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (['node_modules', 'oh_modules', '.git', 'build', 'dist', '.hvigor'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.ets')) return p;
    }
  }
  return null;
}

class Client {
  constructor(child) {
    this.child = child;
    this.buf = Buffer.alloc(0);
    this.id = 1;
    this.pending = new Map();
    this.notifications = [];
    child.stdout.on('data', (chunk) => this.onData(chunk));
  }
  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const sep = this.buf.indexOf('\r\n\r\n');
      if (sep === -1) break;
      const m = this.buf.subarray(0, sep).toString('ascii').match(/Content-Length:\s*(\d+)/i);
      if (!m) { this.buf = this.buf.subarray(sep + 4); continue; }
      const len = Number(m[1]);
      if (this.buf.length < sep + 4 + len) break;
      const body = this.buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
      this.buf = this.buf.subarray(sep + 4 + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
      } else {
        this.notifications.push(msg);
      }
    }
  }
  send(msg) {
    const json = JSON.stringify(msg);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }
  request(method, params, timeout) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(path.join(opts.project, 'build-profile.json5'))) {
    process.stderr.write(`error: no build-profile.json5 in ${opts.project} (pass --project)\n`);
    process.exit(2);
  }
  const file = opts.file ?? findFirstEts(opts.project);
  if (!file || !fs.existsSync(file)) {
    process.stderr.write('error: no .ets file found; pass --file\n');
    process.exit(2);
  }

  const uri = `file://${file}`;
  const rootUri = `file://${opts.project}`;
  const text = fs.readFileSync(file, 'utf8');

  process.stdout.write(`project : ${opts.project}\nfile    : ${file}\ncommand : ${opts.command}\n\n`);

  const child = spawn(opts.command, { shell: true, cwd: opts.project, stdio: ['pipe', 'pipe', 'inherit'] });
  const client = new Client(child);
  let failed = false;

  try {
    const init = await client.request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(opts.project) }],
      capabilities: { textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] }, documentSymbol: {} } },
    }, opts.timeout);
    process.stdout.write(`initialize        OK   capabilities: ${Object.keys(init.capabilities ?? {}).join(', ')}\n`);

    client.notify('initialized', {});
    client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'deveco.apptool.ets', version: 1, text },
    });

    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, opts.timeout);
    process.stdout.write(`documentSymbol    OK   ${Array.isArray(symbols) ? symbols.length : 0} symbol(s)\n`);

    const workspace = await client.request('workspace/symbol', { query: '' }, opts.timeout);
    process.stdout.write(`workspace/symbol  OK   ${Array.isArray(workspace) ? workspace.length : 0} result(s) (empty query is expected to be 0)\n`);

    try {
      const hover = await client.request('textDocument/hover', {
        textDocument: { uri },
        position: { line: opts.line, character: opts.char },
      }, opts.timeout);
      const contents = hover?.contents;
      const value = typeof contents === 'string' ? contents : contents?.value;
      process.stdout.write(`hover             ${value ? 'OK' : 'no result'}\n`);
      if (value) process.stdout.write(`\n--- hover ---\n${value}\n-------------\n`);
    } catch (error) {
      process.stdout.write(`hover             ERROR ${String(error.message)}\n`);
    }

    const diags = client.notifications.filter((n) => n.method === 'textDocument/publishDiagnostics');
    process.stdout.write(`diagnostics       ${diags.length} publishDiagnostics notification(s)\n`);
  } catch (error) {
    failed = true;
    process.stdout.write(`\nSMOKE TEST FAILED: ${String(error.message)}\n`);
  } finally {
    try { await client.request('shutdown', null, 3000); } catch { /* ignore */ }
    client.notify('exit', null);
    child.kill();
  }

  process.stdout.write(`\n${failed ? 'FAIL' : 'PASS'}\n`);
  process.exit(failed ? 1 : 0);
}

main();
