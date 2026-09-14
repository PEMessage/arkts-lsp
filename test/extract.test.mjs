import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { selectDmgTargets } from '../extractor/extract-ace-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const extractor = path.join(repoRoot, 'extractor', 'extract-ace-server.mjs');

function makeFakeDevEco(tmp) {
  const contents = path.join(tmp, 'DevEco-Studio.app', 'Contents');
  const ace = path.join(contents, 'plugins', 'openharmony', 'ace-server');
  fs.mkdirSync(path.join(ace, 'out'), { recursive: true });
  fs.mkdirSync(path.join(ace, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(ace, 'out', 'index.js'), 'console.log("ace");\n');
  fs.writeFileSync(path.join(ace, 'node_modules', 'dep', 'package.json'), '{"name":"dep"}\n');

  fs.mkdirSync(path.join(contents, 'plugins', 'openharmony', 'ets-loader', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(contents, 'plugins', 'openharmony', 'ets-loader', 'lib', 'a.js'), 'export const a = 1;\n');

  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  fs.writeFileSync(
    path.join(contents, 'Resources', 'product-info.json'),
    JSON.stringify({ name: 'DevEco Studio', version: '26.0.0.821', buildNumber: '261.23567.138.36.2600821' }),
  );
  return path.join(tmp, 'DevEco-Studio.app');
}

test('selectDmgTargets picks exact paths from a 7z listing', () => {
  const paths = [
    'DevEco-Studio/DevEco-Studio.app/Contents/Resources/product-info.json',
    'DevEco-Studio/DevEco-Studio.app/Contents/Resources/build.txt',
    'DevEco-Studio/DevEco-Studio.app/Contents/plugins/openharmony/ace-server/out/index.js',
    'DevEco-Studio/DevEco-Studio.app/Contents/plugins/openharmony/ace-server/package.json',
    'DevEco-Studio/DevEco-Studio.app/Contents/plugins/openharmony/ets-loader/lib/a.js',
  ];
  const { aceDir, productInfo, buildTxt, targets } = selectDmgTargets(paths);
  assert.equal(aceDir, 'DevEco-Studio/DevEco-Studio.app/Contents/plugins/openharmony/ace-server');
  assert.equal(productInfo, 'DevEco-Studio/DevEco-Studio.app/Contents/Resources/product-info.json');
  assert.equal(buildTxt, 'DevEco-Studio/DevEco-Studio.app/Contents/Resources/build.txt');
  assert.deepEqual(targets, [aceDir, productInfo, buildTxt]);
});

test('selectDmgTargets handles a directory entry and an empty listing', () => {
  const withDirEntry = selectDmgTargets(['App.app/Contents/plugins/openharmony/ace-server']);
  assert.equal(withDirEntry.aceDir, 'App.app/Contents/plugins/openharmony/ace-server');

  const empty = selectDmgTargets([]);
  assert.equal(empty.aceDir, null);
  assert.deepEqual(empty.targets, []);
});

test('extractor stages a faithful IDE layout and packages a tarball', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-extract-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const app = makeFakeDevEco(tmp);
  const out = path.join(tmp, 'out');

  const result = spawnSync(
    process.execPath,
    [extractor, '--from', app, '--out', out, '--include', 'ets-loader'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);

  const stage = path.join(out, 'ace-server-26.0.0.821');
  assert.ok(fs.existsSync(path.join(stage, 'plugins', 'openharmony', 'ace-server', 'out', 'index.js')), 'ace-server staged with IDE layout');
  assert.ok(fs.existsSync(path.join(stage, 'plugins', 'openharmony', 'ets-loader', 'lib', 'a.js')), 'included sibling staged');
  assert.ok(fs.existsSync(path.join(stage, 'MANIFEST.json')), 'manifest written');

  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'MANIFEST.json'), 'utf8'));
  assert.equal(manifest.devecoVersion, '26.0.0.821');
  assert.deepEqual(manifest.includedPlugins, ['ets-loader']);
  assert.ok(manifest.fileCount >= 3);

  const tarball = path.join(out, 'ace-server-26.0.0.821.tar.gz');
  assert.ok(fs.existsSync(tarball), 'tarball created');
  assert.ok(fs.existsSync(`${tarball}.sha256`), 'checksum written');

  const index = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(index.tarballSha256.length, 64);
});

test('extractor --dry-run writes nothing', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-extract-dry-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const app = makeFakeDevEco(tmp);
  const out = path.join(tmp, 'out');
  const result = spawnSync(process.execPath, [extractor, '--from', app, '--out', out, '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(out), 'no output directory created in dry-run');
});
