import { Alphabet } from './alphabet';
import { BoardLayout } from './board';
import { BOT_LEVELS, type BotLevel, levelPosition } from './bot';
import { Lexicon } from './lexicon';
import { GameRules } from './rules';

export type LanguageCode = 'en' | 'uk';

/** What a calibration run measured, kept for the record: the rating per
 *  level, in `BOT_LEVELS` order, anchored on Expert at 2000. */
export interface Calibration {
  date: string;
  rounds: number;
  games: number;
  ratings: readonly number[];
}

/** Everything that differs between languages, short of the two data files.
 *  The engine itself knows nothing about any of them. */
export interface LanguageSpec {
  code: LanguageCode;
  englishName: string;
  nativeName: string;
  /** What the game itself is called in this language. Only Ukrainian
   *  differs: there has never been a Ukrainian Scrabble edition, and the game
   *  played there is Ерудит. */
  gameName: string;
  alphabet: Alphabet;
  wordListName: string;
  wordListLicence: string;
  /** Where each bot level sits on the strength curve, in `BOT_LEVELS` order.
   *  Measured per language: the same dials do not produce the same rating
   *  gap in a language with sixteen times the words. */
  botStrengths: readonly number[];
  calibration: Calibration;
}

export const LANGUAGE_SPECS: Record<LanguageCode, LanguageSpec> = {
  en: {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    gameName: 'Matrix Game',
    alphabet: Alphabet.english,
    wordListName: 'ENABLE',
    wordListLicence: 'public domain',
    // Measured 2026-10-13: `matrixgame calibrate --language en`, four rounds
    // of 4,184 games, worst band off by 70.
    botStrengths: [0.287, 0.323, 0.371, 0.46, 0.57, 0.709, 1.0],
    calibration: { date: '2026-10-13', rounds: 4, games: 4184, ratings: [780, 1000, 1225, 1417, 1586, 1810, 2000] },
  },
  uk: {
    code: 'uk',
    englishName: 'Ukrainian',
    nativeName: 'Ерудит',
    gameName: 'Ерудит',
    alphabet: Alphabet.ukrainian,
    wordListName: 'VESUM (dict_uk) 6.8.6',
    wordListLicence: 'MPL 1.1',
    // Measured 2026-10-13: `matrixgame calibrate --language uk`, four rounds
    // of 4,184 games, worst band off by 47. Every dial bites harder here
    // than in English — there is more to find on a Ukrainian board — so the
    // same ladder needs lower numbers.
    botStrengths: [0.228, 0.257, 0.306, 0.376, 0.485, 0.552, 1.0],
    calibration: { date: '2026-10-13', rounds: 4, games: 4184, ratings: [832, 1036, 1215, 1405, 1620, 1767, 2000] },
  },
};

export const LANGUAGE_CODES: readonly LanguageCode[] = ['en', 'uk'];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/** A language with its tiles and its word list loaded: what a game needs. */
export class Language implements LanguageSpec {
  readonly code: LanguageCode;
  readonly englishName: string;
  readonly nativeName: string;
  readonly gameName: string;
  readonly alphabet: Alphabet;
  readonly wordListName: string;
  readonly wordListLicence: string;
  readonly botStrengths: readonly number[];
  readonly calibration: Calibration;
  readonly rules: GameRules;
  readonly lexicon: Lexicon;

  /** - `boardText`: `Board.txt`, the same for every language.
   *  - `tilesText`: the language's `Tiles.txt`.
   *  - `compiledWords`: its `Words.lex.gz`, already inflated. */
  constructor(spec: LanguageSpec, boardText: string, tilesText: string, compiledWords: Uint8Array) {
    if (spec.botStrengths.length !== BOT_LEVELS.length || spec.calibration.ratings.length !== BOT_LEVELS.length) {
      throw new Error(`${spec.code} needs one strength and one rating per bot level`);
    }
    this.code = spec.code;
    this.englishName = spec.englishName;
    this.nativeName = spec.nativeName;
    this.gameName = spec.gameName;
    this.alphabet = spec.alphabet;
    this.wordListName = spec.wordListName;
    this.wordListLicence = spec.wordListLicence;
    this.botStrengths = spec.botStrengths;
    this.calibration = spec.calibration;
    const layout = BoardLayout.parse(boardText);
    this.rules = GameRules.fromTileTable(tilesText, spec.alphabet, layout);
    this.lexicon = Lexicon.fromCompiled(compiledWords, spec.alphabet);
  }

  strength(level: BotLevel): number {
    return this.botStrengths[levelPosition(level)];
  }

  /** What the calibration run measured for this level here. */
  rating(level: BotLevel): number {
    return this.calibration.ratings[levelPosition(level)];
  }
}
