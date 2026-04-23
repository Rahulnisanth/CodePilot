/**
 * Core data models for CodeBrainPro.
 */

export type WorkType =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'docs'
  | 'test'
  | 'chore'
  | 'unknown';

export interface ActivityEvent {
  eventId: string;
  type: 'edit' | 'focus' | 'idle' | 'commit';
  filePath: string;
  repoRoot: string;
  repoName: string;
  timestamp: string; // ISO 8601
  linesAdded: number;
  linesRemoved: number;
  languageId: string;
  sessionId: string;
}

export interface WorkSession {
  sessionId: string;
  repoName: string;
  repoPath: string;
  startTime: string; // ISO 8601
  endTime: string;
  activeMinutes: number;
  idleMinutes: number;
  filesEdited: string[];
  linesAdded: number;
  linesRemoved: number;
}

export interface CommitRecord {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
  repoName: string;
  repoPath: string;
  filesChanged: string[];
  diffStat: string;
  linesAdded: number;
  linesRemoved: number;
  classification?: {
    type: WorkType;
    confidence: number;
    summary: string;
  };
  workUnitId?: string;
}

export interface WorkUnit {
  id: string;
  name: string; // AI-generated label
  type: WorkType;
  commits: string[]; // commit hashes
  repos: string[];
  startTime: string;
  endTime: string;
  totalLinesChanged: number;
}

export interface RiskEvent {
  timestamp: string;
  repoName: string;
  repoPath: string;
  linesChanged: number;
  minutesSinceLastCommit: number;
  hasDeletedFiles: boolean;
}

export interface ClassificationResult {
  type: WorkType;
  confidence: number;
  summary: string;
}
