import { translateText } from '../src/translator/googleTranslate';
import { config } from '../src/config';

// Shuffle function for randomization
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function testTranslationChain(input: string, randomize = false) {
  let text = input;
  const chain: string[] = [text];
  const langs = randomize ? shuffleArray(config.LANGUAGES) : config.LANGUAGES;
  for (const lang of langs) {
    text = await translateText(text, lang);
    chain.push(text);
  }
  // Always translate back to English
  text = await translateText(text, 'en');
  chain.push(text);
  return { chain, langs };
}

(async () => {
  const args = process.argv.slice(2);
  const randomize = args.includes('--randomize');
  const inputs = args.filter(arg => arg !== '--randomize');
  if (inputs.length === 0) {
    console.log('Usage: ts-node scripts/test-translation-dryrun.ts [--randomize] "input1" "input2" ...');
    process.exit(1);
  }
  for (const input of inputs) {
    console.log(`\nTesting input: "${input}"${randomize ? ' (randomized)' : ' (fixed order)'}`);
    try {
      const { chain, langs } = await testTranslationChain(input, randomize);
      console.log('Language order:', langs.join(' -> '));
      console.log('Translation chain:');
      chain.forEach((step, i) => {
        const lang = i === 0 ? 'original' : (i === chain.length - 1 ? 'en' : langs[i - 1]);
        console.log(`Step ${i} (${lang}): ${step}`);
      });
    } catch (error) {
      console.error(`Error translating "${input}":`, error);
    }
  }
})();
