import englishWords from 'word-list-json/words.json';
import { LEXICONS } from './lexicon';

const englishDictionary = new Set(englishWords.words.map(word => word.toLowerCase()));
const foreignWords = new Set(
  Object.entries(LEXICONS)
    .filter(([language]) => language !== 'en')
    .flatMap(([, words]) => [...words])
    .filter(word => word.length >= 4 && !LEXICONS.en.has(word))
);
for (const word of [
  'hola', 'bonjour', 'gracias', 'buongiorno', 'grazie', 'arigato', 'arigatou', 'spasibo', 'privet',
  'guten', 'danke', 'bitte', 'nicht', 'haben', 'goedemorgen', 'dankjewel', 'jullie',
  'selamat', 'pagi', 'terima', 'kasih', 'semuanya', 'tidak', 'dengan', 'napredni', 'lahko', 'hvala',
]) {
  foreignWords.add(word);
}

const WORDS = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const CONTEXT_WORDS = new Set(['i', 'you', 'we', 'they', 'he', 'she', 'it', 'the', 'this', 'that', 'these', 'those']);
const CONTEXT_VERBS = new Set([
  'am', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'should', 'said', 'say', 'says', 'called', 'named',
  'told', 'asked', 'wrote', 'means', 'met', 'saw', 'visited',
]);
const FOREIGN_CONTEXT = new Set(['said', 'say', 'says', 'called', 'named', 'told', 'asked', 'wrote', 'means', 'word']);

function textForLanguageChecks(text: string): string {
  return text
    .replace(/__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ')
    .replace(/https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi, ' ')
    .replace(/@[a-zA-Z0-9_-]+/g, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ');
}

function englishWord(word: string): boolean {
  const normalized = word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (englishDictionary.has(normalized)) return true;
  if (/^i['’](?:m|ve|ll|d)$/.test(normalized)) return true;
  const possessiveOrContraction = normalized.replace(/['’](?:s|re|ve|ll|d|m)$/, '');
  if (possessiveOrContraction !== normalized && englishDictionary.has(possessiveOrContraction)) return true;
  const negative = normalized.replace(/n['’]t$/, '');
  return negative !== normalized && (englishDictionary.has(negative) || ['ca', 'wo', 'sha'].includes(negative));
}

/** Returns a warning for suspicious untranslated words, or undefined when the text passes. */
export function getLanguageQualityIssue(result: string, original: string): string | undefined {
  const text = textForLanguageChecks(result);
  const words = [...text.matchAll(WORDS)];
  const originals = new Set([...textForLanguageChecks(original).matchAll(WORDS)].map(match => match[0].toLowerCase()));
  const lowerWords = words.map(match => match[0].toLowerCase());
  const commonEnglishCount = lowerWords.filter(word => LEXICONS.en.has(word)).length;
  const sentenceContext = commonEnglishCount >= 4 &&
    lowerWords.some(word => CONTEXT_WORDS.has(word)) &&
    lowerWords.some(word => CONTEXT_VERBS.has(word));

  for (const match of words) {
    const word = match[0];
    const lower = word.toLowerCase();
    const nonLatin = /[^\p{Script=Latin}\p{M}'’]/u.test(word);
    const isForeign = foreignWords.has(lower) && !LEXICONS.en.has(lower);
    const inSource = originals.has(lower);
    const index = match.index ?? 0;
    const before = text[index - 1];
    const after = text[index + word.length];
    const quoted = (before === '"' && after === '"') || (before === '“' && after === '”') ||
      (before === '‘' && after === '’') || (before === '\'' && after === '\'');

    if (nonLatin) {
      if (sentenceContext && (inSource || quoted)) continue;
      return `Untranslated non-Latin script: ${word}`;
    }

    if (isForeign) {
      if (sentenceContext && (inSource || quoted || lowerWords.some(w => FOREIGN_CONTEXT.has(w)))) continue;
      return `Likely untranslated foreign word: ${word}`;
    }

    if (word.length <= 2 || englishWord(word) || inSource) continue;
    const apostropheName = /^[do]['’]\p{L}{2,}$/iu.test(word);
    const capitalizedName = /^\p{Lu}\p{Ll}{2,}$/u.test(word);
    if (commonEnglishCount > 0 && (apostropheName || capitalizedName)) continue;
    if (sentenceContext && quoted) continue;
    return `Unrecognized word in translation: ${word}`;
  }
  return undefined;
}
