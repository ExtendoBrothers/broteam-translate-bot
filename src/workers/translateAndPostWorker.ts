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
import fs from 'fs';
import path from 'path';
import { detectLanguageByLexicon } from '../translator/lexicon';

// Type declarations for langdetect
interface DetectionResult {
  lang: string;
  prob: number;
}

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
  let detectedLang = detectLanguageByLexicon(textOnly) || 'und';
  fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Lexicon detection for "${textOnly}": ${detectedLang}\n`, 'utf8');
  if (detectedLang === 'und') {
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

  // Translation steps log setup - logs each translation step for debugging
  const translationLogPath = path.resolve(__dirname, '../../translation-steps.log');
  function logTranslationStep(lang: string, text: string) {
    const entry = `${new Date().toISOString()} [${lang}] ${text.replace(/\n/g, ' ')}\n`;
    // Log every step to debug log
    try {
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] [${lang}] ${new Date().toISOString()} ${text.replace(/\n/g, ' ')}\n`, 'utf8');
    } catch (err) {
      console.error('[ERROR] Failed to write to translation-debug.log:', err);
    }
    try {
      fs.appendFileSync(translationLogPath, entry, 'utf8');
    } catch (err) {
      console.error('[ERROR] Failed to write to translation-steps.log:', err);
      try {
        fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[ERROR] [${lang}] ${new Date().toISOString()} ${err}\n`, 'utf8');
      } catch (e2) {
        console.error('[ERROR] Failed to write error to translation-debug.log:', e2);
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
  function getTranslationLanguages(): string[] {
    if (config.OLDSCHOOL_MODE && config.OLDSCHOOL_LANGUAGES.length > 0) {
      logger.info(`[OLDSCHOOL_MODE] Using fixed language order: ${config.OLDSCHOOL_LANGUAGES.join(', ')}`);
      return config.OLDSCHOOL_LANGUAGES;
    } else {
      // Select 12 random languages from the list
      const randomizedLangs = shuffleArray(config.LANGUAGES).slice(0, 12);
      logger.info(`[LANG_CHAIN] Random languages: ${randomizedLangs.join(', ')}`);
      return randomizedLangs;
    }
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
      
      const trimmedQueued = queuedTweet.finalTranslation.trim();
      if (postedOutputs.includes(trimmedQueued)) {
        logger.info(`[QUEUE_DEBUG] Skipping queued tweet ${queuedTweet.sourceTweetId} - content is duplicate of previously posted tweet`);
        tweetQueue.dequeue();
        logger.info(`[QUEUE_DEBUG] Dequeued duplicate tweet. New queue size: ${tweetQueue.size()}`);
        continue;
      }
      
      await postTweet(client, queuedTweet.finalTranslation, queuedTweet.sourceTweetId);
      logger.info(`[QUEUE_DEBUG] Successfully posted queued tweet ${queuedTweet.sourceTweetId}`);
                
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
  tweets = await fetchTweets();
    
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

      let translationChain = tweet.text;
      let translationAttempted = false;

      // Always log the original tweet text as the first step for traceability
      logTranslationStep('original', tweet.text);

      // Get languages for translation chain (random or fixed based on mode)
      const selectedLangs = getTranslationLanguages();
      let currentSource = 'en';
      let consecutiveSame = 0;
      let previousResult = translationChain;

      // Main translation chain loop: translate through multiple languages sequentially
      // This creates the comedic effect by accumulating translation artifacts
      for (const lang of selectedLangs) {
        if (isCircuitOpen(lang)) {
          logger.warn(`Skipping language ${lang} due to open circuit`);
          continue;
        }
        try {
          let result = await translateText(translationChain, lang, currentSource);
          // If result is just a problematic char or empty, retry with a different language
          const trimmedResult = result.trim();
          if (['/', ':', '.', '', ' '].includes(trimmedResult) || trimmedResult.startsWith('/')) {
            logger.warn(`Translation for ${lang} returned problematic result: '${result}'. Retrying with a different language.`);
            const altResult = await retryWithDifferentLang(translationChain, trimmedResult, [lang]);
            if (altResult) {
              result = altResult;
            }
          }
          translationChain = result;
          // Check for consecutive same results (indicates translation service is stuck)
          if (result === previousResult) {
            consecutiveSame++;
            if (consecutiveSame >= 4) {
              logger.warn('Chain stuck: 4 consecutive same results. Failing initial chain.');
              translationAttempted = false; // Force retry
              break;
            }
          } else {
            consecutiveSame = 0;
          }
          previousResult = result;
          currentSource = lang;
          recordSuccess(lang);
          translationAttempted = true;
          logger.info(`Translated through ${lang}: ${translationChain.substring(0, 50)}...`);
          logTranslationStep(lang, translationChain);
        } catch (error: unknown) {
          logger.error(`Failed to translate for ${lang}: ${error}`);
          recordFailure(lang);
        }
        await delay(jitteredTranslationDelay());
      }

      const postedLogPath = path.resolve(__dirname, '../../posted-outputs.log');
      let postedOutputs: string[] = [];
      try {
        if (fs.existsSync(postedLogPath)) {
          postedOutputs = fs.readFileSync(postedLogPath, 'utf8').split('\n').filter((line: string) => Boolean(line)).map((line: string) => line.replace(/^.*?\] /, ''));
        }
      } catch (e) {
        logger.warn(`Could not read posted-outputs.log: ${e}`);
      }

      let finalResult: string;
      let acceptable: boolean;
      let initialCheck: { acceptable: boolean; reason: string };

      // Handle cases where the initial translation chain failed completely (e.g., stuck with same results)
      // In such cases, force retries by setting acceptable = false, similar to unacceptable translations
      if (!translationAttempted) {
        logger.error(`No translations succeeded for tweet ${tweet.id} - will retry in next run`);
        finalResult = tweet.text; // Use original text as fallback for retry attempts
        acceptable = false; // Force entry into retry loop
        initialCheck = { acceptable: false, reason: 'No translations succeeded' };
      } else {
        // Use the result from the initial translation chain
        finalResult = translationChain;
        initialCheck = isAcceptable(finalResult, tweet.text, postedOutputs);
        acceptable = initialCheck.acceptable;
      }

      const translationLogSteps: { lang: string, text: string }[] = [];
      const englishResults: string[] = [];

      // Log the initial result evaluation
      try {
        const trimmedInitial = finalResult.trim();
        const originalTrimmedInitial = tweet.text.trim();
        const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;
        const textOnlyInitial = trimmedInitial.replace(tokenPattern, '').trim();
        const originalTextOnlyInitial = originalTrimmedInitial.replace(tokenPattern, '').trim();
        
        const tooShortInitial = textOnlyInitial.length < Math.ceil(0.33 * originalTextOnlyInitial.length);
        const emptyInitial = textOnlyInitial.length <= 1;
        const punctuationOnlyInitial = /^[\p{P}\p{S}]+$/u.test(textOnlyInitial);
        const duplicateInitial = postedOutputs.includes(trimmedInitial);
        const sameAsInputInitial = textOnlyInitial === originalTextOnlyInitial;
        const problematicCharInitial = ['/', ':', '.', '', ' '].includes(textOnlyInitial) || textOnlyInitial.startsWith('/');
        
        // Lexicon-based detection first, fallback to langdetect
        let detectedLangInitial = detectLanguageByLexicon(textOnlyInitial) || 'und';
        if (detectedLangInitial === 'und') {
          try {
            const detections = langdetect.detect(textOnlyInitial);
            fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Langdetect fallback for initial "${textOnlyInitial}": ${JSON.stringify(detections)}\n`, 'utf8');
            if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8 && (!detections[1] || detections[1].prob <= detections[0].prob - 0.1)) {
              detectedLangInitial = detections[0].lang;
            }
          } catch {
            // ignore
          }
        }
        const notEnglishInitial = detectedLangInitial !== 'en';

        fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Initial translation evaluation: acceptable=${initialCheck.acceptable}\nLength check: ${tooShortInitial ? 'fail' : 'pass'} (${textOnlyInitial.length}/${originalTextOnlyInitial.length})\nEmpty check: ${emptyInitial ? 'fail' : 'pass'}\nPunctuation check: ${punctuationOnlyInitial ? 'fail' : 'pass'}\nDuplicate check: ${duplicateInitial ? 'fail' : 'pass'}\nSame as input check: ${sameAsInputInitial ? 'fail' : 'pass'}\nProblematic char check: ${problematicCharInitial ? 'fail' : 'pass'}\nLanguage check: ${notEnglishInitial ? 'fail' : 'pass'} (${detectedLangInitial})\nfinalResult='${finalResult}'\n`, 'utf8');
      } catch (err) {
        console.error('[ERROR] Failed to write initial evaluation to translation-debug.log:', err);
      }

      if (!acceptable) {
        logger.warn(`Initial translation failed checks: ${initialCheck.reason}. Will attempt retries.`);
      }

      // If initial result is acceptable, collect it for logging
      if (acceptable) {
        let detectedLangInitial = detectLanguageByLexicon(finalResult) || 'und';
        if (detectedLangInitial === 'und') {
          try {
            const detections = langdetect.detect(finalResult);
            fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Langdetect fallback for acceptable "${finalResult}": ${JSON.stringify(detections)}\n`, 'utf8');
            if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8 && (!detections[1] || detections[1].prob <= detections[0].prob - 0.1)) {
              detectedLangInitial = detections[0].lang;
            }
          } catch {
            // ignore
          }
        }
        if (detectedLangInitial === 'en') {
          englishResults.push(finalResult);
        }
      }

      const maxRetries = 33;
      let attempts = 0;
      let triedFallbackMode = false;
      const originalMode = config.OLDSCHOOL_MODE; // Store original mode

      // Retry loop: attempts to improve unacceptable translations or handle stuck chains
      // This loop runs for both cases where initial result is bad OR no translation was attempted
      // Try with current mode first, then fallback to opposite mode if needed
      while (!acceptable) {
        if (attempts >= maxRetries) {
          if (triedFallbackMode) {
            // Both modes exhausted, give up
            logger.error('All retry attempts exhausted in both modes. Final result may not meet quality standards.');
            break;
          } else {
            // Switch to fallback mode
            triedFallbackMode = true;
            attempts = 0;
            const fallbackMode = config.OLDSCHOOL_MODE ? 'random' : 'oldschool';
            logger.warn(`Primary mode exhausted ${maxRetries} attempts. Switching to ${fallbackMode} mode as fallback.`);
            // Toggle the mode by temporarily overriding the config
            config.OLDSCHOOL_MODE = !config.OLDSCHOOL_MODE;
          }
        }

        if (!triedFallbackMode) {
          logger.warn(`Initial translation failed checks: ${initialCheck.reason}. Attempting retry ${attempts + 1}/${maxRetries}`);
        } else {
          logger.warn(`Fallback mode retry ${attempts + 1}/${maxRetries}`);
        }

        // On each retry, get languages for translation chain (random or fixed based on mode)
        let retryChain = tweet.text;
        const selectedLangs = getTranslationLanguages();
        let currentSource = 'en';
        let consecutiveSame = 0;
        let previousResult = retryChain;
        for (const lang of selectedLangs) {
          if (isCircuitOpen(lang)) {
            logger.warn(`Skipping language ${lang} due to open circuit`);
            continue;
          }
          try {
            let result = await translateText(retryChain, lang, currentSource);
            const trimmedResult = result.trim();
            if (['/', ':', '.', '', ' '].includes(trimmedResult) || trimmedResult.startsWith('/')) {
              logger.warn(`Translation for ${lang} returned problematic result: '${result}'. Retrying with a different language.`);
              const altResult = await retryWithDifferentLang(retryChain, trimmedResult, [lang]);
              if (altResult) {
                result = altResult;
              }
            }
            retryChain = result;
            // Check for consecutive same results
            if (result === previousResult) {
              consecutiveSame++;
              if (consecutiveSame >= 4) {
                logger.warn('Retry chain stuck: 4 consecutive same results. Failing this retry attempt.');
                break; // Fail this retry, try next
              }
            } else {
              consecutiveSame = 0;
            }
            previousResult = result;
            currentSource = lang;
            recordSuccess(lang);
            logger.info(`Translated through ${lang}: ${retryChain.substring(0, 50)}...`);
            logTranslationStep(lang, retryChain);
          } catch (error: unknown) {
            logger.error(`Failed to translate for ${lang}: ${error}`);
            recordFailure(lang);
          }
          await delay(jitteredTranslationDelay());
        }
        finalResult = await translateText(retryChain, 'en', currentSource);
        logTranslationStep('en', finalResult);
        translationLogSteps.push({ lang: 'en', text: finalResult });
        // Collect English final result as well
        let detectedLangFinal = detectLanguageByLexicon(finalResult) || 'und';
        if (detectedLangFinal === 'und') {
          try {
            const detections = langdetect.detect(finalResult);
            fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Langdetect fallback for final "${finalResult}": ${JSON.stringify(detections)}\n`, 'utf8');
            if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8 && (!detections[1] || detections[1].prob <= detections[0].prob - 0.1)) {
              detectedLangFinal = detections[0].lang;
            }
          } catch {
            // ignore
          }
        }
        if (detectedLangFinal === 'en') {
          englishResults.push(finalResult);
        }
        const check = isAcceptable(finalResult, tweet.text, postedOutputs);
        acceptable = check.acceptable;
        // Log detailed evaluation of each criterion for debugging (using same logic as isAcceptable)
        const trimmedRetry = finalResult.trim();
        const originalTrimmedRetry = tweet.text.trim();
        const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;
        const textOnlyRetry = trimmedRetry.replace(tokenPattern, '').trim();
        const originalTextOnlyRetry = originalTrimmedRetry.replace(tokenPattern, '').trim();
        
        const tooShortRetry = textOnlyRetry.length < Math.ceil(0.33 * originalTextOnlyRetry.length);
        const emptyRetry = textOnlyRetry.length <= 1;
        const punctuationOnlyRetry = /^[\p{P}\p{S}]+$/u.test(textOnlyRetry);
        const duplicateRetry = postedOutputs.includes(trimmedRetry);
        const sameAsInputRetry = textOnlyRetry === originalTextOnlyRetry;
        const problematicCharRetry = ['/', ':', '.', '', ' '].includes(textOnlyRetry) || textOnlyRetry.startsWith('/');
        
        let detectedLangRetry = detectLanguageByLexicon(textOnlyRetry) || 'und';
        if (detectedLangRetry === 'und') {
          try {
            const detections = langdetect.detect(textOnlyRetry);
            fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Langdetect fallback for retry "${textOnlyRetry}": ${JSON.stringify(detections)}\n`, 'utf8');
            if (detections && detections.length > 0 && detections[0].lang === 'en' && detections[0].prob > 0.8 && (!detections[1] || detections[1].prob <= detections[0].prob - 0.1)) {
              detectedLangRetry = detections[0].lang;
            }
          } catch {
            // ignore
          }
        }
        const notEnglishRetry = detectedLangRetry !== 'en';
        try {
          fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Retry attempt ${attempts + 1} evaluation: acceptable=${check.acceptable}\nLength check: ${tooShortRetry ? 'fail' : 'pass'} (${textOnlyRetry.length}/${originalTextOnlyRetry.length})\nEmpty check: ${emptyRetry ? 'fail' : 'pass'}\nPunctuation check: ${punctuationOnlyRetry ? 'fail' : 'pass'}\nDuplicate check: ${duplicateRetry ? 'fail' : 'pass'}\nSame as input check: ${sameAsInputRetry ? 'fail' : 'pass'}\nProblematic char check: ${problematicCharRetry ? 'fail' : 'pass'}\nLanguage check: ${notEnglishRetry ? 'fail' : 'pass'} (${detectedLangRetry})\nfinalResult='${finalResult}'\n`, 'utf8');
        } catch (err) {
          console.error('[ERROR] Failed to write evaluation to translation-debug.log:', err);
        }
        if (!acceptable) {
          logger.warn(`Retry attempt ${attempts + 1} failed checks: ${check.reason}`);
        }
        attempts++;
      }

      // Restore original mode if we switched to fallback
      if (triedFallbackMode) {
        config.OLDSCHOOL_MODE = originalMode;
        logger.info('Restored original translation mode');
      }

      logger.info(`Final translation result: ${finalResult}`);

      // Write detailed translation log to a single log file (append)
      try {
        const logDir = path.join(process.cwd(), 'translation-logs');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir);
        }
        const logFile = path.join(logDir, 'all-translations.log');
        const timestamp = new Date().toISOString();
        let logContent = `---\nTimestamp: ${timestamp}\nTweet ID: ${tweet.id || 'unknown'}\nInput: ${tweet.text}\nSteps:\n`;
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
            await postTweet(client, finalResult, tweet.id);
            logger.info(`Successfully posted translated tweet ${tweet.id}`);
            // Record the post
            postTracker.recordPost();
            tweetTracker.markProcessed(tweet.id);
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
      } else {
        // After max retries, still unacceptable - pick the funniest English result if available
        let chosenResult = finalResult;
        if (englishResults.length > 0) {
          // Score each English result for 'funniness': most different from original, most unexpected words
          let bestScore = -1;
          let funniest = englishResults[0];
          for (const res of englishResults) {
            const diff = differenceScore(res, tweet.text);
            const unexp = unexpectednessScore(res, tweet.text);
            const score = diff + unexp * 2; // Weight unexpectedness higher
            if (score > bestScore) {
              bestScore = score;
              funniest = res;
            }
          }
          logger.warn(`After ${maxRetries} attempts, result is not acceptable. Enqueueing funniest English result.`);
          chosenResult = funniest;
        } else {
          logger.warn(`After ${maxRetries} attempts, result is not acceptable. Enqueueing last result.`);
        }
        tweetQueue.enqueue(tweet.id, chosenResult);
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

// Utility functions moved to root for lint compliance

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
