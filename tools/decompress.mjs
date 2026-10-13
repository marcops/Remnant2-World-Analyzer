// Study tool: decompresses a Remnant 2 .sav to <name>.raw next to the output folder and prints its header.
//   node tools/decompress.mjs "%USERPROFILE%\Saved Games\Remnant2\Steam\<id>\save_0.sav" [out folder]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SAV = require('../js/sav.js');

const [file, outDir = '.'] = process.argv.slice(2);
if (!file) { console.error('usage: node tools/decompress.mjs <file.sav> [out folder]'); process.exit(1); }
const r = await SAV.decompress(fs.readFileSync(file));
const out = path.join(outDir, path.basename(file).replace(/\.sav$/i, '.raw'));
fs.writeFileSync(out, r.data);
console.log(`${path.basename(file)}: version ${r.head.version}, ${r.chunks} chunks, ${r.data.length} bytes -> ${out}`);
console.log('first strings:', SAV.strings(r.data).slice(0, 12).map((s) => s.text).join(' | '));
