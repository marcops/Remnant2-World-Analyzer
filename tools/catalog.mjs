// Builds js/catalog.js — every collectible of the game — from two independent sources, checked against each other:
//   1. the game files: the IoStore indexes (.utoc) list every asset with its path, the path saves use;
//   2. tools/source/db.json, the item database of lib.remnant2.analyzer (MIT, © Andrew Savinykh,
//      https://github.com/AndrewSav/lib.remnant2.analyzer): display names, how to get each item, prerequisites.
// And, when given, a profile.sav: every item it holds must be in the catalog.
//   node tools/catalog.mjs "<Remnant2 folder>" [profile.sav]
//
// How an item is told apart from the thousands of other assets: Gunfire keeps every item in a folder named after
// it, under …/Items/: Items/Trinkets/Rings/BoosterRing/Ring_BoosterRing, Items/Weapons/HandGuns/Special/Enigma/
// Weapon_Enigma, Items/Traits/Core/Endurance/Trait_Endurance (Trait_Endurance_Stats next to it is not an item).
// So an item is <prefix>_<folder name> (or the folder named like the item), or — when the folder has another name —
// any file with an item prefix that isn't a support file. Its game path is /Game/<path>.<name>_C.
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
const files = new Set(all.map((p) => p.replace(/^\.\.\/\.\.\/\.\.\/Remnant2\/Content\//, '/Game/').replace(/\.uasset$/, '').toLowerCase()));
const exists = (key) => files.has(key.replace(/\.[^./]+$/, '').toLowerCase());

// Kinds of item: what the file name starts with -> the category shown.
const KINDS = [
  [/^Weapon_/, 'Weapon'], [/^Armor_Head_/, 'Armor'], [/^Armor_Body_/, 'Armor'], [/^Armor_Legs_/, 'Armor'], [/^Armor_Gloves_/, 'Armor'],
  [/^Ring_/, 'Ring'], [/^Amulet_/, 'Amulet'], [/^Mod_/, 'Mod'], [/^MetaGem_/, 'Mutator'], [/^Relic_Consumable_/, 'Relic'],
  [/^RelicFragment_/, 'Relic fragment'], [/^Engram_/, 'Archetype'], [/^Trait_/, 'Trait'],
];
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// Files next to an item that are not items (checked by hand on the full list, see docs/SAVE-FORMAT.md).
const SUPPORT = /_(Inspect|Inpsect|Inspect_\d+|VisualSets?|VisSet|AnimSet|Animset|Stats|AnimBP|AnimsBP|AnimBlueprint|AnimDynamics|Base|Shield|NEW|Charge|Aura|AOE|SoundSet|Loop|Icon|Skeleton|PhysicsAsset|PendingTarget|Open|Indicator|Idle|F|Debuff|Cast|Action|A|Room|Proj|Projectile|Slapper|\d+)$/;
// Not collectible: bare body and fists, archetype skill weapons (Engineer turrets, Warden drone), the mutator base
// classes, a weapon's second form, the Ragged Poppet (not an archetype), a stray copy of the Offering Stone.
const EXCLUDE = /^(Weapon_Unarmed|Weapon_Fist|Weapon_Warden_CombatDrone|Weapon_(Boss_)?ComputedStats|Weapon_Heavy_States|Weapon_Melee_SkinnedBase|Ring_Offering_Stone|MetaGem_Melee|MetaGem_Ranged)$|^(Weapon_Deployable_|Engram_Ragged_Poppet)|_Nude$|^Armor_(Head|Body|Legs|Gloves)_(Base|Default)$|_PhaseScythe$|_FireRateOverTime$/;
// Kinds whose real items have an inspect screen (<name>_Inspect).
const NEEDS_INSPECT = new Set(['Weapon', 'Armor', 'Ring', 'Amulet', 'Archetype']);
// The wiki's list pages (remnant2.wiki.fextralife.com, cached by tools/wiki.mjs): an item listed there is real
// even when neither the database nor a save has it.
const { LISTS, listItems, norm: wnorm, cached } = await import('./wiki.mjs');
const onWiki = {};
for (const [cat, pages] of Object.entries(LISTS)) {
  onWiki[cat] = new Set();
  for (const p of pages) { const html = cached(p); if (html) listItems(html).forEach((w) => onWiki[cat].add(wnorm(w.name))); }
}

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
  if (EXCLUDE.test(name) || /\/Animations(\/|$)/.test(dir)) continue;
  const folderRule = norm(rest) === norm(folder) || norm(name) === norm(folder);
  if (!folderRule && SUPPORT.test(name)) continue;
  const key = '/Game/' + dir + '/' + name + '.' + name + '_C';
  const slot = /^Armor_(Head|Body|Legs|Gloves)_/.exec(name)?.[1] || '';
  items.set(key, { name: pretty(rest) + (slot ? ' ' + slot : ''), category: kind[1], slot, world: worldOf(key), cls: name, key });
}
function pretty(s) { return s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/\s+/g, ' ').trim(); }
function worldOf(key) { const m = /^\/Game\/(World_[A-Za-z0-9]+|Events)\//.exec(key); return m ? m[1] : ''; }

// The item database: names, how to get it, links between weapons and their mods; and kinds the file rule
// doesn't cover (prisms, concoctions, consumables, quest items, the Dragon Heart).
const dbFile = path.join(here, 'source', 'db.json');
const db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : [];
if (!db.length) console.warn('no tools/source/db.json: names and tips come from the file names only');
const dbById = new Map(db.map((x) => [x.Id.toLowerCase(), x]));
const dbByPath = new Map(db.filter((x) => x.ProfileId).map((x) => [x.ProfileId.toLowerCase(), x]));
// One item kept in two places (the Corrupted Savior's Fusion Cannon also sits in the Savior's folder): keep
// the copy the database names.
for (const [key, it] of [...items]) {
  const d = dbById.get(it.cls.toLowerCase());
  if (d && d.ProfileId && d.ProfileId.toLowerCase() !== key.toLowerCase() && items.has(d.ProfileId) ) items.delete(key);
  else if (d && d.ProfileId && d.ProfileId.toLowerCase() !== key.toLowerCase() && exists(d.ProfileId) && !items.has(d.ProfileId)) {
    items.delete(key); items.set(d.ProfileId, Object.assign(it, { key: d.ProfileId, world: worldOf(d.ProfileId) }));
  }
}
const EXTRA = { prism: 'Prism', concoction: 'Concoction', consumable: 'Consumable', dream: 'Consumable', quest_item: 'Quest item' };
for (const d of db) {
  const cat = EXTRA[d.Type] || (d.Id === 'Consumable_DragonHeart' ? 'Relic' : null);
  if (!cat || !d.ProfileId || items.has(d.ProfileId)) continue;
  items.set(d.ProfileId, { name: pretty(d.Id.replace(/^(Consumable|Quest_Item|Quest)_/, '')), category: cat, slot: '', world: worldOf(d.ProfileId), cls: d.ProfileId.split('.').pop().replace(/_C$/, ''), key: d.ProfileId });
}
for (const it of items.values()) {
  const d = dbByPath.get(it.key.toLowerCase()) || dbById.get(it.cls.toLowerCase());
  if (!d) continue;
  it.db = true;
  if (d.Name) it.name = d.Name;
  const how = [d.Note, d.Prerequisite && !/^AccountAward_|^Award_/.test(d.Prerequisite) ? 'Needs ' + pretty(d.Prerequisite.replace(/^(Quest_Item|Quest|Engram|Trait)_/, '')) : ''].filter(Boolean).join(' · ');
  if (how) it.how = how;
  if (d.DropType) it.drop = d.DropType + (d.DropReference ? ': ' + pretty(String(d.DropReference)) : '');
  // Raw, for the world page: Event -> an event Id (Quest_Boss_…), Location -> an area name, World -> dropped in the world.
  if (d.DropType) { it.dropType = d.DropType; if (d.DropReference) it.dropRef = String(d.DropReference); }
  ['Hardcore', 'Coop', 'AccountAward', 'Disabled'].forEach((f) => { if (d[f]) it[f.toLowerCase()] = true; });
  if (d.Difficulty) it.difficulty = d.Difficulty;
}
// A weapon's own mod never shows up in the bag (the save holds Enigma, Monolith, Deceit, Nebula, none of their
// mods): it comes with its weapon. The database says which weapon; otherwise the nearest weapon up the folders.
const byCls = new Map([...items.values()].map((i) => [i.cls.toLowerCase(), i]));
const dirOf = (k) => k.replace(/\/[^/]+$/, '');
const weapons = [...items.values()].filter((i) => i.category === 'Weapon');
for (const m of [...items.values()].filter((i) => i.category === 'Mod')) {
  const d = dbById.get(m.cls.toLowerCase());
  let w = d && d.WeaponOrMod ? byCls.get(d.WeaponOrMod.toLowerCase()) : null;
  // Not in the database: the wiki says "<mod> can be found attached to the <weapon>".
  const page = !d && cached(m.name.replace(/ /g, '_'));
  const att = page && /attached to the <a [^>]*title="([^"]+)"/.exec(page);
  if (att) w = weapons.find((x) => wnorm(x.name) === wnorm(att[1])) || null;
  if (!w && !d && !att && /\/Weapons\//.test(m.key)) {
    let dd = dirOf(m.key);
    while (!w && /\/Weapons\//.test(dd)) { dd = dirOf(dd); w = weapons.find((x) => dirOf(x.key) === dd || dirOf(x.key).startsWith(dd + '/')); }
  }
  if (w) { m.comesWith = w.key; m.weapon = w.name; }
}

// Check against a save: every item it holds must be here; what it holds is obtainable.
const inSave = new Set();
if (profileFile) {
  const SAV = require('../js/sav.js'), G = require('../js/gvas.js');
  const r = await SAV.decompress(fs.readFileSync(profileFile));
  const s = G.readFile(r.data), missing = new Set();
  (s.root.props.Characters || []).forEach((c) => {
    if (!c || !c.props || !c.props.CharacterData) return;
    const bl = G.readBlob(r.data, c.props.CharacterData);
    const paths = (bl.root.comps.Inventory.Items || []).map((e) => e.ItemBP && String(e.ItemBP.path || e.ItemBP))
      .concat((bl.root.comps.Traits.Traits || []).map((t) => t.TraitBP && String(t.TraitBP.path || t.TraitBP)));
    paths.filter(Boolean).forEach((k) => {
      const n = k.split('.').pop().replace(/_C$/, '');
      if (!KINDS.some(([re]) => re.test(n))) return;
      inSave.add(k); if (!items.has(k) && !/^(Weapon_Unarmed|Armor_\w+_Nude)$/.test(n)) missing.add(k);
    });
  });
  console.log('save items not in the catalog:', missing.size, [...missing].join(', '));
}

// Confirmed obtainable: in the database (not disabled), in the save, with an inspect screen, or on the wiki.
const inspect = new Set();
for (const p of all) { const m = /\/([^/]+?)_Inspect(_\d+)?\.uasset$/.exec(p); if (m) inspect.add(m[1].toLowerCase()); }
const list = [...items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
// A file the database doesn't know, named like one it does (Weapon_Shovel next to Weapon_BasicShovel, "Shovel"),
// is a leftover: the wiki's entry is the database's item.
const dbNames = new Set(list.filter((i) => i.db).map((i) => i.category + '|' + wnorm(i.name)));
list.forEach((i) => {
  const wiki = !i.db && !dbNames.has(i.category + '|' + wnorm(i.name)) && onWiki[i.category] && onWiki[i.category].has(wnorm(i.name));
  const ok = (i.db && !i.disabled) || inSave.has(i.key) || wiki || (!i.db && NEEDS_INSPECT.has(i.category) && inspect.has(i.cls.toLowerCase()));
  if (!ok) i.unconfirmed = true;
  delete i.db;
});
// A quest item kept in stages (Seeker's Key 1-3, Fruit of Death whole / a third eaten…) is one entry; the
// other stages' paths go in `also`.
for (let k = list.length - 1; k >= 0; k--) {
  const i = list[k], first = list.find((x) => x.category === 'Quest item' && x.category === i.category && x.name === i.name);
  if (first && first !== i) { (first.also = first.also || []).unshift(i.key); list.splice(k, 1); }
}
const counts = {}; list.filter((i) => !i.unconfirmed).forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
console.log('items:', list.filter((i) => !i.unconfirmed).length, JSON.stringify(counts));
console.log('unconfirmed:', list.filter((i) => i.unconfirmed).map((i) => i.cls).join(', '));
// Database collectibles not in the catalog (they would be missing).
const ours = new Set(list.map((i) => i.cls.toLowerCase()));
const gaps = db.filter((x) => ['amulet', 'ring', 'weapon', 'mod', 'specialmod', 'mutator', 'armor', 'relic', 'fragment', 'trait', 'engram'].includes(x.Type) && !x.Disabled && !ours.has(x.Id.toLowerCase()));
console.log('database collectibles not in the catalog:', gaps.length, gaps.map((x) => x.Id).join(', '));

// The world's events (bosses, minibosses, dungeons, injectables, points of interest, story), by Id: their names
// for the world page.
const events = {};
db.filter((x) => x.Type === 'event' || x.Type === 'quest').forEach((x) => {
  events[x.Id] = { name: x.Name || pretty(x.Id.replace(/^Quest_(Boss|Miniboss|SideD|Injectable|OverworldPOI|Story|Event|RootEarth)_/, '')), type: x.Subtype || x.Type };
});
const out = path.join(here, '..', 'js', 'catalog.js');
fs.writeFileSync(out, '// Generated by tools/catalog.mjs from the game files and lib.remnant2.analyzer\'s db.json (MIT) — do not edit by hand.\nvar R2_CATALOG = ' +
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), items: list, events }, null, 1) + ';\nif (typeof module !== \'undefined\') module.exports = R2_CATALOG;\n');
console.log('wrote', out);
