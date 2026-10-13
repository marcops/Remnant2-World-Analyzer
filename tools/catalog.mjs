// Builds js/catalog.js — every collectible item of the game — from the IoStore indexes (.utoc).
//   node tools/catalog.mjs "<Remnant2 folder>" [profile.sav]
//
// How an item is told apart from the thousands of other assets: Gunfire keeps every item in a folder
// named after it, under …/Items/: Items/Trinkets/Rings/BoosterRing/Ring_BoosterRing,
// Items/Weapons/HandGuns/Special/Enigma/Weapon_Enigma, Items/Traits/Core/Endurance/Trait_Endurance
// (Trait_Endurance_Stats next to it is not an item). So an item is <prefix>_<folder name>
// (or the folder itself is named like the item). Its game path, the one saves use, is
// /Game/<path>.<name>_C. With a profile.sav, every item the save holds must be in the catalog.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const [gameDir, profileFile] = process.argv.slice(2);
if (!gameDir) { console.error('usage: node tools/catalog.mjs "<Remnant2 folder>" [profile.sav]'); process.exit(1); }
const paks = path.join(gameDir, 'Remnant2', 'Content', 'Paks');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// Every file path in the game, through tools/utoc.mjs.
const all = [];
for (const f of fs.readdirSync(paks).filter((x) => /^pakchunk\d+-Windows\.utoc$/.test(x))) {
  const tmp = path.join(here, '..', '.catalog-' + f + '.txt');
  execFileSync(process.execPath, [path.join(here, 'utoc.mjs'), path.join(paks, f), '\\.uasset$', tmp], { stdio: 'ignore', env: process.env });
  for (const line of fs.readFileSync(tmp, 'utf8').split('\n')) if (line) all.push(line);
  fs.unlinkSync(tmp);
}

// Kinds of item: what the file name starts with -> the category shown.
const KINDS = [
  [/^Weapon_/, 'Weapon'], [/^Armor_Head_/, 'Armor'], [/^Armor_Body_/, 'Armor'], [/^Armor_Legs_/, 'Armor'], [/^Armor_Gloves_/, 'Armor'],
  [/^Ring_/, 'Ring'], [/^Amulet_/, 'Amulet'], [/^Mod_/, 'Mod'], [/^MetaGem_/, 'Mutator'], [/^Relic_Consumable_/, 'Relic'],
  [/^RelicFragment_/, 'Relic fragment'], [/^Engram_/, 'Archetype'], [/^Trait_/, 'Trait'],
];
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// Files next to an item that are not items (checked by hand on the full list, see docs/SAVE-FORMAT.md).
const SUPPORT = /_(Inspect|Inpsect|Inspect_\d+|VisualSets?|VisSet|AnimSet|Animset|Stats|AnimBP|AnimsBP|AnimBlueprint|AnimDynamics|Base|Shield|NEW|Charge|Aura|AOE|SoundSet|Loop|Icon|Skeleton|PhysicsAsset|PendingTarget|Open|Indicator|Idle|F|Debuff|Cast|Action|A|Room|Proj|Projectile|Slapper|\d+)$/;
// Not collectible: bare body and fists, archetype skill weapons (Engineer turrets, Warden drone), a weapon's
// second form, the Ragged Poppet (it isn't an archetype).
const EXCLUDE = /^(Weapon_Unarmed|Weapon_Fist|Weapon_Warden_CombatDrone|Weapon_(Boss_)?ComputedStats|Weapon_Heavy_States|Weapon_Melee_SkinnedBase|Ring_Offering_Stone)$|^(Weapon_Deployable_|Engram_Ragged_Poppet)|_Nude$|^Armor_(Head|Body|Legs|Gloves)_(Base|Default)$|_PhaseScythe$|_FireRateOverTime$/;
// A second copy of a weapon's mod kept with an event weapon (the Corrupted Savior's Fusion Cannon).
const DUPLICATE = /^Events\/Valentines\/Items\/Weapons\/Corrupted_Savior\/Mod_FusionCannon$/;
// Kinds whose real items all have an inspect screen (<name>_Inspect): one without it is listed as
// unconfirmed — in the game files, but maybe not obtainable (Remnant 1 leftovers, unreleased content) —
// unless a save holds it.
const NEEDS_INSPECT = new Set(['Weapon', 'Armor', 'Ring', 'Amulet', 'Archetype']);
const items = new Map();
for (const p of all) {
  const m = /^\.\.\/\.\.\/\.\.\/Remnant2\/Content\/(.+)\/([^/]+)\.uasset$/.exec(p);
  if (!m) continue;
  const [, dir, name] = m;
  if (!/(^|\/)Items\//.test(dir)) continue;
  const kind = KINDS.find(([re]) => re.test(name));
  if (!kind) continue;
  const folder = dir.split('/').pop();
  const rest = name.replace(kind[0], '');
  if (EXCLUDE.test(name) || /\/Animations(\/|$)/.test(dir) || DUPLICATE.test(dir + '/' + name)) continue;
  // <prefix>_<folder> or the folder named like the item (Mods/Mod_RingOfSpears/Mod_RingOfSpears); otherwise
  // anything with an item prefix that isn't a support file (Inspect, AnimBP, Stats, …): items in a folder
  // with another name (Rings/PoisonStone/Ring_AcidStone), relic fragments in stat folders, built-in mods.
  const folderRule = norm(rest) === norm(folder) || norm(name) === norm(folder);
  if (!folderRule && SUPPORT.test(name)) continue;
  const key = '/Game/' + dir + '/' + name + '.' + name + '_C';
  const world = (/^(World_[A-Za-z0-9]+)/.exec(dir) || [, ''])[1];
  const slot = /^Armor_(Head|Body|Legs|Gloves)_/.exec(name)?.[1] || '';
  items.set(key, { name: pretty(rest) + (slot ? ' ' + slot : ''), category: kind[1], slot, world, cls: name, key });
}
function pretty(s) { return s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/\s+/g, ' ').trim(); }

// Inspect screens: every <name>_Inspect in the game.
const inspect = new Set();
for (const p of all) { const m = /\/([^/]+?)_Inspect(_\d+)?\.uasset$/.exec(p); if (m) inspect.add(m[1].toLowerCase()); }
const inSave = new Set();
const list = [...items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
const counts = {}; list.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
console.log('items:', list.length, JSON.stringify(counts));

// Check against a save: every item it holds must be here.
if (profileFile) {
  const SAV = require('../js/sav.js'), G = require('../js/gvas.js');
  const r = await SAV.decompress(fs.readFileSync(profileFile));
  const s = G.readFile(r.data), missing = new Set(), seen = new Set();
  (s.root.props.Characters || []).forEach((c) => {
    if (!c || !c.props || !c.props.CharacterData) return;
    const bl = G.readBlob(r.data, c.props.CharacterData);
    const paths = (bl.root.comps.Inventory.Items || []).map((e) => e.ItemBP && String(e.ItemBP.path || e.ItemBP))
      .concat((bl.root.comps.Traits.Traits || []).map((t) => t.TraitBP && String(t.TraitBP.path || t.TraitBP)));
    paths.filter(Boolean).forEach((k) => {
      const n = k.split('.').pop().replace(/_C$/, '');
      if (!KINDS.some(([re]) => re.test(n))) return;
      seen.add(k); inSave.add(k); if (!items.has(k)) missing.add(k);
    });
  });
  console.log('save items of these kinds:', seen.size, '| not in the catalog:', missing.size);
  [...missing].forEach((k) => console.log('   ', k));
}

list.forEach((i) => { if (NEEDS_INSPECT.has(i.category) && !inspect.has(i.cls.toLowerCase()) && !inSave.has(i.key)) i.unconfirmed = true; });
// A weapon's own mod lives in the weapon's folder and never shows up in the bag on its own (checked: the
// save holds Enigma, Monolith, Deceit and Nebula but none of their mods): it comes with the nearest weapon
// up the folders. Deceit and Savior keep two mods each in their folder.
const dirOf = (k) => k.replace(/\/[^/]+$/, '');
const weapons = list.filter((i) => i.category === 'Weapon');
list.filter((i) => i.category === 'Mod' && /\/Weapons\//.test(i.key)).forEach((m) => {
  let d = dirOf(m.key), w = null;
  while (!w && /\/Weapons\//.test(d)) { d = dirOf(d); w = weapons.find((x) => dirOf(x.key) === d || dirOf(x.key).startsWith(d + '/')); }
  if (w) { m.comesWith = w.key; m.weapon = w.name; }
});
const un = list.filter((i) => i.unconfirmed);
console.log('unconfirmed (no inspect screen, not in the save):', un.length, un.map((i) => i.cls).join(', '));
const out = path.join(here, '..', 'js', 'catalog.js');
fs.writeFileSync(out, '// Generated by tools/catalog.mjs from the game files — do not edit by hand.\nvar R2_CATALOG = ' +
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), items: list }, null, 1) + ';\nif (typeof module !== \'undefined\') module.exports = R2_CATALOG;\n');
console.log('wrote', out);
