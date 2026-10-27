# matrix-game-js

The Matrix Game — the 15×15 letter game from
`matrix-game-next-gen` — as one static web page.
TypeScript, no framework, no server: the board, the bag, the word list, the
move generator, the scoring and all seven bot levels run inside the browser
tab, and the game in progress lives in that tab's `localStorage`. It is built
to be served from GitHub Pages, and `dist/index.html` also opens straight
from disk in Chrome or Brave.

Two languages: **English** (ENABLE's 168,548 board-sized words, the original
104-tile bag) and **Ukrainian** (VESUM's 2,746,623 forms, the 103-tile
"optimum" set, played as Ерудит), each read from the same resource files the
Swift engine ships, with the same board and the same measured bot ladders.

## Play

```sh
npm ci
npm run build          # -> dist/index.html (about 580 KB) and dist/lang/uk.lex.gz
open dist/index.html   # English works from disk; see below for Ukrainian
```

Type a name, pick a language and one to three opponents, start. Click a rack tile and then
a square, or click a square and type — click it again to turn the arrow.
**Enter** plays, **Esc** takes the tiles back, **Backspace** lifts the last
tile. `Hint` lays out the best play the engine can find, as tiles you can
still take back. `Swap…` puts tiles into the bag (it needs seven in there),
`Pass` gives the turn away. A blank asks which letter it stands for; it spells
but scores nothing. Reloading the page comes back to the same game.

### The two word lists

English is inside the page, so `index.html` starts with nothing to fetch and
opens straight from disk. Ukrainian is 2.5 MB compressed — four times the
rest of the page — so it stays beside the page as `lang/uk.lex.gz` and is
fetched the first time a Ukrainian game starts, then kept for the life of the
tab. A page opened from disk cannot fetch it (Chrome refuses `file://`
fetches), so Ukrainian needs the page served over http: GitHub Pages, or
locally

```sh
cd dist && python3 -m http.server 8080     # then http://localhost:8080/
```

Inflating and decoding 2.7 million forms takes about a second in the
browser; the Start button says so while it happens.

## Hosting on GitHub Pages

`.github/workflows/pages.yml` builds `dist/` on every push to `main` and
deploys it with the Pages actions. Once, in the repository settings, set
**Pages → Source** to *GitHub Actions*. Nothing else is needed: the page is
one file, it makes no requests, and `.nojekyll` keeps Jekyll away from it.

## Working on it

```sh
npm run typecheck      # tsc, strict
npm test               # 40 tests, ported from the Swift suite, under node:test
npm run watch          # rebuild dist/index.html as src/ changes
npm run check          # all three, which is what the workflow runs
```

```
src/engine/   the game, nothing about browsers in it
  letters.ts    letters, tiles, squares, directions
  alphabet.ts   what a letter index means: English and Ukrainian
  board.ts      the premium layout and the tiles on it
  rules.ts      tile values and counts, rack size, bingo, exchange rule
  lexicon.ts    the compiled word list, walked like a trie
  scoring.ts    premiums, crossing words, the bingo, the end-of-game sweep
  validation.ts is this play legal, and what is it worth
  movegen.ts    every legal play for a rack, with the limits a bot sees through
  game.ts       the whole game: racks, bag, turns, the end
  bot.ts        the seven levels, their dials, the rack-leave heuristic
  language.ts   each language's alphabet, tiles, dials and measured ladder
src/data/     Board.txt, and per language Tiles.txt and Words.lex.gz, unchanged
src/ui/       the page: app.ts and style.css
src/main.ts   loads a language's word list and starts the page
build.mjs     esbuild, then one HTML file with the script and style inlined
test/         node:test, reading the data files through zlib
```

The word lists travel gzipped and are inflated with the browser's own
`DecompressionStream`, so no compression library is bundled. esbuild's
binary loader embeds the English one as base64, which is why the page is
larger than the sum of its parts.

### What was ported, and what was not

The engine is a line-for-line port of `MatrixGameKit`: the same board (the
corners are plain and the triple words sit three in from each edge), the
same multiplying word premiums, the same anchor search with cross-check
masks, the same bot ladder with the same per-language dials and measured
ratings. Letters are indexes and the alphabet is consulted only at the
edges, which is what lets one engine play 26 letters or 33. The tests are the Swift tests, including the one that checks the
generator against a brute-force search of the same position.

Left behind, on purpose: Dutch and Estonian, the score service and its
leaderboard, accounts and uploads. A game here is not recorded anywhere.
Seeds replay the same deal in this engine, but not the same deal as the Swift
one — the shuffle and the random draws are the same algorithms on the same
generator, but Swift's `shuffle` and `Int.random` consume the generator
differently.

### Licence

Apache-2.0, like the engine it came from. The English word list is ENABLE,
public domain.

The Ukrainian list is made from [ВЕСУМ / dict_uk](https://github.com/brown-uk/dict_uk)
6.8.6 by Andriy Rysin, Vasyl Starko and the BrUK team, through its hunspell
build (MPL 1.1); the project publishes its dictionary data under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). The
compiled `Words.lex.gz` is an adaptation of it, is offered under the same
terms, and the game's page credits the authors, links the source and the
licence, and says what was changed — see `src/data/uk/Source.txt` for the full
notice and the citation the authors ask for.
