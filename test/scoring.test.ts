import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, Scoring, BLANK } from '../src/engine/index';
import { at, letter, placements, rules } from './fixture';

test('the opening word is doubled by the star', () => {
  const board = new Board(rules.layout);
  const play = Scoring.evaluate(board, rules, placements('CAT', at(7, 7), 'horizontal'), 'horizontal');
  assert.equal(play.score, 12);
  assert.equal(play.words.length, 1);
  assert.equal(play.words[0].text, 'CAT');
});

test('letter premiums only count under new tiles, and only once', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CAT', at(7, 7), 'horizontal'));
  const play = Scoring.evaluate(board, rules, [{ position: at(10, 7), letter: letter('S'), isBlank: false }], 'horizontal');
  assert.equal(play.score, 7);
});

test('a blank scores nothing but still spells its letter', () => {
  const board = new Board(rules.layout);
  const play = Scoring.evaluate(board, rules, placements('CAT', at(7, 7), 'horizontal', new Set([0])), 'horizontal');
  assert.equal(play.words[0].text, 'CAT');
  assert.equal(play.score, 4);
});

test('every crossing word scores too', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CAT', at(7, 7), 'horizontal'));
  const play = Scoring.evaluate(board, rules, [{ position: at(8, 8), letter: letter('T'), isBlank: false }], 'vertical');
  assert.deepEqual(play.words.map((word) => word.text), ['AT']);
  assert.equal(play.score, 2);
});

test('word premiums multiply, including two at once', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CAT', at(7, 7), 'horizontal'));
  const play = Scoring.evaluate(board, rules, placements('TLE', at(10, 7), 'horizontal'), 'horizontal');
  assert.equal(play.words[0].text, 'CATTLE');
  assert.equal(play.score, 20);
});

test('playing all seven tiles earns the bingo bonus', () => {
  const board = new Board(rules.layout);
  const eight = Scoring.evaluate(board, rules, placements('HESITATE', at(4, 7), 'horizontal'), 'horizontal');
  assert.equal(eight.bingo, false);
  const seven = Scoring.evaluate(board, rules, placements('RETINAS', at(7, 7), 'horizontal'), 'horizontal');
  assert.equal(seven.bingo, true);
  assert.equal(seven.score, Scoring.score(board, rules, seven.placements, 'horizontal'));
  assert.ok(seven.score > 50);
});

test('fast and detailed scoring agree', () => {
  const board = new Board(rules.layout);
  board.apply(placements('CATTLE', at(7, 7), 'horizontal'));
  const candidate = placements('ATE', at(9, 8), 'horizontal');
  const detailed = Scoring.evaluate(board, rules, candidate, 'horizontal');
  assert.equal(detailed.score, Scoring.score(board, rules, candidate, 'horizontal'));
});

test('leftover racks move points at the end', () => {
  const racks = [[], [letter('Q'), letter('A')], [letter('E')]];
  const adjustments = Scoring.finalAdjustments(racks, [true, true, true], 0, rules);
  assert.equal(adjustments[1], -11);
  assert.equal(adjustments[2], -1);
  assert.equal(adjustments[0], 12);
  assert.equal(adjustments.reduce((a, b) => a + b, 0), 0);
  assert.equal(rules.valueOfTile(BLANK), 0);
});
