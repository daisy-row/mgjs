import type { Board } from './board';
import {
  BLANK,
  DIRECTIONS,
  SIZE,
  type Direction,
  type Letter,
  type Placement,
  type Position,
  type Tile,
  boardIndex,
  perpendicular,
  positionOf,
} from './letters';
import type { Lexicon, Node } from './lexicon';
import type { GameRules } from './rules';
import { Scoring } from './scoring';

/** A legal tile play: where the tiles go, the line they run along, the word
 *  they spell and what the play is worth. */
export interface Play {
  placements: Placement[];
  direction: Direction;
  score: number;
  /** What the play would score if the board had no premium squares — what a
   *  player who does not notice them thinks it is worth. */
  flatScore: number;
  word: string;
  start: Position;
}

/** What a player is able to find this turn. The defaults are "everything":
 *  the whole word list, as many tiles as the rack holds, every anchor on the
 *  board. Bots below Expert narrow it, which is what makes them weaker — they
 *  play the best move they can *find*. */
export interface SearchLimits {
  /** Lowest Zipf frequency this player's vocabulary reaches: 0 is the whole
   *  list, 4 roughly "words as common as cat". */
  minimumFamiliarity?: number;
  /** Most tiles this player will put down in one turn. */
  maximumTiles?: number | null;
  /** The only squares (board indexes) this player looks at. */
  anchors?: Set<number> | null;
}

export const EVERYTHING: SearchLimits = {};

/** Finds every legal play for a rack on a board: the usual anchor-and-cross-
 *  check search. For each empty square next to a tile already on the board,
 *  grow words through it letter by letter, pruned by the word list and by
 *  what the crossing words allow. */
export class MoveGenerator {
  constructor(readonly rules: GameRules, readonly lexicon: Lexicon) {}

  /** Every legal play, in generation order. */
  plays(board: Board, rack: readonly Tile[], limits: SearchLimits = EVERYTHING): Play[] {
    if (rack.length === 0) return [];
    const search = new Search(board, this.rules, this.lexicon, rack, limits);
    search.run();
    return search.results;
  }

  /** The highest-scoring play, or null when the rack cannot be played. */
  bestPlay(board: Board, rack: readonly Tile[], limits: SearchLimits = EVERYTHING): Play | null {
    let best: Play | null = null;
    for (const play of this.plays(board, rack, limits)) {
      if (best === null || play.score > best.score) best = play;
    }
    return best;
  }
}

class Search {
  readonly results: Play[] = [];

  private readonly tileBudget: number;
  private readonly minimumFamiliarity: number;
  private readonly counts: number[];
  private blanks: number;
  private readonly seenSingleTilePlays = new Set<number>();

  /** Anchors: empty squares touching a tile, or the start square on an empty
   *  board. The search depends on this set structurally — a word may not be
   *  built through one, which is what keeps a play from being generated
   *  twice. */
  private readonly anchors: Uint8Array;
  /** The anchors this player actually looks at, a subset of the above.
   *  Narrowing it hides plays; it must never change the rules. */
  private readonly startAnchors: Uint8Array;
  /** Letters each empty square may take, given the crossing word: one byte
   *  per square per letter, 1 when allowed. */
  private crossAllowed: Uint8Array;
  private readonly alphabetSize: number;

  private direction: Direction = 'horizontal';
  private line = 0;
  private anchorIndex = 0;
  private wordStartIndex = 0;
  private wordLetters: Letter[] = [];
  private placements: Placement[] = [];

  constructor(
    private readonly board: Board,
    private readonly rules: GameRules,
    private readonly lexicon: Lexicon,
    rack: readonly Tile[],
    limits: SearchLimits,
  ) {
    this.tileBudget = Math.min(rack.length, limits.maximumTiles ?? rack.length);
    this.minimumFamiliarity = limits.minimumFamiliarity ?? 0;
    this.alphabetSize = rules.alphabet.count;
    this.crossAllowed = new Uint8Array(SIZE * SIZE * this.alphabetSize);
    this.counts = new Array<number>(rules.alphabet.count).fill(0);
    this.blanks = 0;
    for (const tile of rack) {
      if (tile === BLANK) this.blanks += 1;
      else this.counts[tile] += 1;
    }

    this.anchors = new Uint8Array(SIZE * SIZE);
    this.startAnchors = new Uint8Array(SIZE * SIZE);
    if (board.isEmpty) {
      // The opening play has only one place to go, so a narrowed search
      // must still include it.
      const start = boardIndex(board.layout.start);
      this.anchors[start] = 1;
      this.startAnchors[start] = 1;
    } else {
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const position = { x, y };
          const index = y * SIZE + x;
          if (board.isOccupiedAt(index) || !board.hasOccupiedNeighbour(position)) continue;
          this.anchors[index] = 1;
          if (limits.anchors && !limits.anchors.has(index)) continue;
          this.startAnchors[index] = 1;
        }
      }
    }
  }

  run(): void {
    for (const direction of DIRECTIONS) {
      this.direction = direction;
      this.computeCrossMasks();
      for (let index = 0; index < SIZE * SIZE; index += 1) {
        if (this.startAnchors[index]) this.generate(index);
      }
    }
  }

  // MARK: Cross-checks

  private computeCrossMasks(): void {
    const across = perpendicular(this.direction);
    const size = this.alphabetSize;
    const allowed = new Uint8Array(SIZE * SIZE * size).fill(1);
    const board = this.board;
    const lexicon = this.lexicon;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const index = y * SIZE + x;
        if (board.isOccupiedAt(index)) continue;
        const prefix: Letter[] = [];
        let step = 1;
        for (;;) {
          const letter = this.letterAlong(x, y, -step, across);
          if (letter < 0) break;
          prefix.push(letter);
          step += 1;
        }
        prefix.reverse();
        const suffix: Letter[] = [];
        step = 1;
        for (;;) {
          const letter = this.letterAlong(x, y, step, across);
          if (letter < 0) break;
          suffix.push(letter);
          step += 1;
        }
        if (prefix.length === 0 && suffix.length === 0) continue;
        allowed.fill(0, index * size, (index + 1) * size);
        const prefixNode = lexicon.nodeForPrefix(prefix);
        if (prefixNode === null) continue;
        for (const letter of lexicon.childLetters(prefixNode)) {
          let node: Node | null = lexicon.child(prefixNode, letter);
          if (node === null) continue;
          for (const suffixLetter of suffix) {
            node = lexicon.child(node, suffixLetter);
            if (node === null) break;
          }
          if (node !== null && lexicon.isWord(node, this.minimumFamiliarity)) allowed[index * size + letter] = 1;
        }
      }
    }
    this.crossAllowed = allowed;
  }

  /** The letter `distance` squares from (x, y) along `direction`, or -1. */
  private letterAlong(x: number, y: number, distance: number, direction: Direction): number {
    const nx = direction === 'horizontal' ? x + distance : x;
    const ny = direction === 'horizontal' ? y : y + distance;
    if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) return -1;
    return this.board.letterAt(ny * SIZE + nx);
  }

  /** The board index of the square at `index` along the current line. */
  private square(index: number): number {
    return this.direction === 'horizontal' ? this.line * SIZE + index : index * SIZE + this.line;
  }

  // MARK: Generation

  private generate(anchor: number): void {
    const position = positionOf(anchor);
    this.line = this.direction === 'horizontal' ? position.y : position.x;
    this.anchorIndex = this.direction === 'horizontal' ? position.x : position.y;
    this.placements.length = 0;
    this.wordLetters.length = 0;

    const previousIndex = this.anchorIndex - 1;
    if (previousIndex >= 0 && this.board.isOccupiedAt(this.square(previousIndex))) {
      // The squares left of the anchor already hold a word; that word is the
      // fixed start of anything we play here.
      let startIndex = previousIndex;
      while (startIndex - 1 >= 0 && this.board.isOccupiedAt(this.square(startIndex - 1))) startIndex -= 1;
      const letters: Letter[] = [];
      for (let index = startIndex; index <= previousIndex; index += 1) {
        const letter = this.board.letterAt(this.square(index));
        if (letter < 0) return;
        letters.push(letter);
      }
      const node = this.lexicon.nodeForPrefix(letters);
      if (node === null) return;
      this.wordStartIndex = startIndex;
      this.wordLetters = letters;
      this.extendRight(this.anchorIndex, node);
      this.wordLetters = [];
    } else {
      // Count how far left we may build. Stopping at other anchors keeps
      // each play from being generated more than once.
      let room = 0;
      let index = this.anchorIndex - 1;
      while (
        index >= 0 &&
        !this.board.isOccupiedAt(this.square(index)) &&
        !this.anchors[this.square(index)] &&
        room < this.tileBudget - 1
      ) {
        room += 1;
        index -= 1;
      }
      for (let leftLength = 0; leftLength <= room; leftLength += 1) {
        this.wordStartIndex = this.anchorIndex - leftLength;
        this.extendLeft(leftLength, this.wordStartIndex, this.lexicon.root);
      }
    }
  }

  /** Lays `remaining` tiles on the empty squares before the anchor, then
   *  continues to the right. */
  private extendLeft(remaining: number, index: number, node: Node): void {
    if (remaining <= 0) {
      this.extendRight(index, node);
      return;
    }
    const square = this.square(index);
    const position = positionOf(square);
    const base = square * this.alphabetSize;
    for (const letter of this.lexicon.childLetters(node)) {
      if (this.crossAllowed[base + letter] === 0) continue;
      const next = this.lexicon.child(node, letter);
      if (next === null) continue;
      if (this.counts[letter] > 0) {
        this.counts[letter] -= 1;
        this.placements.push({ position, letter, isBlank: false });
        this.wordLetters.push(letter);
        this.extendLeft(remaining - 1, index + 1, next);
        this.wordLetters.pop();
        this.placements.pop();
        this.counts[letter] += 1;
      }
      if (this.blanks > 0) {
        this.blanks -= 1;
        this.placements.push({ position, letter, isBlank: true });
        this.wordLetters.push(letter);
        this.extendLeft(remaining - 1, index + 1, next);
        this.wordLetters.pop();
        this.placements.pop();
        this.blanks += 1;
      }
    }
  }

  private extendRight(index: number, node: Node): void {
    if (index >= SIZE) {
      this.record(node, SIZE - 1);
      return;
    }
    const square = this.square(index);
    const onBoard = this.board.letterAt(square);
    if (onBoard >= 0) {
      const next = this.lexicon.child(node, onBoard);
      if (next === null) return;
      this.wordLetters.push(onBoard);
      this.extendRight(index + 1, next);
      this.wordLetters.pop();
      return;
    }
    // The word may stop here, because this square stays empty.
    this.record(node, index - 1);
    if (this.placements.length >= this.tileBudget) return;
    const position = positionOf(square);
    const base = square * this.alphabetSize;
    for (const letter of this.lexicon.childLetters(node)) {
      if (this.crossAllowed[base + letter] === 0) continue;
      const next = this.lexicon.child(node, letter);
      if (next === null) continue;
      if (this.counts[letter] > 0) {
        this.counts[letter] -= 1;
        this.placements.push({ position, letter, isBlank: false });
        this.wordLetters.push(letter);
        this.extendRight(index + 1, next);
        this.wordLetters.pop();
        this.placements.pop();
        this.counts[letter] += 1;
      }
      if (this.blanks > 0) {
        this.blanks -= 1;
        this.placements.push({ position, letter, isBlank: true });
        this.wordLetters.push(letter);
        this.extendRight(index + 1, next);
        this.wordLetters.pop();
        this.placements.pop();
        this.blanks += 1;
      }
    }
  }

  private record(node: Node, endIndex: number): void {
    if (this.placements.length === 0) return;
    if (endIndex < this.anchorIndex) return; // the play has to cover the anchor
    if (!this.lexicon.isWord(node, this.minimumFamiliarity)) return;
    if (this.placements.length === 1) {
      // A lone tile can be reached from either direction; keep one.
      const only = this.placements[0];
      const key = (boardIndex(only.position) * 64 + only.letter) * 2 + (only.isBlank ? 1 : 0);
      if (this.seenSingleTilePlays.has(key)) return;
      this.seenSingleTilePlays.add(key);
    }
    const placements = this.placements.map((placement) => ({ ...placement }));
    const score = Scoring.score(this.board, this.rules, placements, this.direction, true);
    const flatScore = Scoring.score(this.board, this.rules, placements, this.direction, false);
    this.results.push({
      placements,
      direction: this.direction,
      score,
      flatScore,
      word: this.rules.alphabet.text(this.wordLetters),
      start: positionOf(this.square(this.wordStartIndex)),
    });
  }
}
