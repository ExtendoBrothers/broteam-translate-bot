/**
 * Test script for humor detection
 * Usage: npm run test:humor
 */

import { scoreHumor, selectFunniestCandidate } from '../utils/humorScorer';
import { logger } from '../utils/logger';

async function testHumorScorer() {
  logger.info('=== Testing Humor Scorer ===\n');

  // Test individual texts
  const testTexts = [
    'Why did the chicken cross the road? To get to the other side!',
    'The weather forecast predicts rain tomorrow.',
    'I told my wife she was drawing her eyebrows too high. She looked surprised.',
    'The meeting is scheduled for 3 PM.',
    'bro it also recommended facial hair grooming/removal fucking shitttttt',
    'perhaps she can scam for the $20,630 needed?',
  ];

  logger.info('Testing individual texts:\n');
  for (const text of testTexts) {
    const result = await scoreHumor(text);
    logger.info(`Text: "${text}"`);
    logger.info(`Score: ${result.score.toFixed(3)} | Label: ${result.label} | Humorous: ${result.isHumorous}\n`);
  }

  // Test candidate selection
  logger.info('\n=== Testing Candidate Selection ===\n');
  
  const candidates = [
    'The quarterly report shows steady growth.',
    'I used to play piano by ear, but now I use my hands.',
    'Please submit your timesheet by Friday.',
  ];

  logger.info('Candidates:');
  candidates.forEach((c, i) => logger.info(`  ${i + 1}. ${c}`));
  
  const funniest = await selectFunniestCandidate(candidates);
  if (funniest) {
    logger.info(`\nFunniest candidate: "${funniest.text}"`);
    logger.info(`Humor score: ${funniest.score.score.toFixed(3)}`);
  }

  logger.info('\n=== Test Complete ===');
}

// Run the test
testHumorScorer().catch((error) => {
  logger.error('Test failed:', error);
  process.exit(1);
});
