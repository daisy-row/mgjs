import { Board } from './board';
import type { BotLevel } from './bot';
import { BLANK, type Placement, type Tile, placementTile } from './letters';
import type { Lexicon } from './lexicon';
import { MoveGenerator, type Play } from './movegen';
import { SeededGenerator, randomSeed } from './rng';
import type { GameRules } from './rules';
import { Scoring, type ScoredPlay } from './scoring';
import { type PlayError, type Validation, describePlayError, validatePlay } from './validation';

export interface PlayerConfig {
  name: string;
  /** Null for a person. */
  level: BotLevel | null;
}

export interface Player {
  id: number;
  name: string;
  level: BotLevel | null;
  score: number;
  rack: Tile[];
  hasResigned: boolean;
}

export type Move =
  | { type: 'play'; placements: Placement[] }
  | { type: 'exchange'; tiles: Tile[] }
  | { type: 'pass' }
  | { type: 'resign' };

export type TurnAction =
  | { type: 'played'; play: ScoredPlay }
  | { type: 'exchanged'; count: number }
  | { type: 'passed' }
  | { type: 'resigned' };

export interface TurnRecord {
  id: number;
  playerIndex: number;
  playerName: string;
  action: TurnAction;
  score: number;
  totalAfter: number;
}

export function turnSummary(record: TurnRecord): string {
  const action = record.action;
  switch (action.type) {
    case 'played': {
      const words = action.play.words.map((word) => word.text).join(' / ');
      return action.play.bingo ? `${words} +bingo` : words;
    }
    case 'exchanged':
      return `exchanged ${action.count} tile${action.count === 1 ? '' : 's'}`;
    case 'passed':
      return 'passed';
    case 'resigned':
      return 'resigned';
  }
}

export type OutcomeReason = 'playedOut' | 'scorelessTurns' | 'resignations';

export function describeReason(reason: OutcomeReason): string {
  switch (reason) {
    case 'playedOut': return 'played out';
    case 'scorelessTurns': return 'no more plays';
    case 'resignations': return 'everyone else resigned';
  }
}

export interface Outcome {
  reason: OutcomeReason;
  winners: number[];
  adjustments: number[];
  finalScores: number[];
}

export type GameErrorKind =
  | { code: 'gameOver' }
  | { code: 'illegalPlay'; error: PlayError }
  | { code: 'notEnoughTilesToExchange'; inBag: number; needed: number }
  | { code: 'tilesNotOnRack' }
  | { code: 'nothingToExchange' };

export class GameError extends Error {
  constructor(readonly kind: GameErrorKind) {
    super(describeGameError(kind));
    this.name = 'GameError';
  }
}

export function describeGameError(kind: GameErrorKind): string {
  switch (kind.code) {
    case 'gameOver': return 'The game is over.';
    case 'illegalPlay': return describePlayError(kind.error);
    case 'notEnoughTilesToExchange':
      return `Exchanging needs ${kind.needed} tiles in the bag; there are ${kind.inBag}.`;
    case 'tilesNotOnRack': return 'Those tiles are not on the rack.';
    case 'nothingToExchange': return 'No tiles were chosen to exchange.';
  }
}

/** What a game looks like written down, so it survives a page reload. */
export interface SavedGame {
  version: 1;
  seed: string;
  rng: string;
  startedAt: string;
  board: { letters: number[]; blanks: number[] };
  players: Player[];
  bag: Tile[];
  currentPlayerIndex: number;
  turnNumber: number;
  scorelessStreak: number;
  history: TurnRecord[];
  outcome: Outcome | null;
}

/** A whole game: board, bag, racks, scores and whose turn it is. */
export class GameState {
  readonly rules: GameRules;
  readonly lexicon: Lexicon;
  readonly seed: bigint;
  readonly startedAt: Date;

  board: Board;
  players: Player[];
  bag: Tile[];
  currentPlayerIndex: number;
  turnNumber: number;
  scorelessStreak: number;
  history: TurnRecord[];
  outcome: Outcome | null;

  private rng: SeededGenerator;

  constructor(
    configs: readonly PlayerConfig[],
    rules: GameRules,
    lexicon: Lexicon,
    seed?: bigint | null,
    saved?: SavedGame,
  ) {
    if (rules.alphabet !== lexicon.alphabet) throw new Error('the tiles and the word list are in different alphabets');
    this.rules = rules;
    this.lexicon = lexicon;
    if (saved) {
      // A game written down earlier, picked up where it was.
      if (saved.version !== 1) throw new Error('saved game is from another version');
      this.seed = BigInt(saved.seed);
      this.rng = new SeededGenerator(BigInt(saved.rng));
      this.startedAt = new Date(saved.startedAt);
      this.board = Board.deserialize(rules.layout, saved.board);
      this.players = saved.players.map((player) => ({ ...player, rack: [...player.rack] }));
      this.bag = [...saved.bag];
      this.currentPlayerIndex = saved.currentPlayerIndex;
      this.turnNumber = saved.turnNumber;
      this.scorelessStreak = saved.scorelessStreak;
      this.history = saved.history;
      this.outcome = saved.outcome;
      return;
    }
    if (configs.length < 2) throw new Error('a game needs at least two players');
    this.seed = seed ?? randomSeed();
    this.rng = new SeededGenerator(this.seed);
    this.startedAt = new Date();
    this.board = new Board(rules.layout);
    this.bag = rules.fullBag();
    this.players = configs.map((config, index) => ({
      id: index,
      name: config.name,
      level: config.level,
      score: 0,
      rack: [],
      hasResigned: false,
    }));
    this.currentPlayerIndex = 0;
    this.turnNumber = 1;
    this.scorelessStreak = 0;
    this.history = [];
    this.outcome = null;
    this.rng.shuffle(this.bag);
    this.currentPlayerIndex = this.drawForFirstTurn();
    this.dealOpeningRacks();
  }

  // MARK: - Reading the game

  get currentPlayer(): Player {
    return this.players[this.currentPlayerIndex];
  }

  get isOver(): boolean {
    return this.outcome !== null;
  }

  get tilesInBag(): number {
    return this.bag.length;
  }

  get activePlayerIndices(): number[] {
    return this.players.map((player, index) => (player.hasResigned ? -1 : index)).filter((index) => index >= 0);
  }

  get moveGenerator(): MoveGenerator {
    return new MoveGenerator(this.rules, this.lexicon);
  }

  validate(placements: readonly Placement[]): Validation {
    return validatePlay(placements, this.board, this.currentPlayer.rack, this.rules, this.lexicon);
  }

  /** Every play the given player (the current one by default) could make. */
  legalPlays(playerIndex?: number): Play[] {
    const index = playerIndex ?? this.currentPlayerIndex;
    return this.moveGenerator.plays(this.board, this.players[index].rack);
  }

  bestPlay(playerIndex?: number): Play | null {
    const index = playerIndex ?? this.currentPlayerIndex;
    return this.moveGenerator.bestPlay(this.board, this.players[index].rack);
  }

  get canExchange(): boolean {
    return this.bag.length >= this.rules.minimumBagForExchange;
  }

  // MARK: - Playing

  apply(move: Move): TurnRecord {
    if (this.isOver) throw new GameError({ code: 'gameOver' });
    switch (move.type) {
      case 'play': return this.applyPlay(move.placements);
      case 'exchange': return this.applyExchange(move.tiles);
      case 'pass': return this.applyPass();
      case 'resign': return this.applyResign();
    }
  }

  private applyPlay(placements: readonly Placement[]): TurnRecord {
    const result = this.validate(placements);
    if (!result.ok) throw new GameError({ code: 'illegalPlay', error: result.error });
    const scored = result.play;
    const index = this.currentPlayerIndex;
    const player = this.players[index];
    this.board.apply(scored.placements);
    for (const placement of scored.placements) {
      const rackIndex = player.rack.indexOf(placementTile(placement));
      if (rackIndex >= 0) player.rack.splice(rackIndex, 1);
    }
    player.score += scored.score;
    this.refillRack(index);
    this.scorelessStreak = 0;
    const record = this.appendRecord(index, { type: 'played', play: scored }, scored.score);
    if (this.bag.length === 0 && player.rack.length === 0) this.finish('playedOut', index);
    else this.advanceTurn();
    return record;
  }

  private applyExchange(tiles: readonly Tile[]): TurnRecord {
    if (tiles.length === 0) throw new GameError({ code: 'nothingToExchange' });
    if (this.bag.length < this.rules.minimumBagForExchange) {
      throw new GameError({ code: 'notEnoughTilesToExchange', inBag: this.bag.length, needed: this.rules.minimumBagForExchange });
    }
    const index = this.currentPlayerIndex;
    const rack = [...this.players[index].rack];
    for (const tile of tiles) {
      const rackIndex = rack.indexOf(tile);
      if (rackIndex < 0) throw new GameError({ code: 'tilesNotOnRack' });
      rack.splice(rackIndex, 1);
    }
    this.players[index].rack = rack;
    // The drawn tiles come out before the returned ones go back in, so a
    // player cannot draw back the tile they just threw away.
    this.refillRack(index);
    this.bag.push(...tiles);
    this.rng.shuffle(this.bag);
    this.scorelessStreak += 1;
    const record = this.appendRecord(index, { type: 'exchanged', count: tiles.length }, 0);
    this.endIfEveryoneIsStuck();
    if (!this.isOver) this.advanceTurn();
    return record;
  }

  private applyPass(): TurnRecord {
    const index = this.currentPlayerIndex;
    this.scorelessStreak += 1;
    const record = this.appendRecord(index, { type: 'passed' }, 0);
    this.endIfEveryoneIsStuck();
    if (!this.isOver) this.advanceTurn();
    return record;
  }

  private applyResign(): TurnRecord {
    const index = this.currentPlayerIndex;
    this.players[index].hasResigned = true;
    const record = this.appendRecord(index, { type: 'resigned' }, 0);
    if (this.activePlayerIndices.length < 2) this.finish('resignations', null);
    else this.advanceTurn();
    return record;
  }

  // MARK: - Turn plumbing

  private appendRecord(playerIndex: number, action: TurnAction, score: number): TurnRecord {
    const record: TurnRecord = {
      id: this.history.length + 1,
      playerIndex,
      playerName: this.players[playerIndex].name,
      action,
      score,
      totalAfter: this.players[playerIndex].score,
    };
    this.history.push(record);
    return record;
  }

  private advanceTurn(): void {
    if (this.activePlayerIndices.length === 0) return;
    let next = this.currentPlayerIndex;
    do {
      next = (next + 1) % this.players.length;
    } while (this.players[next].hasResigned);
    this.currentPlayerIndex = next;
    this.turnNumber += 1;
  }

  private endIfEveryoneIsStuck(): void {
    const active = Math.max(this.activePlayerIndices.length, 1);
    if (this.scorelessStreak >= active * this.rules.scorelessTurnsPerPlayerToEnd) this.finish('scorelessTurns', null);
  }

  private finish(reason: OutcomeReason, finisher: number | null): void {
    const active = this.players.map((player) => !player.hasResigned);
    let adjustments = new Array<number>(this.players.length).fill(0);
    if (reason === 'playedOut') {
      adjustments = Scoring.finalAdjustments(
        this.players.map((player) => player.rack),
        active,
        finisher,
        this.rules,
      );
      this.players.forEach((player, index) => {
        player.score += adjustments[index];
      });
    }
    const scores = this.players.map((player) => player.score);
    let best = Number.NEGATIVE_INFINITY;
    let winners: number[] = [];
    this.players.forEach((_, index) => {
      if (!active[index]) return;
      if (scores[index] > best) {
        best = scores[index];
        winners = [index];
      } else if (scores[index] === best) {
        winners.push(index);
      }
    });
    this.outcome = { reason, winners, adjustments, finalScores: scores };
  }

  private refillRack(index: number): void {
    const player = this.players[index];
    while (player.rack.length < this.rules.rackSize && this.bag.length > 0) {
      player.rack.push(this.bag.pop() as Tile);
    }
  }

  private dealOpeningRacks(): void {
    for (let offset = 0; offset < this.players.length; offset += 1) {
      this.refillRack((this.currentPlayerIndex + offset) % this.players.length);
    }
  }

  /** Everyone draws a tile; closest to A plays first, ties draw again. The
   *  original game did it this way, and it is a nice touch to keep. */
  private drawForFirstTurn(): number {
    let candidates = this.players.map((_, index) => index);
    let guard = 0;
    while (candidates.length > 1 && guard < 16) {
      guard += 1;
      const drawn: { index: number; tile: Tile }[] = [];
      for (const index of candidates) {
        if (this.bag.length === 0) break;
        drawn.push({ index, tile: this.bag.pop() as Tile });
      }
      if (drawn.length === 0) break;
      const rank = (tile: Tile): number => (tile === BLANK ? 99 : tile);
      const best = Math.min(...drawn.map((entry) => rank(entry.tile)));
      const winners = drawn.filter((entry) => rank(entry.tile) === best).map((entry) => entry.index);
      for (const entry of drawn) this.bag.push(entry.tile);
      this.rng.shuffle(this.bag);
      candidates = winners;
    }
    return candidates[0] ?? 0;
  }

  /** Replaces a player's rack. For tests; a real game never needs it. */
  debugSetRack(index: number, rack: Tile[]): void {
    this.players[index].rack = rack;
  }

  // MARK: - Saving and restoring

  save(): SavedGame {
    return {
      version: 1,
      seed: this.seed.toString(),
      rng: this.rng.state.toString(),
      startedAt: this.startedAt.toISOString(),
      board: this.board.serialize(),
      players: this.players.map((player) => ({ ...player, rack: [...player.rack] })),
      bag: [...this.bag],
      currentPlayerIndex: this.currentPlayerIndex,
      turnNumber: this.turnNumber,
      scorelessStreak: this.scorelessStreak,
      history: this.history,
      outcome: this.outcome,
    };
  }

  static restore(saved: SavedGame, rules: GameRules, lexicon: Lexicon): GameState {
    return new GameState([], rules, lexicon, null, saved);
  }
}

/** Plays a game out with bots, for tests and quick experiments. */
export function playOut(
  state: GameState,
  rng: SeededGenerator,
  chooser: (state: GameState, rng: SeededGenerator) => Move,
  turnLimit = 500,
  onTurn?: (state: GameState, record: TurnRecord) => void,
): Outcome | null {
  let turns = 0;
  while (!state.isOver && turns < turnLimit) {
    turns += 1;
    const move = chooser(state, rng);
    try {
      const record = state.apply(move);
      onTurn?.(state, record);
    } catch {
      // A bot proposed something illegal; passing keeps the game moving.
      try {
        const record = state.apply({ type: 'pass' });
        onTurn?.(state, record);
      } catch {
        break;
      }
    }
  }
  return state.outcome;
}
