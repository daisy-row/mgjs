import type { Alphabet } from './alphabet';
import { SIZE, type Letter } from './letters';

/** A set of words sharing a prefix of `depth` letters: the range [low, high)
 *  of the sorted list. */
export interface Node {
  readonly low: number;
  readonly high: number;
  readonly depth: number;
}

export interface Clinging {
  letter: Letter;
  needs: Letter;
}

const decoder = new TextDecoder();

/** The word list, stored as one sorted block of letters so it can be walked
 *  like a trie without building one: a node is the range of words sharing a
 *  prefix, and descending to a child is a binary search inside that range. */
export class Lexicon {
  readonly alphabet: Alphabet;
  /** All words concatenated, one byte per letter. */
  private readonly letters: Uint8Array;
  /** Start of each word in `letters`, with a final sentinel. */
  private readonly offsets: Int32Array;
  /** How well known each word is: its Zipf frequency times ten, so 78 is
   *  "the", 48 is "cat", 0 is a word no corpus has recorded. Empty when no
   *  frequencies were supplied. */
  private readonly familiarity: Uint8Array;
  /** How many words sit at or above each familiarity, by Zipf times ten. */
  private readonly coverage: number[];
  /** For each letter, the share of words that end in it. */
  readonly endingShare: readonly number[];
  /** Letters that are nearly unplayable alone, with what they need: Q and U.
   *  Measured — a letter is here when nine tenths of the times it appears,
   *  the same letter follows it. */
  readonly clinging: readonly Clinging[];
  readonly count: number;
  readonly longestWord: number;

  private constructor(
    alphabet: Alphabet,
    letters: Uint8Array,
    offsets: Int32Array,
    familiarity: Uint8Array,
    longest: number,
  ) {
    this.alphabet = alphabet;
    this.letters = letters;
    this.offsets = offsets;
    this.familiarity = familiarity;
    this.count = offsets.length - 1;
    this.longestWord = longest;
    this.coverage = Lexicon.coverageOf(familiarity, this.count);
    const stats = Lexicon.statistics(letters, offsets, alphabet);
    this.endingShare = stats.endingShare;
    this.clinging = stats.clinging;
  }

  /** Builds a list from words in any order. For tests and hand-built lists. */
  static fromWords(
    words: Iterable<string>,
    alphabet: Alphabet,
    frequencies: ReadonlyMap<string, number> = new Map(),
    minimumLength = 2,
    maximumLength = SIZE,
  ): Lexicon {
    const encoded: Uint8Array[] = [];
    for (const raw of words) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      const letters = alphabet.word(trimmed);
      if (letters === null) throw new Error(`word list contains unusable entry '${trimmed}'`);
      if (letters.length < minimumLength || letters.length > maximumLength) continue;
      encoded.push(Uint8Array.from(letters));
    }
    encoded.sort(compareWords);
    let total = 0;
    for (const word of encoded) total += word.length;
    const letters = new Uint8Array(total);
    const offsets: number[] = [0];
    const scores: number[] = [];
    const wantFamiliarity = frequencies.size > 0;
    let longest = 0;
    let cursor = 0;
    let previous: Uint8Array | null = null;
    for (const word of encoded) {
      if (previous !== null && compareWords(previous, word) === 0) continue;
      previous = word;
      letters.set(word, cursor);
      cursor += word.length;
      offsets.push(cursor);
      longest = Math.max(longest, word.length);
      if (wantFamiliarity) {
        const zipf = frequencies.get(alphabet.text(word)) ?? 0;
        scores.push(Math.max(0, Math.min(255, Math.round(zipf * 10))));
      }
    }
    return new Lexicon(
      alphabet,
      letters.subarray(0, cursor),
      Int32Array.from(offsets),
      Uint8Array.from(scores),
      longest,
    );
  }

  /** Reads a compiled word list (already inflated): see `Scripts/lexicon.py`
   *  in matrix-game-next-gen for the format. */
  static fromCompiled(data: Uint8Array, alphabet: Alphabet): Lexicon {
    let cursor = 0;
    const line = (): string => {
      const end = data.indexOf(0x0a, cursor);
      if (end < 0) throw new Error('not a compiled word list');
      const text = decoder.decode(data.subarray(cursor, end));
      cursor = end + 1;
      return text;
    };
    if (line() !== 'MGLEX2') throw new Error('not a compiled word list');
    const found = line();
    const expected = alphabet.letters.join('');
    if (found !== expected) throw new Error(`compiled word list is in the alphabet '${found}', not '${expected}'`);
    const header = line().split('\t');
    if (header.length !== 3) throw new Error('not a compiled word list');
    const wordCount = Number(header[0]);
    const longest = Number(header[1]);
    const hasFamiliarity = Number(header[2]) === 1;
    if (!Number.isInteger(wordCount) || !Number.isInteger(longest)) throw new Error('not a compiled word list');

    const letters = new Uint8Array(wordCount * longest);
    const offsets = new Int32Array(wordCount + 1);
    const scores = new Uint8Array(hasFamiliarity ? wordCount : 0);
    const word = new Uint8Array(longest);
    let wordLength = 0;
    let total = 0;
    const end = data.length;
    for (let n = 0; n < wordCount; n += 1) {
      if (cursor >= end) throw new Error('the word list ends in the middle of a word');
      const lengths = data[cursor];
      const shared = lengths >> 4;
      const suffix = lengths & 0x0f;
      cursor += 1;
      if (cursor + suffix + (hasFamiliarity ? 1 : 0) > end || shared > wordLength) {
        throw new Error('the word list ends in the middle of a word');
      }
      wordLength = shared;
      for (let step = 0; step < suffix; step += 1) {
        word[wordLength] = data[cursor + step];
        wordLength += 1;
      }
      cursor += suffix;
      letters.set(word.subarray(0, wordLength), total);
      total += wordLength;
      offsets[n + 1] = total;
      if (hasFamiliarity) {
        scores[n] = data[cursor];
        cursor += 1;
      }
    }
    return new Lexicon(alphabet, letters.subarray(0, total), offsets, scores, longest);
  }

  private static coverageOf(scores: Uint8Array, count: number): number[] {
    const histogram = new Array<number>(256).fill(0);
    for (let i = 0; i < scores.length; i += 1) histogram[scores[i]] += 1;
    const coverage = new Array<number>(256).fill(0);
    let running = 0;
    for (let score = 255; score >= 0; score -= 1) {
      running += histogram[score];
      coverage[score] = scores.length === 0 ? count : running;
    }
    return coverage;
  }

  /** One pass over the whole list for the two things the bots read off a
   *  language rather than being told: which letters words end in, and which
   *  letters cannot be played without another. */
  private static statistics(
    letters: Uint8Array,
    offsets: Int32Array,
    alphabet: Alphabet,
  ): { endingShare: number[]; clinging: Clinging[] } {
    const size = alphabet.count;
    const words = offsets.length - 1;
    if (words <= 0) return { endingShare: new Array<number>(size).fill(0), clinging: [] };
    const endings = new Array<number>(size).fill(0);
    const occurrences = new Array<number>(size).fill(0);
    const followers = new Int32Array(size * size);
    for (let word = 0; word < words; word += 1) {
      const start = offsets[word];
      const end = offsets[word + 1];
      endings[letters[end - 1]] += 1;
      for (let position = start; position < end; position += 1) {
        const letter = letters[position];
        occurrences[letter] += 1;
        if (position + 1 < end) followers[letter * size + letters[position + 1]] += 1;
      }
    }
    const clinging: Clinging[] = [];
    for (let letter = 0; letter < size; letter += 1) {
      if (occurrences[letter] < 100) continue;
      let best = 0;
      for (let next = 1; next < size; next += 1) {
        if (followers[letter * size + next] > followers[letter * size + best]) best = next;
      }
      if (followers[letter * size + best] >= 0.9 * occurrences[letter]) clinging.push({ letter, needs: best });
    }
    return { endingShare: endings.map((n) => n / words), clinging };
  }

  // MARK: - Walking

  get root(): Node {
    return { low: 0, high: this.count, depth: 0 };
  }

  private wordLength(index: number): number {
    return this.offsets[index + 1] - this.offsets[index];
  }

  private letterOf(index: number, depth: number): number {
    return this.letters[this.offsets[index] + depth];
  }

  /** True when the prefix this node represents is itself a word.
   *  `minimumFamiliarity` is a Zipf frequency: 0 for the whole list, 4 for
   *  words as common as "cat". A list without frequencies ignores it. */
  isWord(node: Node, minimumFamiliarity = 0): boolean {
    if (node.low >= node.high || this.wordLength(node.low) !== node.depth) return false;
    if (minimumFamiliarity <= 0 || this.familiarity.length === 0) return true;
    return this.familiarity[node.low] >= minimumFamiliarity * 10;
  }

  /** The recorded Zipf frequency of a word, or null if it is not in the list. */
  familiarityOf(word: string): number | null {
    let node = this.root;
    for (const character of word) {
      const letter = this.alphabet.letter(character);
      if (letter === undefined) return null;
      const next = this.child(node, letter);
      if (next === null) return null;
      node = next;
    }
    if (!this.isWord(node)) return null;
    if (this.familiarity.length === 0) return 0;
    return this.familiarity[node.low] / 10;
  }

  get hasFamiliarity(): boolean {
    return this.familiarity.length > 0;
  }

  /** The Zipf frequency that keeps roughly the most familiar `share` of the
   *  list — 0.1 for the ten per cent of words a player is likeliest to know. */
  familiarityThreshold(share: number): number {
    if (!this.hasFamiliarity || share <= 0) return 0;
    if (share >= 1) return 0;
    const wanted = Math.round(this.count * share);
    if (wanted <= 0) return 25.5;
    for (let score = 255; score >= 1; score -= 1) {
      if (this.coverage[score] >= wanted) return score / 10;
    }
    return 0;
  }

  /** How much of the list a vocabulary of this Zipf floor can actually play. */
  shareAtOrAbove(zipf: number): number {
    if (!this.hasFamiliarity || this.count === 0) return 1;
    const score = Math.round(zipf * 10);
    if (score <= 0) return 1;
    if (score >= 256) return 0;
    return this.coverage[score] / this.count;
  }

  /** The node for this prefix extended by `letter`, or null if no word
   *  continues that way. */
  child(node: Node, letter: Letter): Node | null {
    const depth = node.depth;
    let low = node.low;
    const high = node.high;
    if (low >= high) return null;
    // Words equal to the prefix sort first and have no letter at `depth`.
    if (this.wordLength(low) === depth) low += 1;
    if (low >= high) return null;
    const start = this.lowerBound(low, high, depth, letter);
    if (start >= high || this.letterOf(start, depth) !== letter) return null;
    const end = this.lowerBound(start, high, depth, letter + 1);
    return { low: start, high: end, depth: depth + 1 };
  }

  /** The letters that can follow this prefix, in alphabet order. */
  childLetters(node: Node): Letter[] {
    const depth = node.depth;
    let low = node.low;
    const high = node.high;
    const letters: Letter[] = [];
    if (low >= high) return letters;
    if (this.wordLength(low) === depth) low += 1;
    let index = low;
    while (index < high) {
      const value = this.letterOf(index, depth);
      letters.push(value);
      index = this.lowerBound(index, high, depth, value + 1);
    }
    return letters;
  }

  private lowerBound(low: number, high: number, depth: number, target: number): number {
    const letters = this.letters;
    const offsets = this.offsets;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (letters[offsets[middle] + depth] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  // MARK: - Lookup

  contains(word: string): boolean {
    let node = this.root;
    for (const character of word) {
      const letter = this.alphabet.letter(character);
      if (letter === undefined) return false;
      const next = this.child(node, letter);
      if (next === null) return false;
      node = next;
    }
    return this.isWord(node);
  }

  containsLetters(word: Iterable<Letter>): boolean {
    let node = this.root;
    for (const letter of word) {
      const next = this.child(node, letter);
      if (next === null) return false;
      node = next;
    }
    return this.isWord(node);
  }

  /** Walks a prefix, returning null as soon as no word can continue it. */
  nodeForPrefix(prefix: Iterable<Letter>): Node | null {
    let node = this.root;
    for (const letter of prefix) {
      const next = this.child(node, letter);
      if (next === null) return null;
      node = next;
    }
    return node;
  }

  /** The word at a list index, for debugging. */
  wordAt(index: number): string {
    return this.alphabet.text(this.letters.subarray(this.offsets[index], this.offsets[index + 1]));
  }
}

function compareWords(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
