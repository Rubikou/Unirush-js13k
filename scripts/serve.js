#!/usr/bin/env node
/**
 * serve.js - un mini serveur pour jouer pendant le developpement.
 *
 *   npm run serve     puis ouvre http://localhost:8013
 *
 * Pourquoi un serveur plutot qu'un double-clic sur le fichier ?
 * Parce qu'en ouvrant en file:// certains navigateurs bloquent le son
 * et la sauvegarde du record. En http:// tout marche comme chez les votants.
 *
 *   /          -> src/index.html   (la version lisible, celle qu'on modifie)
 *   /dist      -> dist/index.html  (la version compressee, celle qu'on envoie)
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8013;

createServer((req, res) => {
  const dist = req.url.startsWith('/dist');
  const file = dist ? join(ROOT, 'dist', 'index.html') : join(ROOT, 'src', 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(dist ? 'Lance d abord : npm run build' : 'src/index.html introuvable');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, () => {
  console.log(`\n  Version lisible    http://localhost:${PORT}/`);
  console.log(`  Version compressee http://localhost:${PORT}/dist\n`);
});
