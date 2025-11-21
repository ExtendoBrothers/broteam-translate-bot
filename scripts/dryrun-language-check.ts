import { translateText } from '../src/translator/googleTranslate';
import * as franc from 'franc';

async function main() {
  const input = 'нет, нет, нет, нет, тв/брата';
  const result = await translateText(input, 'en');
  const detectedLang = franc.franc(result, { minLength: 3 });
  console.log('Input:', input);
  console.log('Translated to EN:', result);
  console.log('Detected language:', detectedLang);
  if (detectedLang !== 'eng') {
    console.log('Result is NOT English. Would retry translation chain.');
  } else {
    console.log('Result is English. Would post.');
  }
}

main().catch(console.error);
