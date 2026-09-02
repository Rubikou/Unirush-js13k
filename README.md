# Unirush

**js13kGames 2026 entry. Theme: Unicorns and Rainbows.**
A snake game where the order of what you eat is the whole puzzle.

![Unirush gameplay: the unicorn catches the last colours of the rainbow in world 1, Sunrise, dodging a zombie, then rides the rainbow bridge into world 2, The Desert](media/gameplay.gif)

*Ten seconds of real play, recorded by an autopilot: `node scripts/record-gif.mjs`.*

Everything fits in a single HTML file under 13 kB, zipped. No images, no audio
files, no libraries. Every sprite is drawn with canvas paths, every sound is
generated with the Web Audio API, and all seven worlds are painted by code at
runtime.

---

## How to play

You are a unicorn. The zombies drained the colours out of the world, and you
put them back by catching them **in rainbow order**.

| Rule | What happens |
|---|---|
| Catch red, then orange, then yellow... | Each colour adds one segment to your tail |
| Catch the wrong colour | You lose the last colour you had, and its tail segment |
| Touch a zombie | You lose a life (you have three) |
| A zombie touches your trail | It explodes and comes back 10 s later, far away |
| Complete all 7 colours | You ride a rainbow bridge into the next world |

Seven worlds, seven colours, and a final boss that chases you.
Arrow keys, WASD/ZQSD, or swipe on mobile.

### Things worth noticing

- **Zombies telegraph their next move.** Their pupils and a small arrow point
  at the cell they are about to enter, and they will *never* go anywhere else.
  If that cell gets blocked, they wait instead. Every death is avoidable.
- **Your trail is a weapon.** Tron-style: lure a zombie into your own rainbow
  and it is gone for ten seconds. Even the boss, if you box it in completely.
- **The world is grey until you fix it.** A bubble of colour follows you and
  grows with every colour you catch. By violet, the whole screen is restored.
- **The music builds with the rainbow.** One theme, seven arrangements. It
  starts as a bare drone and a bass, then the pulse, the chords, the melody and
  the sparkles come in as you progress. Complete a rainbow and you hear the
  whole Rainbow Fanfare.
- There is a real ending. Beat world 7 and find out what the zombies were.

---

## Running it

```bash
npm install     # terser + roadroller
npm run serve   # http://localhost:8013
npm run build   # produces dist/index.html and unirush.zip
```

`src/index.html` is the readable, commented source. That is the file to edit.
`dist/` and the zip are generated, never edited by hand.

Extra build options:

```bash
npm run build -- --no-rr    # skip roadroller (fast, for quick size checks)
npm run watch               # rebuild on every save
```

---

## How the 13 kB budget is spent

The build chain is in `scripts/build.js`:

1. The `<style>` and `<script>` are pulled out of `src/index.html`.
2. **terser** minifies the JavaScript (3 passes, top-level mangling).
3. **roadroller** re-encodes the minified JS into a self-extracting bundle.
   It is run with `-O2`, which searches for the best parameters. This is the
   single biggest win in the chain: it roughly cuts the terser output by two
   thirds. The `-O2` search is also what makes a full build take about 30 s.
4. A minimal HTML shell is rebuilt around it: no `<html>`, no `<head>`,
   no `<body>`, since browsers insert those anyway.
5. `zip -9`.

Measured on the current build:

| Stage | Size |
|---|---|
| Readable source (JS only) | 67 587 B |
| After terser | 45 848 B |
| After roadroller | 16 390 B |
| Final HTML | 16 811 B |
| Final zip | **13 073 B** of 13 312 max |

The zip size moves by a few dozen bytes between builds: `roadroller -O2` runs a
randomised parameter search, so the same source has produced 13 028, 13 057,
13 069 and 13 073 B on different runs. The lockfile pins the tool versions, not
the output size. With the margin this thin, always read the number the build
prints rather than trusting one written down here.

If the build ever goes over budget it exits with a non-zero status, so it can
be wired into CI.

---

## Project layout

```
unirush/
├─ src/index.html        the game, readable and commented (edit this)
├─ scripts/build.js      terser -> roadroller -> zip, with a size report
├─ scripts/serve.js      local dev server on :8013
├─ scripts/record-gif.mjs replays a seeded game on autopilot -> media/gameplay.gif
├─ package.json          build scripts and the two dev dependencies
├─ package-lock.json     pins terser and roadroller versions
├─ .nvmrc                Node 18
├─ .gitignore
├─ media/                the GIF shown at the top of this README
├─ LICENSE               MIT
├─ dist/                 generated build output (gitignored)
└─ unirush.zip           the file to submit (gitignored, rebuilt by npm run build)
```

---

## Submitting to js13kGames 2026

The competition rules are at <https://js13kgames.com/rules>. What they require,
and where this project stands:

| Rule | Status |
|---|---|
| Zip must be 13 312 bytes or less | around 13 060 B, roughly 250 B to spare |
| `index.html` at the top level of the zip | one entry, no subfolder |
| No external resources at all, everything inside the zip | no URL, no `fetch`, no external font |
| A GitHub repository with readable, unmangled source | `src/index.html` is the readable source |
| The repo must contain what is needed to *build* the game, not just an unzipped copy | `scripts/build.js` + `package.json` + lockfile |
| Works in latest Chrome and Firefox, with no console errors | measured: 0 errors, 0 warnings in both |
| `localStorage` keys namespaced per game, never `localStorage.clear()` | key is `unirushBest` |

Dates for the 2026 edition, taken from the official rules page:

- Submissions: **13 August 13:00 CEST to 13 September 2026, 13:00 CEST**
- Unfinished entries and bugfix PRs: 14 September 2026
- Voting: 14 September to 4 October 2026

Categories open in 2026: Desktop, Mobile, Online, WebXR, plus Unfinished and
the new Wavedash challenge. What the rules actually forbid is narrower than it
first sounds: "sending the same game as independent submissions targeting
different platforms (e.g. separate desktop and mobile builds)". One entry that
plays on both is fine, and this game has swipe controls, so do not rule out
Mobile.

### The 2026 upload test, and why it matters here

New in 2026: every zip you upload is run through an automatic in-browser test in
Chromium, and it blocks you from continuing if the console has errors. The
announcement warns that the test machine has constrained resources, and it names
our exact situation:

> heavily compressed games (e.g. Roadroller) can take a few good seconds to
> actually process

Measured on this game, page load to `domInteractive`:

| CPU throttling | With roadroller | Terser only |
|---|---|---|
| none | 672 ms | 34 ms |
| 4x slower | 2 886 ms | 138 ms |
| 8x slower | 6 024 ms | 283 ms |

So roadroller decoding is 95 % of the startup cost, and the game's own setup
(seven procedurally painted worlds) is only 34 ms.

Roadroller's context count is the dial that trades size against decode speed.
Measured across variants, all built from the same terser output:

| Roadroller contexts | Zip | Decode at 8x throttling |
|---|---|---|
| 12, `-O2` tuned (current) | 13 073 B | 5 970 ms |
| 12, defaults | 13 074 B | 5 658 ms |
| **9** | **13 144 B** | **4 252 ms** |
| 6 | 13 598 B | over the limit |
| 4 | 14 941 B | over the limit |

Nine contexts costs 71 bytes and decodes 29 % faster, and still fits with 168
bytes to spare. That is the lever to pull if the upload test ever rejects the
build for taking too long. If it does cut us off, the announcement says to get
in touch with the organisers.

The submission asks for two things: the **playable** zip, and the **readable**
repository. Organisers clone the repo under the
[js13kGames GitHub organisation](https://github.com/js13kGames) so other people
can learn from it, which is why `src/index.html` is kept commented and
unminified.

### Before submitting

```bash
npm run build                  # must print DANS LE BUDGET
unzip -l unirush.zip   # must show exactly one index.html, no __MACOSX
```

Then open `dist/index.html` in Chrome *and* Firefox, play a full world, and
check the console is clean.

Never submit the zip produced by `npm run build -- --no-rr`. That flag skips
roadroller but still overwrites `unirush.zip`, and the result is around
16 kB, well over the limit.

---

## Who made this

I am **Ruben**, I am 9 years old, and this is my game.

I am learning to make games with my dad, who does this for a living, and with
Claude. My dad explains how things work and checks what goes in, Claude helps me
turn my ideas into code, and I decide what the game is.

The design is mine: the snake-unicorn with a rainbow tail, eating in colour
order, wandering zombies that spawn per world, the Tron trail crash, three
lives, the telegraphed zombie eyes, and the rule that finishing a rainbow must
freeze the game instantly so you can never die after winning.

## Credits

Game design by **Ruben, age 9**.

Code and art direction pair-programmed with my dad and with Claude (Anthropic).

Music: *Rainbow Fanfare*, an original 4-bar theme, arranged seven ways.

MIT licensed. Do whatever you like with it.
