/**
 * Optimized duplicate checking with caching and performance improvements
 */

import { logger } from './logger';

// Simple LRU cache for duplicate checks
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }
    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value as K;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Caches for performance optimization
const similarityCache = new LRUCache<string, number>(500);
const normalizedTextCache = new LRUCache<string, string>(500);

/**
 * Normalize text for comparison (cached)
 */
export function normalizeText(text: string): string {
  const cached = normalizedTextCache.get(text);
  if (cached !== undefined) {
    return cached;
  }

  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')
    .trim();

  normalizedTextCache.set(text, normalized);
  return normalized;
}

/**
 * Optimized similarity calculation with early exit
 */
export function calculateSimilarity(text1: string, text2: string): number {
  // Quick exact match check
  if (text1 === text2) return 1.0;

  // Check cache
  const cacheKey = `${text1}|${text2}`;
  const cached = similarityCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const norm1 = normalizeText(text1);
  const norm2 = normalizeText(text2);

  // Quick length check (if lengths differ by >50%, similarity is low)
  const lengthRatio = Math.min(norm1.length, norm2.length) / Math.max(norm1.length, norm2.length);
  if (lengthRatio < 0.5) {
    similarityCache.set(cacheKey, 0);
    return 0;
  }

  // Use word-based Jaccard similarity for better performance
  const words1 = new Set(norm1.split(' '));
  const words2 = new Set(norm2.split(' '));

  if (words1.size === 0 && words2.size === 0) {
    similarityCache.set(cacheKey, 1.0);
    return 1.0;
  }

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  const similarity = intersection.size / union.size;
  similarityCache.set(cacheKey, similarity);

  return similarity;
}

/**
 * Optimized substring check with early exit
 */
export function containsSubstring(text: string, substring: string): boolean {
  if (substring.length > text.length) return false;
  if (substring.length < 3) return false; // Too short to be meaningful

  const normText = normalizeText(text);
  const normSubstring = normalizeText(substring);

  return normText.includes(normSubstring);
}

/**
 * Fast hash function for text comparison
 */
export function hashText(text: string): string {
  let hash = 0;
  const normalized = normalizeText(text);
  
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return hash.toString(36);
}

/**
 * Batch similarity check - optimize when checking against multiple candidates
 */
export function findMostSimilar(
  text: string,
  candidates: string[],
  threshold: number = 0.8
): { text: string; similarity: number } | null {
  let bestMatch: { text: string; similarity: number } | null = null;
  
  const normalizedText = normalizeText(text);
  const textWords = new Set(normalizedText.split(' '));

  for (const candidate of candidates) {
    // Quick pre-filter: if no common words, skip expensive calculation
    const normalizedCandidate = normalizeText(candidate);
    const candidateWords = new Set(normalizedCandidate.split(' '));
    
    const hasCommonWords = [...textWords].some(word => candidateWords.has(word));
    if (!hasCommonWords && textWords.size > 0 && candidateWords.size > 0) {
      continue;
    }

    const similarity = calculateSimilarity(text, candidate);
    
    if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
      bestMatch = { text: candidate, similarity };
      
      // Early exit if perfect match
      if (similarity >= 0.99) {
        break;
      }
    }
  }

  return bestMatch;
}

/**
 * Clear caches to free memory
 */
export function clearDuplicateCheckCaches(): void {
  similarityCache.clear();
  normalizedTextCache.clear();
  logger.info('Duplicate check caches cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { similarity: number; normalized: number } {
  return {
    similarity: similarityCache.size(),
    normalized: normalizedTextCache.size()
  };
}
