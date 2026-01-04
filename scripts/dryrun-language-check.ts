import { translateText } from '../src/translator/googleTranslate';
// @ts-expect-error - langdetect has no TypeScript definitions
import * as langdetect from 'langdetect';

async function main() {
  const input = 'HERSTELL CHANDRA';
  const result = await translateText(input, 'en');
  const detections = langdetect.detect(result);
  console.log('Detections:', JSON.stringify(detections));
  const detectedLang = detections && detections.length > 0 ? detections[0].lang : 'und';
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
