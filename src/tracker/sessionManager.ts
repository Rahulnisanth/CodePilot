import { ActivityEvent, PersistedActiveTime, WorkSession } from '../types';
import { generateUUID } from '../utils/uuid';
import { toISO, toDateString } from '../utils/dateUtils';
import { readJson, writeJson } from '../utils/storage';
import { ACTIVE_TIME_FILE } from '../constants';

export class SessionManager {
  private sessions = new Map<string, WorkSession>();
  private currentSessionId = generateUUID();
  private persistedMinutesToday = 0;

  constructor() {
    this.restoreActiveTime();
  }

  /**
   * Returns the current open session for a repo, creating one if needed.
   */
  getCurrentSession(repoPath: string): WorkSession {
    if (!this.sessions.has(repoPath)) {
      this.sessions.set(repoPath, this.createSession(repoPath));
    }
    return this.sessions.get(repoPath)!;
  }

  /**
   * Record an activity event into the relevant session.
   */
  recordActivity(event: ActivityEvent): void {
    const session = this.getCurrentSession(event.repoRoot);

    session.linesAdded += event.linesAdded;
    session.linesRemoved += event.linesRemoved;

    if (!session.filesEdited.includes(event.filePath)) {
      session.filesEdited.push(event.filePath);
    }
    session.endTime = event.timestamp;
    session.activeMinutes = Math.ceil(
      (new Date(session.endTime).getTime() -
        new Date(session.startTime).getTime()) /
        60000,
    );
  }

  /**
   * Called when idle threshold is crossed — closes current session.
   */
  markIdle(): void {
    const now = toISO();
    this.sessions.forEach((session) => {
      session.endTime = now;
    });
  }

  /**
   * Called when activity resumes after idle — starts fresh sessions.
   */
  resumeSession(): void {
    this.currentSessionId = generateUUID();
    // Create new sessions for all repos; old sessions are implicitly closed
    const oldSessions = new Map(this.sessions);
    this.sessions.clear();
    oldSessions.forEach((session, repoPath) => {
      const newSession = this.createSession(repoPath);
      this.sessions.set(repoPath, newSession);
    });
  }

  /**
   * Returns all completed (closed) sessions across all repos.
   */
  getCompletedSessions(): WorkSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.endTime !== s.startTime,
    );
  }

  /**
   * Calculates total active minutes today across all repos.
   */
  getTotalActiveMinutesToday(): number {
    const liveMinutes = Array.from(this.sessions.values()).reduce(
      (sum, s) => sum + s.activeMinutes,
      0,
    );
    return this.persistedMinutesToday + liveMinutes;
  }

  /**
   * Persist accumulated active time to disk so it survives window refreshes.
   * Should be called periodically (e.g. on each activity event).
   */
  persistActiveTime(): void {
    const data: PersistedActiveTime = {
      date: toDateString(),
      activeMinutes: this.getTotalActiveMinutesToday(),
    };
    try {
      writeJson(ACTIVE_TIME_FILE(), data);
    } catch {
      // Non-fatal — will be rebuilt from live tracking
    }
  }

  private restoreActiveTime(): void {
    const stored = readJson<PersistedActiveTime>(ACTIVE_TIME_FILE(), {
      date: '',
      activeMinutes: 0,
    });
    // Only restore if the persisted data is from today
    if (stored.date === toDateString()) {
      this.persistedMinutesToday = stored.activeMinutes;
    }
  }

  private createSession(repoPath: string): WorkSession {
    return {
      sessionId: this.currentSessionId,
      repoName: repoPath.split('/').pop() ?? 'unknown',
      repoPath,
      startTime: toISO(),
      endTime: toISO(),
      activeMinutes: 0,
      idleMinutes: 0,
      filesEdited: [],
      linesAdded: 0,
      linesRemoved: 0,
    };
  }
}
