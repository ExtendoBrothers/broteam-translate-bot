/**
 * Shared quality helpers for translation-length checks.
 */

export function getMinimumLengthRatio(originalText: string): number {
  const wordCount = originalText.trim().split(/\s+/).filter(Boolean).length;
  return wordCount >= 10 ? 0.4 : 0.25;
}

export function getMinimumLengthPercent(originalText: string): number {
  return Math.round(getMinimumLengthRatio(originalText) * 100);
}