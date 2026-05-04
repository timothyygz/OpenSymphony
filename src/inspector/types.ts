/**
 * Code inspection type definitions.
 */

export type Severity = "high" | "medium" | "low";
export type Category =
  | "complexity"
  | "type-safety"
  | "error-handling"
  | "performance"
  | "architecture"
  | "maintainability";

export interface Finding {
  /** Short title summarizing the issue */
  title: string;
  /** Detailed description of the finding and suggested fix */
  description: string;
  /** Severity level */
  severity: Severity;
  /** Analysis category */
  category: Category;
  /** File path relative to project root */
  file: string;
  /** Line number where the issue was found (1-based) */
  line?: number;
  /** Tags for filtering */
  tags: string[];
}

export interface InspectionResult {
  /** Timestamp of this inspection run */
  timestamp: string;
  /** Total files scanned */
  filesScanned: number;
  /** All findings from this run */
  findings: Finding[];
  /** Duration in ms */
  durationMs: number;
}
