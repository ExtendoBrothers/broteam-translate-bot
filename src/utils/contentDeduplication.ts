/**
 * Enhanced duplicate prevention system
 * Provides semantic similarity checking and improved content deduplication
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { detectLanguageByLexicon } from '../translator/lexicon';

// @ts-expect-error - langdetect has no TypeScript definitions
import * as langdetect from 'langdetect';

const POSTED_OUTPUTS_FILE = path.join(process.cwd(), 'posted-outputs.log');
const SIMILARITY_THRESHOLD = 0.85; // Jaccard similarity threshold for duplicates

/**
 * Normalize text for better duplicate detection
 * - Convert to lowercase
 * - Remove punctuation and extra whitespace
 * - Sort words to catch reordered duplicates
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .split(/\s+/)
    .sort() // Sort words to catch rephrased duplicates
    .join(' ');
}

/**
 * Calculate Jaccard similarity between two texts
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(/\s+/));
  const words2 = new Set(text2.split(/\s+/));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Check if content is too similar to previously posted content
 */
export function isContentDuplicate(newContent: string): boolean {
  try {
    if (!fs.existsSync(POSTED_OUTPUTS_FILE)) {
      return false;
    }

    const normalizedNew = normalizeText(newContent);
    const lines = fs.readFileSync(POSTED_OUTPUTS_FILE, 'utf8').split('\n').filter(line => line.trim());

    for (const line of lines) {
      // Extract content from log format: "timestamp [tweetId] content"
      const contentMatch = line.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[([^\]]+)\] (.+)$/);
      if (!contentMatch) continue;

      const existingContent = contentMatch[2];
      const normalizedExisting = normalizeText(existingContent);

      // Exact match check
      if (normalizedNew === normalizedExisting) {
        logger.warn(`Duplicate content detected (exact match): "${newContent}"`);
        return true;
      }

      // Similarity check
      const similarity = calculateSimilarity(normalizedNew, normalizedExisting);
      if (similarity >= SIMILARITY_THRESHOLD) {
        logger.warn(`Duplicate content detected (similarity: ${(similarity * 100).toFixed(1)}%): "${newContent}" vs "${existingContent}"`);
        return true;
      }
    }
  } catch (error) {
    logger.error(`Error checking content duplicates: ${error}`);
  }

  return false;
}

/**
 * Enhanced acceptability check that includes semantic duplicate detection
 */
export function isAcceptableWithSemanticCheck(
  finalResult: string,
  originalText: string,
  postedOutputs: string[]
): { acceptable: boolean; reason: string } {
  const trimmed = finalResult.trim();
  const originalTrimmed = originalText.trim();

  // Extract text content without tokens for quality checks
  const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;
  const textOnly = trimmed.replace(tokenPattern, '').trim();
  const originalTextOnly = originalTrimmed.replace(tokenPattern, '').trim();

  // Check if output is too short
  const tooShort = textOnly.length < Math.ceil(0.33 * originalTextOnly.length);
  const empty = textOnly.length <= 1;
  const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(textOnly);
  const duplicate = postedOutputs.includes(trimmed);
  const sameAsInput = textOnly === originalTextOnly;
  const problematicChar = ['/', ':', '.', '', ' '].includes(textOnly) || textOnly.startsWith('/');

  // NEW: Semantic duplicate check
  const semanticDuplicate = isContentDuplicate(trimmed);

  // Language detection (existing logic)
  let detectedLang = 'und';
  try {
    const lexiconResult = detectLanguageByLexicon(textOnly);
    detectedLang = lexiconResult || 'und';
    if (detectedLang === 'und') {
      const detections = langdetect.detect(textOnly);
      if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8) {
        detectedLang = detections[0].lang;
      }
    }
  } catch {
    // ignore
  }
  const notEnglish = detectedLang !== 'en';

  const unacceptableReasons: string[] = [];
  if (tooShort) unacceptableReasons.push(`Too short: ${textOnly.length} < 33% of input text (${originalTextOnly.length})`);
  if (empty) unacceptableReasons.push('Output is empty or too short (<=1 char)');
  if (punctuationOnly) unacceptableReasons.push('Output is only punctuation/symbols');
  if (duplicate) unacceptableReasons.push('Output is a duplicate of a previously posted tweet');
  if (semanticDuplicate) unacceptableReasons.push('Output is semantically similar to previously posted content');
  if (sameAsInput) unacceptableReasons.push('Output is the same as the input');
  if (notEnglish) unacceptableReasons.push(`Detected language is not English: ${detectedLang}`);
  if (problematicChar) unacceptableReasons.push('Output is a problematic character or starts with /');

  const acceptable = unacceptableReasons.length === 0;
  const reason = unacceptableReasons.join('; ');

  return { acceptable, reason };
}

/**
 * Add content to the posted outputs log with enhanced tracking
 */
export function logPostedContent(tweetId: string, content: string) {
  try {
    const entry = `${new Date().toISOString()} [${tweetId}] ${content}\n`;
    fs.appendFileSync(POSTED_OUTPUTS_FILE, entry, 'utf8');
    logger.debug(`Logged posted content for tweet ${tweetId}`);
  } catch (error) {
    logger.error(`Failed to log posted content: ${error}`);
  }
}

/**
 * Clean up old entries from posted outputs log to prevent it from growing too large
 */
export function prunePostedOutputs(maxEntries: number = 1000) {
  try {
    if (!fs.existsSync(POSTED_OUTPUTS_FILE)) return;

    const lines = fs.readFileSync(POSTED_OUTPUTS_FILE, 'utf8').split('\n').filter(line => line.trim());

    if (lines.length <= maxEntries) return;

    // Keep the most recent entries
    const recentLines = lines.slice(-maxEntries);
    fs.writeFileSync(POSTED_OUTPUTS_FILE, recentLines.join('\n') + '\n', 'utf8');

    logger.info(`Pruned posted outputs log from ${lines.length} to ${maxEntries} entries`);
  } catch (error) {
    logger.error(`Failed to prune posted outputs: ${error}`);
  }
}