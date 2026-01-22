# Comprehensive Duplicate Prevention System

## Overview

This system implements multiple layers of protection against duplicate posts during translation, addressing various failure modes that could result in repeated content being posted to Twitter.

## Components

### 1. Enhanced Instance Lock (`enhancedInstanceLock.ts`)
- **Purpose**: Prevents multiple bot instances from running simultaneously
- **Features**:
  - Heartbeat monitoring to detect stale locks
  - Automatic cleanup of crashed instances
  - Graceful shutdown handling
- **Prevents**: Race conditions from multiple bots processing the same tweets

### 2. Content Deduplication (`contentDeduplication.ts`)
- **Purpose**: Detects semantically similar content, not just exact duplicates
- **Features**:
  - Jaccard similarity algorithm for text comparison
  - Normalized text processing (removes punctuation, sorts words)
  - Configurable similarity threshold (85%)
- **Prevents**: Posting content that's functionally identical but worded differently

### 3. Translation Stability Checker (`translationStability.ts`)
- **Purpose**: Detects when translation chains are producing repetitive results
- **Features**:
  - Tracks translation attempts and outcomes
  - Monitors for stuck translation chains
  - Detects high retry counts indicating instability
- **Prevents**: Posting results from unstable translation processes

### 4. Comprehensive Duplicate Prevention (`duplicatePrevention.ts`)
- **Purpose**: Orchestrates all duplicate prevention mechanisms
- **Features**:
  - Integrates all checking systems
  - Provides unified API for duplicate detection
  - Handles post recording and cleanup
- **Checks Performed**:
  - Instance lock validation
  - Tweet ID processing status
  - Queue status
  - Post rate limits
  - Content similarity
  - Translation stability
  - Minimum post intervals

## Integration Points

### Worker Integration
The system is integrated into `translateAndPostWorker.ts` at key points:

1. **Initialization**: `initializeDuplicatePrevention()` called at worker start
2. **Pre-posting Check**: `checkForDuplicates()` called before each post attempt
3. **Post Recording**: `recordSuccessfulPost()` called after successful posts

### Queue Processing
Queue processing also uses the comprehensive checks to prevent posting duplicates from the retry queue.

## Configuration

### Similarity Threshold
```typescript
const SIMILARITY_THRESHOLD = 0.85; // 85% word overlap considered duplicate
```

### Stability Windows
```typescript
const STABILITY_WINDOW = 10; // Check last 10 translations for patterns
```

### Lock Timeouts
```typescript
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes before considering lock stale
```

## Monitoring and Maintenance

### Log Files
- `posted-outputs.log`: Tracks all posted content for duplicate detection
- `translation-stability.log`: Records translation attempts for stability analysis
- `.processed-tweets.json`: Tracks processed tweet IDs
- `.post-tracker.json`: Tracks posting frequency
- `.tweet-queue.json`: Manages retry queue

### Cleanup
- Automatic pruning of old log entries
- Daily cleanup of tracking data
- Lock file management

### Testing
Run `scripts/test-duplicate-prevention.ts` to validate all systems.

## Failure Modes Addressed

1. **Multiple Instances**: Instance lock prevents concurrent execution
2. **Exact Duplicates**: Content-based checking catches identical posts
3. **Similar Content**: Semantic similarity detection catches rephrased duplicates
4. **Translation Loops**: Stability checking detects repetitive translation results
5. **Race Conditions**: Comprehensive pre-posting validation
6. **Rate Limit Violations**: Post frequency tracking
7. **File Corruption**: Robust error handling and atomic writes

## Usage

The system is automatically active. No configuration required beyond the existing bot setup. All duplicate prevention happens transparently during normal operation.

## Future Enhancements

- Machine learning-based duplicate detection
- Cross-platform content similarity (beyond Twitter)
- Adaptive similarity thresholds based on content type
- Integration with external duplicate detection services</content>
<parameter name="filePath">c:\Users\Daniel\broteam-translate-bot\DUPLICATE_PREVENTION.md