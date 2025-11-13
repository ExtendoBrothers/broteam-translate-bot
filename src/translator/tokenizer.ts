export function normalizeNFC(text: string): string {
  try {
    return text.normalize('NFC');
  } catch {
    return text;
  }
}

export function protectTokens(text: string): string {
  const nfc = normalizeNFC(text);
  const patterns: Array<{ type: string; regex: RegExp }> = [
    { type: 'CODEBLK', regex: /```[\s\S]*?```/g },
    { type: 'CODE', regex: /`[^`]+`/g },
    { type: 'URL', regex: /(https?:\/\/[^\s)\]}]+)|(www\.[^\s)\]}]+)/gi },
    { type: 'EMAIL', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { type: 'MENTION', regex: /\B@[a-zA-Z0-9_]{1,15}\b/g },
    { type: 'HASHTAG', regex: /\B#[\p{L}0-9_]+/gu },
    { type: 'CASHTAG', regex: /\B\$[A-Za-z]{1,6}\b/g },
  ];

  let tokenIndex = 0;
  let sanitized = nfc;
  for (const { type, regex } of patterns) {
    sanitized = sanitized.replace(regex, (match: string) => {
      tokenIndex += 1;
      const b64 = Buffer.from(match, 'utf8').toString('base64');
      return `{{XTOK:${type}:${tokenIndex}:${b64}}}`;
    });
  }
  return sanitized;
}

export function restoreTokens(text: string): string {
  let restored = text;

  // Backward compatibility for prior placeholder style (XURL)
  restored = restored.replace(/XURL:([A-Za-z0-9+/=]+)/g, (_m, p1) => {
    try { return Buffer.from(p1, 'base64').toString('utf8'); } catch { return _m; }
  });

  // Restore all XTOK placeholders regardless of surrounding punctuation/braces
  restored = restored.replace(/XTOK:([A-Z]+):(\d+):([A-Za-z0-9+/=]+)/g, (_m, _type, _idx, b64) => {
    try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return _m; }
  });

  // Clean up any leftover wrapper chars that translators might add around tokens
  restored = restored
    .replace(/\{+\s*([^{}\s][^{}]*?)\s*\}+/g, '$1')
    .replace(/\[+\s*([^\]\s][^\]]*?)\s*\]+/g, '$1')
    .replace(/<+\s*([^<>\s][^<>]*?)\s*>+/g, '$1')
    .replace(/\(+\s*([^()\s][^()]*)\s*\)+/g, '$1');

  // Explicitly strip wrappers (with optional spaces) around common token types
  const urlPart = '(?:https?:\\/\\/\\S+|www\\.\\S+)';
  const emailPart = '(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})';
  const mentionPart = '(?:@[a-zA-Z0-9_]{1,15}\\b)';
  const hashtagPart = '(?:#[\\p{L}0-9_]+)';
  const cashtagPart = '(?:\\$[A-Za-z]{1,6}\\b)';

  const pairs: Array<[RegExp, string]> = [
    [new RegExp(`\\{\\s*(${urlPart})\\s*\\}`, 'gi'), '$1'],
    [new RegExp(`\\[\\s*(${urlPart})\\s*\\]`, 'gi'), '$1'],
    [new RegExp(`<\\s*(${urlPart})\\s*>`, 'gi'), '$1'],
    [new RegExp(`\\(\\s*(${urlPart})\\s*\\)`, 'gi'), '$1'],

    [new RegExp(`\\{\\s*(${emailPart})\\s*\\}`, 'gi'), '$1'],
    [new RegExp(`\\[\\s*(${emailPart})\\s*\\]`, 'gi'), '$1'],
    [new RegExp(`<\\s*(${emailPart})\\s*>`, 'gi'), '$1'],
    [new RegExp(`\\(\\s*(${emailPart})\\s*\\)`, 'gi'), '$1'],

    [new RegExp(`\\{\\s*(${mentionPart})\\s*\\}`, 'g'), '$1'],
    [new RegExp(`\\[\\s*(${mentionPart})\\s*\\]`, 'g'), '$1'],
    [new RegExp(`<\\s*(${mentionPart})\\s*>`, 'g'), '$1'],
    [new RegExp(`\\(\\s*(${mentionPart})\\s*\\)`, 'g'), '$1'],

    [new RegExp(`\\{\\s*(${hashtagPart})\\s*\\}`, 'gu'), '$1'],
    [new RegExp(`\\[\\s*(${hashtagPart})\\s*\\]`, 'gu'), '$1'],
    [new RegExp(`<\\s*(${hashtagPart})\\s*>`, 'gu'), '$1'],
    [new RegExp(`\\(\\s*(${hashtagPart})\\s*\\)`, 'gu'), '$1'],

    [new RegExp(`\\{\\s*(${cashtagPart})\\s*\\}`, 'g'), '$1'],
    [new RegExp(`\\[\\s*(${cashtagPart})\\s*\\]`, 'g'), '$1'],
    [new RegExp(`<\\s*(${cashtagPart})\\s*>`, 'g'), '$1'],
    [new RegExp(`\\(\\s*(${cashtagPart})\\s*\\)`, 'g'), '$1'],

    // Code spans and blocks
    [new RegExp('\\{\\s*(`[^`]+`)\\s*\\}', 'g'), '$1'],
    [new RegExp('\\[\\s*(`[^`]+`)\\s*\\]', 'g'), '$1'],
    [new RegExp('<\\s*(`[^`]+`)\\s*>', 'g'), '$1'],
    [new RegExp('\\(\\s*(`[^`]+`)\\s*\\)', 'g'), '$1'],
    // Fenced code blocks
    [new RegExp('\\{\\s*(```[\\s\\S]*?```)\\s*\\}', 'g'), '$1'],
    [new RegExp('\\[\\s*(```[\\s\\S]*?```)\\s*\\]', 'g'), '$1'],
    [new RegExp('<\\s*(```[\\s\\S]*?```)\\s*>', 'g'), '$1'],
    [new RegExp('\\(\\s*(```[\\s\\S]*?```)\\s*\\)', 'g'), '$1'],
  ];
  for (const [re, rep] of pairs) restored = restored.replace(re, rep);

  return normalizeNFC(restored);
}
