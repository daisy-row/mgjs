import {
  SIZE,
  type Direction,
  type Letter,
  type PlacedTile,
  type Placement,
  type Position,
  boardIndex,
  isOnBoard,
  samePosition,
  stepping,
} from './letters';
import type { Alphabet } from './alphabet';

/** A premium square, in the vocabulary of the original `Board.txt`: ` `
 *  plain, `d`/`t` letter bonuses, `D`/`T` word bonuses and `*` for the start
 *  square, which doubles the first word. */
export enum Premium {
  plain = 0,
  doubleLetter = 1,
  tripleLetter = 2,
  doubleWord = 3,
  tripleWord = 4,
  start = 5,
}

export function premiumOf(character: string): Premium | null {
  switch (character) {
    case ' ': return Premium.plain;
    case 'd': return Premium.doubleLetter;
    case 't': return Premium.tripleLetter;
    case 'D': return Premium.doubleWord;
    case 'T': return Premium.tripleWord;
    case '*': return Premium.start;
    default: return null;
  }
}

export function letterMultiplier(premium: Premium): number {
  return premium === Premium.doubleLetter ? 2 : premium === Premium.tripleLetter ? 3 : 1;
}

export function wordMultiplier(premium: Premium): number {
  if (premium === Premium.doubleWord || premium === Premium.start) return 2;
  return premium === Premium.tripleWord ? 3 : 1;
}

export function premiumLabel(premium: Premium): string {
  switch (premium) {
    case Premium.doubleLetter: return 'DL';
    case Premium.tripleLetter: return 'TL';
    case Premium.doubleWord: return 'DW';
    case Premium.tripleWord: return 'TW';
    case Premium.start: return '★';
    default: return '';
  }
}

export function premiumClass(premium: Premium): string {
  switch (premium) {
    case Premium.doubleLetter: return 'dl';
    case Premium.tripleLetter: return 'tl';
    case Premium.doubleWord: return 'dw';
    case Premium.tripleWord: return 'tw';
    case Premium.start: return 'start';
    default: return '';
  }
}

/** The premium-square layout, parsed from `Board.txt`. */
export class BoardLayout {
  readonly premiums: Uint8Array;
  readonly start: Position;

  constructor(premiums: Uint8Array, start: Position) {
    if (premiums.length !== SIZE * SIZE) throw new Error(`board layout must be ${SIZE}x${SIZE}`);
    this.premiums = premiums;
    this.start = start;
  }

  premium(position: Position): Premium {
    return this.premiums[boardIndex(position)] as Premium;
  }

  premiumAt(index: number): Premium {
    return this.premiums[index] as Premium;
  }

  /** Parses the pipe-delimited format: ` | | |T| | |t| ...`. */
  static parse(text: string): BoardLayout {
    const rows = text.split('\n').filter((row) => row.length > 0);
    if (rows.length !== SIZE) throw new Error(`board has ${rows.length} rows, expected ${SIZE}`);
    const premiums = new Uint8Array(SIZE * SIZE);
    let start: Position | null = null;
    rows.forEach((row, y) => {
      const squares = row.split('|');
      if (squares.length !== SIZE) throw new Error(`row ${y} has ${squares.length} squares, expected ${SIZE}`);
      squares.forEach((square, x) => {
        const premium = premiumOf(square.length ? square[0] : ' ');
        if (premium === null) throw new Error(`row ${y} column ${x} has unknown square '${square}'`);
        premiums[y * SIZE + x] = premium;
        if (premium === Premium.start) start = { x, y };
      });
    });
    if (start === null) throw new Error('board has no start square');
    return new BoardLayout(premiums, start);
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The tiles on the board plus the premium-square layout under them. */
export class Board {
  readonly layout: BoardLayout;
  /** The letter on each square, or -1. */
  private readonly letters: Int8Array;
  /** 1 where the tile came from a blank. */
  private readonly blanks: Uint8Array;
  private count = 0;

  constructor(layout: BoardLayout, letters?: Int8Array, blanks?: Uint8Array) {
    this.layout = layout;
    this.letters = letters ?? new Int8Array(SIZE * SIZE).fill(-1);
    this.blanks = blanks ?? new Uint8Array(SIZE * SIZE);
    for (let index = 0; index < SIZE * SIZE; index += 1) if (this.letters[index] >= 0) this.count += 1;
  }

  clone(): Board {
    return new Board(this.layout, this.letters.slice(), this.blanks.slice());
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get tileCount(): number {
    return this.count;
  }

  tile(position: Position): PlacedTile | null {
    if (!isOnBoard(position)) return null;
    return this.tileAt(boardIndex(position));
  }

  tileAt(index: number): PlacedTile | null {
    const letter = this.letters[index];
    if (letter < 0) return null;
    return { letter, isBlank: this.blanks[index] === 1 };
  }

  /** The letter on a square by index, or -1: the move generator's fast path. */
  letterAt(index: number): number {
    return this.letters[index];
  }

  isOccupied(position: Position): boolean {
    return isOnBoard(position) && this.letters[boardIndex(position)] >= 0;
  }

  isOccupiedAt(index: number): boolean {
    return this.letters[index] >= 0;
  }

  letter(position: Position): Letter | null {
    const tile = this.tile(position);
    return tile ? tile.letter : null;
  }

  hasOccupiedNeighbour(position: Position): boolean {
    for (const [dx, dy] of NEIGHBOURS) {
      if (this.isOccupied({ x: position.x + dx, y: position.y + dy })) return true;
    }
    return false;
  }

  /** The empty squares a play could attach to: next to a tile already down,
   *  or the start square on an empty board. Row-major order. */
  anchors(): Position[] {
    if (this.isEmpty) return [this.layout.start];
    const found: Position[] = [];
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const position = { x, y };
        if (!this.isOccupied(position) && this.hasOccupiedNeighbour(position)) found.push(position);
      }
    }
    return found;
  }

  set(position: Position, tile: PlacedTile | null): void {
    if (!isOnBoard(position)) throw new Error('position off board');
    const index = boardIndex(position);
    if (this.letters[index] >= 0) this.count -= 1;
    if (tile) {
      this.letters[index] = tile.letter;
      this.blanks[index] = tile.isBlank ? 1 : 0;
      this.count += 1;
    } else {
      this.letters[index] = -1;
      this.blanks[index] = 0;
    }
  }

  apply(placements: readonly Placement[]): void {
    for (const placement of placements) {
      this.set(placement.position, { letter: placement.letter, isBlank: placement.isBlank });
    }
  }

  applying(placements: readonly Placement[]): Board {
    const copy = this.clone();
    copy.apply(placements);
    return copy;
  }

  /** The first and last square of the run of tiles through `position` along
   *  `direction`, treating `extra` as if those tiles were already placed. */
  wordExtent(
    position: Position,
    direction: Direction,
    extra: readonly Placement[] = [],
  ): { start: Position; end: Position } {
    const occupied = (candidate: Position): boolean => {
      if (!isOnBoard(candidate)) return false;
      if (this.isOccupied(candidate)) return true;
      return extra.some((placement) => samePosition(placement.position, candidate));
    };
    let start = position;
    while (occupied(stepping(start, -1, direction))) start = stepping(start, -1, direction);
    let end = position;
    while (occupied(stepping(end, 1, direction))) end = stepping(end, 1, direction);
    return { start, end };
  }

  /** The board the way the original Java bot logged it, for debugging. */
  render(alphabet: Alphabet, showPremiums = true): string {
    const lines: string[] = [];
    lines.push('    ' + Array.from({ length: SIZE }, (_, i) => String(i + 1).padStart(2)).join(''));
    for (let y = 0; y < SIZE; y += 1) {
      let line = String(y + 1).padStart(3) + ' ';
      for (let x = 0; x < SIZE; x += 1) {
        const tile = this.tile({ x, y });
        if (tile) {
          const letter = alphabet.character(tile.letter);
          line += ' ' + (tile.isBlank ? letter.toLowerCase() : letter);
        } else if (showPremiums) {
          line += ' ' + ('.dtDT*'[this.layout.premium({ x, y })] ?? '.');
        } else {
          line += ' .';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** For saving a game. */
  serialize(): { letters: number[]; blanks: number[] } {
    return { letters: Array.from(this.letters), blanks: Array.from(this.blanks) };
  }

  static deserialize(layout: BoardLayout, saved: { letters: number[]; blanks: number[] }): Board {
    return new Board(layout, Int8Array.from(saved.letters), Uint8Array.from(saved.blanks));
  }
}
