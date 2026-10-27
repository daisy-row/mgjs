import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_LEVELS, Bot, BotNames, GameError, GameState, LEVELS, Lexicon, SeededGenerator, Alphabet, playOut, profileOf,
  type Move,
} from '../src/engine/index';
import { english, letter, lexicon, rules } from './fixture';

const newGame = (seed = 1n): GameState =>
  new GameState([{ name: 'Ry', level: null }, { name: 'Ada Ames', level: 'expert' }], rules, lexicon, seed);

const botChooser = (state: GameState, rng: SeededGenerator): Move =>
  new Bot(state.currentPlayer.level ?? 'expert', english).chooseMove(state, rng);

test('a new game deals racks and keeps the rest in the bag', () => {
  const state = newGame();
  assert.equal(state.players.length, 2);
  assert.ok(state.players.every((player) => player.rack.length === 7));
  assert.equal(state.tilesInBag, rules.tileCount - 14);
  assert.equal(rules.tileCount, 104);
  assert.ok(state.board.isEmpty);
  assert.equal(state.turnNumber, 1);
  assert.ok(!state.isOver);
  assert.equal(state.history.length, 0);
});

test('the same seed deals the same game', () => {
  const first = newGame(99n);
  const second = newGame(99n);
  assert.deepEqual(first.players.map((p) => p.rack), second.players.map((p) => p.rack));
  assert.equal(first.currentPlayerIndex, second.currentPlayerIndex);
  assert.deepEqual(first.bag, second.bag);
});

test('playing a word scores it, refills the rack and passes the turn', () => {
  const state = newGame(5n);
  const play = state.bestPlay();
  assert.ok(play);
  const mover = state.currentPlayerIndex;
  const record = state.apply({ type: 'play', placements: play.placements });
  assert.equal(record.score, play.score);
  assert.equal(state.players[mover].score, play.score);
  assert.equal(state.players[mover].rack.length, 7);
  assert.equal(state.board.tileCount, play.placements.length);
  assert.notEqual(state.currentPlayerIndex, mover);
  assert.equal(state.history.length, 1);
  assert.equal(state.turnNumber, 2);
});

test('an illegal play is refused and changes nothing', () => {
  const state = newGame(5n);
  const tile = state.currentPlayer.rack[0];
  const placement = { position: { x: 0, y: 0 }, letter: tile < 0 ? letter('A') : tile, isBlank: tile < 0 };
  assert.throws(() => state.apply({ type: 'play', placements: [placement] }), (error: unknown) =>
    error instanceof GameError && error.kind.code === 'illegalPlay' && error.kind.error.code === 'mustCoverStart');
  assert.ok(state.board.isEmpty);
  assert.equal(state.history.length, 0);
});

test('a word has to be in the word list', () => {
  const tiny = Lexicon.fromWords(['CAT', 'CATS'], Alphabet.english);
  const state = new GameState([{ name: 'A', level: null }, { name: 'B', level: null }], rules, tiny, 3n);
  const placements = ['X', 'Y'].map((c, offset) => ({ position: { x: 7 + offset, y: 7 }, letter: letter(c), isBlank: false }));
  assert.equal(state.validate(placements).ok, false);
});

test('everyone passing twice ends the game', () => {
  const state = newGame(11n);
  for (let n = 0; n < 4; n += 1) state.apply({ type: 'pass' });
  assert.equal(state.outcome?.reason, 'scorelessTurns');
  assert.ok(state.isOver);
  assert.throws(() => state.apply({ type: 'pass' }), (error: unknown) => error instanceof GameError && error.kind.code === 'gameOver');
});

test('exchanging swaps tiles without changing the bag size', () => {
  const state = newGame(21n);
  const before = state.tilesInBag;
  const chosen = state.currentPlayer.rack.slice(0, 3);
  const mover = state.currentPlayerIndex;
  state.apply({ type: 'exchange', tiles: chosen });
  assert.equal(state.tilesInBag, before);
  assert.equal(state.players[mover].rack.length, 7);
  assert.notEqual(state.currentPlayerIndex, mover);
});

test('exchanging needs tiles in the bag', () => {
  const strict = rules.withOptions({ minimumBagForExchange: 1000 });
  const state = new GameState([{ name: 'A', level: null }, { name: 'B', level: null }], strict, lexicon, 4n);
  assert.ok(!state.canExchange);
  assert.throws(() => state.apply({ type: 'exchange', tiles: [state.currentPlayer.rack[0]] }));
});

test('resigning hands the game to the other player', () => {
  const state = newGame(31n);
  const quitter = state.currentPlayerIndex;
  state.apply({ type: 'resign' });
  assert.equal(state.outcome?.reason, 'resignations');
  assert.deepEqual(state.outcome?.winners.length, 1);
  assert.notEqual(state.outcome?.winners[0], quitter);
});

test('a game played out between bots adds up', () => {
  const rng = new SeededGenerator(77n);
  const state = new GameState([{ name: 'A', level: 'expert' }, { name: 'B', level: 'skilled' }], rules, lexicon, 77n);
  const outcome = playOut(state, rng, botChooser);
  assert.ok(outcome);
  assert.ok(state.isOver);
  assert.ok(state.history.length > 10);
  assert.ok(state.board.tileCount > 40);
  state.players.forEach((player, index) => {
    const fromTurns = state.history.filter((t) => t.playerIndex === index).reduce((sum, t) => sum + t.score, 0);
    assert.equal(player.score, fromTurns + outcome.adjustments[index]);
  });
  for (const winner of outcome.winners) {
    assert.ok(state.players.every((player) => player.score <= state.players[winner].score));
  }
  if (outcome.reason === 'playedOut') assert.equal(state.tilesInBag, 0);
});

test('a saved game restores to the same position and keeps playing', () => {
  const rng = new SeededGenerator(5n);
  const state = new GameState([{ name: 'A', level: 'expert' }, { name: 'B', level: 'casual' }], rules, lexicon, 5n);
  for (let n = 0; n < 4; n += 1) state.apply(botChooser(state, rng));
  const saved = JSON.parse(JSON.stringify(state.save()));
  const restored = GameState.restore(saved, rules, lexicon);
  assert.deepEqual(restored.board.serialize(), state.board.serialize());
  assert.deepEqual(restored.players, state.players);
  assert.deepEqual(restored.bag, state.bag);
  assert.equal(restored.turnNumber, state.turnNumber);
  const a = playOut(state, new SeededGenerator(1n), botChooser);
  const b = playOut(restored, new SeededGenerator(1n), botChooser);
  assert.deepEqual(a, b);
});

test('the expert takes the highest-scoring play', () => {
  const rng = new SeededGenerator(8n);
  const state = new GameState([{ name: 'A', level: 'expert' }, { name: 'B', level: 'expert' }], rules, lexicon, 8n);
  const opening = state.bestPlay();
  assert.ok(opening);
  state.apply({ type: 'play', placements: opening.placements });
  const best = state.bestPlay();
  assert.ok(best);
  const move = new Bot('expert', english).chooseMove(state, rng);
  assert.equal(move.type, 'play');
  if (move.type === 'play') {
    const scored = state.validate(move.placements);
    assert.ok(scored.ok);
    if (scored.ok) assert.equal(scored.play.score, best.score);
  }
});

test('a level only plays words it is supposed to know', () => {
  for (const level of BOT_LEVELS) {
    const profile = profileOf(level, english);
    if (profile.vocabulary === null) continue;
    const floor = lexicon.familiarityThreshold(profile.vocabulary);
    const rng = new SeededGenerator(12n);
    const state = new GameState([{ name: 'A', level }, { name: 'B', level }], rules, lexicon, 12n);
    let turns = 0;
    let wordsPlayed = 0;
    while (!state.isOver && turns < 24) {
      turns += 1;
      const move = new Bot(level, english).chooseMove(state, rng);
      if (move.type === 'play') {
        const scored = state.validate(move.placements);
        assert.ok(scored.ok);
        if (scored.ok) {
          for (const word of scored.play.words) {
            wordsPlayed += 1;
            assert.ok((lexicon.familiarityOf(word.text) ?? 0) >= floor, `${level} played ${word.text}`);
          }
        }
        if (profile.maximumTiles !== null) assert.ok(move.placements.length <= profile.maximumTiles);
      }
      state.apply(move);
    }
    assert.ok(wordsPlayed > 0, `${level} never played a word`);
  }
});

test('vocabularies grow up the ladder', () => {
  const novice = profileOf('novice', english).vocabulary!;
  const casual = profileOf('casual', english).vocabulary!;
  const skilled = profileOf('skilled', english).vocabulary!;
  assert.ok(novice < casual && casual < skilled);
  assert.equal(profileOf('expert', english).vocabulary, null);
  assert.equal(LEVELS.novice.maximumTiles, 3);
});

test('stronger levels outscore weaker ones over a few games', () => {
  let expertTotal = 0;
  let noviceTotal = 0;
  for (let game = 0; game < 4; game += 1) {
    const seed = BigInt(1000 + game);
    const state = new GameState([{ name: 'Expert', level: 'expert' }, { name: 'Novice', level: 'novice' }], rules, lexicon, seed);
    playOut(state, new SeededGenerator(seed), botChooser);
    expertTotal += state.players[0].score;
    noviceTotal += state.players[1].score;
  }
  assert.ok(expertTotal > noviceTotal);
});

test('a bot with no play exchanges or passes', () => {
  const rng = new SeededGenerator(2n);
  const state = new GameState([{ name: 'A', level: 'expert' }, { name: 'B', level: 'expert' }], rules, lexicon, 2n);
  state.debugSetRack(state.currentPlayerIndex, [letter('Q')]);
  const move = new Bot('expert', english).chooseMove(state, rng);
  assert.ok(move.type === 'exchange' ? move.tiles.length > 0 : move.type === 'pass');
});

test('bot names are distinct and avoid the player', () => {
  const roster = BotNames.roster(['casual', 'club', 'expert'], new SeededGenerator(3n), new Set(['Ada Ames']));
  const names = roster.map((bot) => bot.name);
  assert.equal(new Set(names).size, 3);
  assert.ok(!names.includes('Ada Ames'));
});
