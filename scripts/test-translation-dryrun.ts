import { translateText } from '../src/translator/googleTranslate';
import { config } from '../src/config';

async function testTranslationChain(input: string) {
  let text = input;
  const chain: string[] = [text];
  for (const lang of config.LANGUAGES) {
    text = await translateText(text, lang);
    chain.push(text);
  }
  // Always translate back to English
  text = await translateText(text, 'en');
  chain.push(text);
  return chain;
}

(async () => {
  const input = 'https://t.co/8783gfgf';
  const chain = await testTranslationChain(input);
  console.log('Translation chain:');
  chain.forEach((step, i) => {
    console.log(`Step ${i}: ${step}`);
  });
})();
