#!/usr/bin/env node
/**
 * Copies just the app into docs/ — the folder GitHub Pages serves.
 *
 *   node build.js
 *
 * Tests, the simulator, the spec and the dev scripts stay behind. Re-run after
 * any change (including program.json), commit, and push; the service
 * worker is network-first, so the phone picks up the new version on next open.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var FILES = [
  'index.html', 'app.js', 'app.css', 'engine.js', 'sw.js',
  'manifest.webmanifest', 'exercise-library.json', 'program.json',
  'icon-192.png', 'icon-512.png'
];

var out = path.join(__dirname, 'docs');
if (fs.existsSync(out)) {
  fs.readdirSync(out).forEach(function (f) { fs.unlinkSync(path.join(out, f)); });
} else {
  fs.mkdirSync(out);
}

var bytes = 0;
FILES.forEach(function (f) {
  fs.copyFileSync(path.join(__dirname, f), path.join(out, f));
  bytes += fs.statSync(path.join(out, f)).size;
});

// serve the files as-is; don't let GitHub run them through Jekyll
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log('docs/  ' + FILES.length + ' files, ' + Math.round(bytes / 1024) + ' KB');
