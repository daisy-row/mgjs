import { BLANK, type Letter, type Tile } from './letters';

/** The letters a language plays with, in its own order. A `Letter` is only an
 *  index; this is what an index means. The order matters beyond display: the
 *  compiled word list is sorted by these indexes, and Unicode order is not
 *  it — Ukrainian Ґ sits after Г in the alphabet but far from it in Unicode. */
export class Alphabet {
  readonly letters: readonly string[];
  /** Which letters are vowels, for the bots' sense of a balanced rack. */
  readonly vowels: ReadonlySet<Letter>;
  private readonly indexes = new Map<string, Letter>();

  constructor(letters: string, vowels: string) {
    const characters = Array.from(letters);
    if (characters.length === 0) throw new Error('an alphabet needs letters');
    if (characters.length > 64) throw new Error('an alphabet holds at most 64 letters');
    characters.forEach((character, position) => {
      if (this.indexes.has(character)) throw new Error(`'${character}' appears twice in the alphabet`);
      this.indexes.set(character, position);
      const lower = character.toLowerCase();
      if (lower !== character) this.indexes.set(lower, position);
    });
    this.letters = characters;
    const set = new Set<Letter>();
    for (const character of vowels) {
      const index = this.indexes.get(character);
      if (index === undefined) throw new Error(`vowel '${character}' is not in the alphabet`);
      set.add(index);
    }
    this.vowels = set;
  }

  get count(): number {
    return this.letters.length;
  }

  /** The letter this character spells, in either case, or undefined. */
  letter(character: string): Letter | undefined {
    return this.indexes.get(character);
  }

  character(letter: Letter): string {
    return this.letters[letter];
  }

  text(word: Iterable<Letter>): string {
    let text = '';
    for (const letter of word) text += this.letters[letter];
    return text;
  }

  /** The letters of a word, or null if any character is not one of ours. */
  word(text: string): Letter[] | null {
    const word: Letter[] = [];
    for (const character of text) {
      const letter = this.indexes.get(character);
      if (letter === undefined) return null;
      word.push(letter);
    }
    return word;
  }

  contains(character: string): boolean {
    return this.indexes.has(character);
  }

  /** A tile for this character: a letter, or the blank for a space, an
   *  underscore or a question mark. */
  tile(character: string): Tile | undefined {
    if (character === ' ' || character === '_' || character === '?') return BLANK;
    return this.indexes.get(character);
  }

  tileText(tile: Tile): string {
    return tile === BLANK ? '_' : this.letters[tile];
  }

  static readonly english = new Alphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'AEIOU');

  /** All thirty-three Ukrainian letters. Й is counted a consonant, and the
   *  soft sign Ь is neither, so neither is a vowel here. The apostrophe is
   *  not a letter and has no tile. */
  static readonly ukrainian = new Alphabet('АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ', 'АЕЄИІЇОУЮЯ');
}
