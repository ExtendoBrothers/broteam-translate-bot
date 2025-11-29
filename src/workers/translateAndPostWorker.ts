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

// Helper to add delay between operations to respect rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Minimum delay between posts to avoid rapid-fire posting (15 minutes)
const MIN_POST_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let lastPostTime = 0;

// Circuit breaker state per language
interface CircuitState { failures: number; openedAt?: number; }
const circuit: Record<string, CircuitState> = {};
const FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

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

function recordFailure(lang: string): void {
  const state = circuit[lang] || { failures: 0 };
  state.failures += 1;
  if (state.failures === FAILURE_THRESHOLD && !state.openedAt) {
    state.openedAt = Date.now();
    logger.warn(`Circuit opened for language ${lang} after ${state.failures} consecutive failures; skipping translations for ${Math.round(CIRCUIT_COOLDOWN_MS/60000)}m`);
  }
  circuit[lang] = state;
}

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
  const client = new TwitterClient();
  let didWork = false;
  let blockedByCooldown = false;
  let blockedByPostLimit = false;

  // Translation steps log setup
  const translationLogPath = path.resolve(__dirname, '../../translation-steps.log');
  function logTranslationStep(lang: string, text: string) {
    const entry = `${new Date().toISOString()} [${lang}] ${text.replace(/\n/g, ' ')}\n`;
    fs.appendFileSync(translationLogPath, entry, 'utf8');
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

  try {
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
      logger.info(`Processing tweet ${tweet.id}: ${tweet.text.substring(0, 50)}...`);

      let translationChain = tweet.text;
      let translationAttempted = false;

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
      try {
        logger.info(`Translation chain before final EN: ${translationChain}`);
        const postedLogPath = path.resolve(__dirname, '../../posted-outputs.log');
        let finalResult = '';
        let chainInput = tweet.text;
        const minRelativeLength = 0.5; // If output is less than 50% of input, consider it too short
        // Prepare to collect translation steps for detailed logging
        const translationLogSteps: { lang: string, text: string }[] = [];
        let duplicate = false;
        let postedOutputs: string[] = [];
        try {
          if (fs.existsSync(postedLogPath)) {
            postedOutputs = fs.readFileSync(postedLogPath, 'utf8').split('\n').filter((line: string) => Boolean(line)).map((line: string) => line.replace(/^.*?\] /, ''));
          }
        } catch (e) {
          logger.warn(`Could not read posted-outputs.log: ${e}`);
        }
        const maxChainRetries = 9;
        const maxLangOrderRetries = 9;
        let chainRetries = 0;
        let shouldRetry = false;
        do {
          let tries = 0;
          let problematic = false;
          let tooShort = false;
          logger.info(`[RETRY] Starting chain attempt ${chainRetries + 1}/${maxChainRetries}`);
          do {
            // Shuffle and select 12 random languages for each attempt
            const randomizedLangs = shuffleArray(config.LANGUAGES).slice(0, 12);
            logger.info(`[LANG_CHAIN] Retry chain attempt ${chainRetries + 1}: ${randomizedLangs.join(', ')}`);
            let chain = chainInput;
            for (const lang of randomizedLangs) {
              if (isCircuitOpen(lang)) {
                logger.warn(`Skipping language ${lang} due to open circuit`);
                continue;
              }
              try {
                let result = await translateText(chain, lang);
                if (['/', ':', '.', '', ' '].includes(result.trim())) {
                  logger.warn(`Translation for ${lang} returned problematic result: '${result}'. Retrying with a different language.`);
                  const altResult = await retryWithDifferentLang(chain, result.trim(), [lang]);
                  if (altResult) {
                    result = altResult;
                  }
                }
                chain = result;
                recordSuccess(lang);
                translationAttempted = true;
                logger.info(`Translated through ${lang}: ${chain.substring(0, 50)}...`);
                logTranslationStep(lang, chain);
                translationLogSteps.push({ lang, text: chain });
              } catch (error: unknown) {
                logger.error(`Failed to translate for ${lang}: ${error}`);
                recordFailure(lang);
              }
              await delay(jitteredTranslationDelay());
            }
            // Always translate back to English as the 13th step
            finalResult = await translateText(chain, 'en');
            translationLogSteps.push({ lang: 'en', text: finalResult });
            const trimmedFinal = finalResult.trim();
            // Language check: use franc to detect if the result is English
            let detectedLang = 'und';
            try {
              detectedLang = franc.franc(trimmedFinal, { minLength: 3 });
            } catch (e) {
              logger.warn(`Language detection failed: ${e}`);
            }
            tooShort = trimmedFinal.length > 0 && (trimmedFinal.length < Math.ceil(minRelativeLength * tweet.text.length));
            // Flag outputs that are only punctuation or symbols (e.g., '·,')
            const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(trimmedFinal);
            problematic = (
              trimmedFinal.length <= 1 ||
              ['/', ':', '.', '', ' '].includes(trimmedFinal) ||
              trimmedFinal.startsWith('/') ||
              detectedLang !== 'eng' ||
              tooShort ||
              punctuationOnly
            );
            logger.info(`[RETRY] Lang order attempt ${tries + 1}/${maxLangOrderRetries} | problematic=${problematic} | tooShort=${tooShort} | punctuationOnly=${punctuationOnly} | detectedLang=${detectedLang} | finalLength=${trimmedFinal.length} | inputLength=${tweet.text.length}`);
            if (punctuationOnly) {
              logger.warn(`Final EN translation is only punctuation/symbols: '${finalResult}'. Retrying chain.`);
            }
            if (problematic) {
              let reason = '';
              if (tooShort) {
                reason += `Too short: ${trimmedFinal.length} chars vs input ${tweet.text.length}. `;
              }
              if (punctuationOnly) {
                reason += 'Output is only punctuation/symbols. ';
              }
              if (detectedLang !== 'eng') {
                reason += `Detected language is not English: ${detectedLang}. `;
              }
              if (trimmedFinal.length <= 1) {
                reason += 'Output length <= 1. ';
              }
              if (['/', ':', '.', '', ' '].includes(trimmedFinal) || trimmedFinal.startsWith('/')) {
                reason += 'Output is a problematic character or empty. ';
              }
              logger.warn(`[RETRY_REASON] Tweet ${tweet.id}: ${reason}Final result: '${finalResult}'. Retrying chain.`);
            } else if (['/', ':', '.', '', ' '].includes(trimmedFinal) || trimmedFinal.startsWith('/')) {
              logger.warn(`Final EN translation returned problematic result: '${finalResult}'. Retrying with different intermediate language.`);
              const altResult = await retryWithDifferentLang(chain, trimmedFinal, ['en']);
              if (altResult) {
                finalResult = await translateText(altResult, 'en');
              }
            }
            duplicate = postedOutputs.includes(trimmedFinal);
            if (duplicate) {
              logger.warn(`[RETRY] Duplicate translation result detected. Retrying with a new language order. Attempt ${tries + 1}/${maxLangOrderRetries}`);
            }
            tries++;
          } while ((duplicate || problematic) && tries < maxLangOrderRetries);
          // If still duplicate or problematic after all language order tries, retry the whole chain with the previous result as input
          shouldRetry = (duplicate || problematic) && (chainRetries + 1 < maxChainRetries);
          if (shouldRetry) {
            logger.warn(`[RETRY] Still duplicate, problematic, or too short after ${maxLangOrderRetries} language order retries. Retrying the entire chain with previous result as input. Chain retry ${chainRetries + 1}/${maxChainRetries}`);
            chainInput = finalResult;
          } else {
            logger.info(`[RETRY] Stopping retries. duplicate=${duplicate}, problematic=${problematic}, chainRetries=${chainRetries + 1}, maxChainRetries=${maxChainRetries}`);
          }
          chainRetries++;
        } while (shouldRetry);
        logTranslationStep('final-en', finalResult);
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

        if (!tweetQueue.isEmpty() || !postTracker.canPost() || rateLimitTracker.isRateLimited('post') || needsInterval) {
          const reason = !tweetQueue.isEmpty() ? 'queue not empty' :
            !postTracker.canPost() ? '24h limit reached' :
              rateLimitTracker.isRateLimited('post') ? 'rate limited' :
                'minimum interval enforcement';
          logger.info(`Adding tweet ${tweet.id} to queue (${reason})`);
          logger.info(`Queue state: isEmpty=${tweetQueue.isEmpty()}, canPost=${postTracker.canPost()}, rateLimited=${rateLimitTracker.isRateLimited('post')}, needsInterval=${needsInterval}`);
          tweetQueue.enqueue(tweet.id, finalResult);
        } else {
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
          // Log if posted tweet is less than 50% of input length
          const inputLength = tweet.text.length;
          const outputLength = finalResult.length;
          if (outputLength < Math.ceil(0.5 * inputLength)) {
            logger.warn(`[LENGTH CHECK] Posted tweet ${tweet.id} is less than 50% of input length. Input: ${inputLength}, Output: ${outputLength}, Text: '${finalResult}'. Retrying with a new random chain.`);
            // Retry with a new random chain
            let retryCount = 0;
            let retrySuccess = false;
            while (retryCount < 9 && !retrySuccess) {
              const retryLangs = shuffleArray(config.LANGUAGES).slice(0, 12);
              logger.info(`[LENGTH CHECK] Retry chain languages: ${retryLangs.join(', ')}`);
              let retryChain = tweet.text;
              for (const lang of retryLangs) {
                try {
                  const result = await translateText(retryChain, lang);
                  retryChain = result;
                } catch (error) {
                  logger.error(`[LENGTH CHECK] Retry failed for ${lang}: ${error}`);
                }
              }
              // Always translate back to English
              let retryFinal = '';
              try {
                retryFinal = await translateText(retryChain, 'en');
              } catch (error) {
                logger.error(`[LENGTH CHECK] Retry final EN failed: ${error}`);
              }
              const retryOutputLength = retryFinal.length;
              if (retryOutputLength >= Math.ceil(0.5 * inputLength)) {
                logger.info(`[LENGTH CHECK] Retry succeeded for tweet ${tweet.id}. Output: '${retryFinal}'`);
                finalResult = retryFinal;
                retrySuccess = true;
                break;
              } else {
                logger.warn(`[LENGTH CHECK] Retry ${retryCount + 1} failed for tweet ${tweet.id}. Output: '${retryFinal}'`);
              }
              retryCount++;
            }
          }
          try {
            await postTweet(client, finalResult, tweet.id);
            logger.info(`Posted final translation to Twitter for tweet ${tweet.id}`);
            // Log posted output to a dedicated file
            try {
              const postedLogPath = path.resolve(__dirname, '../../posted-outputs.log');
              const entry = `${new Date().toISOString()} [tweet ${tweet.id}] ${finalResult.replace(/\n/g, ' ')}\n`;
              fs.appendFileSync(postedLogPath, entry, 'utf8');
            } catch (logErr) {
              logger.warn(`Failed to log posted output for tweet ${tweet.id}: ${logErr}`);
            }
            postTracker.recordPost();
            lastPostTime = Date.now();
            await delay(5000);
          } catch (error: unknown) {
            const err = error as { code?: number; message?: string };
            if (err?.code === 429 || err?.code === 403 || err?.message?.includes('429') || err?.message?.includes('403')) {
              logger.error(`Rate limit hit (${err?.code || 'unknown'}) on post. Queueing tweet ${tweet.id} for later.`);
              tweetQueue.enqueue(tweet.id, finalResult);
              blockedByPostLimit = true;
              break;
            }
            logger.error(`Failed to post final translation for tweet ${tweet.id}: ${error}`);
            tweetQueue.enqueue(tweet.id, finalResult);
          }
        }
      } catch (error: unknown) {
        logger.error(`Failed to translate final result for tweet ${tweet.id}: ${error}`);
        if (translationChain && translationChain !== tweet.text) {
          logger.info(`Queueing partially translated tweet ${tweet.id} for retry`);
          tweetQueue.enqueue(tweet.id, translationChain);
        }
      }
    }
        
    if (!tweetQueue.isEmpty()) {
      logger.info(`Worker complete. ${tweetQueue.size()} tweet(s) remaining in queue for next run.`);
    }
    didWork = tweets.length > 0;
    return { didWork, blockedByCooldown, blockedByPostLimit };
  } catch (error) {
    logger.error(`Error in translateAndPostWorker: ${error}`);
    return { didWork: false, blockedByCooldown, blockedByPostLimit };
  }
};