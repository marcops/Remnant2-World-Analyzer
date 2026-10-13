// The rolled worlds of a Remnant 2 world save (save_N.sav): campaign and adventure, their areas and what is in
// each — bosses, dungeons, injectable events, rings and amulets on the ground, trait books, simulacrums — and
// whether it's done. The walk follows lib.remnant2.analyzer's Analyzer.WorldSave.cs (MIT, © Andrew Savinykh):
//   Main level: the last Quest_Campaign* / Quest_AdventureMode* actor; its ID names the level holding the roll
//   (Quest_<ID>_Container). Its components World1, Labyrinth, World2, World3, RootEarth (campaign) or Quest
//   (adventure) give each world's QuestID. The roll's ZoneActors (Label = area name, ZoneLinks = waypoints,
//   checkpoints and links to other areas) are walked from the world's first area; the roll's other actors with
//   an ID are its events: by quest (ID = the world's QuestID: story, boss, miniboss, dungeon) or by area (ZoneID).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.R2_WORLD = factory();
})(this, function () {
  'use strict';

  var MODES = [
    { key: 'campaign', label: 'Campaign', selector: 'Quest_Campaign', worlds: ['World1', 'Labyrinth', 'World2', 'World3', 'RootEarth'] },
    { key: 'adventure', label: 'Adventure', selector: 'Quest_AdventureMode', worlds: ['Quest'] },
  ];
  var DIFFICULTY = ['None', 'Survivor', 'Veteran', 'Nightmare', 'Apocalypse'];

  function last(path) { return String(path || '').split('/').pop(); }
  // An actor's class name: its dynamic data's class, else its first object's class.
  function nameOf(a) {
    if (a.dynamic && a.dynamic.name) return a.dynamic.name;
    var o = a.archive && a.archive.root;
    return o ? last(o.path).split('.').pop() : '';
  }
  function rootOf(a) { return (a.archive && a.archive.root) || { props: {}, comps: {} }; }
  function clean(ev) { return ev.replace(/_C$/, '').replace(/_V2$/, '').replace(/_OneShot$/, ''); }
  function str(v) { return v == null ? '' : String(v); }

  // Items an event's spawners put down, and whether they were picked up.
  function lootedMarkers(a) {
    var out = [], comps = rootOf(a).comps || {};
    Object.keys(comps).forEach(function (k) {
      var spawns = comps[k] && comps[k].Spawns;
      if (!Array.isArray(spawns)) return;
      spawns.forEach(function (s) {
        var e = s && s.SpawnEntry;
        if (!e || !/Item$/.test(str(e.Type)) || !e.ActorBP) return;
        out.push({ path: str(e.ActorBP), looted: s.Destroyed === 1 || s.Destroyed === true, tags: e.SpawnPointTags || [] });
      });
    });
    return out;
  }

  // A ZoneActor's extra bytes (lib.remnant2.saves' ZoneActorExtraData): f64 ?, f64 grid resolution, origin
  // (3 × f64), i32 apply-map-offset, i32 count, count × visited cell (3 × i16). Null when they don't fit.
  function visited(data, extra) {
    if (!extra || extra.length < 48) return null;
    var dv = new DataView(data.buffer, data.byteOffset + extra.at, extra.length);
    var count = dv.getInt32(44, true);
    if (count < 0 || 48 + count * 6 !== extra.length) return null;
    var cells = [];
    for (var i = 0; i < count; i++) cells.push([dv.getInt16(48 + i * 6, true), dv.getInt16(50 + i * 6, true), dv.getInt16(52 + i * 6, true)]);
    return { resolution: dv.getFloat64(8, true), origin: [dv.getFloat64(16, true), dv.getFloat64(24, true), dv.getFloat64(32, true)], cells: cells };
  }

  // What a tile level holds, by actor class: items on the ground (still there: picked-up ones are destroyed),
  // trait books, simulacrums, chests, NPCs, the rest.
  function tileContents(level) {
    var out = { items: [], traitBooks: 0, simulacrums: 0, chests: 0, npcs: [], other: {} };
    level.actors.forEach(function (a) {
      var n = nameOf(a).replace(/_C$/, '');
      if (!n) return;
      if (/^(Weapon|Armor_(Head|Body|Legs|Gloves)|Ring|Amulet|Mod|MetaGem|Relic|RelicFragment|Engram|Trait|Quest_Item|Consumable|Concoction|PrismOfThe|Prism)_/.test(n) || /^Prism/.test(n)) out.items.push(n);
      else if (/TomeOfKnowledge/.test(n)) out.traitBooks++;
      else if (/Simulacrum/.test(n)) out.simulacrums++;
      else if (/LootContainer|Chest/.test(n)) out.chests++;
      else if (/^(Char|Character)_.*NPC|_NPC_/.test(n)) out.npcs.push(n.replace(/^(Char|Character)_(Town_)?(NPC_)?/, '').replace(/^.*_NPC_/, '').replace(/_/g, ' '));
      else out.other[n] = (out.other[n] || 0) + 1;
    });
    return out;
  }

  // What a tile is, from its level name (Fae_City_CRN_02, Pan_Jungle_STR_01, …_End_Transition_…, Quest_…_POI):
  // the zone's own map (Template), a way out to another area, a point of interest, or a piece of corridor.
  function tileType(kind, level) {
    if (kind === 'Template') return { key: 'start', label: 'Main map' };
    if (/^Sub\d+$/.test(kind)) return { key: /Interior|Cave|Crypt/i.test(level) ? 'poi' : '', label: 'Section' };
    if (/Transition/i.test(level)) return { key: 'exit', label: 'Way out' };
    if (/^Quest_|_POI/i.test(level)) return { key: 'poi', label: 'Point of interest' };
    if (/_CRN_/i.test(level)) return { key: '', label: 'Corner' };
    if (/_TJ_/i.test(level)) return { key: '', label: 'Junction' };
    if (/_STR_/i.test(level)) return { key: '', label: 'Corridor' };
    if (/_END_|_End_|DeadEnd/i.test(level)) return { key: 'end', label: 'Dead end' };
    if (/Overlay|Backtrack/i.test(level)) return { key: '', label: 'Overlay' };
    return { key: '', label: kind === 'Gen' ? 'Tile' : 'Part' };
  }

  function readMode(G, data, containers, mode) {
    var main = containers['/Game/Maps/Main.Main:PersistentLevel'];
    if (!main) return null;
    var metaActor = main.actors.filter(function (a) { return nameOf(a).indexOf(mode.selector) === 0; }).pop();
    if (!metaActor) return null;
    var meta = rootOf(metaActor), rollId = meta.props.ID;
    var roll = containers['/Game/Quest_' + rollId + '_Container.Quest_Container:PersistentLevel'];
    if (!roll) return null;
    var worldIds = mode.worlds.map(function (w) { var c = meta.comps[w]; return c && c.QuestID; });
    if (worldIds.some(function (x) { return x == null; })) worldIds = worldIds.filter(function (x) { return x != null; });
    if (!worldIds.length) return null;
    var labyrinth = mode.worlds.indexOf('Labyrinth') >= 0 ? meta.comps.Labyrinth && meta.comps.Labyrinth.QuestID : 0;

    var zones = roll.actors.filter(function (a) { return nameOf(a) === 'ZoneActor' || /ZoneActor/.test(last(rootOf(a).path)); });
    var events = roll.actors.filter(function (a) { var o = rootOf(a); return zones.indexOf(a) < 0 && o.props && 'ID' in o.props; });
    var zp = function (a) { return rootOf(a).props; };
    var questOfZones = {}; zones.forEach(function (z) { questOfZones[zp(z).QuestID] = true; });

    var worlds = worldIds.map(function (world) {
      var top = zones.filter(function (z) { return zp(z).QuestID === world && !('ParentZoneID' in zp(z)); });
      if (!top.length) return null;
      var start = top.filter(function (z) { return /one1/.test(str(zp(z).NameID)); })[0] || top[0];
      var queue = [start], seen = {}, locations = [], category = '', story = null;
      while (queue.length) {
        var cur = queue.shift(), p = zp(cur), label = str(p.Label);
        if (seen[label]) continue;
        seen[label] = true;
        var loc = { name: label, zoneId: p.ID, questId: p.QuestID, waypoints: [], checkpoints: [], links: [], events: [], worldDrops: [], markers: [], tiles: [], cells: [] };
        // The area's levels (Zone_<id>[_<n>]_Gen/Template/SubN) for every zone with this name in this world.
        zones.filter(function (z) { return str(zp(z).Label) === label && zp(z).QuestID === p.QuestID; }).forEach(function (z) {
          var id = zp(z).ID, v = visited(data, rootOf(z).extra);
          if (v) loc.cells.push(v);
          Object.keys(containers).forEach(function (k) {
            var m = /^\/Game\/Zone_(\d+)(?:_(\d+))?_(Gen|Template|Sub\d+)\.([^:]+)/.exec(k);
            if (!m || +m[1] !== id) return;
            var sub = /^Sub(\d+)$/.exec(m[3]);
            loc.tiles.push({ level: m[4], kind: m[3], n: m[2] != null ? +m[2] : sub ? 1000 + +sub[1] : -1, type: tileType(m[3], m[4]), contents: tileContents(containers[k]) });
          });
        });
        // A handmade map's sections come in two layers (X and X_Design): one tile each. Names lose the map's
        // own prefix ("Quest_Story_DLC2_Upper_Village" in Quest_Story_DLC2_Upper -> "Upper Village").
        var main = loc.tiles.filter(function (t) { return t.kind === 'Template'; })[0];
        var prefix = main ? main.level.replace(/_[^_]+$/, '_') : '';
        var merged = {};
        loc.tiles.forEach(function (t) {
          var base = t.level.replace(/_Design$/, '');
          if (merged[base]) {
            var c = merged[base].contents, d = t.contents;
            c.items = c.items.concat(d.items); c.traitBooks += d.traitBooks; c.simulacrums += d.simulacrums; c.chests += d.chests; c.npcs = c.npcs.concat(d.npcs);
            merged[base].n = Math.min(merged[base].n, t.n);
          } else merged[base] = t;
          var nice = (prefix && base.indexOf(prefix) === 0 && base !== main.level ? base.slice(prefix.length) : base)
            .replace(/^(Fae|Pan|Nerud|Root|Jungle|Labyrinth)_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
          merged[base].name = nice;
        });
        loc.tiles = Object.keys(merged).map(function (k) { return merged[k]; });
        (p.ZoneLinks || []).forEach(function (l) {
          var type = str(l.Type), name = str(l.NameID);
          if (!category && l.Category && str(l.Category) !== 'None') category = str(l.Category);
          if (/Waypoint$/.test(type)) loc.waypoints.push({ id: name, label: str(l.Label) });
          else if (/Checkpoint$/.test(type)) loc.checkpoints.push(name);
          else if (/Link$/.test(type)) {
            var dest = str(l.DestinationZone);
            if (dest === 'None' || !dest || /CardDoor/.test(name) || dest === '2_Zone') return;
            var dz = zones.filter(function (z) { return str(zp(z).NameID) === dest; })[0];
            if (!dz) return;
            var dl = str(zp(dz).Label);
            if ((str(l.Label) === 'Malefic Palace' && dl === 'Beatific Palace') || (dl === 'Malefic Palace' && str(l.Label) === 'Beatific Palace')) return;
            var dq = zp(dz).QuestID;
            var crossLabyrinth = labyrinth && ((dq === labyrinth) !== (world === labyrinth));
            if (crossLabyrinth) return;
            if (loc.links.indexOf(dl) < 0) loc.links.push(dl);
            if (!seen[dl]) queue.push(dz);
          }
        });
        loc.category = category;
        // Events of the whole world quest (story, boss, miniboss, dungeon) go to the area that has them first.
        events.slice().forEach(function (e) {
          var o = rootOf(e);
          if (o.props.ID !== p.QuestID) return;
          events.splice(events.indexOf(e), 1);
          var ev = clean(nameOf(e)), done = /Complete$/.test(str(o.props.QuestState));
          loc.markers = loc.markers.concat(lootedMarkers(e));
          if (/^Quest_Story/.test(ev)) { story = { name: ev, done: done }; return; }
          loc.events.push({ name: ev, done: done });
        });
        // Events of this area (trait book, simulacrum, ring/amulet on the ground, injectables).
        events.slice().forEach(function (e) {
          var o = rootOf(e);
          if (!('ZoneID' in o.props) || o.props.ZoneID !== p.ID || questOfZones[o.props.ID]) return;
          events.splice(events.indexOf(e), 1);
          // Picked up: the Loot component's spawned item is marked Destroyed.
          var ev = clean(nameOf(e)), loot = o.comps && o.comps.Loot;
          var taken = !!(loot && ((loot.Destroyed === 1 || loot.Destroyed === true) || (loot.Spawns || []).some(function (s) { return s && (s.Destroyed === true || s.Destroyed === 1); })));
          loc.markers = loc.markers.concat(lootedMarkers(e));
          if (/^Quest_Event_Trait/.test(ev)) { loc.traitBook = { looted: taken }; return; }
          if (/Simulacrum/.test(ev)) { loc.simulacrum = { looted: taken }; return; }
          if (/^Quest_Event_/.test(ev)) { loc.worldDrops.push({ name: ev.slice('Quest_Event_'.length), looted: taken }); return; }
          loc.events.push({ name: ev, done: taken, injectable: true });
        });
        locations.push(loc);
      }
      return { questId: world, story: story, locations: locations };
    }).filter(Boolean);

    var d = meta.props.Difficulty;
    // Quest items carried in this world (the roll's own inventory; hidden ones left out).
    var inv = meta.comps.RemnantPlayerInventory, questItems = [];
    ((inv && inv.Items) || []).forEach(function (e) {
      if (!e || e.Hidden) return;
      var bp = e.ItemBP && (e.ItemBP.path || e.ItemBP);
      if (bp) questItems.push({ path: str(bp), quantity: e.InstanceData && e.InstanceData.Quantity });
    });
    return {
      questItems: questItems,
      key: mode.key, label: mode.label, slot: meta.props.SlotID,
      difficulty: DIFFICULTY[d] || (d != null ? String(d) : ''),
      playTime: meta.props.PlayTime ? meta.props.PlayTime / 1e7 : null,   // FTimespan: 100 ns ticks
      respawn: str(meta.props.RespawnLinkNameID),
      worlds: worlds,
    };
  }

  return {
    // data: a decompressed save_N.sav; G: js/gvas.js.
    read: function (data, G) {
      var save = G.readFile(data), containers = {};
      (save.root.props.Containers || []).forEach(function (c) {
        if (!c || !c.props || !c.props.Blob) return;
        try { containers[str(c.props.Key)] = G.readContainer(data, c.props.Blob); } catch (e) { /* unreadable level: skipped */ }
      });
      var p = save.root.props, modes = {};
      MODES.forEach(function (m) { try { var r = readMode(G, data, containers, m); if (r) modes[m.key] = r; } catch (e) { modes[m.key] = { key: m.key, label: m.label, error: e.message, worlds: [] }; } });
      var active = null;
      Object.keys(modes).forEach(function (k) { if (modes[k].slot === p.LastActiveRootSlot) active = k; });
      return { modes: modes, active: active || (modes.campaign ? 'campaign' : 'adventure'), questLabel: str(p.QuestLabel), timePlayed: p.TimePlayed || 0, containers: Object.keys(containers).length };
    },
  };
});
