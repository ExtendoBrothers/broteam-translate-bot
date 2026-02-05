let protectTokens;
let restoreTokens;
try {
  ({ protectTokens, restoreTokens } = require('./dist/src/translator/tokenizer'));
} catch (e) {
  // Fallback to source files (e.g., when running tests via ts-node without a build step)
  ({ protectTokens, restoreTokens } = require('./src/translator/tokenizer'));
}

// Test cases simulating actual translation behavior
const testCases = [
  {
    original: '@oitixion\nit\'s not ready yet',
    // Simulate translator output where newline IS preserved in token (Cg== is \n in base64)
    translatedProtected: '__XTOK_MENTION_1_QG9pdGl4aW9uCg==__itNoch Non-ready'
  },
  {
    original: '@oitixion\nit\'s a tool I made',
    translatedProtected: '__XTOK_MENTION_1_QG9pdGl4aW9uCg==__it"We did it."'
  },
  {
    original: '@BurnerBurn34353 @oitixion\nthanks!\nyou got me thinking!',
    translatedProtected: '__XTOK_MENTION_1_QEJ1cm5lckJ1cm4zNDM1Mw==__ __XTOK_MENTION_2_QG9pdGl4aW9uCg==__thanksJa!\nI think!'
  },
];

console.log('Testing mention spacing issues (simulated translation):\n');

for (const { original, translatedProtected } of testCases) {
  console.log(`Original: ${JSON.stringify(original)}`);
  const protected = protectTokens(original);
  console.log(`Protected: ${JSON.stringify(protected)}`);
  console.log(`Translated (simulated): ${JSON.stringify(translatedProtected)}`);
  const restored = restoreTokens(translatedProtected);
  console.log(`Restored: ${JSON.stringify(restored)}`);
  console.log('Expected space after mention before word');
  console.log('---');
}
