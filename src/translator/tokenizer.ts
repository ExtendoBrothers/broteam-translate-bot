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
    { type: 'EMAIL', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { type: 'URL', regex: /(https?:\/\/[^\s)\]}]+)|(www\.[^\s)\]}]+)|([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s)\]}]*)?)/gi },
    { type: 'MENTION', regex: /(?:^|\B)@[a-zA-Z0-9_-]+(?=\n|\W|$)/g },
    { type: 'HASHTAG', regex: /\B#[\p{L}0-9_]+/gu },
    { type: 'CASHTAG', regex: /\B\$[A-Za-z]{1,6}\b/g },
    { type: 'QMARK', regex: /\?/g },
    { type: 'DQUOTE', regex: /[\u0022\u201C\u201D]/g },
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
  // Add space after token if followed immediately by a word character (no space)
  // BUT: Don't add space if the restored token ends with whitespace (newline, space, etc.)
  // Use Unicode-aware character class to match letters/numbers in any language
  restored = restored.replace(/__XTOK_([A-Z]+)_(\d+)_([A-Za-z0-9+/=]+)__+([\p{L}\p{N}])/gu, (_m, type, _idx, b64, nextChar) => {
    try { 
      const original = Buffer.from(b64, 'base64').toString('utf8');
      // Don't add space if original already ends with whitespace
      if (/\s$/.test(original)) {
        return original + nextChar;
      }
      // Add space between restored token and next word character
      return original + ' ' + nextChar;
    } catch { return _m; }
  });
  
  // Restore remaining tokens without the word character lookahead
  restored = restored.replace(/__XTOK_([A-Z]+)_(\d+)_([A-Za-z0-9+/=]+)__+/g, (_m, type, _idx, b64) => {
    try { 
      const original = Buffer.from(b64, 'base64').toString('utf8');
      return original;
    } catch { return _m; }
  });

  // Backward compatibility for old format
  restored = restored.replace(/XTOK:([A-Z]+):(\d+):([A-Za-z0-9+/=]+)/g, (_m, type, _idx, b64) => {
    try { 
      const original = Buffer.from(b64, 'base64').toString('utf8');
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

  // Remove any remaining token placeholder fragments that weren't restored
  // These are partial tokens like "XN", "XNL", "__XTOK", "TOK_", etc.
  // Only apply cleanup if we actually find and remove fragments
  const beforeCleanup = restored;
  
  restored = restored
    // Remove fragments between spaces
    .replace(/\s+\b__X[A-Z]*\b\s+/g, ' ')       // __X, __XN, __XTOK between spaces
    .replace(/\s+\bXTOK_[A-Z0-9_]*\b\s+/g, ' ') // XTOK_ between spaces
    .replace(/\s+\b_+[A-Z]{2,}_+\b\s+/g, ' ')   // __ABC__ between spaces
    .replace(/\s+\bXNL?\b\s+/g, ' ')            // XN or XNL between spaces
    .replace(/\s+\bSILE\b\s+/g, ' ')            // SILE between spaces
    // Remove fragments before punctuation (with space before fragment)
    .replace(/\s+\bXNL?\b(?=[,.:;!?])/g, '')    // XN/XNL before punctuation
    .replace(/\s+\bSILE\b(?=[,.:;!?])/g, '')    // SILE before punctuation
    // Remove token fragments ending with __ but missing the __XTOK_ prefix
    // e.g. XNL__, MENTION__, URL__ — produced when translators partially mangle placeholders
    // Must run before the remaining-fragment cleanup below
    .replace(/\b[A-Z]{2,8}__(?=[\s\p{L}\p{N}]|$)/gu, '') // CAPS__ before space/letter/digit/end
    .replace(/\b[A-Z]{2,8}__$/gmu, '')          // CAPS__ at end of line
    // Remove any remaining fragments
    .replace(/\b__X[A-Z]*\b/g, '')              // Remaining __X fragments
    .replace(/\bXTOK_[A-Z0-9_]*/g, '')          // Remaining XTOK fragments
    .replace(/\b_+[A-Z]{2,}_+\b/g, '');         // Remaining __ABC__ fragments
  
  // Only collapse multiple spaces if we actually removed fragments
  if (restored !== beforeCleanup) {
    restored = restored.replace(/ {2,}/g, ' ').trim();
  }

  return normalizeNFC(restored);
}
