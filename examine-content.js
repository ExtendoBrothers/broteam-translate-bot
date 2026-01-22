const fs = require('fs');
const content = fs.readFileSync('feedback-data.jsonl', 'utf8');

console.log('Position 1240-1250:', JSON.stringify(content.substring(1240, 1250)));
console.log('Pattern check 1:', content.includes('}\n{"timestamp":'));
console.log('Pattern check 2:', content.includes('}\r\n{"timestamp":'));
console.log('Pattern check 3:', content.includes('}{"timestamp":'));
console.log('Total length:', content.length);

// Find the first occurrence of any pattern
const patterns = ['}\n{"timestamp":', '}\r\n{"timestamp":', '}{"timestamp":'];
for (const pattern of patterns) {
  const index = content.indexOf(pattern);
  console.log(`Pattern "${pattern}" at:`, index);
  if (index !== -1) {
    console.log('Context around pattern:', JSON.stringify(content.substring(index - 5, index + 20)));
    break;
  }
}