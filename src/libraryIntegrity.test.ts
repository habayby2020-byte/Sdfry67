import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const LIB_PATH = path.resolve(process.cwd(), 'public/مكتبة_الألعاب-2.html');

function extractLibraryData(html: string) {
  const marker = 'const LIBRARY_GAMES = ';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'LIBRARY_GAMES declaration must exist');
  const jsonStart = start + marker.length;
  const end = html.indexOf('];\n', jsonStart);
  assert.notEqual(end, -1, 'LIBRARY_GAMES closing bracket must exist');
  const jsonText = html.slice(jsonStart, end + 1);
  return JSON.parse(jsonText) as Array<{
    id: string;
    name: string;
    name_en?: string;
    icon: string;
    desc: string;
    desc_en?: string;
    b64: string;
    enc?: unknown;
    price?: unknown;
  }>;
}

test('مكتبة_الألعاب-2.html preserves protection and connection settings intact', () => {
  const html = fs.readFileSync(LIB_PATH, 'utf-8');
  assert.ok(html.includes('const DEV_MODE=false;'), 'DEV_MODE must be restored to false');
  assert.ok(html.includes("const CATALOG_SEAL='';"), 'CATALOG_SEAL must remain intact');
  assert.ok(html.includes("peer.connect('wrglib'+code,{reliable:true})"), 'PeerJS connection logic must remain untouched');
  assert.ok(html.includes('const CHUNK_SIZE=16000;'), 'Chunk size must remain untouched');

  // Verify JS syntax of the entire inline <script> block using vm.Script
  const scriptMatches = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)];
  const inlineScripts = scriptMatches.filter(m => !/\bsrc=/i.test(m[0]) && m[1].trim().length > 0);
  assert.equal(inlineScripts.length, 1, 'Expected exactly one inline script in مكتبة_الألعاب-2.html');
  assert.doesNotThrow(() => new vm.Script(inlineScripts[0][1]), 'Inline script must be valid JavaScript');
});

test('LIBRARY_GAMES contains all 22 free games with valid unmodified HTML payloads', () => {
  const html = fs.readFileSync(LIB_PATH, 'utf-8');
  const games = extractLibraryData(html);
  assert.equal(games.length, 22, 'Must contain exactly 22 games');

  const ids = new Set<string>();
  for (const g of games) {
    assert.ok(g.id && !ids.has(g.id), `Unique id required for ${g.id}`);
    ids.add(g.id);
    assert.ok(g.name && g.name.length > 0, `Arabic name required for ${g.id}`);
    assert.ok(g.icon && g.icon.length > 0, `Icon required for ${g.id}`);
    assert.ok(g.desc && g.desc.length > 0, `Description required for ${g.id}`);
    assert.equal(g.enc, undefined, `Game ${g.id} must be free (no enc)`);
    assert.equal(g.price, undefined, `Game ${g.id} must be free (no price)`);
    assert.ok(typeof g.b64 === 'string' && g.b64.length > 1000, `Valid b64 required for ${g.id}`);

    const decoded = Buffer.from(g.b64, 'base64').toString('utf-8');
    assert.ok(decoded.toLowerCase().includes('<html'), `Decoded HTML missing <html> for ${g.id}`);
    assert.ok(decoded.includes('EMB_ROLE') || decoded.includes('startTv'), `Decoded HTML missing EMB bridge for ${g.id}`);
    // Verify exact base64 canonical round-trip
    assert.equal(Buffer.from(decoded, 'utf-8').toString('base64'), g.b64, `Exact UTF-8 base64 round-trip failed for ${g.id}`);
  }

  // Also verify against /tmp/expected_hashes.json if present
  const expectedPath = '/tmp/expected_hashes.json';
  if (fs.existsSync(expectedPath)) {
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf-8')) as Record<string, { bytes: number; sha256: string }>;
    for (const g of games) {
      const buf = Buffer.from(g.b64, 'base64');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      assert.equal(buf.length, expected[g.id].bytes, `Byte size mismatch for ${g.id}`);
      assert.equal(hash, expected[g.id].sha256, `SHA-256 mismatch for ${g.id}`);
    }
  }
});

test('GitHub APK workflow is active, uses Java 21, and packages all 22 games + library', () => {
  const wfPath = path.resolve(process.cwd(), '.github/workflows/build-apk.yml');
  const yml = fs.readFileSync(wfPath, 'utf-8');
  assert.ok(!yml.includes('STOPPED'), 'Workflow name must no longer be STOPPED');
  assert.ok(!yml.includes('on: []'), 'Workflow trigger must be enabled');
  assert.ok(yml.includes("java-version: '21'"), 'Must use Java 21');
  assert.ok(!yml.includes("java-version: '17'"), 'Must not use Java 17');
  assert.ok(yml.includes('public/مكتبة_الألعاب-2.html'), 'Must source populated مكتبة_الألعاب-2.html');
  assert.ok(yml.includes('"index.html"'), 'Must exclude Vite index.html from Android game list');
  assert.ok(yml.includes('assembleDebug'), 'Must build debug APK');
  assert.ok(yml.includes('gh release'), 'Must publish APK to GitHub Releases to bypass artifact storage quota');
  assert.ok(yml.includes('retention-days: 1'), 'Must use 1-day artifact retention');
});
