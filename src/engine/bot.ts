import type { Board } from './board';
import type { GameState, Move, PlayerConfig, TurnRecord } from './game';
import type { Language } from './language';
import { BLANK, type Letter, type Position, type Tile, boardIndex, comparePositions, placementTile } from './letters';
import type { Lexicon } from './lexicon';
import type { Play, SearchLimits } from './movegen';
import type { SeededGenerator } from './rng';
import type { GameRules } from './rules';

/** How hard a bot plays. The levels do not differ in how they *choose* among
 *  what they see — they all take the best play they can find, with a little
 *  randomness among near-equal ones. They differ in what they are able to
 *  find: vocabulary, tiles laid at once, and how much of the board they look
 *  at. */
export type BotLevel = 'novice' | 'learner' | 'improver' | 'casual' | 'club' | 'skilled' | 'expert';

export const BOT_LEVELS: readonly BotLevel[] = ['novice', 'learner', 'improver', 'casual', 'club', 'skilled', 'expert'];

export interface LevelInfo {
  id: BotLevel;
  name: string;
  /** Where this level is meant to sit on the leaderboard: seven evenly
   *  spaced bands, about 195 points apart. */
  targetRating: number;
  blurb: string;
  /** Most tiles this level will lay in one turn — a decision about the
   *  ladder, not something derived from its measured strength. */
  maximumTiles: number | null;
}

export const LEVELS: Record<BotLevel, LevelInfo> = {
  novice: { id: 'novice', name: 'Novice', targetRating: 830, maximumTiles: 3,
    blurb: 'Everyday words, three tiles at a time, misses a third of the board' },
  learner: { id: 'learner', name: 'Learner', targetRating: 1025, maximumTiles: 4,
    blurb: 'Everyday words, but will lay four tiles and looks a little harder' },
  improver: { id: 'improver', name: 'Improver', targetRating: 1220, maximumTiles: 5,
    blurb: 'A wider vocabulary and most of the board' },
  casual: { id: 'casual', name: 'Casual', targetRating: 1415, maximumTiles: 5,
    blurb: 'A decent vocabulary; will not find the clever spots' },
  club: { id: 'club', name: 'Club', targetRating: 1610, maximumTiles: 6,
    blurb: 'Knows the awkward words, sees nearly everything, keeps a tidy rack' },
  skilled: { id: 'skilled', name: 'Skilled', targetRating: 1805, maximumTiles: null,
    blurb: 'Knows most words, sees the whole board, plays its rack well' },
  expert: { id: 'expert', name: 'Expert', targetRating: 2000, maximumTiles: null,
    blurb: 'The whole dictionary and the best play it can find' },
};

/** Its place in the ladder, 0 for Novice: how a language's strengths and
 *  ratings are indexed. */
export function levelPosition(level: BotLevel): number {
  return BOT_LEVELS.indexOf(level);
}

export function isBotLevel(value: unknown): value is BotLevel {
  return typeof value === 'string' && (BOT_LEVELS as readonly string[]).includes(value);
}

/** The dials themselves. */
export interface BotProfile {
  /** How much of the word list this player has: 0.1 is the tenth of it they
   *  are likeliest to know, null the whole thing. */
  vocabulary: number | null;
  maximumTiles: number | null;
  boardAwareness: number;
  temperature: number;
  rackLeaveWeight: number;
  /** How much the premium squares count when choosing: 1 plays for them, 0
   *  never notices them. The board still pays out either way. */
  premiumAwareness: number;
}

/** A cap for a strength with no level attached. */
export function tileCap(strength: number): number | null {
  if (strength < 0.25) return 3;
  if (strength < 0.33) return 4;
  if (strength < 0.47) return 5;
  if (strength < 0.6) return 6;
  return null;
}

/** The dials for a point on the strength curve. Every dial moves together
 *  and monotonically, so a stronger level is stronger in every way a player
 *  can see. */
export function profileAt(strength: number, maximumTiles?: number | null): BotProfile {
  const s = Math.min(Math.max(strength, 0), 1);
  return {
    vocabulary: s >= 0.97 ? null : 0.012 + 0.75 * Math.pow(s, 2.2),
    maximumTiles: maximumTiles === undefined ? tileCap(s) : maximumTiles,
    boardAwareness: 0.41 + 0.59 * s,
    temperature: 5.0 * Math.pow(1 - s, 1.5),
    rackLeaveWeight: Math.pow(s, 1.2),
    premiumAwareness: Math.pow(s, 0.8),
  };
}

/** The shipped dials for a level: its strength in this language, and its
 *  tile cap. */
export function profileOf(level: BotLevel, language: Language): BotProfile {
  return profileAt(language.strength(level), LEVELS[level].maximumTiles);
}

export function describeProfile(profile: BotProfile): string {
  const words = profile.vocabulary === null ? 'all words' : `top ${Math.round(profile.vocabulary * 100)}% of words`;
  const tiles = profile.maximumTiles === null ? '7 tiles' : `${profile.maximumTiles} tiles`;
  return `${words}, ${tiles}, board ${Math.round(profile.boardAwareness * 100)}%, `
    + `temp ${profile.temperature.toFixed(2)}, leave ${profile.rackLeaveWeight.toFixed(2)}, `
    + `premiums ${Math.round(profile.premiumAwareness * 100)}%`;
}

/** Picks moves for a computer player. Pure: hand it a game and a generator
 *  and it returns a move. */
export class Bot {
  readonly profile: BotProfile;

  constructor(level: BotLevel, language: Language);
  constructor(profile: BotProfile);
  constructor(levelOrProfile: BotLevel | BotProfile, language?: Language) {
    if (typeof levelOrProfile === 'string') {
      if (!language) throw new Error('a level needs a language');
      this.profile = profileOf(levelOrProfile, language);
    } else {
      this.profile = levelOrProfile;
    }
  }

  chooseMove(state: GameState, rng: SeededGenerator): Move {
    const rack = state.currentPlayer.rack;
    const values = new RackValues(state.rules, state.lexicon);
    const limits = this.searchLimits(state.board, state.history[state.history.length - 1], state.lexicon, rng);
    const plays = state.moveGenerator.plays(state.board, rack, limits);
    if (plays.length === 0) return this.stuckMove(rack, state, values);

    const bagEmpty = state.tilesInBag === 0;
    const profile = this.profile;
    let best: { play: Play; value: number } | null = null;
    const scored: { play: Play; value: number }[] = [];
    for (const play of plays) {
      // What this player thinks the play is worth: the premium squares only
      // count as far as they notice them.
      const seenScore = play.flatScore + profile.premiumAwareness * (play.score - play.flatScore);
      const value = seenScore
        + profile.rackLeaveWeight * values.leaveValue(leave(rack, play))
        + (bagEmpty ? 2.0 * play.placements.length : 0)
        + (play.placements.length === rack.length && bagEmpty ? 15 : 0);
      scored.push({ play, value });
      if (best === null || value > best.value) best = { play, value };
    }
    if (best === null) return { type: 'pass' };
    if (profile.temperature <= 0) return { type: 'play', placements: best.play.placements };
    return { type: 'play', placements: this.sample(scored, best.value, rng).placements };
  }

  /** What this level can see this turn. */
  searchLimits(board: Board, lastPlay: TurnRecord | undefined, lexicon: Lexicon, rng: SeededGenerator): SearchLimits {
    const profile = this.profile;
    const limits: SearchLimits = {
      // A share of the list becomes the frequency that keeps that much of
      // it, which is the only form the generator understands.
      minimumFamiliarity: profile.vocabulary === null ? 0 : lexicon.familiarityThreshold(profile.vocabulary),
      maximumTiles: profile.maximumTiles,
    };
    if (profile.boardAwareness >= 1 || board.isEmpty) return limits;
    const anchors = board.anchors();
    // Whatever just landed is in plain sight; the rest of the board is
    // scanned only in part.
    const visible = new Set<number>();
    if (lastPlay && lastPlay.action.type === 'played') {
      for (const placement of lastPlay.action.play.placements) {
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const position: Position = { x: placement.position.x + dx, y: placement.position.y + dy };
          if (position.x >= 0 && position.y >= 0 && position.x < 15 && position.y < 15) visible.add(boardIndex(position));
        }
      }
    }
    const candidates = [...anchors].sort(comparePositions);
    rng.shuffle(candidates);
    const keep = Math.max(1, Math.round(candidates.length * profile.boardAwareness));
    for (const position of candidates.slice(0, keep)) visible.add(boardIndex(position));
    limits.anchors = visible;
    return limits;
  }

  /** Softmax over the play values: near-equal plays come up about equally
   *  often, clearly worse ones almost never. */
  private sample(scored: { play: Play; value: number }[], best: number, rng: SeededGenerator): Play {
    const temperature = this.profile.temperature;
    const weights: number[] = [];
    let total = 0;
    for (const entry of scored) {
      const gap = best - entry.value;
      const weight = gap > 8 * temperature ? 0 : Math.exp(-gap / temperature);
      weights.push(weight);
      total += weight;
    }
    if (total <= 0) return scored[0].play;
    let cut = rng.nextDouble() * total;
    for (let index = 0; index < weights.length; index += 1) {
      cut -= weights[index];
      if (cut <= 0) return scored[index].play;
    }
    return scored[scored.length - 1].play;
  }

  /** No play available: exchange if the bag allows it, otherwise pass. */
  private stuckMove(rack: readonly Tile[], state: GameState, values: RackValues): Move {
    if (!state.canExchange || rack.length === 0) return { type: 'pass' };
    const ranked = [...rack].sort((a, b) => values.keepValue(a) - values.keepValue(b));
    const count = Math.max(1, Math.min(rack.length, Math.floor((rack.length + 1) / 2) + 1));
    return { type: 'exchange', tiles: ranked.slice(0, count) };
  }
}

function leave(rack: readonly Tile[], play: Play): Tile[] {
  const remaining = [...rack];
  for (const placement of play.placements) {
    const index = remaining.indexOf(placementTile(placement));
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

/** What the tiles on a rack are worth keeping, worked out from the language
 *  instead of from a table of good letters: many in the bag, words end in
 *  it, and cheap. */
export class RackValues {
  private readonly keep: number[];
  private readonly vowels: ReadonlySet<Letter>;
  private readonly clinging: readonly { letter: Letter; needs: Letter }[];
  private readonly alphabetSize: number;

  static readonly blankKeepValue = 10.0;

  constructor(rules: GameRules, lexicon: Lexicon) {
    const size = rules.alphabet.count;
    const mostCommon = Math.max(1, ...rules.letterCounts);
    const keep = new Array<number>(size).fill(0);
    for (let index = 0; index < size; index += 1) {
      const inBag = rules.letterCounts[index] / mostCommon;
      const endings = index < lexicon.endingShare.length ? lexicon.endingShare[index] : 0;
      const value = rules.letterValues[index];
      keep[index] = Math.min(9, Math.max(0.5, 2 + 4 * inBag + 5 * endings - 0.35 * (value - 1)));
    }
    this.keep = keep;
    this.vowels = rules.alphabet.vowels;
    this.clinging = lexicon.clinging;
    this.alphabetSize = size;
  }

  keepValue(tile: Tile): number {
    return tile === BLANK ? RackValues.blankKeepValue : this.keep[tile];
  }

  /** A rough score for the tiles a play leaves on the rack: balance beats
   *  hoarding, blanks and hooking letters are worth keeping, and a letter
   *  that needs a partner it has not got hurts. */
  leaveValue(leftover: readonly Tile[]): number {
    if (leftover.length === 0) return 0;
    let value = 0;
    const counts = new Array<number>(this.alphabetSize).fill(0);
    let blanks = 0;
    let vowelCount = 0;
    for (const tile of leftover) {
      if (tile === BLANK) {
        blanks += 1;
      } else {
        counts[tile] += 1;
        if (this.vowels.has(tile)) vowelCount += 1;
        value += 0.25 * this.keep[tile];
      }
    }
    value += 3.0 * blanks;
    const letters = leftover.length - blanks;
    if (letters > 0) {
      // Around two fifths vowels reads best.
      const ideal = letters * 0.4;
      value -= 1.2 * Math.abs(vowelCount - ideal);
    }
    for (const count of counts) if (count > 1) value -= 1.5 * (count - 1);
    for (const { letter, needs } of this.clinging) {
      if (counts[letter] > 0 && counts[needs] === 0 && blanks === 0) value -= 5;
    }
    return value;
  }
}

// MARK: - Names

/** Names for computer players, so a game reads like a game against people
 *  rather than against "Bot 2". */
export const BotNames = {
  first: [
    'Ada', 'Bea', 'Cal', 'Dot', 'Eli', 'Fay', 'Gus', 'Hal', 'Ida', 'Jo',
    'Kit', 'Lou', 'Mae', 'Ned', 'Oona', 'Pim', 'Quin', 'Roz', 'Sid', 'Tess',
    'Uma', 'Vic', 'Wes', 'Xan', 'Yves', 'Zed', 'Marlo', 'Nessa', 'Ollie', 'Pearl',
  ],
  last: [
    'Ames', 'Briggs', 'Cole', 'Doyle', 'Ervin', 'Flint', 'Gage', 'Hollis',
    'Ives', 'Kerr', 'Lowe', 'Mercer', 'Nye', 'Oakes', 'Pike', 'Royce',
    'Sands', 'Thorne', 'Vance', 'Welles',
  ],

  /** A distinct display name, avoiding anything in `taken`. */
  name(rng: SeededGenerator, taken: ReadonlySet<string> = new Set()): string {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = `${BotNames.first[rng.nextInt(BotNames.first.length)]} ${BotNames.last[rng.nextInt(BotNames.last.length)]}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `Bot ${100 + rng.nextInt(900)}`;
  },

  /** A roster of bot opponents at the given levels. */
  roster(levels: readonly BotLevel[], rng: SeededGenerator, taken: ReadonlySet<string> = new Set()): PlayerConfig[] {
    const used = new Set(taken);
    return levels.map((level) => {
      const name = BotNames.name(rng, used);
      used.add(name);
      return { name, level };
    });
  },
};
