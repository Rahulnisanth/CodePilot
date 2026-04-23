import { GoogleGenerativeAI } from '@google/generative-ai';
import { ClassificationResult, WorkType } from '../types';
import { readJson, writeJson, getCodeBrainProDir } from '../utils/storage';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  buildClassifierPrompt,
} from './promptTemplates';
import * as path from 'path';

const CACHE_FILE = () =>
  path.join(getCodeBrainProDir(), 'classifier-cache.json');

/**
 * Keyword-based fallback classification rules (for offline / no-key mode).
 */
const KEYWORD_RULES: { patterns: RegExp; type: WorkType }[] = [
  { patterns: /fix|bug|patch|hotfix|issue|error|defect/i, type: 'bugfix' },
  { patterns: /feat|add|new|implement|create|introduce/i, type: 'feature' },
  {
    patterns: /refactor|clean|restructure|rename|move|improve/i,
    type: 'refactor',
  },
  { patterns: /doc|readme|docs|comment|changelog/i, type: 'docs' },
  { patterns: /test|spec|unit|e2e|coverage/i, type: 'test' },
  { patterns: /chore|dep|ci|build|config|lint|format|version/i, type: 'chore' },
];

function keywordFallback(message: string): ClassificationResult {
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.test(message)) {
      return {
        type: rule.type,
        confidence: 0.6,
        summary: `Keyword-matched as ${rule.type}`,
      };
    }
  }
  return {
    type: 'unknown',
    confidence: 0.1,
    summary: 'Could not determine work type',
  };
}

/**
 * AI-powered commit classifier using Google Gemini.
 * Falls back to keyword matching when offline or key not set.
 */
export class CommitClassifier {
  private cache: Record<string, ClassificationResult>;

  constructor(private readonly geminiApiKey: string | null) {
    this.cache = readJson<Record<string, ClassificationResult>>(
      CACHE_FILE(),
      {},
    );
  }

  /**
   * Classify a commit. Results are cached by hash to avoid redundant calls.
   */
  async classify(
    commitHash: string,
    commitMessage: string,
    diffStat: string,
  ): Promise<ClassificationResult> {
    // Return from cache if available
    if (this.cache[commitHash]) {
      return this.cache[commitHash];
    }

    let result: ClassificationResult;

    if (this.geminiApiKey) {
      result = await this.classifyWithGemini(commitMessage, diffStat);
    } else {
      result = keywordFallback(commitMessage);
    }

    // Cache the result
    this.cache[commitHash] = result;
    writeJson(CACHE_FILE(), this.cache);

    return result;
  }

  private async classifyWithGemini(
    message: string,
    diffStat: string,
  ): Promise<ClassificationResult> {
    try {
      const genAI = new GoogleGenerativeAI(this.geminiApiKey!);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: CLASSIFIER_SYSTEM_PROMPT,
      });

      const prompt = buildClassifierPrompt(message, diffStat);
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        type: (parsed.type as WorkType) ?? 'unknown',
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
        summary: parsed.summary ?? '',
      };
    } catch {
      // Graceful degradation: fall back to keyword matching
      return keywordFallback(message);
    }
  }

  /**
   * Update the Gemini API key (e.g. after user inputs it).
   */
  updateApiKey(key: string | null): void {
    (this as unknown as { geminiApiKey: string | null }).geminiApiKey = key;
  }
}
