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
import * as franc from 'franc';

// Helper function to evaluate if a translation result meets all quality criteria for posting.
// Checks for length, content validity, duplicates, language, and problematic characters.
// Returns whether acceptable and a string of failure reasons.
function isAcceptable(finalResult: string, originalText: string, postedOutputs: string[]): { acceptable: boolean; reason: string } {
  const trimmed = finalResult.trim();
  const originalTrimmed = originalText.trim();

  // Check if output is too short (less than 50% of input length)
  const tooShort = trimmed.length < Math.ceil(0.33 * originalTrimmed.length);
  // Check if output is empty or nearly empty
  const empty = trimmed.length <= 1;
  // Check if output consists only of punctuation or symbols
  const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(trimmed);
  // Check if output is a duplicate of previously posted tweets
  const duplicate = postedOutputs.includes(trimmed);
  // Check if output is identical to input
  const sameAsInput = trimmed === originalTrimmed;
  // Check for problematic starting characters or empty-like strings
  const problematicChar = ['/', ':', '.', '', ' '].includes(trimmed) || trimmed.startsWith('/');

  // Detect language using franc library (expects 'eng' for English)
  let detectedLang = 'und';
  try {
    detectedLang = franc.franc(trimmed, { minLength: 3 });
  } catch (e) {
    logger.warn(`Language detection failed: ${e}`);
  }
  const notEnglish = detectedLang !== 'eng';

  // Collect all failure reasons
  const unacceptableReasons: string[] = [];
  if (tooShort) unacceptableReasons.push(`Too short: ${trimmed.length} < 50% of input (${originalTrimmed.length})`);
  if (empty) unacceptableReasons.push('Output is empty or too short (<=1 char)');
  if (punctuationOnly) unacceptableReasons.push('Output is only punctuation/symbols');
  if (duplicate) unacceptableReasons.push('Output is a duplicate of a previously posted tweet');
  if (sameAsInput) unacceptableReasons.push('Output is the same as the input');
  if (notEnglish) unacceptableReasons.push(`Detected language is not English: ${detectedLang}`);
  if (problematicChar) unacceptableReasons.push('Output is a problematic character or starts with /');

  const acceptable = unacceptableReasons.length === 0;
  const reason = unacceptableReasons.join('; ');

  // Temporary debug log
  console.log(`[DEBUG] isAcceptable: finalResult='${finalResult}', originalText='${originalText}', acceptable=${acceptable}, reason='${reason}', tooShort=${tooShort}, originalLength=${originalTrimmed.length}, trimmedLength=${trimmed.length}`);

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
const FAILURE_THRESHOLD = 3; // Open circuit after 3 failures
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes cooldown

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

export const translateAndPostWorker = async (): Promise<WorkerResult> => {
  try {
    fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] translateAndPostWorker entry at ${new Date().toISOString()}\n`, 'utf8');
  } catch (err) {
    // Logging failed
  }
  const client = new TwitterClient();
  let didWork = false;
  let blockedByCooldown = false;
  let blockedByPostLimit = false;

  // Translation steps log setup
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
  // Debug log at worker startup
  try {
    fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Worker started at ${new Date().toISOString()}\n`, 'utf8');
  } catch (err) {
    // Logging failed
  }

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
  while (!tweetQueue.isEmpty() && postTracker.canPost()) {
    // Check if we're rate limited for posting
    if (rateLimitTracker.isRateLimited('post')) {
      const waitSeconds = rateLimitTracker.getSecondsUntilReset('post');
      logger.info(`Cannot post queued tweets - rate limited for ${waitSeconds} more seconds`);
      blockedByPostLimit = true;
      break;
    }

    const queuedTweet = tweetQueue.peek();
    if (!queuedTweet) break;

    try {
      // Enforce minimum interval between posts
      const timeSinceLastPost = Date.now() - lastPostTime;
      if (lastPostTime > 0 && timeSinceLastPost < MIN_POST_INTERVAL_MS) {
        const waitMs = MIN_POST_INTERVAL_MS - timeSinceLastPost;
        logger.info(`Enforcing minimum post interval. Waiting ${Math.ceil(waitMs / 1000)}s before next post`);
        blockedByPostLimit = true;
        break;
      }

      logger.info(`Posting queued tweet ${queuedTweet.sourceTweetId} (attempt ${queuedTweet.attemptCount + 1})`);
      await postTweet(client, queuedTweet.finalTranslation, queuedTweet.sourceTweetId);
      logger.info(`Successfully posted queued tweet ${queuedTweet.sourceTweetId}`);
                
      // Record the post - tweet tracker updated inside postTweet
      postTracker.recordPost();
      tweetQueue.dequeue();
      lastPostTime = Date.now();
                
      // Add delay between posts
      await delay(5000);
    } catch (error: unknown) {
      // If rate limit hit (429 or 403), stop processing queue
      const err = error as { code?: number; message?: string };
      if (err?.code === 429 || err?.code === 403 || err?.message?.includes('429') || err?.message?.includes('403')) {
        logger.error(`Rate limit hit (${err?.code || 'unknown'}) while posting queued tweet. Will retry next run.`);
        tweetQueue.incrementAttempt();
        blockedByPostLimit = true;
        break;
      }
      // For other errors, increment attempt count but keep in queue
      logger.error(`Failed to post queued tweet ${queuedTweet.sourceTweetId}: ${error}`);
      tweetQueue.incrementAttempt();
                
      // If too many failures, remove from queue and let it be re-fetched/retried later
      if (queuedTweet.attemptCount >= 5) {
        logger.error(`Removing tweet ${queuedTweet.sourceTweetId} from queue after ${queuedTweet.attemptCount} failed attempts - will retry on next fetch`);
        tweetQueue.dequeue();
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

      // Select 12 random languages from the list
      const randomizedLangs = shuffleArray(config.LANGUAGES).slice(0, 12);
      logger.info(`[LANG_CHAIN] Main chain languages: ${randomizedLangs.join(', ')}`);
      for (const lang of randomizedLangs) {
        if (isCircuitOpen(lang)) {
          logger.warn(`Skipping language ${lang} due to open circuit`);
          continue;
        }
        try {
          let result = await translateText(translationChain, lang);
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

      if (!translationAttempted) {
        logger.error(`No translations succeeded for tweet ${tweet.id} - will retry in next run`);
        continue;
      }

      // Always translate final result back to English
      logger.info(`Translation chain before final EN: ${translationChain}`);
      const postedLogPath = path.resolve(__dirname, '../../posted-outputs.log');
      let finalResult = '';
      const translationLogSteps: { lang: string, text: string }[] = [];
      let postedOutputs: string[] = [];
      try {
        if (fs.existsSync(postedLogPath)) {
          postedOutputs = fs.readFileSync(postedLogPath, 'utf8').split('\n').filter((line: string) => Boolean(line)).map((line: string) => line.replace(/^.*?\] /, ''));
        }
      } catch (e) {
        logger.warn(`Could not read posted-outputs.log: ${e}`);
      }
      // Ensure log directory exists for debug logging
      const logDir = path.join(process.cwd(), 'translation-logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
      }
      const maxRetries = 33;
      let attempts = 0;
      let acceptable = false;
      do {
        // On each retry, randomize the language chain and reprocess the original tweet
        let retryChain = tweet.text;
        const randomizedLangs = shuffleArray(config.LANGUAGES).slice(0, 12);
        logger.info(`[RETRY_CHAIN] Attempt ${attempts + 1}: languages: ${randomizedLangs.join(', ')}`);
        for (const lang of randomizedLangs) {
          if (isCircuitOpen(lang)) {
            logger.warn(`Skipping language ${lang} due to open circuit`);
            continue;
          }
          try {
            let result = await translateText(retryChain, lang);
            // If result is just a problematic char or empty, retry with a different language
            const trimmedResult = result.trim();
            if (['/', ':', '.', '', ' '].includes(trimmedResult) || trimmedResult.startsWith('/')) {
              logger.warn(`Translation for ${lang} returned problematic result: '${result}'. Retrying with a different language.`);
              const altResult = await retryWithDifferentLang(retryChain, trimmedResult, [lang]);
              if (altResult) {
                result = altResult;
              }
            }
            retryChain = result;
            recordSuccess(lang);
            logger.info(`Translated through ${lang}: ${retryChain.substring(0, 50)}...`);
            logTranslationStep(lang, retryChain);
          } catch (error: unknown) {
            logger.error(`Failed to translate for ${lang}: ${error}`);
            recordFailure(lang);
          }
          await delay(jitteredTranslationDelay());
        }
        finalResult = await translateText(retryChain, 'en');
        logTranslationStep('en', finalResult);
        translationLogSteps.push({ lang: 'en', text: finalResult });
        const check = isAcceptable(finalResult, tweet.text, postedOutputs);
        acceptable = check.acceptable;
        // Log detailed evaluation of each criterion for debugging
        const trimmedRetry = finalResult.trim();
        const originalTrimmedRetry = tweet.text.trim();
        const tooShortRetry = trimmedRetry.length < Math.ceil(0.5 * originalTrimmedRetry.length);
        const emptyRetry = trimmedRetry.length <= 1;
        const punctuationOnlyRetry = /^[\p{P}\p{S}]+$/u.test(trimmedRetry);
        const duplicateRetry = postedOutputs.includes(trimmedRetry);
        const sameAsInputRetry = trimmedRetry === originalTrimmedRetry;
        const problematicCharRetry = ['/', ':', '.', '', ' '].includes(trimmedRetry) || trimmedRetry.startsWith('/');
        let detectedLangRetry = 'und';
        try {
          detectedLangRetry = franc.franc(trimmedRetry, { minLength: 3 });
        } catch (e) {
          // already handled
        }
        const notEnglishRetry = detectedLangRetry !== 'eng';
        try {
          fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Attempt ${attempts + 1} evaluation: acceptable=${check.acceptable}\nLength check: ${tooShortRetry ? 'fail' : 'pass'} (${trimmedRetry.length}/${originalTrimmedRetry.length})\nEmpty check: ${emptyRetry ? 'fail' : 'pass'}\nPunctuation check: ${punctuationOnlyRetry ? 'fail' : 'pass'}\nDuplicate check: ${duplicateRetry ? 'fail' : 'pass'}\nSame as input check: ${sameAsInputRetry ? 'fail' : 'pass'}\nProblematic char check: ${problematicCharRetry ? 'fail' : 'pass'}\nLanguage check: ${notEnglishRetry ? 'fail' : 'pass'} (${detectedLangRetry})\nfinalResult='${finalResult}'\n`, 'utf8');
        } catch (err) {
          console.error('[ERROR] Failed to write evaluation to translation-debug.log:', err);
        }
        if (!acceptable) {
          logger.warn(`Attempt ${attempts + 1} failed checks: ${check.reason}`);
        }
        attempts++;
      } while (!acceptable && attempts < maxRetries);
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
        // After max retries, still unacceptable - enqueue for manual review
        logger.warn(`After ${maxRetries} attempts, result is not acceptable. Enqueueing.`);
        tweetQueue.enqueue(tweet.id, finalResult);
      }
    }
  }
  return {
    didWork,
    blockedByCooldown,
    blockedByPostLimit
  };
};
