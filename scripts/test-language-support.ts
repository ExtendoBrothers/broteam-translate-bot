import { translateText } from '../src/translator/googleTranslate';

const testPhrase = 'Hello world, this is a test phrase for language support.';

const newLanguages = [
  'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'cs', 'bg', 'ro', 'he', 'id', 'bn', 'ur', 'ta', 'te', 'ml', 'kn', 'gu', 'mr', 'pa', 'sw', 'tl', 'my', 'km', 'lo', 'am', 'zu', 'xh', 'st', 'so', 'yo', 'ig', 'ha', 'eu', 'gl', 'ca', 'is', 'ga', 'mt', 'lb', 'mk', 'sq', 'bs', 'af', 'hy', 'ka', 'be', 'mn', 'ky', 'kk', 'uz', 'tt', 'tk', 'ps', 'sd', 'si', 'ne', 'as', 'or', 'dz', 'bo', 'ug', 'ku', 'ckb'
];

async function testLanguageSupport() {
  console.log('Testing LibreTranslate support for new languages...\n');

  for (const lang of newLanguages) {
    try {
      const result = await translateText(testPhrase, lang);
      console.log(`✅ ${lang}: Supported (translated to: ${result.substring(0, 50)}...)`);
    } catch (error) {
      const err = error as Error;
      console.log(`❌ ${lang}: Not supported or failed (${err.message})`);
    }
    // Small delay to avoid overwhelming the service
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

testLanguageSupport().catch(console.error);
