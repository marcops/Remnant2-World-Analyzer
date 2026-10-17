// Remnant 2 World Analyzer — the page. Reads the .sav files (dropped in, or from the local server), shows the
// characters of profile.sav and every collectible of the game (js/catalog.js) as had or missing, with the
// wiki's notes (js/wiki.js). Same layout as Remnant World Analyzer (Remnant 1).
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var num = function (n) { return Math.round(n).toLocaleString('en-US'); };
  function recall(k, d) { try { var v = localStorage.getItem('r2.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem('r2.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  var state = {
    files: {}, info: {}, listing: [], profile: null,
    tab: recall('tab', 'world'), show: recall('show', 'missing'), category: recall('category', null), world: recall('world', null), charIndex: recall('char', 0),
    traitsShow: 'all', itemSel: null,
    missingType: null, missingMode: null, missingWorld: null,
    worlds: {}, mode: recall('mode', null), evType: null, evWorld: null, onlyMissing: recall('onlyMissing', false),
  };

  // Where an item comes from, by its game folder.
  var WORLDS = [
    ['World_Base', 'Base game'], ['World_Root', 'Root Earth'], ['World_Fae', 'Losomn'], ['World_Jungle', 'Yaesha'], ['World_Nerud', "N'Erud"],
    ['World_Labyrinth', 'Labyrinth'], ['World_DLC1', 'The Awakened King (DLC 1)'], ['World_DLC2', 'The Forgotten Kingdom (DLC 2)'],
    ['World_DLC3', 'The Dark Horizon (DLC 3)'], ['World_DLC4', 'DLC 4 folder'], ['Events', 'Events'], ['', 'Other'],
  ];
  var CATEGORIES = ['Weapon', 'Mod', 'Mutator', 'Armor', 'Amulet', 'Ring', 'Relic', 'Relic fragment', 'Trait', 'Archetype', 'Prism', 'Concoction', 'Consumable', 'Quest item'];
  var PLURAL = { Weapon: 'Weapons', Mod: 'Mods', Mutator: 'Mutators', Armor: 'Armor pieces', Amulet: 'Amulets', Ring: 'Rings', Relic: 'Relics', 'Relic fragment': 'Relic fragments', Trait: 'Traits', Archetype: 'Archetypes',
    Prism: 'Prisms', Concoction: 'Concoctions', Consumable: 'Consumables', 'Quest item': 'Quest items' };
  // Quest items leave the bag when handed over: the save can't tell "never had" from "already used".
  var UNCOUNTED = { 'Quest item': true };
  var WIKI = (typeof R2_WIKI !== 'undefined' && R2_WIKI.items) || {};
  var ITEMS = R2_CATALOG.items.filter(function (i) { return !i.unconfirmed; });
  var BY_KEY = {}; R2_CATALOG.items.forEach(function (i) { BY_KEY[i.key] = i; });
  var MAX_LEVEL = 10; // traits and archetypes
  // What drops where (item database): an event's items, an area's items, an item by class.
  var EVENT_ITEMS = {}, LOC_ITEMS = {}, BY_CLS = {};
  ITEMS.forEach(function (i) {
    BY_CLS[i.cls.toLowerCase()] = i;
    if (i.dropType === 'Event' && i.dropRef) (EVENT_ITEMS[i.dropRef] = EVENT_ITEMS[i.dropRef] || []).push(i);
    if (i.dropType === 'Location' && i.dropRef) (LOC_ITEMS[i.dropRef] = LOC_ITEMS[i.dropRef] || []).push(i);
  });
  var EVENTS = R2_CATALOG.events || {};
  var EVENT_TYPE = { boss: 'Boss', miniboss: 'Miniboss', dungeon: 'Dungeon', injectable: 'Event', 'overworld POI': 'Point of interest', location: 'Area', story: 'Story', special: 'Special', 'boss rush': 'Boss rush' };
  var WORLD_NAME = { Fae: 'Losomn', Nerud: "N'Erud", Jungle: 'Yaesha', RootEarth: 'Root Earth', Labyrinth: 'Labyrinth', City: 'Ward 13' };
  function eventInfo(name) {
    var e = EVENTS[name] || EVENTS[name + '_C'] || null;
    return { name: e ? e.name : name.replace(/^Quest_(Boss|Miniboss|SideD|Injectable|OverworldPOI|Story|Event|RootEarth)_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'), type: e ? (EVENT_TYPE[e.type] || e.type) : /^Quest_Injectable/.test(name) ? 'Event' : /^Quest_SideD/.test(name) ? 'Dungeon' : /^Quest_Boss/.test(name) ? 'Boss' : /^Quest_Miniboss/.test(name) ? 'Miniboss' : 'Event' };
  }
  function currentWorld() { return state.worlds[state.charIndex] || null; }
  function worldOf(it) { return it.world || (/^\/Game\/Events\//.test(it.key) ? 'Events' : ''); }
  function worldLabel(w) { var x = WORLDS.filter(function (p) { return p[0] === w; })[0]; return x ? x[1] : w; }

  function setStatus(text, live) { var el = $('status'); el.hidden = false; el.textContent = text; el.classList.toggle('live', !!live); }
  function showError(msg) { var el = $('load-error'); el.textContent = msg; el.hidden = !msg; }
  function character() { var p = state.profile; return p && p.characters[state.charIndex] || null; }
  function owned(it) {
    var ch = character(); if (!ch) return null;
    var o = !!(ch.owned[it.key] || (it.comesWith && ch.owned[it.comesWith]) || (it.also || []).some(function (k) { return ch.owned[k]; }));
    return UNCOUNTED[it.category] && !o ? null : o;
  }
  function levelOf(it) {
    var ch = character(); if (!ch) return null;
    if (it.category === 'Trait') { var t = ch.traits.filter(function (x) { return x.key === it.key; })[0]; return t ? t.level : null; }
    if (it.category === 'Archetype') { var n = it.cls.replace(/^Engram_/, ''), a = ch.archetypeLevels.filter(function (x) { return x.cls === 'Archetype_' + n; })[0]; return a ? a.level : null; }
    var row = ch.inventory.filter(function (x) { return x.key === it.key; })[0];
    return row && row.level != null ? row.level : null;
  }
  function icon(it, cls) { var w = WIKI[it.key]; return w && w.icon ? '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="img/items/' + esc(w.icon) + '" alt="" loading="lazy">' : '<span class="' + (cls || 'noimg') + '"></span>'; }
  function flags(it) { return [it.hardcore && 'Hardcore only', it.coop && 'needs co-op', it.accountaward && 'account award'].filter(Boolean); }
  // How to get it: the item database's line first, then the wiki's (without repeating it).
  function howTo(it) {
    var w = WIKI[it.key] || {}, how = (w.how || []).slice();
    if (it.how && !how.some(function (h) { return h.toLowerCase() === it.how.toLowerCase(); })) how.unshift(it.how);
    return how;
  }
  function matches(it, q) {
    var w = WIKI[it.key] || {};
    return !q || (it.name + ' ' + it.cls + ' ' + (it.weapon || '') + ' ' + (it.how || '') + ' ' + (w.desc || '') + ' ' + (w.how || []).join(' ')).toLowerCase().indexOf(q) >= 0;
  }
  function wikiLink(it) { var w = WIKI[it.key]; return w && w.page ? ' <a class="wiki" href="' + esc(R2_WIKI.base + w.page) + '" target="_blank" rel="noopener" title="Open on the wiki">🌐</a>' : ''; }
  function statusIcon(o) { return o === true ? '<span class="st ok">✔</span>' : o === false ? '<span class="st miss">✘</span>' : '<span class="st">·</span>'; }

  // ---- loading ---------------------------------------------------------------
  function rebuild() {
    var names = Object.keys(state.files).sort();
    state.profile = null;
    return Promise.all(names.map(function (n) {
      return R2_SAV.decompress(state.files[n]).then(function (r) {
        var save = null, err = null;
        try { save = R2_GVAS.readFile(r.data); } catch (e) { err = e.message; }
        state.info[n] = { ok: true, size: state.files[n].byteLength, raw: r.data.length, chunks: r.chunks, version: r.head.version, strings: R2_SAV.strings(r.data), save: save, readError: err, data: r.data };
        if (n === 'profile.sav') { try { state.profile = R2_CHARACTER.read(r.data); } catch (e) { state.info[n].readError = 'Characters: ' + e.message; } }
        var sm = /^save_(\d+)\.sav$/.exec(n);
        if (sm) { try { state.worlds[+sm[1]] = R2_WORLD.read(r.data, R2_GVAS); } catch (e) { state.info[n].readError = 'World: ' + e.message; } }
      }).catch(function (e) { state.info[n] = { ok: false, error: e.message }; });
    })).then(function () {
      var p = state.profile;
      if (p && !p.characters[state.charIndex]) state.charIndex = p.characters.findIndex(Boolean);
      showError('');
      $('loader').hidden = true;
      document.body.classList.add('loaded');
      if (state.tab === 'home') state.tab = 'world';
      render();
    });
  }

  // ---- pages -----------------------------------------------------------------
  // About, credits and release notes work before any save is loaded; the rest need the saves (until then
  // "Load your save" shows the drop zone).
  var INFO_TABS = ['home', 'about', 'credits', 'notes'];
  function showPage() {
    var loaded = document.body.classList.contains('loaded');
    var page = !loaded && INFO_TABS.indexOf(state.tab) < 0 ? 'home' : state.tab;
    var info = page === 'about' || page === 'credits' || page === 'notes';
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === page); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + page; });
    $('app').hidden = !loaded || info || page === 'home';
    if (info) $('loader').hidden = true;
    else if (!loaded || page === 'home') $('loader').hidden = false;
    else $('loader').hidden = true;
  }

  function render() {
    if (!$('tab-' + state.tab) && INFO_TABS.indexOf(state.tab) < 0) state.tab = 'world';
    showPage();
    if (!document.body.classList.contains('loaded')) return;
    $('profile-note').hidden = !!character();
    renderCharacters(); renderWho();
    renderWorld(); renderMap(); renderState(); renderTips(); renderEditorTab();
    renderItems(); renderChecklist(); renderTraits(); renderCharacterTab(); renderBuild(); renderFiles();
    renderDrawer();
  }

  function renderCharacters() {
    var p = state.profile;
    $('character').innerHTML = p ? p.characters.map(function (c, i) {
      return c ? '<option value="' + i + '"' + (i === state.charIndex ? ' selected' : '') + '>Character ' + (i + 1) + ' — ' + esc(c.archetype + (c.secondary ? ' / ' + c.secondary : '')) + '</option>' : '';
    }).join('') : '<option>No profile.sav</option>';
  }

  // Character card above the menu: archetypes, power level, how much you've collected.
  function renderWho() {
    var ch = character();
    if (!ch) { $('who').innerHTML = ''; return; }
    var list = ITEMS.filter(function (i) { return !UNCOUNTED[i.category]; }), have = list.filter(function (i) { return owned(i); }).length;
    var pct = Math.round(100 * have / Math.max(1, list.length));
    $('who').innerHTML = '<div class="name">' + esc(ch.archetype + (ch.secondary ? ' / ' + ch.secondary : '')) + '</div>' +
      '<div class="sub">' + esc('Power level ' + ch.powerLevel + ' · trait rank ' + num(ch.traitRank)) + '</div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="xpl"><span>' + have + ' of ' + list.length + ' items</span><span>' + pct + '%</span></div>';
  }

  // ---- current world -----------------------------------------------------------
  // The roll on screen: campaign or adventure (the one you played last first).
  function rolled() {
    var w = currentWorld(); if (!w) return null;
    var key = state.mode && w.modes[state.mode] ? state.mode : w.active;
    return w.modes[key] || w.modes[Object.keys(w.modes)[0]] || null;
  }
  function worldLabelOf(loc) { return WORLD_NAME[loc.category] || loc.category || ''; }
  function modeSwitch() {
    var w = currentWorld(); if (!w) return '';
    var cur = rolled();
    return '<div class="seg" id="mode-switch">' + ['campaign', 'adventure'].filter(function (k) { return w.modes[k]; }).map(function (k) {
      var m = w.modes[k];
      return '<button type="button" data-mode="' + k + '" class="' + (cur && cur.key === k ? 'active' : '') + '">' + esc(m.label) + (w.active === k ? ' ●' : '') + (m.difficulty ? ' <small>' + esc(m.difficulty) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
  }
  // Everything an area offers, as rows: its events with their items, items of the area itself, rings and
  // amulets on the ground, trait book, simulacrum. `picked`: taken in this world already.
  function areaRows(loc) {
    var rows = [], markers = {};
    loc.markers.forEach(function (m) { markers[m.path] = m.looted; });
    var pick = function (it, looted) { return { it: it, picked: it.key in markers ? markers[it.key] : looted }; };
    loc.events.forEach(function (e) {
      var info = eventInfo(e.name);
      rows.push({ type: info.type, name: info.name, done: e.done, items: (EVENT_ITEMS[e.name] || []).map(function (it) { return pick(it, e.done && !/^(Dungeon|Area)$/.test(info.type)); }) });
    });
    var li = LOC_ITEMS[loc.name] || [];
    if (li.length) rows.push({ type: 'Area', name: loc.name, items: li.map(function (it) { return pick(it, false); }) });
    loc.worldDrops.forEach(function (d) {
      var it = BY_CLS[d.name.toLowerCase()];
      rows.push({ type: 'On the ground', name: it ? it.category : d.name, items: it ? [{ it: it, picked: d.looted }] : [], label: it ? null : d.name, done: d.looted });
    });
    if (loc.traitBook) rows.push({ type: 'Trait book', name: 'Trait book', rare: true, done: loc.traitBook.looted, items: [] });
    if (loc.simulacrum) rows.push({ type: 'Simulacrum', name: 'Simulacrum', rare: true, done: loc.simulacrum.looted, items: [] });
    return rows;
  }
  function itemLine(x) {
    var o = owned(x.it);
    return '<div class="evitem' + (o === false ? ' miss' : '') + (x.picked ? ' picked' : '') + '">' + statusIcon(o) + '<a href="#" data-item="' + esc(x.it.key) + '">' + icon(x.it, 'ico') + esc(x.it.name) + '</a>' +
      (x.picked ? '<span class="pk">picked up here</span>' : '') + (flags(x.it).length ? ' <span class="flag">' + esc(flags(x.it).join(' · ')) + '</span>' : '') + wikiLink(x.it) + '</div>';
  }
  function renderWorld() {
    var el = $('world-view'), m = rolled();
    if (!currentWorld()) { el.innerHTML = '<div class="empty">Load <b>save_' + state.charIndex + '.sav</b> (this character\'s world) to see what rolled.</div>'; return; }
    if (!m) { el.innerHTML = modeSwitch() + '<div class="empty">No rolled world in this save.</div>'; return; }
    var q = (state.worldQ || '').toLowerCase();
    var types = {}, rowsAll = [];
    m.worlds.forEach(function (w) {
      w.locations.forEach(function (loc) {
        areaRows(loc).forEach(function (r) { r.loc = loc; r.world = worldLabelOf(loc); types[r.type] = true; rowsAll.push(r); });
      });
    });
    var worldsList = []; rowsAll.forEach(function (r) { if (worldsList.indexOf(r.world) < 0) worldsList.push(r.world); });
    var keep = function (r) {
      if (state.evType && r.type !== state.evType) return false;
      if (state.evWorld && r.world !== state.evWorld) return false;
      if (state.onlyMissing && !r.items.some(function (x) { return owned(x.it) === false; }) && !(r.rare && !r.done)) return false;
      return !q || (r.loc.name + ' ' + r.name + ' ' + r.type + ' ' + r.items.map(function (x) { return x.it.name; }).join(' ')).toLowerCase().indexOf(q) >= 0;
    };
    var chips = function (id, list, cur) {
      return '<div class="chips" id="' + id + '"><span class="chip' + (!cur ? ' on' : '') + '" data-v="">All</span>' + list.map(function (v) { return '<span class="chip' + (cur === v ? ' on' : '') + '" data-v="' + esc(v) + '">' + esc(v) + '</span>'; }).join('') + '</div>';
    };
    var body = '';
    m.worlds.forEach(function (w) {
      var rows = [];
      w.locations.forEach(function (loc) { areaRows(loc).forEach(function (r) { r.loc = loc; r.world = worldLabelOf(loc); if (keep(r)) rows.push(r); }); });
      if (!rows.length) return;
      var story = w.story ? eventInfo(w.story.name) : null;
      body += '<tr class="zone-row"><td colspan="4">' + esc(worldLabelOf(w.locations[0]) || 'World') + (story ? ' <span class="cat">· story: ' + esc(story.name) + '</span>' + (w.story.done ? '<span class="done-tag">✔ done</span>' : '') : '') + '</td></tr>';
      var lastLoc = null;
      rows.forEach(function (r) {
        body += '<tr class="' + (r.rare && !r.done ? 'rare-row' : '') + '"><td class="loc">' + (r.loc !== lastLoc ? esc(r.loc.name) : '') + '</td><td class="type"><span class="type-badge">' + esc(r.type) + '</span></td>' +
          '<td class="name">' + (r.rare ? '<b>' + esc(r.name) + '</b>' : esc(r.label || r.name)) + (r.done ? '<span class="done-tag">✔ ' + (r.rare || r.type === 'On the ground' ? 'picked up' : 'done') + '</span>' : '') + '</td>' +
          '<td class="items">' + (r.items.length ? r.items.map(itemLine).join('') : r.rare ? '<span class="cat">' + (r.done ? 'already taken' : 'still there') + '</span>' : '<span class="cat">no items</span>') + '</td></tr>';
        lastLoc = r.loc;
      });
    });
    var all = []; rowsAll.forEach(function (r) { r.items.forEach(function (x) { if (all.indexOf(x.it) < 0) all.push(x.it); }); });
    var missing = all.filter(function (i) { return owned(i) === false; });
    el.innerHTML = modeSwitch() +
      '<p class="cat">' + esc(m.label) + (m.difficulty ? ' · ' + esc(m.difficulty) : '') + (m.playTime ? ' · ' + Math.floor(m.playTime / 3600) + 'h ' + Math.floor(m.playTime % 3600 / 60) + 'm played' : '') +
      (character() ? ' · <b>' + missing.length + '</b> items you don\'t have can drop here, of ' + all.length : '') + '</p>' +
      '<div class="filters"><input id="world-search" type="search" placeholder="Search area, event or item…" value="' + esc(state.worldQ || '') + '">' +
      '<div class="filter-row"><span class="filter-label">World</span>' + chips('world-worlds', worldsList, state.evWorld) + '</div>' +
      '<div class="filter-row"><span class="filter-label">Type</span>' + chips('world-types', Object.keys(types), state.evType) + '</div>' +
      '<label class="check"><input id="world-only-missing" type="checkbox"' + (state.onlyMissing ? ' checked' : '') + '> Only what has an item I don\'t have (and trait books / simulacrums still there)</label></div>' +
      (body ? '<table class="events"><thead><tr><th>Area</th><th>Type</th><th>Event</th><th>Items</th></tr></thead><tbody>' + body + '</tbody></table>' : '<div class="empty">Nothing with these filters.</div>');
  }

  // ---- map ---------------------------------------------------------------------
  // Each world as its areas linked together (from the save's zone links), then one panel per area: the cells
  // you've walked (the game's explored map) and what's there.
  function areaGraph(w, wi) {
    var locs = w.locations, idx = {}, depth = {}, order = [];
    locs.forEach(function (l, i) { idx[l.name] = i; });
    if (!locs.length) return '';
    depth[locs[0].name] = 0; order.push(locs[0].name);
    for (var k = 0; k < order.length; k++) {
      var l = locs[idx[order[k]]];
      l.links.forEach(function (n) { if (n in idx && !(n in depth)) { depth[n] = depth[l.name] + 1; order.push(n); } });
    }
    locs.forEach(function (l) { if (!(l.name in depth)) { depth[l.name] = 0; order.push(l.name); } });
    // What each square shows: the area's name, its events (type: name, ✔ when done), the simulacrum and trait
    // book still there, and the icons of the items you don't have that it can still give.
    var W = 220, GX = 44, GY = 14, ICO = 22, PER_ROW = 8, info = {};
    var trunc = function (s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    locs.forEach(function (l) {
      var rows = areaRows(l), wants = [];
      rows.forEach(function (r) { r.items.forEach(function (x) { if (owned(x.it) === false && !x.picked && wants.indexOf(x.it) < 0) wants.push(x.it); }); });
      var evs = rows.filter(function (r) { return !r.rare && r.type !== 'On the ground' && r.type !== 'Area'; });
      var rare = rows.filter(function (r) { return r.rare && !r.done; });
      var lines = evs.map(function (r) { return { t: (r.done ? '✔ ' : '') + r.type + ': ' + r.name, cls: r.done ? 'sub done' : r.type === 'Boss' ? 'sub boss' : 'sub' }; })
        .concat(rare.map(function (r) { return { t: (r.name === 'Simulacrum' ? '◆ ' : '▣ ') + r.name + ' still here', cls: 'rare' }; }));
      var iconRows = Math.ceil(wants.length / PER_ROW);
      info[l.name] = { rows: rows, wants: wants, lines: lines, boss: evs.some(function (r) { return r.type === 'Boss'; }), h: 24 + lines.length * 14 + (wants.length ? 6 + iconRows * (ICO + 3) : 0) + 6 };
    });
    var colY = {}, pos = {}, maxD = 0;
    order.forEach(function (n) { var d = depth[n]; maxD = Math.max(maxD, d); colY[d] = colY[d] || 0; pos[n] = { x: d * (W + GX), y: colY[d] }; colY[d] += info[n].h + GY; });
    var width = (maxD + 1) * (W + GX) - GX, height = Math.max.apply(null, Object.keys(colY).map(function (d) { return colY[d]; })) - GY;
    var lines = '', seen = {};
    locs.forEach(function (l) {
      l.links.forEach(function (n) {
        if (!(n in pos) || seen[n + '|' + l.name]) return; seen[l.name + '|' + n] = true;
        lines += '<line x1="' + (pos[l.name].x + W / 2) + '" y1="' + (pos[l.name].y + 14) + '" x2="' + (pos[n].x + W / 2) + '" y2="' + (pos[n].y + 14) + '"/>';
      });
    });
    var nodes = locs.map(function (l) {
      var p = pos[l.name], f = info[l.name], y = 17, body = '';
      body += '<text class="name" x="8" y="' + y + '">' + esc(trunc(l.name, 30)) + '</text>';
      f.lines.forEach(function (ln) { y += 14; body += '<text class="' + ln.cls + '" x="8" y="' + y + '">' + esc(trunc(ln.t, 38)) + '</text>'; });
      if (f.wants.length) {
        y += 8;
        f.wants.forEach(function (it, i) {
          var x = 8 + (i % PER_ROW) * (ICO + 3), yy = y + Math.floor(i / PER_ROW) * (ICO + 3), w = WIKI[it.key];
          body += w && w.icon ? '<image href="img/items/' + esc(w.icon) + '" x="' + x + '" y="' + yy + '" width="' + ICO + '" height="' + ICO + '"><title>' + esc(it.name) + ' — you don\'t have it</title></image>'
            : '<rect class="noico" x="' + x + '" y="' + yy + '" width="' + ICO + '" height="' + ICO + '"><title>' + esc(it.name) + '</title></rect>';
        });
      }
      return '<a href="#area-' + wi + '-' + idx[l.name] + '" data-area="area-' + wi + '-' + idx[l.name] + '"><g class="node' + (f.boss ? ' boss' : '') + (f.wants.length ? ' want' : '') + (l.tiles.length ? '' : ' unseen') + '" transform="translate(' + p.x + ',' + p.y + ')">' +
        '<title>' + esc(l.name) + '</title><rect class="box" width="' + W + '" height="' + f.h + '"/>' + body + '</g></a>';
    }).join('');
    return '<div class="agraph-wrap"><svg class="agraph" viewBox="-2 -2 ' + (width + 4) + ' ' + (height + 4) + '" width="' + (width + 4) + '" height="' + (height + 4) + '">' + lines + nodes + '</svg></div>';
  }
  // The cells you've walked in an area, as the game's explored map (x, y of each visited cell).
  function fog(loc) {
    var cells = [];
    loc.cells.forEach(function (c) { cells = cells.concat(c.cells); });
    if (!cells.length) return '';
    var xs = cells.map(function (c) { return c[0]; }), ys = cells.map(function (c) { return c[1]; });
    var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys), w = Math.max.apply(null, xs) - x0 + 1, h = Math.max.apply(null, ys) - y0 + 1;
    var s = Math.max(1, Math.min(6, Math.floor(260 / Math.max(w, h))));
    return '<div><div class="cat">Explored (' + cells.length + ' cells)</div><svg class="zfog" width="' + (w * s + 8) + '" height="' + (h * s + 8) + '">' +
      cells.map(function (c) { return '<rect x="' + ((c[0] - x0) * s + 4) + '" y="' + ((c[1] - y0) * s + 4) + '" width="' + s + '" height="' + s + '"/>'; }).join('') + '</svg></div>';
  }
  // The tiles the game generated for this area, one square each, in the order it built them (the save keeps
  // which tiles an area is made of and what is still lying in each, not where each one sits).
  function tileSquares(loc) {
    if (!loc.tiles.length) return '<p class="cat">Tiles: not visited yet — the game saves an area\'s tiles once you\'ve been there.</p>';
    var tiles = loc.tiles.slice().sort(function (a, b) { return a.n - b.n; });
    return '<h3 class="section-title more">Tiles <small class="cat">' + tiles.length + ' generated · what is still lying in each</small></h3><div class="tsqs">' + tiles.map(function (t) {
      var c = t.contents, lines = [], npcs = c.npcs.filter(function (x, i) { return c.npcs.indexOf(x) === i; });
      c.items.forEach(function (n) {
        var it = BY_CLS[n.toLowerCase()], o = it ? owned(it) : null;
        // Keys and other quest items lying here: 🔑, in bold.
        var quest = /^Quest_Item_/.test(n) || (it && it.category === 'Quest item');
        if (quest) return lines.push('<div class="tl want">🔑 ' + (it ? '<a href="#" data-item="' + esc(it.key) + '">' + icon(it, 'ico') + esc(it.name) + '</a>' : esc(n.replace(/^Quest_Item_/, '').replace(/_/g, ' '))) + '</div>');
        lines.push('<div class="tl' + (o === false ? ' want' : '') + '">' + (it ? '<a href="#" data-item="' + esc(it.key) + '">' + statusIcon(o) + icon(it, 'ico') + esc(it.name) + '</a>' : '· ' + esc(n.replace(/_/g, ' '))) + '</div>');
      });
      if (c.traitBooks) lines.push('<div class="tl rare">▣ Trait book' + (c.traitBooks > 1 ? ' ×' + c.traitBooks : '') + '</div>');
      if (c.simulacrums) lines.push('<div class="tl rare">◆ Simulacrum</div>');
      if (c.chests) lines.push('<div class="tl">▢ ' + c.chests + ' chest' + (c.chests > 1 ? 's' : '') + '</div>');
      if (npcs.length) lines.push('<div class="tl now">☺ ' + esc(npcs.join(', ')) + '</div>');
      var has = c.traitBooks || c.simulacrums || c.items.some(function (n) { var it = BY_CLS[n.toLowerCase()]; return /^Quest_Item_/.test(n) || (it && owned(it) === false); });
      return '<div class="tsq t-' + (t.type.key || 'tile') + (has ? ' has' : '') + (lines.length ? '' : ' empty') + '" title="' + esc(t.level) + '">' +
        '<div class="th">' + (t.n >= 0 && t.n < 1000 ? '#' + t.n + ' ' : '') + esc(t.type.label) + '</div><div class="tn">' + esc(t.name) + '</div>' + lines.join('') + '</div>';
    }).join('') + '</div>';
  }
  function renderMap() {
    var el = $('map-view'), m = rolled();
    if (!currentWorld()) { el.innerHTML = '<div class="empty">Load <b>save_' + state.charIndex + '.sav</b> (this character\'s world) to see its map.</div>'; return; }
    if (!m) { el.innerHTML = modeSwitch() + '<div class="empty">No rolled world in this save.</div>'; return; }
    // A campaign spans several worlds: one at a time (the one you respawn in first), or all — as in Remnant 1.
    state.mapWorld = state.mapWorld || {};
    var wkey = m.key + ':' + state.charIndex;
    if (state.mapWorld[wkey] === undefined) {
      var resp = m.respawn, here = -1;
      m.worlds.forEach(function (w, wi) { if (here < 0 && w.locations.some(function (l) { return l.checkpoints.indexOf(resp) >= 0 || l.waypoints.some(function (p) { return p.id === resp; }); })) here = wi; });
      state.mapWorld[wkey] = here >= 0 ? here : 0;
    }
    var pick = m.worlds.length > 1 ? state.mapWorld[wkey] : null;
    var bar = m.worlds.length > 1 ? '<div class="seg map-worlds">' + m.worlds.map(function (w, wi) {
      return '<button type="button" data-map-world="' + wi + '" class="' + (pick === wi ? 'active' : '') + '">' + esc(worldLabelOf(w.locations[0]) || 'World') + ' <span class="cat">' + w.locations.length + '</span></button>';
    }).join('') + '<button type="button" data-map-world="all" class="' + (pick === 'all' ? 'active' : '') + '">All worlds</button></div>' : '';
    var html = modeSwitch() + bar + '<div class="legend"><span class="lg">area</span><span class="cat">red border: boss · orange: has items you don\'t have · dashed: not visited yet · ◆ simulacrum · ▣ trait book still there</span></div>';
    m.worlds.forEach(function (w, wi) {
      if (pick !== null && pick !== 'all' && pick !== wi) return;
      var story = w.story ? eventInfo(w.story.name) : null;
      html += '<section class="panel zone wide"><h3>' + esc(worldLabelOf(w.locations[0]) || 'World') + (story ? ' · ' + esc(story.name) + (w.story.done ? ' ✔' : '') : '') + '</h3>' + areaGraph(w, wi) + '</section>';
      w.locations.forEach(function (loc, li) {
        var rows = areaRows(loc);
        var items = rows.map(function (r) {
          return '<li' + (r.rare && !r.done ? ' class="want rare"' : '') + '>' + (r.rare ? (r.done ? '✔ ' : '◆ ') + '<b>' + esc(r.name) + '</b>' + (r.done ? ' <span class="cat">taken</span>' : ' <span class="cat">still there</span>') :
            '<span class="type-badge">' + esc(r.type) + '</span> ' + esc(r.label || r.name) + (r.done ? '<span class="done-tag">✔</span>' : '')) +
            r.items.map(itemLine).join('') + '</li>';
        }).join('');
        html += '<section class="panel zone" id="area-' + wi + '-' + li + '"><h3>' + esc(loc.name) + ' <span class="cat">' + esc(worldLabelOf(loc)) + (loc.links.length ? ' · leads to ' + esc(loc.links.join(', ')) : '') + '</span></h3>' +
          '<div class="zviews">' + fog(loc) + '<div class="zhere"><div class="here-groups">' +
          '<div class="here-box hb-items"><div class="here-h">Items<small>' + rows.length + '</small></div><ul class="here">' + (items || '<li class="cat">Nothing listed.</li>') + '</ul></div>' +
          '</div></div></div>' + tileSquares(loc) + '</section>';
      });
    });
    el.innerHTML = html;
  }

  // ---- world state -------------------------------------------------------------
  // Per mode: difficulty, time, where you respawn, quest items carried; per world: story, events done, areas
  // visited, trait books and simulacrums taken.
  function renderState() {
    var el = $('state-view'), w = currentWorld();
    if (!w) { el.innerHTML = '<div class="empty">Load <b>save_' + state.charIndex + '.sav</b> to see your world\'s state.</div>'; return; }
    var meterRow = function (label, have, total) { return total ? '<div class="meter' + (have === total ? ' done' : '') + '"><span class="ml">' + esc(label) + '</span><span class="mv">' + have + ' / ' + total + '</span><div class="bar"><i style="width:' + Math.round(100 * have / total) + '%"></i></div></div>' : ''; };
    var html = '<div class="summary">' +
      '<div class="card static"><div class="w">Last played</div><div class="n neutral">' + esc(w.modes[w.active] ? w.modes[w.active].label : '—') + '</div><div class="of">' + esc(w.questLabel) + '</div></div>' +
      '<div class="card static"><div class="w">Time played</div><div class="n neutral">' + Math.floor(w.timePlayed / 3600) + 'h ' + Math.floor(w.timePlayed % 3600 / 60) + 'm</div><div class="of">this character</div></div></div><div class="panels">';
    ['campaign', 'adventure'].forEach(function (k) {
      var m = w.modes[k]; if (!m) return;
      var body = '<table class="kv"><tr><th>Difficulty</th><td>' + esc(m.difficulty || '—') + '</td></tr>' + (m.playTime ? '<tr><th>Time played</th><td>' + Math.floor(m.playTime / 3600) + 'h ' + Math.floor(m.playTime % 3600 / 60) + 'm</td></tr>' : '') +
        '<tr><th>Respawn at</th><td>' + esc(m.respawn.replace(/^\d+_/, '').replace(/_/g, ' ') || '—') + '</td></tr>' +
        '<tr><th>Quest items carried</th><td>' + (m.questItems.length ? m.questItems.map(function (q) { var it = BY_KEY[q.path]; return esc(it ? it.name : last(q.path).replace(/^Quest_Item_/, '').replace(/_C$/, '').replace(/_/g, ' ')); }).join(', ') : 'none') + '</td></tr></table>';
      m.worlds.forEach(function (wd) {
        var ev = 0, evDone = 0, seen = 0, tb = 0, tbDone = 0, sim = 0, simDone = 0, gr = 0, grDone = 0;
        wd.locations.forEach(function (l) {
          l.events.forEach(function (e) { ev++; if (e.done) evDone++; });
          if (l.tiles.length) seen++;
          if (l.traitBook) { tb++; if (l.traitBook.looted) tbDone++; }
          if (l.simulacrum) { sim++; if (l.simulacrum.looted) simDone++; }
          l.worldDrops.forEach(function (d) { gr++; if (d.looted) grDone++; });
        });
        var story = wd.story ? eventInfo(wd.story.name) : null;
        body += '<h3 class="section-title more">' + esc(worldLabelOf(wd.locations[0])) + (story ? ' — ' + esc(story.name) + (wd.story.done ? ' ✔' : '') : '') + '</h3>' +
          meterRow('Areas visited', seen, wd.locations.length) + meterRow('Events done', evDone, ev) + meterRow('Rings & amulets picked up', grDone, gr) +
          meterRow('Trait books taken', tbDone, tb) + meterRow('Simulacrums taken', simDone, sim);
      });
      html += '<section class="panel"><h3>' + esc(m.label) + (w.active === k ? ' ● last played' : '') + '</h3>' + body + '</section>';
    });
    el.innerHTML = html + '</div>';
  }
  function last(p) { return String(p).split('/').pop().split('.').pop(); }

  // ---- tips --------------------------------------------------------------------
  // What to do next, from your saves.
  function renderTips() {
    var el = $('tips-view'), w = currentWorld(), m = rolled(), ch = character(), tips = [];
    if (m) {
      var books = [], sims = [], ground = [], want = {};
      m.worlds.forEach(function (wd) {
        wd.locations.forEach(function (l) {
          if (l.traitBook && !l.traitBook.looted) books.push(l.name);
          if (l.simulacrum && !l.simulacrum.looted) sims.push(l.name);
          areaRows(l).forEach(function (r) {
            r.items.forEach(function (x) {
              if (owned(x.it) !== false || x.picked) return;
              if (r.type === 'On the ground') ground.push({ it: x.it, where: l.name });
              else (want[l.name] = want[l.name] || []).push({ it: x.it, ev: r.name, type: r.type });
            });
          });
        });
      });
      var where = esc(m.label) + ' (' + esc(m.difficulty) + ')';
      if (sims.length) tips.push('<b class="rare">Simulacrum</b> still there in your ' + where + ': ' + esc(sims.join(', ')) + '.');
      if (books.length) tips.push('<b class="rare">Trait book</b> still there in ' + books.length + ' area' + (books.length > 1 ? 's' : '') + ': ' + esc(books.join(', ')) + '.');
      if (ground.length) tips.push('Rings and amulets you don\'t have, lying in your world: ' + ground.map(function (g) { return '<a href="#" data-item="' + esc(g.it.key) + '">' + icon(g.it, 'ico') + '<b>' + esc(g.it.name) + '</b></a> (' + esc(g.where) + ')'; }).join(', ') + '.');
      // Keys and other quest items still lying in the areas you've been to (the save keeps what's left in each tile).
      var keys = [];
      m.worlds.forEach(function (wd) {
        wd.locations.forEach(function (l) {
          l.tiles.forEach(function (t) {
            t.contents.items.forEach(function (n) {
              var it = BY_CLS[n.toLowerCase()];
              if (!/^Quest_Item_/.test(n) && !(it && it.category === 'Quest item')) return;
              keys.push((it ? '<a href="#" data-item="' + esc(it.key) + '">' + icon(it, 'ico') + '<b>' + esc(it.name) + '</b></a>' : '<b>' + esc(n.replace(/^Quest_Item_/, '').replace(/_/g, ' ')) + '</b>') +
                ' <span class="cat">' + esc(l.name + ' · ' + (t.name || t.level)) + '</span>');
            });
          });
        });
      });
      if (keys.length) tips.push('🔑 Quest items still lying in your ' + where + ': ' + keys.join(', ') + '.');
      Object.keys(want).forEach(function (loc) {
        tips.push('<b>' + esc(loc) + '</b>: ' + want[loc].map(function (x) { return '<a href="#" data-item="' + esc(x.it.key) + '">' + icon(x.it, 'ico') + esc(x.it.name) + '</a> <span class="cat">' + esc(x.type + ' · ' + x.ev) + '</span>'; }).join(', '));
      });
      if (!sims.length && !books.length && !ground.length && !Object.keys(want).length) tips.push('Nothing left for you in this ' + esc(m.label.toLowerCase()) + ': a good time to reroll it.');
    } else if (!w) tips.push('Load <b>save_' + state.charIndex + '.sav</b> too: tips about your world need it.');
    if (ch) {
      var vendors = {};
      ITEMS.forEach(function (i) { if (i.dropType === 'Vendor' && owned(i) === false) (vendors[i.dropRef] = vendors[i.dropRef] || []).push(i); });
      Object.keys(vendors).sort().forEach(function (v) {
        tips.push('Buy from <b>' + esc(v) + '</b>: ' + vendors[v].map(function (i) { return '<a href="#" data-item="' + esc(i.key) + '">' + icon(i, 'ico') + esc(i.name) + '</a>'; }).join(', ') + '.');
      });
      var low = ch.archetypeLevels.filter(function (a) { return a.level > 0 && a.level < MAX_LEVEL; });
      if (low.length) tips.push('Archetypes not at level ' + MAX_LEVEL + ' yet: ' + low.map(function (a) { return esc(a.name) + ' ' + a.level; }).join(', ') + '.');
    }
    el.innerHTML = (m ? modeSwitch() : '') + (tips.length ? '<section class="panel wide"><h3>What to do next</h3><ul class="tips">' + tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></section>' : '<div class="empty">No tips.</div>');
  }

  // ---- items (picture grid) --------------------------------------------------
  function renderItems() {
    var hasProfile = !!character();
    var q = ($('items-search').value || '').trim().toLowerCase();
    var show = hasProfile ? state.show : 'all';
    var keep = function (i, skip) {
      if (skip !== 'type' && state.category && i.category !== state.category) return false;
      if (skip !== 'world' && state.world != null && worldOf(i) !== state.world) return false;
      var mt = skip !== 'mode' && state.itemsMode && testFor(MODE_COLLECTION, state.itemsMode);
      if (mt && !mt(i)) return false;
      return true;
    };
    var chips = function (id, label, list, cur, skip) {
      return '<div class="filter-row"><span class="filter-label">' + label + '</span><div class="chips" id="' + id + '">' +
        '<span class="chip' + (cur == null ? ' on' : '') + '" data-v="__all">All</span>' + list.map(function (x) {
          var n = ITEMS.filter(function (i) { return keep(i, skip) && x.test(i); });
          var h = n.filter(function (i) { return owned(i) === true; }).length;
          return n.length ? '<span class="chip' + (cur === x.value ? ' on' : '') + '" data-v="' + esc(x.value) + '">' + esc(x.label) + ' <small>' + (hasProfile ? h + '/' : '') + n.length + '</small></span>' : '';
        }).join('') + '</div></div>';
    };
    var base = ITEMS.filter(function (i) { return keep(i); });
    var have = base.filter(function (i) { return owned(i) === true; }).length;
    var counted = base.filter(function (i) { return !UNCOUNTED[i.category]; });
    var filters = '<div class="filters">' +
      (hasProfile ? '<div class="seg" id="items-show">' + [['all', 'All ' + base.length], ['owned', 'I have ' + have], ['missing', 'I don\'t have ' + counted.filter(function (i) { return owned(i) === false; }).length]].map(function (s) {
        return '<button type="button" data-show="' + s[0] + '" class="' + (show === s[0] ? 'active' : '') + '">' + esc(s[1]) + '</button>';
      }).join('') + '</div>' : '') +
      chips('items-types', 'Type', CATEGORIES.map(function (c) { return { label: PLURAL[c], value: c, test: function (i) { return i.category === c; } }; }), state.category, 'type') +
      chips('items-worlds', 'From', WORLDS.map(function (w) { return { label: w[1], value: w[0], test: function (i) { return worldOf(i) === w[0]; } }; }), state.world, 'world') +
      chips('items-modes', 'Mode', MODE_COLLECTION.map(function (m) { return { label: m[0], value: m[0], test: m[1] }; }), state.itemsMode, 'mode') + '</div>';

    var rows = base.filter(function (i) {
      var o = owned(i);
      if (show === 'missing' && o !== false) return false;
      if (show === 'owned' && o !== true) return false;
      return matches(i, q);
    });
    var groups = {};
    rows.forEach(function (i) { (groups[i.category] = groups[i.category] || []).push(i); });
    var tile = function (i) {
      var o = owned(i), lv = o ? levelOf(i) : null, f = flags(i);
      var cls = 'ttile' + (o === true ? ' owned' : o === false ? ' missing' : '') + (state.itemSel === i.key ? ' sel' : '');
      var status = o === true ? '✔ have it' + (lv ? (i.category === 'Trait' || i.category === 'Archetype' ? ' · level ' : ' · +') + lv : '') : o === false ? 'missing' : UNCOUNTED[i.category] ? 'not in your bag' : '?';
      return '<button type="button" class="' + cls + '" data-item="' + esc(i.key) + '" title="' + esc(i.name) + '">' + icon(i) +
        '<span class="n">' + esc(i.name) + '</span><span class="ty">' + esc(i.weapon ? 'comes with ' + i.weapon : worldLabel(worldOf(i))) + '</span>' +
        (f.length ? '<span class="flag">' + esc(f.join(' · ')) + '</span>' : '') + '<span class="lv">' + esc(status) + '</span></button>';
    };
    var body = CATEGORIES.filter(function (c) { return groups[c]; }).map(function (c) {
      var list = groups[c], h = list.filter(function (i) { return owned(i) === true; }).length;
      return '<div class="group"><h3>' + esc(PLURAL[c]) + ' <small>' + (hasProfile && show === 'all' ? h + ' of ' + list.length : list.length) + '</small>' +
        (UNCOUNTED[c] ? ' <small>· used up when handed over: only the ones in your bag show as had</small>' : '') + '</h3><div class="tgrid">' + list.map(tile).join('') + '</div></div>';
    }).join('');
    $('items-view').innerHTML = filters + (body || '<div class="empty">' + (show === 'missing' ? 'Nothing missing with these filters. 🎉' : 'No items with these filters.') + '</div>');
  }

  // Side panel of one item: what it does, how to get it, the wiki page.
  function renderDrawer() {
    var el = $('item-drawer');
    var it = INFO_TABS.indexOf(state.tab) < 0 && state.itemSel && BY_KEY[state.itemSel];
    if (!it) { el.innerHTML = ''; return; }
    var o = owned(it), lv = o ? levelOf(it) : null, w = WIKI[it.key] || {}, how = howTo(it), f = flags(it);
    var max = it.category === 'Trait' || it.category === 'Archetype';
    el.innerHTML = '<aside class="tdrawer" role="dialog" aria-label="' + esc(it.name) + '"><button type="button" class="x" data-close aria-label="Close">✕</button>' +
      '<div class="hero">' + (w.icon ? '<img src="img/items/' + esc(w.icon) + '" alt="">' : '') + '</div>' +
      '<h2>' + esc(it.name) + wikiLink(it) + '</h2>' +
      '<p class="cat">' + esc([it.category, worldLabel(worldOf(it)), it.weapon && 'comes with ' + it.weapon].filter(Boolean).join(' · ')) + '</p>' +
      (f.length ? '<p class="flag">' + esc(f.join(' · ')) + '</p>' : '') +
      '<p>' + statusIcon(o) + ' ' + (o === true ? 'You have it' + (lv ? max ? ' — level <b>' + lv + ' / ' + MAX_LEVEL + '</b>' : ' — <b>+' + lv + '</b>' : '') : o === false ? 'You don\'t have it' : UNCOUNTED[it.category] ? 'Not in your bag (maybe already handed over)' : 'Unknown (load profile.sav)') + '</p>' +
      (o === true && lv && max ? '<div class="bar"><i style="width:' + Math.round(100 * lv / MAX_LEVEL) + '%"></i></div>' : '') +
      (w.desc ? '<h3 class="section-title more">What it does</h3><p>' + esc(w.desc) + '</p>' : '') +
      '<h3 class="section-title more">How to get it</h3>' + (how.length ? '<div class="how"><ul>' + how.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul></div>' : '<div class="how"><i>No notes for this item yet.</i></div>') +
      (it.drop ? '<p class="cat">Source: ' + esc(it.drop) + '</p>' : '') +
      (w.lore ? '<p class="lore">' + esc(w.lore) + '</p>' : '') + '</aside>';
  }

  // ---- checklist -------------------------------------------------------------
  // As in Remnant World Analyzer: "x of y" by item type, by mode and by world (each a filter when clicked),
  // with how many you can get in your world right now; then the list, by world, of what you don't have
  // (or everything), what's in your world first, with where it is and how to get it.
  var MODE_COLLECTION = [
    ['Normal', function (i) { return !i.hardcore && !i.coop && !i.accountaward; }],
    ['Hardcore', function (i) { return !!i.hardcore; }],
    ['Co-op', function (i) { return !!i.coop; }],
    ['Account award', function (i) { return !!i.accountaward; }],
  ];
  var TYPE_COLLECTION = CATEGORIES.filter(function (c) { return !UNCOUNTED[c]; }).map(function (c) { return [PLURAL[c], function (i) { return i.category === c; }]; });
  function testFor(list, label) { var c = list.filter(function (x) { return x[0] === label; })[0]; return c ? c[1] : null; }
  function dlcOf(i) { var m = /^World_DLC(\d)$/.exec(worldOf(i)); return m ? 'DLC ' + m[1] : ''; }
  // Where each item you don't have can be had in the world on screen (not picked up there yet):
  // key -> [{ world, area, event }].
  function availability() {
    var out = {}, m = rolled();
    if (!m) return out;
    m.worlds.forEach(function (w) {
      w.locations.forEach(function (loc) {
        areaRows(loc).forEach(function (r) {
          r.items.forEach(function (x) {
            if (x.picked) return;
            (out[x.it.key] = out[x.it.key] || []).push({ world: worldLabelOf(loc), area: loc.name, event: r.type === 'Area' ? 'area drop' : r.type === 'On the ground' ? 'on the ground' : r.name + ' (' + r.type.toLowerCase() + ')' });
          });
        });
      });
    });
    return out;
  }
  function passes(i, skip) {
    if (skip !== 'world' && state.missingWorld != null && worldOf(i) !== state.missingWorld) return false;
    var t = skip !== 'type' && state.missingType != null && testFor(TYPE_COLLECTION, state.missingType);
    if (t && !t(i)) return false;
    var m = skip !== 'mode' && state.missingMode != null && testFor(MODE_COLLECTION, state.missingMode);
    if (m && !m(i)) return false;
    return true;
  }
  function collTile(r, value, on, hasProfile) {
    var pct = r.total ? Math.round(100 * r.have / r.total) : 100, done = r.have === r.total;
    var status = !hasProfile ? 'load profile.sav' : done ? 'complete' : (r.total - r.have) + ' missing · ' + pct + '%';
    return '<button type="button" class="coll' + (r.isTotal ? ' total' : '') + (hasProfile && done ? ' done' : '') + (on ? ' on' : '') + '" data-value="' + esc(value) + '">' +
      '<div class="w">' + esc(r.label) + '</div>' +
      '<div class="n">' + (hasProfile ? r.have + ' <small>of ' + r.total + '</small>' : r.total + ' <small>items</small>') + '</div>' +
      '<div class="of">' + status + '</div>' +
      '<div class="now">' + (hasProfile && r.now ? r.now + ' obtainable now' : '&nbsp;') + '</div>' +
      '<div class="bar"><i style="width:' + (hasProfile ? pct : 0) + '%"></i></div></button>';
  }
  function worldCard(r, value, on, hasProfile) {
    var missing = r.total - r.have, pct = r.total ? Math.round(100 * r.have / r.total) : 100;
    var big = hasProfile ? (missing ? missing + ' missing' : 'complete') : r.total + ' items';
    return '<button type="button" class="card' + (on ? ' on' : '') + '" data-value="' + esc(value) + '">' +
      '<div class="w">' + esc(r.label) + '</div>' +
      '<div class="n' + (!hasProfile ? ' neutral' : !missing ? ' done' : '') + '">' + esc(big) + '</div>' +
      (hasProfile ? '<div class="of">' + r.have + ' of ' + r.total + ' items · ' + pct + '%</div>' : '<div class="of">load profile.sav</div>') +
      (hasProfile && r.now ? '<div class="now">' + r.now + ' obtainable now</div>' : '') +
      (hasProfile ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</button>';
  }
  function itemDetails(i, extra) {
    var how = howTo(i), w = WIKI[i.key] || {};
    var meta = [i.category, worldLabel(worldOf(i)), i.weapon && 'comes with ' + i.weapon, i.drop && 'Source: ' + i.drop].concat(flags(i)).filter(Boolean).join(' · ');
    return '<details class="item"><summary>' + statusIcon(owned(i)) + ' ' + icon(i, 'ico') + esc(i.name) + wikiLink(i) + '<span class="cat">' + esc(i.category) + '</span>' + (extra || '') + '</summary>' +
      '<div class="how">' + (w.desc ? '<div>' + esc(w.desc) + '</div>' : '') +
      (how.length ? '<ul>' + how.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>' : '<i>No notes for this item yet.</i>') +
      (meta ? '<div class="meta">' + esc(meta) + ' · <a href="#" data-item="' + esc(i.key) + '">details</a></div>' : '') + '</div></details>';
  }
  function renderChecklist() {
    var hasProfile = !!character(), avail = availability();
    var counted = ITEMS.filter(function (i) { return !UNCOUNTED[i.category]; });
    // Tiles: each group applies the other two filters.
    var row = function (label, test) { return { label: label, test: test, have: 0, total: 0, now: 0 }; };
    var all = row('Total'); all.isTotal = true;
    var types = TYPE_COLLECTION.map(function (c) { return row(c[0], c[1]); });
    var modes = MODE_COLLECTION.map(function (c) { return row(c[0], c[1]); });
    var worldKeys = WORLDS.map(function (w) { return w[0]; }).filter(function (k) { return counted.some(function (i) { return worldOf(i) === k; }); });
    var worlds = worldKeys.map(function (k) { return row(worldLabel(k), function (i) { return worldOf(i) === k; }); });
    counted.forEach(function (i) {
      var have = owned(i) === true ? 1 : 0, now = !have && avail[i.key] ? 1 : 0;
      var add = function (r) { if (!r.test || r.test(i)) { r.total++; r.have += have; r.now += now; } };
      if (passes(i, 'type')) [all].concat(types).forEach(add);
      if (passes(i, 'mode')) modes.forEach(add);
      if (passes(i, 'world')) worlds.forEach(add);
    });
    var m = rolled();
    $('missing-mode-switch').innerHTML = m ? modeSwitch().replace(/^<div class="seg" id="mode-switch">|<\/div>$/g, '') : '';
    $('missing-mode-switch').hidden = !m;
    $('collection').innerHTML = collTile(all, '', false, hasProfile) + types.map(function (r) { return collTile(r, r.label, state.missingType === r.label, hasProfile); }).join('');
    $('modes').innerHTML = modes.map(function (r) { return collTile(r, r.label, state.missingMode === r.label, hasProfile); }).join('');
    $('summary').innerHTML = worlds.map(function (r, n) { return worldCard(r, worldKeys[n], state.missingWorld === worldKeys[n], hasProfile); }).join('');

    var q = $('missing-search').value.trim().toLowerCase();
    var onlyNow = $('missing-only-now').checked, showOwned = $('missing-show-owned').checked || !hasProfile;
    var groups = {};
    counted.forEach(function (i) {
      if (!passes(i)) return;
      var o = owned(i), where = o === true ? null : avail[i.key];
      if (o === true && !showOwned) return;
      if (onlyNow && !where) return;
      if (!matches(i, q)) return;
      (groups[worldOf(i)] = groups[worldOf(i)] || []).push({ it: i, owned: o, where: where });
    });
    var html = worldKeys.filter(function (k) { return groups[k]; }).map(function (k) {
      var list = groups[k].sort(function (a, b) { return (a.where ? 0 : 1) - (b.where ? 0 : 1) || CATEGORIES.indexOf(a.it.category) - CATEGORIES.indexOf(b.it.category) || a.it.name.localeCompare(b.it.name); });
      return '<div class="group"><h3>' + esc(worldLabel(k)) + ' <small>' + list.length + ' items</small></h3>' + list.map(function (r) {
        var i = r.it, d = dlcOf(i);
        var tags = (r.where ? '<span class="tag now">available now</span>' : '') + flags(i).map(function (f) { return '<span class="tag mode">' + esc(f) + '</span>'; }).join('') + (d ? '<span class="tag">' + esc(d) + '</span>' : '');
        var where = r.where ? '<div class="where">In your world: ' + r.where.map(function (x) { return esc(x.world + ' → ' + x.area + ' (' + x.event + ')'); }).join(' · ') + '</div>' : '';
        return '<div class="mrow">' + itemDetails(i, tags) + where + '</div>';
      }).join('') + '</div>';
    }).join('');
    $('missing-list').innerHTML = html || '<div class="empty">' + (hasProfile ? 'Nothing missing with these filters. 🎉' : 'Nothing matches these filters.') + '</div>';
    var un = R2_CATALOG.items.filter(function (i) { return i.unconfirmed; }), quest = ITEMS.filter(function (i) { return UNCOUNTED[i.category]; });
    $('missing-extra').innerHTML = '<details class="unconfirmed"><summary class="cat">Quest items (' + quest.length + '): used up when handed over, so they are not counted — see them in Items</summary></details>' +
      '<details class="unconfirmed"><summary class="cat">In the game files but not confirmed obtainable (' + un.length + '): not in the item database, the wiki or your save — Remnant 1 leftovers or unreleased content</summary><p class="cat">' +
      un.map(function (i) { return esc(i.name) + ' (' + esc(i.category) + ')'; }).join(' · ') + '</p></details>';
  }

  // ---- traits & archetypes ---------------------------------------------------
  function renderTraits() {
    var ch = character(), hasProfile = !!ch;
    var show = hasProfile ? state.traitsShow : 'all';
    var tile = function (i) {
      var o = owned(i), lv = levelOf(i) || 0;
      var cls = 'ttile' + (o === true ? ' owned' : o === false ? ' missing' : '') + (state.itemSel === i.key ? ' sel' : '');
      return '<button type="button" class="' + cls + '" data-item="' + esc(i.key) + '" title="' + esc(i.name) + '">' + icon(i) + '<span class="n">' + esc(i.name) + '</span>' +
        (o === true ? '<span class="lv' + (lv >= MAX_LEVEL ? ' max' : '') + '">' + (lv ? lv + ' / ' + MAX_LEVEL : 'not leveled') + '</span><span class="tbar"><i style="width:' + Math.round(100 * lv / MAX_LEVEL) + '%"></i></span>'
          : '<span class="lv">' + (o === false ? 'missing' : '?') + '</span>') + '</button>';
    };
    var section = function (title, list) {
      list = list.filter(function (i) { var o = owned(i); return show === 'all' || (show === 'owned' ? o === true : o !== true); })
        .sort(function (a, b) { return (owned(b) === true) - (owned(a) === true) || (levelOf(b) || 0) - (levelOf(a) || 0) || a.name.localeCompare(b.name); });
      return list.length ? '<h3 class="section-title more">' + esc(title) + ' (' + list.length + ')</h3><div class="tgrid">' + list.map(tile).join('') + '</div>' : '';
    };
    var traits = ITEMS.filter(function (i) { return i.category === 'Trait'; }), arch = ITEMS.filter(function (i) { return i.category === 'Archetype'; });
    var have = traits.filter(function (i) { return owned(i) === true; }).length;
    var maxed = traits.filter(function (i) { return (levelOf(i) || 0) >= MAX_LEVEL; }).length;
    $('traits-view').innerHTML = '<div class="summary">' +
      '<div class="card static"><div class="w">Traits</div><div class="n' + (have === traits.length ? ' done' : ' neutral') + '">' + (hasProfile ? have + ' of ' + traits.length : traits.length) + '</div><div class="of">' + (hasProfile ? (traits.length - have) + ' missing · ' + maxed + ' at max' : 'load profile.sav') + '</div></div>' +
      (ch ? '<div class="card static"><div class="w">Trait rank</div><div class="n neutral">' + num(ch.traitRank) + '</div><div class="of">' + num(ch.traitPoints || 0) + ' trait points</div></div>' +
        '<div class="card static"><div class="w">Archetypes</div><div class="n neutral">' + arch.filter(function (i) { return owned(i) === true; }).length + ' of ' + arch.length + '</div><div class="of">' +
        ch.archetypeLevels.filter(function (a) { return a.level >= MAX_LEVEL; }).length + ' at level ' + MAX_LEVEL + '</div></div>' : '') + '</div>' +
      (hasProfile ? '<div class="filters"><div class="seg" id="traits-show">' + [['all', 'All'], ['owned', 'I have'], ['missing', 'I don\'t have']].map(function (s) {
        return '<button type="button" data-show="' + s[0] + '" class="' + (show === s[0] ? 'active' : '') + '">' + s[1] + '</button>';
      }).join('') + '</div></div>' : '') +
      section('Archetypes', arch) + section('Traits', traits);
  }

  // ---- my character ----------------------------------------------------------
  var SLOT_ORDER = ['Archetype', 'Weapon', 'Mod', 'Mutator', 'Armor', 'Amulet', 'Ring', 'Relic', 'Relic fragment', 'Consumable', 'Concoction', 'Prism'];
  function renderCharacterTab() {
    var el = $('character-view'), ch = character();
    if (!ch) { el.innerHTML = '<div class="empty">Load <b>profile.sav</b> too to see your character.</div>'; return; }
    var card = function (t, big, sub) { return '<div class="card static"><div class="w">' + esc(t) + '</div><div class="n neutral">' + esc(big) + '</div><div class="of">' + esc(sub || '') + '</div></div>'; };
    var cards = card('Archetypes', ch.archetype + (ch.secondary ? ' / ' + ch.secondary : ''), ch.archetypeLevels.filter(function (a) { return a.level > 0; }).map(function (a) { return a.name + ' ' + a.level; }).join(' · ')) +
      card('Power level', ch.powerLevel, 'item level ' + ch.itemLevel) +
      card('Trait rank', num(ch.traitRank), num(ch.traitPoints || 0) + ' trait points') +
      card('Dragon Heart', (ch.dragonHearts || 0) + ' charges', '') +
      card('Experience', num(ch.experience || 0), '') +
      card('In the bag', num(ch.inventory.length), 'entries');
    var eq = ch.inventory.filter(function (x) { return x.equipped === true && BY_KEY[x.key]; }).map(function (x) { return { it: BY_KEY[x.key], level: x.level }; });
    eq.sort(function (a, b) { return SLOT_ORDER.indexOf(a.it.category) - SLOT_ORDER.indexOf(b.it.category) || a.it.name.localeCompare(b.it.name); });
    var gear = eq.length ? '<table class="kv">' + eq.map(function (e) {
      return '<tr><th>' + esc(e.it.category) + '</th><td><a href="#" data-item="' + esc(e.it.key) + '">' + icon(e.it, 'ico') + esc(e.it.name) + '</a>' + (e.level ? ' <span class="lvl">+' + e.level + '</span>' : '') + wikiLink(e.it) + '</td></tr>';
    }).join('') + '</table>' : '<p class="cat">Nothing equipped.</p>';
    // Special weapons (the ones with a mod of their own) go up to +10, the others to +20.
    var special = {}; ITEMS.forEach(function (i) { if (i.comesWith) special[i.comesWith] = true; });
    var weapons = ch.inventory.filter(function (x) { return BY_KEY[x.key] && BY_KEY[x.key].category === 'Weapon' && x.level; })
      .sort(function (a, b) { return b.level - a.level; }).map(function (x) {
        var max = special[x.key] ? 10 : 20;
        return '<div class="meter' + (x.level >= max ? ' done' : '') + '"><span class="ml"><a href="#" data-item="' + esc(x.key) + '">' + icon(BY_KEY[x.key], 'ico') + esc(BY_KEY[x.key].name) + '</a></span><span class="mv">+' + x.level + ' / ' + max + '</span><div class="bar"><i style="width:' + Math.round(100 * x.level / max) + '%"></i></div></div>';
      }).join('');
    el.innerHTML = '<div class="summary">' + cards + '</div><div class="panels">' +
      '<section class="panel"><h3>Equipped</h3>' + gear + '</section>' +
      '<section class="panel"><h3>Weapon upgrades</h3>' + (weapons || '<p class="cat">No upgraded weapons.</p>') + '</section></div>';
  }

  // ---- save editor -------------------------------------------------------------
  // Resource quantities and trait points of the character on screen, written into profile.sav by js/editor.js.
  // With Start.bat running on this PC it saves to the game folder (after a backup of the whole folder);
  // otherwise it downloads the edited profile.sav.
  var ED = window.R2_EDITOR;
  state.editDraft = {}; state.editMsg = null;
  function canSaveHere() { return !!state.dir && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }
  function profileData() { var i = state.info['profile.sav']; return i && i.data; }
  function editorFields() { return ED.fields(profileData(), state.charIndex); }
  function editorValues(list) {
    var draft = state.editDraft[state.charIndex] || {}, out = {};
    list.forEach(function (f) { if (f.editable && f.key in draft && draft[f.key] !== f.value) out[f.key] = draft[f.key]; });
    return out;
  }
  function renderEditorTab() {
    if (state.tab !== 'editor') return;
    var el = $('editor-view');
    if (!profileData()) { el.innerHTML = '<div class="empty">Load <b>profile.sav</b> to edit your resources and trait points.</div>'; return; }
    var list;
    try { list = editorFields(); } catch (e) { el.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
    var draft = state.editDraft[state.charIndex] = state.editDraft[state.charIndex] || {};
    var here = canSaveHere(), changes = Object.keys(editorValues(list)).length, ch = character();
    var rows = list.map(function (f) {
      var v = f.key in draft ? draft[f.key] : f.value, changed = f.key in draft && draft[f.key] !== f.value;
      return '<tr' + (changed ? ' class="changed"' : '') + '><th>' + esc(f.label) + '</th><td class="cur">' + num(f.value) + '</td><td>' +
        (f.editable ? '<input type="number" class="ed-in" data-key="' + esc(f.key) + '" min="0" max="' + f.max + '" step="1" value="' + esc(String(v)) + '">' : '<span class="cat">can’t edit yet</span>') +
        '</td><td class="cat">up to ' + num(f.max) + (f.note ? ' · ' + esc(f.note) : '') + '</td></tr>';
    }).join('');
    var warn = [
      '<b>Close Remnant 2 first.</b> The game rewrites profile.sav when it saves and when it quits: it would undo the edit, or the edit would undo your progress.',
      here ? 'Saving first copies the whole save folder to <code>&lt;folder&gt;_backup_&lt;date&gt;</code>, next to it.'
        : 'Keep a copy of your current profile.sav. Then put the downloaded one in <code>%USERPROFILE%\\Saved Games\\Remnant2\\Steam\\&lt;number&gt;</code>, replacing it.',
      'Steam Cloud: if Steam asks which copy to keep, choose the <b>local</b> one.',
      'Only resources already in your bag can be changed (pick one up in the game first). Up to 9,999,999 scrap and 9,999 of everything else. An item the game keeps without an amount (one Simulacrum) gets one when you save.',
      'The file is checked after the change (every value read back, checksum recomputed); still, editing saves is at your own risk.',
    ];
    el.innerHTML = '<section class="panel wide ed-box"><h3>Before you save</h3><ul class="ed-warn">' + warn.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul></section>' +
      '<section class="panel wide"><h3>' + esc(ch ? ch.archetype + (ch.secondary ? ' / ' + ch.secondary : '') : 'Character ' + (state.charIndex + 1)) + '</h3>' +
      '<table class="kv ed"><tr><th>What</th><td><b>Now</b></td><td><b>New value</b></td><td></td></tr>' + rows + '</table>' +
      '<div class="ed-actions">' + (here ? '<button type="button" class="btn primary" id="ed-save"' + (changes ? '' : ' disabled') + '>Save to the game folder</button>' : '') +
      '<button type="button" class="btn" id="ed-download"' + (changes ? '' : ' disabled') + '>' + (here ? 'Download instead' : 'Download the edited profile.sav') + '</button>' +
      '<button type="button" class="btn" id="ed-reset"' + (changes ? '' : ' disabled') + '>Undo changes</button>' +
      '<span class="cat">' + (changes ? changes + ' change' + (changes > 1 ? 's' : '') : 'No changes yet') + '</span></div>' +
      (state.editMsg ? '<div class="ed-msg ' + state.editMsg.cls + '">' + state.editMsg.html + '</div>' : '') + '</section>' + editorBackupsHtml(here);
    if (here && state.backups === undefined && !state.backupsLoading) loadBackups();
  }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function editorBackupsHtml(here) {
    var last = (state.backups || [])[0];
    var body = here
      ? '<p class="cat">' + (state.backups === undefined ? 'Looking for backups…' : last ? 'Last backup: <b>' + esc(last.when) + '</b> · <code>' + esc(last.name) + '</code> · ' + last.files + ' files' +
          (state.backups.length > 1 ? ' · ' + state.backups.length + ' backups in all' : '') : 'No backup yet.') + '</p>' +
        '<div class="ed-actions"><button type="button" class="btn" id="ed-backup">Back up now</button>' +
        '<button type="button" class="btn" id="ed-restore"' + (last ? '' : ' disabled') + '>Restore last backup' + (last ? ' (' + esc(last.when) + ')' : '') + '</button></div>' +
        '<p class="cat">Back up copies the whole save folder. Restore needs the game closed, and first copies what it replaces (to <code>…_before_restore</code>), so it can be undone.</p>'
      : '<div class="ed-actions"><button type="button" class="btn" id="ed-backup">Download a backup of profile.sav</button></div>' +
        '<p class="cat">Saved as <code>profile_backup_&lt;date_time&gt;.sav</code>. To restore it, close the game and put it back in the save folder renamed to <code>profile.sav</code>.</p>';
    return '<section class="panel wide"><h3>Backups</h3>' + body + (state.backupMsg ? '<div class="ed-msg ' + state.backupMsg.cls + '">' + state.backupMsg.html + '</div>' : '') + '</section>';
  }
  function loadBackups() {
    state.backupsLoading = true;
    return fetch('api/backups', { cache: 'no-store' }).then(function (r) { state.backupsLoading = false; if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { state.backups = [].concat(j.backups || []); renderEditorTab(); })
      .catch(function () { state.backupsLoading = false; state.backups = []; state.backupMsg = { cls: 'bad', html: 'This Start.bat can’t list backups: close its window and open Start.bat again.' }; renderEditorTab(); });
  }
  function serverPost(path, headers) {
    return fetch(path, { method: 'POST', headers: headers || {} }).then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || 'HTTP ' + r.status); }); });
  }
  function download(bytes, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function editorBackup() {
    if (!canSaveHere()) {
      var name = 'profile_backup_' + stamp() + '.sav';
      download(state.files['profile.sav'], name);
      state.backupMsg = { cls: 'ok', html: 'Downloaded <b>' + esc(name) + '</b>.' };
      return renderEditorTab();
    }
    serverPost('api/backup').then(function (res) { state.backupMsg = { cls: 'ok', html: 'Backed up to <code>' + esc(res.backup) + '</code>.' }; return loadBackups(); })
      .catch(function (e) { state.backupMsg = { cls: 'bad', html: 'No backup made: ' + esc(e.message) }; renderEditorTab(); });
  }
  function editorRestore() {
    var last = (state.backups || [])[0]; if (!last) return;
    if (!window.confirm('Restore the backup from ' + last.when + '?\n\n' + last.name + '\n\nRemnant 2 must be closed. Your current saves are copied first (…_before_restore), so this can be undone.')) return;
    serverPost('api/restore', { 'X-Backup': last.name }).then(function (res) {
      state.editDraft[state.charIndex] = {};
      state.backupMsg = { cls: 'ok', html: 'Restored the backup from <b>' + esc(res.when) + '</b>. What it replaced is in <code>' + esc(res.before) + '</code>.' };
      return loadBackups();
    }).catch(function (e) { state.backupMsg = { cls: 'bad', html: 'Not restored: ' + esc(e.message) }; renderEditorTab(); });
  }
  // The edited file (a promise), or null with the reason shown.
  function editorBuild() {
    try {
      var values = editorValues(editorFields());
      if (!Object.keys(values).length) return null;
      return ED.build(profileData(), state.charIndex, values);
    } catch (e) { state.editMsg = { cls: 'bad', html: esc(e.message) }; renderEditorTab(); return null; }
  }
  function editorDownload() {
    var p = editorBuild(); if (!p) return;
    p.then(function (bytes) {
      download(bytes, 'profile.sav');
      state.editMsg = { cls: 'ok', html: 'Downloaded <b>profile.sav</b>. With the game closed, put it in your save folder (replace the old one — keep a copy of it).' };
      renderEditorTab();
    });
  }
  function editorSave() {
    var p = editorBuild(); if (!p) return;
    if (!window.confirm('Write the edited profile.sav to the game folder?\n\nRemnant 2 must be closed. A copy of the whole save folder is made first.')) return;
    var base = new Uint8Array(state.files['profile.sav']);
    var crc = new DataView(base.buffer, base.byteOffset, base.byteLength).getUint32(0, true).toString(16);
    while (crc.length < 8) crc = '0' + crc;
    p.then(function (bytes) {
      return fetch('api/save?name=profile.sav', { method: 'POST', headers: { 'X-Base-Crc': crc, 'Content-Type': 'application/octet-stream' }, body: bytes });
    }).then(function (r) {
      if (r.status === 404 || r.status === 405) throw new Error('the Start.bat that is running is older than this page and can’t save. Close its window, open Start.bat again, press Ctrl+F5 here and save again (or use "Download instead").');
      return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || 'HTTP ' + r.status); });
    }).then(function (res) {
      state.editDraft[state.charIndex] = {};
      state.editMsg = { cls: 'ok', html: 'Saved. A copy of the folder before the change is in <code>' + esc(res.backup) + '</code>. Open the game to see it.' };
      renderEditorTab();
    }).catch(function (e) { state.editMsg = { cls: 'bad', html: 'Not saved: ' + esc(e.message) }; renderEditorTab(); });
  }

  // ---- build & DPS -------------------------------------------------------------
  // Damage of your weapons at their upgrade level, from the wiki's stats: per hit, per second while firing
  // (damage × shots per second), on weak spots, and with the weapon's own critical chance (crits +50%).
  // Bonuses from traits, rings, amulets, mods and mutators are not counted.
  var CRIT_DAMAGE = 0.5;
  function weaponStats(it, level) {
    var w = WIKI[it.key], s = w && w.stats; if (!s) return null;
    var dmg = level && s.levels && s.levels[level] != null ? s.levels[level] : s.damage;
    var maxLevel = s.levels ? Math.max.apply(null, Object.keys(s.levels).map(Number)) : 0;
    var crit = Math.max(0, s.crit || 0) / 100, ws = s.weakspot != null ? s.weakspot / 100 : 0;
    var hit = dmg * (1 + crit * CRIT_DAMAGE);
    return {
      dmg: dmg, hit: hit, weakHit: hit * (1 + ws), rps: s.rps || null,
      dps: s.rps ? hit * s.rps : null, weakDps: s.rps ? hit * (1 + ws) * s.rps : null,
      maxLevel: maxLevel, maxDps: s.rps && maxLevel ? s.levels[maxLevel] * (1 + crit * CRIT_DAMAGE) * s.rps : null,
      s: s,
    };
  }
  function fmt(v, d) { return v == null ? '—' : (+v).toLocaleString('en-US', { maximumFractionDigits: d == null ? 1 : d }); }
  function renderBuild() {
    var el = $('build-view'), ch = character();
    if (!ch) { el.innerHTML = '<div class="empty">Load <b>profile.sav</b> too to see your build and DPS.</div>'; return; }
    var rows = ch.inventory.filter(function (x) { return BY_KEY[x.key] && BY_KEY[x.key].category === 'Weapon'; }).map(function (x) {
      return { it: BY_KEY[x.key], level: x.level || 0, equipped: x.equipped, st: weaponStats(BY_KEY[x.key], x.level || 0) };
    }).filter(function (r) { return r.st; });
    var eq = rows.filter(function (r) { return r.equipped; });
    var cards = eq.map(function (r) {
      var big = r.st.dps ? fmt(r.st.dps, 0) + ' DPS' : fmt(r.st.hit, 0) + ' per hit';
      var sub = r.st.dps ? fmt(r.st.weakDps, 0) + ' DPS on weak spots · ' + fmt(r.st.rps) + ' shots/s · ' + (r.st.s.magazine || '?') + ' per magazine' : fmt(r.st.weakHit, 0) + ' per weak-spot hit (melee)';
      return '<div class="card static"><div class="w">' + icon(r.it, 'ico') + esc(r.it.name) + ' <span class="lvl">+' + r.level + '</span></div><div class="n neutral">' + big + '</div><div class="of">' + esc(sub) + '</div></div>';
    }).join('');
    // Guns with 1-2 shots per magazine spend most of their time reloading: their DPS (no reloads) goes last.
    var reloadBound = function (r) { return r.st.s.magazine != null && r.st.s.magazine <= 2; };
    var guns = rows.filter(function (r) { return r.st.dps; }).sort(function (a, b) { return (reloadBound(a) - reloadBound(b)) || b.st.dps - a.st.dps; });
    var melee = rows.filter(function (r) { return !r.st.dps; }).sort(function (a, b) { return b.st.hit - a.st.hit; });
    var table = function (list, gun) {
      return '<table class="kv dps"><tr><th>Weapon</th><td><b>Damage</b></td>' + (gun ? '<td><b>Shots/s</b></td><td><b>DPS</b></td><td><b>Weak spot DPS</b></td><td><b>At max level</b></td><td><b>Magazine</b></td><td><b>Ideal range</b></td>' : '<td><b>Per hit</b></td><td><b>Weak spot hit</b></td><td><b>Crit</b></td>') + '</tr>' +
        list.map(function (r) {
          var s = r.st.s;
          return '<tr' + (r.equipped ? ' class="changed"' : '') + '><th><a href="#" data-item="' + esc(r.it.key) + '">' + icon(r.it, 'ico') + esc(r.it.name) + '</a> <span class="lvl">+' + r.level + '</span>' + (r.equipped ? ' <span class="tag mode">equipped</span>' : '') + (gun && reloadBound(r) ? ' <span class="cat">reload-bound</span>' : '') + '</th><td>' + fmt(r.st.dmg) + '</td>' +
            (gun ? '<td>' + fmt(r.st.rps) + '</td><td><b>' + fmt(r.st.dps, 0) + '</b></td><td>' + fmt(r.st.weakDps, 0) + '</td><td>' + (r.st.maxDps ? fmt(r.st.maxDps, 0) + ' <span class="cat">+' + r.st.maxLevel + '</span>' : '—') + '</td><td>' + (s.magazine || '—') + '</td><td>' + (s.idealRange ? s.idealRange + ' m' : '—') + '</td>'
              : '<td><b>' + fmt(r.st.hit, 0) + '</b></td><td>' + fmt(r.st.weakHit, 0) + '</td><td>' + (s.crit != null ? s.crit + '%' : '—') + '</td>') + '</tr>';
        }).join('') + '</table>';
    };
    el.innerHTML = (cards ? '<h3 class="section-title">Equipped</h3><div class="summary">' + cards + '</div>' : '') +
      '<div class="panels">' + (guns.length ? '<section class="panel wide"><h3>Guns you own, by DPS</h3>' + table(guns, true) + '</section>' : '') +
      (melee.length ? '<section class="panel wide"><h3>Melee weapons you own</h3>' + table(melee, false) + '</section>' : '') + '</div>' +
      '<p class="cat">From the wiki’s weapon stats at your upgrade level: DPS is damage × shots per second while firing (no reloads), with the weapon’s own critical chance (crits deal +50%). ' +
      'Bonuses from traits, rings, amulets, mods, mutators and relic fragments are not counted.</p>';
  }

  // ---- raw data ----------------------------------------------------------------
  // Everything in the save files as read, expandable; nodes are filled when opened.
  var rawNodes = [];
  function isRef(v) { return v && typeof v === 'object' && !Array.isArray(v) && 'path' in v && 'props' in v && 'comps' in v; }
  function rawLabel(v) { return Array.isArray(v) ? '[' + v.length + ']' : '{' + Object.keys(v).length + '}'; }
  function rawNode(label, value) { var id = rawNodes.push(value) - 1; return '<details class="raw" data-raw="' + id + '"><summary>' + label + '</summary></details>'; }
  function rawValue(v) {
    if (v === null || v === undefined) return '<span class="rv">null</span>';
    if (isRef(v)) return '<span class="rv ref">→ ' + esc(String(v.path).split('/').pop()) + '</span>';
    if (typeof v !== 'object') return '<span class="rv">' + esc(JSON.stringify(v)) + '</span>';
    if (Array.isArray(v) && !v.length) return '<span class="rv">[]</span>';
    if (!Array.isArray(v) && !Object.keys(v).length) return '<span class="rv">{}</span>';
    return rawNode('<span class="cat">' + rawLabel(v) + '</span>', v);
  }
  function rawChildren(v) {
    var keys = Array.isArray(v) ? v.map(function (_, i) { return i; }) : Object.keys(v);
    return keys.map(function (k) { return '<div class="rrow"><span class="rk">' + esc(String(k)) + '</span> ' + rawValue(v[k]) + '</div>'; }).join('');
  }
  function objNode(o, i) { return { index: i, path: o.path, properties: o.props, components: o.comps }; }
  function rawTree(n, i) {
    var top = {}, root = i.save.root.props;
    Object.keys(root).forEach(function (k) { if (k !== 'Characters' && k !== 'Containers') top[k] = root[k]; });
    var out = rawNode('<b>Properties</b> <span class="cat">' + Object.keys(top).length + '</span>', top);
    if (root.Characters) out += root.Characters.map(function (c, ci) {
      if (!c || !c.props || !c.props.CharacterData) return '';
      var inner; try { inner = R2_GVAS.readBlob(i.data, c.props.CharacterData); } catch (e) { return '<p class="error">' + esc(e.message) + '</p>'; }
      return '<div class="rrow"><span class="rk">Character ' + (ci + 1) + '</span> ' + rawNode('<span class="cat">properties</span>', c.props) + rawNode('<span class="cat">character data: ' + inner.objects.length + ' objects</span>', inner.objects.map(objNode)) + '</div>';
    }).join('');
    if (root.Containers) out += '<div class="rrow"><span class="rk">Containers</span> <span class="cat">' + root.Containers.length + ' levels — each holds the actors whose state the game remembers</span></div>' +
      root.Containers.map(function (c) {
        var key = String(c.props.Key).split('/').pop().split(':')[0], cont;
        try { cont = R2_GVAS.readContainer(i.data, c.props.Blob); } catch (e) { return '<p class="error">' + esc(key + ': ' + e.message) + '</p>'; }
        return rawNode(esc(key) + ' <span class="cat">' + cont.actors.length + ' actors · ' + cont.destroyed.length + ' destroyed</span>', cont.actors.map(function (a) {
          var o = a.archive && a.archive.root;
          return { id: a.id, class: a.dynamic ? a.dynamic.name : '(placed in the level)', position: (a.transform || (a.dynamic && a.dynamic.transform) || {}).pos || null, properties: o && o.props, components: o && o.comps, objects: a.archive ? a.archive.objects.map(objNode) : a.error };
        }));
      }).join('');
    return out;
  }
  function renderFiles() {
    var names = Object.keys(state.info).sort();
    rawNodes = [];
    $('files').innerHTML = '<p class="cat">Everything stored in your save files, as read. Click to expand. "→" points to another object.</p>' + names.map(function (n) {
      var i = state.info[n];
      if (!i.ok) return '<section class="panel wide"><h3>' + esc(n) + '</h3><p class="error">' + esc(i.error) + '</p></section>';
      return '<section class="panel wide"><h3>' + esc(n) + ' <span class="cat">' + esc((i.strings[1] || {}).text || '') + '</span></h3>' +
        '<p class="cat">' + num(i.size) + ' bytes on disk · ' + i.chunks + ' compressed chunks · ' + num(i.raw) + ' bytes decompressed · container version ' + i.version +
        (i.save ? ' · ' + i.save.objects.length + ' objects · ' + i.save.names.length + ' names' : '') + '</p>' +
        (i.readError ? '<p class="error">' + esc(i.readError) + '</p>' : '') + (i.save && state.tab === 'raw' ? rawTree(n, i) : '') + '</section>';
    }).join('');
  }

  // ---- files in ------------------------------------------------------------------
  function handleFiles(list) {
    var files = Array.prototype.slice.call(list).filter(function (f) { return /\.sav$/i.test(f.name); });
    if (!files.length) return showError('No .sav file found. Pick profile.sav and save_N.sav.');
    Promise.all(files.map(function (f) { return f.arrayBuffer().then(function (b) { state.files[f.name.toLowerCase()] = b; }); }))
      .then(function () { setStatus('Manual · files loaded at ' + new Date().toLocaleTimeString(), false); return rebuild(); });
  }
  function api(path) { return fetch(path, { cache: 'no-store' }); }
  function sync(listing) {
    var old = {}; state.listing.forEach(function (f) { old[f.name] = f.modified; });
    var wanted = listing.filter(function (f) { return old[f.name] !== f.modified; });
    state.listing = listing;
    if (!wanted.length) return Promise.resolve();
    return Promise.all(wanted.map(function (f) {
      return api('api/file?name=' + encodeURIComponent(f.name)).then(function (r) { if (!r.ok) throw new Error(f.name + ': HTTP ' + r.status); return r.arrayBuffer(); })
        .then(function (b) { state.files[f.name] = b; });
    })).then(rebuild).then(function () { setStatus('Automatic · ' + state.dir + ' · updated at ' + new Date().toLocaleTimeString(), true); });
  }
  function tryAuto() {
    if (location.protocol === 'file:') return;
    api('api/saves').then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
      if (!info) return;
      state.dir = info.dir;
      $('save-path').textContent = info.dir;
      if (!info.found) return showError('The server could not find the save folder at ' + info.dir + '. Drop the files in, or run Start.bat -SaveDir "<folder>".');
      return sync(info.files).then(function () {
        setInterval(function () { api('api/saves').then(function (r) { return r.json(); }).then(function (i) { if (i.found) sync(i.files); }).catch(function () { setStatus('Server stopped — reopen Start.bat', false); }); }, 3000);
      });
    }).catch(function () { /* not served by server.ps1 */ });
  }

  function init() {
    $('version').innerHTML = 'Version ' + R2_VERSION.version + ' · Updated on <time datetime="' + R2_VERSION.date + '">' + R2_VERSION.date + '</time> · catalog of ' + ITEMS.length + ' items (' + R2_CATALOG.generated + ')';
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('hover'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('hover'); }); });
    drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
    $('file').addEventListener('change', function (e) { handleFiles(e.target.files); });
    $('copy-path').addEventListener('click', function () {
      (navigator.clipboard ? navigator.clipboard.writeText($('save-path').textContent) : Promise.reject()).then(function () { $('copy-path').textContent = 'Copied!'; }, function () {});
    });
    $('theme').addEventListener('click', function () {
      var dark = document.documentElement.dataset.theme !== 'dark';
      if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
      store('theme', dark ? 'dark' : 'light');
    });
    $('reload').addEventListener('click', function () { state.tab = 'home'; render(); $('drop').scrollIntoView({ behavior: 'smooth' }); });
    document.querySelector('.tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      state.tab = b.dataset.tab; state.itemSel = null;
      if (INFO_TABS.indexOf(state.tab) < 0) store('tab', state.tab);
      render(); window.scrollTo(0, 0);
    });
    $('character').addEventListener('change', function (e) { state.charIndex = +e.target.value; store('char', state.charIndex); render(); });
    $('items-search').addEventListener('input', renderItems);
    $('missing-search').addEventListener('input', renderChecklist);
    $('missing-only-now').addEventListener('change', renderChecklist);
    $('missing-show-owned').addEventListener('change', renderChecklist);
    $('editor-view').addEventListener('input', function (e) {
      var k = e.target.dataset && e.target.dataset.key; if (!k) return;
      var d = state.editDraft[state.charIndex] = state.editDraft[state.charIndex] || {};
      d[k] = e.target.value === '' ? 0 : Math.round(+e.target.value);
      state.editMsg = null;
      renderEditorTab();
      var again = document.querySelector('.ed-in[data-key="' + k + '"]'); if (again) again.focus();
    });
    $('editor-view').addEventListener('click', function (e) {
      var id = e.target.id;
      if (id === 'ed-save') editorSave();
      else if (id === 'ed-download') editorDownload();
      else if (id === 'ed-reset') { state.editDraft[state.charIndex] = {}; state.editMsg = null; renderEditorTab(); }
      else if (id === 'ed-backup') editorBackup();
      else if (id === 'ed-restore') editorRestore();
    });

    // Raw data: fill a node the first time it is opened ('toggle' doesn't bubble, so listen while capturing).
    $('files').addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d.open || d.dataset.filled || d.dataset.raw == null) return;
      d.dataset.filled = '1';
      d.insertAdjacentHTML('beforeend', '<div class="rkids">' + rawChildren(rawNodes[+d.dataset.raw]) + '</div>');
    }, true);
    $('world-view').addEventListener('input', function (e) {
      if (e.target.id !== 'world-search') return;
      state.worldQ = e.target.value; renderWorld();
      var s = $('world-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
    });
    $('world-view').addEventListener('change', function (e) { if (e.target.id === 'world-only-missing') { state.onlyMissing = e.target.checked; store('onlyMissing', state.onlyMissing); renderWorld(); } });
    // Any [data-item] opens the item's side panel; the filters of each page.
    $('app').addEventListener('click', function (e) {
      var md = e.target.closest('#mode-switch [data-mode]');
      if (md) { state.mode = md.dataset.mode; store('mode', state.mode); renderWorld(); renderMap(); return; }
      var mw = e.target.closest('.map-worlds [data-map-world]');
      if (mw) { var mr = rolled(); state.mapWorld[mr.key + ':' + state.charIndex] = mw.dataset.mapWorld === 'all' ? 'all' : +mw.dataset.mapWorld; renderMap(); return; }
      var wc = e.target.closest('#world-worlds [data-v], #world-types [data-v]');
      if (wc) { var wk = wc.parentNode.id === 'world-worlds' ? 'evWorld' : 'evType'; state[wk] = wc.dataset.v || null; renderWorld(); return; }
      var ar = e.target.closest('[data-area]');
      if (ar) { e.preventDefault(); var t = $(ar.dataset.area); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      var s = e.target.closest('#items-show [data-show]');
      if (s) { state.show = s.dataset.show; store('show', state.show); return renderItems(); }
      var t = e.target.closest('#traits-show [data-show]');
      if (t) { state.traitsShow = t.dataset.show; return renderTraits(); }
      var c = e.target.closest('#items-types [data-v], #items-worlds [data-v], #items-modes [data-v]');
      if (c) {
        var key = { 'items-types': 'category', 'items-worlds': 'world', 'items-modes': 'itemsMode' }[c.parentNode.id], v = c.dataset.v === '__all' ? null : c.dataset.v;
        state[key] = state[key] === v ? null : v; store(key, state[key]); return renderItems();
      }
      var tl = e.target.closest('#collection [data-value], #modes [data-value], #summary [data-value]');
      if (tl) {
        var key = { collection: 'missingType', modes: 'missingMode', summary: 'missingWorld' }[tl.parentNode.id];
        var v = tl.dataset.value === '' ? null : tl.dataset.value;
        state[key] = state[key] === v ? null : v; renderChecklist(); return;
      }
      var mm = e.target.closest('#missing-mode-switch [data-mode]');
      if (mm) { state.mode = mm.dataset.mode; store('mode', state.mode); render(); return; }
      var b = e.target.closest('[data-item]');
      if (b && !e.target.closest('a.wiki')) {
        e.preventDefault();
        state.itemSel = state.itemSel === b.dataset.item ? null : b.dataset.item;
        document.querySelectorAll('.ttile').forEach(function (x) { x.classList.toggle('sel', x.dataset.item === state.itemSel); });
        renderDrawer();
      }
    });
    $('item-drawer').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { state.itemSel = null; document.querySelectorAll('.ttile.sel').forEach(function (x) { x.classList.remove('sel'); }); renderDrawer(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.itemSel) { state.itemSel = null; render(); } });
    // A page named in the address (…/#traits) opens on it.
    var h = location.hash.slice(1);
    if (h && document.querySelector('.tab[data-tab="' + h + '"]')) state.tab = h;
    render();
    tryAuto();
  }
  init();
})();
