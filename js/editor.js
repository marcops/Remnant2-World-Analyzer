// Save editor: resource quantities and trait points of a character, changed in place in profile.sav.
// Each value is an IntProperty already in the save (an item's InstanceData.Quantity, Traits.TraitPoints):
// its 4 bytes are rewritten, nothing moves, and js/sav.js compresses the file again with a fresh checksum.
// Items with no Quantity property in the save (the Simulacrum when you have one) can't be changed yet.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./gvas.js'), require('./sav.js'));
  else root.R2_EDITOR = factory(root.R2_GVAS, root.R2_SAV);
})(this, function (G, SAV) {
  'use strict';

  // Class -> label, most allowed.
  var RESOURCES = [
    ['Material_Scraps', 'Scrap', 99999999],
    ['Material_Iron', 'Iron', 9999], ['Material_ForgedIron', 'Forged Iron', 9999], ['Material_GalvanizedIron', 'Galvanized Iron', 9999], ['Material_HardenedIron', 'Hardened Iron', 9999],
    ['Material_LumeniteCrystal', 'Lumenite Crystal', 9999], ['Material_LumeniteCorrupted', 'Corrupted Lumenite', 9999], ['Material_CorruptedShard', 'Corrupted Shard', 9999],
    ['Material_RelicDust', 'Relic Dust', 9999], ['Material_TomeOfKnowledge', 'Tome of Knowledge', 9999], ['Material_Simulacrum', 'Simulacrum', 99],
  ];
  var TRAIT_MAX = 999;
  function cls(p) { return String(p && (p.path || p) || '').split('/').pop().split('.').pop().replace(/_C$/, ''); }

  // What can be edited for one character: [{ key, label, value, max, pos (byte of the int), editable }].
  function fields(data, charIndex) {
    var s = G.readFile(data), c = (s.root.props.Characters || [])[charIndex];
    if (!c || !c.props || !c.props.CharacterData) return [];
    var b = G.readBlob(data, c.props.CharacterData), out = [], dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    var items = (b.root.comps.Inventory && b.root.comps.Inventory.Items) || [];
    RESOURCES.forEach(function (r) {
      var e = items.filter(function (x) { return cls(x.ItemBP) === r[0]; })[0];
      if (!e) return;
      var d = e.InstanceData && e.InstanceData.props, at = d && d._at && d._at.Quantity;
      var pos = at && at.valuePos;
      out.push({ key: r[0], label: r[1], max: r[2], value: pos != null ? dv.getInt32(pos, true) : 1, pos: pos, editable: pos != null });
    });
    var t = b.root.comps.Traits, tp = t && t._at && t._at.TraitPoints;
    if (tp && tp.valuePos != null) out.push({ key: 'TraitPoints', label: 'Trait points', max: TRAIT_MAX, value: dv.getInt32(tp.valuePos, true), pos: tp.valuePos, editable: true });
    return out;
  }

  // values: { key: number }. Returns the new decompressed data (a copy), checked by reading it back.
  function apply(data, charIndex, values) {
    var list = fields(data, charIndex), out = new Uint8Array(data), dv = new DataView(out.buffer);
    Object.keys(values).forEach(function (k) {
      var f = list.filter(function (x) { return x.key === k; })[0];
      if (!f || !f.editable) throw new Error(k + ' can\'t be edited.');
      var v = Math.round(+values[k]);
      if (!(v >= 0 && v <= f.max)) throw new Error(f.label + ': between 0 and ' + f.max.toLocaleString('en-US') + '.');
      dv.setInt32(f.pos, v, true);
    });
    var back = fields(out, charIndex);
    Object.keys(values).forEach(function (k) {
      var f = back.filter(function (x) { return x.key === k; })[0];
      if (!f || f.value !== Math.round(+values[k])) throw new Error('Read-back check failed for ' + k + '.');
    });
    return out;
  }

  return {
    RESOURCES: RESOURCES,
    fields: fields,
    apply: apply,
    // The edited profile.sav, ready to write.
    build: function (data, charIndex, values) { return SAV.compress(apply(data, charIndex, values)); },
  };
});
