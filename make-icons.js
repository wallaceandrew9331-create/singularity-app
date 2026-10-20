#!/usr/bin/env node
/**
 * Generates the PWA icons. No image library — raw RGBA buffer, PNG-encoded with
 * the zlib that ships with Node.
 *
 *   node make-icons.js
 *
 * Mark: three ascending bars. Progression, which is the whole point of the app.
 * Re-run after changing COLORS or the drawing below.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var BG = [0x11, 0x13, 0x1a, 0xff];
var FG = [0xe8, 0xa3, 0x3d, 0xff];
var DIM = [0xe8, 0xa3, 0x3d, 0x55];

// ─── PNG encoding ───────────────────────────────────────────────────────────

var CRC_TABLE = (function () {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** @param rgba Buffer of size w*h*4 */
function encodePNG(rgba, w, h) {
  var sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // each scanline gets a leading filter byte (0 = None)
  var raw = Buffer.alloc(h * (w * 4 + 1));
  for (var y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ─── drawing ────────────────────────────────────────────────────────────────

function canvas(size, fill) {
  var buf = Buffer.alloc(size * size * 4);
  for (var i = 0; i < size * size; i++) {
    buf[i * 4] = fill[0]; buf[i * 4 + 1] = fill[1];
    buf[i * 4 + 2] = fill[2]; buf[i * 4 + 3] = fill[3];
  }
  return buf;
}

function rect(buf, size, x0, y0, w, h, color) {
  for (var y = Math.max(0, y0); y < Math.min(size, y0 + h); y++) {
    for (var x = Math.max(0, x0); x < Math.min(size, x0 + w); x++) {
      var i = (y * size + x) * 4;
      // source-over, so the translucent bar blends with the background
      var a = color[3] / 255;
      buf[i]     = Math.round(color[0] * a + buf[i] * (1 - a));
      buf[i + 1] = Math.round(color[1] * a + buf[i + 1] * (1 - a));
      buf[i + 2] = Math.round(color[2] * a + buf[i + 2] * (1 - a));
      buf[i + 3] = 255;
    }
  }
}

function draw(size) {
  var buf = canvas(size, BG);
  var u = size / 16;                 // design grid
  var barW = Math.round(u * 2.6);
  var gap = Math.round(u * 1.4);
  var totalW = barW * 3 + gap * 2;
  var x = Math.round((size - totalW) / 2);
  var baseY = Math.round(size - u * 3.2);
  var heights = [u * 3.4, u * 6.0, u * 8.8];

  heights.forEach(function (hgt, i) {
    var h = Math.round(hgt);
    rect(buf, size, x + i * (barW + gap), baseY - h, barW, h, i === 2 ? FG : DIM);
  });

  // baseline
  rect(buf, size, x, baseY + Math.round(u * 0.5), totalW, Math.max(2, Math.round(u * 0.5)), FG);
  return buf;
}

[192, 512].forEach(function (size) {
  var png = encodePNG(draw(size), size, size);
  var out = path.join(__dirname, 'icon-' + size + '.png');
  fs.writeFileSync(out, png);
  console.log('wrote icon-' + size + '.png (' + png.length + ' bytes)');
});
