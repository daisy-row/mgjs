// Ukrainian is 2.7 million forms and a second to load, so only the test
// that needs it pays for it.
import { loadLanguage, type Language } from './fixture';

let cached: Language | null = null;

export function loadUkrainian(): Language {
  cached ??= loadLanguage('uk');
  return cached;
}
