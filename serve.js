#!/usr/bin/env node
/**
 * Static server for the PWA.
 *
 *   node serve.js [port]
 *
 * Service workers refuse to register over file://, so the app needs real HTTP
 * even locally. Zero dependencies, Node 10 compatible.
 *
 * To use it on your phone on the same wifi, hit http://<this machine's LAN IP>:8080
 * — note that iOS will not install a PWA or register a service worker over plain
 * HTTP from a non-localhost origin, so for on-device install you need HTTPS.
 */

'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var PORT = parseInt(process.argv[2], 10) || 8080;
var ROOT = __dirname;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

http.createServer(function (req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';

  var file = path.join(ROOT, path.normalize(url));
  if (file.indexOf(ROOT) !== 0) {           // no escaping the project directory
    res.writeHead(403); return res.end('forbidden');
  }

  fs.readFile(file, function (err, buf) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found: ' + url);
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      // the service worker caches deliberately; don't let the browser cache on top of it
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}).listen(PORT, function () {
  console.log('\n  Singularity → http://localhost:' + PORT + '\n');
  var nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (name) {
    nets[name].forEach(function (n) {
      if (n.family === 'IPv4' && !n.internal) {
        console.log('  on this network → http://' + n.address + ':' + PORT);
      }
    });
  });
  console.log('');
});
