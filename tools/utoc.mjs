// Study tool: lists every file path in an Unreal 5 IoStore table of contents (.utoc).
//   node tools/utoc.mjs "<Remnant2>\Remnant2\Content\Paks\pakchunk0-Windows.utoc" [filter regex] [out.txt]
//
// Layout read here (FIoStoreTocHeader, then the tables in order):
//   header (TocHeaderSize bytes): magic "-==--==--==--==-", u8 version, …, u32 entry count,
//     u32 compressed block count, u32 block entry size, u32 method name count, u32 method name length,
//     u32 block size, u32 directory index size, u32 partition count, u64 container id, 16-byte key guid,
//     u8 container flags (1 compressed, 2 encrypted, 4 signed, 8 indexed), …, u32 perfect hash seed count,
//     u64 partition size, u32 chunks without perfect hash count …
//   chunk ids (12 bytes each), chunk offsets/lengths (10 each), perfect hash seeds (i32 each),
//   chunks without perfect hash (i32 each), compression blocks (block entry size each),
//   method names (method name length each), signatures (if signed), directory index.
//   Directory index: FString mount point; directories [name, first child, next sibling, first file]
//   (u32 each); files [name, next file, user data] (u32 each); string table (FStrings).
//   0xFFFFFFFF means "none"; names index the string table.
import fs from 'node:fs';

const [file, filterArg, outFile] = process.argv.slice(2);
const b = fs.readFileSync(file);
if (b.slice(0, 16).toString('latin1') !== '-==--==--==--==-') throw new Error('not a .utoc');
const h = {
  version: b[16], headerSize: b.readUInt32LE(20), entries: b.readUInt32LE(24), blocks: b.readUInt32LE(28),
  blockEntrySize: b.readUInt32LE(32), methods: b.readUInt32LE(36), methodLen: b.readUInt32LE(40),
  blockSize: b.readUInt32LE(44), dirIndexSize: b.readUInt32LE(48), partitions: b.readUInt32LE(52),
  flags: b[80], seeds: b.readUInt32LE(84), withoutHash: b.readUInt32LE(96),
};
let p = h.headerSize;
p += h.entries * 12 + h.entries * 10;          // chunk ids, offsets/lengths
p += h.seeds * 4;                               // perfect hash seeds
if (h.version >= 5) p += h.withoutHash * 4;     // chunks without perfect hash
p += h.blocks * h.blockEntrySize;               // compression blocks
const methods = [];
for (let i = 0; i < h.methods; i++) methods.push(b.slice(p + i * h.methodLen, p + (i + 1) * h.methodLen).toString('latin1').replace(/\0.*$/, ''));
p += h.methods * h.methodLen;
if (h.flags & 4) { const hs = b.readInt32LE(p); p += 4 + hs * 2 + h.blocks * 20; } // signatures
if (h.flags & 2) throw new Error('the directory index is encrypted');
const end = p + h.dirIndexSize;
const rd = { u32: () => { const v = b.readUInt32LE(p); p += 4; return v; },
  str: () => { const n = b.readInt32LE(p); p += 4; if (n === 0) return ''; if (n > 0) { const s = b.slice(p, p + n - 1).toString('latin1'); p += n; return s; }
    const s = b.slice(p, p - n * 2 - 2).toString('utf16le'); p += -n * 2; return s; } };
const mount = rd.str();
const dirs = []; for (let i = 0, n = rd.u32(); i < n; i++) dirs.push([rd.u32(), rd.u32(), rd.u32(), rd.u32()]);
const files = []; for (let i = 0, n = rd.u32(); i < n; i++) files.push([rd.u32(), rd.u32(), rd.u32()]);
const strings = []; for (let i = 0, n = rd.u32(); i < n; i++) strings.push(rd.str());
if (p !== end) throw new Error(`directory index ends at ${p}, expected ${end}`);
const NONE = 0xFFFFFFFF, paths = [];
(function walk(d, prefix) {
  for (; d !== NONE; d = dirs[d][2]) {
    const [name, child, , firstFile] = dirs[d];
    const here = name === NONE ? prefix : prefix + strings[name] + '/';
    for (let f = firstFile; f !== NONE; f = files[f][1]) paths.push(here + strings[files[f][0]]);
    if (child !== NONE) walk(child, here);
  }
})(0, mount);
const filter = filterArg ? new RegExp(filterArg, 'i') : null;
const shown = filter ? paths.filter((x) => filter.test(x)) : paths;
console.log(`${file.split(/[\\/]/).pop()}: version ${h.version}, flags ${h.flags}, compression [${methods.join(', ')}], ${h.entries} chunks, ${paths.length} files${filter ? `, ${shown.length} match` : ''}`);
if (outFile) fs.writeFileSync(outFile, shown.join('\n')); else console.log(shown.slice(0, 40).join('\n'));
