/* global R2_SAV, R2_VERSION */
// Remnant 2 World Analyzer — page logic. For now: load the saves (automatically through Start.bat, or
// dropped in), decompress them and show what each one holds, as the base for studying the format.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var num = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var state = { files: {}, info: {}, auto: false, listing: [] };

  function setStatus(text, live) { var el = $('status'); el.hidden = false; el.textContent = text; el.classList.toggle('live', !!live); }
  function showError(msg) { var el = $('load-error'); el.textContent = msg; el.hidden = !msg; }

  // Decompress every file and keep what the page shows.
  function rebuild() {
    var names = Object.keys(state.files).sort();
    return Promise.all(names.map(function (n) {
      return R2_SAV.decompress(state.files[n]).then(function (r) {
        var strings = R2_SAV.strings(r.data);
        state.info[n] = { ok: true, size: state.files[n].byteLength, raw: r.data.length, chunks: r.chunks, version: r.head.version, strings: strings };
      }).catch(function (e) { state.info[n] = { ok: false, error: e.message }; });
    })).then(render);
  }

  function render() {
    var names = Object.keys(state.info).sort();
    $('files').innerHTML = names.map(function (n) {
      var i = state.info[n];
      if (!i.ok) return '<section class="panel wide"><h3>' + esc(n) + '</h3><p class="error">' + esc(i.error) + '</p></section>';
      var cls = (i.strings[1] || {}).text || '';
      var groups = {};
      i.strings.forEach(function (s) {
        var m = /^\/Game\/([^/]+)\/(?:[^/]+\/)?([^/]+)/.exec(s.text);
        var k = m ? m[1] : 'Other';
        (groups[k] = groups[k] || []).push(s.text);
      });
      return '<section class="panel wide"><h3>' + esc(n) + ' <span class="cat">' + esc(cls) + '</span></h3>' +
        '<p class="cat">' + num(i.size) + ' bytes on disk · ' + i.chunks + ' compressed chunks · ' + num(i.raw) + ' bytes decompressed · container version ' + i.version + ' · ' + i.strings.length + ' strings</p>' +
        Object.keys(groups).sort().map(function (g) {
          return '<details><summary>' + esc(g) + ' <span class="cat">' + groups[g].length + '</span></summary><p class="cat" style="word-break:break-all">' + groups[g].slice(0, 400).map(esc).join('<br>') + '</p></details>';
        }).join('') + '</section>';
    }).join('');
    $('loader').hidden = names.length > 0;
    $('app').hidden = names.length === 0;
  }

  // Dropped or chosen files.
  function handleFiles(list) {
    var files = Array.prototype.slice.call(list).filter(function (f) { return /\.sav$/i.test(f.name); });
    if (!files.length) return showError('No .sav file found. Pick profile.sav and save_N.sav.');
    Promise.all(files.map(function (f) {
      return f.arrayBuffer().then(function (b) { state.files[f.name.toLowerCase()] = b; });
    })).then(function () { showError(''); setStatus('Manual · files loaded at ' + new Date().toLocaleTimeString(), false); return rebuild(); });
  }

  // Automatic mode: served by server.ps1 (Start.bat), which reads the save folder.
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
      state.auto = true; state.dir = info.dir;
      if (!info.found) return showError('The server could not find the save folder at ' + info.dir + '. Drop the files in, or run Start.bat -SaveDir "<folder>".');
      return sync(info.files).then(function () {
        setInterval(function () { api('api/saves').then(function (r) { return r.json(); }).then(function (i) { if (i.found) sync(i.files); }).catch(function () { setStatus('Server stopped — reopen Start.bat', false); }); }, 3000);
      });
    }).catch(function () { /* not served by server.ps1 */ });
  }

  function init() {
    $('version').textContent = 'Version ' + R2_VERSION.version + ' · Updated on ' + R2_VERSION.date;
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('hover'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('hover'); }); });
    drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
    $('file').addEventListener('change', function (e) { handleFiles(e.target.files); });
    $('theme').addEventListener('click', function () {
      var dark = document.documentElement.dataset.theme !== 'dark';
      if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
      try { localStorage.setItem('r2.theme', JSON.stringify(dark ? 'dark' : 'light')); } catch (e) { /* private mode */ }
    });
    tryAuto();
  }
  init();
})();
