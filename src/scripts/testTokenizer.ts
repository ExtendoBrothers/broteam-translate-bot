import { protectTokens, restoreTokens } from '../translator/tokenizer';

function assertEqual(actual: string, expected: string, msg: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${msg}\nExpected: ${expected}\nActual:   ${actual}`);
    process.exit(1);
  }
}

function wrapTokens(input: string): string {
  // Simulate a translator adding stray braces/brackets/parentheses around tokens
  return input
    .replace(/\{\{XTOK:([^}]+)\}\}/g, (_m, inner) => `{ {{XTOK:${inner}}} }`)
    .replace(/(XURL:[A-Za-z0-9+/=]+)/g, '<$1>');
}

function runCase(original: string) {
  const protectedText = protectTokens(original);
  const withWrappers = wrapTokens(protectedText);
  const restored = restoreTokens(withWrappers);
  assertEqual(restored, original, `Round-trip failed for: ${original}`);
}

function main() {
  const cases = [
    'Hello @alice #hello $TSLA test@example.com https://example.com',
    'Ping @someone about #TypeScript and $AAPL at example@mail.com; see https://t.co/abc123',
    'Use `code_snippet()` then visit https://x.com/path?query=1#hash',
    'Fenced code:\n```js\nconst x = 1;\n``` and site www.example.org/docs',
    'Mixed: @bob #Café $EUR test@例子.公司 https://例子.测试',
  ];

  for (const c of cases) runCase(c);
  console.log('All tokenizer tests passed.');
}

main();
