"""
Convert Hugging Face humor detection model to ONNX format for local inference
This script downloads a humor detection model and converts it to ONNX format
which can be used by Transformers.js without requiring API tokens.

Requirements:
    pip install transformers torch onnx optimum[exporters]

Usage:
    python convert-humor-model-to-onnx.py
"""

import os
import sys
from pathlib import Path

def convert_model():
    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        from optimum.onnxruntime import ORTModelForSequenceClassification
        import torch
        print("✓ All required packages imported successfully")
    except ImportError as e:
        print(f"✗ Missing required package: {e}")
        print("\nPlease install required packages:")
        print("  pip install transformers torch onnx optimum[exporters]")
        sys.exit(1)

    # Model to convert - using a well-tested humor detection model
    MODEL_NAME = "mohameddhiab/humor-no-humor"
    OUTPUT_DIR = Path("models/humor-detector")
    
    print(f"\n📦 Converting model: {MODEL_NAME}")
    print(f"📁 Output directory: {OUTPUT_DIR}\n")
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    try:
        # Step 1: Load the original model
        print("1️⃣  Loading original PyTorch model...")
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
        print("   ✓ Model loaded successfully")
        
        # Step 2: Export to ONNX format using Optimum
        print("\n2️⃣  Converting to ONNX format...")
        onnx_model = ORTModelForSequenceClassification.from_pretrained(
            MODEL_NAME,
            export=True
        )
        print("   ✓ Conversion successful")
        
        # Step 3: Save the ONNX model and tokenizer
        print("\n3️⃣  Saving ONNX model and tokenizer...")
        onnx_model.save_pretrained(OUTPUT_DIR)
        tokenizer.save_pretrained(OUTPUT_DIR)
        print(f"   ✓ Saved to {OUTPUT_DIR.absolute()}")
        
        # Step 4: Test the converted model
        print("\n4️⃣  Testing converted model...")
        test_texts = [
            "This is hilarious! I can't stop laughing!",
            "The quarterly financial report shows steady growth.",
            "Why did the chicken cross the road? To get to the other side!",
        ]
        
        for text in test_texts:
            inputs = tokenizer(text, return_tensors="pt")
            outputs = onnx_model(**inputs)
            logits = outputs.logits
            predicted_class = torch.argmax(logits, dim=1).item()
            probabilities = torch.nn.functional.softmax(logits, dim=1)[0]
            
            label = model.config.id2label[predicted_class]
            confidence = probabilities[predicted_class].item()
            
            print(f"\n   Text: \"{text[:60]}...\"")
            print(f"   Prediction: {label} ({confidence:.3f})")
        
        print("\n✅ Model conversion complete!")
        print(f"\n📝 Next steps:")
        print(f"   1. The model is saved in: {OUTPUT_DIR.absolute()}")
        print(f"   2. Update humorScorer.ts to use: '{OUTPUT_DIR.as_posix()}'")
        print(f"   3. Run: npm run test:humor")
        
    except Exception as e:
        print(f"\n✗ Error during conversion: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    print("🔄 Humor Detection Model Converter")
    print("=" * 50)
    convert_model()
