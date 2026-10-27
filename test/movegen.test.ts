import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Board, DIRECTIONS, MoveGenerator, SIZE, SeededGenerator, type Placement, boardIndex, comparePositions,
  positionOn, sortedPlacements, validatePlay,
} from '../src/engine/index';
import { at, lexicon, placements, rack, rules } from './fixture';

const generator = new MoveGenerator(rules, lexicon);
const key = (ps: Placement[]): string =>
  sortedPlacements(ps).map((p) => `${p.position.x},${p.position.y},${p.letter},${p.isBlank ? 1 : 0}`).join(';');

test('every opening play covers the star and spells a word', () => {
  const board = new Board(rules.layout);
  const plays = generator.plays(board, rack('CAT'));
  assert.ok(plays.length > 0);
  for (const play of plays) {
    assert.ok(play.placements.some((p) => p.position.x === 7 && p.position.y === 7));
    assert.ok(lexicon.contains(play.word));
    assert.equal(play.placements.length, play.word.length);
  }
  const words = plays.map((play) => play.word);
  assert.ok(words.includes('CAT'));
  assert.ok(words.includes('ACT'));
  assert.ok(words.includes('AT'));
  assert.ok(!words.includes('TAC'));
});

test('generated plays are all legal, and their scores check out', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CATTLE', at(5, 7), 'horizontal'));
  board.apply(placements('OBOE', at(5, 8), 'vertical'));
  const hand = rack('RETINS');
  const plays = generator.plays(board, hand);
  assert.ok(plays.length > 100);
  for (const play of plays) {
    const result = validatePlay(play.placements, board, hand, rules, lexicon);
    assert.ok(result.ok, `generator produced an illegal play ${play.word}`);
    if (result.ok) assert.equal(result.play.score, play.score);
  }
});

test('no play is generated twice', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CATTLE', at(5, 7), 'horizontal'));
  const seen = new Set<string>();
  for (const play of generator.plays(board, rack('AEST'))) {
    const k = key(play.placements);
    assert.ok(!seen.has(k), `duplicate play ${play.word}`);
    seen.add(k);
  }
});

function permutations<T>(elements: T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (count > elements.length) return [];
  const result: T[][] = [];
  elements.forEach((element, index) => {
    const rest = elements.filter((_, i) => i !== index);
    for (const tail of permutations(rest, count - 1)) result.push([element, ...tail]);
  });
  return result;
}

test('the generator finds exactly what a brute-force search finds', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CATTLE', at(5, 7), 'horizontal'));
  board.apply(placements('TORE', at(8, 7), 'vertical'));
  const hand = rack('DOS');
  const generated = new Set(generator.plays(board, hand).map((play) => key(play.placements)));
  const brute = new Set<string>();
  for (const direction of DIRECTIONS) {
    for (let line = 0; line < SIZE; line += 1) {
      for (let start = 0; start < SIZE; start += 1) {
        for (let length = 2; start + length <= SIZE; length += 1) {
          const squares = Array.from({ length }, (_, i) => positionOn(direction, line, start + i));
          const empty = squares.filter((square) => !board.isOccupied(square));
          if (empty.length === 0 || empty.length > hand.length) continue;
          if (board.isOccupied(positionOn(direction, line, start - 1))) continue;
          if (board.isOccupied(positionOn(direction, line, start + length))) continue;
          for (const assignment of permutations(hand, empty.length)) {
            const candidate = empty.map((position, i) => ({ position, letter: assignment[i], isBlank: false }));
            if (validatePlay(candidate, board, hand, rules, lexicon).ok) brute.add(key(candidate));
          }
        }
      }
    }
  }
  assert.ok(brute.size > 0);
  assert.deepEqual([...generated].sort(), [...brute].sort());
});

test('blanks are played as any letter, for no points', () => {
  const board = new Board(rules.layout);
  const plays = generator.plays(board, rack('CT '));
  const cat = plays.find((play) => play.word === 'CAT');
  assert.ok(cat);
  assert.ok(cat.placements.some((p) => p.isBlank));
  assert.equal(cat.score, 10);
  assert.ok(plays.some((play) => play.word === 'ACT'));
  const real = generator.plays(board, rack('CAT')).find((play) => play.word === 'CAT');
  assert.equal(real?.score, 12);
});

test('a tile that only works across the line is still found', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CAT', at(7, 7), 'horizontal'));
  const plays = generator.plays(board, rack('S'));
  assert.ok(plays.some((play) =>
    play.placements.length === 1 && play.placements[0].position.x === 8 && play.placements[0].position.y === 8));
  const cats = plays.find((play) => play.word === 'CATS');
  assert.ok(cats);
  assert.equal(cats.placements.length, 1);
});

test('a rack with no play produces no plays', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CAT', at(7, 7), 'horizontal'));
  assert.equal(generator.plays(board, rack('Q')).length, 0);
});

test('a search that sees only part of the board still plays legally', () => {
  const board = new Board(rules.layout);
  board.apply(placements('DEVIOUS', at(7, 5), 'horizontal'));
  board.apply(placements('QUEER', at(4, 6), 'horizontal'));
  board.apply(placements('MELT', at(5, 3), 'horizontal'));
  const hand = rack('YAADNIR');
  const all = board.anchors();
  const rng = new SeededGenerator(4n);
  for (let round = 0; round < 12; round += 1) {
    const visible = new Set(rng.shuffled(all).slice(0, Math.max(1, Math.floor(all.length / 3))).map(boardIndex));
    visible.add(boardIndex([...all].sort(comparePositions)[0]));
    const plays = generator.plays(board, hand, { minimumFamiliarity: 3.2, maximumTiles: 5, anchors: visible });
    for (const play of plays) {
      assert.ok(validatePlay(play.placements, board, hand, rules, lexicon).ok, `narrowed search produced ${play.word}`);
    }
  }
});

test('narrowing the search only ever removes plays', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CATTLE', at(5, 7), 'horizontal'));
  const hand = rack('RETINAS');
  const everything = new Set(generator.plays(board, hand).map((play) => key(play.placements)));
  const rng = new SeededGenerator(9n);
  const visible = new Set(rng.shuffled(board.anchors()).slice(0, 3).map(boardIndex));
  const narrowed = generator.plays(board, hand, { minimumFamiliarity: 2.0, maximumTiles: 4, anchors: visible });
  assert.ok(narrowed.length > 0);
  for (const play of narrowed) assert.ok(everything.has(key(play.placements)));
  const capped = generator.plays(board, hand, { minimumFamiliarity: 4.0, maximumTiles: 3 });
  assert.ok(capped.length < everything.size);
  assert.ok(capped.every((play) => play.placements.length <= 3));
});

test('the best play beats every other one', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CATTLE', at(5, 7), 'horizontal'));
  const hand = rack('AEIOUST');
  const best = generator.bestPlay(board, hand);
  assert.ok(best);
  for (const play of generator.plays(board, hand)) assert.ok(play.score <= best.score);
});
