import { Alphabet } from './alphabet';
import type { BoardLayout } from './board';
import { BLANK, type Letter, type PlacedTile, type Tile } from './letters';

export interface RuleOptions {
  rackSize?: number;
  bingoBonus?: number;
  minimumBagForExchange?: number;
  scorelessTurnsPerPlayerToEnd?: number;
}

/** Board layout, tile values, tile distribution and the handful of numbers
 *  that make up the rules. */
export class GameRules {
  readonly layout: BoardLayout;
  readonly alphabet: Alphabet;
  /** Points per letter, indexed by letter. */
  readonly letterValues: readonly number[];
  /** Tiles per letter in a full bag, indexed by letter. */
  readonly letterCounts: readonly number[];
  readonly blankCount: number;
  readonly rackSize: number;
  /** Awarded for playing every tile on the rack in one turn. */
  readonly bingoBonus: number;
  /** A player may only exchange while at least this many tiles are in the bag. */
  readonly minimumBagForExchange: number;
  /** The game ends once every active player has had this many scoreless turns
   *  in a row (passes or exchanges). */
  readonly scorelessTurnsPerPlayerToEnd: number;

  constructor(
    layout: BoardLayout,
    alphabet: Alphabet,
    letterValues: readonly number[],
    letterCounts: readonly number[],
    blankCount: number,
    options: RuleOptions = {},
  ) {
    if (letterValues.length !== alphabet.count || letterCounts.length !== alphabet.count) {
      throw new Error('the tile tables must cover every letter of the alphabet');
    }
    this.layout = layout;
    this.alphabet = alphabet;
    this.letterValues = letterValues;
    this.letterCounts = letterCounts;
    this.blankCount = blankCount;
    this.rackSize = options.rackSize ?? 7;
    this.bingoBonus = options.bingoBonus ?? 50;
    this.minimumBagForExchange = options.minimumBagForExchange ?? 7;
    this.scorelessTurnsPerPlayerToEnd = options.scorelessTurnsPerPlayerToEnd ?? 2;
  }

  /** Reads a `Tiles.txt`: `LETTER COUNT VALUE` a line, the blank written `_`,
   *  `#` comments ignored. */
  static fromTileTable(text: string, alphabet: Alphabet, layout: BoardLayout, options: RuleOptions = {}): GameRules {
    const values = new Array<number>(alphabet.count).fill(-1);
    const counts = new Array<number>(alphabet.count).fill(-1);
    let blanks = 0;
    let sawBlank = false;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts.length !== 3 || Array.from(parts[0]).length !== 1) throw new Error(`cannot parse tile table line '${line}'`);
      const count = Number(parts[1]);
      const value = Number(parts[2]);
      if (!Number.isInteger(count) || !Number.isInteger(value)) throw new Error(`cannot parse tile table line '${line}'`);
      const key = parts[0];
      if (key === '_') {
        blanks = count;
        sawBlank = true;
        continue;
      }
      const letter = alphabet.letter(key);
      if (letter === undefined) throw new Error(`the tile table has '${key}', which this language does not play with`);
      if (counts[letter] !== -1) throw new Error(`the tile table lists '${key}' twice`);
      counts[letter] = count;
      values[letter] = value;
    }
    if (!sawBlank) throw new Error("the tile table has no blank (a '_' line)");
    const missing = counts.indexOf(-1);
    if (missing >= 0) throw new Error(`the tile table says nothing about '${alphabet.character(missing)}'`);
    return new GameRules(layout, alphabet, values, counts, blanks, options);
  }

  withOptions(options: RuleOptions): GameRules {
    return new GameRules(this.layout, this.alphabet, this.letterValues, this.letterCounts, this.blankCount, {
      rackSize: this.rackSize,
      bingoBonus: this.bingoBonus,
      minimumBagForExchange: this.minimumBagForExchange,
      scorelessTurnsPerPlayerToEnd: this.scorelessTurnsPerPlayerToEnd,
      ...options,
    });
  }

  valueOfLetter(letter: Letter): number {
    return this.letterValues[letter];
  }

  valueOfTile(tile: Tile): number {
    return tile === BLANK ? 0 : this.letterValues[tile];
  }

  valueOfPlaced(tile: PlacedTile): number {
    return tile.isBlank ? 0 : this.letterValues[tile.letter];
  }

  valueOfRack(rack: readonly Tile[]): number {
    let total = 0;
    for (const tile of rack) total += this.valueOfTile(tile);
    return total;
  }

  countOf(letter: Letter): number {
    return this.letterCounts[letter];
  }

  get tileCount(): number {
    return this.letterCounts.reduce((sum, count) => sum + count, 0) + this.blankCount;
  }

  /** A full bag, in tile order; shuffle before dealing. */
  fullBag(): Tile[] {
    const tiles: Tile[] = [];
    for (let letter = 0; letter < this.alphabet.count; letter += 1) {
      for (let n = 0; n < this.letterCounts[letter]; n += 1) tiles.push(letter);
    }
    for (let n = 0; n < this.blankCount; n += 1) tiles.push(BLANK);
    return tiles;
  }
}
