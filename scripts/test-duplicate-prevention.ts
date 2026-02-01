#!/usr/bin/env node

/**
 * Duplicate Prevention System Test Script
 * Tests all duplicate prevention mechanisms
 */

import { checkForDuplicates, getDuplicatePreventionStatus } from '../src/utils/duplicatePrevention';
import { isContentDuplicate } from '../src/utils/contentDeduplication';
import { checkTranslationStability } from '../src/utils/translationStability';

async function testDuplicatePrevention() {
  console.log('🧪 Testing Duplicate Prevention System\n');

  // Test 1: Status check
  console.log('1. Current System Status:');
  const status = getDuplicatePreventionStatus();
  console.log(JSON.stringify(status, null, 2));
  console.log();

  // Test 2: Content duplicate detection
  console.log('2. Testing Content Duplicate Detection:');
  const testContents = [
    'This is a test tweet',
    'This is a test tweet', // Exact duplicate
    'This is a test tweet with extra words', // Similar but not duplicate
    'Completely different content here', // Different
  ];

  for (const content of testContents) {
    const isDuplicate = await isContentDuplicate(content);
    console.log(`  "${content.substring(0, 30)}..." -> ${isDuplicate ? 'DUPLICATE' : 'OK'}`);
  }
  console.log();

  // Test 3: Translation stability
  console.log('3. Testing Translation Stability:');
  const stabilityTests = [
    { tweetId: 'test1', input: 'Hello world', output: 'Hola mundo', chain: 'es', attempt: 1 },
    { tweetId: 'test2', input: 'Hello world', output: 'Hola mundo', chain: 'es', attempt: 2 }, // Same output
    { tweetId: 'test3', input: 'Hello world', output: 'Hola mundo', chain: 'es', attempt: 3 }, // Same again
  ];

  for (const test of stabilityTests) {
    const stability = checkTranslationStability(
      test.tweetId,
      test.input,
      test.output,
      test.chain,
      test.attempt
    );
    console.log(`  Tweet ${test.tweetId}: ${stability.isStable ? 'STABLE' : 'UNSTABLE'} (${stability.issues.join(', ')})`);
  }
  console.log();

  // Test 4: Comprehensive duplicate check
  console.log('4. Testing Comprehensive Duplicate Check:');
  const duplicateTests = [
    {
      tweetId: 'fresh123',
      content: 'This is completely new content',
      inputText: 'Original tweet',
      chain: 'random',
      attempt: 1,
      expected: true
    },
    {
      tweetId: 'duplicate123',
      content: 'This is a test tweet', // Assuming this exists in posted-outputs.log
      inputText: 'Original tweet',
      chain: 'random',
      attempt: 1,
      expected: false
    }
  ];

  for (const test of duplicateTests) {
    try {
      const result = await checkForDuplicates(
        test.tweetId,
        test.content,
        test.inputText,
        test.chain,
        test.attempt
      );

      const status = result.canProceed ? '✅ ALLOWED' : '❌ BLOCKED';
      console.log(`  Tweet ${test.tweetId}: ${status} - ${result.reason}`);

      if (result.canProceed !== test.expected) {
        console.log(`    ⚠️  Unexpected result! Expected ${test.expected ? 'allowed' : 'blocked'}`);
      }

    } catch (error) {
      console.log(`  Tweet ${test.tweetId}: ERROR - ${error}`);
    }
  }
  console.log();

  // Test 5: Post recording (commented out to avoid actual posting)
  console.log('5. Post Recording Test:');
  console.log('   (Skipped - would record a test post)');
  console.log('   To test: call recordSuccessfulPost("test-tweet-id", "test content")');
  console.log();

  console.log('✅ Duplicate Prevention System Test Complete');
  console.log('\nRecommendations:');
  console.log('• Monitor translation stability logs for repetitive patterns');
  console.log('• Regularly prune tracking files to prevent bloat');
  console.log('• Review blocked posts to ensure legitimate content isn\'t being filtered');
  console.log('• Consider adjusting similarity thresholds based on false positives');
}

// Run the test
testDuplicatePrevention().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});