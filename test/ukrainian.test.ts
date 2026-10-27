import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Alphabet, Board, Bot, GameState, MoveGenerator, SeededGenerator, playOut, validatePlay, type Move } from '../src/engine/index';
import { loadUkrainian } from './fixture-uk';

const ukrainian = loadUkrainian();
const { rules, lexicon, alphabet } = ukrainian;

test('the Ukrainian list is VESUM as the engine loads it', () => {
  assert.equal(alphabet.count, 33);
  assert.equal(lexicon.count, 2746623);
  assert.ok(lexicon.hasFamiliarity);
  assert.ok(lexicon.contains('КІТ'));
  assert.ok(lexicon.contains('ґанок'));
  assert.ok(!lexicon.contains('ЪЪ'));
  assert.equal(rules.tileCount, 103);
  assert.equal(rules.blankCount, 2);
  assert.equal(rules.valueOfLetter(alphabet.letter('Ґ')!), 10);
  assert.equal(ukrainian.gameName, 'Ерудит');
});

test('the alphabet is in Ukrainian order, not Unicode order', () => {
  const г = alphabet.letter('Г')!;
  const ґ = alphabet.letter('Ґ')!;
  assert.equal(ґ, г + 1);
  assert.equal(alphabet.letter('ґ'), ґ);
  assert.equal(Alphabet.ukrainian.vowels.size, 10);
  assert.ok(!Alphabet.ukrainian.vowels.has(alphabet.letter('Ь')!));
});

test('plays on a Ukrainian board are legal and the ladder is calibrated', () => {
  const board = new Board(rules.layout);
  const generator = new MoveGenerator(rules, lexicon);
  const hand = Array.from('КІТОРАС').map((c) => alphabet.tile(c)!);
  const plays = generator.plays(board, hand);
  assert.ok(plays.length > 50);
  for (const play of plays.slice(0, 200)) {
    assert.ok(validatePlay(play.placements, board, hand, rules, lexicon).ok, play.word);
  }
  assert.equal(ukrainian.rating('expert'), 2000);
  assert.equal(ukrainian.rating('novice'), 832);
  assert.ok(ukrainian.strength('novice') < ukrainian.strength('skilled'));
});

test('a Ukrainian game between bots plays out', () => {
  const rng = new SeededGenerator(7n);
  const state = new GameState([{ name: 'A', level: 'club' }, { name: 'B', level: 'novice' }], rules, lexicon, 7n);
  const chooser = (s: GameState, r: SeededGenerator): Move => new Bot(s.currentPlayer.level ?? 'expert', ukrainian).chooseMove(s, r);
  const outcome = playOut(state, rng, chooser);
  assert.ok(outcome);
  assert.ok(state.board.tileCount > 30);
  assert.ok(state.players[0].score > state.players[1].score);
  for (const turn of state.history) {
    if (turn.action.type === 'played') {
      for (const word of turn.action.play.words) assert.ok(lexicon.contains(word.text), word.text);
    }
  }
});
