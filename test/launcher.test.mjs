import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const launcher = path.join(repoRoot, 'bin', 'arkts-lsp.mjs');

function makeBundle(tmp) {
  const out = path.join(tmp, 'bundle', 'plugins', 'openharmony', 'ace-server', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(here, 'fixtures', 'mock-ace-server.mjs'), path.join(out, 'index.js'));
  return path.join(tmp, 'bundle');
}

/** A minimal stand-in for the official command-line tools tree. */
function makeCli(tmp) {
  const cli = path.join(tmp, 'commandline-tools');
  fs.mkdirSync(path.join(cli, 'sdk', 'default'), { recursive: true });
  fs.writeFileSync(path.join(cli, 'sdk', 'default', 'sdk-pkg.json'), JSON.stringify({ data: { path: 'test' } }));

  const nodeBinDir = path.join(cli, 'tool', 'node', 'bin');
  fs.mkdirSync(nodeBinDir, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(nodeBinDir, 'node'));

  fs.mkdirSync(path.join(cli, 'hvigor', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(cli, 'hvigor', 'bin', 'hvigorw.js'), '// noop\n');
  return cli;
}

function makeProject(tmp) {
  const project = path.join(tmp, 'project');
  fs.mkdirSync(path.join(project, 'entry', 'src', 'main', 'ets', 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'build-profile.json5'),
    `{
  app: { products: [ { name: 'default', compatibleSdkVersion: '6.0.0(20)', compileSdkVersion: '6.0.0(20)' } ] },
  modules: [ { name: 'entry', srcPath: './entry' } ]
}`,
  );
  fs.writeFileSync(path.join(project, 'entry', 'module.json5'), `{ module: { name: 'entry', type: 'entry', deviceTypes: ['phone'] } }`);
  fs.writeFileSync(
    path.join(project, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'),
    `@Component
export struct Index {
  @State message: string = 'hi'
  build() {
  }
}

export function helper(): number {
  return 1
}
`,
  );
  return project;
}

class LspClient {
  constructor(child) {
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.id = 1;
    this.pending = new Map();
    child.stdout.on('data', (chunk) => this.onData(chunk));
  }
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const sep = this.buffer.indexOf('\r\n\r\n');
      if (sep === -1) break;
      const m = this.buffer.subarray(0, sep).toString('ascii').match(/Content-Length:\s*(\d+)/i);
      if (!m) { this.buffer = this.buffer.subarray(sep + 4); continue; }
      const len = Number(m[1]);
      if (this.buffer.length < sep + 4 + len) break;
      const body = this.buffer.subarray(sep + 4, sep + 4 + len).toString('utf8');
      this.buffer = this.buffer.subarray(sep + 4 + len);
      const msg = JSON.parse(body);
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        }
      }
    }
  }
  request(method, params) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`)); }, 15000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      const json = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
    });
  }
  notify(method, params) {
    const json = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }
}

function envFor(tmp) {
  return {
    ...process.env,
    ARKTS_ACE_SERVER_HOME: makeBundle(tmp),
    ARKTS_CLI_HOME: makeCli(tmp),
    ARKTS_LSP_DEV_HOME: path.join(tmp, 'dev-home'),
    ARKTS_LSP_SYNC: 'off',
    DEVECO_HOME: '',
    ARKTS_DEVECO_HOME: '',
  };
}

test('arkts-lsp composes upstream proxy + CLI tools + ace-server and serves LSP', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-lsp-launch-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const project = makeProject(tmp);
  const file = path.join(project, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
  const uri = `file://${file}`;
  const rootUri = `file://${project}`;

  const child = spawn(process.execPath, [launcher], {
    cwd: project,
    env: envFor(tmp),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  child.stderr.resume(); // drain logs
  const client = new LspClient(child);

  const init = await client.request('initialize', {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: 'project' }],
    capabilities: {},
  });
  assert.ok(init.capabilities, 'upstream proxy returned capabilities');

  client.notify('initialized', {});
  client.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'arkts', version: 1, text: fs.readFileSync(file, 'utf8') },
  });

  const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } });
  assert.ok(Array.isArray(symbols));
  assert.ok(symbols.some((s) => s.name === 'Index'), 'finds struct Index');
  assert.ok(symbols.some((s) => s.name === 'helper'), 'finds function helper');

  // The launcher must have assembled the DevEco-shaped home the proxy expects.
  const devHome = path.join(tmp, 'dev-home');
  for (const rel of ['plugins/openharmony/ace-server/out/index.js', 'sdk/default/sdk-pkg.json', 'tools/node/bin/node', 'tools/hvigor/bin/hvigorw.js']) {
    assert.ok(fs.existsSync(path.join(devHome, rel)), `assembled ${rel}`);
  }
});

test('arkts-lsp doctor succeeds with a bundle and CLI tools', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-lsp-doctor-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [launcher, 'doctor'], { env: envFor(tmp), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Environment OK/);
});

test('arkts-lsp setup extracts a bundle into ARKTS_LSP_HOME', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-lsp-setup-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // a fake DevEco .app
  const contents = path.join(tmp, 'DevEco-Studio.app', 'Contents');
  fs.mkdirSync(path.join(contents, 'plugins', 'openharmony', 'ace-server', 'out'), { recursive: true });
  fs.writeFileSync(path.join(contents, 'plugins', 'openharmony', 'ace-server', 'out', 'index.js'), '// ace\n');
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(contents, 'Resources', 'product-info.json'), JSON.stringify({ version: '26.0.0.821' }));

  const home = path.join(tmp, 'home');
  const env = { ...process.env, ARKTS_LSP_HOME: home };
  const result = spawnSync(process.execPath, [launcher, 'setup', '--from', path.join(tmp, 'DevEco-Studio.app')], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(fs.existsSync(path.join(home, 'ace-server-26.0.0.821', 'plugins', 'openharmony', 'ace-server', 'out', 'index.js')));
});
