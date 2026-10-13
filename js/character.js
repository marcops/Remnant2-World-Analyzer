// The characters of a Remnant 2 profile.sav (decompressed by js/sav.js, read by js/gvas.js):
// archetypes, levels, and what each one holds — its inventory and its trait list.
//
// profile root: Characters[] -> SavedCharacter objects { Archetype, SecondaryArchetype, TraitRank, PowerLevel,
//   ItemLevel, CharacterData (a blob) … }. The blob's root (Character_Master_Player) has components:
//   Inventory.Items[] { ID, ItemBP (game path), New, Favorited, Hidden, EquipmentSlotIndex, InstanceData },
//   Traits.Traits[] { TraitBP, Level, SlotIndex } — real traits (Trait_*), archetype levels (Archetype_*),
//   archetype perks (Perk_*) and skill traits (SkillTrait_*) — Traits.TraitPoints, Progression.Experience,
//   DragonHearts.Value, Challenge.ObjectiveProgressList.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./gvas.js'));
  else root.R2_CHARACTER = factory(root.R2_GVAS);
})(this, function (GVAS) {
  'use strict';

  function path(p) { return String(p && (p.path || p) || ''); }
  function cls(p) { return path(p).split('.').pop().replace(/_C$/, ''); }
  function words(s) { return String(s).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim(); }
  function archetype(p) { return p ? words(cls(p).replace(/^Archetype_/, '').replace(/_UI$/, '')) : ''; }

  // data: the decompressed profile.
  function read(data) {
    var file = GVAS.readFile(data), rootProps = file.root.props;
    var characters = (rootProps.Characters || []).map(function (c, slot) {
      if (!c || !c.props) return null;
      var p = c.props, out = {
        slot: slot, archetype: archetype(p.Archetype), secondary: archetype(p.SecondaryArchetype),
        traitRank: p.TraitRank || 0, powerLevel: p.PowerLevel || 0, itemLevel: p.ItemLevel || 0,
        owned: {}, inventory: [], traits: [], archetypeLevels: [], perks: [],
      };
      if (!p.CharacterData) return out;
      try {
        var blob = GVAS.readBlob(data, p.CharacterData), comps = blob.root.comps || {};
        (comps.Inventory && comps.Inventory.Items || []).forEach(function (e) {
          if (!e || !e.ItemBP) return;
          var k = path(e.ItemBP), d = e.InstanceData && e.InstanceData.props;
          out.owned[k] = true;
          out.inventory.push({ key: k, cls: cls(k), level: d && d.Level != null ? d.Level : null, quantity: d && d.Quantity != null ? d.Quantity : null, equipped: e.EquipmentSlotIndex >= 0 });
        });
        (comps.Traits && comps.Traits.Traits || []).forEach(function (t) {
          if (!t || !t.TraitBP) return;
          var k = path(t.TraitBP), c2 = cls(k), row = { key: k, cls: c2, name: words(c2.replace(/^(Trait|Archetype|Perk|SkillTrait)_/, '')), level: t.Level || 0 };
          if (/^Trait_/.test(c2)) { out.traits.push(row); out.owned[k] = true; }
          else if (/^Archetype_/.test(c2)) out.archetypeLevels.push(row);
          else out.perks.push(row);
        });
        out.traitPoints = comps.Traits && comps.Traits.TraitPoints || 0;
        out.experience = comps.Progression && comps.Progression.Experience || 0;
        out.dragonHearts = comps.DragonHearts && comps.DragonHearts.Value || 0;
      } catch (e) { out.error = String(e && e.message || e); }
      return out;
    });
    return { characters: characters, active: rootProps.ActiveCharacterIndex || 0 };
  }

  return { read: read, words: words };
});
