# Remnant 2 World Analyzer

Reads **Remnant 2** saves in the browser: what is in your world and what you still need — the
Remnant 2 sibling of [Remnant World Analyzer](https://github.com/marcops/Remnant-World-Analyzer)
(Remnant: From the Ashes).

**Status: early.** The page loads and decompresses the saves and shows what each one holds. The save
format is being studied from real saves and the game files — see [docs/SAVE-FORMAT.md](docs/SAVE-FORMAT.md).

## Use

- **Automatic (Windows):** download the project and double-click **Start.bat**. It serves the page at
  http://localhost:8775 and reads the saves straight from
  `%USERPROFILE%\Saved Games\Remnant2\Steam\<number>`, updating when the game saves.
  `Start.bat -SaveDir "D:\other\folder"` for another folder.
- **Manual:** open the page and drop `profile.sav` and `save_N.sav` on it.

Nothing is installed and nothing leaves your PC: the files are read in the browser.

## Development

- `js/sav.js` — the .sav container: header and zlib chunks → the decompressed save.
- `js/app.js` — the page.
- `server.ps1` / `Start.bat` — local server: the page, the save folder, backups.
- `tools/decompress.mjs` — writes a decompressed copy of a save, for studying it.
- Tests: `R2_SAVE=<…\save_0.sav> R2_PROFILE=<…\profile.sav> node --test test/sav.test.mjs`
