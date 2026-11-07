import { DevIssue } from './types';
import { LanguageConfig, detectLanguage, detectLanguageById } from './languages';

export interface AnalysisOptions {
  complexityThreshold: number;
  longFunctionLines: number;
  duplicateBlockSize: number;
  maxLineLength: number;
  enableNaming: boolean;
  enableUnusedVariables: boolean;
  enableUnusedFunctions: boolean;
  enableDuplicate: boolean;
  enableComplexity: boolean;
  enableQuality: boolean;
  enableSecurity: boolean;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  complexityThreshold: 10,
  longFunctionLines: 50,
  duplicateBlockSize: 6,
  maxLineLength: 120,
  enableNaming: true,
  enableUnusedVariables: true,
  enableUnusedFunctions: true,
  enableDuplicate: true,
  enableComplexity: true,
  enableQuality: true,
  enableSecurity: true,
};

const MEANINGLESS = /^(x|y|z|temp|tmp|data\d*|var\d*|foo|bar|baz|a|b|c|i|j|k|res|val1|val2)$/;

function issue(
  file: string, line: number, column: number, endLine: number, endColumn: number,
  severity: DevIssue['severity'], category: DevIssue['category'],
  message: string, code: string, suggestion?: string, language?: string,
): DevIssue {
  return {
    id: `${code}-${file}-${line}-${column}`, file, line, column, endLine, endColumn,
    severity, category, message, code, source: 'devpilot', suggestion, language,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip comments and replace string contents with blanks, keeping line
 * numbers and column positions intact. This prevents names inside
 * comments/strings from counting as "used".
 */
export function stripCommentsAndStrings(text: string, lang: LanguageConfig): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inBlock = false;
  let inString: string | null = null; // "'", '"', '`', or triple variants
  let triple = false;

  for (const raw of lines) {
    let result = '';
    let i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      const two = raw.slice(i, i + 2);
      const three = raw.slice(i, i + 3);
      if (inString) {
        if (ch === '\\') { result += '  '; i += 2; continue; }
        if (triple) {
          if (three === inString) { inString = null; triple = false; result += '   '; i += 3; continue; }
          result += ' '; i++; continue;
        }
        if (ch === inString) { inString = null; result += ' '; i++; continue; }
        result += ' '; i++; continue;
      }
      if (inBlock) {
        if (lang.blockComment && raw.startsWith(lang.blockComment[1], i)) { inBlock = false; result += ' '.repeat(lang.blockComment[1].length); i += lang.blockComment[1].length; continue; }
        result += ' '; i++; continue;
      }
      // triple-quoted strings (Python)
      if (lang.id === 'python' && (three === '"""' || three === "'''")) {
        inString = three; triple = true; result += '   '; i += 3; continue;
      }
      if (lang.blockComment && raw.startsWith(lang.blockComment[0], i)) { inBlock = true; result += ' '.repeat(lang.blockComment[0].length); i += lang.blockComment[0].length; continue; }
      if (lang.lineComment && raw.startsWith(lang.lineComment, i)) { result += ' '.repeat(raw.length - i); break; }
      if (ch === '"' || ch === "'" || ch === '`') { inString = ch; triple = false; result += ' '; i++; continue; }
      result += ch; i++;
    }
    out.push(result);
  }
  return out;
}

export interface FunctionDef {
  name: string;
  line: number;
  column: number;
  endColumn: number;
  params: string[];
  exported: boolean;
}

export function findFunctionDefs(text: string, lang: LanguageConfig): FunctionDef[] {
  const lines = stripCommentsAndStrings(text, lang);
  const defs: FunctionDef[] = [];
  const push = (line: string, idx: number, name: string, params: string, exported: boolean) => {
    const col = line.indexOf(name);
    defs.push({
      name, line: idx, column: Math.max(col, 0), endColumn: Math.max(col, 0) + name.length,
      params: parseParams(params), exported,
    });
  };
  const CONTROL = new Set(['if', 'else', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'typeof']);

  lines.forEach((line, idx) => {
    let m: RegExpMatchArray | null;
    if (lang.id === 'python') {
      if ((m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/))) push(line, idx, m[1], m[2], false);
      return;
    }
    if (lang.id === 'go') {
      if ((m = line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/))) push(line, idx, m[1], m[2], /^[A-Z]/.test(m[1]));
      return;
    }
    if (lang.id === 'rust') {
      if ((m = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/))) push(line, idx, m[1], m[2], line.includes('pub '));
      return;
    }
    if (lang.id === 'php') {
      if ((m = line.match(/^\s*(?:public|private|protected|static|final|abstract|\s)*function\s+&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/))) push(line, idx, m[1], m[2], /public/.test(line));
      return;
    }
    if (lang.id === 'ruby') {
      if ((m = line.match(/^\s*def\s+(?:self\.)?([A-Za-z_][\w?!]*)\s*(?:\(([^)]*)\))?/))) push(line, idx, m[1], m[2] ?? '', false);
      return;
    }
    if (lang.id === 'swift') {
      if ((m = line.match(/^\s*(?:public|private|internal|open|fileprivate|static|class|override|\s)*func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/))) push(line, idx, m[1], m[2], /public|open/.test(line));
      return;
    }
    if (lang.id === 'kotlin') {
      if ((m = line.match(/^\s*(?:public|private|protected|internal|open|override|suspend|inline|\s)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>]+\.)?([A-Za-z_]\w*)\s*\(([^)]*)\)/))) push(line, idx, m[1], m[2], /public/.test(line));
      return;
    }
    if (lang.id === 'lua') {
      if ((m = line.match(/^\s*(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(([^)]*)\)/))) {
        const short = m[1].split(/[.:]/).pop()!;
        push(line, idx, short, m[2], false);
      }
      return;
    }
    if (lang.id === 'html' || lang.id === 'css' || lang.id === 'jupyter') {
      return;
    }
    if (lang.id === 'r') {
      if ((m = line.match(/^\s*([A-Za-z_][\w.]*)\s*(?:<-|=)\s*function\s*\(([^)]*)\)/))) { push(line, idx, m[1], m[2], false); return; }
      if ((m = line.match(/^\s*([A-Za-z_][\w.]*)\s*(?:<-|=)\s*(?:\(|function)/))) { push(line, idx, m[1], '', false); }
      return;
    }
    if (lang.id === 'scala') {
      if ((m = line.match(/^\s*(?:private|protected|public|override|final|abstract|implicit|\s)*def\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)/))) { push(line, idx, m[1], m[2], /public/.test(line)); return; }
      if ((m = line.match(/^\s*(?:export\s+)?(?:case\s+)?(?:class|object|trait)\s+([A-Za-z_]\w*)/))) { push(line, idx, m[1], '', false); }
      return;
    }
    if (lang.id === 'perl') {
      if ((m = line.match(/^\s*sub\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/))) { push(line, idx, m[1], m[2] ?? '', false); }
      return;
    }
    if (lang.id === 'sql') {
      // CREATE PROCEDURE / FUNCTION / TRIGGER / VIEW / TABLE are the SQL "definitions".
      if ((m = line.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(PROCEDURE|FUNCTION|TRIGGER|VIEW|TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`?"?\[?)([A-Za-z_][\w$]*)/i))) {
        push(line, idx, m[2], '', false);
      }
      return;
    }
    // C / C++ / Java / C# / JS / TS / Dart and other brace languages
    if ((m = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/))) { push(line, idx, m[1], m[2], line.includes('export')); return; }
    if ((m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/))) { push(line, idx, m[1], '', line.includes('export')); return; }
    if ((m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(([^)]*)\)/))) { push(line, idx, m[1], m[2], line.includes('export')); return; }
    if ((m = line.match(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/))) { push(line, idx, m[1], '', line.includes('export')); return; }
    // method / function with a return type or modifiers
    if ((m = line.match(/^\s*(?:public|private|protected|static|final|abstract|synchronized|virtual|override|inline|extern|sealed|async|unsafe|\s)*(?:[\w<>\[\],.?]+\s+)+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:\{|;|=>|throws\b|where\b|:)?/))) {
      if (!CONTROL.has(m[1])) push(line, idx, m[1], m[2], /public|export/.test(line));
      return;
    }
    // bare C-style: name(params) {
    if ((m = line.match(/^\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/))) {
      if (!CONTROL.has(m[1])) push(line, idx, m[1], m[2], false);
    }
  });
  return defs;
}

function parseParams(params: string): string[] {
  if (!params.trim()) return [];
  return params.split(',').map((p) => {
    const t = p.trim().replace(/^\.{3}/, '').replace(/^\$|\*/, '');
    const mm = t.match(/([A-Za-z_][\w$]*)\s*(?::|=|$)/) || t.match(/([A-Za-z_][\w$]*)\s*$/);
    // For typed languages "int count" -> last word; for "count: int" -> first word.
    const words = t.replace(/[<>\[\]]/g, ' ').split(/\s+/).filter(Boolean);
    if (t.includes(':')) return mm ? mm[1] : words[0];
    if (t.includes('=')) return words[0];
    return words[words.length - 1] ?? '';
  }).filter((p) => p && !['void'].includes(p));
}

function countRefs(codeLines: string[], name: string, defLine: number): number {
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
  let count = 0;
  codeLines.forEach((line, idx) => {
    const matches = line.match(re);
    if (matches) { count += matches.length; if (idx === defLine) count -= 1; }
  });
  return count;
}

function bodyEndForDef(codeLines: string[], defs: FunctionDef[], def: FunctionDef, lang: LanguageConfig): number {
  if (lang.id === 'python' || lang.id === 'ruby') {
    const indentOf = (s: string) => (s.match(/^\s*/) ?? [''])[0].length;
    const defIndent = indentOf(codeLines[def.line] ?? '');
    for (let i = def.line + 1; i < codeLines.length; i++) {
      if (!codeLines[i].trim()) continue;
      if (indentOf(codeLines[i]) <= defIndent) return i - 1;
    }
    return codeLines.length - 1;
  }
  // Brace languages
  let depth = 0; let started = false;
  for (let i = def.line; i < codeLines.length; i++) {
    for (const ch of codeLines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth <= 0) return i;
  }
  const next = defs.filter((d) => d.line > def.line).sort((a, b) => a.line - b.line)[0];
  return next ? next.line - 1 : codeLines.length - 1;
}

export function scanNaming(text: string, file: string, lang: LanguageConfig): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  const rawLines = text.split(/\r?\n/);

  const checkName = (name: string, line: number, col: number, kind: string) => {
    if (MEANINGLESS.test(name)) {
      issues.push(issue(file, line, col, line, col + name.length, 'info', 'naming',
        `${kind} '${name}' is not descriptive. Consider a meaningful name.`, 'DP001',
        undefined, lang.id));
      return;
    }
    // Convention checks — only where the convention is unambiguous.
    if (lang.id === 'python' && kind !== 'Class') {
      if (/^[A-Z]/.test(name) && !/^[A-Z][A-Z0-9_]*$/.test(name)) {
        issues.push(issue(file, line, col, line, col + name.length, 'info', 'naming',
          `${kind} '${name}' should use snake_case in Python (e.g. ${toSnake(name)}).`, 'DP007', undefined, lang.id));
      }
    } else if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(lang.id) && kind !== 'Class') {
      if (/_/.test(name) && !/^[A-Z][A-Z0-9_]*$/.test(name)) {
        issues.push(issue(file, line, col, line, col + name.length, 'info', 'naming',
          `${kind} '${name}' should use camelCase in ${lang.displayName}.`, 'DP007', undefined, lang.id));
      }
    }
    if (kind === 'Class' && !/^[A-Z]/.test(name)) {
      issues.push(issue(file, line, col, line, col + name.length, 'info', 'naming',
        `Class '${name}' should use PascalCase.`, 'DP007', undefined, lang.id));
    }
  };

  for (const def of findFunctionDefs(text, lang)) {
    checkName(def.name, def.line, def.column, 'Function');
  }
  codeLines.forEach((line, idx) => {
    const classMatch = line.match(/(?:class|interface|struct)\s+([A-Za-z_]\w*)/);
    if (classMatch) checkName(classMatch[1], idx, line.indexOf(classMatch[1]), 'Class');
    const assign = assignmentName(line, lang);
    if (assign) checkName(assign.name, idx, assign.column, 'Variable');
  });
  void rawLines;
  return issues;
}

function toSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function assignmentName(line: string, lang: LanguageConfig): { name: string; column: number } | null {
  let m: RegExpMatchArray | null;
  if (lang.id === 'python') {
    m = line.match(/^\s*([A-Za-z_]\w*)\s*=(?!=)/);
  } else if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(lang.id)) {
    m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  } else if (lang.id === 'php') {
    m = line.match(/^\s*\$([A-Za-z_]\w*)\s*=/);
  } else if (lang.id === 'ruby') {
    m = line.match(/^\s*([A-Za-z_]\w*)\s*=(?!=)/);
  } else if (lang.id === 'go') {
    m = line.match(/^\s*(?:var\s+)?([A-Za-z_]\w*)\s*(?::=|=)/) || line.match(/^\s*([A-Za-z_]\w*)\s*:=/);
  } else if (lang.id === 'rust') {
    m = line.match(/^\s*let\s+(?:mut\s+)?([A-Za-z_]\w*)\s*(?::[^=]+)?=/);
  } else if (lang.id === 'lua') {
    m = line.match(/^\s*(?:local\s+)?([A-Za-z_]\w*)\s*=(?!=)/);
  } else if (lang.id === 'r') {
    m = line.match(/^\s*([A-Za-z_][\w.]*)\s*(?:<-|=(?!=))/);
  } else if (lang.id === 'scala') {
    m = line.match(/^\s*(?:val|var)\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=/);
  } else if (lang.id === 'perl') {
    m = line.match(/^\s*(?:my|our|local)\s+([\$@%])([A-Za-z_]\w*)\s*=/);
    if (m) return { name: m[2], column: Math.max(line.indexOf(m[2]), 0) };
  } else if (lang.id === 'sql' || lang.id === 'html' || lang.id === 'css' || lang.id === 'jupyter') {
    return null;
  } else {
    // C-like: type name = ...  (also var/val/final)
    m = line.match(/^\s*(?:var|val|final|const|let|auto|[\w<>\[\],.?]+\s+)+([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/);
    if (m && ['if', 'for', 'while', 'return', 'switch'].includes(m[1])) return null;
  }
  if (!m) return null;
  const name = lang.id === 'php' ? m[1] : m[1];
  return { name, column: Math.max(line.indexOf(name), 0) };
}

export function scanUnusedVariables(text: string, file: string, lang: LanguageConfig): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  const assigned = new Map<string, number>();
  codeLines.forEach((line, idx) => {
    const a = assignmentName(line, lang);
    if (a && !assigned.has(a.name)) assigned.set(a.name, idx);
  });
  assigned.forEach((lineNo, name) => {
    if (lang.ignoreIdentifiers.has(name)) return;
    if (name.startsWith('_')) return;
    if (lang.id === 'go' && /^[A-Z]/.test(name)) return; // exported
    if (codeLines[lineNo]?.includes('export')) return;
    if (countRefs(codeLines, name, lineNo) === 0) {
      const col = Math.max(codeLines[lineNo].indexOf(name), 0);
      issues.push(issue(file, lineNo, col, lineNo, col + name.length, 'warning', 'bug',
        `Variable '${name}' is assigned but never used.`, 'DP105',
        `Remove the assignment of '${name}' if it has no side effect.`, lang.id));
    }
  });
  return issues;
}

export function scanUnusedFunctions(text: string, file: string, lang: LanguageConfig): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  for (const def of findFunctionDefs(text, lang)) {
    if (lang.entryFunctions.includes(def.name)) continue;
    if (def.name.startsWith('_') && lang.id === 'python') continue;
    if (def.exported) continue;
    if (lang.id === 'go' && /^[A-Z]/.test(def.name)) continue;
    if (countRefs(codeLines, def.name, def.line) === 0) {
      issues.push(issue(file, def.line, def.column, def.line, def.endColumn, 'warning', 'bug',
        `Function '${def.name}' is defined but never used.`, 'DP106',
        `Remove '${def.name}' or call it from somewhere.`, lang.id));
    }
  }
  return issues;
}

export function scanUndefined(text: string, file: string, lang: LanguageConfig): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  const declared = new Set<string>();
  codeLines.forEach((line) => {
    const a = assignmentName(line, lang);
    if (a) declared.add(a.name);
    for (const def of findFunctionDefs(text, lang)) declared.add(def.name);
    const imp = line.match(/(?:import|from|require|use|include)\s+([A-Za-z_][\w.]*)/);
    if (imp) declared.add(imp[1].split('.')[0]);
  });
  // Parameters are declared too.
  for (const def of findFunctionDefs(text, lang)) for (const p of def.params) declared.add(p);

  const callPatterns: RegExp[] = [
    /\bprint\s*\(\s*([A-Za-z_][\w$]*)\s*\)/,
    /\bconsole\.log\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/,
    /\bSystem\.out\.println\s*\(\s*([A-Za-z_]\w*)\s*\)/,
    /\bfmt\.Println\s*\(\s*([A-Za-z_]\w*)\s*\)/,
    /\bprintln!\s*\(\s*([A-Za-z_]\w*)\s*\)/,
    /\becho\s+\$?([A-Za-z_]\w*)/,
    /\bputs\s+([A-Za-z_]\w*)\s*$/,
    /\bConsole\.WriteLine\s*\(\s*([A-Za-z_]\w*)\s*\)/,
  ];
  codeLines.forEach((line, idx) => {
    for (const re of callPatterns) {
      const m = line.match(re);
      if (m && !declared.has(m[1]) && !lang.ignoreIdentifiers.has(m[1])) {
        const col = line.indexOf(m[1]);
        issues.push(issue(file, idx, col, idx, col + m[1].length, 'error', 'bug',
          `Name '${m[1]}' is used but never assigned or declared. Possible undefined variable.`, 'DP104',
          `Declare or assign '${m[1]}' before this use.`, lang.id));
        break;
      }
    }
  });
  return issues;
}

export function scanSecurity(text: string, file: string, lang: LanguageConfig): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  const checks: { re: RegExp; msg: string; code: string }[] = [
    { re: /\beval\s*\(/, msg: 'Use of eval() is a security risk — it can execute arbitrary code.', code: 'DP102' },
    { re: /\bexec\s*\(/, msg: 'Use of exec() is a security risk — it can execute arbitrary code.', code: 'DP102' },
    { re: /\bstrcpy\s*\(|\bstrcat\s*\(|\bgets\s*\(|\bsprintf\s*\(/, msg: 'Unsafe C function (strcpy/strcat/gets/sprintf) can overflow buffers. Use a bounded variant.', code: 'DP109' },
    { re: /pickle\.loads?\s*\(|yaml\.load\s*\(/, msg: 'Unsafe deserialization — untrusted input can execute code. Use a safe loader.', code: 'DP110' },
    { re: /\bos\.system\s*\(|shell\s*=\s*True/, msg: 'Shell execution with untrusted input can allow command injection.', code: 'DP111' },
    { re: /(password|passwd|secret|api[_-]?key|token)\s*=\s*["'][^"'\n]{4,}["']/i, msg: 'Possible hardcoded credential. Move secrets to environment variables or a secret store.', code: 'DP108' },
    { re: /\binnerHTML\s*=/, msg: 'Assigning innerHTML with untrusted data can allow XSS. Prefer textContent or sanitized HTML.', code: 'DP112' },
    { re: /SELECT\s+[^;]*\+\s*\w+|INSERT\s+[^;]*\+\s*\w+/i, msg: 'SQL built by string concatenation can allow SQL injection. Use parameterized queries.', code: 'DP113' },
  ];
  codeLines.forEach((line, idx) => {
    for (const c of checks) {
      const m = line.match(c.re);
      if (m) {
        const col = Math.max(line.indexOf(m[0]), 0);
        issues.push(issue(file, idx, col, idx, col + m[0].length, 'warning', 'security', c.msg, c.code, undefined, lang.id));
        break;
      }
    }
  });
  return issues;
}

export function scanBugs(text: string, file: string, lang: LanguageConfig): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  codeLines.forEach((line, idx) => {
    const pushBug = (msg: string, code: string, col = 0, len = line.length) =>
      issues.push(issue(file, idx, col, idx, Math.max(col + len, col + 1), 'warning', 'bug', msg, code, undefined, lang.id));
    if (lang.id === 'python') {
      if (/^\s*except\s*:/.test(line)) pushBug("Bare 'except:' catches everything. Specify an exception type.", 'DP101', line.indexOf('except'), 7);
      if (/def\s+\w+\s*\([^)]*=\s*(\[\]|\{\})\s*[,)]/.test(line)) pushBug('Mutable default argument can cause bugs across calls.', 'DP103');
      if (/==\s*None\b|\bNone\s*==/.test(line)) pushBug("Use 'is None' instead of '== None'.", 'DP114');
    }
    if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(lang.id)) {
      if (/(?<![=!])==(?!=)/.test(line)) pushBug("Use '===' instead of '==' to avoid type coercion bugs.", 'DP115');
    }
    if (['c', 'cpp', 'java', 'csharp'].includes(lang.id)) {
      if (/\bif\s*\([^=]*[^=!<>]=(?!=)[^=]/.test(line)) pushBug('Possible assignment inside an if condition — did you mean == ?', 'DP116');
    }
    if (/^\s*(?:catch|except)\s*\([^)]*\)\s*\{\s*\}\s*$/.test(line)) pushBug('Empty catch/except block silently swallows errors.', 'DP117');
  });
  return issues;
}

export function scanComplexity(text: string, file: string, lang: LanguageConfig, threshold: number): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  const defs = findFunctionDefs(text, lang);
  for (const def of defs) {
    const end = bodyEndForDef(codeLines, defs, def, lang);
    let complexity = 1;
    for (let i = def.line; i <= end; i++) {
      const line = codeLines[i];
      for (const w of lang.decisionWords) {
        const mm = line.match(new RegExp(`\\b${escapeRegExp(w)}\\b`, 'g'));
        if (mm) complexity += mm.length;
      }
      if (lang.id !== 'python') {
        complexity += (line.match(/&&/g) ?? []).length + (line.match(/\|\|/g) ?? []).length + (line.match(/\?[^:?]/g) ?? []).length;
      }
    }
    if (complexity > threshold) {
      issues.push(issue(file, def.line, def.column, end, codeLines[end]?.length ?? 0, 'info', 'quality',
        `Function '${def.name}' has cyclomatic complexity ${complexity} (threshold ${threshold}). Consider splitting it.`, 'DP202', undefined, lang.id));
    }
  }
  return issues;
}

export function scanQuality(text: string, file: string, lang: LanguageConfig, opts: AnalysisOptions): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  const rawLines = text.split(/\r?\n/);
  const defs = findFunctionDefs(text, lang);
  for (const def of defs) {
    const end = bodyEndForDef(codeLines, defs, def, lang);
    const length = end - def.line + 1;
    if (length > opts.longFunctionLines) {
      issues.push(issue(file, def.line, def.column, def.line, def.endColumn, 'info', 'quality',
        `Function '${def.name}' is ${length} lines long (threshold ${opts.longFunctionLines}). Consider splitting it.`, 'DP203', undefined, lang.id));
    }
  }
  codeLines.forEach((line, idx) => {
    if (line.length > opts.maxLineLength) {
      issues.push(issue(file, idx, opts.maxLineLength, idx, line.length, 'info', 'quality',
        `Line is ${line.length} characters (threshold ${opts.maxLineLength}). Consider breaking it up.`, 'DP204', undefined, lang.id));
    }
    const magic = line.match(/(?<![\w.])(?!0|1|2|10|100|1000)\b\d{3,}\b/);
    if (magic && !/^\s*(?:const|let|var|final|#define|static)\b/i.test(line)) {
      const col = line.indexOf(magic[0]);
      issues.push(issue(file, idx, col, idx, col + magic[0].length, 'info', 'quality',
        `Magic number '${magic[0]}'. Consider using a named constant.`, 'DP205', undefined, lang.id));
    }
  });
  if (lang.id === 'python' || lang.id === 'ruby') {
    rawLines.forEach((line, idx) => {
      if (!line.trim()) return;
      const indent = (line.match(/^\s*/) ?? [''])[0].length;
      const level = Math.floor(indent / 4);
      if (level > 4) issues.push(issue(file, idx, 0, idx, line.length, 'info', 'quality', `Deep nesting (level ${level}). Consider extracting a helper.`, 'DP206', undefined, lang.id));
    });
  } else {
    let depth = 0;
    codeLines.forEach((line, idx) => {
      let local = depth;
      for (const ch of line) { if (ch === '{') local++; else if (ch === '}') local = Math.max(0, local - 1); }
      if (local > 4) issues.push(issue(file, idx, 0, idx, line.length, 'info', 'quality', `Deep nesting (depth ${local}). Consider extracting a helper.`, 'DP206', undefined, lang.id));
      depth = local;
    });
  }
  return issues;
}

export function scanDuplicate(text: string, file: string, lang: LanguageConfig, blockSize: number): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  // Meaningful lines only: skip blanks and lines that are only punctuation.
  const meaningful: { line: number; text: string }[] = [];
  codeLines.forEach((line, idx) => {
    const t = line.trim();
    if (t.length < 4) return;
    if (/^[\}\)\];,]+$/.test(t)) return;
    meaningful.push({ line: idx, text: t });
  });
  const blocks = new Map<string, number[]>();
  for (let i = 0; i + blockSize <= meaningful.length; i++) {
    const key = meaningful.slice(i, i + blockSize).map((x) => x.text).join('\n');
    const list = blocks.get(key) ?? [];
    list.push(i);
    blocks.set(key, list);
  }
  const reported = new Set<number>();
  blocks.forEach((starts) => {
    if (starts.length < 2) return;
    for (const s of starts.slice(0, 2)) {
      if (reported.has(s)) continue;
      reported.add(s);
      const startLine = meaningful[s].line;
      const endLine = meaningful[s + blockSize - 1].line;
      issues.push(issue(file, startLine, 0, endLine, codeLines[endLine]?.length ?? 0, 'warning', 'quality',
        `Duplicate code block (${blockSize} lines) — appears ${starts.length} times. Consider extracting a shared function.`, 'DP201', undefined, lang.id));
    }
  });
  return issues;
}

/** All built-in (no external tool) analyzers for one file. */
export function scanBuiltIn(text: string, file: string, opts: AnalysisOptions = DEFAULT_ANALYSIS_OPTIONS): DevIssue[] {
  const lang = detectLanguage(file);
  if (!lang) return [];
  // Languages with their own dedicated analyzer (not the generic code engine).
  if (lang.id === 'jupyter') return dedupe(scanNotebook(text, file, opts));
  if (lang.id === 'html') {
    const all: DevIssue[] = [...scanHtml(text, file)];
    if (opts.enableQuality) all.push(...scanQuality(text, file, lang, opts));
    if (opts.enableDuplicate) all.push(...scanDuplicate(text, file, lang, opts.duplicateBlockSize));
    return dedupe(all);
  }
  if (lang.id === 'css') {
    const all: DevIssue[] = [...scanCss(text, file)];
    if (opts.enableQuality) all.push(...scanQuality(text, file, lang, opts));
    if (opts.enableDuplicate) all.push(...scanDuplicate(text, file, lang, opts.duplicateBlockSize));
    return dedupe(all);
  }
  if (lang.id === 'sql') {
    const all: DevIssue[] = [...scanSql(text, file, lang)];
    if (opts.enableUnusedFunctions) all.push(...scanUnusedFunctions(text, file, lang));
    if (opts.enableQuality) all.push(...scanQuality(text, file, lang, opts));
    if (opts.enableDuplicate) all.push(...scanDuplicate(text, file, lang, opts.duplicateBlockSize));
    return dedupe(all);
  }
  const all: DevIssue[] = [];
  if (opts.enableNaming) all.push(...scanNaming(text, file, lang));
  if (opts.enableUnusedVariables) all.push(...scanUnusedVariables(text, file, lang));
  if (opts.enableUnusedFunctions) all.push(...scanUnusedFunctions(text, file, lang));
  all.push(...scanUndefined(text, file, lang));
  all.push(...scanBugs(text, file, lang));
  if (opts.enableSecurity) all.push(...scanSecurity(text, file, lang));
  if (opts.enableComplexity) all.push(...scanComplexity(text, file, lang, opts.complexityThreshold));
  if (opts.enableQuality) all.push(...scanQuality(text, file, lang, opts));
  if (opts.enableDuplicate) all.push(...scanDuplicate(text, file, lang, opts.duplicateBlockSize));
  // Deduplicate identical code+position.
  const seen = new Set<string>();
  return all.filter((i) => {
    const k = `${i.code}:${i.line}:${i.column}:${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dedupe(issues: DevIssue[]): DevIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}:${i.line}:${i.column}:${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --------------------------------------------------------------- HTML

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const DEPRECATED_TAGS = new Set(['font', 'center', 'marquee', 'blink', 'applet', 'basefont', 'big', 'frame', 'frameset']);

export function scanHtml(text: string, file: string): DevIssue[] {
  const issues: DevIssue[] = [];
  const lines = text.split(/\r?\n/);
  const stack: { tag: string; line: number; column: number }[] = [];
  const seenIds = new Map<string, number>();
  const push = (line: number, column: number, endColumn: number, severity: DevIssue['severity'], msg: string, code: string) =>
    issues.push(issue(file, line, column, line, endColumn, severity, 'bug', msg, code, undefined, 'html'));
  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/<!--[\s\S]*?-->/g, '');
    const tagRe = /<\s*(\/?)\s*([A-Za-z][\w-]*)([^>]*?)(\/?)\s*>/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(line)) !== null) {
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      const attrs = m[3];
      const selfClosing = m[4] === '/' || VOID_ELEMENTS.has(tag);
      const col = m.index;
      if (DEPRECATED_TAGS.has(tag)) push(idx, col, col + tag.length + 2, 'warning', `Deprecated HTML tag <${tag}> — use modern CSS/HTML instead.`, 'DP406');
      const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/);
      if (idMatch) {
        if (seenIds.has(idMatch[1])) push(idx, col, col + tag.length + 2, 'warning', `Duplicate id "${idMatch[1]}" — ids must be unique in a document.`, 'DP404');
        else seenIds.set(idMatch[1], idx);
      }
      if (tag === 'img' && !/\balt\s*=/.test(attrs)) push(idx, col, col + tag.length + 2, 'warning', '<img> is missing an alt attribute — accessibility and SEO suffer.', 'DP405');
      if (tag === 'a' && /\bhref\s*=\s*["']#["']/.test(attrs)) push(idx, col, col + tag.length + 2, 'info', '<a href="#"> is a placeholder link — replace it with a real URL or a button.', 'DP408');
      if (closing) {
        if (!stack.length) push(idx, col, col + tag.length + 3, 'error', `Closing tag </${tag}> has no matching opening tag.`, 'DP401');
        else if (stack[stack.length - 1].tag === tag) stack.pop();
        else {
          const openIdx = stack.map((s) => s.tag).lastIndexOf(tag);
          if (openIdx >= 0) {
            push(idx, col, col + tag.length + 3, 'warning', `Mismatched tags: <${stack[stack.length - 1].tag}> was closed by </${tag}>.`, 'DP403');
            stack.splice(openIdx);
          } else push(idx, col, col + tag.length + 3, 'error', `Closing tag </${tag}> has no matching opening tag.`, 'DP401');
        }
      } else if (!selfClosing) {
        stack.push({ tag, line: idx, column: col });
      }
    }
  });
  for (const open of stack) push(open.line, open.column, open.column + open.tag.length + 2, 'error', `Unclosed tag <${open.tag}>.`, 'DP402');
  const lower = text.toLowerCase();
  if (lower.includes('<html') && !/<html[^>]*\blang\s*=/.test(lower)) issues.push(issue(file, 0, 0, 0, 5, 'info', 'quality', '<html> is missing a lang attribute.', 'DP407', undefined, 'html'));
  if (lower.includes('<head') && !lower.includes('<title')) issues.push(issue(file, 0, 0, 0, 5, 'info', 'quality', 'Document has a <head> but no <title>.', 'DP407', undefined, 'html'));
  return issues;
}

// --------------------------------------------------------------- CSS

export function scanCss(text: string, file: string): DevIssue[] {
  const issues: DevIssue[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = text.split(/\r?\n/);
  const lineOf = (pos: number): number => text.slice(0, pos).split('\n').length - 1;
  const selectors = new Map<string, number>();
  const definedVars = new Map<string, number>();
  const usedVars = new Set<string>();
  // Find selector blocks: selector { declarations }
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(clean)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2];
    const startLine = lineOf(m.index);
    if (!selector || selector.startsWith('@')) continue;
    if (selectors.has(selector)) {
      issues.push(issue(file, startLine, 0, startLine, selector.length, 'warning', 'quality', `Duplicate CSS selector "${selector}" — merge the rules.`, 'DP501', undefined, 'css'));
    } else selectors.set(selector, startLine);
    if (!body.trim()) {
      issues.push(issue(file, startLine, 0, startLine, selector.length, 'info', 'quality', `Empty CSS rule "${selector}".`, 'DP503', undefined, 'css'));
      continue;
    }
    const seenProps = new Set<string>();
    for (const decl of body.split(';')) {
      const d = decl.trim();
      if (!d) continue;
      const propMatch = d.match(/^([A-Za-z-]+)\s*:/);
      if (!propMatch) continue;
      const prop = propMatch[1].toLowerCase();
      if (seenProps.has(prop)) issues.push(issue(file, startLine, 0, startLine, selector.length, 'warning', 'quality', `Duplicate property "${prop}" in "${selector}".`, 'DP502', undefined, 'css'));
      seenProps.add(prop);
      if (prop.startsWith('--')) definedVars.set(prop, startLine);
      const varMatch = d.match(/var\(\s*(--[\w-]+)/g);
      if (varMatch) for (const v of varMatch) usedVars.add(v.replace(/var\(\s*/, ''));
    }
  }
  // !important usage (line-based, from raw text)
  lines.forEach((line, idx) => {
    if (/!important/.test(line)) {
      const col = line.indexOf('!important');
      issues.push(issue(file, idx, col, idx, col + 10, 'warning', 'quality', 'Use of !important makes CSS hard to override — prefer higher specificity.', 'DP504', undefined, 'css'));
    }
  });
  definedVars.forEach((lineNo, name) => {
    if (!usedVars.has(name)) issues.push(issue(file, lineNo, 0, lineNo, name.length, 'warning', 'bug', `CSS variable "${name}" is defined but never used via var().`, 'DP505', undefined, 'css'));
  });
  return issues;
}

// --------------------------------------------------------------- SQL (full)

export function scanSql(text: string, file: string, lang: LanguageConfig): DevIssue[] {
  const issues: DevIssue[] = [];
  const codeLines = stripCommentsAndStrings(text, lang);
  const stripped = codeLines.join('\n');
  // Statements split by ';' with their start line.
  const statements: { sql: string; line: number }[] = [];
  {
    let current = ''; let startLine = 0;
    codeLines.forEach((line, idx) => {
      if (!current.trim()) startLine = idx;
      current += line + '\n';
      if (line.includes(';')) { statements.push({ sql: current, line: startLine }); current = ''; }
    });
    if (current.trim()) statements.push({ sql: current, line: startLine });
  }
  for (const stmt of statements) {
    const sql = stmt.sql;
    const up = sql.toUpperCase();
    if (/\bSELECT\s+\*/.test(up)) {
      const col = sql.search(/SELECT\s+\*/i);
      issues.push(issue(file, stmt.line, Math.max(col, 0), stmt.line, Math.max(col, 0) + 8, 'warning', 'quality', 'SELECT * selects every column — list only the columns you need.', 'DP301', undefined, 'sql'));
    }
    if (/\bDELETE\s+FROM\b/.test(up) && !/\bWHERE\b/.test(up)) {
      issues.push(issue(file, stmt.line, 0, stmt.line, 10, 'error', 'bug', 'DELETE without WHERE deletes every row in the table.', 'DP302', 'Add a WHERE clause, or confirm a full-table delete is intended.', 'sql'));
    }
    if (/\bUPDATE\b/.test(up) && /\bSET\b/.test(up) && !/\bWHERE\b/.test(up)) {
      issues.push(issue(file, stmt.line, 0, stmt.line, 10, 'error', 'bug', 'UPDATE without WHERE updates every row in the table.', 'DP302', 'Add a WHERE clause, or confirm a full-table update is intended.', 'sql'));
    }
    const createTable = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$]*)/i);
    if (createTable && !/PRIMARY\s+KEY/i.test(sql)) {
      issues.push(issue(file, stmt.line, 0, stmt.line, 12, 'info', 'quality', `Table "${createTable[1]}" has no PRIMARY KEY.`, 'DP303', undefined, 'sql'));
    }
    if (/\bJOIN\b/.test(up) && !/\bON\b/.test(up)) {
      issues.push(issue(file, stmt.line, 0, stmt.line, 10, 'warning', 'bug', 'JOIN without ON can produce a Cartesian product (every row × every row).', 'DP304', undefined, 'sql'));
    }
  }
  void stripped;
  return issues;
}

// --------------------------------------------------------------- Jupyter Notebook

export interface NotebookCell {
  language: string;
  /** Code lines of the cell (decoded). */
  sourceLines: string[];
  /** Raw .ipynb line number (0-based) for each source line. */
  rawLines: number[];
}

export function extractNotebookCells(text: string): { metadataLanguage: string; cells: NotebookCell[] } {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* fall through to raw scan */ }
  const meta = (parsed.metadata ?? {}) as Record<string, unknown>;
  const kernelspec = (meta.kernelspec ?? {}) as Record<string, unknown>;
  const languageInfo = (meta.language_info ?? {}) as Record<string, unknown>;
  const metadataLanguage = String(kernelspec.language ?? languageInfo.name ?? 'python').toLowerCase();

  // Raw-line mapping: walk the pretty-printed JSON, tracking code cells.
  const rawLines = text.split(/\r?\n/);
  const cells: NotebookCell[] = [];
  let inCodeCell = false;
  let inSource = false;
  let current: NotebookCell | null = null;
  const decodeJsonString = (s: string): string => {
    try { return JSON.parse(s) as string; } catch { return s.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
  };
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (/^\s*"cell_type"\s*:\s*"code"/.test(line)) inCodeCell = true;
    if (/^\s*"cell_type"\s*:\s*"markdown"/.test(line)) inCodeCell = false;
    if (inCodeCell && /^\s*"source"\s*:/.test(line)) {
      inSource = true;
      current = { language: metadataLanguage, sourceLines: [], rawLines: [] };
      cells.push(current);
      // Source as a single string on the same line: "source": "a = 1\nb = 2"
      const single = line.match(/"source"\s*:\s*("(?:[^"\\]|\\.)*")/);
      if (single) {
        const decoded = decodeJsonString(single[1]);
        decoded.split('\n').forEach((codeLine) => { current!.sourceLines.push(codeLine); current!.rawLines.push(i); });
        inSource = false;
      }
      continue;
    }
    if (inSource && current) {
      if (/^\s*\]/.test(line)) { inSource = false; current = null; continue; }
      const strMatch = line.match(/^\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/);
      if (strMatch) {
        const decoded = decodeJsonString(strMatch[1]);
        // A JSON string in a source array is one code line (usually ending with \n).
        const codeLine = decoded.endsWith('\n') ? decoded.slice(0, -1) : decoded;
        current.sourceLines.push(codeLine);
        current.rawLines.push(i);
      }
    }
  }
  // Fallback: if the raw scan found nothing (e.g. minified JSON), use parsed cells without raw mapping.
  if (!cells.length && Array.isArray(parsed.cells)) {
    for (const cell of parsed.cells as Record<string, unknown>[]) {
      if (cell.cell_type !== 'code') continue;
      const src = cell.source;
      const sourceText = Array.isArray(src) ? src.join('') : String(src ?? '');
      cells.push({ language: metadataLanguage, sourceLines: sourceText.split('\n'), rawLines: sourceText.split('\n').map(() => 0) });
    }
  }
  return { metadataLanguage, cells };
}

/** Extract all code-cell source (for running a notebook as Python). */
export function extractNotebookCode(text: string): string {
  const { cells } = extractNotebookCells(text);
  return cells.map((c) => c.sourceLines.join('\n')).join('\n\n');
}

export function scanNotebook(text: string, file: string, opts: AnalysisOptions): DevIssue[] {
  const { cells } = extractNotebookCells(text);
  if (!cells.length) return [];
  // Cross-cell knowledge: names declared anywhere in the notebook.
  const allDeclared = new Set<string>();
  const allReferenced = new Set<string>();
  const cellSources: string[] = [];
  for (const cell of cells) {
    const src = cell.sourceLines.join('\n');
    cellSources.push(src);
    const lang = detectLanguageById(cell.language) ?? detectLanguageById('python')!;
    for (const def of findFunctionDefs(src, lang)) allDeclared.add(def.name);
    const codeLines = stripCommentsAndStrings(src, lang);
    codeLines.forEach((line) => {
      const a = assignmentName(line, lang);
      if (a) allDeclared.add(a.name);
      for (const ident of line.match(/\b[A-Za-z_]\w*\b/g) ?? []) allReferenced.add(ident);
    });
  }
  const out: DevIssue[] = [];
  cells.forEach((cell, cellIdx) => {
    const lang = detectLanguageById(cell.language) ?? detectLanguageById('python')!;
    const src = cellSources[cellIdx];
    const cellIssues = scanBuiltIn(src, `cell${lang.extensions[0] ?? '.py'}`, opts);
    // Map cell-relative lines back to raw .ipynb lines.
    for (const iss of cellIssues) {
      // Cross-cell false positives: a name declared/used in another cell is not unused/undefined here.
      if (iss.code === 'DP104') {
        const nameMatch = iss.message.match(/'([^']+)'/);
        if (nameMatch && allDeclared.has(nameMatch[1])) continue;
      }
      if ((iss.code === 'DP105' || iss.code === 'DP106')) {
        const nameMatch = iss.message.match(/'([^']+)'/);
        if (nameMatch && cellSources.some((s, i) => i !== cellIdx && new RegExp(`\\b${escapeRegExp(nameMatch[1])}\\b`).test(s))) continue;
      }
      const rawLine = cell.rawLines[Math.min(iss.line, cell.rawLines.length - 1)] ?? 0;
      const rawEnd = cell.rawLines[Math.min(iss.endLine, cell.rawLines.length - 1)] ?? rawLine;
      out.push({ ...iss, file, line: rawLine, endLine: rawEnd, language: 'jupyter' });
    }
  });
  return out;
}
