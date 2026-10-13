// Links the catalog (js/catalog.js, from the game files) to the Remnant 2 wiki (remnant2.wiki.fextralife.com):
// what each item does, how to get it, and its icon. Pages are cached in tools/source/wiki/ (not in git) and
// fetched politely, one at a time.
//   node tools/wiki.mjs              -> js/wiki.js, img/items/*, and a report of what didn't match
//   node tools/wiki.mjs --lists      -> only the list pages and the matching report (no item pages)
//   node tools/wiki.mjs --only=<re>  -> only the catalog items whose class matches, printed (for checking)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CACHE = path.join(ROOT, 'tools', 'source', 'wiki');
const ICONS = path.join(ROOT, 'img', 'items');
const BASE = 'https://remnant2.wiki.fextralife.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
fs.mkdirSync(CACHE, { recursive: true });
// --cached: only what is already downloaded (no network), e.g. while another run is still fetching.
const CACHED_ONLY = process.argv.includes('--cached');

// Category -> the wiki list pages that show its items (icon cards or a table).
export const LISTS = {
  Weapon: ['Long_Guns', 'Hand_Guns', 'Melee_Weapons'],
  Mod: ['Mods'], Mutator: ['Mutators'], Armor: ['Armor', 'Helmets', 'Gauntlets', 'Leg_Armor'],
  Amulet: ['Amulets'], Ring: ['Rings'], Relic: ['Relics'], 'Relic fragment': ['Relic_Fragments'],
  Trait: ['Traits'], Archetype: ['Archetypes'], Prism: ['Prisms'], Concoction: ['Concoctions'],
  Consumable: ['Consumables'], 'Quest item': ['Quest_Items'],
};

const cacheFile = (name) => path.join(CACHE, name.replace(/[^A-Za-z0-9_+%-]/g, '_') + '.html');
export const cached = (name) => (fs.existsSync(cacheFile(name)) ? fs.readFileSync(cacheFile(name), 'utf8') : null);
// Pages the wiki doesn't have, by their exact name. (Not empty cache files: Windows file names ignore case,
// so a missing "Birthright_of_the_Lost" would hide the real "Birthright_Of_The_Lost".)
const MISSING_FILE = path.join(CACHE, '_missing.json');
const MISSING = fs.existsSync(MISSING_FILE) ? JSON.parse(fs.readFileSync(MISSING_FILE, 'utf8')) : {};
// A wiki page, from the cache or the site; null when the wiki has no such page.
export async function page(name) {
  const c = cached(name);
  if (c) return c;
  if (MISSING[name] || CACHED_ONLY) return null;
  await new Promise((r) => setTimeout(r, 700));
  const res = await fetch(BASE + encodeURI(name), { headers: { 'User-Agent': UA } });
  if (!res.ok && res.status !== 404) throw new Error(name + ': HTTP ' + res.status);
  let html = res.ok ? await res.text() : '';
  // The wiki answers missing pages with a "create this page" stub.
  if (/There is currently no text in this page|noarticletext/.test(html)) html = '';
  if (html) fs.writeFileSync(cacheFile(name), html);
  else { MISSING[name] = 1; fs.writeFileSync(MISSING_FILE, JSON.stringify(MISSING, null, 1)); }
  return html || null;
}
// The wiki's own search (MediaWiki opensearch): page names for a text.
async function search(text) {
  if (CACHED_ONLY) return [];
  await new Promise((r) => setTimeout(r, 700));
  const res = await fetch(BASE + 'api.php?action=opensearch&limit=5&format=json&search=' + encodeURIComponent(text), { headers: { 'User-Agent': UA } });
  if (!res.ok) return [];
  const j = await res.json();
  return (j[1] || []).map((t) => t.replace(/ /g, '_'));
}

const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export const norm = (s) => decode(s).toLowerCase().replace(/\((mutator|fragment|mod|ring|amulet|relic|trait|archetype|weapon)\)/g, '')
  .replace(/\bmark 1\b/g, 'mark i').replace(/\bmark 2\b/g, 'mark ii').replace(/[^a-z0-9]/g, '');
const text = (html) => decode(html.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\s([.,;:!?])/g, '$1').trim();

// The items a list page shows: links with an icon (cards and table rows), plus every link inside a table's
// first column (the Armor page lists each piece of a set as a plain link).
export function listItems(html) {
  const at = html.indexOf('id="mw-content-text"');
  const body = html.slice(at > 0 ? at : 0);
  const out = new Map();
  const re = /<a href="\/([^"#?]+)" title="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) if (!/^File:/.test(m[1])) out.set(m[1], { page: m[1], name: decode(m[2]), icon: m[3] });
  for (const t of body.match(/<table[\s\S]*?<\/table>/g) || []) {
    for (const row of t.match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const first = (row.match(/<td[\s\S]*?<\/td>/) || [''])[0];
      for (const a of first.matchAll(/<a href="\/([^"#?]+)" title="([^"]+)"/g)) if (!out.has(a[1]) && !/^File:/.test(a[1])) out.set(a[1], { page: a[1], name: decode(a[2]), icon: null });
    }
  }
  return [...out.values()];
}

// What an item page says: its icon, what it does, how to get it.
export function itemPage(html) {
  const at = html.indexOf('id="mw-content-text"');
  const body = html.slice(at > 0 ? at : 0);
  const box = (body.match(/<div id="infobox"[\s\S]*?<\/table>\s*<\/div>/) || [''])[0];
  const img = /<img[^>]*src="(https:\/\/static\d*\.fextralifeimages\.com\/[^"]+)"/.exec(box || body);
  const icon = img ? img[1] : null;
  // What it does: the infobox's description (a weapon's line, a ring's effect), else the first paragraph after it.
  let desc = '';
  const d = /<div class="infobox_[a-z]+_(?:description|effect)[^"]*">([\s\S]*?)<\/div>/.exec(box);
  if (d) desc = text(d[1]);
  if (!desc && box) { const e = /(?:Effect|Description)\s*<\/[^>]+>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i.exec(box); if (e) desc = text(e[1]); }
  const after = box ? body.slice(body.indexOf(box) + box.length) : body;
  const lore = (/<blockquote>([\s\S]*?)<\/blockquote>/.exec(after) || [])[1];
  if (!desc) { const p = /<p>([\s\S]*?)<\/p>/.exec(after); if (p) desc = text(p[1]); }
  // How to get it: the section headed "How to Get / Where to Find / Location / Unlock".
  let how = [];
  const h = /<h[23][^>]*>\s*(?:<span[^>]*>)?\s*([^<]*(?:How to (?:Get|Find|Obtain|Unlock|Craft|Acquire|Make)|Where to (?:Find|Get)|Locations?\b|Obtain|Acquisition)[^<]*)(?:<\/span>)?\s*<\/h[23]>([\s\S]*?)(?=<h[23][^>]*>|<div id="content-bottom-stuff"|$)/i.exec(after);
  if (h) {
    const sec = h[2];
    const lis = [...sec.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => text(x[1])).filter(Boolean);
    const ps = [...sec.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => text(x[1])).filter((x) => x && !/can be (obtained|found|acquired|purchased) (from|in|at|by)\s*:?$/i.test(x) && !/^.{0,80}:$/.test(x));
    how = ps.concat(lis).slice(0, 8);
  }
  // Unfilled template fields ("{{{location}}}") are not text.
  const clean = (x) => (/\{\{\{|^\W*$/.test(x) ? '' : x);
  how = how.map(clean).filter(Boolean);
  const l = lore ? clean(text(lore)) : '';
  // A weapon's stats (infobox) and its damage at each upgrade level (the upgrades table), for Build & DPS.
  let stats = null;
  const t = text(box), num = (re) => { const m = re.exec(t); return m ? +m[1] : null; };
  const dmg = num(/\bDamage\s+([\d.]+)/);
  if (dmg != null) {
    stats = { damage: dmg, rps: num(/\bRPS\s+([\d.]+)/), magazine: num(/\bMagazine\s+(\d+)/), idealRange: num(/Ideal Range\s+([\d.]+)\s*m/), falloffRange: num(/Falloff Range\s+([\d.]+)\s*m/),
      crit: num(/Critical Hit Chance\s+(-?[\d.]+)\s*%/), weakspot: num(/Weak Spot Damage(?: Bonus)?\s+\+?(-?[\d.]+)\s*%/), stagger: num(/Stagger Modifier\s+(-?[\d.]+)\s*%/), maxAmmo: num(/Max Ammo\s*(\d+)/) };
    const levels = {};
    for (const m of text(body).matchAll(/Upgrade Level (\d+)\s+([\d.]+)/g)) levels[m[1]] = +m[2];
    if (Object.keys(levels).length) stats.levels = levels;
    Object.keys(stats).forEach((k) => { if (stats[k] == null) delete stats[k]; });
  }
  return { icon, desc: clean(desc).slice(0, 500), lore: l.length > 40 ? l.slice(0, 300) : '', how, stats };
}

if (process.argv[1] && process.argv[1].endsWith('wiki.mjs')) {
  const C = require('../js/catalog.js');
  const onlyLists = process.argv.includes('--lists');
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  // 1. Each catalog item -> its wiki page, by name on the category's list pages; then by a near name (the wiki
  //    misspells some: "Rupture Canon", "Disengange"); then a page named like the item.
  const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
  const ALIAS = { Armor_Head_Survivor: 'Survivor Mask' };
  const links = new Map(), report = {};
  for (const [cat, pages] of Object.entries(LISTS)) {
    const wiki = new Map();
    for (const p of pages) { const html = await page(p); if (html) for (const it of listItems(html)) wiki.set(norm(it.name), it); }
    const ours = C.items.filter((i) => i.category === cat);
    const left = new Map(wiki);
    for (const i of ours) { const w = wiki.get(norm(ALIAS[i.cls] || i.name)); if (w) { links.set(i.key, w); left.delete(norm(w.name)); } }
    for (const i of ours.filter((x) => !links.has(x.key))) {
      const n = norm(i.name); let best = null, bd = 3;
      for (const [k, w] of left) { const dd = lev(n, k); if (dd < bd && dd <= Math.max(1, Math.floor(n.length / 8))) { bd = dd; best = [k, w]; } }
      if (best) { links.set(i.key, best[1]); left.delete(best[0]); }
    }
    report[cat] = { ours: ours.length, wiki: wiki.size, onList: ours.filter((i) => links.has(i.key)).length, wikiOnly: [...left.values()].map((w) => w.name) };
  }
  for (const [cat, r] of Object.entries(report)) {
    console.log(`== ${cat}: catalog ${r.ours}, wiki list ${r.wiki}, on the list ${r.onList}`);
    if (r.wikiOnly.length) console.log('   wiki list only:', r.wikiOnly.join(' | '));
  }
  if (onlyLists) process.exit(0);

  // 2. The item pages.
  fs.mkdirSync(ICONS, { recursive: true });
  // An item's picture, at the wiki's full size (a thumbnail URL /thumb/a/a0/X.png/250px-X.png is turned back
  // into the original /a/a0/X.png), saved as img/items/<class>.png (browsers read a JPEG or WebP there just the
  // same). --refresh-icons downloads again over the files that are there. Returns the file name or null.
  const REFRESH = process.argv.includes('--refresh-icons'), refreshed = new Set();
  async function saveIcon(src, cls) {
    const file = cls + '.png', at = path.join(ICONS, file);
    if (fs.existsSync(at) && (!REFRESH || refreshed.has(file))) return file;
    if (CACHED_ONLY) return fs.existsSync(at) ? file : null;
    const full = src.replace(/\/thumb\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)\/[^/]+$/, '/$1/$2/$3').replace(/\?.*$/, '');
    for (const url of full === src ? [src] : [full, src]) {
      await new Promise((res) => setTimeout(res, 150));
      const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: BASE } });
      if (!res.ok) continue;
      fs.writeFileSync(at, Buffer.from(await res.arrayBuffer()));
      refreshed.add(file);
      return file;
    }
    return fs.existsSync(at) ? file : null;
  }
  const out = {}, noPage = [], noHow = [];
  const todo = C.items.filter((i) => !only || new RegExp(only).test(i.cls));
  let n = 0;
  for (const i of todo) {
    if (++n % 50 === 0) console.log('…', n, '/', todo.length);
    const l = links.get(i.key);
    const name = l ? decodeURIComponent(l.page) : i.name.replace(/ /g, '_');
    let found = name, html = await page(name);
    // The wiki capitalizes every word of some titles ("Birthright Of The Lost").
    const title = i.name.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/ /g, '_');
    if (!html && title !== name && (html = await page(title))) found = title;
    // Last: the wiki's search, taking a result named like the item (spelling and case aside).
    if (!html) {
      const hit = (await search(i.name)).find((t) => norm(t) === norm(i.name) || norm(t).replace(/(ring|amulet|mutator|fragment)$/, '') === norm(i.name));
      if (hit) { html = await page(hit); found = hit; }
    }
    // No page: still the icon of the list page, when there is one.
    if (!html) {
      noPage.push(i.cls + ' (' + i.name + ')');
      const icon = l && l.icon && await saveIcon(l.icon, i.cls);
      if (icon) out[i.key] = { icon };
      continue;
    }
    const r = itemPage(html);
    const e = { page: found };
    if (r.desc) e.desc = r.desc;
    if (r.lore) e.lore = r.lore;
    if (r.how.length) e.how = r.how; else noHow.push(i.name);
    if (r.stats && i.category === 'Weapon') e.stats = r.stats;
    const icon = (r.icon && await saveIcon(r.icon, i.cls)) || (l && l.icon && await saveIcon(l.icon, i.cls));
    if (icon) e.icon = icon;
    out[i.key] = e;
    if (only) console.log(i.cls, JSON.stringify(e, null, 1));
  }
  console.log('pages', Object.keys(out).length, '/', todo.length, '· icons', Object.values(out).filter((e) => e.icon).length, '· no how-to', noHow.length);
  console.log('no wiki page:', noPage.join(', '));
  if (!only) {
    fs.writeFileSync(path.join(ROOT, 'js', 'wiki.js'), '// Generated by tools/wiki.mjs from remnant2.wiki.fextralife.com — do not edit by hand.\nvar R2_WIKI = ' +
      JSON.stringify({ generated: new Date().toISOString().slice(0, 10), base: BASE, items: out }) + ';\nif (typeof module !== \'undefined\') module.exports = R2_WIKI;\n');
    console.log('wrote js/wiki.js');
  }
}
