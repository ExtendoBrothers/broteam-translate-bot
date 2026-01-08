/**
 * Twitter Translation Bot Worker
 *
 * This worker fetches tweets from specified Twitter accounts, translates them through
 * multiple languages in sequence to create humorous/comedic results, and posts
 * the final English translations back to Twitter.
 *
 * Key features:
 * - Multi-language translation chains for comedic effect
 * - Quality checks to ensure acceptable output
 * - Retry logic for failed translations
 * - Rate limiting and circuit breakers for reliability
 * - Queue system for handling posting failures
 * - Monthly usage tracking for Twitter API limits
 */

import { fetchTweets } from '../twitter/fetchTweets';
import { postTweet } from '../twitter/postTweets';
import { TwitterClient } from '../twitter/client';
import { translateText } from '../translator/googleTranslate';
import { config } from '../config';
import { logger } from '../utils/logger';
import { tweetTracker } from '../utils/tweetTracker';
import { tweetQueue } from '../utils/tweetQueue';
import { rateLimitTracker } from '../utils/rateLimitTracker';
import { monthlyUsageTracker } from '../utils/monthlyUsageTracker';
import { postTracker } from '../utils/postTracker';
import { scoreHumor } from '../utils/humorScorer';
import fs from 'fs';
import path from 'path';
import { detectLanguageByLexicon } from '../translator/lexicon';

// @ts-expect-error - langdetect has no TypeScript definitions
import * as langdetect from 'langdetect';

// Helper function to evaluate if a translation result meets all quality criteria for posting.
// Checks for length, content validity, duplicates, language, and problematic characters.
// Returns whether acceptable and a string of failure reasons.
function isAcceptable(finalResult: string, originalText: string, postedOutputs: string[]): { acceptable: boolean; reason: string } {
  const trimmed = finalResult.trim();
  const originalTrimmed = originalText.trim();

  // Extract text content without tokens for quality checks
  const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;
  const textOnly = trimmed.replace(tokenPattern, '').trim();
  const originalTextOnly = originalTrimmed.replace(tokenPattern, '').trim();

  // Check if output is too short (less than 33% of input text length)
  const tooShort = textOnly.length < Math.ceil(0.33 * originalTextOnly.length);
  // Check if output is empty or nearly empty
  const empty = textOnly.length <= 1;
  // Check if output consists only of punctuation or symbols
  const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(textOnly);
  // Check if output is a duplicate of previously posted tweets
  const duplicate = postedOutputs.includes(trimmed);
  // Check if output is identical to input
  const sameAsInput = textOnly === originalTextOnly;
  // Check for problematic starting characters or empty-like strings
  const problematicChar = ['/', ':', '.', '', ' '].includes(textOnly) || textOnly.startsWith('/');

  // Detect language using langdetect library on text-only content (expects 'en' for English)
  // Try lexicon-based detection first for short texts
  const lexiconResult = detectLanguageByLexicon(textOnly);
  let detectedLang = lexiconResult || 'und';
  fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Lexicon detection for "${textOnly}": ${lexiconResult}\n`, 'utf8');
  
  // Only fallback to langdetect if lexicon was inconclusive (not enough words >2 chars)
  // If lexicon explicitly returned null (checked all languages, none matched), trust that result
  if (detectedLang === 'und' && textOnly.split(/\W+/).filter(w => w.length > 2).length > 0) {
    // Lexicon couldn't determine language, try langdetect as fallback
    try {
      const detections = langdetect.detect(textOnly);
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Langdetect fallback for "${textOnly}": ${JSON.stringify(detections)}\n`, 'utf8');
      if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8 && (!detections[1] || detections[1].prob <= detections[0].prob - 0.1)) {
        detectedLang = detections[0].lang;
      }
    } catch (e) {
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Langdetect error for "${textOnly}": ${e}\n`, 'utf8');
      logger.warn(`Language detection failed: ${e}`);
    }
  } else if (lexiconResult === null) {
    fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), '[DEBUG] Lexicon found no match (not English), skipping langdetect fallback\n', 'utf8');
  }
  const notEnglish = detectedLang !== 'en';

  // Collect all failure reasons
  const unacceptableReasons: string[] = [];
  if (tooShort) unacceptableReasons.push(`Too short: ${textOnly.length} < 33% of input text (${originalTextOnly.length})`);
  if (empty) unacceptableReasons.push('Output is empty or too short (<=1 char)');
  if (punctuationOnly) unacceptableReasons.push('Output is only punctuation/symbols');
  if (duplicate) unacceptableReasons.push('Output is a duplicate of a previously posted tweet');
  if (sameAsInput) unacceptableReasons.push('Output is the same as the input');
  if (notEnglish) unacceptableReasons.push(`Detected language is not English: ${detectedLang}`);
  if (problematicChar) unacceptableReasons.push('Output is a problematic character or starts with /');

  const acceptable = unacceptableReasons.length === 0;
  const reason = unacceptableReasons.join('; ');

  // Temporary debug log
  fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] isAcceptable: finalResult='${finalResult}', originalText='${originalText}', textOnly='${textOnly}', acceptable=${acceptable}, reason='${reason}'\n`, 'utf8');

  return { acceptable, reason };
}

// Helper function to check if text is all caps
function isAllCaps(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
}

// Helper to add delay between operations to respect rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Minimum delay between posts to avoid rapid-fire posting (15 minutes)
const MIN_POST_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let lastPostTime = 0;

// Circuit breaker to temporarily skip languages that are failing repeatedly.
// Prevents wasting time on broken language pairs.
interface CircuitState { failures: number; openedAt?: number; }
const circuit: Record<string, CircuitState> = {};
const FAILURE_THRESHOLD = 2; // Open circuit after 2 failures
const CIRCUIT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days cooldown

// Check if circuit is open for a language (skip if too many recent failures)
function isCircuitOpen(lang: string): boolean {
  const state = circuit[lang];
  if (!state) return false;
  if (state.failures < FAILURE_THRESHOLD) return false;
  if (!state.openedAt) return false;
  const elapsed = Date.now() - state.openedAt;
  if (elapsed >= CIRCUIT_COOLDOWN_MS) {
    // Cooldown expired; reset state
    circuit[lang] = { failures: 0, openedAt: undefined };
    return false;
  }
  return true;
}

// Record a failure for a language, potentially opening the circuit
function recordFailure(lang: string): void {
  const state = circuit[lang] || { failures: 0 };
  state.failures += 1;
  if (state.failures === FAILURE_THRESHOLD && !state.openedAt) {
    state.openedAt = Date.now();
    logger.warn(`Circuit opened for language ${lang} after ${state.failures} consecutive failures; skipping translations for ${Math.round(CIRCUIT_COOLDOWN_MS/60000)}m`);
  }
  circuit[lang] = state;
}

// Record a success for a language, resetting failure count
function recordSuccess(lang: string): void {
  const state = circuit[lang];
  if (state && state.failures > 0) {
    circuit[lang] = { failures: 0, openedAt: undefined };
    logger.info(`Circuit reset for language ${lang} after successful translation`);
  }
}

function jitteredTranslationDelay(baseMs = 5000) {
  // Add 0-1200ms jitter to spread requests
  return baseMs + Math.floor(Math.random() * 1200);
}

export interface WorkerResult {
  didWork: boolean;
  blockedByCooldown: boolean;
  blockedByPostLimit: boolean;
}

/**
 * Main worker function that orchestrates the entire tweet processing pipeline.
 * This function runs periodically to:
 * 1. Process any queued tweets from previous failed attempts
 * 2. Fetch new tweets from monitored accounts
 * 3. Translate tweets through multiple languages for comedic effect
 * 4. Post acceptable translations to Twitter
 * 5. Handle rate limits, errors, and retries appropriately
 */
export const translateAndPostWorker = async (): Promise<WorkerResult> => {
  logger.debug(`translateAndPostWorker entry at ${new Date().toISOString()}`);
  const client = new TwitterClient();
  let didWork = false;
  let blockedByCooldown = false;
  let blockedByPostLimit = false;
  const isDryRun = process.env.DRY_RUN_MODE === 'true';
  
  if (isDryRun) {
    logger.warn('='.repeat(80));
    logger.warn('DRY RUN MODE - No tweets will be posted');
    logger.warn('='.repeat(80));
  }

  // Translation steps log setup - logs each translation step for debugging
  const translationLogPath = path.resolve(__dirname, '../../translation-steps.log');
  function logTranslationStep(lang: string, text: string) {
    const entry = `${new Date().toISOString()} [${lang}] ${text.replace(/\n/g, ' ')}\n`;
    // Log every step to debug log
    try {
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] [${lang}] ${new Date().toISOString()} ${text.replace(/\n/g, ' ')}\n`, 'utf8');
    } catch (err) {
      logger.error('[ERROR] Failed to write to translation-debug.log:', err);
    }
    try {
      fs.appendFileSync(translationLogPath, entry, 'utf8');
    } catch (err) {
      logger.error('[ERROR] Failed to write to translation-steps.log:', err);
      try {
        fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[ERROR] [${lang}] ${new Date().toISOString()} ${err}\n`, 'utf8');
      } catch (e2) {
        logger.error('[ERROR] Failed to write error to translation-debug.log:', e2);
      }
    }
  }
  logger.debug(`Worker started at ${new Date().toISOString()}`);

  // Helper: retry translation with a different language if result is problematic
  async function retryWithDifferentLang(input: string, badResult: string, excludeLangs: string[]): Promise<string | null> {
    const allLangs = config.LANGUAGES.filter(l => !excludeLangs.includes(l));
    for (const lang of allLangs) {
      try {
        const result = await translateText(input, lang);
        if (result && result.trim() !== badResult && result.trim() !== '' && result.trim() !== '/') {
          logger.info(`Recovered translation using alt lang ${lang}: ${result.substring(0, 50)}...`);
          return result;
        }
      } catch (e) {
        logger.warn(`Retry with alt lang ${lang} failed: ${e}`);
      }
    }
    return null;
  }

  // Shuffle language order for more comedic, less deterministic results
  function shuffleArray<T>(array: T[]): T[] {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Helper function to get languages for translation chain based on mode
  function getTranslationLanguages(useOldschool: boolean): string[] {
    if (useOldschool && config.OLDSCHOOL_LANGUAGES.length > 0) {
      logger.info(`[OLDSCHOOL_MODE] Using fixed language order: ${config.OLDSCHOOL_LANGUAGES.join(', ')}`);
      return config.OLDSCHOOL_LANGUAGES;
    } else {
      // Select 12 random languages from the list
      const randomizedLangs = shuffleArray(config.LANGUAGES).slice(0, 12);
      logger.info(`[LANG_CHAIN] Random languages: ${randomizedLangs.join(', ')}`);
      return randomizedLangs;
    }
  }

  // Helper function to execute a translation chain with a specific mode
  async function executeTranslationChain(
    inputText: string,
    useOldschool: boolean,
    chainLabel: string
  ): Promise<{ result: string; attempted: boolean }> {
    const shouldUppercase = isAllCaps(inputText);
    let translationChain = shouldUppercase ? inputText.toLowerCase() : inputText;
    const selectedLangs = getTranslationLanguages(useOldschool);
    let currentSource = 'en';
    let consecutiveSame = 0;
    let previousResult = translationChain;
    let translationAttempted = false;

    for (const lang of selectedLangs) {
      if (isCircuitOpen(lang)) {
        logger.warn(`[${chainLabel}] Skipping language ${lang} due to open circuit`);
        continue;
      }
      try {
        let result = await translateText(translationChain, lang, currentSource);
        const trimmedResult = result.trim();
        if (['/', ':', '.', '', ' '].includes(trimmedResult) || trimmedResult.startsWith('/')) {
          logger.warn(`[${chainLabel}] Translation for ${lang} returned problematic result: '${result}'. Retrying with a different language.`);
          const altResult = await retryWithDifferentLang(translationChain, trimmedResult, [lang]);
          if (altResult) {
            result = altResult;
          }
        }
        translationChain = result;
        if (result === previousResult) {
          consecutiveSame++;
          if (consecutiveSame >= 4) {
            logger.warn(`[${chainLabel}] Chain stuck: 4 consecutive same results. Failing chain.`);
            translationAttempted = false;
            break;
          }
        } else {
          consecutiveSame = 0;
        }
        previousResult = result;
        currentSource = lang;
        recordSuccess(lang);
        translationAttempted = true;
        logger.info(`[${chainLabel}] Translated through ${lang}: ${translationChain.substring(0, 50)}...`);
        logTranslationStep(`${chainLabel}-${lang}`, translationChain);
      } catch (error: unknown) {
        logger.error(`[${chainLabel}] Failed to translate for ${lang}: ${error}`);
        recordFailure(lang);
      }
      await delay(jitteredTranslationDelay());
    }

    // Final step: translate back to English if we're not already in English
    if (currentSource !== 'en' && translationAttempted) {
      try {
        logger.info(`[${chainLabel}] Final step: translating back to English from ${currentSource}`);
        const finalEnglish = await translateText(translationChain, 'en', currentSource);
        translationChain = finalEnglish;
        if (shouldUppercase) {
          translationChain = translationChain.toUpperCase();
        }
        logger.info(`[${chainLabel}] Final English result: ${translationChain.substring(0, 50)}...`);
        logTranslationStep(`${chainLabel}-final-en`, translationChain);
      } catch (error: unknown) {
        logger.error(`[${chainLabel}] Failed to translate back to English: ${error}`);
      }
    }

    if (shouldUppercase) {
      if (translationAttempted) {
        translationChain = translationChain.toUpperCase();
      } else {
        translationChain = inputText;
      }
    }

    return { result: translationChain, attempted: translationAttempted };
  }

  // Helper function to execute a translation chain with retries until acceptable
  async function executeChainWithRetries(
    inputText: string,
    useOldschool: boolean,
    chainLabel: string,
    postedOutputs: string[],
    maxRetries: number = 33
  ): Promise<{ result: string; acceptable: boolean; attempts: number }> {
    let attempts = 0;
    let acceptable = false;
    let finalResult = inputText;
    const englishResults: string[] = []; // Collect English results for fallback

    while (!acceptable && attempts < maxRetries) {
      attempts++;
      logger.info(`[${chainLabel}] Attempt ${attempts}/${maxRetries}...`);

      // Execute translation chain
      const chainResult = await executeTranslationChain(inputText, useOldschool, chainLabel);
      
      if (!chainResult.attempted) {
        logger.warn(`[${chainLabel}] Chain failed to execute translations, retrying...`);
        continue;
      }

      finalResult = chainResult.result;
      const check = isAcceptable(finalResult, inputText, postedOutputs);
      acceptable = check.acceptable;

      // Log detailed evaluation of each criterion for debugging (using same logic as isAcceptable)
      const trimmed = finalResult.trim();
      const originalTrimmed = inputText.trim();
      const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;
      const textOnly = trimmed.replace(tokenPattern, '').trim();
      const originalTextOnly = originalTrimmed.replace(tokenPattern, '').trim();
      
      const tooShort = textOnly.length < Math.ceil(0.33 * originalTextOnly.length);
      const empty = textOnly.length <= 1;
      const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(textOnly);
      const duplicate = postedOutputs.includes(trimmed);
      const sameAsInput = textOnly === originalTextOnly;
      const problematicChar = ['/', ':', '.', '', ' '].includes(textOnly) || textOnly.startsWith('/');
      
      let detectedLang = detectLanguageByLexicon(textOnly) || 'und';
      if (detectedLang === 'und') {
        try {
          const detections = langdetect.detect(textOnly);
          fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG][${chainLabel}] Langdetect fallback for attempt ${attempts} "${textOnly}": ${JSON.stringify(detections)}\n`, 'utf8');
          if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8 && (!detections[1] || detections[1].prob <= detections[0].prob - 0.1)) {
            detectedLang = detections[0].lang;
          }
        } catch {
          // ignore
        }
      }
      const notEnglish = detectedLang !== 'en';
      
      // Collect English results for fallback selection
      if (detectedLang === 'en') {
        englishResults.push(finalResult);
      }
      
      try {
        fs.appendFileSync(
          path.join(process.cwd(), 'translation-logs', 'translation-debug.log'),
          `[DEBUG][${chainLabel}] Attempt ${attempts} evaluation: acceptable=${check.acceptable}\n` +
          `Length check: ${tooShort ? 'FAIL' : 'pass'} (${textOnly.length}/${originalTextOnly.length})\n` +
          `Empty check: ${empty ? 'FAIL' : 'pass'}\n` +
          `Punctuation check: ${punctuationOnly ? 'FAIL' : 'pass'}\n` +
          `Duplicate check: ${duplicate ? 'FAIL' : 'pass'}\n` +
          `Same as input check: ${sameAsInput ? 'FAIL' : 'pass'}\n` +
          `Problematic char check: ${problematicChar ? 'FAIL' : 'pass'}\n` +
          `Language check: ${notEnglish ? 'FAIL' : 'pass'} (detected: ${detectedLang})\n` +
          `Result: '${finalResult}'\n\n`,
          'utf8'
        );
      } catch (err) {
        logger.error(`[ERROR][${chainLabel}] Failed to write evaluation to translation-debug.log:`, err);
      }

      if (acceptable) {
        logger.info(`[${chainLabel}] ✓ Acceptable result achieved after ${attempts} attempt(s)`);
      } else {
        logger.warn(`[${chainLabel}] Attempt ${attempts} unacceptable: ${check.reason}`);
      }
    }

    if (!acceptable) {
      logger.error(`[${chainLabel}] Failed to get acceptable result after ${maxRetries} attempts`);
      
      // If we have English results, pick the funniest/most unexpected one
      if (englishResults.length > 0) {
        let bestScore = -1;
        let funniest = englishResults[0];
        for (const res of englishResults) {
          const diff = differenceScore(res, inputText);
          const unexp = unexpectednessScore(res, inputText);
          const score = diff + unexp * 2; // Weight unexpectedness higher
          if (score > bestScore) {
            bestScore = score;
            funniest = res;
          }
        }
        logger.warn(`[${chainLabel}] Using funniest English result from ${englishResults.length} candidates (score: ${bestScore.toFixed(2)})`);
        finalResult = funniest;
      } else {
        logger.warn(`[${chainLabel}] No English results found, using last attempt result`);
      }
    }

    return { result: finalResult, acceptable, attempts };
  }

  // Helper function to collect multiple acceptable results from random chain
  async function collectMultipleRandomResults(
    inputText: string,
    postedOutputs: string[],
    targetCount: number = 3,
    maxTotalAttempts: number = 33
  ): Promise<Array<{ result: string; attempts: number }>> {
    const acceptableResults: Array<{ result: string; attempts: number }> = [];
    const englishResults: Array<{ result: string; attempts: number }> = []; // Track all English results for fallback
    let totalAttempts = 0;
    
    logger.info(`[RANDOM_COLLECT] Collecting ${targetCount} acceptable random chain results...`);
    
    while (acceptableResults.length < targetCount && totalAttempts < maxTotalAttempts) {
      totalAttempts++;
      logger.info(`[RANDOM_COLLECT] Attempt ${totalAttempts}/${maxTotalAttempts} (${acceptableResults.length}/${targetCount} collected)...`);
      
      // Execute random translation chain
      const chainResult = await executeTranslationChain(inputText, false, 'RANDOM_COLLECT');
      
      if (!chainResult.attempted) {
        logger.warn('[RANDOM_COLLECT] Chain failed to execute translations, retrying...');
        continue;
      }
      
      const check = isAcceptable(chainResult.result, inputText, postedOutputs);
      
      // Log detailed evaluation of each criterion for debugging (same as executeChainWithRetries)
      const trimmed = chainResult.result.trim();
      const originalTrimmed = inputText.trim();
      const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;
      const textOnly = trimmed.replace(tokenPattern, '').trim();
      const originalTextOnly = originalTrimmed.replace(tokenPattern, '').trim();
      
      const tooShort = textOnly.length < Math.ceil(0.33 * originalTextOnly.length);
      const empty = textOnly.length <= 1;
      const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(textOnly);
      const duplicate = postedOutputs.includes(trimmed);
      const sameAsInput = textOnly === originalTextOnly;
      const problematicChar = ['/', ':', '.', '', ' '].includes(textOnly) || textOnly.startsWith('/');
      
      let detectedLang = detectLanguageByLexicon(textOnly) || 'und';
      if (detectedLang === 'und') {
        try {
          const detections = langdetect.detect(textOnly);
          if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8 && (!detections[1] || detections[1].prob <= detections[0].prob - 0.1)) {
            detectedLang = detections[0].lang;
          }
        } catch {
          // ignore
        }
      }
      const notEnglish = detectedLang !== 'en';
      
      // Collect English results for potential fallback
      if (detectedLang === 'en') {
        englishResults.push({ result: chainResult.result, attempts: totalAttempts });
      }
      
      try {
        fs.appendFileSync(
          path.join(process.cwd(), 'translation-logs', 'translation-debug.log'),
          `[DEBUG][RANDOM_COLLECT] Attempt ${totalAttempts} evaluation: acceptable=${check.acceptable}\n` +
          `Length check: ${tooShort ? 'FAIL' : 'pass'} (${textOnly.length}/${originalTextOnly.length})\n` +
          `Empty check: ${empty ? 'FAIL' : 'pass'}\n` +
          `Punctuation check: ${punctuationOnly ? 'FAIL' : 'pass'}\n` +
          `Duplicate check: ${duplicate ? 'FAIL' : 'pass'}\n` +
          `Same as input check: ${sameAsInput ? 'FAIL' : 'pass'}\n` +
          `Problematic char check: ${problematicChar ? 'FAIL' : 'pass'}\n` +
          `Language check: ${notEnglish ? 'FAIL' : 'pass'} (detected: ${detectedLang})\n` +
          `Result: '${chainResult.result}'\n\n`,
          'utf8'
        );
      } catch (err) {
        logger.error('[ERROR][RANDOM_COLLECT] Failed to write evaluation to translation-debug.log:', err);
      }
      
      if (check.acceptable) {
        acceptableResults.push({ result: chainResult.result, attempts: totalAttempts });
        logger.info(`[RANDOM_COLLECT] ✓ Collected result ${acceptableResults.length}/${targetCount}`);
      } else {
        logger.warn(`[RANDOM_COLLECT] Attempt ${totalAttempts} unacceptable: ${check.reason}`);
      }
    }
    
    // If we didn't get enough acceptable results, use fallback selection from English results
    if (acceptableResults.length < targetCount) {
      logger.warn(`[RANDOM_COLLECT] Only collected ${acceptableResults.length}/${targetCount} acceptable results after ${totalAttempts} attempts`);
      
      if (englishResults.length > 0) {
        const needed = targetCount - acceptableResults.length;
        logger.info(`[RANDOM_COLLECT] Selecting ${needed} most funny/unexpected results from ${englishResults.length} English candidates...`);
        
        // Score all English results by funniness/unexpectedness
        const scoredResults = englishResults.map(r => {
          const diff = differenceScore(r.result, inputText);
          const unexp = unexpectednessScore(r.result, inputText);
          const score = diff + unexp * 2; // Weight unexpectedness higher
          return { ...r, score };
        });
        
        // Sort by score descending and take top N
        scoredResults.sort((a, b) => b.score - a.score);
        const selectedFallbacks = scoredResults.slice(0, needed);
        
        for (const fallback of selectedFallbacks) {
          acceptableResults.push({ result: fallback.result, attempts: fallback.attempts });
          logger.info(`[RANDOM_COLLECT] ✓ Added fallback result (score: ${fallback.score.toFixed(2)}) from attempt ${fallback.attempts}`);
        }
      } else {
        logger.error('[RANDOM_COLLECT] No English results available for fallback selection!');
      }
    } else {
      logger.info(`[RANDOM_COLLECT] ✓ Successfully collected ${targetCount} acceptable results`);
    }
    
    return acceptableResults;
  }

  // Periodically prune processed tweet IDs to keep storage healthy
  tweetTracker.prune(90, 50000);
  // Check 24-hour post limit status
  const remainingPosts = postTracker.getRemainingPosts();
  logger.info(`Post limit status: ${postTracker.getPostCount24h()}/17 posts in last 24h, ${remainingPosts} remaining`);
        
  if (!postTracker.canPost()) {
    const waitSeconds = postTracker.getTimeUntilNextSlot();
    logger.warn(`24-hour post limit reached (17/17). Next slot available in ${waitSeconds} seconds`);
  }
        
  // First, try to post any queued tweets from previous runs
  logger.info(`[QUEUE_DEBUG] Starting post queue processing. Queue size: ${tweetQueue.size()}`);
  while (!tweetQueue.isEmpty() && postTracker.canPost()) {
    logger.info(`[QUEUE_DEBUG] Queue not empty and can post. Queue size: ${tweetQueue.size()}`);
    // Check if we're rate limited for posting
    if (rateLimitTracker.isRateLimited('post')) {
      const waitSeconds = rateLimitTracker.getSecondsUntilReset('post');
      logger.info(`[QUEUE_DEBUG] Cannot post queued tweets - rate limited for ${waitSeconds} more seconds`);
      blockedByPostLimit = true;
      break;
    }

    const queuedTweet = tweetQueue.peek();
    logger.info(`[QUEUE_DEBUG] Peeked queued tweet: ${queuedTweet ? queuedTweet.sourceTweetId : 'none'}, attemptCount: ${queuedTweet ? queuedTweet.attemptCount : 'n/a'}`);
    if (!queuedTweet) {
      logger.info('[QUEUE_DEBUG] No queued tweet found after peek, breaking loop.');
      break;
    }

    try {
      // Enforce minimum interval between posts
      const timeSinceLastPost = Date.now() - lastPostTime;
      logger.info(`[QUEUE_DEBUG] Time since last post: ${timeSinceLastPost}ms, lastPostTime: ${lastPostTime}`);
      if (lastPostTime > 0 && timeSinceLastPost < MIN_POST_INTERVAL_MS) {
        const waitMs = MIN_POST_INTERVAL_MS - timeSinceLastPost;
        logger.info(`[QUEUE_DEBUG] Enforcing minimum post interval. Waiting ${Math.ceil(waitMs / 1000)}s before next post`);
        blockedByPostLimit = true;
        break;
      }

      logger.info(`[QUEUE_DEBUG] Posting queued tweet ${queuedTweet.sourceTweetId} (attempt ${queuedTweet.attemptCount + 1})`);
      
      // Check for duplicates before posting queued tweet
      const postedLogPath = path.resolve(__dirname, '../../posted-outputs.log');
      let postedOutputs: string[] = [];
      try {
        if (fs.existsSync(postedLogPath)) {
          postedOutputs = fs.readFileSync(postedLogPath, 'utf8').split('\n').filter((line: string) => Boolean(line)).map((line: string) => line.replace(/^.*?\] /, ''));
        }
      } catch (e) {
        logger.warn(`Could not read posted-outputs.log for duplicate check: ${e}`);
      }
      
      // CRITICAL: Check if already processed before posting from queue
      if (tweetTracker.isProcessed(queuedTweet.sourceTweetId)) {
        logger.info(`[QUEUE_DEBUG] Skipping queued tweet ${queuedTweet.sourceTweetId} - already processed`);
        tweetQueue.dequeue();
        logger.info(`[QUEUE_DEBUG] Dequeued already-processed tweet. New queue size: ${tweetQueue.size()}`);
        continue;
      }
      
      const trimmedQueued = queuedTweet.finalTranslation.trim();
      if (postedOutputs.includes(trimmedQueued)) {
        logger.info(`[QUEUE_DEBUG] Skipping queued tweet ${queuedTweet.sourceTweetId} - content is duplicate of previously posted tweet`);
        tweetQueue.dequeue();
        logger.info(`[QUEUE_DEBUG] Dequeued duplicate tweet. New queue size: ${tweetQueue.size()}`);
        continue;
      }
      
      if (isDryRun) {
        logger.warn(`[DRY_RUN] Would have posted queued tweet ${queuedTweet.sourceTweetId}: ${queuedTweet.finalTranslation}`);
      } else {
        await postTweet(client, queuedTweet.finalTranslation, queuedTweet.sourceTweetId);
        logger.info(`[QUEUE_DEBUG] Successfully posted queued tweet ${queuedTweet.sourceTweetId}`);
      }
      
      // Mark as processed after successful post (postTweet no longer does this to prevent race conditions)
      tweetTracker.markProcessed(queuedTweet.sourceTweetId);
      logger.info(`[QUEUE_DEBUG] Marked ${queuedTweet.sourceTweetId} as processed after successful queue post`);
                
      // Record the post - tweet tracker updated inside postTweet
      postTracker.recordPost();
      
      // Log posted output for duplicate tracking
      try {
        const postedLogPath = path.resolve(__dirname, '../../posted-outputs.log');
        fs.appendFileSync(postedLogPath, `${new Date().toISOString()} [${queuedTweet.sourceTweetId}] ${queuedTweet.finalTranslation}\n`, 'utf8');
      } catch (err) {
        logger.warn(`Failed to log posted queued output: ${err}`);
      }
      
      tweetQueue.dequeue();
      lastPostTime = Date.now();
      logger.info(`[QUEUE_DEBUG] Dequeued tweet. New queue size: ${tweetQueue.size()}`);
                
      // Add delay between posts
      await delay(5000);
    } catch (error: unknown) {
      // If rate limit hit (429 or 403), stop processing queue
      const err = error as { code?: number; message?: string };
      if (err?.code === 429 || err?.code === 403 || err?.message?.includes('429') || err?.message?.includes('403')) {
        logger.error(`[QUEUE_DEBUG] Rate limit hit (${err?.code || 'unknown'}) while posting queued tweet. Will retry next run.`);
        tweetQueue.incrementAttempt();
        
        // Check if too many attempts after rate limit
        const updatedQueuedTweet = tweetQueue.peek();
        if (updatedQueuedTweet && updatedQueuedTweet.attemptCount >= 5) {
          logger.error(`[QUEUE_DEBUG] Removing rate-limited tweet ${updatedQueuedTweet.sourceTweetId} from queue after ${updatedQueuedTweet.attemptCount} failed attempts`);
          tweetQueue.dequeue();
          logger.info(`[QUEUE_DEBUG] Dequeued rate-limited tweet after too many failures. New queue size: ${tweetQueue.size()}`);
        }
        
        blockedByPostLimit = true;
        break;
      }
      // For other errors, increment attempt count but keep in queue
      logger.error(`[QUEUE_DEBUG] Failed to post queued tweet ${queuedTweet.sourceTweetId}: ${error}`);
      tweetQueue.incrementAttempt();
                
      // If too many failures, remove from queue and let it be re-fetched/retried later
      const updatedQueuedTweet = tweetQueue.peek();
      if (updatedQueuedTweet && updatedQueuedTweet.attemptCount >= 5) {
        logger.error(`[QUEUE_DEBUG] Removing tweet ${updatedQueuedTweet.sourceTweetId} from queue after ${updatedQueuedTweet.attemptCount} failed attempts - will retry on next fetch`);
        tweetQueue.dequeue();
        logger.info(`[QUEUE_DEBUG] Dequeued tweet after too many failures. New queue size: ${tweetQueue.size()}`);
        // Do NOT mark as processed - allow retry in future runs
      }
      break;
    }
  }

  // Check if blocked by pre-existing cooldown before deciding about fetch
  const wasBlockedBefore = rateLimitTracker.isRateLimited('timeline');

  // Always fetch (worker runs every 30 minutes)
  // fetchTweets() handles monthly Twitter API limit internally and uses fallbacks
  let tweets: Awaited<ReturnType<typeof fetchTweets>> = [];
  const monthKey = monthlyUsageTracker.getCurrentMonthKey();
  const used = monthlyUsageTracker.getFetchCount(monthKey);
  const limit = config.MONTHLY_FETCH_LIMIT;
    
  logger.info(`Fetching tweets (Twitter API usage: ${used}/${limit} this month)`);
  tweets = await fetchTweets(isDryRun);
    
  // Note: monthlyUsageTracker is incremented inside fetchTweets() only when Twitter API is actually used

  if (tweets.length === 0) {
    logger.info('No new tweets to process');
    // Only mark as blocked if cooldown existed BEFORE the fetch attempt
    blockedByCooldown = wasBlockedBefore;
    return { didWork: false, blockedByCooldown, blockedByPostLimit };
  }
        
  logger.info(`Processing ${tweets.length} new tweet(s)`);
        
  for (const tweet of tweets) {
    {
      logger.info(`Processing tweet ${tweet.id}: ${tweet.text.substring(0, 50)}...`);

      // Log original tweet input to a dedicated file for easy retry
      const inputLogPath = path.resolve(__dirname, '../../tweet-inputs.log');
      try {
        fs.appendFileSync(inputLogPath, `${new Date().toISOString()} [${tweet.id}] ${tweet.text}\n`, 'utf8');
      } catch (err) {
        logger.warn(`Failed to log tweet input: ${err}`);
      }

      // Always log the original tweet text as the first step for traceability
      logTranslationStep('original', tweet.text);

      // Load posted outputs for duplicate checking
      const postedLogPath = path.resolve(__dirname, '../../posted-outputs.log');
      let postedOutputs: string[] = [];
      try {
        if (fs.existsSync(postedLogPath)) {
          postedOutputs = fs.readFileSync(postedLogPath, 'utf8').split('\n').filter((line: string) => Boolean(line)).map((line: string) => line.replace(/^.*?\] /, ''));
        }
      } catch (e) {
        logger.warn(`Could not read posted-outputs.log: ${e}`);
      }

      // Collect multiple random chain results and one oldschool result
      logger.info('[MULTI_CHAIN] Collecting 3 random chain results + 1 oldschool result...');
      
      logger.info('[MULTI_CHAIN] === Collecting 3 RANDOM chain results ===');
      const randomResults = await collectMultipleRandomResults(tweet.text, postedOutputs, 3, 33);
      
      logger.info('[MULTI_CHAIN] === Running OLDSCHOOL chain (single run - deterministic) ===');
      const oldschoolChainResult = await executeChainWithRetries(tweet.text, true, 'OLDSCHOOL', postedOutputs, 1);

      // Prepare all candidates for humor comparison
      const allCandidates: Array<{ result: string; source: string; attempts: number; acceptable: boolean }> = [
        ...randomResults.map((r, idx) => ({ result: r.result, source: `RANDOM_${idx + 1}`, attempts: r.attempts, acceptable: true })),
        { result: oldschoolChainResult.result, source: 'OLDSCHOOL', attempts: oldschoolChainResult.attempts, acceptable: oldschoolChainResult.acceptable }
      ];

      logger.info(`[MULTI_CHAIN] Comparing ${allCandidates.length} candidates (${randomResults.length} random + 1 oldschool)...`);

      // Detect language of each candidate and only score English results
      const originalText = tweet.text; // Store for tie-breaker calculations
      const scoredCandidates = await Promise.all(
        allCandidates.map(async (candidate) => {
          // Detect language
          const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;
          const textOnly = candidate.result.replace(tokenPattern, '').trim();
          let detectedLang = detectLanguageByLexicon(textOnly) || 'und';
          
          if (detectedLang === 'und') {
            try {
              const detections = langdetect.detect(textOnly);
              if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8) {
                detectedLang = detections[0].lang;
              }
            } catch {
              // ignore
            }
          }
          
          // Only score English results (humor model is trained on English)
          const isEnglish = detectedLang === 'en';
          const humorScore = isEnglish 
            ? await scoreHumor(candidate.result)
            : { score: 0, label: 'NOT_SCORED_NON_ENGLISH', isHumorous: false };
          
          // Calculate secondary metrics for tie-breaking
          const diffScore = differenceScore(candidate.result, originalText);
          const unexpScore = unexpectednessScore(candidate.result, originalText);
          const tieBreaker = diffScore + unexpScore * 2; // Same formula as fallback selection
          
          return { ...candidate, humorScore, isEnglish, tieBreaker, unifiedHumorScore: 0 };
        })
      );

      // Log all scores (after heuristic bonuses applied)
      for (const candidate of scoredCandidates) {
        logger.info(`[MULTI_CHAIN] ${candidate.source}: score=${candidate.humorScore.score.toFixed(3)} (${candidate.humorScore.label}) lang=${candidate.isEnglish ? 'en' : 'non-en'} acceptable=${candidate.acceptable}`);
      }

      // Log to debug file
      try {
        fs.appendFileSync(
          path.join(process.cwd(), 'translation-logs', 'translation-debug.log'),
          `[HUMOR_COMPARISON] Tweet ${tweet.id} - Comparing ${scoredCandidates.length} candidates:\n` +
          scoredCandidates.map(c => 
            `  ${c.source}: score=${c.humorScore.score.toFixed(3)}, label=${c.humorScore.label}, lang=${c.isEnglish ? 'en' : 'non-en'}, acceptable=${c.acceptable}\n` +
            `    Result: "${c.result}"\n`
          ).join('') + '\n',
          'utf8'
        );
      } catch (err) {
        logger.error('[ERROR] Failed to write humor comparison to translation-debug.log:', err);
      }
      scoredCandidates.forEach(candidate => {
        const originalScore = candidate.humorScore.score;
        let bonus = 0;
        const bonusDetails = [];
        
        // Heuristic 4: Strong secondary preference for OLDSCHOOL
        if (candidate.source === 'OLDSCHOOL') {
          bonus += 0.05; // Significant boost for OLDSCHOOL
          bonusDetails.push('OLDSCHOOL +0.05');
        }
        
        // Heuristic 2: Favor longer results (small bonus per character)
        const lengthBonus = Math.max(0, (candidate.result.length - 30) * 0.0005); // ~0.05 bonus for 100+ chars
        if (lengthBonus > 0) {
          bonus += lengthBonus;
          bonusDetails.push(`length +${lengthBonus.toFixed(4)}`);
        }
        
        // Heuristic 5: Coherence bonus - reward complete sentences/phrases
        const text = candidate.result.trim();
        const sentenceBonus = (() => {
          // Check for sentence endings
          const hasSentenceEndings = /[.!?]$/.test(text);
          // Check for basic subject-verb structure (simplified)
          const words = text.toLowerCase().split(/\s+/);
          const hasVerbs = words.some(word => ['is', 'are', 'was', 'were', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might'].includes(word));
          const coherenceScore = (hasSentenceEndings ? 0.01 : 0) + (hasVerbs ? 0.01 : 0);
          return coherenceScore;
        })();
        if (sentenceBonus > 0) {
          bonus += sentenceBonus;
          bonusDetails.push(`coherence +${sentenceBonus.toFixed(3)}`);
        }
        
        // Heuristic 6: Garbage penalty - penalize low word diversity
        const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        const uniqueWords = new Set(words);
        const diversityRatio = uniqueWords.size / words.length;
        const garbagePenalty = diversityRatio < 0.7 ? -0.02 : 0; // Penalty for <70% unique words
        if (garbagePenalty < 0) {
          bonus += garbagePenalty;
          bonusDetails.push(`garbage ${garbagePenalty.toFixed(3)}`);
        }
        
        // Heuristic 7: Contradiction bonus - reward contradictory concepts
        const contradictionBonus = (() => {
          const lowerText = text.toLowerCase();
          // Simple contradiction patterns
          const contradictions = [
            /\b(nice|good|delicious)\b.*\b(crime|bad|evil)\b/,
            /\b(smart|intelligent)\b.*\b(stupid|dumb)\b/,
            /\b(fast|quick)\b.*\b(slow)\b/,
            /\b(hot)\b.*\b(cold)\b/
          ];
          const hasContradiction = contradictions.some(pattern => pattern.test(lowerText));
          return hasContradiction ? 0.015 : 0;
        })();
        if (contradictionBonus > 0) {
          bonus += contradictionBonus;
          bonusDetails.push(`contradiction +${contradictionBonus.toFixed(3)}`);
        }
        
        // Heuristic 8: Self-deprecation bonus - reward self-critical humor
        const selfDeprecationBonus = (() => {
          const lowerText = text.toLowerCase();
          // Look for first-person + negative self-description
          const hasFirstPerson = /\b(i|me|my|mine)\b/.test(lowerText);
          const hasNegativeSelf = /\b(stupid|dumb|autistic|idiot|moron|retard)\b/.test(lowerText);
          const hasSelfCriticism = /\b(gave myself|have given myself|am)\b.*\b(autism|stupid|dumb)\b/.test(lowerText);
          return (hasFirstPerson && hasNegativeSelf) || hasSelfCriticism ? 0.012 : 0;
        })();
        if (selfDeprecationBonus > 0) {
          bonus += selfDeprecationBonus;
          bonusDetails.push(`self-deprecating +${selfDeprecationBonus.toFixed(3)}`);
        }
        
        // Heuristic 9: Absurdity bonus - reward impossible or extreme concepts
        const absurdityBonus = (() => {
          const lowerText = text.toLowerCase();
          // Words indicating impossibility or extremes
          const absurdWords = /\b(impossible|absurd|nonsensical|ridiculous|insane|crazy|delusional)\b/;
          const extremeWords = /\b(million|billion|trillion|infinite|endless|eternal|ultimate|supreme)\b/;
          const impossibleConcepts = /\b(flying pigs|square circle|cold heat|dark light)\b/;
          
          const hasAbsurdWords = absurdWords.test(lowerText);
          const hasExtremeWords = extremeWords.test(lowerText);
          const hasImpossible = impossibleConcepts.test(lowerText);
          
          return (hasAbsurdWords ? 0.008 : 0) + (hasExtremeWords ? 0.005 : 0) + (hasImpossible ? 0.010 : 0);
        })();
        if (absurdityBonus > 0) {
          bonus += absurdityBonus;
          bonusDetails.push(`absurdity +${absurdityBonus.toFixed(3)}`);
        }
        
        // Apply bonus (cap at 0.1 total to avoid over-weighting)
        const appliedBonus = Math.min(bonus, 0.1);
        
        // Create unified humor scale: higher = more likely funny
        // Humorous results: use confidence as-is (higher = funnier)
        // Non-humorous results: use 1 - confidence (lower confidence = more potentially funny)
        const baseHumorScore = candidate.humorScore.isHumorous 
          ? candidate.humorScore.score 
          : (1 - candidate.humorScore.score);
        
        candidate.unifiedHumorScore = Math.min(1.0, baseHumorScore + appliedBonus);
        
        // Log the heuristic application
        if (bonusDetails.length > 0) {
          logger.info(`[HEURISTIC] ${candidate.source}: ${baseHumorScore.toFixed(3)} -> ${candidate.unifiedHumorScore.toFixed(3)} (${bonusDetails.join(', ')})`);
        }
      });
      // Select the funniest result using unified humor scores
      // Higher unified score = more likely funny (consistent for all results)
      let bestCandidate = scoredCandidates[0];
      
      for (const candidate of scoredCandidates) {
        // Prioritize English results over non-English
        if (candidate.isEnglish && !bestCandidate.isEnglish) {
          bestCandidate = candidate;
          continue;
        }
        // If best is English but current isn't, skip current
        if (!candidate.isEnglish && bestCandidate.isEnglish) {
          continue;
        }
        
        // Both are English, compare unified humor scores (higher = better)
        if (candidate.unifiedHumorScore > bestCandidate.unifiedHumorScore) {
          bestCandidate = candidate;
        }
        // If unified scores are equal, use tie-breaker (more unexpected/different = better)
        else if (candidate.unifiedHumorScore === bestCandidate.unifiedHumorScore && candidate.tieBreaker > bestCandidate.tieBreaker) {
          bestCandidate = candidate;
        }
      }

      logger.info(`[MULTI_CHAIN] ✨ Selected ${bestCandidate.source}: ${bestCandidate.humorScore.label} (unified score: ${bestCandidate.unifiedHumorScore.toFixed(3)})`);

      // Save feedback data for manual review
      try {
        const feedbackEntry = {
          timestamp: new Date().toISOString(),
          tweetId: tweet.id,
          originalText: tweet.text,
          candidates: scoredCandidates.map(c => ({
            source: c.source,
            result: c.result,
            humorScore: c.humorScore.score,
            unifiedHumorScore: c.unifiedHumorScore,
            humorLabel: c.humorScore.label,
            isEnglish: c.isEnglish,
            tieBreaker: c.tieBreaker,
            acceptable: c.acceptable
          })),
          botSelected: bestCandidate.source,
          selectedResult: bestCandidate.result,
          selectedScore: bestCandidate.unifiedHumorScore,
          userFeedback: null
        };

        const feedbackPath = path.join(process.cwd(), 'feedback-data.jsonl');
        fs.appendFileSync(feedbackPath, JSON.stringify(feedbackEntry) + '\n', 'utf8');
        
        // Check if feedback threshold reached for analysis (every 5 feedbacks)
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { execSync } = require('child_process');
          execSync('node scripts/check-feedback-threshold.js', { 
            stdio: 'inherit',
            cwd: process.cwd()
          });
        } catch (checkErr) {
          logger.warn('[FEEDBACK] Failed to run threshold check:', checkErr);
        }
      } catch (err) {
        logger.error('[ERROR] Failed to save feedback data:', err);
      }

      const finalResult = bestCandidate.result;
      const acceptable = bestCandidate.acceptable || randomResults.length > 0; // Accept if we got any random results
      const initialCheck = { acceptable, reason: `Selected ${bestCandidate.source} via humor scoring from ${scoredCandidates.length} candidates` };
      const translationAttempted = true;
      const selectedChain = bestCandidate.source;
      const chosenHumorScore = bestCandidate.humorScore.score;

      const translationLogSteps: { lang: string, text: string }[] = [];

      // Log the initial result evaluation (if we have one)
      if (acceptable && translationAttempted) {
        try {
          fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Final result evaluation: acceptable=${acceptable}\nSelected chain: ${selectedChain}\nfinalResult='${finalResult}'\nReason: ${initialCheck.reason}\n`, 'utf8');
        } catch (err) {
          logger.error('[ERROR] Failed to write evaluation to translation-debug.log:', err);
        }
      }

      logger.info(`Selected translation (${selectedChain}, humor: ${chosenHumorScore.toFixed(3)}): ${finalResult}`);

      // Write detailed translation log to a single log file (append)
      try {
        const logDir = path.join(process.cwd(), 'translation-logs');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir);
        }
        const logFile = path.join(logDir, 'all-translations.log');
        const timestamp = new Date().toISOString();
        let logContent = `---\nTimestamp: ${timestamp}\nTweet ID: ${tweet.id || 'unknown'}\nInput: ${tweet.text}\nChosen Chain: ${selectedChain}\nHumor Score: ${chosenHumorScore.toFixed(3)}\nSteps:\n`;
        for (const step of translationLogSteps) {
          logContent += `  [${step.lang}] ${step.text}\n`;
        }
        logContent += `Final Result: ${finalResult}\n`;
        fs.appendFileSync(logFile, logContent, 'utf8');
      } catch (e) {
        logger.warn(`Failed to write detailed translation log: ${e}`);
      }

      const timeSinceLastPost = Date.now() - lastPostTime;
      const needsInterval = lastPostTime > 0 && timeSinceLastPost < MIN_POST_INTERVAL_MS;

      // Decide whether to post immediately, queue, or skip based on conditions
      if (acceptable) {
        if (!tweetQueue.isEmpty() || !postTracker.canPost() || rateLimitTracker.isRateLimited('post') || needsInterval) {
          const reason = !tweetQueue.isEmpty() ? 'queue not empty' :
            !postTracker.canPost() ? '24h limit reached' :
              rateLimitTracker.isRateLimited('post') ? 'rate limited' :
                'minimum interval enforcement';
          logger.info(`Adding tweet ${tweet.id} to queue (${reason})`);
          logger.info(`Queue state: isEmpty=${tweetQueue.isEmpty()}, canPost=${postTracker.canPost()}, rateLimited=${rateLimitTracker.isRateLimited('post')}, needsInterval=${needsInterval}`);
          tweetQueue.enqueue(tweet.id, finalResult);
        } else {
          // Additional safety check for empty/problematic results (shouldn't trigger if acceptable)
          if (!finalResult || finalResult.trim() === '/') {
            const queued = tweetQueue.peek();
            if (queued && queued.sourceTweetId === tweet.id) {
              queued.attemptCount = (queued.attemptCount || 0) + 1;
              if (queued.attemptCount >= 3) {
                logger.warn(`Tweet ${tweet.id} failed translation ${queued.attemptCount} times. Removing from queue.`);
                tweetQueue.dequeue();
                continue;
              } else {
                logger.warn(`Skipping post for tweet ${tweet.id} due to empty or invalid translation result: '${finalResult}' (attempt ${queued.attemptCount}/3)`);
                continue;
              }
            } else {
              logger.warn(`Skipping post for tweet ${tweet.id} due to empty or invalid translation result: '${finalResult}'`);
              continue;
            }
          }
          // Post the tweet
          try {
            // CRITICAL: Final check before posting to prevent race conditions
            if (tweetTracker.isProcessed(tweet.id)) {
              logger.info(`Skipping tweet ${tweet.id} - already processed (race condition detected)`);
              continue;
            }
            
            if (isDryRun) {
              logger.warn(`[DRY_RUN] Would have posted tweet ${tweet.id}: ${finalResult}`);
            } else {
              await postTweet(client, finalResult, tweet.id);
              logger.info(`Successfully posted translated tweet ${tweet.id}`);
            }
            // Record the post
            postTracker.recordPost();
            tweetTracker.markProcessed(tweet.id);
            logger.info(`Marked ${tweet.id} as processed after successful post`);
            lastPostTime = Date.now();
            didWork = true;
            // Log posted output
            try {
              fs.appendFileSync(postedLogPath, `${new Date().toISOString()} [${tweet.id}] ${finalResult}\n`, 'utf8');
            } catch (err) {
              logger.warn(`Failed to log posted output: ${err}`);
            }
            // Add delay between posts
            await delay(5000);
          } catch (error: unknown) {
            const err = error as { code?: number; message?: string };
            if (err?.code === 429 || err?.code === 403 || err?.message?.includes('429') || err?.message?.includes('403')) {
              logger.error(`Rate limit hit while posting tweet ${tweet.id}. Enqueueing for retry.`);
              tweetQueue.enqueue(tweet.id, finalResult);
            } else {
              logger.error(`Failed to post tweet ${tweet.id}: ${error}`);
              // Enqueue for retry
              tweetQueue.enqueue(tweet.id, finalResult);
            }
          }
        }
      }
    }
  }
  // Return worker status for scheduling decisions
  return {
    didWork,
    blockedByCooldown,
    blockedByPostLimit
  };
};

// Utility functions for scoring funniness/unexpectedness

/**
 * Calculate Jaccard distance between two strings based on their word sets.
 * Used for measuring how different two texts are.
 */
function differenceScore(a: string, b: string): number {
  // Jaccard distance on word sets
  const setA = new Set(a.toLowerCase().split(/\W+/));
  const setB = new Set(b.toLowerCase().split(/\W+/));
  const union = new Set([...setA, ...setB]);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  return union.size - intersection.size;
}

/**
 * Count unexpected words in result that aren't in the original text.
 * Used to measure how much the translation process has transformed the content.
 */
function unexpectednessScore(result: string, original: string): number {
  // Count words not in the original
  const origWords = new Set(original.toLowerCase().split(/\W+/));
  const resultWords = new Set(result.toLowerCase().split(/\W+/));
  let unexpected = 0;
  for (const w of resultWords) {
    if (!origWords.has(w) && w.length > 2) unexpected++;
  }
  return unexpected;
}

