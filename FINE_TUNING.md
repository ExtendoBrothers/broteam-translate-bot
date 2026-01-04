# Fine-Tuning the Humor Detection Model

This guide explains how to improve humor detection by training the model on your personal feedback data.

## Overview

The bot uses a base humor detection model (`mohameddhiab/humor-no-humor`) to score translations. By collecting feedback on which translations you find funny, you can fine-tune a custom model that matches your humor preferences.

**The Process:**
1. **Collect Feedback** - Bot automatically logs humor comparisons, you provide ratings
2. **Export Training Data** - Convert feedback to Hugging Face format
3. **Fine-Tune Model** - Train custom model on your preferences
4. **Convert to ONNX** - Make model compatible with Transformers.js
5. **Deploy** - Update config to use custom model

---

## Step 1: Collect Feedback

### Automatic Logging

The bot automatically logs every humor comparison decision to `feedback-data.jsonl`:

```json
{
  "timestamp": "2025-01-31T10:30:00.000Z",
  "tweetId": "2007635029888000447",
  "originalText": "bro, how could they cut funding to NPR...",
  "candidates": [
    {"text": "...", "score": 7.2, "label": "HUMOR", "source": "OLDSCHOOL"},
    {"text": "...", "score": 6.8, "label": "HUMOR", "source": "RANDOM_1"}
  ],
  "botSelected": "OLDSCHOOL",
  "selectedResult": "...",
  "selectedScore": 7.2,
  "userFeedback": null
}
```

### Manual Feedback

Use the CLI tool to add your feedback:

```bash
# Rate the selected result (1-5 stars)
node scripts/add-feedback.js 2007635029888000447 --rating 4

# Indicate which candidate was actually best
node scripts/add-feedback.js 2007635029888000447 --best RANDOM_1

# Indicate if bot selection was correct
node scripts/add-feedback.js 2007635029888000447 --correct no

# Add notes about why you liked/disliked it
node scripts/add-feedback.js 2007635029888000447 --notes "Captures the sarcasm better"

# Combine multiple flags
node scripts/add-feedback.js 2007635029888000447 --rating 5 --best OLDSCHOOL --notes "Perfect!"
```

**Recommendation:** Provide feedback on 20-50 tweets before fine-tuning. More feedback = better model.

---

## Step 2: Analyze Feedback Patterns

Before training, review your feedback patterns:

```bash
node scripts/analyze-feedback.js
```

This shows:
- **Selection Accuracy** - How often the bot picked your favorite
- **Source Preferences** - Do you prefer OLDSCHOOL or random chains?
- **Rating Distribution** - Distribution of your 1-5 star ratings
- **Length Patterns** - Do you prefer shorter/longer results?
- **Recommendations** - Suggested scoring adjustments

**Example Output:**
```
📊 HUMOR FEEDBACK ANALYSIS
==================================================

Selection Accuracy: 65% (13/20 correct)

Source Performance:
  OLDSCHOOL: Selected 8 times, Preferred 12 times (60% preference)
  RANDOM_1: Selected 6 times, Preferred 4 times (20% preference)
  RANDOM_2: Selected 4 times, Preferred 3 times (15% preference)

Recommendations:
  • Consider increasing OLDSCHOOL weight by +0.15
  • High-rated results average 142 chars, low-rated 98 chars
  • 60% preference for OLDSCHOOL chain suggests it better captures your humor
```

---

## Step 3: Export Training Data

Convert feedback to Hugging Face training format:

```bash
node scripts/export-training-data.js
```

**Optional flags:**
- `--min-confidence 4` - Only use 4-5 star ratings (higher quality, less data)
- `--output custom-training.jsonl` - Custom output path

**What it does:**
1. Reads `feedback-data.jsonl` entries with `userFeedback` populated
2. Converts to `{text, label}` format where:
   - `label: 1` = HUMOR (actualBest candidate, or 4-5 star ratings)
   - `label: 0` = NO_HUMOR (other candidates when actualBest specified, or 1-2 star ratings)
3. Filters English-only candidates
4. Validates class balance (should have similar counts of HUMOR/NO_HUMOR)
5. Outputs to `training-data.jsonl`

**Output Example:**
```
✓ Exported 45 training examples to training-data.jsonl
  Positive (HUMOR): 24
  Negative (NO_HUMOR): 21
  Class ratio: 1.14:1 (✓ balanced)
```

**Warnings to watch for:**
- `⚠️ Only 15 samples` - Need 20-30+ for reliable training
- `⚠️ Class imbalance` - Too many HUMOR or NO_HUMOR examples
- `⚠️ Not enough feedback` - Most entries missing userFeedback

---

## Step 4: Fine-Tune Model

Train a custom model on your feedback:

```bash
python scripts/fine-tune-model.py
```

**Optional flags:**
- `--epochs 5` - More epochs = better learning (default: 3)
- `--batch-size 16` - Larger batch = faster training (default: 8)
- `--gpu` - Use GPU if available (significantly faster)

**Requirements:**
```bash
pip install transformers torch datasets accelerate scikit-learn
```

**What it does:**
1. Loads base model (`mohameddhiab/humor-no-humor`)
2. Fine-tunes on your `training-data.jsonl`
3. Validates performance on 10% held-out test set
4. Saves best checkpoint to `models/humor-detector-custom/`

**Training Output:**
```
TRAINING
----------------------------------------------------------------------
Epochs: 3
Batch size: 8
Learning rate: 2e-05

Starting training... (this may take 5-30 minutes)

Epoch 1/3: [████████████████████] 100% | Loss: 0.345
Epoch 2/3: [████████████████████] 100% | Loss: 0.198
Epoch 3/3: [████████████████████] 100% | Loss: 0.142

EVALUATION
----------------------------------------------------------------------
Final validation metrics:
  Accuracy: 0.8667
  F1: 0.8571
  Precision: 0.8571
  Recall: 0.8571

✓ Fine-tuned model saved to: models/humor-detector-custom
```

**What to expect:**
- **Accuracy** - Overall correctness (aim for 80%+)
- **F1 Score** - Balance of precision/recall (aim for 0.80+)
- **Training time** - 5-10 minutes on GPU, 15-30 minutes on CPU

---

## Step 5: Convert to ONNX

Convert your custom model to ONNX format for Transformers.js:

```bash
python scripts/convert-humor-model-to-onnx.py --custom
```

**What it does:**
1. Loads your fine-tuned model from `models/humor-detector-custom/`
2. Converts to ONNX format
3. Saves to `models/humor-detector-custom-onnx/`
4. Tests the converted model

**Output:**
```
🎯 Converting CUSTOM fine-tuned model
📁 Output directory: models/humor-detector-custom-onnx

1️⃣  Loading original PyTorch model...
   ✓ Model loaded successfully

2️⃣  Converting to ONNX format...
   ✓ Conversion successful

3️⃣  Saving ONNX model and tokenizer...
   ✓ Saved to C:\...\models\humor-detector-custom-onnx

4️⃣  Testing converted model...
   Text: "This is hilarious! I can't stop laughing!"
   Prediction: HUMOR (0.923)

✅ Model conversion complete!
```

---

## Step 6: Deploy Custom Model

Update configuration to use your custom model:

### Option A: Environment Variable

Add to `.env`:
```
HUMOR_MODEL_PATH=models/humor-detector-custom-onnx
```

### Option B: Update Config

Edit `src/config/index.ts`:
```typescript
humorModelPath: process.env.HUMOR_MODEL_PATH || 'models/humor-detector-custom-onnx',
```

### Restart Bot

```powershell
.\scripts\restart-clean.ps1
```

---

## Workflow Summary

```
┌─────────────────────────┐
│  Bot runs, logs data    │
│  feedback-data.jsonl    │
└───────────┬─────────────┘
            │
            │ 20-50 tweets
            ↓
┌─────────────────────────┐
│  Add manual feedback    │
│  node add-feedback.js   │
└───────────┬─────────────┘
            │
            │ Optional: Review patterns
            ↓
┌─────────────────────────┐
│  node analyze-feedback  │
└───────────┬─────────────┘
            │
            │ Export training data
            ↓
┌─────────────────────────┐
│  node export-training   │
│  → training-data.jsonl  │
└───────────┬─────────────┘
            │
            │ Fine-tune model
            ↓
┌─────────────────────────┐
│  python fine-tune-model │
│  → humor-detector-custom│
└───────────┬─────────────┘
            │
            │ Convert to ONNX
            ↓
┌─────────────────────────┐
│  python convert --custom│
│  → custom-onnx/         │
└───────────┬─────────────┘
            │
            │ Deploy
            ↓
┌─────────────────────────┐
│  Update .env            │
│  restart-clean.ps1      │
└─────────────────────────┘
```

---

## Tips for Best Results

### Feedback Quality
- **Be consistent** - Apply the same humor criteria across all feedback
- **Diverse samples** - Include different topics, styles, lengths
- **Clear preferences** - Don't rate everything 3 stars, use full 1-5 range
- **Specific notes** - "Too formal" vs "Perfect sarcasm" helps pattern analysis

### Training Parameters
- **Start conservative** - Use default 3 epochs first
- **Monitor validation** - If eval accuracy << train accuracy, you're overfitting
- **More data > more epochs** - 50 samples × 3 epochs better than 20 samples × 10 epochs
- **Class balance** - Aim for 40-60% split between HUMOR/NO_HUMOR

### Iteration
1. Deploy custom model
2. Collect more feedback on custom model's selections
3. Re-export training data (now includes custom model feedback)
4. Fine-tune again (model learns from its mistakes)
5. Repeat

---

## Troubleshooting

### "Only 15 training examples found"
- **Solution:** Collect more feedback. The model needs 20-30+ samples minimum.
- **Workaround:** Continue anyway with `--min-confidence 3` to include 3-star ratings.

### "Class imbalance warning"
- **Cause:** Too many HUMOR or too many NO_HUMOR examples.
- **Solution:** Provide feedback on more varied tweets (some funny, some not).
- **Impact:** Model might bias toward majority class.

### "Validation accuracy drops after epoch 1"
- **Cause:** Overfitting - model memorizing training data.
- **Solution:** Reduce epochs: `--epochs 2`
- **Prevention:** Collect more training samples.

### "Model predictions worse than base model"
- **Cause:** Insufficient or inconsistent training data.
- **Solution:** 
  1. Analyze feedback patterns: `node scripts/analyze-feedback.js`
  2. Look for inconsistencies (e.g., similar tweets rated very differently)
  3. Collect 10-20 more samples and retrain

### "Out of memory during training"
- **Solution:** Reduce batch size: `--batch-size 4`
- **Alternative:** Use cloud GPU (Google Colab, Kaggle)

---

## Advanced: Continuous Learning

Set up a workflow to continuously improve your model:

```bash
# Weekly cron job (or manual)
# 1. Analyze recent feedback
node scripts/analyze-feedback.js > analysis-$(date +%Y%m%d).txt

# 2. Export training data (cumulative)
node scripts/export-training-data.js

# 3. Check if enough new samples (e.g., 10+ since last training)
# If yes:

# 4. Fine-tune model
python scripts/fine-tune-model.py --epochs 3

# 5. Convert to ONNX
python scripts/convert-humor-model-to-onnx.py --custom

# 6. Deploy
.\scripts\restart-clean.ps1
```

This way, your model constantly adapts to your evolving humor preferences.

---

## Questions?

**Q: How often should I retrain?**  
A: After every 20-30 new feedback samples. More frequent training with few samples can hurt performance.

**Q: Can I start over?**  
A: Yes. Rename or delete `training-data.jsonl` and run export again with `--min-confidence 4` for only high-quality samples.

**Q: Do I need Python installed?**  
A: Yes, for training (fine-tune-model.py) and ONNX conversion. Python 3.8+ required.

**Q: Can I use multiple GPUs?**  
A: Yes, the training script automatically uses all available GPUs via Hugging Face Accelerate.

**Q: What if my custom model performs worse?**  
A: Revert to base model by removing `HUMOR_MODEL_PATH` from `.env` and restarting. Analyze your feedback for inconsistencies.

---

## File Reference

| File | Purpose |
|------|---------|
| `feedback-data.jsonl` | Automatic log of all humor comparisons |
| `scripts/add-feedback.js` | CLI tool to add manual feedback |
| `scripts/analyze-feedback.js` | Analyze feedback patterns |
| `scripts/export-training-data.js` | Convert feedback → training format |
| `training-data.jsonl` | Training data for fine-tuning |
| `scripts/fine-tune-model.py` | Fine-tune custom model |
| `scripts/convert-humor-model-to-onnx.py` | Convert model → ONNX |
| `models/humor-detector-custom/` | Fine-tuned PyTorch model |
| `models/humor-detector-custom-onnx/` | ONNX model for deployment |

---

## License

This fine-tuning process uses the `mohameddhiab/humor-no-humor` base model. Check the original model's license before commercial use.
