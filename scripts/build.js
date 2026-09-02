#!/usr/bin/env node
/**
 * build.js - chaine de compression js13k
 *
 *   src/index.html  (source lisible, commentee)
 *        |
 *        |  1. on extrait le <style> et le <script>
 *        |  2. terser  : minifie le JS (renomme les variables, enleve les espaces)
 *        |  3. roadroller : re-compresse le JS en un decompresseur auto-extractible
 *        |  4. on reconstruit un HTML minimal
 *        |  5. zip -9
 *        v
 *   dist/index.html + unirush.zip  (<= 13312 octets)
 *
 * Usage :  npm run build
 *          npm run build -- --watch     (reconstruit a chaque sauvegarde)
 *          npm run build -- --no-rr     (saute roadroller, plus rapide pour tester)
 *          npm run build -- --best=6    (relance roadroller 6 fois, garde le plus petit)
 *
 * A savoir : roadroller -O2 tire ses parametres au hasard (~300 essais), donc deux
 * builds de la MEME source ne donnent pas la meme taille -- 18 octets d'ecart
 * mesures. Quand la marge est mince, --best transforme cette loterie en avantage
 * en gardant le meilleur tirage. A utiliser pour le zip qu'on soumet.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, watch, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'index.html');
const DIST = join(ROOT, 'dist');
const ZIP = join(ROOT, 'unirush.zip');
const LIMIT = 13312;                       // 13 * 1024, la regle du concours

const args = process.argv.slice(2);
const WATCH = args.includes('--watch');
const NO_RR = args.includes('--no-rr');
const BEST = Math.max(1, +(args.find(a => a.startsWith('--best='))?.slice(7) || 1));

/* ------------------------------------------------------------------ */
/* Reglages de compression. C'est ici qu'on tourne les boutons.        */
/* ------------------------------------------------------------------ */

const TERSER_ARGS = [
  '--compress', 'passes=3,unsafe=true,unsafe_math=true,booleans_as_integers=true',
  '--mangle',   'toplevel=true',
  '--format',   'quote_style=1,semicolons=true'
];

// roadroller : -O2 cherche automatiquement les meilleurs parametres.
// Plus le chiffre est haut, plus c'est long a calculer et petit en sortie.
//   -O0  instantane, gain faible
//   -O1  quelques secondes
//   -O2  ~30 s, le meilleur rapport (celui qu'on utilise)
// Voir https://lifthrasiir.github.io/roadroller/ pour tout regler a la main.
const ROADROLLER_ARGS = ['-O2'];

/* ------------------------------------------------------------------ */

const bin = (name) => {
  const local = join(ROOT, 'node_modules', '.bin', name);
  if (existsSync(local)) return local;
  return null;
};

function run(name, argv, input) {
  const exe = bin(name);
  if (!exe) throw new Error(`${name} introuvable. Lance d'abord :  npm install`);
  return execFileSync(exe, argv, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function build() {
  const t0 = Date.now();
  const html = readFileSync(SRC, 'utf8');

  // 1. extraction
  let js = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  // Le panneau de dev vit entre ces marqueurs et n'entre jamais dans le zip.
  // Retire avant terser, donc pas un octet ne survit dans dist/index.html.
  if (js) {
    const before = js.length;
    js = js.replace(/\/\*DEV\*\/[\s\S]*?\/\*\/DEV\*\//g, '');
    if (js.length < before) console.log(`  panneau dev      -${before - js.length} o (hors zip)`);
  }
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  if (!js) throw new Error('Aucun bloc <script> dans src/index.html');

  mkdirSync(DIST, { recursive: true });
  const rawJs = join(DIST, '_raw.js');
  writeFileSync(rawJs, js);

  // verification de syntaxe avant toute compression
  execFileSync(process.execPath, ['--check', rawJs]);
  const sizeRaw = Buffer.byteLength(js);

  // 2. terser
  let out = run('terser', [rawJs, ...TERSER_ARGS]);
  const sizeMin = Buffer.byteLength(out);

  // 3. roadroller
  let sizeRR = sizeMin;
  if (!NO_RR) {
    const minJs = join(DIST, '_min.js');
    writeFileSync(minJs, out);
    try {
      for (let i = 0; i < BEST; i++) {
        const cand = run('roadroller', [minJs, ...ROADROLLER_ARGS]);
        const n = Buffer.byteLength(cand);
        if (i === 0 || n < sizeRR) { out = cand; sizeRR = n; }
        if (BEST > 1) console.log(`  roadroller ${i + 1}/${BEST}  ${n} o${n === sizeRR ? '  <- garde' : ''}`);
      }
    } catch (e) {
      console.warn('  roadroller a echoue, on garde la version terser.');
    }
    rmSync(minJs, { force: true });
  }
  rmSync(rawJs, { force: true });

  // 4. HTML minimal. Pas de <html>, <head> ni <body> : le navigateur les ajoute.
  const style = css.trim() ? `<style>${css.replace(/\s*\n\s*/g, '')}</style>` : '';
  const finalHtml =
    `<!doctype html><meta charset=utf-8>` +
    `<meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no,viewport-fit=cover">` +
    `<title>Unirush</title>${style}<canvas id=c></canvas><script>${out}</script>`;
  writeFileSync(join(DIST, 'index.html'), finalHtml);

  // 5. zip
  rmSync(ZIP, { force: true });
  execFileSync('zip', ['-9', '-q', '-j', ZIP, join(DIST, 'index.html')]);
  // 6. advzip : recompresse le flux deflate du zip (zopfli). Meme contenu, moins d'octets.
  //    Optionnel : si advancecomp n'est pas installe, on garde le zip de l'etape 5.
  let zipBefore = statSync(ZIP).size;
  try {
    execFileSync('advzip', ['-z', '-4', '-i', '200', '-q', ZIP]);
  } catch (e) {
    console.log('  (advzip absent : brew install advancecomp pour gagner ~380 o)');
  }
  const zipSize = statSync(ZIP).size;
  if (zipSize < zipBefore) console.log(`  advzip           -${zipBefore - zipSize} o`);

  // rapport
  const pct = (n) => `${String(n).padStart(6)} o`;
  console.log(`\n  source lisible   ${pct(sizeRaw)}`);
  console.log(`  terser           ${pct(sizeMin)}`);
  if (!NO_RR) console.log(`  roadroller       ${pct(sizeRR)}`);
  console.log(`  html final       ${pct(Buffer.byteLength(finalHtml))}`);
  console.log(`  ----------------------------------`);
  console.log(`  ZIP              ${pct(zipSize)}  / ${LIMIT} max`);
  if (zipSize <= LIMIT) {
    const m = LIMIT - zipSize;
    console.log(`  DANS LE BUDGET, il reste ${m} octets (${(m / LIMIT * 100).toFixed(1)} %)`);
  } else {
    console.log(`  DEPASSEMENT de ${zipSize - LIMIT} octets !`);
    if (!WATCH) process.exitCode = 1;
  }
  console.log(`  en ${((Date.now() - t0) / 1000).toFixed(1)} s -> unirush.zip\n`);
}

build();

if (WATCH) {
  console.log('  Surveillance de src/index.html. Ctrl+C pour arreter.\n');
  let busy = false;
  watch(SRC, () => {
    if (busy) return;
    busy = true;
    setTimeout(() => {
      try { build(); } catch (e) { console.error('  ' + e.message); }
      busy = false;
    }, 120);
  });
}
