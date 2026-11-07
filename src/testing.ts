import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TestResult } from './types';
import { LanguageConfig } from './languages';
import { extractNotebookCode } from './analysis';

export interface TestRunner { name: string; command: string; args: string[]; }

export function detectTestRunner(workspaceFolder: string | undefined, lang: LanguageConfig, filePath: string): TestRunner | null {
  const root = workspaceFolder ?? path.dirname(filePath);
  const exists = (rel: string) => fs.existsSync(path.join(root, rel));
  if (lang.id === 'python') {
    if (exists('pytest.ini') || exists('pyproject.toml') || exists('setup.cfg')) return { name: 'pytest', command: 'python', args: ['-m', 'pytest', '-q'] };
    return { name: 'pytest', command: 'python', args: ['-m', 'pytest', '-q'] };
  }
  if (lang.id === 'go') return { name: 'go test', command: 'go', args: ['test', './...'] };
  if (lang.id === 'rust') return { name: 'cargo test', command: 'cargo', args: ['test'] };
  if (lang.id === 'java' || lang.id === 'kotlin') {
    if (exists('pom.xml')) return { name: 'Maven', command: 'mvn', args: ['-q', 'test'] };
    if (exists('build.gradle') || exists('build.gradle.kts')) return { name: 'Gradle', command: './gradlew', args: ['test'] };
    return null;
  }
  if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(lang.id)) {
    if (exists('package.json')) return { name: 'npm test', command: 'npm', args: ['test', '--', '--watchAll=false'] };
    return null;
  }
  if (lang.id === 'php' && exists('phpunit.xml')) return { name: 'PHPUnit', command: './vendor/bin/phpunit', args: [] };
  if (lang.id === 'ruby' && exists('Gemfile')) return { name: 'Rake test', command: 'rake', args: ['test'] };
  if (lang.id === 'csharp' && fs.readdirSync(root).some((f) => f.endsWith('.sln') || f.endsWith('.csproj'))) return { name: 'dotnet test', command: 'dotnet', args: ['test'] };
  return null;
}

export function parseTestOutput(raw: string, runner: string): { passed: number; failed: number; skipped: number } {
  let passed = 0; let failed = 0; let skipped = 0;
  const patterns = [
    /(\d+) passed/, /(\d+) failed/, /(\d+) skipped/,
    /(\d+) tests? passed/, /ok\s+\S+\s+\(cached\)/,
    /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/,
    /(\d+) passing/, /(\d+) failing/, /(\d+) pending/,
  ];
  void patterns;
  const p = raw.match(/(\d+)\s+passed\b/); if (p) passed = parseInt(p[1], 10);
  const f = raw.match(/(\d+)\s+failed\b/); if (f) failed = parseInt(f[1], 10);
  const s = raw.match(/(\d+)\s+skipped\b/); if (s) skipped = parseInt(s[1], 10);
  const junit = raw.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/);
  if (junit) { passed = parseInt(junit[1], 10) - parseInt(junit[2], 10) - parseInt(junit[3], 10) - parseInt(junit[4], 10); failed = parseInt(junit[2], 10) + parseInt(junit[3], 10); skipped = parseInt(junit[4], 10); }
  const jestPass = raw.match(/Tests:\s+(\d+) passed/); if (jestPass) passed = parseInt(jestPass[1], 10);
  const jestFail = raw.match(/Tests:\s+.*?(\d+) failed/); if (jestFail) failed = parseInt(jestFail[1], 10);
  void runner;
  return { passed, failed, skipped };
}

export function runTests(runner: TestRunner, cwd: string, timeoutMs = 120000): Promise<TestResult> {
  return new Promise((resolve) => {
    cp.execFile(runner.command, runner.args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      const raw = `${stdout ?? ''}\n${stderr ?? ''}`;
      const counts = parseTestOutput(raw, runner.name);
      resolve({
        ...counts, total: counts.passed + counts.failed + counts.skipped,
        raw, runner: runner.name, command: `${runner.command} ${runner.args.join(' ')}`,
      });
      void err;
    });
  });
}

function execToPromise(command: string, args: string[], cwd: string, timeoutMs = 30000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    cp.execFile(command, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout ?? ''}\n${stderr ?? ''}`.trim() });
    });
  });
}

/** Run a single file and capture runtime errors (for "Run Current File" / fix verification). */
export async function runCurrentFile(filePath: string, lang: LanguageConfig, pythonPath: string): Promise<{ ok: boolean; output: string }> {
  const cwd = path.dirname(filePath);
  if (lang.id === 'python') return execToPromise(pythonPath, [filePath], cwd);
  if (lang.id === 'javascript') return execToPromise('node', [filePath], cwd);
  if (lang.id === 'go') return execToPromise('go', ['run', filePath], cwd);
  if (lang.id === 'ruby') return execToPromise('ruby', [filePath], cwd);
  if (lang.id === 'php') return execToPromise('php', [filePath], cwd);
  if (lang.id === 'lua') return execToPromise('lua', [filePath], cwd);
  if (lang.id === 'perl') return execToPromise('perl', [filePath], cwd);
  if (lang.id === 'r') return execToPromise('Rscript', [filePath], cwd);
  if (lang.id === 'scala') return execToPromise('scala', [filePath], cwd);
  if (lang.id === 'html' || lang.id === 'css') return { ok: false, output: `${lang.displayName} files are not runnable — use a browser preview or a Playwright/Cypress test instead.` };
  if (lang.id === 'jupyter') {
    // Run the notebook's code cells as Python via a temp file (no in-place execution).
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpilot-nb-'));
    const tmpPy = path.join(tmpDir, 'notebook.py');
    try {
      fs.writeFileSync(tmpPy, extractNotebookCode(fs.readFileSync(filePath, 'utf8')));
      const run = await execToPromise(pythonPath, [tmpPy], cwd);
      return run;
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  // Compiled languages: compile to a temp binary, run it, then clean up.
  if (lang.id === 'c' || lang.id === 'cpp') {
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpilot-run-'));
    const binary = path.join(tmpDir, 'program');
    try {
      const compiler = lang.id === 'c' ? 'gcc' : 'g++';
      const compiled = await execToPromise(compiler, [filePath, '-o', binary], cwd, 60000);
      if (!compiled.ok) return { ok: false, output: `Compile failed:\n${compiled.output}` };
      return execToPromise(binary, [], cwd);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  if (lang.id === 'java') {
    const className = path.basename(filePath, '.java');
    const compiled = await execToPromise('javac', [filePath], cwd, 60000);
    if (!compiled.ok) return { ok: false, output: `Compile failed:\n${compiled.output}` };
    const run = await execToPromise('java', ['-cp', cwd, className], cwd);
    try { fs.unlinkSync(path.join(cwd, `${className}.class`)); } catch { /* ignore */ }
    return run;
  }
  if (lang.id === 'rust') {
    const os = await import('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devpilot-run-'));
    const binary = path.join(tmpDir, 'program');
    try {
      const compiled = await execToPromise('rustc', [filePath, '-o', binary], cwd, 60000);
      if (!compiled.ok) return { ok: false, output: `Compile failed:\n${compiled.output}` };
      return execToPromise(binary, [], cwd);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  return { ok: false, output: `Running a single ${lang.displayName} file is not supported directly. Use the project's test/build command instead.` };
}

/** Where a generated test file should go: alongside, or in tests/. */
export function testFilePath(sourcePath: string, lang: LanguageConfig, inTestsFolder: boolean): string {
  const dir = inTestsFolder ? path.join(path.dirname(sourcePath), 'tests') : path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath)).replace(/[^A-Za-z0-9_]/g, '_');
  return path.join(dir, lang.testFileName(base));
}
