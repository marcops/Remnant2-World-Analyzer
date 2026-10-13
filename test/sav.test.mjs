// node --test test/sav.test.mjs
// The container checks always run on a small file built here; real saves need
//   R2_SAVE=…\save_0.sav  R2_PROFILE=…\profile.sav
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SAV = require('../js/sav.js');
const G = require('../js/gvas.js');

// A save with the same container layout: header + one zlib chunk.
function build(payload) {
  const z = zlib.deflateSync(payload);
  const chunk = Buffer.alloc(49);
  chunk.writeUInt32LE(0x9E2A83C1, 0); chunk.writeUInt32LE(0x22222222, 4);
  chunk.writeBigUInt64LE(0x20000n, 8); chunk[16] = 3;
  chunk.writeBigUInt64LE(BigInt(z.length), 17); chunk.writeBigUInt64LE(BigInt(payload.length), 25);
  chunk.writeBigUInt64LE(BigInt(z.length), 33); chunk.writeBigUInt64LE(BigInt(payload.length), 41);
  const head = Buffer.alloc(12); head.writeUInt32LE(0, 0); head.writeUInt32LE(payload.length + 8, 4); head.writeUInt32LE(9, 8);
  return Buffer.concat([head, chunk, z]);
}

test('container: decompresses and checks sizes', async () => {
  const payload = Buffer.concat([Buffer.alloc(16), Buffer.from('\x0a\x00\x00\x00HelloSave\x00', 'latin1')]);
  const r = await SAV.decompress(build(payload));
  assert.equal(Buffer.compare(Buffer.from(r.data), payload), 0);
  assert.equal(r.head.version, 9);
  assert.deepEqual(SAV.strings(r.data).map((s) => s.text), ['HelloSave']);
  const bad = build(payload); bad.writeUInt32LE(payload.length + 9, 4);
  await assert.rejects(SAV.decompress(bad), /header says/);
});

for (const [name, env] of [['world save', 'R2_SAVE'], ['profile', 'R2_PROFILE']]) {
  test(`real ${name}: decompresses`, { skip: !process.env[env] && `set ${env}` }, async () => {
    const r = await SAV.decompress(fs.readFileSync(process.env[env]));
    assert.ok(r.data.length > 1000);
    const strings = SAV.strings(r.data).map((s) => s.text);
    assert.match(strings[0], /^\/Game\/_Core\/Blueprints\/Base\/BP_RemnantSaveGame/);
    // The property reader covers every byte: data -> object table -> name table -> end.
    const s = G.readFile(r.data), a = s._at;
    assert.equal(a.dataEnd, a.base + a.objOff, 'objects end where the object table starts');
    assert.equal(a.objEnd, a.base + a.namesOff, 'object table ends where the name table starts');
    assert.equal(a.namesEnd, r.data.length, 'name table ends at the last byte');
    assert.ok(s.objects.length > 10 && s.names.length > 50);
  });
}

test('catalog: built from the game files, no duplicate paths or names', () => {
  const C = require('../js/catalog.js');
  const keys = new Set(C.items.map((i) => i.key));
  assert.equal(keys.size, C.items.length, 'duplicate game paths');
  const names = {};
  for (const i of C.items.filter((x) => !x.unconfirmed)) { const k = i.category + '|' + i.name; assert.ok(!names[k], 'two items named ' + k); names[k] = true; }
  for (const i of C.items.filter((x) => x.comesWith)) assert.ok(keys.has(i.comesWith), i.name + ' comes with a weapon not in the catalog');
});

test('wiki: notes are for catalog items and their icons exist', () => {
  const C = require('../js/catalog.js'), W = require('../js/wiki.js');
  const keys = new Set(C.items.map((i) => i.key));
  for (const [k, w] of Object.entries(W.items)) {
    assert.ok(keys.has(k), k + ' is not in the catalog');
    if (w.icon) assert.ok(fs.existsSync(new URL('../img/items/' + w.icon, import.meta.url)), 'missing icon ' + w.icon);
  }
});

test('real profile: every item the character holds is in the catalog', { skip: !process.env.R2_PROFILE && 'set R2_PROFILE' }, async () => {
  const C = require('../js/catalog.js'), CH = require('../js/character.js');
  const r = await SAV.decompress(fs.readFileSync(process.env.R2_PROFILE));
  const keys = new Set(C.items.map((i) => i.key));
  const KIND = /^(Weapon|Armor_(Head|Body|Legs|Gloves)|Ring|Amulet|Mod|MetaGem|Relic_Consumable|RelicFragment|Engram|Trait)_/;
  const NOT_ITEMS = /^(Weapon_Unarmed|Armor_(Body|Gloves|Legs|Head)_Nude)$/; // bare hands and body
  const missing = [];
  for (const ch of CH.read(r.data).characters.filter(Boolean)) {
    for (const k of Object.keys(ch.owned)) {
      const n = k.split('.').pop().replace(/_C$/, '');
      if (KIND.test(n) && !NOT_ITEMS.test(n) && !keys.has(k)) missing.push(k);
    }
  }
  assert.deepEqual(missing, []);
});
