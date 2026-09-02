#!/usr/bin/env node
/**
 * record-gif.mjs — fabrique media/gameplay.gif, le GIF montré en haut du README.
 *
 *   src/index.html
 *        |
 *        |  1. on sert le jeu sur un port local, dans un Chromium piloté
 *        |  2. Math.random est remplacé par un générateur à graine  -> partie reproductible
 *        |  3. requestAnimationFrame est neutralisé : c'est NOUS qui avançons le jeu,
 *        |     d'un pas de temps fixe, et qui lisons le canvas image par image
 *        |  4. un pilote automatique joue à la place du joueur (BFS vers le bon bonbon,
 *        |     en évitant les zombies et leur case annoncée)
 *        |  5. ffmpeg assemble la fenêtre choisie en GIF
 *        v
 *   media/gameplay.gif
 *
 * Le rendu n'est pas une capture « en direct » : comme on avance le jeu nous-mêmes,
 * la cadence est parfaitement régulière et deux exécutions donnent le même fichier.
 *
 * Prérequis, à installer une seule fois. Volontairement hors devDependencies :
 * sinon chaque `npm install` téléchargerait un navigateur entier.
 *   npm i -D playwright && npx playwright install chromium
 *   ffmpeg   (brew install ffmpeg)
 *
 * Usage :
 *   node scripts/record-gif.mjs                    régénère le GIF livré
 *   node scripts/record-gif.mjs --dry              joue la partie sans rien écrire,
 *                                                  et affiche la chronologie des événements
 *   node scripts/record-gif.mjs --seed=12          une autre partie
 *   node scripts/record-gif.mjs --from=235 --take=258
 *   node scripts/record-gif.mjs --video --from=880 --take=540
 *                                                  bande-annonce MP4 1280x720
 *                                                  (media/trailer.mp4)
 *
 * La chronologie affichée à la fin (« f392 MODE play->levelup ») sert à choisir
 * --from et --take : c'est le numéro de l'image capturée.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Réglages. Les valeurs par défaut sont celles du GIF livré.          */
/* ------------------------------------------------------------------ */

const O = {
  seed: 7,          // graine du hasard : change la partie entière
  secs: 20,         // durée simulée
  fps: 25,          // cadence de simulation (dt = 1/fps, doit rester <= 0.05 s)
  w: 1000, h: 820,  // taille de la fenêtre : le plateau 17x13 la remplit presque
                    // (--video passe en 1280x720, le format attendu d'une video)
  from: 235,        // première image gardée dans le GIF
  take: 258,        // nombre d'images gardées (258 / 25 fps = 10,3 s)
  gifFps: 12.5,     // cadence du GIF (délai de 8 centièmes, valeur entière)
  gifWidth: 480,    // largeur finale
  colors: 64,       // taille de la palette GIF
  out: join(ROOT, 'media', 'gameplay.gif'),
  // --video : encode un MP4 au lieu du GIF, pour la bande-annonce Wavedash.
  // Pleine resolution, pas de palette, pas de perte de cadence.
  video: false,
  videoOut: join(ROOT, 'media', 'trailer.mp4'),
  crf: 18,          // qualite x264 : 18 est visuellement sans perte
  dry: false
};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.replace(/^--/, '').split('=');
  if (k === 'dry') O.dry = true;
  else if (k === 'video') { O.video = true; if (!process.argv.some(x => x.startsWith('--w='))) { O.w = 1280; O.h = 720; } }
  else if (k in O) O[k] = v === undefined ? true : (isNaN(+v) ? v : +v);
  else throw new Error(`option inconnue : ${a}`);
}

/* ------------------------------------------------------------------ */
/*  LE PILOTE AUTOMATIQUE                                              */
/*  Injecté dans la page, appelé une fois par image, AVANT update().    */
/*  Il écrit dans `queue`, la file de virages que step() consomme.      */
/* ------------------------------------------------------------------ */

const AUTOPILOT = `window.__ai = function () {
  if (window.mode !== 'play') return;
  var GWl = window.GW, GHl = window.GH, head = window.snake[0];
  var start = head.y * GWl + head.x;
  var I = function (x, y) { return y * GWl + x; };
  var inB = function (x, y) { return x >= 0 && y >= 0 && x < GWl && y < GHl; };

  var hard = new Uint8Array(GWl * GHl);   // mort certaine, ou coup qui casse l'arc-en-ciel
  var soft = new Uint8Array(GWl * GHl);   // voisinage d'un zombie : a eviter si on peut
  var mk = function (a, x, y) { if (inB(x, y)) a[I(x, y)] = 1; };

  for (var i = 1; i < window.snake.length; i++) mk(hard, window.snake[i].x, window.snake[i].y);

  // le bonbon a manger, et tous les autres, qui feraient perdre une couleur
  var goal = null;
  for (var i = 0; i < window.candies.length; i++) {
    var c = window.candies[i];
    if (c.c === window.target) { if (!goal) goal = c; }
    else mk(hard, c.x, c.y);
  }

  // les zombies telegraphent leur prochain pas : on interdit la case occupee ET la case annoncee
  for (var i = 0; i < window.zoms.length; i++) {
    var z = window.zoms[i], wd = z.big ? 2 : 1;
    for (var k = 0; k < wd; k++) {
      var cells = [[z.x + k, z.y], [z.x + z.ndx + k, z.y + z.ndy]];
      for (var n = 0; n < 2; n++) {
        var px = cells[n][0], py = cells[n][1];
        mk(hard, px, py);
        mk(soft, px + 1, py); mk(soft, px - 1, py); mk(soft, px, py + 1); mk(soft, px, py - 1);
      }
    }
  }

  var d = window.dir;
  // la direction actuelle est exploree en premier : a distance egale, la licorne va tout droit
  var DIRS = [[d.x, d.y], [-d.y, d.x], [d.y, -d.x], [-d.x, -d.y]];
  var back = { x: head.x - d.x, y: head.y - d.y };   // demi-tour : refuse par step()

  function bfs(avoidSoft) {
    if (!goal) return null;
    var prev = new Int32Array(GWl * GHl).fill(-2), q = [start], gi = I(goal.x, goal.y);
    prev[start] = -1;
    for (var qi = 0; qi < q.length; qi++) {
      var cur = q[qi], x = cur % GWl, y = (cur / GWl) | 0;
      if (cur === gi) {
        var c = cur;
        while (prev[c] !== start) c = prev[c];
        return { x: (c % GWl) - head.x, y: ((c / GWl) | 0) - head.y };
      }
      for (var k = 0; k < 4; k++) {
        var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
        if (!inB(nx, ny)) continue;
        var ni = I(nx, ny);
        if (prev[ni] !== -2 || hard[ni]) continue;
        if (avoidSoft && soft[ni]) continue;
        if (cur === start && nx === back.x && ny === back.y) continue;
        prev[ni] = cur; q.push(ni);
      }
    }
    return null;
  }

  // surface encore atteignable depuis une case : sert a ne pas s'enfermer
  function area(sx, sy) {
    var seen = new Uint8Array(GWl * GHl), q = [I(sx, sy)], n = 0;
    seen[q[0]] = 1; seen[start] = 1;
    for (var qi = 0; qi < q.length; qi++) {
      var cur = q[qi], x = cur % GWl, y = (cur / GWl) | 0; n++;
      for (var k = 0; k < 4; k++) {
        var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
        if (!inB(nx, ny)) continue;
        var ni = I(nx, ny);
        if (seen[ni] || hard[ni]) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    return n;
  }

  var mv = bfs(true) || bfs(false);
  if (!mv) {                              // plus de chemin vers le bonbon : on survit
    var bestS = -1e18;
    for (var k = 0; k < 4; k++) {
      var nx = head.x + DIRS[k][0], ny = head.y + DIRS[k][1];
      if (!inB(nx, ny) || (nx === back.x && ny === back.y) || hard[I(nx, ny)]) continue;
      var dist = goal ? Math.abs(nx - goal.x) + Math.abs(ny - goal.y) : 0;
      var s = (soft[I(nx, ny)] ? 0 : 1e6) + area(nx, ny) * 1000 - dist;
      if (s > bestS) { bestS = s; mv = { x: DIRS[k][0], y: DIRS[k][1] }; }
    }
  }

  window.queue.length = 0;
  if (mv && (mv.x !== d.x || mv.y !== d.y)) window.queue.push(mv);
};`;

/* ------------------------------------------------------------------ */

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  throw new Error('playwright introuvable. Lance, une seule fois :\n' +
    '    npm i -D playwright && npx playwright install chromium\n' +
    '  (volontairement hors devDependencies : sinon chaque npm install telechargerait un navigateur)');
}

const FRAMES = join(tmpdir(), 'unirush-frames');
if (!O.dry) { rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true }); }

const html = readFileSync(join(ROOT, 'src', 'index.html'));
const srv = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}).listen(0);
await new Promise(r => srv.once('listening', r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: O.w, height: O.h }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('  [erreur page]', e.message));

await page.addInitScript(seed => {
  // hasard reproductible : même graine, même partie, au pixel près
  let s = seed >>> 0;
  Math.random = function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // pas d'audio : ensureAudio() échoue dans son try/catch, tous les sons deviennent muets
  delete window.AudioContext; delete window.webkitAudioContext;
  // on prend la main sur la boucle de rendu
  window.__cb = null;
  window.requestAnimationFrame = function (cb) { window.__cb = cb; return 1; };
  window.cancelAnimationFrame = function () {};
}, O.seed);

await page.goto(`http://127.0.0.1:${srv.address().port}/`);
await page.waitForFunction(() => typeof window.__cb === 'function');
await page.addScriptTag({ content: AUTOPILOT });
await page.evaluate(() => window.newGame());

const N = Math.round(O.fps * O.secs), log = [];
for (let i = 1; i <= N; i++) {
  const r = await page.evaluate(({ t, dry }) => {
    window.__ai();
    window.__cb(t);
    return {
      png: dry ? '' : document.getElementById('c').toDataURL('image/png'),
      st: { mode: mode, target: target, len: snake.length, score: score, lives: lives, zoms: zoms.length }
    };
  }, { t: i * (1000 / O.fps), dry: O.dry });

  if (!O.dry) writeFileSync(join(FRAMES, `f${String(i).padStart(5, '0')}.png`),
    Buffer.from(r.png.slice(r.png.indexOf(',') + 1), 'base64'));
  log.push(r.st);
  if (!O.dry && i % 100 === 0) process.stdout.write(`  ${i}/${N} images\n`);
}
await browser.close(); srv.close();

// chronologie : c'est elle qui sert à choisir --from et --take
console.log('');
for (let i = 1; i < log.length; i++) {
  const a = log[i - 1], b = log[i];
  if (b.len !== a.len) console.log(`  f${i + 1}  queue ${a.len} -> ${b.len}  (couleur suivante : ${b.target})`);
  if (b.mode !== a.mode) console.log(`  f${i + 1}  MODE ${a.mode} -> ${b.mode}`);
  if (b.lives !== a.lives) console.log(`  f${i + 1}  VIE PERDUE ${a.lives} -> ${b.lives}`);
}
const end = log[log.length - 1];
console.log(`  fin : score ${end.score}, ${end.lives} vies, mode ${end.mode}`);
if (O.dry) process.exit(0);

// ffmpeg : une palette globale calculée sur toute la fenêtre, sans tramage.
// Le tramage ajoute du bruit, et le bruit ruine la compression du GIF.
const filter = `fps=${O.gifFps},scale=${O.gifWidth}:-1:flags=area,split[a][b];` +
  `[a]palettegen=max_colors=${O.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
const target = O.video ? O.videoOut : O.out;
if (O.video) {
  // yuv420p pour que tous les lecteurs suivent, faststart pour que la lecture
  // demarre sans avoir telecharge le fichier entier.
  execFileSync('ffmpeg', ['-y', '-v', 'error',
    '-framerate', String(O.fps), '-start_number', String(O.from), '-i', join(FRAMES, 'f%05d.png'),
    '-frames:v', String(O.take),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(O.crf),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    target], { stdio: 'inherit' });
} else {
  execFileSync('ffmpeg', ['-y', '-v', 'error',
    '-framerate', String(O.fps), '-start_number', String(O.from), '-i', join(FRAMES, 'f%05d.png'),
    '-frames:v', String(O.take), '-vf', filter, '-loop', '0', target], { stdio: 'inherit' });
}
rmSync(FRAMES, { recursive: true, force: true });

const ko = statSync(target).size / 1024;
console.log(`\n  ${target}`);
if (O.video) {
  console.log(`  ${O.w}x${O.h}, ${(O.take / O.fps).toFixed(1)} s, ${(ko / 1024).toFixed(2)} Mo, sans son`);
  console.log(`  (le harnais neutralise l'AudioContext : la musique du jeu n'est pas capturee)\n`);
} else {
  console.log(`  ${O.gifWidth} px de large, ${(O.take / O.fps).toFixed(1)} s, ${(ko / 1024).toFixed(2)} Mo\n`);
}
