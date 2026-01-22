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