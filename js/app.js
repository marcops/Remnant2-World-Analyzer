/* global R2_SAV, R2_GVAS, R2_CHARACTER, R2_CATALOG, R2_VERSION */
// Remnant 2 World Analyzer — page logic: load the saves (automatically through Start.bat, or dropped in),
// read the characters, and show every collectible item of the game (js/catalog.js) as had / missing.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var num = function (n) { return Math.round(n).toLocaleString('en-US'); };
  function recall(k, d) { try { var v = localStorage.getItem('r2.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem('r2.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  var state = {
    files: {}, info: {}, listing: [], profile: null,
    tab: recall('tab', 'items'), show: recall('show', 'missing'), category: recall('category', null), world: recall('world', null), charIndex: recall('char', 0),
  };

  // Where an item comes from, by its game folder.
  var WORLDS = [
    ['World_Base', 'Base game'], ['World_Root', 'Root Earth'], ['World_Fae', 'Losomn'], ['World_Jungle', 'Yaesha'], ['World_Nerud', "N'Erud"],
    ['World_Labyrinth', 'Labyrinth'], ['World_DLC1', 'The Awakened King (DLC 1)'], ['World_DLC2', 'The Forgotten Kingdom (DLC 2)'],
    ['World_DLC3', 'The Dark Horizon (DLC 3)'], ['World_DLC4', 'DLC 4 folder'], ['Events', 'Events'], ['', 'Other'],
  ];
  var CATEGORIES = ['Weapon', 'Mod', 'Mutator', 'Armor', 'Amulet', 'Ring', 'Relic', 'Relic fragment', 'Trait', 'Archetype'];
  var PLURAL = { Weapon: 'Weapons', Mod: 'Mods', Mutator: 'Mutators', Armor: 'Armor pieces', Amulet: 'Amulets', Ring: 'Rings', Relic: 'Relics', 'Relic fragment': 'Relic fragments', Trait: 'Traits', Archetype: 'Archetypes' };
  function worldOf(it) { return it.world || (/^\/Game\/Events\//.test(it.key) ? 'Events' : ''); }
  function worldLabel(w) { var x = WORLDS.filter(function (p) { return p[0] === w; })[0]; return x ? x[1] : w; }

  function setStatus(text, live) { var el = $('status'); el.hidden = false; el.textContent = text; el.classList.toggle('live', !!live); }
  function showError(msg) { var el = $('load-error'); el.textContent = msg; el.hidden = !msg; }
  function character() { var p = state.profile; return p && p.characters[state.charIndex] || null; }
  function owned(it) {
    var ch = character(); if (!ch) return null;
    return !!(ch.owned[it.key] || (it.comesWith && ch.owned[it.comesWith]));
  }
  function levelOf(it) {
    var ch = character(); if (!ch) return null;
    if (it.category === 'Trait') { var t = ch.traits.filter(function (x) { return x.key === it.key; })[0]; return t ? t.level : null; }
    if (it.category === 'Archetype') { var n = it.cls.replace(/^Engram_/, ''), a = ch.archetypeLevels.filter(function (x) { return x.cls === 'Archetype_' + n; })[0]; return a ? a.level : null; }
    var row = ch.inventory.filter(function (x) { return x.key === it.key; })[0];
    return row && row.level != null ? row.level : null;
  }

  // ---- loading ---------------------------------------------------------------
  function rebuild() {
    var names = Object.keys(state.files).sort();
    state.profile = null;
    return Promise.all(names.map(function (n) {
      return R2_SAV.decompress(state.files[n]).then(function (r) {
        var save = null, err = null;
        try { save = R2_GVAS.readFile(r.data); } catch (e) { err = e.message; }
        state.info[n] = { ok: true, size: state.files[n].byteLength, raw: r.data.length, chunks: r.chunks, version: r.head.version, strings: R2_SAV.strings(r.data), save: save, readError: err };
        if (n === 'profile.sav') { try { state.profile = R2_CHARACTER.read(r.data); } catch (e) { state.info[n].readError = 'Characters: ' + e.message; } }
      }).catch(function (e) { state.info[n] = { ok: false, error: e.message }; });
    })).then(function () {
      var p = state.profile;
      if (p && !p.characters[state.charIndex]) state.charIndex = p.characters.findIndex(Boolean);
      render();
    });
  }

  // ---- rendering ---------------------------------------------------------------
  function render() {
    var any = Object.keys(state.info).length > 0;
    $('loader').hidden = any; $('app').hidden = !any;
    if (!any) return;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === state.tab); });
    $('tab-items').hidden = state.tab !== 'items'; $('tab-files').hidden = state.tab !== 'files';
    renderCharacter(); renderItems(); renderFiles();
  }

  function renderCharacter() {
    var p = state.profile, el = $('who');
    if (!p) { el.innerHTML = '<p class="note">No <b>profile.sav</b>: can\'t tell what you have. Load profile.sav too.</p>'; return; }
    var chars = p.characters.map(function (c, i) { return c ? '<option value="' + i + '"' + (i === state.charIndex ? ' selected' : '') + '>Character ' + (i + 1) + ' — ' + esc(c.archetype + (c.secondary ? ' / ' + c.secondary : '')) + '</option>' : ''; }).join('');
    var ch = character();
    el.innerHTML = '<div class="picker"><label class="field">Character <select id="character">' + chars + '</select></label></div>' + (ch ? '<div class="summary">' +
      card('Archetypes', esc(ch.archetype + (ch.secondary ? ' / ' + ch.secondary : '')), ch.archetypeLevels.filter(function (a) { return a.level > 0; }).map(function (a) { return esc(a.name) + ' ' + a.level; }).join(' · ')) +
      card('Trait rank', num(ch.traitRank), num(ch.traitPoints || 0) + ' trait points') +
      card('Power level', ch.powerLevel, 'item level ' + ch.itemLevel) +
      card('In the bag', num(ch.inventory.length), 'items · ' + (ch.dragonHearts || 0) + ' Dragon Heart charges') +
      '</div>' + (ch.error ? '<p class="error">' + esc(ch.error) + '</p>' : '') : '');
  }
  function card(title, big, sub, pct) {
    return '<div class="card static"><div class="w">' + esc(title) + '</div><div class="n neutral">' + big + '</div><div class="of">' + (sub || '') + '</div>' +
      (pct != null ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</div>';
  }

  function renderItems() {
    var items = R2_CATALOG.items.filter(function (i) { return !i.unconfirmed; });
    var hasProfile = !!character();
    var q = ($('items-search').value || '').trim().toLowerCase();
    var show = hasProfile ? state.show : 'all';
    // Cards: one per category (they ignore the category filter, follow the world filter).
    var inWorld = function (i) { return state.world == null || worldOf(i) === state.world; };
    var cards = CATEGORIES.map(function (c) {
      var list = items.filter(function (i) { return i.category === c && inWorld(i); }), have = list.filter(function (i) { return owned(i); }).length;
      if (!list.length) return '';
      var pct = Math.round(100 * have / list.length);
      return '<button type="button" class="card' + (state.category === c ? ' on' : '') + '" data-category="' + esc(c) + '"><div class="w">' + esc(PLURAL[c]) + '</div>' +
        '<div class="n ' + (hasProfile && have === list.length ? 'done' : 'neutral') + '">' + (hasProfile ? have + ' / ' + list.length : list.length) + '</div>' +
        '<div class="of">' + (hasProfile ? (list.length - have) + ' missing · ' + pct + '%' : 'load profile.sav') + '</div><div class="bar"><i style="width:' + (hasProfile ? pct : 0) + '%"></i></div></button>';
    }).join('');
    var all = items.filter(inWorld), haveAll = all.filter(function (i) { return owned(i); }).length;
    $('items-cards').innerHTML = (hasProfile ? '<p class="cat">' + haveAll + ' of ' + all.length + ' collectibles · ' + Math.round(100 * haveAll / Math.max(1, all.length)) + '%</p>' : '') + '<div class="summary">' + cards + '</div>';

    var worlds = WORLDS.filter(function (w) { return items.some(function (i) { return worldOf(i) === w[0]; }); });
    $('items-filters').innerHTML = (hasProfile ? '<div class="seg" id="items-show">' + [['missing', 'Missing'], ['owned', 'I have'], ['all', 'All']].map(function (s) {
      return '<button type="button" data-show="' + s[0] + '" class="' + (show === s[0] ? 'active' : '') + '">' + s[1] + '</button>';
    }).join('') + '</div>' : '') +
      '<div class="filter-row"><span class="filter-label">From</span><div class="chips" id="items-worlds"><span class="chip' + (state.world == null ? ' on' : '') + '" data-world="__all">All</span>' +
      worlds.map(function (w) { return '<span class="chip' + (state.world === w[0] ? ' on' : '') + '" data-world="' + esc(w[0]) + '">' + esc(w[1]) + '</span>'; }).join('') + '</div></div>';

    var rows = items.filter(function (i) {
      if (state.category && i.category !== state.category) return false;
      if (!inWorld(i)) return false;
      var o = owned(i);
      if (show === 'missing' && o) return false;
      if (show === 'owned' && !o) return false;
      return !q || (i.name + ' ' + i.cls + ' ' + (i.weapon || '')).toLowerCase().indexOf(q) >= 0;
    });
    var groups = {};
    rows.forEach(function (i) { (groups[i.category] = groups[i.category] || []).push(i); });
    var body = CATEGORIES.filter(function (c) { return groups[c]; }).map(function (c) {
      return '<div class="group"><h3>' + esc(PLURAL[c]) + ' <small>' + groups[c].length + '</small></h3><ul class="ilist">' + groups[c].map(function (i) {
        var o = owned(i), lv = o ? levelOf(i) : null;
        return '<li class="' + (o === true ? 'have' : o === false ? 'miss' : '') + '"><span class="st">' + (o === true ? '✔' : o === false ? '✘' : '·') + '</span> ' + esc(i.name) +
          (lv != null && lv > 0 ? ' <span class="lvl">' + (i.category === 'Trait' || i.category === 'Archetype' ? 'level ' : '+') + lv + '</span>' : '') +
          ' <span class="cat">' + esc(worldLabel(worldOf(i))) + (i.weapon ? ' · comes with ' + esc(i.weapon) : '') + '</span></li>';
      }).join('') + '</ul></div>';
    }).join('');
    var un = R2_CATALOG.items.filter(function (i) { return i.unconfirmed; });
    $('items-view').innerHTML = (body || '<div class="empty">' + (show === 'missing' ? 'Nothing missing with these filters. 🎉' : 'No items with these filters.') + '</div>') +
      '<details class="unconfirmed"><summary class="cat">In the game files but not confirmed obtainable (' + un.length + '): no inspect screen and not in your save — Remnant 1 leftovers or unreleased content</summary><p class="cat">' +
      un.map(function (i) { return esc(i.name) + ' (' + esc(i.category) + ')'; }).join(' · ') + '</p></details>';
  }

  function renderFiles() {
    var names = Object.keys(state.info).sort();
    $('files').innerHTML = names.map(function (n) {
      var i = state.info[n];
      if (!i.ok) return '<section class="panel wide"><h3>' + esc(n) + '</h3><p class="error">' + esc(i.error) + '</p></section>';
      return '<section class="panel wide"><h3>' + esc(n) + ' <span class="cat">' + esc((i.strings[1] || {}).text || '') + '</span></h3>' +
        '<p class="cat">' + num(i.size) + ' bytes on disk · ' + i.chunks + ' compressed chunks · ' + num(i.raw) + ' bytes decompressed · container version ' + i.version +
        (i.save ? ' · ' + i.save.objects.length + ' objects · ' + i.save.names.length + ' names' : '') + '</p>' +
        (i.readError ? '<p class="error">' + esc(i.readError) + '</p>' : i.save ? rootTable(i.save.root.props) : '') + '</section>';
    }).join('');
  }
  function rootTable(props) {
    return '<table class="kv">' + Object.keys(props).map(function (k) {
      var v = props[k], shown = Array.isArray(v) ? v.length + ' entries' : v && typeof v === 'object' ? (v.path ? String(v.path).split('/').pop() : 'object') : String(v);
      return '<tr><th>' + esc(k) + '</th><td>' + esc(shown) + '</td></tr>';
    }).join('') + '</table>';
  }

  // ---- files in ------------------------------------------------------------------
  function handleFiles(list) {
    var files = Array.prototype.slice.call(list).filter(function (f) { return /\.sav$/i.test(f.name); });
    if (!files.length) return showError('No .sav file found. Pick profile.sav and save_N.sav.');
    Promise.all(files.map(function (f) { return f.arrayBuffer().then(function (b) { state.files[f.name.toLowerCase()] = b; }); }))
      .then(function () { showError(''); setStatus('Manual · files loaded at ' + new Date().toLocaleTimeString(), false); return rebuild(); });
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
      if (!info.found) return showError('The server could not find the save folder at ' + info.dir + '. Drop the files in, or run Start.bat -SaveDir "<folder>".');
      return sync(info.files).then(function () {
        setInterval(function () { api('api/saves').then(function (r) { return r.json(); }).then(function (i) { if (i.found) sync(i.files); }).catch(function () { setStatus('Server stopped — reopen Start.bat', false); }); }, 3000);
      });
    }).catch(function () { /* not served by server.ps1 */ });
  }

  function init() {
    $('version').textContent = 'Version ' + R2_VERSION.version + ' · Updated on ' + R2_VERSION.date + ' · catalog of ' + R2_CATALOG.items.filter(function (i) { return !i.unconfirmed; }).length + ' items from the game files (' + R2_CATALOG.generated + ')';
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('hover'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('hover'); }); });
    drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
    $('file').addEventListener('change', function (e) { handleFiles(e.target.files); });
    $('theme').addEventListener('click', function () {
      var dark = document.documentElement.dataset.theme !== 'dark';
      if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
      store('theme', dark ? 'dark' : 'light');
    });
    document.querySelector('.tabs').addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (b) { state.tab = b.dataset.tab; store('tab', state.tab); render(); } });
    $('who').addEventListener('change', function (e) { if (e.target.id === 'character') { state.charIndex = +e.target.value; store('char', state.charIndex); render(); } });
    $('items-search').addEventListener('input', renderItems);
    $('items-cards').addEventListener('click', function (e) { var c = e.target.closest('[data-category]'); if (!c) return; state.category = state.category === c.dataset.category ? null : c.dataset.category; store('category', state.category); renderItems(); });
    $('items-filters').addEventListener('click', function (e) {
      var s = e.target.closest('[data-show]'); if (s) { state.show = s.dataset.show; store('show', state.show); return renderItems(); }
      var w = e.target.closest('[data-world]'); if (w) { state.world = w.dataset.world === '__all' ? null : w.dataset.world; store('world', state.world); renderItems(); }
    });
    tryAuto();
  }
  init();
})();
