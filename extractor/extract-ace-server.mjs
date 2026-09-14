#!/usr/bin/env node
/*
 * extract-ace-server.mjs
 *
 * Extract Huawei's ArkTS language server (`ace-server`) from a DevEco Studio
 * installation so it can be run without the full IDE, and package it as a
 * relocatable tarball suitable for a GitHub release.
 *
 * `ace-server` is a bundled Node.js application (NOT Java) located at
 *   <DevEco>/plugins/openharmony/ace-server/
 * in a DevEco Studio tree. It is cross-platform JavaScript, so a copy taken
 * from the macOS DMG runs unchanged on Linux (see alex3236/devecostudio-linux).
 *
 * This script is dependency-free (Node built-ins only) and works on
 * Linux / macOS / Windows. It never modifies the source tree.
 *
 * Usage:
 *   arkts-lsp-extract --from /path/to/devecostudio-mac.zip
 *   arkts-lsp-extract --from /Applications/DevEco-Studio.app
 *   arkts-lsp-extract --from /path/to/deveco-studio-xxx.dmg --out dist
 *   arkts-lsp-extract --from-install /opt/devecostudio
 *   arkts-lsp-extract --from /path/to/install --include ets-loader,form
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ACE_REL_ENTRY = path.join('plugins', 'openharmony', 'ace-server', 'out', 'index.js');
const ACE_DIR_SUFFIX = 'plugins/openharmony/ace-server';
const OHOS_PLUGIN_DIR = path.join('plugins', 'openharmony');

function log(...args) {
  process.stderr.write(`[extract] ${args.join(' ')}\n`);
}

function fail(message) {
  process.stderr.write(`\n[extract] ERROR: ${message}\n`);
  process.exit(1);
}

function usage(code = 0) {
  const text = `
Extract DevEco Studio's ace-server into a relocatable, release-ready bundle.

Usage:
  arkts-lsp-extract --from <path> [options]

Source (exactly one):
  --from <path>          Auto-detect: a directory, a .app, a .dmg or a .zip
                         (the official devecostudio-mac-*.zip contains a .dmg).
  --from-install <path>  A DevEco Studio install / Contents directory.
  --from-dmg <path>      A .dmg file (needs 7z, or hdiutil on macOS).
  --from-zip <path>      A .zip that contains the .dmg.

Options:
  --out <dir>            Output directory. Default: ./dist-ace-server
  --name <name>          Bundle name prefix. Default: ace-server
  --include <a,b,...>    Extra directories under plugins/openharmony to bundle
                         alongside ace-server (e.g. ets-loader,form).
                         Repeatable. Only needed if ace-server complains about
                         missing sibling modules at startup.
  --include-plugins <d>  Additional top-level plugin dirs to copy.
  --no-archive           Do not create the .tar.gz (keep the staged dir only).
  --force                Overwrite an existing output directory.
  --dry-run              Print what would happen; do not write anything.
  -h, --help             Show this help.

Output (in --out):
  <name>-<version>/            staged tree (ace-server/ + MANIFEST.json)
  <name>-<version>.tar.gz      release archive
  <name>-<version>.tar.gz.sha256
  manifest.json                index of produced artifacts
`;
  process.stderr.write(text);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    from: null,
    fromInstall: null,
    fromDmg: null,
    fromZip: null,
    out: path.resolve(process.cwd(), 'dist-ace-server'),
    name: 'ace-server',
    include: [],
    includePlugins: [],
    archive: true,
    force: false,
    dryRun: false,
  };
  const take = (i, flag) => {
    if (i + 1 >= argv.length) fail(`missing value for ${flag}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--from': opts.from = take(i, a); i += 1; break;
      case '--from-install': opts.fromInstall = take(i, a); i += 1; break;
      case '--from-dmg': opts.fromDmg = take(i, a); i += 1; break;
      case '--from-zip': opts.fromZip = take(i, a); i += 1; break;
      case '--out': opts.out = path.resolve(take(i, a)); i += 1; break;
      case '--name': opts.name = take(i, a); i += 1; break;
      case '--include':
        opts.include.push(...take(i, a).split(',').map((s) => s.trim()).filter(Boolean));
        i += 1;
        break;
      case '--include-plugins':
        opts.includePlugins.push(...take(i, a).split(',').map((s) => s.trim()).filter(Boolean));
        i += 1;
        break;
      case '--no-archive': opts.archive = false; break;
      case '--force': opts.force = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '-h':
      case '--help':
        usage(0);
        break;
      default:
        fail(`unknown argument: ${a} (try --help)`);
    }
  }

  const sources = [opts.from, opts.fromInstall, opts.fromDmg, opts.fromZip].filter(Boolean);
  if (sources.length === 0) usage(1);
  if (sources.length > 1) fail('use only one of --from / --from-install / --from-dmg / --from-zip');
  return opts;
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function which(cmd) {
  if (!hasCommand(cmd)) return null;
  return cmd;
}

function hasCommand(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    stdio: 'ignore',
  });
  return r.status === 0;
}

function realpathIfPossible(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function run(cmd, args, options = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (r.error) fail(`failed to run ${cmd}: ${r.error.message}`);
  if (typeof r.status === 'number' && r.status !== 0) {
    fail(`${cmd} exited with code ${r.status}`);
  }
  return r;
}

function runCapture(cmd, args, options = {}) {
  // A DMG listing can be tens of MB, so allow a generous buffer.
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...options });
  if (r.error) return null;
  return r.stdout ?? '';
}

/** Locate a usable 7-Zip binary, or fail with an actionable message. */
function pick7z() {
  for (const candidate of ['7z', '7zz', '7za']) {
    if (hasCommand(candidate)) return candidate;
  }
  fail('extracting a .dmg needs 7z (p7zip / 7-Zip). Install it, or run this on macOS (hdiutil).');
}

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/** True if p looks like a DevEco "Contents" root (has plugins/openharmony). */
function looksLikeContents(p) {
  return isDir(path.join(p, OHOS_PLUGIN_DIR));
}

/** True if p is the ace-server directory itself. */
function looksLikeAceServer(p) {
  return isFile(path.join(p, 'out', 'index.js'));
}

/**
 * Walk down from root (bounded) looking for a directory that contains
 * plugins/openharmony/ace-server/out/index.js. Returns { contentsRoot, aceServerDir }.
 */
function searchForAceServer(root, maxDepth = 7) {
  if (looksLikeAceServer(root)) {
    return { contentsRoot: path.dirname(path.dirname(path.resolve(root))), aceServerDir: path.resolve(root) };
  }
  if (looksLikeContents(root)) {
    const ace = path.join(root, OHOS_PLUGIN_DIR, 'ace-server');
    if (looksLikeAceServer(ace)) {
      return { contentsRoot: path.resolve(root), aceServerDir: path.resolve(ace) };
    }
  }

  const queue = [{ dir: path.resolve(root), depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Follow symlinks that point at dirs (DevEco .app layouts).
      const child = path.join(dir, entry.name);
      if (!isDir(child)) continue;
      if (looksLikeAceServer(child)) {
        return { contentsRoot: path.dirname(path.dirname(path.resolve(child))), aceServerDir: path.resolve(child) };
      }
      const ace = path.join(child, OHOS_PLUGIN_DIR, 'ace-server');
      if (looksLikeAceServer(ace)) {
        return { contentsRoot: path.resolve(child), aceServerDir: path.resolve(ace) };
      }
      if (depth + 1 <= maxDepth) {
        queue.push({ dir: child, depth: depth + 1 });
      }
    }
  }
  return null;
}

/** Find the DevEco "Contents" root above a known ace-server dir. */
function findContentsRoot(aceServerDir) {
  let dir = aceServerDir;
  for (let i = 0; i < 8; i += 1) {
    if (looksLikeContents(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** Best-effort DevEco version detection from an extracted Contents tree. */
function detectVersion(contentsRoot) {
  const candidates = [
    path.join(contentsRoot, 'Resources', 'product-info.json'),
    path.join(contentsRoot, 'product-info.json'),
    path.join(contentsRoot, 'Resources', 'build.txt'),
    path.join(contentsRoot, 'build.txt'),
  ];
  for (const file of candidates) {
    if (!isFile(file)) continue;
    if (file.endsWith('.json')) {
      const data = readJsonSafe(file);
      if (data) {
        const v = data.buildNumber || data.version || data.build;
        if (v) return { version: String(v), source: file };
      }
    } else {
      const text = fs.readFileSync(file, 'utf8').trim();
      const line = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (line) return { version: line.replace(/[^A-Za-z0-9._-]/g, '_'), source: file };
    }
  }
  return { version: 'unknown', source: null };
}

function sanitizeVersion(v) {
  const cleaned = String(v).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'unknown';
}

// ---------------------------------------------------------------------------
// Source acquisition
// ---------------------------------------------------------------------------

/**
 * From the `Path = ...` entries of `7z l -slt <dmg>`, choose the exact archive
 * paths to extract for ace-server. Exported for unit tests.
 */
export function selectDmgTargets(innerPaths) {
  const aceDir =
    innerPaths.find((p) => p === ACE_DIR_SUFFIX || p.endsWith(`/${ACE_DIR_SUFFIX}`)) ??
    (() => {
      const file = innerPaths.find((p) => p.includes(`/${ACE_DIR_SUFFIX}/`));
      if (!file) return null;
      return file.slice(0, file.indexOf(`/${ACE_DIR_SUFFIX}/`) + ACE_DIR_SUFFIX.length + 1);
    })();
  const productInfo = innerPaths.find((p) => /\/Resources\/product-info\.json$/.test(p));
  const buildTxt = innerPaths.find((p) => /\/Resources\/build\.txt$/.test(p));
  return { aceDir, productInfo, buildTxt, targets: [aceDir, productInfo, buildTxt].filter(Boolean) };
}

/** Extract a .dmg into a temp dir and return its contents. */
function dmgToContents(dmgPath) {
  const tmp = mkdtemp('arkts-ace-dmg-');

  if (process.platform === 'darwin' && hasCommand('hdiutil')) {
    log(`Mounting ${dmgPath} with hdiutil ...`);
    const mount = mkdtemp('arkts-ace-mnt-');
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmgPath]);
    try {
      const found = searchForAceServer(mount);
      if (!found) fail('ace-server not found inside the mounted DMG');
      return { contentsRoot: found.contentsRoot, aceServerDir: found.aceServerDir, cleanup: () => {
        try { run('hdiutil', ['detach', mount, '-quiet']); } catch { /* ignore */ }
        rimraf(mount); rimraf(tmp);
      } };
    } catch (e) {
      try { run('hdiutil', ['detach', mount, '-quiet']); } catch { /* ignore */ }
      throw e;
    }
  }

  const sevenZip = pick7z();
  log(`Extracting ${dmgPath} with ${sevenZip} ...`);

  // 7-Zip's wildcard filters do NOT recurse into the DMG's HFS tree, so list
  // first and extract exact paths. Known-safe fallbacks follow in case a given
  // 7-Zip build cannot list the nested HFS.
  const innerPaths = listArchivePaths(sevenZip, dmgPath);
  const { targets } = selectDmgTargets(innerPaths);

  const run7z = (switches, files, label) => {
    log(`7z extract (${label}): ${[...switches, ...files].join(' ')}`);
    const r = spawnSync(sevenZip, ['x', '-y', `-o${tmp}`, ...switches, dmgPath, ...files], { stdio: 'inherit' });
    if (r.error) fail(`failed to run ${sevenZip}: ${r.error.message}`);
    return r.status === 0;
  };

  if (targets.length > 0) {
    run7z([], targets, 'exact paths from listing');
  }

  if (!searchForAceServer(tmp)) {
    log(`listing gave ${innerPaths.length} entries but no ace-server; trying recursive wildcard`);
    run7z(['-r'], [`*/${ACE_DIR_SUFFIX}/*`, '*Resources/product-info.json', '*Resources/build.txt', '*product-info.json'], 'recursive wildcard');
  }

  if (!searchForAceServer(tmp)) {
    // Last resort: the layout used by the DevEco macOS DMG (see
    // alex3236/devecostudio-linux). Exact directory paths work even when
    // wildcards do not.
    for (const prefix of ['DevEco-Studio/DevEco-Studio.app/Contents', 'DevEco-Studio.app/Contents']) {
      if (searchForAceServer(tmp)) break;
      run7z(
        [],
        [`${prefix}/plugins/openharmony/ace-server`, `${prefix}/Resources/product-info.json`, `${prefix}/Resources/build.txt`],
        `known prefix ${prefix}`,
      );
    }
  }

  const found = searchForAceServer(tmp);
  if (!found) fail('ace-server not found after extracting the DMG');
  return {
    contentsRoot: found.contentsRoot,
    aceServerDir: found.aceServerDir,
    cleanup: () => rimraf(tmp),
  };
}

/** Read the `Path = ...` entries from `7z l -slt <archive>`. */
function listArchivePaths(sevenZip, archive) {
  const listing = runCapture(sevenZip, ['l', '-slt', archive]);
  if (!listing) return [];
  return listing
    .split(/\r?\n/)
    .filter((line) => line.startsWith('Path = '))
    .map((line) => line.slice('Path = '.length).trim());
}

function zipToDmg(zipPath) {
  const tmp = mkdtemp('arkts-ace-zip-');
  log(`Extracting ${zipPath} ...`);
  if (hasCommand('bsdtar')) {
    run('bsdtar', ['-xf', zipPath, '-C', tmp]);
  } else if (hasCommand('unzip')) {
    run('unzip', ['-q', '-o', zipPath, '-d', tmp]);
  } else {
    fail('extracting a .zip needs bsdtar or unzip.');
  }
  const dmgs = findFiles(tmp, (p) => p.toLowerCase().endsWith('.dmg'), 4);
  if (dmgs.length === 0) fail(`no .dmg found inside ${zipPath}`);
  return { dmg: dmgs[0], tmp };
}

function findFiles(root, predicate, maxDepth = 6) {
  const out = [];
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (predicate(child)) out.push(child);
      if (depth + 1 <= maxDepth && isDir(child)) queue.push({ dir: child, depth: depth + 1 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Native-binary audit
// ---------------------------------------------------------------------------

const MACHO_MAGICS = new Set([
  '254,237,250,206', '206,250,237,254',
  '254,237,250,207', '207,250,237,254',
  '202,254,186,190', '190,186,254,202',
]);

function readMagic(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    const n = fs.readSync(fd, buf, 0, 4, 0);
    if (n < 4) return null;
    return [...buf];
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function auditNativeFiles(root) {
  const suspicious = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { stack.push(p); continue; }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.node' || ext === '.dylib' || ext === '.so' || ext === '.dll' || ext === '.exe' || entry.name === 'node') {
        suspicious.push({ path: p, reason: `extension ${ext || entry.name}` });
        continue;
      }
      const magic = readMagic(p);
      if (magic) {
        const key = magic.join(',');
        if (MACHO_MAGICS.has(key) || (magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46)) {
          suspicious.push({ path: p, reason: magic[0] === 0x7f ? 'ELF binary' : 'Mach-O binary' });
        }
      }
    }
  }
  return suspicious;
}

// ---------------------------------------------------------------------------
// Staging & packaging
// ---------------------------------------------------------------------------

function copyTree(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function dirSize(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      try {
        const st = entry.isSymbolicLink() ? null : fs.statSync(p);
        if (st && st.isDirectory()) stack.push(p);
        else if (st) total += st.size;
      } catch { /* ignore */ }
    }
  }
  return total;
}

function humanSize(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let resolved = null;
  let cleanup = () => {};

  const explicitDir = opts.fromInstall || opts.from;
  if (explicitDir) {
    const p = path.resolve(explicitDir);
    if (!fs.existsSync(p)) fail(`path does not exist: ${p}`);
    if (isDir(p)) {
      const found = searchForAceServer(p);
      if (!found) fail(`ace-server (plugins/openharmony/ace-server/out/index.js) not found under ${p}`);
      resolved = found;
    } else if (p.toLowerCase().endsWith('.dmg')) {
      resolved = dmgToContents(p);
      cleanup = resolved.cleanup;
    } else if (p.toLowerCase().endsWith('.zip')) {
      const { dmg, tmp } = zipToDmg(p);
      const inner = dmgToContents(dmg);
      resolved = inner;
      const innerCleanup = inner.cleanup ?? (() => {});
      cleanup = () => { innerCleanup(); rimraf(tmp); };
    } else {
      fail(`unsupported source file: ${p} (expected directory, .dmg or .zip)`);
    }
  } else if (opts.fromDmg) {
    resolved = dmgToContents(path.resolve(opts.fromDmg));
    cleanup = resolved.cleanup;
  } else if (opts.fromZip) {
    const { dmg, tmp } = zipToDmg(path.resolve(opts.fromZip));
    const inner = dmgToContents(dmg);
    resolved = inner;
    const innerCleanup = inner.cleanup ?? (() => {});
    cleanup = () => { innerCleanup(); rimraf(tmp); };
  }

  if (!resolved) fail('no ace-server found');

  const { aceServerDir } = resolved;
  let contentsRoot = resolved.contentsRoot ?? findContentsRoot(aceServerDir);
  const versionInfo = contentsRoot ? detectVersion(contentsRoot) : { version: 'unknown', source: null };
  const version = sanitizeVersion(versionInfo.version);
  const bundleName = `${opts.name}-${version}`;

  log('');
  log(`ace-server : ${aceServerDir}`);
  log(`Deveco root: ${contentsRoot ?? '(unknown)'}`);
  log(`version    : ${version}${versionInfo.source ? ` (from ${versionInfo.source})` : ''}`);
  log(`bundle     : ${bundleName}`);

  const aceSize = dirSize(aceServerDir);
  log(`size       : ${humanSize(aceSize)}`);

  const stageDir = path.join(opts.out, bundleName);
  const tarball = path.join(opts.out, `${bundleName}.tar.gz`);

  if (opts.dryRun) {
    log('dry-run: would stage ace-server into ' + stageDir);
    if (opts.include.length) log('dry-run: would also include ' + opts.include.join(', '));
    log('dry-run: would create ' + tarball);
    cleanup();
    return;
  }

  if (fs.existsSync(stageDir) || fs.existsSync(tarball)) {
    if (!opts.force) fail(`${stageDir} or tarball already exists (use --force to overwrite)`);
    rimraf(stageDir);
    rimraf(tarball);
  }
  fs.mkdirSync(stageDir, { recursive: true });

  log('Copying ace-server ...');
  // Preserve the IDE layout so any `plugins/openharmony/...` relative lookups
  // inside ace-server keep working when we set its cwd to the bundle root.
  const stagedAceServer = path.join(stageDir, 'plugins', 'openharmony', 'ace-server');
  copyTree(aceServerDir, stagedAceServer);

  const included = [];
  if (contentsRoot) {
    for (const rel of opts.include) {
      const src = path.join(contentsRoot, OHOS_PLUGIN_DIR, rel);
      if (!isDir(src)) {
        log(`warning: --include ${rel} not found at ${src}, skipping`);
        continue;
      }
      log(`Copying plugin sibling ${rel} ...`);
      copyTree(src, path.join(stageDir, 'plugins', 'openharmony', rel));
      included.push(rel);
    }
    for (const rel of opts.includePlugins) {
      const src = path.join(contentsRoot, 'plugins', rel);
      if (!isDir(src)) {
        log(`warning: --include-plugins ${rel} not found at ${src}, skipping`);
        continue;
      }
      log(`Copying plugin ${rel} ...`);
      copyTree(src, path.join(stageDir, 'plugins', rel));
      included.push(`plugins/${rel}`);
    }
  }

  const native = auditNativeFiles(stagedAceServer);
  if (native.length > 0) {
    log('');
    log(`NOTICE: found ${native.length} native/foreign binary file(s) inside ace-server.`);
    log('        These may be platform-specific and could prevent cross-platform use:');
    for (const item of native.slice(0, 20)) {
      log(`          - ${path.relative(stageDir, item.path)} (${item.reason})`);
    }
    if (native.length > 20) log(`          ... and ${native.length - 20} more`);
  }

  const fileCount = countFiles(stageDir);
  const manifest = {
    schemaVersion: 1,
    name: opts.name,
    bundle: bundleName,
    devecoVersion: version,
    versionSource: versionInfo.source,
    contentsRoot: contentsRoot ?? null,
    aceServerDirRelative: path.join('plugins', 'openharmony', 'ace-server'),
    includedPlugins: included,
    fileCount,
    sizeBytes: dirSize(stageDir),
    nativeFiles: native.map((n) => ({ path: path.relative(stageDir, n.path), reason: n.reason })),
    createdAt: new Date().toISOString(),
    generator: 'arkts-lsp/extractor',
  };
  fs.writeFileSync(path.join(stageDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

  log('');
  log(`Staged   : ${stageDir} (${fileCount} files, ${humanSize(manifest.sizeBytes)})`);

  let tarballSha = null;
  if (opts.archive) {
    log(`Creating : ${tarball}`);
    run('tar', ['-C', opts.out, '-czf', tarball, bundleName]);
    tarballSha = sha256File(tarball);
    fs.writeFileSync(`${tarball}.sha256`, `${tarballSha}  ${path.basename(tarball)}\n`);
    log(`SHA256   : ${tarballSha}`);
  }

  const index = {
    schemaVersion: 1,
    bundle: bundleName,
    devecoVersion: version,
    tarball: opts.archive ? path.basename(tarball) : null,
    tarballSha256: tarballSha,
    stageDir: path.relative(opts.out, stageDir),
    bytes: manifest.sizeBytes,
    createdAt: manifest.createdAt,
  };
  const indexPath = path.join(opts.out, 'manifest.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  log(`Manifest : ${indexPath}`);

  cleanup();
  log('Done.');
}

function countFiles(root) {
  let n = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else n += 1;
    }
  }
  return n;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
