/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { translateText } from '../translator/googleTranslate';
import { config } from '../config';

async function main() {
  // Simple argument parser for --text and --dry-run
  const argv = process.argv.slice(2);
  let input = '';
  let langsArg = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--text' && argv[i + 1]) {
      input = argv[i + 1];
      i++;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i].startsWith('--langs=')) {
      langsArg = argv[i].replace('--langs=', '');
    } else if (!argv[i].startsWith('--')) {
      // Fallback: treat as input if not set
      if (!input) input = argv[i];
      else langsArg = argv[i];
    }
  }
  if (!input) {
    console.error('Usage: ts-node src/scripts/translateOne.ts --text "text to translate" [--langs=lang1,lang2,...] [--dry-run]');
    process.exit(1);
  }
  const cfgLangs = (config as any).LANGUAGES || (config as any).languages || [];
  const languages: string[] = langsArg ? langsArg.split(',').map(s => s.trim()) : cfgLangs;

  console.log(`Translating: "${input}"`);
  console.log(`Target languages: ${languages.join(', ')}`);

  for (const lang of languages) {
    try {
      const translated = await translateText(input, lang);
      if (dryRun) {
        console.log(`\n[DRY_RUN][${lang}] ${translated}`);
      } else {
        console.log(`\n[${lang}] ${translated}`);
      }
    } catch (err: any) {
      console.error(`\n[${lang}] Error: ${err?.message || String(err)}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
