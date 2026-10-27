import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Alphabet, Lexicon } from '../src/engine/index';
import { lexicon, rules } from './fixture';

test('the compiled list holds ENABLE as the engine loads it', () => {
  assert.equal(lexicon.count, 168548);
  assert.equal(lexicon.longestWord, 15);
  assert.ok(lexicon.hasFamiliarity);
  assert.ok(lexicon.contains('CAT'));
  assert.ok(lexicon.contains('zyzzyva'));
  assert.ok(!lexicon.contains('QI'));
  assert.ok(!lexicon.contains('ZA'));
  assert.ok(!lexicon.contains('A'));
  assert.equal(lexicon.wordAt(0), 'AA');
});

test('familiarity reads the way the bots expect', () => {
  assert.ok((lexicon.familiarityOf('HOUSE') ?? 0) >= 5);
  const obscure = lexicon.familiarityOf('ZOEAE');
  assert.ok(obscure === null || obscure === 0);
  const tenth = lexicon.familiarityThreshold(0.1);
  assert.ok(Math.abs(lexicon.shareAtOrAbove(tenth) - 0.1) < 0.03);
});

test('the list knows which letters end words and which cling', () => {
  const s = Alphabet.english.letter('S')!;
  const q = Alphabet.english.letter('Q')!;
  const u = Alphabet.english.letter('U')!;
  assert.ok(lexicon.endingShare[s] > 0.3);
  assert.deepEqual(lexicon.clinging, [{ letter: q, needs: u }]);
});

test('walking the trie that is not a trie', () => {
  const node = lexicon.nodeForPrefix(Alphabet.english.word('CA')!)!;
  const children = lexicon.childLetters(node).map((letter) => Alphabet.english.character(letter));
  assert.ok(children.includes('T'));
  assert.ok(!children.includes('Q'));
  assert.equal(lexicon.nodeForPrefix(Alphabet.english.word('ZZZ')!), null);
});

test('a hand-built list behaves like a compiled one', () => {
  const small = Lexicon.fromWords(['cat', 'CATS', 'act', 'at', 'cat'], Alphabet.english, new Map([['CAT', 5.2]]));
  assert.equal(small.count, 4);
  assert.ok(small.contains('CAT'));
  assert.ok(!small.contains('TAC'));
  assert.equal(small.familiarityOf('CAT'), 5.2);
  assert.equal(small.familiarityOf('ACT'), 0);
  assert.equal(rules.alphabet, small.alphabet);
});
