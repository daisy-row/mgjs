// The page: English is baked in, so the page starts from disk with nothing
// to fetch; Ukrainian is 2.5 MB compressed and sits in a file beside the page,
// fetched the first time somebody picks it.
import boardText from './data/Board.txt';
import enTiles from './data/en/Tiles.txt';
import enWords from './data/en/Words.lex.gz';
import ukTiles from './data/uk/Tiles.txt';
import { LANGUAGE_SPECS, Language, type LanguageCode } from './engine/index';
import { startApp } from './ui/app';

const tiles: Record<LanguageCode, string> = { en: enTiles, uk: ukTiles };
const loaded = new Map<LanguageCode, Promise<Language>>();

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function compressedWords(code: LanguageCode): Promise<Uint8Array> {
  if (code === 'en') return enWords;
  const url = new URL(`lang/${code}.lex.gz`, document.baseURI);
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      `The ${LANGUAGE_SPECS[code].englishName} word list is a separate file beside this page, and the browser `
      + 'would not fetch it. A page opened from disk cannot read it; serve the page over http instead.',
    );
  }
  if (!response.ok) throw new Error(`${url.pathname}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The language with its word list loaded, once per page. */
function loadLanguage(code: LanguageCode): Promise<Language> {
  let promise = loaded.get(code);
  if (!promise) {
    promise = (async () => {
      const words = await gunzip(await compressedWords(code));
      return new Language(LANGUAGE_SPECS[code], boardText, tiles[code], words);
    })();
    loaded.set(code, promise);
    promise.catch(() => loaded.delete(code)); // so a failed fetch can be retried
  }
  return promise;
}

async function main(): Promise<void> {
  const loading = document.getElementById('loading');
  try {
    await loadLanguage('en');
    startApp(loadLanguage);
  } catch (error) {
    if (loading) {
      loading.className = 'error';
      loading.textContent = `The game could not start: ${error instanceof Error ? error.message : String(error)}`;
    }
    throw error;
  }
}

void main();
