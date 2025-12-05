const franc = require('franc');

const text = 'वुडपॉट';

const lang = franc.franc(text, { minLength: 3 });

console.log(`Detected language for '${text}': ${lang}`);