const fs = require('fs'); let content = fs.readFileSync('feedback-data.jsonl', 'utf8'); content = content.replace(/}\{\
timestamp\:/g, '}\n{\timestamp\:'); fs.writeFileSync('feedback-data.jsonl', content); console.log('Replaced');
