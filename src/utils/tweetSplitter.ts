/**
 * Split long tweets into chunks that fit Twitter's character limit
 * Twitter limit is 280 chars, we use 275 to leave room for thread markers
 */

const MAX_TWEET_LENGTH = 275;

export function splitTweet(text: string): string[] {
  if (text.length <= MAX_TWEET_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let currentChunk = '';
    
  // Split by sentences first (period, exclamation, question mark)
  const sentences = text.split(/([.!?]\s+)/);
    
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
        
    // If adding this sentence would exceed limit, start new chunk
    if ((currentChunk + sentence).length > MAX_TWEET_LENGTH) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
            
      // If single sentence is too long, split by words
      if (sentence.length > MAX_TWEET_LENGTH) {
        const words = sentence.split(' ');
        for (const word of words) {
          if ((currentChunk + ' ' + word).length > MAX_TWEET_LENGTH) {
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
    
  // Add thread markers (1/n, 2/n, etc.)
  if (chunks.length > 1) {
    return chunks.map((chunk, index) => 
      `${chunk} (${index + 1}/${chunks.length})`
    );
  }
    
  return chunks;
}
