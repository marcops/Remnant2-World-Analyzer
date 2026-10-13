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

## Decompressed data (first look)

```
u32  size of what follows
u32  0x000669EC          (Unreal file version, UE5)
u32  0x0000020A
u32  0x000003F1
FString  save class path  (/Game/_Core/Blueprints/Base/BP_RemnantSaveGameProfile, …/BP_RemnantSaveGame)
FString  class name       (BP_RemnantSaveGameProfile_C, BP_RemnantSaveGame_C)
...
```

Strings seen so far:
- profile: archetypes (`Archetype_Archon_UI`, `Archetype_Challenger_UI`), weapons (`Weapon_Enigma`,
  `Weapon_Monolith`, `Weapon_KrellAxe`), armor (`Armor_*_FaeRoyalGuard`), consumables.
- save_0: the current location ("The Ruins"), difficulty ("Hard"), story quests
  (`Quest_Story_OneTrueKing`, `Quest_Story_Asylum`, `Quest_Story_Ravager`, `Quest_Story_TheCore`),
  events (`Quest_Event_Ring_FeedbackLoop`).

## Next

1. The property layout after the header (names table? objects? — compare with Remnant 1's format).
2. Characters, archetypes and inventory in the profile.
3. The world: zones, quests/events and their state, as in Remnant 1.
4. Item names and paths from the game's IoStore index (`.utoc`), like the Hardened Carapace in Remnant 1.
5. The checksum, only needed to write saves.
