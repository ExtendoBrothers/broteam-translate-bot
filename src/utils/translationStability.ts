/**
 * Translation stability checker
 * Detects when translation chains are producing repetitive or stuck results
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

// Use test-specific directory in test environment for parallel execution
const BASE_DIR = process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID
  ? path.join(process.cwd(), '.test-temp', `worker-${process.env.JEST_WORKER_ID}`)
  : process.cwd();

const STABILITY_LOG = path.join(BASE_DIR, 'translation-stability.log');
const STABILITY_WINDOW = 10; // Check last N translations
const SIMILARITY_THRESHOLD = 0.8; // Consider translations similar if >80% overlap

interface TranslationRecord {
  timestamp: string;
  tweetId: string;
  inputText: string;
  outputText: string;
  chain: string;
  attempt: number;
}

/**
 * Calculate word overlap similarity between two texts
 */
function textSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 2));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Check if recent translations show signs of instability
 */
export function checkTranslationStability(tweetId: string, inputText: string, outputText: string, chain: string, attempt: number): {
  isStable: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  try {
    // Log this translation
    const record: TranslationRecord = {
      timestamp: new Date().toISOString(),
      tweetId,
      inputText,
      outputText,
      chain,
      attempt
    };

    const logEntry = JSON.stringify(record) + '\n';
    fs.appendFileSync(STABILITY_LOG, logEntry, 'utf8');

    // Read recent translations
    if (!fs.existsSync(STABILITY_LOG)) {
      return { isStable: true, issues: [] };
    }

    const lines = fs.readFileSync(STABILITY_LOG, 'utf8')
      .split('\n')
      .filter(line => line.trim())
      .slice(-STABILITY_WINDOW);

    const recentTranslations = lines.map(line => {
      try {
        return JSON.parse(line) as TranslationRecord;
      } catch {
        return null;
      }
    }).filter(record => record !== null) as TranslationRecord[];

    // Check for repetitive outputs
    const recentOutputs = recentTranslations.map(r => r.outputText);
    const similarOutputs = recentOutputs.filter(output =>
      textSimilarity(output, outputText) > SIMILARITY_THRESHOLD
    );

    if (similarOutputs.length > 2) {
      issues.push(`High similarity to ${similarOutputs.length} recent translations`);
    }

    // Check for chain getting stuck
    const sameChainTranslations = recentTranslations.filter(r => r.chain === chain);
    if (sameChainTranslations.length > 3) {
      const similarInChain = sameChainTranslations.filter(r =>
        textSimilarity(r.outputText, outputText) > SIMILARITY_THRESHOLD
      );
      if (similarInChain.length > 2) {
        issues.push(`Chain "${chain}" producing repetitive results (${similarInChain.length} similar outputs)`);
      }
    }

    // Check for high attempt counts indicating translation difficulties
    if (attempt > 10) {
      issues.push(`High attempt count (${attempt}) suggests translation instability`);
    }

    // Check for input text repetition
    const sameInputCount = recentTranslations.filter(r => r.inputText === inputText).length;
    if (sameInputCount > 1) {
      issues.push(`Input text processed ${sameInputCount} times recently - possible retry loop`);
    }

  } catch (error) {
    logger.error(`Error checking translation stability: ${error}`);
  }

  return {
    isStable: issues.length === 0,
    issues
  };
}

/**
 * Clean up old stability log entries
 */
export function pruneStabilityLog(maxEntries: number = 1000) {
  try {
    if (!fs.existsSync(STABILITY_LOG)) return;

    const lines = fs.readFileSync(STABILITY_LOG, 'utf8')
      .split('\n')
      .filter(line => line.trim());

    if (lines.length <= maxEntries) return;

    const recentLines = lines.slice(-maxEntries);
    fs.writeFileSync(STABILITY_LOG, recentLines.join('\n') + '\n', 'utf8');

    logger.info(`Pruned stability log from ${lines.length} to ${maxEntries} entries`);
  } catch (error) {
    logger.error(`Failed to prune stability log: ${error}`);
  }
}