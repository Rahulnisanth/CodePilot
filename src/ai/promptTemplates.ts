import { WorkType } from '../types';

/**
 * All Gemini prompt templates for CodeBrainPro.
 */

export const CLASSIFIER_SYSTEM_PROMPT = `
  You are a senior software engineer analyzing Git commits.
  Given a commit message and diff summary, classify the work type.
  Respond ONLY with valid JSON: { "type": "<type>", "confidence": <float>, "summary": "<1 sentence>" }
  Types: feature | bugfix | refactor | docs | test | chore | unknown`;

export function buildClassifierPrompt(
  message: string,
  diffStat: string,
): string {
  return `
  Commit message: "${message}"
  Diff summary:
  ${diffStat || '(no diff available)'}

  Classify this commit.`;
}

export function buildGrouperPrompt(
  commits: Array<{
    hash: string;
    message: string;
    timestamp: string;
    diffStat: string;
  }>,
): string {
  const commitList = commits
    .map(
      (c) =>
        `- [${c.hash.slice(0, 7)}] ${c.message} (${c.timestamp.slice(0, 10)})`,
    )
    .join('\n');

  return `
  You are a senior software engineer analyzing a developer's commit history.
  Group these commits into logical work units (tasks/features):

  ${commitList}

  Respond ONLY with valid JSON array: 
  [{ "name": "<task name>", "type": "<WorkType>", "commitHashes": ["hash1", ...] }]
  Types: feature | bugfix | refactor | docs | test | chore | unknown
  Group commits that share a common goal. Maximum 5-8 groups.`;
}

export function buildReporterPrompt(
  period: string,
  workUnits: { name: string; type: WorkType; commitCount: number }[],
  stats: {
    totalActiveMinutes: number;
    linesAdded: number;
    linesRemoved: number;
    repos: string[];
  },
): string {
  const unitsSummary = workUnits
    .map((u) => `- ${u.name} (${u.type}, ${u.commitCount} commits)`)
    .join('\n');

  return `
  You are writing a professional developer work summary for the period: ${period}.

  Work statistics:
  - Active coding time: ${Math.floor(stats.totalActiveMinutes / 60)}h ${stats.totalActiveMinutes % 60}m
  - Lines added: ${stats.linesAdded} | Lines removed: ${stats.linesRemoved}
  - Repositories: ${stats.repos.join(', ')}

  Work units completed:
  ${unitsSummary}

  Write a concise, professional 2-3 sentence achievement highlight that a developer could use in a performance review or team standup. Focus on impact and scope, not technical details.`;
}

export function buildQueryPrompt(question: string, context: string): string {
  return `
  You are CodeBrainPro, a personal developer productivity assistant.
  Answer this question about the developer's recent work based ONLY on the provided context. Be conversational, concise, and helpful.

  Work context:
  ${context}

  Question: ${question}`;
}
