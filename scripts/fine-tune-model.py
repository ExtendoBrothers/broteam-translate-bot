#!/usr/bin/env python3
"""
Fine-tune Humor Detection Model on Personal Feedback

This script fine-tunes the base humor-no-humor model on your personal
feedback data to create a custom model that matches your humor preferences.

Requirements:
    pip install transformers torch datasets accelerate

Usage:
    python scripts/fine-tune-model.py
    python scripts/fine-tune-model.py --data training-data.jsonl
    python scripts/fine-tune-model.py --epochs 5 --batch-size 8
    python scripts/fine-tune-model.py --gpu  # Use GPU if available

The fine-tuned model will be saved to: models/humor-detector-custom/
"""

import argparse
import json
import os
from pathlib import Path

try:
    from transformers import (
        AutoTokenizer,
        AutoModelForSequenceClassification,
        TrainingArguments,
        Trainer,
        EarlyStoppingCallback
    )
    from datasets import Dataset
    import torch
except ImportError as e:
    print("❌ Missing dependencies!")
    print("\nPlease install required packages:")
    print("  pip install transformers torch datasets accelerate")
    print(f"\nError: {e}")
    exit(1)


def load_training_data(data_path):
    """Load and parse training data from JSONL file."""
    if not os.path.exists(data_path):
        print(f"❌ Training data not found: {data_path}")
        print("\nGenerate training data first:")
        print("  node scripts/export-training-data.js")
        exit(1)
    
    data = []
    with open(data_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                data.append(json.loads(line))
    
    if len(data) < 20:
        print(f"⚠️  Warning: Only {len(data)} training examples found.")
        print("   Recommendation: Collect 20-30+ feedback samples for best results.")
        response = input("\nContinue anyway? (y/N): ")
        if response.lower() != 'y':
            exit(0)
    
    return data


def prepare_dataset(data, tokenizer, val_split=0.1):
    """Prepare train/validation datasets."""
    # Convert to Hugging Face Dataset
    dataset = Dataset.from_dict({
        'text': [item['text'] for item in data],
        'label': [item['label'] for item in data]
    })
    
    # Tokenize
    def tokenize_function(examples):
        return tokenizer(
            examples['text'],
            padding='max_length',
            truncation=True,
            max_length=128
        )
    
    tokenized = dataset.map(tokenize_function, batched=True)
    
    # Split train/validation
    split = tokenized.train_test_split(test_size=val_split, seed=42)
    
    return split['train'], split['test']


def compute_metrics(eval_pred):
    """Compute accuracy and F1 metrics."""
    from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
    
    predictions, labels = eval_pred
    predictions = predictions.argmax(axis=-1)
    
    return {
        'accuracy': accuracy_score(labels, predictions),
        'f1': f1_score(labels, predictions, average='binary'),
        'precision': precision_score(labels, predictions, average='binary'),
        'recall': recall_score(labels, predictions, average='binary')
    }


def main():
    parser = argparse.ArgumentParser(description='Fine-tune humor detection model')
    parser.add_argument('--data', default='training-data.jsonl', help='Path to training data')
    parser.add_argument('--output', default='models/humor-detector-custom', help='Output directory')
    parser.add_argument('--epochs', type=int, default=3, help='Number of training epochs')
    parser.add_argument('--batch-size', type=int, default=8, help='Training batch size')
    parser.add_argument('--learning-rate', type=float, default=2e-5, help='Learning rate')
    parser.add_argument('--gpu', action='store_true', help='Use GPU if available')
    args = parser.parse_args()
    
    print("=" * 70)
    print("FINE-TUNE HUMOR DETECTION MODEL")
    print("=" * 70)
    
    # Check for GPU
    device = 'cuda' if args.gpu and torch.cuda.is_available() else 'cpu'
    print(f"\nDevice: {device}")
    if args.gpu and not torch.cuda.is_available():
        print("⚠️  GPU requested but not available, using CPU")
    
    # Load base model
    base_model = "mohameddhiab/humor-no-humor"
    print(f"\nLoading base model: {base_model}")
    
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    model = AutoModelForSequenceClassification.from_pretrained(
        base_model,
        num_labels=2,
        id2label={0: "NO_HUMOR", 1: "HUMOR"},
        label2id={"NO_HUMOR": 0, "HUMOR": 1}
    )
    
    # Load training data
    print(f"\nLoading training data: {args.data}")
    data = load_training_data(args.data)
    print(f"  Total examples: {len(data)}")
    
    positive = sum(1 for d in data if d['label'] == 1)
    negative = len(data) - positive
    print(f"  Positive (HUMOR): {positive}")
    print(f"  Negative (NO_HUMOR): {negative}")
    print(f"  Class ratio: {positive/negative:.2f}:1")
    
    # Prepare datasets
    print("\nPreparing datasets...")
    train_dataset, val_dataset = prepare_dataset(data, tokenizer)
    print(f"  Training samples: {len(train_dataset)}")
    print(f"  Validation samples: {len(val_dataset)}")
    
    # Training arguments
    output_dir = args.output
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_dir=f"{output_dir}/logs",
        logging_steps=10,
        save_total_limit=2,
        report_to="none",  # Disable wandb/tensorboard
        use_cpu=(device == 'cpu')
    )
    
    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)]
    )
    
    # Train
    print("\n" + "-" * 70)
    print("TRAINING")
    print("-" * 70)
    print(f"Epochs: {args.epochs}")
    print(f"Batch size: {args.batch_size}")
    print(f"Learning rate: {args.learning_rate}")
    print("\nStarting training... (this may take 5-30 minutes)\n")
    
    trainer.train()
    
    # Evaluate
    print("\n" + "-" * 70)
    print("EVALUATION")
    print("-" * 70)
    
    eval_results = trainer.evaluate()
    print("\nFinal validation metrics:")
    for key, value in eval_results.items():
        if key.startswith('eval_'):
            metric_name = key.replace('eval_', '').capitalize()
            print(f"  {metric_name}: {value:.4f}")
    
    # Save
    print("\n" + "-" * 70)
    print("SAVING MODEL")
    print("-" * 70)
    
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    
    print(f"\n✓ Fine-tuned model saved to: {output_dir}")
    print("\nNext steps:")
    print("  1. Convert to ONNX: python scripts/convert-humor-model-to-onnx.py --custom")
    print("  2. Test with: node src/scripts/testHumorScorer.ts")
    print("  3. Deploy: .\\scripts\\restart-clean.ps1")
    
    print("\n" + "=" * 70)


if __name__ == "__main__":
    main()
