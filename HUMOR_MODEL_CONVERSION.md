# Humor Model Conversion Guide

This guide explains how to convert a Hugging Face humor detection model to ONNX format for local inference without API tokens.

## Prerequisites

You need Python 3.8+ with pip installed.

## Step 1: Install Python Dependencies

```bash
pip install transformers torch onnx optimum[exporters]
```

Or if you prefer using a virtual environment:

```bash
# Create virtual environment
python -m venv venv

# Activate it
# On Windows:
.\venv\Scripts\activate
# On Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install transformers torch onnx optimum[exporters]
```

## Step 2: Run the Conversion Script

```bash
python scripts/convert-humor-model-to-onnx.py
```

This will:
1. Download the `mohameddhiab/humor-no-humor` model from Hugging Face
2. Convert it to ONNX format
3. Save it to `models/humor-detector/`
4. Test the converted model with sample texts

The conversion takes 1-2 minutes and downloads ~500MB of model files.

## Step 3: Update the Code

Once converted, the model files will be in `models/humor-detector/`. The humor scorer will automatically use the local model.

## Troubleshooting

### "No module named 'transformers'"
Install the required packages: `pip install transformers torch onnx optimum[exporters]`

### "CUDA out of memory"
The conversion runs on CPU by default, but if you see this error, your system may be trying to use GPU. This is fine - the conversion will complete on CPU.

### Download is slow
The model files are ~500MB. First download may take a few minutes depending on your internet speed.

## What Gets Created

```
models/
  humor-detector/
    model.onnx          # The converted model
    config.json         # Model configuration
    tokenizer.json      # Tokenizer configuration
    tokenizer_config.json
    vocab.txt          # Vocabulary
```

## Alternative Models

To convert a different humor detection model, edit `convert-humor-model-to-onnx.py` and change:

```python
MODEL_NAME = "mohameddhiab/humor-no-humor"
```

to any other compatible model like:
- `Humor-Research/humor-detection-comb-23`
- Other text classification models fine-tuned for humor detection
