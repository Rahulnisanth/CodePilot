import { GoogleGenerativeAI } from '@google/generative-ai';
import { WorkUnit, WorkType } from '../types';
import { buildReporterPrompt } from './promptTemplates';

/**
 * AI-powered report narrative generator.
 * Produces 2-3 sentence achievement highlights for reports.
 */
export class AiReporter {
  constructor(private readonly geminiApiKey: string | null) {}

  /**
   * Generate an achievement narrative for a report period.
   */
  async generateNarrative(
    period: string,
    workUnits: WorkUnit[],
    stats: {
      totalActiveMinutes: number;
      linesAdded: number;
      linesRemoved: number;
      repos: string[];
    },
  ): Promise<string> {
    if (!this.geminiApiKey) {
      return this.generateFallbackNarrative(period, workUnits, stats);
    }

    try {
      const genAI = new GoogleGenerativeAI(this.geminiApiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const prompt = buildReporterPrompt(
        period,
        workUnits.map((u) => ({
          name: u.name,
          type: u.type as WorkType,
          commitCount: u.commits.length,
        })),
        stats,
      );

      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch {
      return this.generateFallbackNarrative(period, workUnits, stats);
    }
  }

  /**
   * Answer a natural language question about the developer's work.
   */
  async answerQuestion(question: string, workContext: string): Promise<string> {
    if (!this.geminiApiKey) {
      return 'AI features are unavailable — no Gemini API key set. Run "ACM: Open Settings" to configure.';
    }

    try {
      const genAI = new GoogleGenerativeAI(this.geminiApiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const prompt = `You are ACM, a personal developer productivity assistant.
Answer this question about the developer's recent work based ONLY on the provided context.
Be conversational, concise, and helpful.

Work context:
${workContext}

Question: ${question}`;

      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      return `Unable to answer: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private generateFallbackNarrative(
    period: string,
    workUnits: WorkUnit[],
    stats: { totalActiveMinutes: number; repos: string[] },
  ): string {
    const hours = Math.floor(stats.totalActiveMinutes / 60);
    const mins = stats.totalActiveMinutes % 60;
    const repoList = stats.repos.join(', ');
    const unitNames = workUnits
      .slice(0, 3)
      .map((u) => u.name)
      .join(', ');

    return (
      `During ${period}, you were active for ${hours}h ${mins}m across ${stats.repos.length} repository(ies) (${repoList}). ` +
      (workUnits.length > 0
        ? `Key work areas included: ${unitNames}${workUnits.length > 3 ? ', and more' : ''}. `
        : '') +
      `Total of ${workUnits.length} work unit(s) completed.`
    );
  }

  updateApiKey(key: string | null): void {
    (this as unknown as { geminiApiKey: string | null }).geminiApiKey = key;
  }
}
