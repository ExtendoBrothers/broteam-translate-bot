/**
 * Humor detection using locally converted ONNX model
 * Uses the mohameddhiab/humor-no-humor model converted to ONNX format
 * Runs completely locally without requiring API tokens
 */

import { logger } from './logger';
import { predictHumor, isModelAvailable } from './humorOnnx';

// Check if local model is available
const USE_LOCAL_MODEL = isModelAvailable();

if (USE_LOCAL_MODEL) {
  logger.info('[HumorScorer] Local ONNX model is available and will be used');
} else {
  logger.info('[HumorScorer] Local ONNX model not found, using heuristics');
}

// Humor indicators - words and patterns that suggest humorous content
const HUMOR_KEYWORDS = [
  'lol', 'lmao', 'rofl', 'haha', 'hehe', 'lmfao', '😂', '🤣', '😭',
  'joke', 'funny', 'hilarious', 'ridiculous', 'absurd', 'wtf', 'omg',
  'bro', 'dude', 'fucking', 'shit', 'damn', 'hell', 'crazy',
  'trump', 'bitch', 'godsend', 'marketing', 'crime', 'autism', 'hell',
];

const HUMOR_PUNCTUATION_PATTERNS = [
  /!{2,}/,  // Multiple exclamation marks
  /\?{2,}/,  // Multiple question marks
  /(.)\1{2,}/i,  // Repeated letters (hahahaha, nooooo)
];

const SARCASM_INDICATORS = [
  'yeah right', 'sure', 'totally', 'obviously', 'clearly',
  'great', 'perfect', 'wonderful', 'amazing',
];

// Feedback-based heuristics from user ratings
const CONTRADICTION_PATTERNS = [
  /nice.*crime/i, /more.*marketing/i, /delicious.*crime/i,
  /god.*send/i, /computer.*autism/i, /big.*man/i,
];

const SETUP_PUNCHLINE_INDICATORS = [
  /\n\n/,  // Multi-line structure suggesting setup/punchline
  /\n.*\n/, // Multi-sentence structure
];

const SPAM_PATTERNS = [
  /(\w+)\s+\1\s+\1/,  // Repeated words (Central Central Central)
  /(\w{3,})\s+\1\s+\1\s+\1/,  // Multiple repetitions
  /(.)\1{4,}/,  // Character repetition (aaaaa, 11111)
];

const COHERENCE_PENALTIES = [
  /[^\w\s.,!?-]/g,  // Non-word characters (gibberish)
  /\b\w{1,2}\b/g,  // Very short words only
];

/**
 * Calculate a humor score based on text patterns
 */
function calculateHeuristicScore(text: string, originalText?: string): number {
  let score = 0;
  const lowerText = text.toLowerCase();

  // Check for humor keywords
  for (const keyword of HUMOR_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      score += 0.15;
    }
  }

  // Check for punctuation patterns
  for (const pattern of HUMOR_PUNCTUATION_PATTERNS) {
    if (pattern.test(text)) {
      score += 0.1;
    }
  }

  // Check for sarcasm indicators (context-dependent, but give some weight)
  for (const indicator of SARCASM_INDICATORS) {
    if (lowerText.includes(indicator)) {
      score += 0.05;
    }
  }

  // Feedback-based bonuses
  // Contradiction bonus (highly rated patterns)
  for (const pattern of CONTRADICTION_PATTERNS) {
    if (pattern.test(text)) {
      score += 0.3; // Strong bonus for contradictions
    }
  }

  // Setup-punchline structure bonus
  for (const pattern of SETUP_PUNCHLINE_INDICATORS) {
    if (pattern.test(text)) {
      score += 0.2; // Bonus for multi-line/narrative structure
    }
  }

  // Spam penalties (highly disliked patterns)
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      score -= 0.4; // Heavy penalty for repetitive spam
    }
  }

  // Coherence penalties
  for (const pattern of COHERENCE_PENALTIES) {
    const matches = text.match(pattern);
    if (matches && matches.length > text.split(/\s+/).length * 0.5) {
      score -= 0.2; // Penalty for incoherent text
    }
  }

  // Originality penalty - penalize text too similar to original
  if (originalText) {
    const similarity = calculateTextSimilarity(text, originalText.toLowerCase());
    if (similarity > 0.7) {
      score -= 0.3; // Heavy penalty for being too close to original
    } else if (similarity > 0.5) {
      score -= 0.1; // Moderate penalty
    }
  }

  // Bonus for questions (often setup for jokes)
  if (text.includes('?')) {
    score += 0.05;
  }

  // Bonus for short, punchy text (under 100 chars often more humorous)
  if (text.length < 100) {
    score += 0.05;
  }

  // Bonus for complete sentences (contains subject-verb structure)
  if (/\b\w+\s+\w+\b/.test(text)) {
    score += 0.1;
  }

  // Cap the score at 1.0 and floor at 0.0
  return Math.max(0, Math.min(score, 1.0));
}

/**
 * Calculate similarity between two texts (simple word overlap ratio)
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  if (words1.length === 0 || words2.length === 0) return 0;

  const intersection = words1.filter(word => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];

  return intersection.length / union.length;
}

export interface HumorScore {
  score: number;        // 0-1 probability that the text is humorous
  label: string;        // 'humor' or 'not_humor'
  isHumorous: boolean;  // Convenience boolean
}

/**
 * Score text for humor using ML model or heuristics
 * @param text The text to analyze for humor
 * @param originalText Optional original text for comparison (penalizes similarity)
 * @returns HumorScore object with probability and classification
 */
export async function scoreHumor(text: string, originalText?: string): Promise<HumorScore> {
  try {
    if (!text || text.trim().length === 0) {
      logger.warn('[HumorScorer] Empty text provided for scoring');
      return { score: 0, label: 'not_humorous', isHumorous: false };
    }

    // Try to use ML model if available
    if (USE_LOCAL_MODEL) {
      try {
        const prediction = await predictHumor(text);
        
        logger.debug(`[HumorScorer] ML Model - Text: "${text.substring(0, 50)}..." | Score: ${prediction.score.toFixed(3)} | Label: ${prediction.label} | Humorous: ${prediction.isHumorous}`);
        
        return {
          score: prediction.score,
          label: prediction.label,
          isHumorous: prediction.isHumorous,
        };
      } catch (error) {
        logger.warn('[HumorScorer] ML model failed, falling back to heuristics');
        logger.debug('[HumorScorer] Error:', error);
      }
    }

    // Fallback to heuristic scoring
    const score = calculateHeuristicScore(text, originalText);
    const isHumorous = score > 0.4; // Increased threshold based on feedback analysis
    const label = isHumorous ? 'humorous' : 'not_humorous';
    
    logger.debug(`[HumorScorer] Heuristics - Text: "${text.substring(0, 50)}..." | Score: ${score.toFixed(3)} | Humorous: ${isHumorous}`);

    return {
      score,
      label,
      isHumorous,
    };
  } catch (error) {
    logger.error('[HumorScorer] Error scoring text for humor:', error);
    // Return a neutral score on error to avoid breaking the pipeline
    return { score: 0, label: 'error', isHumorous: false };
  }
}

/**
 * Compare multiple text candidates and return the funniest one
 * @param candidates Array of text candidates to compare
 * @returns The funniest candidate with its score, or null if all fail
 */
export async function selectFunniestCandidate(candidates: string[]): Promise<{ text: string; score: HumorScore } | null> {
  if (!candidates || candidates.length === 0) {
    logger.warn('[HumorScorer] No candidates provided for selection');
    return null;
  }

  if (candidates.length === 1) {
    // Only one candidate, return it with its score
    const score = await scoreHumor(candidates[0]);
    return { text: candidates[0], score };
  }

  try {
    // Score all candidates in parallel
    const scoredCandidates = await Promise.all(
      candidates.map(async (text, index) => {
        const score = await scoreHumor(text);
        return { text, score, index };
      })
    );

    // Find the candidate with the highest humor score
    const funniest = scoredCandidates.reduce((best, current) => 
      current.score.score > best.score.score ? current : best
    );

    logger.info(`[HumorScorer] Selected candidate ${funniest.index + 1}/${candidates.length} with humor score ${funniest.score.score.toFixed(3)}`);

    return { text: funniest.text, score: funniest.score };
  } catch (error) {
    logger.error('[HumorScorer] Error selecting funniest candidate:', error);
    // Fallback to first candidate if scoring fails
    return candidates.length > 0 ? { text: candidates[0], score: { score: 0, label: 'error', isHumorous: false } } : null;
  }
}
