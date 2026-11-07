import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DevIssue, FixReport } from './types';
import { detectLanguage, globForAllLanguages, globForPythonOnly, isSupportedFile, LanguageConfig } from './languages';
import { scanBuiltIn } from './analysis';
import { scanExternal, validateSyntax, runTool } from './externalTools';
import { parseDependencies, findMissingLocalDependencies, dependencyInfo, checkDependencyPresent, DependencyInfo } from './dependencies';
import { getConfig } from './config';
import { DevPilotProvider, IssueItem } from './treeProvider';
import { DevPilotCodeActionProvider } from './codeActions';
import { addLocalDocs } from './docs';
import { detectTestRunner, runTests, runCurrentFile, testFilePath } from './testing';
import { TEST_TOOLS, TEST_TOOL_CATEGORIES, getTestTool, runEnabledTools } from './testTools';
import {
  callAI, getAIConfig, buildExplainPrompt, buildFixPrompt, buildAutoFixPrompt,
  buildBugAnalysisPrompt, buildCodeQualityPrompt, buildCodeReviewPrompt, buildOptimizationPrompt, buildRefactorPrompt,
  buildTestGenerationPrompt, buildDocumentationPrompt, buildReadmePrompt, buildSecurityReviewPrompt,
  TEST_MODE_LABELS, testModeTask, TestMode,
  buildInlineExplainPrompt, buildFixCandidatesPrompt, parseFixCandidates, extractFullFileBlock,
  AIRequest,
} from './ai';

let provider: DevPilotProvider;
let diagnostics: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;
let codeActionProvider: DevPilotCodeActionProvider;
let extensionContext: vscode.ExtensionContext;
let selectedIssues: DevIssue[] = [];

export function activate(ctx: vscode.ExtensionContext) {
  extensionContext = ctx;
  console.log('[DevPilot] Extension activated');
  provider = new DevPilotProvider();
  diagnostics = vscode.languages.createDiagnosticCollection('devpilot');
  outputChannel = vscode.window.createOutputChannel('DevPilot');
  ctx.subscriptions.push(diagnostics, outputChannel);

  const treeView = vscode.window.createTreeView('devpilot.sidebar', { treeDataProvider: provider, showCollapseAll: true, canSelectMany: true });
  ctx.subscriptions.push(treeView);
  ctx.subscriptions.push(treeView.onDidChangeSelection((e) => {
    selectedIssues = e.selection.filter((item): item is IssueItem => item instanceof IssueItem).map((item) => item.issue);
    const item = e.selection[0];
    provider.setSelectedIssue(item instanceof IssueItem ? item.issue : undefined);
  }));

  codeActionProvider = new DevPilotCodeActionProvider({
    getIssues: () => provider.getIssues(),
    setIssues: (issues) => { provider.setIssues(issues); publishDiagnostics(issues); },
  });
  // Quick Fix for ALL languages (the 0.1.0 build only registered Python).
  ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider(
    { scheme: 'file' }, codeActionProvider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
  ));

  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
    const cfg = getConfig();
    if (cfg.scanOnSave && doc.uri.scheme === 'file' && isSupportedFile(doc.uri.fsPath)) {
      void scanAndReplaceFile(doc.uri.fsPath);
    }
  }));

  const cmds: [string, (...args: any[]) => unknown][] = [
    ['devpilot.scanProject', () => scanProject()],
    ['devpilot.scanCurrentFile', () => scanCurrentFile()],
    ['devpilot.exportReport', () => exportReport()],
    ['devpilot.refresh', () => provider.setIssues(provider.getIssues())],
    ['devpilot.showIssue', (issue: DevIssue) => showIssue(issue)],
    ['devpilot.explainIssue', (issue: DevIssue) => explainIssue(issue)],
    ['devpilot.explainInline', (issue: DevIssue) => explainInline(issue)],
    ['devpilot.explainSelection', () => explainSelection()],
    ['devpilot.suggestFix', (issue: DevIssue) => suggestFix(resolveIssueArg(issue))],
    ['devpilot.applyFix', (issue: DevIssue) => applyFix(resolveIssueArg(issue))],
    ['devpilot.autoFix', (issue: DevIssue) => autoFix(resolveIssueArg(issue))],
    ['devpilot.inlineFixOne', (issue: DevIssue) => inlineFixOne(resolveIssueArg(issue))],
    ['devpilot.inlineFixAll', (file: string) => inlineFixAll(typeof file === 'string' ? file : activeFilePath())],
    ['devpilot.fixCurrentIssue', () => fixCurrentIssue()],
    ['devpilot.fixAllIssues', () => fixAllIssues()],
    ['devpilot.fixSelectedIssues', () => fixSelectedIssues()],
    ['devpilot.analyzeBug', (issue: DevIssue) => analyzeBug(resolveIssueArg(issue))],
    ['devpilot.reviewQuality', () => reviewFile('quality')],
    ['devpilot.verifyFix', () => verifyFix()],
    ['devpilot.generateTests', () => generateTests()],
    ['devpilot.generateEdgeCaseTests', () => generateTests('edge')],
    ['devpilot.generateInputValidationTests', () => generateTests('input-validation')],
    ['devpilot.generateRegressionTests', () => generateTests('regression')],
    ['devpilot.runTests', () => runTestsCommand()],
    ['devpilot.configureTestTools', () => configureTestTools()],
    ['devpilot.runCurrentFile', () => runCurrentFileCommand()],
    ['devpilot.generateDocs', () => generateDocs()],
    ['devpilot.generateReadme', () => generateReadme()],
    ['devpilot.optimizeCode', () => transformFile('optimize')],
    ['devpilot.refactorCode', () => transformFile('refactor')],
    ['devpilot.reviewCode', () => reviewFile('review')],
    ['devpilot.securityReview', () => reviewFile('security')],
    ['devpilot.checkDependencies', () => checkDependenciesCommand()],
    ['devpilot.configureAI', () => configureAI()],
    ['devpilot.followGithub', () => vscode.env.openExternal(vscode.Uri.parse('https://github.com/datascientist970'))],
    ['devpilot.followLinkedin', () => vscode.env.openExternal(vscode.Uri.parse('https://www.linkedin.com/in/dawood406'))],
    ['devpilot.clearAIKey', () => clearAIKey()],
    ['devpilot.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'devpilot')],
  ];
  for (const [id, fn] of cmds) ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
}

export function deactivate() { console.log('[DevPilot] Deactivated'); }

// ---------------------------------------------------------------- helpers

function publishDiagnostics(issues: DevIssue[]) {
  const cfg = getConfig();
  diagnostics.clear();
  if (!cfg.enableDiagnostics) return;
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const i of issues) {
    const list = byFile.get(i.file) ?? [];
    const sev = i.severity === 'error' ? vscode.DiagnosticSeverity.Error
      : i.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
    const d = new vscode.Diagnostic(new vscode.Range(i.line, i.column, i.endLine, Math.max(i.endColumn, i.column + 1)), i.message, sev);
    d.source = 'DevPilot';
    d.code = i.code;
    list.push(d);
    byFile.set(i.file, list);
  }
  for (const [file, list] of byFile) diagnostics.set(vscode.Uri.file(file), list);
}

function activeFilePath(): string | undefined {
  const e = vscode.window.activeTextEditor;
  return e && e.document.uri.scheme === 'file' ? e.document.uri.fsPath : undefined;
}

function resolveIssueArg(issue: DevIssue | undefined): DevIssue | undefined {
  if (issue && issue.file) return issue;
  return provider.getSelectedIssue() ?? currentIssueAtCursor();
}

function currentIssueAtCursor(): DevIssue | undefined {
  const e = vscode.window.activeTextEditor;
  if (!e) return undefined;
  const pos = e.selection.active;
  return provider.getIssues().find((i) => i.file === e.document.uri.fsPath && pos.line >= i.line && pos.line <= i.endLine);
}

function snippetFor(text: string, issue: DevIssue): { snippet: string; start: number; end: number } {
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, issue.line - 2);
  const end = Math.min(lines.length - 1, issue.endLine + 2);
  return { snippet: lines.slice(start, end + 1).join('\n'), start, end };
}

function collectRelatedFiles(filePath: string, text: string): { path: string; content: string }[] {
  const dir = path.dirname(filePath);
  const found: { path: string; content: string }[] = [];
  const re = /(?:import\s+[^'"]*?from\s+|require\s*\(\s*|#include\s*[<"]|from\s+)(['"])([^'"]+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && found.length < 3) {
    const target = m[2];
    if (!target.startsWith('.')) continue;
    const resolved = path.resolve(dir, target);
    const candidates = [resolved, `${resolved}.py`, `${resolved}.ts`, `${resolved}.js`, `${resolved}.cpp`, `${resolved}.h`, `${resolved}.go`, `${resolved}.java`];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        try { found.push({ path: path.relative(dir, c), content: fs.readFileSync(c, 'utf8').slice(0, 4000) }); } catch { /* ignore */ }
        break;
      }
    }
  }
  return found;
}

async function scanFile(filePath: string): Promise<DevIssue[]> {
  const cfg = getConfig();
  const lang = detectLanguage(filePath);
  if (!lang) return [];
  let text = '';
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    text = doc.getText();
  } catch { text = fs.readFileSync(filePath, 'utf8'); }
  const builtIn = scanBuiltIn(text, filePath, cfg);
  const external = await scanExternal(filePath, lang, cfg);
  // Local (quoted) headers that are not in the project: a real missing file,
  // not a guess — checked against the file's own folder and the workspace root.
  const localIssues: DevIssue[] = [];
  if (lang.id === 'c' || lang.id === 'cpp') {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const missingLocal = findMissingLocalDependencies(
      parseDependencies(text, lang),
      (name) => fs.existsSync(path.join(path.dirname(filePath), name)) || (folder ? fs.existsSync(path.join(folder, name)) : false),
    );
    for (const dep of missingLocal) {
      localIssues.push({
        id: `DP601-${filePath}-${dep.line}`, file: filePath, line: dep.line, column: dep.column,
        endLine: dep.line, endColumn: dep.column + dep.name.length, severity: 'error', category: 'bug',
        message: `Header file "${dep.name}" is included but not found in this project.`,
        code: 'DP601', suggestion: 'Create the header, fix the include path, or run "DevPilot: Check & Install Missing Dependencies".',
        language: lang.id,
      });
    }
  }
  const all = [...external, ...builtIn, ...localIssues];
  // External tools can duplicate built-in findings; dedupe on code+position.
  const seen = new Set<string>();
  return all.filter((i) => {
    const k = `${i.code ?? i.message}:${i.line}:${i.column}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.line - b.line || a.column - b.column);
}

async function scanAndReplaceFile(filePath: string) {
  const issues = await scanFile(filePath);
  const rest = provider.getIssues().filter((i) => i.file !== filePath);
  const merged = [...rest, ...issues];
  provider.setIssues(merged);
  publishDiagnostics(merged);
  return issues;
}

async function scanFiles(files: string[], title: string) {
  if (!files.length) { vscode.window.showWarningMessage('DevPilot: No supported files found to scan.'); return; }
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async (progress) => {
    const started = Date.now();
    const all: DevIssue[] = [];
    for (let idx = 0; idx < files.length; idx++) {
      const pct = Math.round(((idx + 1) / files.length) * 100);
      progress.report({ message: `${pct}% (${idx + 1}/${files.length}) — ${path.basename(files[idx])}`, increment: 100 / files.length });
      try { all.push(...await scanFile(files[idx])); }
      catch (e) { outputChannel.appendLine(`[Scan error] ${files[idx]}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    provider.setIssues(all);
    publishDiagnostics(all);
    provider.setLastScanLabel(`${files.length} file(s) scanned`);
    outputChannel.appendLine(`Scan completed: ${files.length} file(s), ${all.length} issue(s) in ${seconds}s.`);
    vscode.window.showInformationMessage(`DevPilot: Scan complete — ${all.length} issue(s) in ${files.length} file(s) in ${seconds}s.`);
  });
}

// Simple glob matcher for scan exclusions, e.g. a pattern ending in node_modules with wildcards.
export function matchesExclusion(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.startsWith('**', i)) { re += '.*'; i++; }
    else if (pattern[i] === '*') re += '[^/]*';
    else if (pattern[i] === '?') re += '.';
    else re += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(normalized);
}

async function scanProject() {
  const cfg = getConfig();
  const editor = vscode.window.activeTextEditor;
  const glob = cfg.pythonOnly ? globForPythonOnly() : globForAllLanguages();
  const found = await vscode.workspace.findFiles(glob, '**/{node_modules,.git,.venv,venv,build,dist,__pycache__,target}/**', 500);
  let files = found.map((u) => u.fsPath).filter((f) => !cfg.scanExclusions.some((ex) => matchesExclusion(f, ex)));
  // If a single supported file is open and no workspace files were found, scan it.
  if (!files.length && editor && editor.document.uri.scheme === 'file' && isSupportedFile(editor.document.fileName)) files = [editor.document.fileName];
  await scanFiles(files, 'DevPilot: Scanning project...');
}

async function exportReport() {
  const issues = provider.getIssues();
  if (!issues.length) { vscode.window.showWarningMessage('DevPilot: No issues to export — scan a file or project first.'); return; }
  const format = await vscode.window.showQuickPick(['Markdown (.md)', 'JSON (.json)'], { placeHolder: 'Export format' });
  if (!format) return;
  const isJson = format.startsWith('JSON');
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(issues[0].file);
  const outPath = path.join(folder, isJson ? 'devpilot-report.json' : 'devpilot-report.md');
  const bySeverity = (s: string) => issues.filter((i) => i.severity === s).length;
  const content = isJson
    ? JSON.stringify({ generatedAt: new Date().toISOString(), total: issues.length, errors: bySeverity('error'), warnings: bySeverity('warning'), infos: bySeverity('info'), issues }, null, 2)
    : `# DevPilot Scan Report\n\nGenerated: ${new Date().toISOString()}\n\nTotal: ${issues.length} — Errors: ${bySeverity('error')}, Warnings: ${bySeverity('warning')}, Info: ${bySeverity('info')}\n\n| File | Line | Severity | Code | Message |\n| --- | --- | --- | --- | --- |\n${issues.map((i) => `| ${path.basename(i.file)} | ${i.line + 1} | ${i.severity} | ${i.code ?? ''} | ${i.message.replace(/\|/g, '\\|')} |`).join('\n')}\n`;
  fs.writeFileSync(outPath, content);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(outPath));
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(`DevPilot: Report exported to ${path.basename(outPath)}.`);
}

async function scanCurrentFile() {
  const file = activeFilePath();
  if (!file) { vscode.window.showWarningMessage('DevPilot: No active file to scan.'); return; }
  if (!isSupportedFile(file)) { vscode.window.showWarningMessage(`DevPilot: ${path.extname(file)} is not a supported code file.`); return; }
  const issues = await scanAndReplaceFile(file);
  vscode.window.showInformationMessage(`DevPilot: ${issues.length} issue(s) in ${path.basename(file)}.`);
}

async function showIssue(issue: DevIssue) {
  if (!issue) return;
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
    const editor = await vscode.window.showTextDocument(doc);
    const range = new vscode.Range(issue.line, issue.column, issue.endLine, issue.endColumn);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  } catch (e) { vscode.window.showErrorMessage(`DevPilot: Cannot open issue: ${e instanceof Error ? e.message : String(e)}`); }
}

async function showMarkdown(title: string, content: string) {
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: `# ${title}\n\n${content}` });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function callAIOrWarn(req: AIRequest): Promise<string> {
  const cfg = await getAIConfig(extensionContext);
  if (!cfg) return '';
  return callAI(cfg, req);
}

// ---------------------------------------------------------------- AI explain

async function explainIssue(issue: DevIssue | undefined) {
  if (!issue) { vscode.window.showWarningMessage('DevPilot: Select an issue first (sidebar or Problems panel).'); return; }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
  const lang = detectLanguage(issue.file);
  const { snippet } = snippetFor(doc.getText(), issue);
  const text = await callAIOrWarn(buildExplainPrompt({
    language: lang?.id, message: issue.message, code: issue.code, source: issue.source,
    severity: issue.severity, fileBase: path.basename(issue.file), lineNo: issue.line + 1, snippet,
  }));
  if (text) await showMarkdown(`DevPilot explanation — ${issue.message}`, text);
}

async function explainInline(issue: DevIssue | undefined) {
  if (!issue) return;
  await explainIssue(issue);
  // Cache a short explanation for the Quick Fix menu.
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
  const lang = detectLanguage(issue.file);
  const { snippet } = snippetFor(doc.getText(), issue);
  const text = await callAIOrWarn(buildExplainPrompt({
    language: lang?.id, message: issue.message, code: issue.code, source: issue.source,
    severity: issue.severity, fileBase: path.basename(issue.file), lineNo: issue.line + 1, snippet,
  }));
  if (text) codeActionProvider.setExplanation(issue.id, text);
}

async function explainSelection() {
  const e = vscode.window.activeTextEditor;
  if (!e || e.selection.isEmpty) { vscode.window.showWarningMessage('DevPilot: Select some code first.'); return; }
  const lang = detectLanguage(e.document.fileName);
  const selected = e.document.getText(e.selection);
  const surrounding = e.document.getText(new vscode.Range(Math.max(0, e.selection.start.line - 5), 0, Math.min(e.document.lineCount - 1, e.selection.end.line + 5), 0));
  const text = await callAIOrWarn(buildInlineExplainPrompt({ language: lang?.id, selectedCode: selected, surroundingCode: surrounding, fileName: path.basename(e.document.fileName) }));
  if (text) await showMarkdown('DevPilot — code explanation', text);
}

// ---------------------------------------------------------------- fixing

function localFixForIssue(issue: DevIssue, lines: string[]): string[] | null {
  const line = lines[issue.line] ?? '';
  switch (issue.code) {
    case 'DP105': { // unused variable: remove the assignment line (single-line only)
      if (issue.line === issue.endLine && /^\s*(?:const|let|var|final|static)?\s*[A-Za-z_$][\w$]*\s*=(?!=)/.test(line) || /^\s*[A-Za-z_]\w*\s*=(?!=)/.test(line)) {
        const copy = [...lines]; copy.splice(issue.line, 1); return copy;
      }
      return null;
    }
    case 'DP101': {
      const copy = [...lines]; copy[issue.line] = line.replace(/except\s*:/, 'except Exception:'); return copy;
    }
    case 'DP114': {
      const copy = [...lines]; copy[issue.line] = line.replace(/==\s*None/, 'is None').replace(/None\s*==/, 'None is'); return copy;
    }
    case 'DP115': {
      const copy = [...lines]; copy[issue.line] = line.replace(/(?<![=!])==(?!=)/g, '==='); return copy;
    }
    default: return null;
  }
}

async function confirmAndApply(filePath: string, newText: string, label: string): Promise<boolean> {
  const cfg = getConfig();
  const lang = detectLanguage(filePath);
  if (!lang) return false;
  if (cfg.validateSyntaxBeforeFix) {
    const check = await validateSyntax(newText, lang, cfg.pythonPath);
    if (!check.ok) {
      vscode.window.showErrorMessage(`DevPilot: Fix rejected — the result is not valid ${lang.displayName}: ${check.error ?? ''}`);
      return false;
    }
  }
  if (cfg.requireConfirmationBeforeFix) {
    const answer = await vscode.window.showWarningMessage(`DevPilot: Apply this fix to ${path.basename(filePath)}?`, { modal: true }, 'Apply Fix', 'Cancel');
    if (answer !== 'Apply Fix') return false;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, fullRange, newText);
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) { vscode.window.showErrorMessage('DevPilot: Could not apply the edit.'); return false; }
  await doc.save();
  outputChannel.appendLine(`[Fix] ${label} applied to ${filePath}`);
  return true;
}

async function postFixReport(filePath: string, applied: number, skipped: string[], failed: string[]): Promise<FixReport> {
  const remainingIssues = await scanAndReplaceFile(filePath);
  const report: FixReport = { applied, skipped: skipped.length, failed: failed.length, remaining: remainingIssues.length, skippedReasons: skipped, failedReasons: failed };
  const parts = [`Applied: ${applied}`, `Remaining: ${remainingIssues.length}`];
  if (skipped.length) parts.push(`Skipped: ${skipped.length} (${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '…' : ''})`);
  if (failed.length) parts.push(`Failed: ${failed.length}`);
  vscode.window.showInformationMessage(`DevPilot: Fix complete — ${parts.join(' · ')}`);
  outputChannel.appendLine(`[Fix report] ${filePath}: ${JSON.stringify(report)}`);
  return report;
}

async function suggestFix(issue: DevIssue | undefined) {
  if (!issue) { vscode.window.showWarningMessage('DevPilot: Select an issue first.'); return; }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const lang = detectLanguage(issue.file);
  const candidates: { label: string; newText: string }[] = [];
  const local = localFixForIssue(issue, lines);
  if (local) candidates.push({ label: 'Local fix (no AI) — safe deterministic change', newText: local.join('\n') });
  const { snippet, start, end } = snippetFor(text, issue);
  const aiText = await callAIOrWarn(buildFixCandidatesPrompt({
    language: lang?.id, message: issue.message, code: issue.code, source: issue.source,
    severity: issue.severity, fileBase: path.basename(issue.file), lineNo: issue.line + 1, snippet,
  }));
  const aiCandidates = parseFixCandidates(aiText);
  if (!aiCandidates.length && aiText) {
    // Fallback: single-snippet prompt returns one code block.
    const single = await callAIOrWarn(buildFixPrompt({
      language: lang?.id, message: issue.message, code: issue.code, source: issue.source,
      severity: issue.severity, fileBase: path.basename(issue.file), lineNo: issue.line + 1, snippet,
    }));
    const block = extractFullFileBlock(single);
    if (block) aiCandidates.push(block);
  }
  aiCandidates.forEach((c, i) => {
    const newLines = [...lines]; newLines.splice(start, end - start + 1, ...c.replace(/\n$/, '').split('\n'));
    candidates.push({ label: `AI candidate ${i + 1}: ${c.split('\n')[0].trim().slice(0, 80)}`, newText: newLines.join('\n') });
  });
  if (!candidates.length) { vscode.window.showWarningMessage('DevPilot: No fix suggestion available. Configure an AI provider, or fix it manually.'); return; }
  const picked = await vscode.window.showQuickPick(candidates.map((c) => c.label), { placeHolder: `Fix for: ${issue.message}` });
  if (!picked) return;
  const chosen = candidates.find((c) => c.label === picked)!;
  if (await confirmAndApply(issue.file, chosen.newText, issue.message)) await postFixReport(issue.file, 1, [], []);
}

async function applyFix(issue: DevIssue | undefined) { await suggestFix(issue); }

async function inlineFixOne(issue: DevIssue | undefined) {
  if (!issue) { vscode.window.showWarningMessage('DevPilot: Select an issue first.'); return; }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const local = localFixForIssue(issue, lines);
  if (local) {
    if (await confirmAndApply(issue.file, local.join('\n'), issue.message)) await postFixReport(issue.file, 1, [], []);
    return;
  }
  await suggestFix(issue);
}

async function inlineFixAll(file: string | undefined) {
  if (!file) { vscode.window.showWarningMessage('DevPilot: No file selected.'); return; }
  await fixAllIssues(file);
}

async function fixCurrentIssue() {
  const issue = currentIssueAtCursor() ?? provider.getSelectedIssue();
  if (!issue) { vscode.window.showWarningMessage('DevPilot: Put the cursor on an issue, or select one in the sidebar.'); return; }
  await inlineFixOne(issue);
}

async function autoFix(issue: DevIssue | undefined) {
  if (!issue) { vscode.window.showWarningMessage('DevPilot: Select an issue first.'); return; }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
  const text = doc.getText();
  const lang = detectLanguage(issue.file);
  const cfg = await getAIConfig(extensionContext);
  if (!cfg) return;
  const result = await callAI(cfg, buildAutoFixPrompt({
    language: lang?.id, issueMessage: issue.message, issueCode: issue.code, issueSource: issue.source,
    issueLine: issue.line + 1, fileName: path.basename(issue.file), fileContent: text,
    relatedFiles: collectRelatedFiles(issue.file, text),
  }));
  const fixed = extractFullFileBlock(result);
  if (!fixed) { vscode.window.showWarningMessage('DevPilot: AI did not return a complete corrected file. Nothing was changed.'); return; }
  if (fixed.trim() === text.trim()) { vscode.window.showInformationMessage('DevPilot: AI returned the file unchanged — no confident fix.'); return; }
  if (await confirmAndApply(issue.file, fixed, issue.message)) await postFixReport(issue.file, 1, [], []);
}

async function fixIssuesList(target: string, issues: DevIssue[]) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
  let lines = doc.getText().split(/\r?\n/);
  let applied = 0; const skipped: string[] = []; const failed: string[] = [];
  const sorted = [...issues].sort((a, b) => b.line - a.line);
  for (const issue of sorted) {
    const fixed = localFixForIssue(issue, lines);
    if (fixed) { lines = fixed; applied++; }
    else skipped.push(`${issue.code ?? ''} line ${issue.line + 1}: ${issue.message}`);
  }
  if (applied > 0) {
    const cfg = getConfig();
    const lang = detectLanguage(target);
    if (lang && cfg.validateSyntaxBeforeFix) {
      const check = await validateSyntax(lines.join('\n'), lang, cfg.pythonPath);
      if (!check.ok) { vscode.window.showErrorMessage(`DevPilot: Local fixes produced invalid code (${check.error ?? ''}). Nothing was applied.`); return; }
    }
    const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, fullRange, lines.join('\n'));
    if (await vscode.workspace.applyEdit(edit)) await doc.save();
    else failed.push('Workspace edit failed for local fixes');
  }
  const remaining = (await scanAndReplaceFile(target)).filter((i) => i.file === target);
  // Only AI-fix issues that were in the selected list (matched by code + message).
  const wanted = new Set(issues.map((i) => `${i.code ?? ''}|${i.message}`));
  const toAi = remaining.filter((i) => wanted.has(`${i.code ?? ''}|${i.message}`));
  const aiCfg = await getAIConfig(extensionContext).catch(() => null);
  if (aiCfg && toAi.length) {
    for (const issue of toAi.slice(0, 5)) {
      try {
        const curDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
        const curText = curDoc.getText();
        const lang = detectLanguage(target);
        const result = await callAI(aiCfg, buildAutoFixPrompt({
          language: lang?.id, issueMessage: issue.message, issueCode: issue.code, issueSource: issue.source,
          issueLine: issue.line + 1, fileName: path.basename(target), fileContent: curText,
          relatedFiles: collectRelatedFiles(target, curText),
        }));
        const fixed = extractFullFileBlock(result);
        if (fixed && fixed.trim() !== curText.trim()) {
          const cfg = getConfig();
          const lang2 = detectLanguage(target);
          if (lang2 && cfg.validateSyntaxBeforeFix) {
            const check = await validateSyntax(fixed, lang2, cfg.pythonPath);
            if (!check.ok) { failed.push(`AI fix for line ${issue.line + 1} failed syntax validation`); continue; }
          }
          const edit = new vscode.WorkspaceEdit();
          edit.replace(curDoc.uri, new vscode.Range(0, 0, curDoc.lineCount, 0), fixed);
          if (await vscode.workspace.applyEdit(edit)) { await curDoc.save(); applied++; }
          else failed.push(`AI fix for line ${issue.line + 1} could not be applied`);
        } else skipped.push(`AI returned no change for line ${issue.line + 1}`);
      } catch (e) { failed.push(`AI fix for line ${issue.line + 1}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  } else if (toAi.length && !aiCfg) {
    skipped.push(`${toAi.length} issue(s) need AI (no provider configured)`);
  }
  await postFixReport(target, applied, skipped, failed);
}

async function fixAllIssues(file?: string) {
  const target = file ?? activeFilePath();
  if (!target) { vscode.window.showWarningMessage('DevPilot: No active file.'); return; }
  const issues = provider.getIssues().filter((i) => i.file === target);
  if (!issues.length) { vscode.window.showInformationMessage('DevPilot: No issues in this file.'); return; }
  const proceed = await vscode.window.showWarningMessage(`DevPilot: Fix all ${issues.length} issue(s) in ${path.basename(target)}?`, { modal: true }, 'Fix All', 'Cancel');
  if (proceed !== 'Fix All') return;
  await fixIssuesList(target, issues);
}

async function fixSelectedIssues() {
  let issues = [...selectedIssues];
  if (!issues.length) {
    const file = activeFilePath();
    if (!file) { vscode.window.showWarningMessage('DevPilot: Select issues in the DevPilot sidebar (Ctrl/Cmd-click for several), or open a file with issues.'); return; }
    const fileIssues = provider.getIssues().filter((i) => i.file === file);
    if (!fileIssues.length) { vscode.window.showInformationMessage('DevPilot: No issues in this file.'); return; }
    const picked = await vscode.window.showQuickPick(
      fileIssues.map((i) => ({ label: `${i.code ?? ''} line ${i.line + 1}: ${i.message}`, issue: i })),
      { canPickMany: true, placeHolder: 'Tick the issues to fix (sidebar multi-select works too)' },
    );
    if (!picked?.length) return;
    issues = picked.map((p) => p.issue);
  }
  const proceed = await vscode.window.showWarningMessage(`DevPilot: Fix ${issues.length} selected issue(s)?`, { modal: true }, 'Fix Selected', 'Cancel');
  if (proceed !== 'Fix Selected') return;
  const byFile = new Map<string, DevIssue[]>();
  for (const issue of issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }
  for (const [file, list] of byFile) await fixIssuesList(file, list);
}

async function analyzeBug(issue: DevIssue | undefined) {
  if (!issue) { vscode.window.showWarningMessage('DevPilot: Select an issue first.'); return; }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
  const lang = detectLanguage(issue.file);
  const { snippet } = snippetFor(doc.getText(), issue);
  const text = await callAIOrWarn(buildBugAnalysisPrompt({
    language: lang?.id, message: issue.message, code: issue.code, source: issue.source,
    severity: issue.severity, fileBase: path.basename(issue.file), lineNo: issue.line + 1, snippet,
    fileContent: doc.getText(),
  }));
  if (text) await showMarkdown(`DevPilot bug analysis — ${issue.message}`, text);
}

async function verifyFix() {
  const file = activeFilePath();
  if (!file) { vscode.window.showWarningMessage('DevPilot: No active file.'); return; }
  const before = provider.getIssues().filter((i) => i.file === file).length;
  const after = await scanAndReplaceFile(file);
  const cfg = getConfig();
  let testNote = '';
  if (cfg.autoRunTestsAfterFix) {
    const lang = detectLanguage(file);
    if (lang) {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const runner = detectTestRunner(folder, lang, file);
      if (runner && folder) {
        const result = await runTests(runner, folder);
        testNote = ` Tests: ${result.passed} passed, ${result.failed} failed (${runner.name}).`;
        outputChannel.appendLine(`[Tests] ${runner.name}: ${result.passed} passed, ${result.failed} failed\n${result.raw.slice(0, 4000)}`);
      }
    }
  }
  vscode.window.showInformationMessage(`DevPilot: Verification — ${before} issue(s) before, ${after.length} after.${testNote}`);
}

// ---------------------------------------------------------------- tests & docs

function localTestTemplate(filePath: string, lang: LanguageConfig, text: string, mode: TestMode = 'full'): string {
  const modeHeader = mode === 'edge'
    ? '# DevPilot edge-case template — fill in the boundary values for each function.\n'
    : mode === 'input-validation'
    ? '# DevPilot input-validation template — fill in the invalid inputs each function must reject.\n'
    : mode === 'regression'
    ? '# DevPilot regression template — these tests lock in current behaviour.\n'
    : '';
  const names = text.match(/(?:def|function|fn|func)\s+([A-Za-z_]\w*)/g)?.map((s) => s.replace(/.*\s+/, '')) ?? [];
  const base = path.basename(filePath, path.extname(filePath));
  if (lang.id === 'python') {
    const suffix = mode === 'edge' ? '_boundary' : mode === 'input-validation' ? '_rejects_invalid_input' : mode === 'regression' ? '_regression' : '';
    return [modeHeader + `# Generated by DevPilot — replace the placeholders with real assertions.`, `from ${base} import ${names[0] ?? 'main'}  # noqa: F401`, '', ...names.map((n) => `def test_${n}${suffix}():\n    assert ${n} is not None  # TODO: replace with a real ${mode} assertion\n`), ''].join('\n');
  }
  if (['javascript', 'typescript'].includes(lang.id)) {
    return [modeHeader + `// Generated by DevPilot — replace the placeholders with real assertions.`, `const mod = require('./${base}');`, '', ...names.map((n) => `test('${n} (${mode})', () => { expect(mod.${n}).toBeDefined(); });`), ''].join('\n');
  }
  if (lang.id === 'go') {
    return [`package ${path.basename(path.dirname(filePath)) || 'main'}`, '', `// Generated by DevPilot — replace with real assertions.`, ...names.map((n) => `func Test${n.charAt(0).toUpperCase() + n.slice(1)}(t *testing.T) { _ = ${n} }`), ''].join('\n');
  }
  return modeHeader + `# Generated by DevPilot — replace the placeholders with real assertions.\n# Functions found: ${names.join(', ') || 'none'}\n`;
}

async function generateTests(mode?: TestMode) {
  const file = activeFilePath();
  if (!file) { vscode.window.showWarningMessage('DevPilot: Open a file first.'); return; }
  const lang = detectLanguage(file);
  if (!lang) { vscode.window.showWarningMessage('DevPilot: Unsupported file for test generation.'); return; }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const text = doc.getText();
  let testMode: TestMode = mode ?? 'full';
  if (!mode) {
    const pickedMode = await vscode.window.showQuickPick(
      (['full', 'edge', 'input-validation', 'regression'] as TestMode[]).map((m) => ({ label: TEST_MODE_LABELS[m], mode: m })),
      { placeHolder: 'Which kind of tests? (tick one — edge / input-validation / regression are separate modes)' },
    );
    if (!pickedMode) return;
    testMode = pickedMode.mode;
  }
  const location = await vscode.window.showQuickPick(['Alongside the source file', 'In a tests/ folder'], { placeHolder: 'Where should the test file go?' });
  if (!location) return;
  const target = testFilePath(file, lang, location.includes('tests/'));
  if (fs.existsSync(target)) {
    const overwrite = await vscode.window.showWarningMessage(`${path.basename(target)} already exists. Overwrite it?`, { modal: true }, 'Overwrite', 'Cancel');
    if (overwrite !== 'Overwrite') return;
  }
  let testCode = '';
  const aiCfg = await getAIConfig(extensionContext).catch(() => null);
  if (aiCfg) {
    const modeTask = testModeTask(testMode);
    const result = await callAI(aiCfg, buildTestGenerationPrompt({
      language: lang.id, fileName: path.basename(file), fileContent: text, framework: lang.testFramework,
      task: modeTask.task, requirements: modeTask.requirements,
    }));
    testCode = extractFullFileBlock(result) ?? result;
  }
  if (!testCode.trim()) testCode = localTestTemplate(file, lang, text, testMode);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, testCode);
  const testDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
  await vscode.window.showTextDocument(testDoc);
  const run = await vscode.window.showInformationMessage('DevPilot: Test file created. Run the tests now?', 'Run Tests', 'Later');
  if (run === 'Run Tests') await runTestsCommand();
}

async function runTestsCommand() {
  const file = activeFilePath();
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) { vscode.window.showWarningMessage('DevPilot: Open a workspace folder first.'); return; }
  const cfg = getConfig();
  const lang = file ? detectLanguage(file) : undefined;
  const runner = lang ? detectTestRunner(folder, lang, file!) : null;
  const enabled = cfg.testEnabledTools.filter((id) => getTestTool(id));
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DevPilot: Running tests...', cancellable: false }, async (progress) => {
    const started = Date.now();
    let shown = 0;
    const report = (pct: number, msg: string) => {
      progress.report({ message: `${pct}% — ${msg}`, increment: Math.max(0, pct - shown) });
      shown = pct;
    };
    // Feature 2 — test dependencies BEFORE the tests run (not during, not after).
    // If the check is disabled in settings, tests run exactly as before.
    if (cfg.dependenciesCheckBeforeTests && runner) {
      report(5, 'Checking test dependencies...');
      const missingTestDeps: { name: string; command: string; link: string }[] = [];
      if (runner.name.toLowerCase().includes('pytest')) {
        const out = await runTool(cfg.pythonPath, ['-c', 'import pytest'], folder, 15000);
        if (!out.ok && /ModuleNotFoundError|No module named/.test(out.stderr)) {
          missingTestDeps.push({ name: 'pytest', command: `${cfg.pythonPath} -m pip install pytest`, link: 'https://docs.pytest.org/' });
        }
      }
      if (runner.name.toLowerCase().includes('npm') && !fs.existsSync(path.join(folder, 'node_modules'))) {
        missingTestDeps.push({ name: 'node_modules', command: 'npm install', link: 'https://docs.npmjs.com/cli/install' });
      }
      for (const dep of missingTestDeps) {
        const choice = cfg.dependenciesAutoInstall ? 'Install' : await vscode.window.showWarningMessage(
          `DevPilot: Test dependency "${dep.name}" is missing, so tests would fail. Install it first?`, { modal: true }, 'Install', 'Show command / link', 'Run tests anyway',
        );
        if (choice === 'Install') {
          report(10, `Installing ${dep.name}...`);
          const parts = dep.command.split(' ');
          const out = await runTool(parts[0], parts.slice(1), folder, 180000);
          outputChannel.appendLine(`[Install] ${dep.command}\n${(out.stdout + out.stderr).slice(0, 4000)}`);
          if (!out.ok) { vscode.window.showErrorMessage(`DevPilot: Could not install ${dep.name}. Command: ${dep.command} — see the DevPilot output channel.`); return; }
        } else if (choice === 'Show command / link') {
          outputChannel.appendLine(`[Test dependency] ${dep.name} is missing. Run: ${dep.command} — or see ${dep.link}`);
          outputChannel.show(true);
          return;
        }
      }
    }
    const summaries: string[] = [];
    if (runner) {
      report(30, `Running ${runner.name}...`);
      const result = await runTests(runner, folder);
      outputChannel.appendLine(`[Tests] ${result.command}\n${result.raw.slice(0, 8000)}`);
      summaries.push(`${runner.name}: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped`);
    } else if (!enabled.length) {
      vscode.window.showWarningMessage(`DevPilot: No test runner detected${lang ? ` for ${lang.displayName}` : ''}. Tick a testing tool via "DevPilot: Configure Test Tools" to run one instead.`);
      return;
    }
    if (cfg.testAutoRunEnabledTools && enabled.length) {
      report(80, 'Running ticked testing tools...');
      const toolResults = await runEnabledTools(folder, enabled, cfg.testCustomCommands);
      for (const r of toolResults) {
        outputChannel.appendLine(`[Test tool] ${r.displayName} — ${r.status}${r.command ? ` — ${r.command}` : ''}\n${r.output.slice(0, 4000)}`);
        summaries.push(`${r.displayName}: ${r.status}`);
      }
    } else if (!enabled.length) {
      outputChannel.appendLine('[Test tools] No testing tools ticked. Run "DevPilot: Configure Test Tools" to tick Playwright, Cypress, Postman, JMeter, K6, etc., and they will auto-run here.');
    }
    report(100, 'Done');
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    outputChannel.show(true);
    outputChannel.appendLine(`[Tests] Done in ${seconds}s.`);
    vscode.window.showInformationMessage(`DevPilot tests — ${summaries.join(' · ')} (${seconds}s)`);
  });
}

/**
 * Feature 1 — missing headers / imports.
 * WHEN it runs: on demand (this command), and its missing-file check is also
 * part of scanning (local headers, DP601). Installs NEVER happen silently
 * during a scan: this command checks first, then asks — unless the user
 * enabled devpilot.dependencies.autoInstall, in which case it installs
 * without asking. A dependency with no install command shows its link.
 */
async function checkDependenciesCommand(): Promise<DependencyInfo[]> {
  const file = activeFilePath();
  if (!file) { vscode.window.showWarningMessage('DevPilot: Open a file first.'); return []; }
  const lang = detectLanguage(file);
  if (!lang) { vscode.window.showWarningMessage('DevPilot: Unsupported file.'); return []; }
  const cfg = getConfig();
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const deps = parseDependencies(doc.getText(), lang);
  if (!deps.length) { vscode.window.showInformationMessage('DevPilot: No includes or imports found in this file.'); return []; }
  const infos: DependencyInfo[] = [];
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DevPilot: Checking dependencies...', cancellable: false }, async (progress) => {
    const started = Date.now();
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i];
      const pct = Math.round(((i + 1) / deps.length) * 100);
      progress.report({ message: `${pct}% — checking ${dep.name}`, increment: 100 / deps.length });
      const status = await checkDependencyPresent(dep, lang, folder, cfg.pythonPath);
      const info = dependencyInfo(dep, lang, cfg.pythonPath);
      infos.push({ ...info, status });
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const missing = infos.filter((i) => i.status === 'missing');
    const unknown = infos.filter((i) => i.status === 'unknown' && !i.local);
    outputChannel.appendLine(`[Dependencies] ${path.basename(file)}: ${infos.length} checked in ${seconds}s — ${missing.length} missing, ${unknown.length} could not be verified.`);
    for (const i of infos) outputChannel.appendLine(`  ${i.status.toUpperCase()}  ${i.name} — ${i.hint}`);
    outputChannel.show(true);
    if (!missing.length && !unknown.length) {
      vscode.window.showInformationMessage(`DevPilot: All ${infos.length} dependency/ies found in ${seconds}s.`);
      return;
    }
    // Offer install for the missing ones; unknown ones show their command/link for manual install.
    const actionable = [...missing, ...unknown.filter((i) => i.installCommand || i.link)];
    if (!actionable.length) { vscode.window.showWarningMessage('DevPilot: Some dependencies could not be verified and have no known install command — see the DevPilot output channel.'); return; }
    const picked = await vscode.window.showQuickPick(
      actionable.map((i) => ({ label: `${i.name} — ${i.status}`, description: i.installCommand ?? i.link ?? '', detail: i.hint, info: i })),
      { canPickMany: true, placeHolder: 'Tick dependencies to install (or open their link)' },
    );
    if (!picked) return;
    for (const p of picked) {
      const info = (p as { info: DependencyInfo }).info;
      if (info.installCommand && (cfg.dependenciesAutoInstall || (await vscode.window.showWarningMessage(`DevPilot: Install ${info.name}?`, { modal: true }, 'Install') === 'Install'))) {
        // apt needs sudo, so it goes to a visible terminal; pip/npm run via the tool runner.
        if (info.installCommand.startsWith('sudo apt')) {
          const term = vscode.window.createTerminal('DevPilot install');
          term.show();
          term.sendText(info.installCommand);
          vscode.window.showInformationMessage(`DevPilot: Install command for ${info.name} sent to the terminal (sudo will ask for your password there).`);
        } else {
          const parts = info.installCommand.split(' ');
          const out = await runTool(parts[0], parts.slice(1), folder ?? path.dirname(file), 120000);
          outputChannel.appendLine(`[Install] ${info.installCommand}\n${(out.stdout + out.stderr).slice(0, 4000)}`);
          vscode.window.showInformationMessage(out.ok ? `DevPilot: ${info.name} installed.` : `DevPilot: Install of ${info.name} failed — see the DevPilot output channel for the command and error.`);
        }
      } else if (info.link) {
        await vscode.env.openExternal(vscode.Uri.parse(info.link));
      }
    }
  });
  return infos;
}

async function configureTestTools() {
  const cfg = getConfig();
  const current = new Set(cfg.testEnabledTools);
  const items = TEST_TOOLS.map((tool) => ({
    label: `${TEST_TOOL_CATEGORIES[tool.category]} — ${tool.displayName}`,
    description: tool.runnable ? tool.description : `${tool.description} (external — not auto-runnable)`,
    detail: tool.hint,
    picked: current.has(tool.id),
    id: tool.id,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Tick the testing tools to auto-run on "DevPilot: Run Tests" (Settings > devpilot.test.enabledTools does the same)',
  });
  if (!picked) return;
  const testConfig = vscode.workspace.getConfiguration('devpilot.test');
  await testConfig.update('enabledTools', picked.map((p) => p.id), vscode.ConfigurationTarget.Workspace);
  const runnable = picked.filter((p) => getTestTool(p.id)?.runnable).length;
  vscode.window.showInformationMessage(`DevPilot: ${picked.length} testing tool(s) ticked (${runnable} auto-runnable). They will run when you click Run Tests.`);
}

async function runCurrentFileCommand() {
  const file = activeFilePath();
  if (!file) { vscode.window.showWarningMessage('DevPilot: No active file.'); return; }
  const lang = detectLanguage(file);
  if (!lang) { vscode.window.showWarningMessage('DevPilot: Unsupported file.'); return; }
  const cfg = getConfig();
  const result = await runCurrentFile(file, lang, cfg.pythonPath);
  outputChannel.appendLine(`[Run] ${path.basename(file)}\n${result.output.slice(0, 8000)}`);
  outputChannel.show(true);
  if (result.ok) vscode.window.showInformationMessage(`DevPilot: ${path.basename(file)} ran without errors.`);
  else vscode.window.showWarningMessage(`DevPilot: ${path.basename(file)} exited with errors — see the DevPilot output channel.`);
}

async function generateDocs() {
  const file = activeFilePath();
  if (!file) { vscode.window.showWarningMessage('DevPilot: Open a file first.'); return; }
  const lang = detectLanguage(file);
  if (!lang) { vscode.window.showWarningMessage('DevPilot: Unsupported file.'); return; }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const text = doc.getText();
  let documented = '';
  const aiCfg = await getAIConfig(extensionContext).catch(() => null);
  if (aiCfg) {
    const result = await callAI(aiCfg, buildDocumentationPrompt({ language: lang.id, fileName: path.basename(file), fileContent: text }));
    documented = extractFullFileBlock(result) ?? '';
  }
  if (!documented.trim()) {
    const local = addLocalDocs(text, file);
    if (!local.added) { vscode.window.showInformationMessage('DevPilot: Every function already has documentation (or none were found).'); return; }
    documented = local.text;
    vscode.window.showInformationMessage(`DevPilot: Added local doc comments for ${local.added} function(s). Review them, then save.`);
  }
  if (await confirmAndApply(file, documented, 'documentation')) await scanAndReplaceFile(file);
}

async function generateReadme() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { vscode.window.showWarningMessage('DevPilot: Open a workspace folder first.'); return; }
  const root = folder.uri.fsPath;
  const candidates = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'README.md'];
  const related: { path: string; content: string }[] = [];
  for (const c of candidates) {
    const p = path.join(root, c);
    if (fs.existsSync(p)) related.push({ path: c, content: fs.readFileSync(p, 'utf8').slice(0, 3000) });
  }
  const aiCfg = await getAIConfig(extensionContext).catch(() => null);
  let readme = '';
  if (aiCfg) {
    readme = await callAI(aiCfg, buildReadmePrompt({ fileName: path.basename(root), fileContent: '', relatedFiles: related, projectName: path.basename(root) }));
  }
  if (!readme.trim()) {
    readme = `# ${path.basename(root)}\n\nTODO: Add a project description.\n\n## Features\n\n- (Generated by DevPilot — edit this list.)\n\n## Usage\n\nTODO: Add usage instructions.\n`;
  }
  const target = path.join(root, 'README.md');
  if (fs.existsSync(target)) {
    const overwrite = await vscode.window.showWarningMessage('README.md already exists. Overwrite it?', { modal: true }, 'Overwrite', 'Cancel');
    if (overwrite !== 'Overwrite') return;
  }
  fs.writeFileSync(target, readme);
  const readmeDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
  await vscode.window.showTextDocument(readmeDoc);
}

async function transformFile(kind: 'optimize' | 'refactor') {
  const file = activeFilePath();
  if (!file) { vscode.window.showWarningMessage('DevPilot: Open a file first.'); return; }
  const lang = detectLanguage(file);
  if (!lang) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const text = doc.getText();
  const req = kind === 'optimize'
    ? buildOptimizationPrompt({ language: lang.id, fileName: path.basename(file), fileContent: text })
    : buildRefactorPrompt({ language: lang.id, fileName: path.basename(file), fileContent: text });
  const result = await callAIOrWarn(req);
  const transformed = extractFullFileBlock(result);
  if (!transformed) { vscode.window.showWarningMessage('DevPilot: AI did not return a complete file. Nothing was changed.'); return; }
  if (await confirmAndApply(file, transformed, kind)) await scanAndReplaceFile(file);
}

async function reviewFile(kind: 'review' | 'security' | 'quality') {
  const file = activeFilePath();
  if (!file) { vscode.window.showWarningMessage('DevPilot: Open a file first.'); return; }
  const lang = detectLanguage(file);
  if (!lang) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const req = kind === 'review'
    ? buildCodeReviewPrompt({ language: lang.id, fileName: path.basename(file), fileContent: doc.getText() })
    : kind === 'quality'
    ? buildCodeQualityPrompt({ language: lang.id, fileName: path.basename(file), fileContent: doc.getText() })
    : buildSecurityReviewPrompt({ language: lang.id, fileName: path.basename(file), fileContent: doc.getText() });
  const text = await callAIOrWarn(req);
  if (text) {
    await showMarkdown(kind === 'review' ? 'DevPilot code review' : kind === 'quality' ? 'DevPilot code quality review' : 'DevPilot security review', text);
  } else {
    // Previously this silently did nothing when no AI provider was configured
    // (provider "none" returns null without a warning) — that looked like a
    // broken click. Say so, and point at the fix. (Missing-key already warns
    // inside getAIConfig, so only warn here for the "none" case.)
    const provider = vscode.workspace.getConfiguration('devpilot.ai').get<string>('provider', 'none');
    if (provider === 'none') vscode.window.showWarningMessage('DevPilot: AI review needs an AI provider. Run "DevPilot: Configure AI Provider" and add an API key first.');
  }
}

// ---------------------------------------------------------------- AI config

async function configureAI() {
  const selected = await vscode.window.showQuickPick(['openai', 'gemini', 'claude', 'groq', 'none'], { placeHolder: 'Select AI provider (none = static analysis only)' });
  if (!selected) return;
  const aiConfig = vscode.workspace.getConfiguration('devpilot.ai');
  if (selected === 'none') {
    await aiConfig.update('provider', 'none', vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('DevPilot: AI disabled. Static analysis remains available.');
    return;
  }
  const key = await vscode.window.showInputBox({
    prompt: `Enter your ${selected} API key (stored securely in VS Code Secret Storage, never in settings or files)`,
    password: true, ignoreFocusOut: true,
    validateInput: (v) => v.trim() ? null : 'API key cannot be empty.',
  });
  if (!key) return;
  await extensionContext.secrets.store(`devpilot.apiKey.${selected}`, key.trim());
  const defaults: Record<string, string> = { openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash', claude: 'claude-sonnet-4-5', groq: 'llama-3.3-70b-versatile' };
  const model = await vscode.window.showInputBox({ prompt: 'Model name', value: defaults[selected], ignoreFocusOut: true });
  await aiConfig.update('provider', selected, vscode.ConfigurationTarget.Global);
  if (model) await aiConfig.update('model', model.trim(), vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`DevPilot: ${selected} configured (key stored securely).`);
}

async function clearAIKey() {
  const selected = await vscode.window.showQuickPick(['openai', 'gemini', 'claude', 'groq'], { placeHolder: 'Which provider key should be removed?' });
  if (!selected) return;
  await extensionContext.secrets.delete(`devpilot.apiKey.${selected}`);
  vscode.window.showInformationMessage(`DevPilot: Stored API key for ${selected} removed.`);
}
