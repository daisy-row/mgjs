import type { Board } from './board';
import {
  type Direction,
  type Placement,
  type Position,
  type Tile,
  boardIndex,
  indexOf,
  isOnBoard,
  lineOf,
  placementTile,
  positionOn,
  samePosition,
  sortedPlacements,
} from './letters';
import type { Lexicon } from './lexicon';
import type { GameRules } from './rules';
import { Scoring, type ScoredPlay } from './scoring';

/** Why a play was rejected. */
export type PlayError =
  | { code: 'noTiles' }
  | { code: 'tooManyTiles' }
  | { code: 'tilesNotOnRack' }
  | { code: 'offBoard'; position: Position }
  | { code: 'duplicateSquare'; position: Position }
  | { code: 'squareOccupied'; position: Position }
  | { code: 'notInLine' }
  | { code: 'notContiguous' }
  | { code: 'mustCoverStart' }
  | { code: 'notConnected' }
  | { code: 'noWordFormed' }
  | { code: 'invalidWords'; words: string[] };

export function describePlayError(error: PlayError): string {
  switch (error.code) {
    case 'noTiles': return 'No tiles were placed.';
    case 'tooManyTiles': return 'That is more tiles than the rack holds.';
    case 'tilesNotOnRack': return 'Those tiles are not on the rack.';
    case 'offBoard': return `Square ${error.position.x}|${error.position.y} is off the board.`;
    case 'duplicateSquare': return `Two tiles were placed on ${error.position.x}|${error.position.y}.`;
    case 'squareOccupied': return `Square ${error.position.x}|${error.position.y} is already taken.`;
    case 'notInLine': return 'Tiles must all go in one row or one column.';
    case 'notContiguous': return 'The played tiles must not leave a gap.';
    case 'mustCoverStart': return 'The first word must cover the star.';
    case 'notConnected': return 'The play must touch a tile already on the board.';
    case 'noWordFormed': return 'That does not form a word.';
    case 'invalidWords': {
      const list = error.words.join(', ');
      return error.words.length === 1 ? `${list} is not a word.` : `Not words: ${list}.`;
    }
  }
}

export type Validation = { ok: true; play: ScoredPlay } | { ok: false; error: PlayError };

/** Checks a play a player proposes, and scores it if it is legal. */
export function validatePlay(
  placements: readonly Placement[],
  board: Board,
  rack: readonly Tile[],
  rules: GameRules,
  lexicon: Lexicon,
): Validation {
  if (placements.length === 0) return { ok: false, error: { code: 'noTiles' } };
  if (placements.length > rack.length) return { ok: false, error: { code: 'tooManyTiles' } };

  const seen = new Set<number>();
  for (const placement of placements) {
    if (!isOnBoard(placement.position)) return { ok: false, error: { code: 'offBoard', position: placement.position } };
    const index = boardIndex(placement.position);
    if (seen.has(index)) return { ok: false, error: { code: 'duplicateSquare', position: placement.position } };
    seen.add(index);
    if (board.isOccupiedAt(index)) return { ok: false, error: { code: 'squareOccupied', position: placement.position } };
  }

  // The tiles have to come off the rack.
  const available = [...rack];
  for (const placement of placements) {
    const index = available.indexOf(placementTile(placement));
    if (index < 0) return { ok: false, error: { code: 'tilesNotOnRack' } };
    available.splice(index, 1);
  }

  const sorted = sortedPlacements(placements);
  let direction: Direction;
  if (sorted.length === 1) {
    const position = sorted[0].position;
    const horizontal = board.wordExtent(position, 'horizontal', sorted);
    direction = samePosition(horizontal.start, horizontal.end) ? 'vertical' : 'horizontal';
  } else if (sorted.every((placement) => placement.position.y === sorted[0].position.y)) {
    direction = 'horizontal';
  } else if (sorted.every((placement) => placement.position.x === sorted[0].position.x)) {
    direction = 'vertical';
  } else {
    return { ok: false, error: { code: 'notInLine' } };
  }

  // No gaps between the new tiles.
  const indices = sorted.map((placement) => indexOf(direction, placement.position));
  const line = lineOf(direction, sorted[0].position);
  const lowest = Math.min(...indices);
  const highest = Math.max(...indices);
  for (let index = lowest; index <= highest; index += 1) {
    const square = positionOn(direction, line, index);
    if (board.isOccupied(square)) continue;
    if (sorted.some((placement) => samePosition(placement.position, square))) continue;
    return { ok: false, error: { code: 'notContiguous' } };
  }

  // The first play covers the star; later plays touch what is there.
  if (board.isEmpty) {
    if (!sorted.some((placement) => samePosition(placement.position, board.layout.start))) {
      return { ok: false, error: { code: 'mustCoverStart' } };
    }
  } else if (!sorted.some((placement) => board.hasOccupiedNeighbour(placement.position))) {
    return { ok: false, error: { code: 'notConnected' } };
  }

  const scored = Scoring.evaluate(board, rules, sorted, direction);
  if (scored.words.length === 0) return { ok: false, error: { code: 'noWordFormed' } };
  const bad = scored.words.map((word) => word.text).filter((word) => !lexicon.contains(word));
  if (bad.length > 0) return { ok: false, error: { code: 'invalidWords', words: bad } };
  return { ok: true, play: scored };
}
