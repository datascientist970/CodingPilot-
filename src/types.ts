export type Severity = 'error' | 'warning' | 'info' | 'success';

export type IssueCategory =
  | 'bug'
  | 'naming'
  | 'type'
  | 'security'
  | 'test'
  | 'doc'
  | 'quality';

export interface DevIssue {
  id: string;
  file: string;
  line: number; // 0-based
  column: number;
  endLine: number;
  endColumn: number;
  severity: Severity;
  category: IssueCategory;
  message: string;
  suggestion?: string;
  code?: string;
  source?: string;
  /** Language id, e.g. 'python', 'cpp', 'typescript'. */
  language?: string;
}

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  raw: string;
  runner: string;
  command: string;
}

export interface FixReport {
  applied: number;
  skipped: number;
  failed: number;
  remaining: number;
  skippedReasons: string[];
  failedReasons: string[];
}
