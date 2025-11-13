/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { translateText } from '../translator/googleTranslate';
import { config } from '../config';

async function main() {
  const argv = process.argv.slice(2);
  const input = argv[0];
  if (!input) {
    console.error('Usage: .\\node_modules\\.bin\\ts-node ./src/scripts/translateOne.ts "text to translate" [lang1,lang2,...]');
    process.exit(1);
  }

  const langsArg = argv[1];
  const cfgLangs = (config as any).LANGUAGES || (config as any).languages || [];
  const languages: string[] = langsArg ? langsArg.split(',').map(s => s.trim()) : cfgLangs;

  console.log(`Translating: "${input}"`);
  console.log(`Target languages: ${languages.join(', ')}`);

  for (const lang of languages) {
    try {
      const translated = await translateText(input, lang);
      console.log(`\n[${lang}] ${translated}`);
    } catch (err: any) {
      console.error(`\n[${lang}] Error: ${err?.message || String(err)}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
