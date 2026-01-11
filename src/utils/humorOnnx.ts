/**
 * Direct ONNX model inference for humor detection
 * Uses onnxruntime-node to run the locally converted model
 */

import * as ort from 'onnxruntime-node';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const MODEL_DIR = path.join(process.cwd(), 'models', 'humor-detector-custom-onnx');
const MODEL_PATH = path.join(MODEL_DIR, 'model.onnx');
const VOCAB_PATH = path.join(MODEL_DIR, 'vocab.txt');
const CONFIG_PATH = path.join(MODEL_DIR, 'config.json');

let session: ort.InferenceSession | null = null;
let vocab: Map<string, number> | null = null;
let config: { id2label?: Record<number, string> } | null = null;

// Load vocab file
function loadVocab(): Map<string, number> {
  if (vocab) return vocab;
  
  const vocabText = fs.readFileSync(VOCAB_PATH, 'utf-8');
  vocab = new Map();
  vocabText.split('\n').forEach((token, idx) => {
    if (token.trim()) {
      vocab!.set(token.trim(), idx);
    }
  });
  return vocab;
}

// Load config
function loadConfig(): { id2label?: Record<number, string> } {
  if (config) return config;
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return config!;
}

// Basic tokenizer (simplified BERT tokenizer)
function tokenize(text: string): number[] {
  const vocab = loadVocab();
  const tokens: number[] = [];
  
  // Add [CLS] token
  tokens.push(vocab.get('[CLS]') || 101);
  
  // Simple word tokenization (lowercase and split)
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    const tokenId = vocab.get(word) || vocab.get('[UNK]') || 100;
    tokens.push(tokenId);
    
    if (tokens.length >= 510) break; // Leave room for [SEP]
  }
  
  // Add [SEP] token
  tokens.push(vocab.get('[SEP]') || 102);
  
  return tokens;
}

// Initialize ONNX session
async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  
  logger.info(`[HumorONNX] Loading ONNX model from: ${MODEL_PATH}`);
  session = await ort.InferenceSession.create(MODEL_PATH);
  logger.info('[HumorONNX] Model loaded successfully');
  
  return session;
}

export interface HumorPrediction {
  label: string;
  score: number;
  isHumorous: boolean;
}

export async function predictHumor(text: string): Promise<HumorPrediction> {
  try {
    const sess = await getSession();
    const cfg = loadConfig();
    
    // Tokenize input
    const inputIds = tokenize(text);
    const attentionMask = new Array(inputIds.length).fill(1);
    
    // Pad to max length (512)
    const maxLength = 512;
    while (inputIds.length < maxLength) {
      inputIds.push(0);
      attentionMask.push(0);
    }
    
    // Create tensors
    const inputIdsTensor = new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, maxLength]);
    const attentionMaskTensor = new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, maxLength]);
    
    // Run inference
    const feeds: Record<string, ort.Tensor> = {
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
    };
    
    const results = await sess.run(feeds);
    const logits = results.logits.data as Float32Array;
    
    // Apply softmax
    const expScores = Array.from(logits).map(x => Math.exp(x));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const probabilities = expScores.map(x => x / sumExp);
    
    // Get prediction
    const predictedIdx = probabilities.indexOf(Math.max(...probabilities));
    const label = cfg.id2label?.[predictedIdx] || (predictedIdx === 1 ? 'HUMOR' : 'NO_HUMOR');
    const score = probabilities[predictedIdx];
    const isHumorous = label.includes('HUMOR') && !label.includes('NO');
    
    logger.debug(`[HumorONNX] Text: "${text.substring(0, 50)}..." | Label: ${label} | Score: ${score.toFixed(3)} | Humorous: ${isHumorous}`);
    
    return {
      label,
      score,
      isHumorous,
    };
  } catch (error) {
    logger.error('[HumorONNX] Error during inference:', error);
    throw error;
  }
}

export function isModelAvailable(): boolean {
  return fs.existsSync(MODEL_PATH) && fs.existsSync(VOCAB_PATH);
}
