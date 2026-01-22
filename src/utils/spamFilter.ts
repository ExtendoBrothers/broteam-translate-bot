/**
 * Spam filtering utilities for translation results and feedback
 */

/**
 * Checks if a translation result is spammy based on word repetition and length
 * @param result The translation result text to check
 * @returns true if the result is considered spammy
 */
export function isSpammyResult(result: string): boolean {
  // Block if any word is repeated 10+ times or if result is over 5000 chars
  const wordCounts = Object.create(null);
  for (const word of result.split(/\s+/)) {
    if (!word) continue;
    wordCounts[word] = (wordCounts[word] || 0) + 1;
    if (wordCounts[word] >= 10) return true;
  }
  if (result.length > 5000) return true;
  
  // Additional checks for repetitive patterns
  const trimmed = result.trim();
  
  // Block if more than 50% of words are the same word (excluding common words)
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length > 5) {
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them']);
    const filteredWords = words.filter(word => !commonWords.has(word.toLowerCase()));
    if (filteredWords.length > 2) {
      const mostFrequentWord = filteredWords.reduce((acc, word) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const maxCount = Math.max(...Object.values(mostFrequentWord));
      if (maxCount / filteredWords.length > 0.6) return true; // More than 60% of non-common words are the same
    }
  }
  
  // Block character repetition (like "aaaaa", "11111")
  if (/(.)\1{4,}/.test(trimmed)) return true;
  
  // Block very short repetitive sequences
  if (words.length >= 3 && words.every(word => word === words[0])) return true;
  
  return false;
}

/**
 * Checks if feedback entry is spammy (used for feedback logging)
 * @param entry The feedback entry to check
 * @returns true if the entry is considered spammy
 */
export function isSpammyFeedbackEntry(entry: Record<string, unknown>): boolean {
  const candidates = entry.candidates as Array<{ result: string }>;
  const allResults = candidates.map((c) => c.result).join(' ');
  return isSpammyResult(allResults);
}