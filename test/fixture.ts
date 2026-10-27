// The English game as the tests see it: read from the data files with Node's
// zlib, where the browser uses DecompressionStream.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  Alphabet, BLANK, LANGUAGE_SPECS, Language, type Direction, type LanguageCode, type Placement, type Position, type Tile,
  stepping,
} from '../src/engine/index';

const data = (name: string): string => fileURLToPath(new URL(`../src/data/${name}`, import.meta.url));

export function loadLanguage(code: LanguageCode): Language {
  return new Language(
    LANGUAGE_SPECS[code],
    readFileSync(data('Board.txt'), 'utf8'),
    readFileSync(data(`${code}/Tiles.txt`), 'utf8'),
    new Uint8Array(gunzipSync(readFileSync(data(`${code}/Words.lex.gz`)))),
  );
}

export const english = loadLanguage('en');
export type { Language };

export const { rules, lexicon } = english;

export function letter(character: string): number {
  const found = Alphabet.english.letter(character);
  if (found === undefined) throw new Error(`no letter ${character}`);
  return found;
}

export function rack(letters: string): Tile[] {
  return Array.from(letters).map((character) => {
    const tile = Alphabet.english.tile(character);
    if (tile === undefined) throw new Error(`no tile ${character}`);
    return tile;
  });
}

export const at = (x: number, y: number): Position => ({ x, y });

export function placements(word: string, start: Position, direction: Direction, blanks: Set<number> = new Set()): Placement[] {
  return Array.from(word).map((character, offset) => ({
    position: stepping(start, offset, direction),
    letter: letter(character),
    isBlank: blanks.has(offset),
  }));
}

export { BLANK };
