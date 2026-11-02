#!/usr/bin/env node
/**
 * Export Training Data from Feedback
 * 
 * Converts user feedback into Hugging Face training format for fine-tuning
 * the humor detection model based on personal preferences.
 * 
 * Usage:
 *   node scripts/export-training-data.js
 *   node scripts/export-training-data.js --min-confidence 4
 *   node scripts/export-training-data.js --output custom-training.jsonl
 *   node scripts/export-training-data.js --include-agent-auto
 *   node scripts/export-training-data.js --balance
 * 
 * Training Label Logic:
 *   - actualBest candidate → HUMOR (label=1)
 *   - High rating (4-5★) → HUMOR
 *   - Low rating (1-2★) → NO_HUMOR
 *   - Other candidates when actualBest specified → NO_HUMOR
 */

const fs = require('fs');
const path = require('path');

function exportTrainingData() {
  const args = process.argv.slice(2);
  const includeAgentAuto = args.includes('--include-agent-auto');
  const balanceClasses = args.includes('--balance');
  
  // Parse arguments
  let minConfidence = 3; // Minimum rating to consider data reliable
  let outputFile = 'training-data.jsonl';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--min-confidence' && args[i + 1]) {
      minConfidence = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    }
  }

  const feedbackPath = path.join(process.cwd(), 'feedback-data.jsonl');
  
  if (!fs.existsSync(feedbackPath)) {
    console.error('Error: feedback-data.jsonl not found.');
    console.error('Process some tweets first to generate feedback data.');
    process.exit(1);
  }

  const lines = fs.readFileSync(feedbackPath, 'utf8').split('\n').filter(Boolean);
  const entries = lines.map(line => JSON.parse(line));
  // Automatic feedback is generated from the same heuristics being trained.
  // Exclude it by default to avoid teaching the model its own predictions.
  const withFeedback = entries.filter(e => {
    if (!e.userFeedback) return false;
    if (includeAgentAuto) return true;
    return String(e.userFeedback.feedbackSource || '').toLowerCase().startsWith('user');
  });

  console.log('='.repeat(70));
  console.log('EXPORT TRAINING DATA');
  console.log('='.repeat(70));
  console.log(`\nFeedback entries used: ${withFeedback.length}`);
  if (!includeAgentAuto) {
    console.log('  Source filter: manual user feedback only');
  }

  if (withFeedback.length < 20) {
    console.warn(`\n⚠️  Warning: Only ${withFeedback.length} feedback entries found.`);
    console.warn('   Recommendation: Collect at least 20-30 samples for meaningful fine-tuning.');
    console.warn('   50+ samples recommended for best results.\n');
  }

  const trainingExamples = [];
  let positiveCount = 0;
  let negativeCount = 0;

  withFeedback.forEach(entry => {
    const feedback = entry.userFeedback;
    
    // Skip low-confidence feedback
    if (feedback.rating && feedback.rating < minConfidence) {
      return;
    }

    // Strategy 1: Use actualBest to create positive/negative pairs
    if (feedback.actualBest) {
      entry.candidates.forEach(candidate => {
        // Only use English candidates
        if (!candidate.isEnglish) return;

        const isPositive = candidate.source === feedback.actualBest;
        const label = isPositive ? 1 : 0;
        
        trainingExamples.push({
          text: candidate.result,
          label: label,
          source: 'actualBest',
          tweetId: entry.tweetId
        });

        if (isPositive) positiveCount++;
        else negativeCount++;
      });
    }
    // Strategy 2: Use rating alone if no actualBest
    else if (feedback.rating) {
      const selectedCandidate = entry.candidates.find(c => c.source === entry.botSelected);
      
      if (selectedCandidate && selectedCandidate.isEnglish) {
        const isPositive = feedback.rating >= 4;
        const label = isPositive ? 1 : 0;
        
        trainingExamples.push({
          text: selectedCandidate.result,
          label: label,
          source: 'rating',
          tweetId: entry.tweetId
        });

        if (isPositive) positiveCount++;
        else negativeCount++;
      }
    }
  });

  if (balanceClasses) {
    const positives = trainingExamples.filter(example => example.label === 1);
    const negatives = trainingExamples.filter(example => example.label === 0);
    const targetCount = Math.min(positives.length, negatives.length);
    const sortByStableKey = (a, b) => `${a.tweetId}:${a.text}`.localeCompare(`${b.tweetId}:${b.text}`);

    positives.sort(sortByStableKey);
    negatives.sort(sortByStableKey);
    trainingExamples.length = 0;
    trainingExamples.push(...positives.slice(0, targetCount), ...negatives.slice(0, targetCount));
  }

  positiveCount = trainingExamples.filter(example => example.label === 1).length;
  negativeCount = trainingExamples.filter(example => example.label === 0).length;

  console.log(`\nTraining examples generated: ${trainingExamples.length}`);
  if (balanceClasses) {
    console.log('  Class balancing: enabled');
  }
  console.log(`  Positive (HUMOR): ${positiveCount}`);
  console.log(`  Negative (NO_HUMOR): ${negativeCount}`);

  if (trainingExamples.length === 0) {
    console.error('\n❌ No training examples generated.');
    console.error('   Make sure to provide feedback with --rating or --best flags.');
    process.exit(1);
  }

  // Check class balance
  const ratio = positiveCount / negativeCount;
  if (ratio < 0.33 || ratio > 3.0) {
    console.warn('\n⚠️  Class imbalance detected!');
    console.warn(`   Ratio: ${ratio.toFixed(2)}:1 (positive:negative)`);
    console.warn('   Recommendation: Aim for roughly equal positive/negative examples.');
    console.warn('   Consider providing more varied feedback.\n');
  }

  // Write training data
  const outputPath = path.join(process.cwd(), outputFile);
  const trainingLines = trainingExamples.map(ex => JSON.stringify({
    text: ex.text,
    label: ex.label
  }));
  
  fs.writeFileSync(outputPath, trainingLines.join('\n') + '\n', 'utf8');

  console.log(`\n✓ Training data exported to: ${outputFile}`);
  console.log('\nNext steps:');
  console.log('  1. Install dependencies: pip install transformers torch datasets');
  console.log('  2. Run fine-tuning: python scripts/fine-tune-model.py');
  console.log('  3. Convert to ONNX: python scripts/convert-humor-model-to-onnx.py --custom');
  console.log('  4. Restart bot: .\\scripts\\restart-clean.ps1');
  
  // Show some examples
  console.log('\n' + '-'.repeat(70));
  console.log('SAMPLE TRAINING EXAMPLES');
  console.log('-'.repeat(70));
  
  trainingExamples.slice(0, 5).forEach((ex, i) => {
    console.log(`\n${i + 1}. [${ex.label === 1 ? 'HUMOR' : 'NO_HUMOR'}] "${ex.text.substring(0, 60)}..."`);
    console.log(`   Source: ${ex.source}, Tweet: ${ex.tweetId}`);
  });

  console.log('\n' + '='.repeat(70));
}

exportTrainingData();
