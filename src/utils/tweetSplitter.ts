/**
 * Split long tweets into chunks that fit Twitter's character limit
 * Twitter limit is 280 chars; reserve space for thread markers.
 */

const MAX_TWEET_LENGTH = 275;
const TWITTER_LIMIT = 280;

export function splitTweet(text: string): string[] {
  if (text.length <= MAX_TWEET_LENGTH) {
    return [text];
  }

  let chunkLimit = TWITTER_LIMIT - ' (1/2)'.length;
  let chunks = splitBody(text, chunkLimit);
  while (chunks.length > 1) {
    const digits = String(chunks.length).length;
    const nextLimit = TWITTER_LIMIT - (4 + 2 * digits);
    if (nextLimit >= chunkLimit) break;
    chunkLimit = nextLimit;
    chunks = splitBody(text, chunkLimit);
  }

  if (chunks.length > 1) {
    return chunks.map((chunk, index) =>
      `${chunk} (${index + 1}/${chunks.length})`
    );
  }
  return chunks;
}

function splitBody(text: string, chunkLimit: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
    
  // Split by sentences first (period, exclamation, question mark)
  const sentences = text.split(/([.!?]\s+)/);
    
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
        
    // If adding this sentence would exceed limit, start new chunk
    if ((currentChunk + sentence).length > chunkLimit) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
            
      // If single sentence is too long, split by words
      if (sentence.length > chunkLimit) {
        const words = sentence.split(' ');
        for (const word of words) {
          if ((currentChunk + ' ' + word).length > chunkLimit) {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = word;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + word;
          }
        }
      } else {
        currentChunk = sentence;
      }
    } else {
      currentChunk += sentence;
    }
  }
    
  // Add remaining chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
    
  return chunks;
}
