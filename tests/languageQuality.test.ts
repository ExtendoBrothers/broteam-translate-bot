import { getLanguageQualityIssue } from '../src/translator/languageQuality';
import { detectLanguageByLexicon } from '../src/translator/lexicon';

describe('translation language quality', () => {
  const source = "dinner at Dinesh D'souza's house Video";

  it.each([
    ['Area and personalzuar E-mail.com', 'personalzuar'],
    ['דניס Dina Foods', 'דניס'],
    ['Hello привет world', 'привет'],
    ['한국 음식 is good', '한국'],
    ['Dinner and bonjour', 'bonjour'],
    ['The hombre is here', 'hombre'],
    ['Napredni video', 'Napredni'],
    ['Selamat pagi semuanya', 'Selamat'],
    ['Guten tag und danke', 'Guten'],
  ])('rejects suspicious language in %s', (result, word) => {
    expect(getLanguageQualityIssue(result, source)).toContain(word);
  });

  it.each([
    ["miss d'Suza", source],
    ['Dinner at Dinesh House', source],
    ['I said "hola" to my friend.', 'I greeted my friend.'],
    ['I said hola to my friend.', 'I greeted my friend.'],
    ['I met דניס at the dinner.', 'I met דניס at the house.'],
    ['I met Иван at the dinner.', 'I met Иван at the house.'],
    ['The sushi is ready for dinner.', source],
    ['I told my coworkers that dinner is ready.', source],
    ['@user Dinner at https://example.com/שלום #דניס', source],
    ["You don't have to do this alone.", source],
    ["I'm cold", source],
    ["I've got it", source],
  ])('allows English and contextual names or quoted words: %s', (result, original) => {
    expect(getLanguageQualityIssue(result, original)).toBeUndefined();
  });

  it('does not treat a foreign script in the source as sufficient context for a fragment', () => {
    expect(getLanguageQualityIssue('דניס Dina Foods', 'דניס is here')).toContain('דניס');
  });

  it('does not accept an untranslated foreign fragment merely because it was in the source', () => {
    expect(getLanguageQualityIssue('hola dinner', 'I said hola to her')).toContain('hola');
  });

  it('keeps the existing English classifier compatible with the example name', () => {
    expect(detectLanguageByLexicon("miss d'Suza")).toBe('en');
  });
});
