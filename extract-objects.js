const fs = require('fs');

const content = fs.readFileSync('feedback-data.jsonl', 'utf8');

const objects = [];
let pos = 0;

while (pos < content.length) {
  // Find the start of an object
  const startMatch = content.indexOf('{"timestamp":', pos);
  if (startMatch === -1) break;

  // From start, find the matching closing brace
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let endPos = startMatch;

  for (let i = startMatch; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0) {
        endPos = i;
        break;
      }
    }
  }

  if (braceCount === 0) {
    const objStr = content.substring(startMatch, endPos + 1);
    try {
      JSON.parse(objStr);
      objects.push(objStr);
    } catch (e) {
      console.log('Failed to parse object:', e.message);
    }
  }

  pos = endPos + 1;
}

console.log(`Extracted ${objects.length} valid objects`);

fs.writeFileSync('feedback-data.jsonl', objects.join('\n') + '\n');

console.log('Fixed feedback-data.jsonl');