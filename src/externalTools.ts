import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DevIssue } from './types';
import { LanguageConfig } from './languages';
import { extractNotebookCells } from './analysis';

export function runTool(cmd: string, args: string[], cwd: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolve) => {
    const child = cp.execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', ok: !err });
    });
    child.on('error', () => resolve({ stdout: '', stderr: '', ok: false }));
  });
}

export async function toolExists(cmd: string): Promise<boolean> {
  const r = await runTool(cmd, ['--version'], process.cwd(), 8000);
  return r.ok || r.stdout.length > 0 || r.stderr.length > 0;
}

function mk(file: string, line: number, col: number, severity: DevIssue['severity'], category: DevIssue['category'], message: string, code: string | undefined, source: string, language?: string): DevIssue {
  return {
    id: `${source}-${code ?? 'x'}-${file}-${line}-${col}`, file,
    line: Math.max(line, 0), column: Math.max(col, 0), endLine: Math.max(line, 0), endColumn: Math.max(col + 1, 1),
    severity, category, message, code, source, language,
  };
}

/** Generic "file:line:col: severity: message" parser (gcc/clang/javac/go vet/...). */
export function parseColonDiagnostics(output: string, source: string, category: DevIssue['category'] = 'bug'): DevIssue[] {
  const issues: DevIssue[] = [];
  const re = /^(.+?):(\d+):(?:(\d+):)?\s*(error|warning|note|fatal error)?\s*:?\s*(.+)$/gm;
  let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(output)) !== null) {
    if (m[4] === 'note') continue;
    const msg = m[5].trim();
    if (!msg || msg.length < 3) continue;
    // Only keep lines that look like diagnostics for a real file path.
    if (!/\.[a-zA-Z]+$/.test(m[1]) && !m[1].includes('/')) continue;
    issues.push(mk(m[1], parseInt(m[2], 10) - 1, m[3] ? parseInt(m[3], 10) - 1 : 0,
      m[4]?.includes('error') ? 'error' : 'warning', category, msg, undefined, source));
    i++;
    if (i > 500) break;
  }
  return issues;
}

export async function scanWithRuff(file: string, ruffPath: string): Promise<DevIssue[]> {
  const out = await runTool(ruffPath, ['check', file, '--output-format', 'concise'], path.dirname(file));
  const issues: DevIssue[] = [];
  const re = /^(.+?):(\d+):(\d+):\s+([A-Z]\d+)\s+(.*)$/gm;
  let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(out.stdout)) !== null) {
    const code = m[4];
    issues.push(mk(file, parseInt(m[2], 10) - 1, parseInt(m[3], 10) - 1,
      code.startsWith('E') || code.startsWith('F') ? 'error' : 'warning',
      code.startsWith('N') ? 'naming' : 'bug', m[5].trim(), code, 'ruff', 'python'));
    i++;
  }
  void i;
  return issues;
}

export async function scanWithMypy(file: string, mypyPath: string): Promise<DevIssue[]> {
  const out = await runTool(mypyPath, ['--no-color', '--show-error-codes', file], path.dirname(file));
  const issues: DevIssue[] = [];
  const re = /^(.*?):(\d+):(\d+): (error|warning|note): (.*?)(?:\s+\[(.*?)\])?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out.stdout + '\n' + out.stderr)) !== null) {
    if (m[4] === 'note') continue;
    issues.push(mk(file, parseInt(m[2], 10) - 1, parseInt(m[3], 10) - 1,
      m[4] === 'error' ? 'error' : 'warning', 'type', m[5], m[6], 'mypy', 'python'));
  }
  return issues;
}

export async function scanWithClangTidy(file: string): Promise<DevIssue[]> {
  const out = await runTool('clang-tidy', [file, '--', '-std=c++17'], path.dirname(file));
  return parseColonDiagnostics(out.stdout + '\n' + out.stderr, 'clang-tidy').map((i) => ({ ...i, language: 'cpp' }));
}

export async function scanWithCppcheck(file: string): Promise<DevIssue[]> {
  const out = await runTool('cppcheck', ['--enable=all', '--template={file}:{line}:{column}: {severity}: {message} [{id}]', file], path.dirname(file));
  const issues: DevIssue[] = [];
  const re = /^(.+?):(\d+):(\d+):\s*(error|warning|style|performance|portability|information):\s*(.+?)\s*\[(.+?)\]$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out.stdout + '\n' + out.stderr)) !== null) {
    issues.push(mk(file, parseInt(m[2], 10) - 1, parseInt(m[3], 10) - 1,
      m[4] === 'error' ? 'error' : 'warning', 'bug', m[5], m[6], 'cppcheck'));
  }
  return issues;
}

export async function scanWithSyntaxOnly(file: string, lang: LanguageConfig): Promise<DevIssue[]> {
  const cwd = path.dirname(file);
  if (lang.id === 'python') {
    const out = await runTool('python3', ['-m', 'py_compile', file], cwd);
    if (out.ok) return [];
    return parseColonDiagnostics(out.stderr, 'py_compile', 'bug').map((i) => ({ ...i, language: 'python' }));
  }
  if (lang.id === 'c' || lang.id === 'cpp') {
    const compiler = lang.id === 'c' ? 'gcc' : 'g++';
    const out = await runTool(compiler, ['-fsyntax-only', file], cwd);
    return parseColonDiagnostics(out.stderr, compiler, 'bug');
  }
  if (lang.id === 'go') {
    const out = await runTool('go', ['vet', file], cwd);
    return parseColonDiagnostics(out.stdout + '\n' + out.stderr, 'go vet', 'bug');
  }
  if (lang.id === 'rust') {
    const out = await runTool('rustc', ['--edition', '2021', '--crate-type', 'lib', file], cwd);
    return parseColonDiagnostics(out.stderr, 'rustc', 'bug');
  }
  if (lang.id === 'php') {
    const out = await runTool('php', ['-l', file], cwd);
    if (out.ok) return [];
    return [mk(file, 0, 0, 'error', 'bug', (out.stdout + out.stderr).trim().slice(0, 300), undefined, 'php -l', 'php')];
  }
  if (lang.id === 'ruby') {
    const out = await runTool('ruby', ['-c', file], cwd);
    if (out.ok) return [];
    return [mk(file, 0, 0, 'error', 'bug', (out.stdout + out.stderr).trim().slice(0, 300), undefined, 'ruby -c', 'ruby')];
  }
  if (lang.id === 'perl') {
    const out = await runTool('perl', ['-c', file], cwd);
    if (out.ok) return [];
    return [mk(file, 0, 0, 'error', 'bug', (out.stdout + out.stderr).trim().slice(0, 300), undefined, 'perl -c', 'perl')];
  }
  if (lang.id === 'r') {
    const out = await runTool('Rscript', ['-e', `invisible(parse(file=shQuote("${file}")))`], cwd);
    if (out.ok) return [];
    return [mk(file, 0, 0, 'error', 'bug', (out.stdout + out.stderr).trim().slice(0, 300), undefined, 'Rscript parse', 'r')];
  }
  if (lang.id === 'jupyter') {
    // A notebook is valid if its JSON parses and every code cell parses as Python.
    try {
      const { cells } = extractNotebookCells(fs.readFileSync(file, 'utf8'));
      const py = cells.map((c) => c.sourceLines.join('\n')).join('\n\n');
      if (!py.trim()) return [];
      const tmp = path.join(os.tmpdir(), `devpilot-nb-${Date.now()}.py`);
      fs.writeFileSync(tmp, py);
      try {
        const out = await runTool('python3', ['-m', 'py_compile', tmp], cwd);
        if (out.ok) return [];
        return [mk(file, 0, 0, 'error', 'bug', (out.stderr || 'Notebook code does not compile.').trim().slice(0, 300), undefined, 'py_compile (notebook)', 'jupyter')];
      } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    } catch { return [mk(file, 0, 0, 'error', 'bug', 'Notebook is not valid JSON.', undefined, 'json', 'jupyter')]; }
  }
  return [];
}

/** External tools for a file, in order. Every failure is swallowed — built-in analysis still runs. */
export async function scanExternal(file: string, lang: LanguageConfig, opts: { ruffPath: string; mypyPath: string; enableRuff: boolean; enableMypy: boolean; enableExternalTools: boolean }): Promise<DevIssue[]> {
  if (!opts.enableExternalTools) return [];
  const out: DevIssue[] = [];
  try {
    if (lang.id === 'python') {
      if (opts.enableRuff) out.push(...await scanWithRuff(file, opts.ruffPath));
      if (opts.enableMypy) out.push(...await scanWithMypy(file, opts.mypyPath));
    } else if (lang.id === 'c' || lang.id === 'cpp') {
      out.push(...await scanWithCppcheck(file));
      out.push(...await scanWithClangTidy(file));
    } else if (lang.id === 'javascript' || lang.id === 'typescript' || lang.id === 'javascriptreact' || lang.id === 'typescriptreact') {
      const eslint = await runTool('npx', ['--no-install', 'eslint', '--format', 'unix', file], path.dirname(file));
      out.push(...parseColonDiagnostics(eslint.stdout + '\n' + eslint.stderr, 'eslint').map((i) => ({ ...i, language: lang.id })));
    } else {
      out.push(...await scanWithSyntaxOnly(file, lang));
    }
  } catch { /* external tools are optional */ }
  return out;
}

/** Syntax validation of a proposed new file content (used before applying any fix). */
export async function validateSyntax(text: string, lang: LanguageConfig, pythonPath: string): Promise<{ ok: boolean; error?: string }> {
  // Fast fallback for every language: balanced delimiters (ignoring strings/comments is approximate).
  if (lang.id === 'python') {
    const cp = await import('child_process');
    const fs = await import('fs');
    const os = await import('os');
    const tmp = path.join(os.tmpdir(), `devpilot-check-${Date.now()}.py`);
    try {
      fs.writeFileSync(tmp, text);
      const out = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
        cp.execFile(pythonPath, ['-m', 'py_compile', tmp], { timeout: 15000 }, (err, _so, se) => resolve({ ok: !err, stderr: se?.toString() ?? '' }));
      });
      return out.ok ? { ok: true } : { ok: false, error: out.stderr.trim().split('\n').slice(0, 5).join('\n') };
    } catch (e) { return { ok: false, error: String(e) }; }
    finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
  if (lang.id === 'javascript' || lang.id === 'typescript') {
    // Node can check plain JS; TS needs tsc, so fall back to delimiter balance for TS.
    if (lang.id === 'javascript') {
      const cp = await import('child_process');
      const fs = await import('fs');
      const os = await import('os');
      const tmp = path.join(os.tmpdir(), `devpilot-check-${Date.now()}.js`);
      try {
        fs.writeFileSync(tmp, text);
        const ok = await new Promise<boolean>((resolve) => {
          cp.execFile('node', ['--check', tmp], { timeout: 15000 }, (err) => resolve(!err));
        });
        return ok ? { ok: true } : { ok: false, error: 'node --check failed for the proposed file.' };
      } catch (e) { return { ok: false, error: String(e) }; }
      finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    }
  }
  if (lang.id === 'c' || lang.id === 'cpp') {
    const cp = await import('child_process');
    const fs = await import('fs');
    const os = await import('os');
    const ext = lang.id === 'c' ? 'c' : 'cpp';
    const tmp = path.join(os.tmpdir(), `devpilot-check-${Date.now()}.${ext}`);
    try {
      fs.writeFileSync(tmp, text);
      const compiler = lang.id === 'c' ? 'gcc' : 'g++';
      const out = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
        cp.execFile(compiler, ['-fsyntax-only', tmp], { timeout: 20000 }, (err, _so, se) => resolve({ ok: !err, stderr: se?.toString() ?? '' }));
      });
      return out.ok ? { ok: true } : { ok: false, error: out.stderr.trim().split('\n').slice(0, 5).join('\n') };
    } catch { /* compiler missing — fall through to balance check */ }
  }
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (const ch of text) {
    if (pairs[ch]) stack.push(ch);
    else if (Object.values(pairs).includes(ch)) {
      const open = stack.pop();
      if (!open || pairs[open] !== ch) return { ok: false, error: `Unbalanced delimiter '${ch}' in the proposed file.` };
    }
  }
  if (stack.length) return { ok: false, error: `Unclosed delimiter '${stack[stack.length - 1]}' in the proposed file.` };
  return { ok: true };
}
