import { randomUUID } from 'crypto';

/**
 * Generates a UUID v4 string using Node's built-in crypto module.
 * No external dependency needed (Node ≥ 14.17).
 */
export function generateUUID(): string {
  return randomUUID();
}
