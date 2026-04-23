import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CODE_BRAIN_PRO_DIR = path.join(os.homedir(), '.codeBrainPro');
const LOGS_DIR = path.join(CODE_BRAIN_PRO_DIR, 'logs');
const REPORTS_DIR = path.join(CODE_BRAIN_PRO_DIR, 'reports');

/**
 * Ensures the ~/.codeBrainPro directory and its subdirectories exist.
 */
export function ensureCodeBrainProDirs(): void {
  [CODE_BRAIN_PRO_DIR, LOGS_DIR, REPORTS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

/**
 * Returns the base CodeBrainPro data directory path.
 */
export function getCodeBrainProDir(): string {
  return CODE_BRAIN_PRO_DIR;
}

/**
 * Returns the logs directory path.
 */
export function getLogsDir(): string {
  return LOGS_DIR;
}

/**
 * Returns the reports directory path.
 */
export function getReportsDir(): string {
  return REPORTS_DIR;
}

/**
 * Reads and parses a JSON file; returns defaultValue if not found or invalid.
 */
export function readJson<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Writes data as JSON to the specified file (creates directories as needed).
 */
export function writeJson<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Appends an item to a JSON array file.
 * Creates the file with [item] if it doesn't exist.
 */
export function appendToJsonArray<T>(filePath: string, item: T): void {
  const existing = readJson<T[]>(filePath, []);
  existing.push(item);
  writeJson(filePath, existing);
}

/**
 * Reads all JSON files in a directory and returns their parsed contents as an array.
 */
export function readAllJsonInDir<T>(dirPath: string): T[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      return readJson<T[]>(path.join(dirPath, f), []);
    });
}

/**
 * Deletes JSON log files older than `retentionDays` from the logs directory.
 */
export function pruneOldLogs(retentionDays: number): void {
  if (!fs.existsSync(LOGS_DIR)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  fs.readdirSync(LOGS_DIR).forEach((file) => {
    const filePath = path.join(LOGS_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
    }
  });
}
