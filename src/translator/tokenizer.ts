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
    { type: 'URL', regex: /(https?:\/\/[^\s)\]}]+)|(www\.[^\s)\]}]+)|([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s)\]}]*)?)/gi },
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
      return `__XTOK_${type}_${tokenIndex}_${b64}__`;
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

  // Restore all XTOK placeholders in new format
  restored = restored.replace(/__XTOK_([A-Z]+)_(\d+)_([A-Za-z0-9+/=]+)__+/g, (_m, type, _idx, b64) => {
    try { 
      const original = Buffer.from(b64, 'base64').toString('utf8');
      // Add space before URLs if not preceded by whitespace
      if (type === 'URL') {
        const beforeMatch = restored.substring(0, restored.indexOf(_m));
        if (beforeMatch && !/\s$/.test(beforeMatch)) {
          return ' ' + original;
        }
      }
      return original;
    } catch { return _m; }
  });

  // Backward compatibility for old format
  restored = restored.replace(/XTOK:([A-Z]+):(\d+):([A-Za-z0-9+/=]+)/g, (_m, type, _idx, b64) => {
    try { 
      const original = Buffer.from(b64, 'base64').toString('utf8');
      // Add space before URLs if not preceded by whitespace
      if (type === 'URL') {
        const beforeMatch = restored.substring(0, restored.indexOf(_m));
        if (beforeMatch && !/\s$/.test(beforeMatch)) {
          return ' ' + original;
        }
      }
      return original;
    } catch { return _m; }
  });

  // Clean up any leftover wrapper chars that translators might add around tokens
  restored = restored
    .replace(/\{+\s*([^{}\s][^{}]*?)\s*\}+/g, '$1')
    .replace(/\[+\s*([^\]\s][^\]]*?)\s*\]+/g, '$1')
    .replace(/<+\s*([^<>\s][^<>]*?)\s*>+/g, '$1')
    .replace(/\(+\s*([^()\s][^()]*)\s*\)+/g, '$1');

  // Try to restore tokens that got mangled by translators
  // Look for patterns that might contain the base64 part
  const b64Pattern = /[A-Za-z0-9+/=]{8,}/g;
  let b64Match;
  while ((b64Match = b64Pattern.exec(restored)) !== null) {
    const b64 = b64Match[0];
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      // Check if it's a valid token type
      if (decoded.startsWith('@') || decoded.startsWith('#') || decoded.startsWith('$') || 
          decoded.includes('@') || decoded.includes('http') || decoded.includes('```') || decoded.includes('`')) {
        restored = restored.replace(b64, decoded);
      }
    } catch {
      // Not valid base64, skip
    }
  }

  return normalizeNFC(restored);
}
