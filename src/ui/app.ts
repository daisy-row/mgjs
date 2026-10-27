// The client. It knows how to draw a board and what a click means, and it
// holds the game: there is no service behind this page. Every move goes to
// the engine in the same tab, the bots answer in the same tab, and the
// position is written to localStorage so a reload picks it up.
import {
  BLANK,
  BOT_LEVELS,
  Bot,
  BotNames,
  GameError,
  GameState,
  LANGUAGE_CODES,
  LANGUAGE_SPECS,
  LEVELS,
  SIZE,
  SeededGenerator,
  type BotLevel,
  type Language,
  type LanguageCode,
  type LanguageSpec,
  type Move,
  type Placement,
  type SavedGame,
  type TurnRecord,
  boardIndex,
  describeReason,
  isBotLevel,
  isLanguageCode,
  parseSeed,
  premiumClass,
  premiumLabel,
  profileAt,
  turnSummary,
} from '../engine/index';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`no element #${id}`);
  return element as T;
};

const STORAGE_NAME = 'matrixgame.name';
const STORAGE_GAME = 'matrixgame.game';
const STORAGE_LEVELS = 'matrixgame.levels';
const STORAGE_LANGUAGE = 'matrixgame.language';

/** One game as this page keeps it between moves. */
interface Session {
  language: Language;
  state: GameState;
  playerName: string;
  /** Board indexes the most recent play put down, so the board can show them. */
  fresh: number[];
  /** What happened since the player last moved, in words: the bots' turns. */
  notes: string[];
}

interface SavedSession {
  language: LanguageCode;
  game: SavedGame;
  playerName: string;
  fresh: number[];
  notes: string[];
}

/** A tile the player has put on the board but not played yet. */
interface Pending {
  x: number;
  y: number;
  letter: string;
  blank: boolean;
  rackIndex: number;
}

const remembered = {
  get name(): string {
    try { return localStorage.getItem(STORAGE_NAME) ?? ''; } catch { return ''; }
  },
  set name(value: string) {
    try { localStorage.setItem(STORAGE_NAME, value); } catch { /* private window */ }
  },
  get language(): LanguageCode {
    try {
      const code = localStorage.getItem(STORAGE_LANGUAGE);
      return isLanguageCode(code) ? code : 'en';
    } catch { return 'en'; }
  },
  set language(value: LanguageCode) {
    try { localStorage.setItem(STORAGE_LANGUAGE, value); } catch { /* private window */ }
  },
  get levels(): BotLevel[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_LEVELS) ?? 'null');
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isBotLevel)) return parsed;
    } catch { /* fall through */ }
    return ['casual'];
  },
  set levels(value: BotLevel[]) {
    try { localStorage.setItem(STORAGE_LEVELS, JSON.stringify(value)); } catch { /* private window */ }
  },
  get game(): SavedSession | null {
    try {
      const text = localStorage.getItem(STORAGE_GAME);
      return text ? (JSON.parse(text) as SavedSession) : null;
    } catch { return null; }
  },
  set game(value: SavedSession | null) {
    try {
      if (value) localStorage.setItem(STORAGE_GAME, JSON.stringify(value));
      else localStorage.removeItem(STORAGE_GAME);
    } catch { /* private window */ }
  },
};

export type LanguageLoader = (code: LanguageCode) => Promise<Language>;

export function startApp(loadLanguage: LanguageLoader): void {
  let session: Session | null = null;
  let chosenCode: LanguageCode = remembered.language;
  const chosenSpec = (): LanguageSpec => LANGUAGE_SPECS[chosenCode];
  let opponents: BotLevel[] = remembered.levels;
  let pending: Pending[] = [];
  let picked: number | null = null;   // the rack tile in hand, by its place on the rack
  let cursor: { x: number; y: number } | null = null; // where typing would put the next letter
  let across = true;
  let swapping = false;
  const marked = new Set<number>();
  let resignArmed = false;
  let abandonArmed = false;         // New game, mid-game, asks twice as Resign does
  let thinking = false;               // a bot is choosing; the buttons wait
  let refused: string | null = null;  // the engine's answer to an illegal move

  const human = 0;                    // the person always takes the first seat

  // MARK: - Starting a game

  function drawLanguages(): void {
    const select = el<HTMLSelectElement>('language');
    select.replaceChildren();
    for (const code of LANGUAGE_CODES) {
      const spec = LANGUAGE_SPECS[code];
      const option = document.createElement('option');
      option.value = code;
      option.textContent = `${spec.englishName} — ${spec.nativeName}`;
      select.append(option);
    }
    select.value = chosenCode;
    select.addEventListener('change', () => {
      if (isLanguageCode(select.value)) chosenCode = select.value;
      remembered.language = chosenCode;
      describeLanguage();
      drawOpponents();
      drawLadder();
      drawTitle();
    });
    describeLanguage();
  }

  const WORD_COUNTS: Record<LanguageCode, number> = { en: 168548, uk: 2746623 };

  function describeLanguage(): void {
    const spec = chosenSpec();
    el('language-note').textContent =
      `${WORD_COUNTS[spec.code].toLocaleString()} words · ${spec.wordListName}, ${spec.wordListLicence}`
      + (spec.code === 'en' ? '' : ' · fetched when you start, 2.5 MB');
  }

  /** The game's name in the language on the board: Ukrainian plays Ерудит,
   *  the rest play Matrix Game. Before a game it follows the picker, after
   *  it the board. */
  function drawTitle(): void {
    const name = session ? session.language.gameName : chosenSpec().gameName;
    document.title = name;
    el('title').textContent = name;
  }

  function drawFooter(): void {
    const language = session?.language;
    el('footer-note').textContent = language
      ? `${language.englishName} · ${language.lexicon.count.toLocaleString()} words · ${language.wordListName}, `
        + `${language.wordListLicence} · a bingo is worth ${language.rules.bingoBonus} · the game stays in this browser`
      : 'The game stays in this browser: nothing is sent anywhere.';
  }

  function drawLadder(): void {
    const spec = chosenSpec();
    el('ladder-note').textContent =
      'Each level is one number on a strength curve, tuned until a corpus of '
      + `${spec.calibration.games.toLocaleString()} bot-against-bot games put it on its band. The ratings are Elo, `
      + `anchored on Expert at 2000; this is the ladder measured for ${spec.englishName} on ${spec.calibration.date}.`;
    const table = el('ladder');
    table.replaceChildren();
    const head = document.createElement('tr');
    for (const title of ['Level', 'Band', 'Measured', 'Vocabulary', 'Tiles', 'Board']) {
      const cell = document.createElement('th');
      cell.textContent = title;
      if (title !== 'Level') cell.className = 'n';
      head.append(cell);
    }
    table.append(head);
    BOT_LEVELS.forEach((level, position) => {
      const info = LEVELS[level];
      const profile = profileAt(spec.botStrengths[position], info.maximumTiles);
      const row = document.createElement('tr');
      const cells = [
        info.name,
        String(info.targetRating),
        String(spec.calibration.ratings[position]),
        profile.vocabulary === null ? 'all words' : `top ${Math.round(profile.vocabulary * 100)}%`,
        profile.maximumTiles === null ? '7' : String(profile.maximumTiles),
        `${Math.round(profile.boardAwareness * 100)}%`,
      ];
      cells.forEach((text, index) => {
        const cell = document.createElement('td');
        cell.textContent = text;
        cell.className = index === 0 ? 'lvl' : 'n';
        row.append(cell);
      });
      table.append(row);
    });
  }

  function drawOpponents(): void {
    const ratings = chosenSpec().calibration.ratings;
    const box = el('opponents');
    box.replaceChildren();
    opponents.forEach((level, index) => {
      const row = document.createElement('div');
      row.className = 'opponent';

      const select = document.createElement('select');
      BOT_LEVELS.forEach((option, position) => {
        const item = document.createElement('option');
        item.value = option;
        item.textContent = `${LEVELS[option].name} · ${ratings[position]}`;
        select.append(item);
      });
      select.value = level;
      select.addEventListener('change', () => {
        if (isBotLevel(select.value)) opponents[index] = select.value;
        drawOpponents();
      });
      row.append(select);

      const blurb = document.createElement('span');
      blurb.className = 'blurb';
      blurb.textContent = LEVELS[level].blurb;
      row.append(blurb);

      if (opponents.length > 1) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '−';
        remove.title = 'Remove this opponent';
        remove.addEventListener('click', () => {
          opponents.splice(index, 1);
          drawOpponents();
        });
        row.append(remove);
      }
      box.append(row);
    });
    el('add-opponent').hidden = opponents.length >= 3;
  }

  function showStart(why = ''): void {
    session = null;
    el('game').hidden = true;
    el('start').hidden = false;
    el('start-error').textContent = why;
    el('start-error').hidden = !why;
    drawTitle();
    drawFooter();
  }

  function startButton(loading: boolean): void {
    const button = el<HTMLButtonElement>('begin');
    button.disabled = loading;
    button.textContent = loading ? `Loading the ${chosenSpec().englishName} word list…` : 'Start';
  }

  async function begin(): Promise<void> {
    const name = el<HTMLInputElement>('name').value.trim() || 'You';
    remembered.name = name;
    remembered.levels = opponents;
    remembered.language = chosenCode;
    el('start-error').hidden = true;
    const seedText = el<HTMLInputElement>('seed').value;
    const seed = seedText.trim() ? parseSeed(seedText) : null;
    if (seedText.trim() && seed === null) {
      el('start-error').textContent = 'A seed is a whole number, up to 18446744073709551615.';
      el('start-error').hidden = false;
      return;
    }
    startButton(true);
    try {
      const language = await loadLanguage(chosenCode);
      const naming = seed === null ? SeededGenerator.random() : new SeededGenerator(seed);
      const bots = BotNames.roster(opponents, naming, new Set([name]));
      const state = new GameState([{ name, level: null }, ...bots], language.rules, language.lexicon, seed);
      adopt({ language, state, playerName: name, fresh: [], notes: [] });
      save();
      void runBots();
    } catch (error) {
      el('start-error').textContent = error instanceof Error ? error.message : String(error);
      el('start-error').hidden = false;
    } finally {
      startButton(false);
    }
  }

  // MARK: - Keeping the game

  function save(): void {
    if (!session) {
      remembered.game = null;
      return;
    }
    remembered.game = {
      language: session.language.code,
      game: session.state.save(),
      playerName: session.playerName,
      fresh: session.fresh,
      notes: session.notes,
    };
  }

  async function resume(): Promise<boolean> {
    const saved = remembered.game;
    if (!saved || !isLanguageCode(saved.language)) return false;
    try {
      el('loading').textContent = `Loading the ${LANGUAGE_SPECS[saved.language].englishName} word list…`;
      const language = await loadLanguage(saved.language);
      const state = GameState.restore(saved.game, language.rules, language.lexicon);
      adopt({ language, state, playerName: saved.playerName, fresh: saved.fresh ?? [], notes: saved.notes ?? [] });
      void runBots();
      return true;
    } catch {
      remembered.game = null;
      return false;
    }
  }

  function adopt(next: Session): void {
    session = next;
    pending = [];
    picked = null;
    cursor = null;
    swapping = false;
    marked.clear();
    resignArmed = false;
    abandonArmed = false;
    refused = null;
    el('start').hidden = true;
    el('game').hidden = false;
    drawTitle();
    drawFooter();
    draw();
  }

  // MARK: - Drawing

  function pendingAt(x: number, y: number): Pending | undefined {
    return pending.find((tile) => tile.x === x && tile.y === y);
  }

  function yourTurn(): boolean {
    return !!session && !session.state.isOver && session.state.currentPlayerIndex === human && !thinking;
  }

  function show(error: string | null): void {
    const box = el('error');
    box.textContent = error ?? '';
    box.hidden = !error;
  }

  function draw(): void {
    if (!session) return;
    const { state } = session;
    show(refused);
    drawBoard();
    drawRack();
    drawPlayers();
    drawHistory();

    const bag = state.tilesInBag;
    el('bag').textContent = `${bag} tile${bag === 1 ? '' : 's'} in the bag`;
    el('turn').textContent = state.isOver
      ? 'game over'
      : (state.currentPlayerIndex === human ? 'your turn' : `${state.currentPlayer.name} is thinking`);
    el('message').textContent = session.notes.join(' · ');

    const idle = !yourTurn() || swapping;
    el<HTMLButtonElement>('play').disabled = idle || pending.length === 0;
    el<HTMLButtonElement>('clear').disabled = idle || pending.length === 0;
    el<HTMLButtonElement>('hint').disabled = idle;
    el<HTMLButtonElement>('pass').disabled = idle;
    el<HTMLButtonElement>('swap').disabled = !yourTurn() || !state.canExchange || swapping;
    el<HTMLButtonElement>('resign').disabled = state.isOver || swapping || !yourTurn();
    el('resign').textContent = resignArmed ? 'Really resign?' : 'Resign';
    el<HTMLButtonElement>('abandon').disabled = state.isOver || swapping;
    el('abandon').textContent = abandonArmed ? 'Leave this game?' : 'New game';
    el('swap-row').hidden = !swapping;

    el('over').hidden = !state.isOver;
    if (state.isOver && state.outcome) {
      const outcome = state.outcome;
      const winners = outcome.winners.map((index) => state.players[index].name);
      const youWon = outcome.winners.includes(human);
      el('over-title').textContent = youWon ? 'You win' : 'Game over';
      el('over-detail').textContent =
        `${winners.join(', ')} ${winners.length > 1 ? 'tie' : 'wins'} — ended because ${describeReason(outcome.reason)}.`;
      const moved = outcome.adjustments
        .map((points, index) => ({ points, name: state.players[index].name }))
        .filter((entry) => entry.points !== 0)
        .map((entry) => `${entry.name} ${entry.points > 0 ? '+' : '−'}${Math.abs(entry.points)}`);
      el('over-adjust').textContent = moved.length ? `Leftover tiles: ${moved.join(', ')}.` : '';
    }
  }

  function drawBoard(): void {
    if (!session) return;
    const { state, language: { alphabet, rules } } = session;
    const board = el('board');
    board.replaceChildren();
    const fresh = new Set(session.fresh);
    for (let index = 0; index < SIZE * SIZE; index += 1) {
      const x = index % SIZE;
      const y = Math.floor(index / SIZE);
      const premium = state.board.layout.premiumAt(index);
      const tile = state.board.tileAt(index);
      const waiting = pendingAt(x, y);

      const cell = document.createElement('div');
      const bonus = premiumClass(premium);
      cell.className = 'square' + (bonus ? ' ' + bonus : '');
      cell.setAttribute('role', 'gridcell');

      if (tile) {
        cell.classList.add('tile');
        if (tile.isBlank) cell.classList.add('blank');
        if (fresh.has(index)) cell.classList.add('fresh');
        cell.textContent = alphabet.character(tile.letter);
        if (!tile.isBlank) {
          const value = document.createElement('span');
          value.className = 'value';
          value.textContent = String(rules.valueOfLetter(tile.letter));
          cell.append(value);
        }
      } else if (waiting) {
        cell.classList.add('tile', 'pending');
        if (waiting.blank) cell.classList.add('blank');
        cell.textContent = waiting.letter;
      } else {
        cell.textContent = premiumLabel(premium);
        if (cursor && cursor.x === x && cursor.y === y) {
          cell.classList.add('cursor');
          if (!across) cell.classList.add('vertical');
        }
      }
      cell.addEventListener('click', () => clickSquare(x, y));
      board.append(cell);
    }
  }

  function usedRackIndexes(): Set<number> {
    return new Set(pending.map((tile) => tile.rackIndex));
  }

  function drawRack(): void {
    if (!session) return;
    const { alphabet, rules } = session.language;
    const rack = el('rack');
    rack.replaceChildren();
    const used = usedRackIndexes();
    session.state.players[human].rack.forEach((tile, index) => {
      if (used.has(index)) {
        const hole = document.createElement('div');
        hole.className = 'empty';
        rack.append(hole);
        return;
      }
      const cell = document.createElement('div');
      cell.className = 'tile';
      if (picked === index) cell.classList.add('chosen');
      if (marked.has(index)) cell.classList.add('marked');
      if (tile === BLANK) {
        cell.textContent = '';
        cell.title = 'A blank: it spells but scores nothing';
      } else {
        cell.textContent = alphabet.character(tile);
        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = String(rules.valueOfLetter(tile));
        cell.append(value);
      }
      cell.addEventListener('click', () => clickRack(index));
      rack.append(cell);
    });
  }

  function drawPlayers(): void {
    if (!session) return;
    const { state, language } = session;
    const list = el('players');
    list.replaceChildren();
    state.players.forEach((player, index) => {
      const row = document.createElement('li');
      if (!state.isOver && index === state.currentPlayerIndex) row.classList.add('current');
      if (state.outcome?.winners.includes(index)) row.classList.add('winner');

      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = player.name;
      row.append(who);

      const meta = document.createElement('span');
      meta.className = 'meta';
      if (player.hasResigned) meta.textContent = 'resigned';
      else if (player.level) meta.textContent = `bot · ${LEVELS[player.level].name} · ~${language.rating(player.level)}`;
      else {
        meta.textContent = 'you';
        meta.classList.add('you');
      }
      row.append(meta);

      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = String(player.score);
      row.append(score);
      list.append(row);
    });
  }

  function drawHistory(): void {
    if (!session) return;
    const list = el('history');
    list.replaceChildren();
    for (const turn of [...session.state.history].reverse()) {
      const row = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(turn.id);
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = `${turn.playerName}: ${turnSummary(turn)}`;
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = turn.score ? `+${turn.score}` : '';
      row.append(n, what, pts);
      list.append(row);
    }
  }

  // MARK: - Putting tiles down

  function clickRack(index: number): void {
    if (swapping) {
      if (marked.has(index)) marked.delete(index);
      else marked.add(index);
      drawRack();
      return;
    }
    if (!yourTurn()) return;
    picked = picked === index ? null : index;
    drawRack();
  }

  function clickSquare(x: number, y: number): void {
    if (!session || !yourTurn() || swapping) return;
    if (session.state.board.isOccupiedAt(y * SIZE + x)) return;

    const waiting = pendingAt(x, y);
    if (waiting) {
      pending = pending.filter((tile) => tile !== waiting);
      cursor = { x, y };
      draw();
      return;
    }
    if (picked !== null) {
      placeFromRack(picked, x, y);
      return;
    }
    if (cursor && cursor.x === x && cursor.y === y) across = !across;
    else cursor = { x, y };
    draw();
  }

  function placeFromRack(rackIndex: number, x: number, y: number, letter?: string): void {
    if (!session) return;
    const { alphabet } = session.language;
    const tile = session.state.players[human].rack[rackIndex];
    if (tile === undefined) return;
    if (tile === BLANK && !letter) {
      askBlank((chosen) => placeFromRack(rackIndex, x, y, chosen));
      return;
    }
    pending.push({ x, y, letter: letter ?? alphabet.character(tile), blank: tile === BLANK, rackIndex });
    picked = null;
    cursor = nextEmpty({ x, y });
    draw();
  }

  /** The next square along the line that nothing is sitting on. */
  function nextEmpty(from: { x: number; y: number }): { x: number; y: number } | null {
    if (!session) return null;
    let { x, y } = from;
    for (let step = 0; step < SIZE; step += 1) {
      if (across) x += 1; else y += 1;
      if (x >= SIZE || y >= SIZE) return null;
      if (!session.state.board.isOccupiedAt(y * SIZE + x) && !pendingAt(x, y)) return { x, y };
    }
    return null;
  }

  function askBlank(then: (letter: string) => void): void {
    if (!session) return;
    const { alphabet } = session.language;
    const sheet = el('blank');
    const letters = el('blank-letters');
    letters.replaceChildren();
    for (const character of alphabet.letters) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = character;
      button.addEventListener('click', () => {
        sheet.hidden = true;
        then(character);
      });
      letters.append(button);
    }
    sheet.hidden = false;
  }

  function typeLetter(character: string): void {
    if (!session || !cursor || !yourTurn() || swapping) return;
    const { alphabet } = session.language;
    const wanted = character.toUpperCase();
    const letter = alphabet.letter(wanted);
    if (letter === undefined) return;
    const rack = session.state.players[human].rack;
    const used = usedRackIndexes();
    const found = rack.findIndex((tile, index) => !used.has(index) && tile === letter);
    if (found < 0) {
      // No such tile, but a blank can stand for it.
      const blank = rack.findIndex((tile, index) => !used.has(index) && tile === BLANK);
      if (blank < 0) {
        show(`No ${wanted} on the rack.`);
        return;
      }
      placeFromRack(blank, cursor.x, cursor.y, wanted);
      return;
    }
    placeFromRack(found, cursor.x, cursor.y);
  }

  function takeBack(): void {
    pending = [];
    picked = null;
    draw();
  }

  function liftLast(): void {
    const last = pending.pop();
    if (last) cursor = { x: last.x, y: last.y };
    draw();
  }

  // MARK: - Moves

  function note(record: TurnRecord): string {
    return `${record.playerName}: ${turnSummary(record)}` + (record.score > 0 ? ` for ${record.score}` : '');
  }

  /** Applies the player's move, then lets the bots answer it. An illegal
   *  play is the engine's answer to "can I do this", so it comes back as a
   *  sentence under the board, with the game untouched. */
  function move(chosen: Move): void {
    if (!session || !yourTurn()) return;
    const { state } = session;
    try {
      const record = state.apply(chosen);
      session.notes = [note(record)];
      session.fresh = chosen.type === 'play' ? chosen.placements.map((p) => boardIndex(p.position)) : [];
      refused = null;
    } catch (error) {
      refused = error instanceof GameError ? error.message : String(error);
      draw();
      return;
    }
    pending = [];
    picked = null;
    cursor = null;
    swapping = false;
    marked.clear();
    resignArmed = false;
    abandonArmed = false;
    save();
    draw();
    void runBots();
  }

  const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

  /** Plays every bot turn that stands between the player and their next one.
   *  Each turn gets its own tick so the page can say who is thinking. */
  async function runBots(): Promise<void> {
    if (thinking) return;
    thinking = true;
    try {
      while (session && !session.state.isOver && session.state.currentPlayer.level) {
        const current = session;
        const { state } = current;
        draw();
        await pause(350);
        if (session !== current) break; // a new game started meanwhile
        const level = state.currentPlayer.level;
        if (!level) break;
        const bot = new Bot(level, current.language);
        let record: TurnRecord;
        try {
          const chosen = bot.chooseMove(state, SeededGenerator.random());
          record = state.apply(chosen);
          if (chosen.type === 'play') current.fresh = chosen.placements.map((p) => boardIndex(p.position));
        } catch {
          // A bot that proposes something illegal passes instead, so one bad
          // search cannot wedge the game.
          record = state.apply({ type: 'pass' });
        }
        current.notes.push(note(record));
        save();
      }
    } finally {
      thinking = false;
      draw();
    }
  }

  function playTiles(): void {
    if (!session) return;
    const { alphabet, englishName } = session.language;
    const placements: Placement[] = [];
    for (const tile of pending) {
      const letter = alphabet.letter(tile.letter);
      if (letter === undefined) {
        refused = `${englishName} has no tile for '${tile.letter}'.`;
        draw();
        return;
      }
      placements.push({ position: { x: tile.x, y: tile.y }, letter, isBlank: tile.blank });
    }
    if (placements.length === 0) return;
    move({ type: 'play', placements });
  }

  function askHint(): void {
    if (!session || !yourTurn()) return;
    const { state, language: { alphabet } } = session;
    const hint = state.bestPlay(human);
    if (!hint) {
      show('The engine cannot find a play from this rack. Swap, or pass.');
      return;
    }
    pending = [];
    const rack = state.players[human].rack;
    const used = new Set<number>();
    for (const placement of hint.placements) {
      const index = rack.findIndex((tile, at) => !used.has(at) && (placement.isBlank ? tile === BLANK : tile === placement.letter));
      if (index < 0) continue;
      used.add(index);
      pending.push({
        x: placement.position.x,
        y: placement.position.y,
        letter: alphabet.character(placement.letter),
        blank: placement.isBlank,
        rackIndex: index,
      });
    }
    cursor = null;
    refused = null;
    draw();
    el('message').textContent = `${hint.word} for ${hint.score} — the best the engine can find.`;
  }

  // MARK: - Wiring

  el('begin').addEventListener('click', () => { void begin(); });
  el('add-opponent').addEventListener('click', () => {
    if (opponents.length < 3) opponents.push('casual');
    drawOpponents();
  });
  el('play').addEventListener('click', playTiles);
  el('clear').addEventListener('click', takeBack);
  el('hint').addEventListener('click', askHint);
  el('pass').addEventListener('click', () => move({ type: 'pass' }));
  el('swap').addEventListener('click', () => {
    if (!yourTurn()) return;
    swapping = true;
    marked.clear();
    takeBack();
  });
  el('swap-cancel').addEventListener('click', () => {
    swapping = false;
    marked.clear();
    draw();
  });
  el('swap-go').addEventListener('click', () => {
    if (!session) return;
    if (!marked.size) {
      show('Pick at least one tile to put back.');
      return;
    }
    const rack = session.state.players[human].rack;
    move({ type: 'exchange', tiles: [...marked].map((index) => rack[index]) });
  });
  el('resign').addEventListener('click', () => {
    if (!resignArmed) {
      resignArmed = true;
      draw();
      setTimeout(() => { resignArmed = false; if (session) draw(); }, 4000);
      return;
    }
    move({ type: 'resign' });
  });
  el('again').addEventListener('click', () => {
    remembered.game = null;
    showStart();
  });
  /** A new game in the middle of one: the game in progress is dropped,
   *  nothing is scored, and the start screen comes back with the picker. */
  el('abandon').addEventListener('click', () => {
    if (!abandonArmed) {
      abandonArmed = true;
      draw();
      setTimeout(() => { abandonArmed = false; if (session) draw(); }, 4000);
      return;
    }
    abandonArmed = false;
    remembered.game = null;
    showStart();
  });
  el('blank-cancel').addEventListener('click', () => { el('blank').hidden = true; });

  document.addEventListener('keydown', (event) => {
    if (!session || el('game').hidden) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (!el('blank').hidden) {
      if (event.key === 'Escape') el('blank').hidden = true;
      return;
    }
    if (event.key === 'Enter' && pending.length) { playTiles(); event.preventDefault(); return; }
    if (event.key === 'Escape') { takeBack(); return; }
    if (event.key === 'Backspace') { liftLast(); event.preventDefault(); return; }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      typeLetter(event.key);
      event.preventDefault();
    }
  });

  // MARK: - Start

  el<HTMLInputElement>('name').value = remembered.name;
  drawLanguages();
  drawOpponents();
  drawLadder();
  drawTitle();
  drawFooter();
  void resume().then((resumed) => {
    el('loading').hidden = true;
    if (!resumed) showStart();
  });
}
