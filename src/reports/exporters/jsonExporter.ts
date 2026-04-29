import { ReportData } from '../../types';

/**
 * JSON exporter — machine-readable raw export for integrations.
 */
export function toJson(report: ReportData): string {
  return JSON.stringify(report, null, 2);
}
