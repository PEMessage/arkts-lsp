#!/usr/bin/env node
/*
 * arkts-lsp — one-click standalone ArkTS language server.
 *
 * This launcher does NOT contain a language-server proxy. It composes three
 * things that already exist:
 *
 *   1. Huawei's `ace-server` (extracted from DevEco Studio, see the extractor),
 *   2. the official HarmonyOS command-line tools (SDK + Node.js + hvigor),
 *   3. the upstream `arkts-lsp-proxy` npm package, used unmodified.
 *
 * The upstream proxy expects a DevEco Studio "Contents" home (it looks for
 * `plugins/openharmony/ace-server`, `sdk/default`, `tools/node`, `tools/hvigor`).
 * This launcher builds that home out of symlinks and then execs the upstream
 * binary with `DEVECO_HOME` pointing at it.
 *
 * Usage:
 *   arkts-lsp                     run the server (stdio LSP)
 *   arkts-lsp doctor              print what was found
 *   arkts-lsp setup --from <zip>  extract ace-server into the default home
 *   arkts-lsp --version
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function log(message) {
  process.stderr.write(`[arkts-lsp] ${message}\n`);
}
function fail(message) {
  process.stderr.write(`[arkts-lsp] error: ${message}\n`);
  process.exit(1);
}

function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; }
}
function isFile(p) {
  try { return !!p && fs.statSync(p).isFile(); } catch { return false; }
}
function realpath(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function findOnPath(command) {
  const pathVar = process.env.PATH ?? process.env.Path ?? '';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function xdgDataHome() {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

/** Directory where extracted ace-server bundles live. */
function bundleBase() {
  return process.env.ARKTS_LSP_HOME || path.join(xdgDataHome(), 'arkts-lsp');
}

/** The assembled DevEco-shaped home passed to the upstream proxy. */
function devHomePath() {
  return process.env.ARKTS_LSP_DEV_HOME || path.join(bundleBase(), 'dev-home');
}

const ACE_ENTRY = path.join('plugins', 'openharmony', 'ace-server', 'out', 'index.js');

/** Given a candidate dir, return the "Contents" root that contains plugins/... */
function asContentsRoot(candidate) {
  const p = path.resolve(candidate);
  const bases = isDir(path.join(p, 'Contents')) ? [p, path.join(p, 'Contents')] : [p];
  for (const base of bases) {
    if (isFile(path.join(base, ACE_ENTRY))) return base;
    if (isFile(path.join(base, 'ace-server', 'out', 'index.js'))) return path.dirname(base);
  }
  return null;
}

function findBundle() {
  const explicit = process.env.ARKTS_ACE_SERVER_HOME || process.env.ARKTS_ACE_SERVER;
  if (explicit) {
    const root = asContentsRoot(explicit);
    if (root) return { root, source: `ARKTS_ACE_SERVER_HOME=${explicit}` };
    return { root: null, source: `ARKTS_ACE_SERVER_HOME=${explicit} (invalid)` };
  }

  // ace-server bundled inside this package, so one download is enough.
  if (isFile(path.join(PKG_ROOT, ACE_ENTRY))) {
    return { root: PKG_ROOT, source: 'bundled with the package' };
  }
  if (isDir(PKG_ROOT)) {
    for (const entry of fs.readdirSync(PKG_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(PKG_ROOT, entry.name);
      if (isFile(path.join(sub, ACE_ENTRY))) {
        return { root: sub, source: `bundled with the package (${entry.name})` };
      }
    }
  }

  const base = bundleBase();
  const candidates = [];
  if (isDir(base)) {
    if (isFile(path.join(base, ACE_ENTRY))) candidates.push(base);
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(base, entry.name);
      if (isFile(path.join(sub, ACE_ENTRY))) candidates.push(sub);
    }
  }
  if (candidates.length === 0) return { root: null, source: base };
  // Newest first.
  candidates.sort((a, b) => {
    try { return fs.statSync(path.join(b, ACE_ENTRY)).mtimeMs - fs.statSync(path.join(a, ACE_ENTRY)).mtimeMs; } catch { return 0; }
  });
  return { root: candidates[0], source: `${candidates[0]} (from ${base})` };
}

function validateCliRoot(root) {
  return isFile(path.join(root, 'sdk', 'default', 'sdk-pkg.json')) && isFile(path.join(root, 'tool', 'node', 'bin', 'node'));
}

function findCliRoot() {
  const explicit = process.env.ARKTS_CLI_HOME || process.env.DEVECO_CLI_HOME;
  if (explicit && isDir(explicit)) return { root: path.resolve(explicit), source: `ARKTS_CLI_HOME=${explicit}` };

  const hvigorw = findOnPath('hvigorw');
  if (hvigorw) {
    const root = path.dirname(path.dirname(realpath(hvigorw)));
    if (isDir(root)) return { root, source: `hvigorw on PATH (${root})` };
  }

  const sdk = process.env.DEVECO_SDK_HOME;
  if (sdk) {
    const root = path.basename(path.resolve(sdk)) === 'sdk' ? path.dirname(path.resolve(sdk)) : path.resolve(sdk);
    if (isDir(path.join(root, 'sdk'))) return { root, source: `DEVECO_SDK_HOME=${sdk}` };
  }
  return { root: null, source: '(not found; put the command-line tools bin/ on PATH)' };
}

/** A real DevEco Studio install already has everything; use it directly. */
function findFullIde() {
  const raw = process.env.ARKTS_DEVECO_HOME || process.env.DEVECO_HOME;
  if (!raw) return { root: null, source: null };
  for (const base of [path.resolve(raw), path.join(path.resolve(raw), 'Contents')]) {
    if (
      isFile(path.join(base, ACE_ENTRY)) &&
      isFile(path.join(base, 'sdk', 'default', 'sdk-pkg.json')) &&
      isFile(path.join(base, 'tools', 'node', 'bin', 'node'))
    ) {
      return { root: base, source: `DEVECO_HOME=${raw}` };
    }
  }
  return { root: null, source: null };
}

function ensureSymlink(linkPath, target) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  let stat = null;
  try { stat = fs.lstatSync(linkPath); } catch { /* missing */ }
  if (stat) {
    if (stat.isSymbolicLink()) fs.unlinkSync(linkPath);
    else return false; // a real dir/file is there; leave the user's data alone
  }
  fs.symlinkSync(target, linkPath);
  return true;
}

function assembleDevHome(bundleRoot, cliRoot) {
  const devHome = devHomePath();
  fs.mkdirSync(devHome, { recursive: true });

  const links = [
    [path.join(devHome, 'plugins'), path.join(bundleRoot, 'plugins')],
    [path.join(devHome, 'sdk'), path.join(cliRoot, 'sdk')],
    [path.join(devHome, 'tools', 'node'), path.join(cliRoot, 'tool', 'node')],
    [path.join(devHome, 'tools', 'hvigor'), path.join(cliRoot, 'hvigor')],
  ];
  for (const [link, target] of links) {
    if (!isDir(target)) fail(`cannot assemble DevEco home: missing ${target}\n  Is the official command-line tools correctly installed?`);
    ensureSymlink(link, target);
  }

  const required = ['plugins/openharmony/ace-server/out/index.js', 'sdk/default/sdk-pkg.json', 'tools/node/bin/node', 'tools/hvigor/bin/hvigorw.js'];
  const missing = required.filter((rel) => !fs.existsSync(path.join(devHome, rel)));
  if (missing.length > 0) fail(`assembled home is incomplete: ${missing.join(', ')}`);
  return devHome;
}

function resolveDevHome() {
  const full = findFullIde();
  if (full.root) return { devHome: full.root, bundle: full.source, cli: '(DevEco Studio)' };

  const bundle = findBundle();
  if (!bundle.root) fail(
    `ace-server not found.\n` +
    `  Looked in: ${bundle.source}\n` +
    `  Download the ace-server bundle from this project's release and extract it into:\n` +
    `    ${bundleBase()}\n` +
    `  or run:  arkts-lsp setup --from <devecostudio-mac.zip>`,
  );
  const cli = findCliRoot();
  if (!cli.root || !validateCliRoot(cli.root)) fail(
    `HarmonyOS command-line tools not found.\n` +
    `  ${cli.source}\n` +
    `  Add the official command-line tools' bin/ to PATH, or set ARKTS_CLI_HOME.`,
  );
  return { devHome: assembleDevHome(bundle.root, cli.root), bundle: bundle.source, cli: cli.source };
}

function findProxyEntry() {
  try {
    return require.resolve('arkts-lsp-proxy/dist/index.js');
  } catch {
    try {
      return require.resolve('arkts-lsp-proxy');
    } catch {
      return null;
    }
  }
}

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function help() {
  process.stderr.write(`arkts-lsp ${readVersion()} — one-click standalone ArkTS language server

Usage:
  arkts-lsp                       Run the LSP server on stdin/stdout.
  arkts-lsp doctor                Check the environment and print what was found.
  arkts-lsp setup --from <path>   Extract ace-server from a DevEco Studio
                                  archive/install into ${bundleBase()}.
  arkts-lsp --project-root <dir>  Pin the HarmonyOS project root.
  arkts-lsp --version

This tool wraps the upstream arkts-lsp-proxy (npm) and composes it with the
official HarmonyOS command-line tools and an extracted ace-server bundle.

Environment:
  ARKTS_LSP_HOME          Where ace-server bundles live (default: ${path.join(xdgDataHome(), 'arkts-lsp')}).
  ARKTS_ACE_SERVER_HOME   A specific bundle (contains plugins/openharmony/ace-server).
  ARKTS_CLI_HOME          HarmonyOS command-line tools root (auto-detected from PATH).
  DEVECO_HOME             A full DevEco Studio install, used as-is if present.
  ARKTS_LSP_DEV_HOME      The assembled DevEco-shaped home passed to the proxy.
  ARKTS_LSP_SYNC          auto (default) | off | force   (upstream proxy)
`);
  process.exit(2);
}

function doctor() {
  process.stdout.write(`arkts-lsp ${readVersion()}\n\n`);

  const proxy = findProxyEntry();
  process.stdout.write(`${'upstream proxy'.padEnd(18)} ${proxy ?? 'NOT FOUND (reinstall the package)'}\n`);

  const full = findFullIde();
  if (full.root) {
    process.stdout.write(`${'DevEco Studio'.padEnd(18)} ${full.source}\n`);
    process.stdout.write(`\nUsing the full DevEco Studio install directly as DEVECO_HOME.\n`);
  } else {
    const bundle = findBundle();
    process.stdout.write(`${'ace-server'.padEnd(18)} ${bundle.root ?? 'NOT FOUND'}   (${bundle.source})\n`);
    const cli = findCliRoot();
    process.stdout.write(`${'command-line tools'.padEnd(18)} ${cli.root ?? 'NOT FOUND'}   (${cli.source})\n`);
    process.stdout.write(`${'dev-home (assembled)'.padEnd(18)} ${devHomePath()}\n`);
  }

  if (!proxy || (!full.root && (!findBundle().root || !findCliRoot().root))) {
    process.stdout.write('\nProblems found. See `arkts-lsp --help`.\n');
    process.exit(1);
  }
  process.stdout.write('\nEnvironment OK.\n');
}

function setup(args) {
  let from = null;
  let force = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--from') from = args[++i];
    else if (args[i] === '--force') force = true;
    else fail(`unknown setup argument: ${args[i]}`);
  }
  if (!from) fail('setup requires --from <devecostudio-mac.zip|.dmg|.app|install>');
  const extractor = path.join(PKG_ROOT, 'extractor', 'extract-ace-server.mjs');
  const out = bundleBase();
  const extra = force ? ['--force'] : [];
  log(`extracting ace-server from ${from} into ${out} ...`);
  const result = spawnSync(process.execPath, [extractor, '--from', from, '--out', out, ...extra], { stdio: 'inherit' });
  if (result.status !== 0) fail('extraction failed');
  log('done. Now run `arkts-lsp doctor` and start your editor.');
}

function run(passthrough) {
  const { devHome, bundle, cli } = resolveDevHome();
  const proxyEntry = findProxyEntry();
  if (!proxyEntry) fail('upstream arkts-lsp-proxy is not installed; reinstall this package (npm install).');

  log(`ace-server : ${bundle}`);
  log(`cli tools  : ${cli}`);
  log(`DEVECO_HOME: ${devHome}`);
  log(`upstream   : ${proxyEntry}`);

  const child = spawn(process.execPath, [proxyEntry, ...passthrough], {
    stdio: 'inherit',
    env: { ...process.env, DEVECO_HOME: devHome, ARKTS_DEVECO_HOME: devHome },
  });

  const forward = (signal) => { try { child.kill(signal); } catch { /* ignore */ } };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
  child.on('error', (error) => fail(`failed to start the proxy: ${error.message}`));
}

function main() {
  const argv = process.argv.slice(2);
  const first = argv[0];
  if (first === 'doctor') doctor();
  else if (first === 'setup') setup(argv.slice(1));
  else if (first === '-h' || first === '--help') help();
  else if (first === '-v' || first === '--version') process.stdout.write(`${readVersion()}\n`);
  else run(argv);
}

main();
