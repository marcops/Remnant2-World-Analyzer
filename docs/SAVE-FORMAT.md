# Remnant 2 save format — study notes

Studied from real saves (`profile.sav`, `save_0.sav`, the game's own backup `_save_0.sav`) and the
installed game, the same way the Remnant 1 analyzer was built: read the bytes, explain every one,
check against the game files. Each finding says what it was checked against.

## Where the saves are

- Steam: `%USERPROFILE%\Saved Games\Remnant2\Steam\<Steam account number>\`
  - `profile.sav` — the account and its characters (archetypes, inventory…)
  - `save_N.sav` — one world per character slot
  - `_save_N.sav` — the game's previous copy of `save_N.sav`
  - `steam_autocloud.vdf` — Steam Cloud marker (not a save)
- Game: `<Steam library>\steamapps\common\Remnant2` — data in IoStore files
  (`Remnant2\Content\Paks\pakchunk*-Windows.utoc/.ucas`, `global.utoc/.ucas`), Unreal Engine 5.

## Container (checked: all three saves decompress, sizes match)

```
u32  checksum            (not CRC-32 of the decompressed data, nor of the rest of the file — still unknown)
u32  decompressed size + 8
u32  container version   (9)
then compressed chunks until the end of the file:
  u32  0x9E2A83C1         Unreal package tag
  u32  0x22222222         (the "large chunk" variant of the tag)
  u64  block size         (0x20000 = 128 KiB)
  u8   compressor         (3 = zlib)
  u64  compressed size
  u64  uncompressed size
  u64  compressed size    (again: the single block's summary)
  u64  uncompressed size
  ...  zlib stream (78 9C)
```

`js/sav.js` reads this (browser: `DecompressionStream('deflate')`, Node: `zlib`) and checks every
chunk's size and the total against the header.

| File | On disk | Chunks | Decompressed |
|---|---|---|---|
| profile.sav | 27,461 | 2 | 179,277 |
| save_0.sav | 308,380 | 25 | 3,210,120 |
| _save_0.sav | 322,984 | 29 | 3,769,466 |

## Decompressed data: the Remnant 1 property format (checked byte by byte)

```
u32  size of what follows
u32  0x000669EC          (Unreal file version, UE5)
u32  0x0000020A
u32  0x000003F1
FString  save class path  (/Game/_Core/Blueprints/Base/BP_RemnantSaveGameProfile, …/BP_RemnantSaveGame)
FString  class name       (BP_RemnantSaveGameProfile_C, BP_RemnantSaveGame_C)
...
```

Then exactly the layout of Remnant 1 saves (js/gvas.js is the Remnant 1 analyzer's reader):

```
u64  name table offset    \  both count from 8 bytes BEFORE the decompressed data
u32  version (1)           |  (they include the file's [checksum][size]):
u64  object table offset  /   position in the data = offset - 8
objects: [u32 index][u32 size][properties][u8 has components][components…]
object table: u32 count, then [u8 loaded][FString path] (+10 bytes when not loaded)
name table:   u32 count, then FStrings
properties:   [u16 name][u16 type][u32 size][u32 array index][u8 has guid][value] … "None"
```

Checked on profile.sav, save_0.sav and _save_0.sav: the objects' data ends exactly where the object
table starts, the object table exactly where the name table starts, and the name table at the last byte.

| File | Objects | Names | Top-level fields |
|---|---|---|---|
| profile.sav | 29 | 180 | LoadscreenTipIndex, Characters (5), ActiveCharacterIndex, bHasEverCompletedIntro, SavedMatchmakingRegion, AccountAwards (21) |
| save_0.sav | 144 | 176 | QuestLabel ("The Ruins"), Difficulty ("Hard"), DifficultyScalar, TimePlayed (159,396 s), QuestFailCount (101), RolledOneShots, ZoneIDGen, QuestIDGen, Containers (143) … |

Strings seen so far:
- profile: archetypes (`Archetype_Archon_UI`, `Archetype_Challenger_UI`), weapons (`Weapon_Enigma`,
  `Weapon_Monolith`, `Weapon_KrellAxe`), armor (`Armor_*_FaeRoyalGuard`), consumables.
- save_0: the current location ("The Ruins"), difficulty ("Hard"), story quests
  (`Quest_Story_OneTrueKing`, `Quest_Story_Asylum`, `Quest_Story_Ravager`, `Quest_Story_TheCore`),
  events (`Quest_Event_Ring_FeedbackLoop`).

## Characters (profile.sav)

`Characters[]` holds SavedCharacter objects (Archetype, SecondaryArchetype, TraitRank, PowerLevel, ItemLevel…)
and a `CharacterData` blob. Remnant 2 blobs start with one more u32 than Remnant 1's:
`[u32 0x20A][u32 0x3F1][u64 names][u32 1][u64 objects]`, offsets from the blob's start — checked byte by
byte (998 objects, 181 names, ends at the blob's last byte). Its root (Character_Master_Player) has the
components Inventory (Items[]: ID, ItemBP, New, Favorited, Hidden, EquipmentSlotIndex, InstanceData {Level,
Ammo…}), Traits (TraitPoints, Traits[]: TraitBP, Level — real traits Trait_*, archetype levels Archetype_*,
perks Perk_*, skill traits SkillTrait_*), Progression (Experience), DragonHearts, Challenge, ammo, stamina.

## The item catalog (js/catalog.js, built by tools/catalog.mjs from the game's .utoc indexes)

Item kinds by file name: Weapon_, Armor_Head/Body/Legs/Gloves_, Ring_, Amulet_, Mod_, MetaGem_ (mutators),
Relic_Consumable_ (relics), RelicFragment_, Engram_ (archetypes), Trait_.
- An item is <prefix>_<its folder> (Items/Trinkets/Rings/BoosterRing/Ring_BoosterRing), or, when the folder
  has another name, any file with an item prefix that isn't a support file (_Inspect, _AnimBP, _Stats,
  _Action, _VisualSet… — the full list in the tool, reviewed by hand).
- Not items: bare hands/body (Weapon_Unarmed, *_Nude), archetype skill weapons (Engineer turrets, Warden
  drone), Armor_*_Base/Default, a weapon's second form, the Ragged Poppet, a stray Ring_Offering_Stone
  (the real ring, Ring_OfferingStone, has the inspect screen, the action and the event that gives it).
- Every real weapon, armor piece, ring, amulet and archetype has an inspect screen (<name>_Inspect); the 16
  without one and not in a save are listed apart as unconfirmed (Remnant 1 leftovers, the DLC4 folder's
  Gambler and Paragon). Mods, mutators, relic fragments and traits never have one.
- A weapon's own mod never shows up in the bag (the save holds Enigma, Monolith, Deceit, Nebula, none of
  their mods): it lives in the weapon's folder and comes with it (40 of them).
- Checked: every item the character holds is in the catalog (test), the 43 Trait_ files are all there.

| Weapons | Mods | Mutators | Armor pieces | Amulets | Rings | Relics | Relic fragments | Traits | Archetypes |
|---|---|---|---|---|---|---|---|---|---|
| 110 | 80 | 68 | 121 | 103 | 225 | 26 | 59 | 43 | 14 |

Names come from the file names (Weapon_WorldsEdge -> "Worlds Edge"): the game's display texts are inside the
Oodle-compressed contents.

## Next

1. Display names (the game's localization is Oodle-compressed) and how to get each item.
2. The world save: zones, quests/events and their state, as in Remnant 1 — what can drop in your world.
3. The checksum, only needed to write saves.
