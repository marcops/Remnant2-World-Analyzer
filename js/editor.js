// Save editor: resource quantities and trait points of a character in profile.sav.
//
// Numbers already in the file are overwritten in place. A resource kept in the bag with no Quantity (the game
// doesn't write the default: one Simulacrum, say) gets one — a 17-byte IntProperty added before the end of its
// item data — and every size and offset around it grows by the same amount (the item's object, the character
// blob and its tables, the CharacterData property, the SavedCharacter object, the file's tables, the data's
// own size). js/sav.js then compresses the file again with a fresh CRC-32, and the result is read back and
// checked. Same approach as Remnant World Analyzer's editor (Remnant 1), whose property format this is.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./gvas.js'), require('./sav.js'));
  else root.R2_EDITOR = factory(root.R2_GVAS, root.R2_SAV);
})(this, function (G, SAV) {
  'use strict';

  // Class -> label, most allowed.
  var SCRAP_MAX = 9999999, MAX = 9999, TRAIT_MAX = 999;
  var RESOURCES = [
    ['Material_Scraps', 'Scrap', SCRAP_MAX],
    ['Material_Iron', 'Iron'], ['Material_ForgedIron', 'Forged Iron'], ['Material_GalvanizedIron', 'Galvanized Iron'], ['Material_HardenedIron', 'Hardened Iron'],
    ['Material_LumeniteCrystal', 'Lumenite Crystal'], ['Material_LumeniteCorrupted', 'Corrupted Lumenite'], ['Material_CorruptedShard', 'Corrupted Shard'],
    ['Material_RelicDust', 'Relic Dust'], ['Material_TomeOfKnowledge', 'Tome of Knowledge'], ['Material_Simulacrum', 'Simulacrum'],
  ];
  function cls(p) { return String(p && (p.path || p) || '').split('/').pop().split('.').pop().replace(/_C$/, ''); }

  // Everything the editor needs about one character.
  function locate(data, charIndex) {
    var file = G.readFile(data), saved = (file.root.props.Characters || [])[charIndex];
    if (!saved || !saved.props || !saved.props.CharacterData) throw new Error('No character ' + (charIndex + 1) + ' in this profile.');
    var ref = saved.props.CharacterData, blob = G.readBlob(data, ref);
    var items = (blob.root.comps.Inventory && blob.root.comps.Inventory.Items) || [];
    var inBag = {}; items.forEach(function (e) { if (e && e.ItemBP) inBag[cls(e.ItemBP)] = e; });
    return { file: file, saved: saved, ref: ref, blob: blob, inBag: inBag, traits: blob.root.comps.Traits };
  }

  // What can be edited for one character: [{ key, label, value, max, editable, note }].
  function fields(data, charIndex) {
    var L; try { L = locate(data, charIndex); } catch (e) { return []; }
    var out = [];
    RESOURCES.forEach(function (r) {
      var e = L.inBag[r[0]]; if (!e) return;
      var inst = e.InstanceData && e.InstanceData.props, has = inst && inst.Quantity != null;
      out.push({ key: r[0], label: r[1], max: r[2] || MAX, value: has ? inst.Quantity : 1, editable: !!inst,
        note: !inst ? 'can’t be edited' : has ? '' : 'stored without an amount (1): saving adds one' });
    });
    var t = L.traits;
    if (t && t._at && t._at.TraitPoints) out.push({ key: 'TraitPoints', label: 'Trait points', max: TRAIT_MAX, value: t.TraitPoints, editable: true, note: '' });
    return out;
  }

  // values: { key: number }. Returns the new decompressed data (a copy), checked by reading it back.
  function apply(data, charIndex, values) {
    var L = locate(data, charIndex), list = fields(data, charIndex);
    var out = new Uint8Array(data), dv = new DataView(out.buffer), inserts = [];
    Object.keys(values).forEach(function (k) {
      var f = list.filter(function (x) { return x.key === k; })[0];
      if (!f || !f.editable) throw new Error(k + ' can\'t be edited.');
      var v = Math.round(+values[k]);
      if (!(v >= 0 && v <= f.max)) throw new Error(f.label + ': between 0 and ' + f.max.toLocaleString('en-US') + '.');
      if (k === 'TraitPoints') return dv.setInt32(L.traits._at.TraitPoints.valuePos, v, true);
      var inst = L.inBag[k].InstanceData;
      if (inst.props._at.Quantity) dv.setInt32(inst.props._at.Quantity.valuePos, v, true);
      else if (v !== 1) inserts.push({ obj: inst, value: v });
    });
    if (inserts.length) out = insertQuantities(out, L, inserts);
    var back = fields(out, charIndex), before = fields(data, charIndex);
    back.forEach(function (f, i) {
      var expect = f.key in values ? Math.round(+values[f.key]) : before[i].value;
      if (f.value !== expect) throw new Error('Read-back check failed for ' + f.label + ': ' + f.value + ' instead of ' + expect + '. Nothing was saved.');
    });
    // Everything else the page reads is the same.
    if (back.length !== before.length) throw new Error('Read-back check failed: the fields changed. Nothing was saved.');
    return out;
  }

  // Adds a Quantity IntProperty to item data that has none, fixing every size and offset that spans it.
  function insertQuantities(bytes, L, inserts) {
    var names = L.blob.names, qi = names.indexOf('Quantity'), ii = names.indexOf('IntProperty');
    if (qi < 0 || ii < 0 || qi > 0x7fff || ii > 0x7fff) throw new Error('This character has no amount on any item yet, so one can’t be added safely.');
    var delta = 17 * inserts.length;
    var file = L.file._at, blob = L.blob._at, saved = L.saved;
    var head = [file.namesOffPos, file.objOffPos, saved._at.sizePos, saved.props._at.CharacterData.sizePos, L.ref.blobAt - 4, blob.namesOffPos, blob.objOffPos];
    var spots = inserts.map(function (x) { return x.obj.props._at.None; });
    var first = Math.min.apply(null, spots), last = Math.max.apply(null, spots);
    // Everything rewritten must sit before the inserts, and every table they point to after them.
    if (head.some(function (p) { return p >= first; }) || file.base + file.namesOff <= last || file.base + file.objOff <= last ||
        blob.base + blob.namesOff <= last || blob.base + blob.objOff <= last || last >= L.ref.blobAt + L.ref.blobLength) {
      throw new Error('Unexpected layout around the items: nothing was changed.');
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var add32 = function (p, d) { view.setUint32(p, view.getUint32(p, true) + d, true); };
    add32(0, delta);                                                     // the data's own size (length - 4)
    add32(file.namesOffPos, delta); add32(file.objOffPos, delta);       // u64s: these stay far below 4 GB
    add32(saved._at.sizePos, delta);
    add32(saved.props._at.CharacterData.sizePos, delta);
    add32(L.ref.blobAt - 4, delta);
    add32(blob.namesOffPos, delta); add32(blob.objOffPos, delta);
    inserts.forEach(function (x) { add32(x.obj._at.sizePos, 17); });
    // name, type, size 4, array index 0, no guid, value
    var prop = function (v) {
      var p = new Uint8Array(17), d = new DataView(p.buffer);
      d.setUint16(0, qi, true); d.setUint16(2, ii, true); d.setUint32(4, 4, true); d.setUint32(8, 0, true); p[12] = 0; d.setInt32(13, v, true);
      return p;
    };
    var sorted = inserts.slice().sort(function (a, b) { return a.obj.props._at.None - b.obj.props._at.None; });
    var out = new Uint8Array(bytes.length + delta), from = 0, to = 0;
    sorted.forEach(function (x) {
      var at = x.obj.props._at.None;
      out.set(bytes.subarray(from, at), to); to += at - from; from = at;
      out.set(prop(x.value), to); to += 17;
    });
    out.set(bytes.subarray(from), to);
    return out;
  }

  // Hardcore death: SavedCharacter.bDeceased (written only once it's true), InvalidExitCount and the character's
  // HealthNormalized, the same fields as Remnant 1 (USavedCharacter in the game's headers).
  function death(data, charIndex) {
    var L = locate(data, charIndex), p = L.saved.props;
    return { hardcore: /Hardcore/.test(String(p.CharacterType || '')), dead: p.bDeceased === true, health: L.blob.root.props.HealthNormalized, invalidExits: p.InvalidExitCount || 0 };
  }

  // The decompressed data with the character alive again: deceased off, invalid exits 0 and, if the health was at
  // zero, back up. Same size, so nothing around it moves; read back and checked.
  function revive(data, charIndex) {
    var L = locate(data, charIndex), p = L.saved.props;
    if (p.bDeceased !== true) throw new Error('This character is not dead.');
    var out = new Uint8Array(data), view = new DataView(out.buffer);
    out[p._at.bDeceased.sizePos + 8] = 0;
    var h = L.blob.root.props._at.HealthNormalized, low = h && !(L.blob.root.props.HealthNormalized > 0);
    if (low) view.setFloat32(h.sizePos + 9, 1, true);
    if (p._at.InvalidExitCount) view.setInt32(p._at.InvalidExitCount.valuePos, 0, true);
    var back = death(out, charIndex);
    if (back.dead || (low && back.health !== 1) || back.invalidExits !== 0) throw new Error('Check failed after reviving: nothing was saved.');
    return out;
  }

  return {
    RESOURCES: RESOURCES,
    fields: fields,
    apply: apply,
    death: death,
    revive: revive,
    // The revived profile.sav, ready to write.
    buildRevive: function (data, charIndex) { return SAV.compress(revive(data, charIndex)); },
    // The edited profile.sav, ready to write.
    build: function (data, charIndex, values) { return SAV.compress(apply(data, charIndex, values)); },
  };
});
