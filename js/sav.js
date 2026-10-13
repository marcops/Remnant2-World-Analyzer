// Remnant 2 .sav container (see docs/SAVE-FORMAT.md):
//   [u32 checksum][u32 size of the decompressed data + 8][u32 container version = 9]
//   then Unreal "compressed chunks", each:
//     [u32 0x9E2A83C1][u32 0x22222222][u64 block size = 128 KiB][u8 compressor = 3 (zlib)]
//     [u64 compressed][u64 uncompressed][u64 compressed][u64 uncompressed][zlib data]
// The decompressed chunks, joined, are the save itself (Gunfire's property format, Unreal 5).
// decompress() returns a Promise in both the browser (DecompressionStream) and Node (zlib).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.R2_SAV = factory();
})(this, function () {
  'use strict';

  var TAG = 0x9E2A83C1, HEADER = 49;

  function toBytes(buffer) { return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer); }
  function u64(view, p) { return view.getUint32(p, true) + view.getUint32(p + 4, true) * 4294967296; }

  // The file header and where each chunk's zlib data is.
  function layout(buffer) {
    var bytes = toBytes(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12 + HEADER) throw new Error('Too small to be a Remnant 2 save.');
    var head = { checksum: view.getUint32(0, true), size: view.getUint32(4, true), version: view.getUint32(8, true) };
    var chunks = [], p = 12;
    while (p < bytes.length) {
      if (view.getUint32(p, true) !== TAG) throw new Error('Not a Remnant 2 save (no chunk tag at byte ' + p + ').');
      var compressor = bytes[p + 16], comp = u64(view, p + 17), uncomp = u64(view, p + 25);
      if (compressor !== 3) throw new Error('Unknown compressor ' + compressor + ' at byte ' + p + '.');
      chunks.push({ at: p + HEADER, compressed: comp, uncompressed: uncomp });
      p += HEADER + comp;
    }
    if (p !== bytes.length) throw new Error('The chunks do not end at the end of the file.');
    return { head: head, chunks: chunks, bytes: bytes };
  }

  function inflate(data) {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      var zlib = require('zlib');
      return Promise.resolve(new Uint8Array(zlib.inflateSync(data)));
    }
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  // The decompressed save, checked chunk by chunk and against the size in the header.
  function decompress(buffer) {
    var L = layout(buffer);
    return Promise.all(L.chunks.map(function (c) {
      return inflate(L.bytes.subarray(c.at, c.at + c.compressed)).then(function (out) {
        if (out.length !== c.uncompressed) throw new Error('A chunk decompressed to ' + out.length + ' bytes instead of ' + c.uncompressed + '.');
        return out;
      });
    })).then(function (parts) {
      var total = parts.reduce(function (n, x) { return n + x.length; }, 0), out = new Uint8Array(total), at = 0;
      parts.forEach(function (x) { out.set(x, at); at += x.length; });
      if (total + 8 !== L.head.size) throw new Error('Decompressed ' + total + ' bytes but the header says ' + (L.head.size - 8) + '.');
      return { head: L.head, chunks: L.chunks.length, data: out };
    });
  }

  // Every length-prefixed ASCII string (Unreal FString) in the data, in order, for a first look.
  function strings(data, min) {
    var view = new DataView(data.buffer, data.byteOffset, data.byteLength), out = [], seen = {};
    for (var p = 0; p + 5 < data.length; p++) {
      var len = view.getInt32(p, true);
      if (len < (min || 4) || len > 512 || p + 4 + len > data.length || data[p + 3 + len] !== 0) continue;
      var ok = true, s = '';
      for (var i = 0; i < len - 1; i++) { var c = data[p + 4 + i]; if (c < 32 || c > 126) { ok = false; break; } s += String.fromCharCode(c); }
      if (!ok) continue;
      if (!seen[s]) { seen[s] = true; out.push({ at: p, text: s }); }
      p += 3 + len;
    }
    return out;
  }

  return { layout: layout, decompress: decompress, strings: strings };
});
