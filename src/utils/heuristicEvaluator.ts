/**
 * Heuristic-based humor evaluation based on user feedback patterns
 * This complements the ML humor scorer with rule-based checks
 */

export interface HeuristicScore {
  score: number;
  details: string[];
}

/**
 * Evaluate translation result against user-defined heuristics
 * Returns a score bonus/penalty and explanation details
 */
export function evaluateHeuristics(result: string, original: string): HeuristicScore {
  const text = result.trim();
  const originalLower = original.toLowerCase();
  const textLower = text.toLowerCase();
  let score = 0;
  const details: string[] = [];

  // Positive heuristics - what makes posts funnier
  // 1. Full sentences, coherent phrases, questions, shouts
  if (/[.!?]$/.test(text) || text.includes('?') || text === text.toUpperCase() && text.length > 5) {
    score += 0.05;
    details.push('full sentence/question structure');
  }

  // 2. Set up-punchline structure (simplified detection)
  if (text.includes(':') || text.includes(' - ') || /[,;]/.test(text)) {
    score += 0.03;
    details.push('setup-punchline structure');
  }

  // 3. Ideal subjects scoring
  const idealSubjects = [
    'politics', 'crime', 'games', 'extreme', 'conversation', 'indignant', 'gregarious',
    'irony', 'juxtaposed', 'self-deprecation', 'self-doubt', 'reality', 'race', 'color',
    'ethnicity', 'countries', 'canada', 'canadian', 'sexual', 'anatomy', 'current events',
    'gamergate', 'social justice', 'trump', 'leftism', 'rightism', 'autism', 'incels'
  ];
  const subjectMatches = idealSubjects.filter(subject => textLower.includes(subject)).length;
  if (subjectMatches > 0) {
    score += subjectMatches * 0.02;
    details.push(`ideal subjects (${subjectMatches} matches)`);
  }

  // 4. Broteampill-specific humor
  const broSubjects = [
    'gym', 'protein', 'beer', 'gaming', 'pickup', 'chad', 'incel', 'redpilled',
    'bro science', 'masculinity', 'confidence', 'insecurity'
  ];
  const broMatches = broSubjects.filter(subject => textLower.includes(subject)).length;
  if (broMatches > 0) {
    score += broMatches * 0.025;
    details.push(`broteampill themes (${broMatches} matches)`);
  }

  // 5. Gaming/streaming culture
  const gamingTerms = ['streaming', 'girls', 'mdickie', 'gaming', 'stream'];
  const gamingMatches = gamingTerms.filter(term => textLower.includes(term)).length;
  if (gamingMatches > 0) {
    score += gamingMatches * 0.02;
    details.push('gaming/streaming culture');
  }

  // 6. Dark/edgy humor
  const darkTerms = ['theft', 'ugly', 'dictator', 'molested', 'dark', 'edgy'];
  const darkMatches = darkTerms.filter(term => textLower.includes(term)).length;
  if (darkMatches > 0) {
    score += darkMatches * 0.025;
    details.push('dark/edgy humor');
  }

  // 7. Semantic breakdown patterns
  if (/(\w+)\s+\1\s+\1/.test(textLower) || /cent|binary|unicode/.test(textLower)) {
    score += 0.04;
    details.push('semantic breakdown/repetition');
  }

  // 8. Foreign language fragments
  if (/[áéíóúñ¿¡]/.test(text) || /[\u0400-\u04FF]/.test(text)) {
    score += 0.03;
    details.push('foreign language fragments');
  }

  // 9. Maniacal repetition of complete phrases
  const words = textLower.split(/\s+/);
  if (words.length >= 6) {
    const phrases: string[] = [];
    for (let i = 0; i < words.length - 2; i++) {
      phrases.push(words.slice(i, i + 3).join(' '));
    }
    const repeatedPhrases = phrases.filter((phrase, index) => phrases.indexOf(phrase) !== index);
    if (repeatedPhrases.length > 0) {
      score += 0.04;
      details.push('maniacal repetition');
    }
  }

  // 10. Dirty interpretations
  const dirtyTerms = ['sex', 'fuck', 'dick', 'pussy', 'ass', 'tits', 'cock', 'cum', 'blowjob'];
  const dirtyMatches = dirtyTerms.filter(term => textLower.includes(term)).length;
  if (dirtyMatches > 0) {
    score += dirtyMatches * 0.03;
    details.push('dirty/sexual innuendo');
  }

  // 11. Self-contradiction
  const contradictionPatterns = [
    /\b(nice|good|smart|fast|hot)\b.*\b(bad|evil|stupid|slow|cold)\b/,
    /\b(assured|confident)\b.*\b(what's going on|confused|lost)\b/
  ];
  if (contradictionPatterns.some(pattern => pattern.test(textLower))) {
    score += 0.035;
    details.push('self-contradiction');
  }

  // Negative heuristics - what makes results less funny
  // 1. Single word posts
  if (words.length === 1) {
    score -= 0.1;
    details.push('single word (penalty)');
  }

  // 2. Incoherent sentences (very short, no structure)
  if (text.length < 10 && !/[.!?]/.test(text)) {
    score -= 0.05;
    details.push('incoherent/short (penalty)');
  }

  // 3. Too close to original (verbatim repetition)
  const originalWords = originalLower.split(/\s+/);
  const commonWords = words.filter(word => originalWords.includes(word)).length;
  const similarityRatio = commonWords / Math.max(words.length, originalWords.length);
  if (similarityRatio > 0.8) {
    score -= 0.06;
    details.push('too similar to original (penalty)');
  }

  // 4. Syntactical nonsense (no verbs, no structure)
  const hasVerbs = /\b(is|are|was|were|has|have|had|do|does|did|will|would|can|could|should|may|might|go|run|eat|drink|fuck|kill|die)\b/.test(textLower);
  if (!hasVerbs && words.length > 3) {
    score -= 0.04;
    details.push('no verbs/structure (penalty)');
  }

  // 5. Garbage (low word diversity)
  const uniqueWords = new Set(words);
  const diversityRatio = uniqueWords.size / words.length;
  if (diversityRatio < 0.5 && words.length > 5) {
    score -= 0.05;
    details.push('low diversity/garbage (penalty)');
  }

  return { score, details };
}