# Humor Detection Integration

This bot now includes a **fully local** humor detection system using a converted ONNX model that runs without any API tokens or internet connection.

## Features

- **ML-powered detection**: Uses the `mohameddhiab/humor-no-humor` model converted to ONNX format
- **Fully local inference**: Runs on your machine using ONNX Runtime - no API calls, no tokens needed
- **Fast performance**: ~150-200ms per prediction
- **Automatic fallback**: Falls back to heuristic-based scoring if model not available
- **Configurable**: Can be enabled/disabled via environment variables

## Quick Start

### 1. Convert the Model (One-Time Setup)

```bash
# Install Python dependencies (if not already done)
pip install transformers torch onnx optimum[onnxruntime]

# Run the conversion script
python scripts/convert-humor-model-to-onnx.py
```

This downloads and converts the humor detection model to ONNX format (~268MB download, saves to `models/humor-detector/`).

### 2. Test It

```bash
npm run test:humor
```

### 3. Use It

```typescript
import { scoreHumor } from './utils/humorScorer';

const result = await scoreHumor('I told my wife she was drawing her eyebrows too high. She looked surprised.');
console.log(result);
// { score: 0.984, label: 'HUMOR', isHumorous: true }
```

## How It Works

### Local ONNX Model

The system uses a BERT-based model fine-tuned for humor detection:

1. **Model**: `mohameddhiab/humor-no-humor` (converted to ONNX)
2. **Input**: Text is tokenized using BERT tokenizer
3. **Processing**: ONNX Runtime runs inference locally
4. **Output**: Binary classification (HUMOR/NO_HUMOR) with confidence score

**Example Results:**
- "I told my wife she was drawing her eyebrows too high. She looked surprised." → **HUMOR (98.4%)**
- "The weather forecast predicts rain tomorrow." → **NO_HUMOR (97.8%)**
- "bro it also recommended facial hair grooming/removal fucking shitttttt" → **NO_HUMOR (98.0%)**

### Heuristic Fallback

If the ONNX model isn't available, the system falls back to pattern-based detection:

- **Keywords**: lol, lmao, bro, wtf, fucking, crazy (+0.15 each)
- **Patterns**: Multiple !!!, ???, repeated letters (+0.1 each)
- **Structure**: Questions, short punchy text (+0.05)

## Configuration

Add to `.env`:

```bash
# Enable/disable humor detection (default: false)
HUMOR_DETECTION_ENABLED=true

# Minimum score threshold (0-1, default: 0.5)
HUMOR_THRESHOLD=0.5
```

## Performance

- **Model Load Time**: ~500ms (first use only, then cached)
- **Inference Time**: ~150-200ms per text
- **Memory Usage**: ~100MB (model in memory)
- **Disk Space**: ~270MB (model files)

## Integration with Translation Pipeline

Perfect for selecting the funniest translation variant:

```typescript
import { selectFunniestCandidate } from './utils/humorScorer';

// Generate multiple translations
const translations = [
  translateChain1(originalText),
  translateChain2(originalText),
  translateChain3(originalText),
];

// Pick the funniest one
const best = await selectFunniestCandidate(translations);
postTweet(best.text);
```

## Files

- `src/utils/humorScorer.ts` - Main humor scoring implementation
- `src/scripts/testHumorScorer.ts` - Test suite with examples
- `src/config/index.ts` - Configuration options

## Dependencies

- `@huggingface/inference` - For future ML model integration
- `@xenova/transformers` - For local model inference (optional)

Current implementation uses zero external dependencies for scoring.
