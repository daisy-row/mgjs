import type { Board } from './board';
import { letterMultiplier, wordMultiplier } from './board';
import {
  type Direction,
  type PlacedTile,
  type Placement,
  type Position,
  type Tile,
  isOnBoard,
  perpendicular,
  samePosition,
  sortedPlacements,
  stepping,
} from './letters';
import type { GameRules } from './rules';

/** One word formed by a play, with the points it earned. */
export interface ScoredWord {
  text: string;
  start: Position;
  direction: Direction;
  score: number;
}

/** A play with its words and total score worked out. */
export interface ScoredPlay {
  placements: Placement[];
  direction: Direction;
  words: ScoredWord[];
  bingo: boolean;
  score: number;
}

/** The word along the direction the tiles were laid in, when there is one. */
export function mainWord(play: ScoredPlay): ScoredWord | undefined {
  return play.words.find((word) => word.direction === play.direction) ?? play.words[0];
}

/** Board plus the tiles a candidate play would add. */
class Overlay {
  constructor(readonly board: Board, readonly placements: readonly Placement[]) {}

  tile(position: Position): PlacedTile | null {
    if (!isOnBoard(position)) return null;
    const onBoard = this.board.tile(position);
    if (onBoard) return onBoard;
    for (const placement of this.placements) {
      if (samePosition(placement.position, position)) return { letter: placement.letter, isBlank: placement.isBlank };
    }
    return null;
  }

  isNew(position: Position): boolean {
    return this.placements.some((placement) => samePosition(placement.position, position));
  }

  extent(position: Position, direction: Direction): { start: Position; length: number } {
    let start = position;
    while (this.tile(stepping(start, -1, direction)) !== null) start = stepping(start, -1, direction);
    let length = 0;
    while (this.tile(stepping(start, length, direction)) !== null) length += 1;
    return { start, length };
  }
}

/** The word through `position` along `direction`, or null if it is a single
 *  tile (which is not a word). */
function wordScore(
  overlay: Overlay,
  rules: GameRules,
  position: Position,
  direction: Direction,
  countingPremiums: boolean,
): ScoredWord | null {
  const { start, length } = overlay.extent(position, direction);
  if (length < 2) return null;
  let sum = 0;
  let multiplier = 1;
  let text = '';
  for (let step = 0; step < length; step += 1) {
    const square = stepping(start, step, direction);
    const tile = overlay.tile(square);
    if (tile === null) break;
    text += rules.alphabet.character(tile.letter);
    let value = rules.valueOfPlaced(tile);
    if (countingPremiums && overlay.isNew(square)) {
      const premium = overlay.board.layout.premium(square);
      value *= letterMultiplier(premium);
      multiplier *= wordMultiplier(premium);
    }
    sum += value;
  }
  return { text, start, direction, score: sum * multiplier };
}

/** Scoring: letter and word premiums count only under newly placed tiles,
 *  every word the play forms scores, and using the whole rack earns the bingo
 *  bonus. */
export const Scoring = {
  /** Total score for a play, without building the word list.
   *  `countingPremiums: false` scores the board as if every square were
   *  plain — what a player who never notices the coloured squares thinks the
   *  play is worth, which is how the weaker bots choose. */
  score(
    board: Board,
    rules: GameRules,
    placements: readonly Placement[],
    direction: Direction,
    countingPremiums = true,
  ): number {
    if (placements.length === 0) return 0;
    const overlay = new Overlay(board, placements);
    let total = 0;
    const main = wordScore(overlay, rules, placements[0].position, direction, countingPremiums);
    if (main) total += main.score;
    const across = perpendicular(direction);
    for (const placement of placements) {
      const cross = wordScore(overlay, rules, placement.position, across, countingPremiums);
      if (cross) total += cross.score;
    }
    if (placements.length === rules.rackSize) total += rules.bingoBonus;
    return total;
  },

  /** Full breakdown: every word formed, the bingo flag and the total. */
  evaluate(board: Board, rules: GameRules, placements: readonly Placement[], direction: Direction): ScoredPlay {
    const overlay = new Overlay(board, placements);
    const words: ScoredWord[] = [];
    if (placements.length > 0) {
      const main = wordScore(overlay, rules, placements[0].position, direction, true);
      if (main) words.push(main);
    }
    const sorted = sortedPlacements(placements);
    const across = perpendicular(direction);
    for (const placement of sorted) {
      const cross = wordScore(overlay, rules, placement.position, across, true);
      if (cross) words.push(cross);
    }
    const bingo = placements.length === rules.rackSize;
    const total = words.reduce((sum, word) => sum + word.score, 0) + (bingo ? rules.bingoBonus : 0);
    return { placements: sorted, direction, words, bingo, score: total };
  },

  /** End-of-game adjustment: a player who used their last tile with an empty
   *  bag collects the value of everyone else's leftovers, and each of those
   *  players loses theirs. */
  finalAdjustments(
    racks: readonly (readonly Tile[])[],
    active: readonly boolean[],
    finisher: number | null,
    rules: GameRules,
  ): number[] {
    const adjustments = new Array<number>(racks.length).fill(0);
    let collected = 0;
    racks.forEach((rack, index) => {
      if (!active[index]) return;
      const leftovers = rules.valueOfRack(rack);
      if (leftovers <= 0) return;
      adjustments[index] -= leftovers;
      collected += leftovers;
    });
    if (finisher !== null && finisher >= 0 && finisher < racks.length && active[finisher]) {
      adjustments[finisher] += collected;
    }
    return adjustments;
  },
};
