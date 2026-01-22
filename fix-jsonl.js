const fs = require('fs');

try {
  // Read the corrupted file
  let content = fs.readFileSync('feedback-data.jsonl', 'utf8');

  const objects = [];
  let start = 0;
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < content.length; i++) {
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
        // Found a complete object
        const objStr = content.substring(start, i + 1);
        objects.push(objStr);
        start = i + 1;
      }
    }
  }

  console.log(`Found ${objects.length} complete objects`);

  // Validate each object
  const validObjects = [];
  for (let i = 0; i < objects.length; i++) {
    try {
      JSON.parse(objects[i]);
      validObjects.push(objects[i]);
    } catch (e) {
      console.log(`Object ${i} failed to parse: ${e.message}`);
    }
  }

  console.log(`Valid objects: ${validObjects.length}`);

  // Write back the fixed file
  fs.writeFileSync('feedback-data.jsonl', validObjects.join('\n') + '\n', 'utf8');

  console.log('Fixed feedback-data.jsonl file');
} catch (error) {
  console.error('Error fixing file:', error);
}
