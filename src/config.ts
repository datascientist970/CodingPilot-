import * as vscode from 'vscode';
import { AnalysisOptions, DEFAULT_ANALYSIS_OPTIONS } from './analysis';

export interface DevPilotConfig extends AnalysisOptions {
  pythonPath: string;
  ruffPath: string;
  mypyPath: string;
  enableRuff: boolean;
  enableMypy: boolean;
  enableExternalTools: boolean;
  enableDiagnostics: boolean;
  scanOnSave: boolean;
  scanExclusions: string[];
  pythonOnly: boolean;
  requireConfirmationBeforeFix: boolean;
  validateSyntaxBeforeFix: boolean;
  autoRunTestsAfterFix: boolean;
  testEnabledTools: string[];
  testCustomCommands: Record<string, string>;
  testAutoRunEnabledTools: boolean;
  dependenciesAutoInstall: boolean;
  dependenciesCheckBeforeTests: boolean;
}

/**
 * Reads the canonical settings from package.json, with fallbacks to the
 * legacy key names used by the 0.1.0 build, so existing users keep working.
 */
export function getConfig(): DevPilotConfig {
  const cfg = vscode.workspace.getConfiguration('devpilot');
  const legacy = (newKey: string, oldKey: string, fallback: unknown) => {
    const v = cfg.get<unknown>(newKey);
    if (v !== undefined) return v;
    const old = cfg.get<unknown>(oldKey);
    return old !== undefined ? old : fallback;
  };
  const analysis = cfg.get<AnalysisOptions>('analysis', {} as AnalysisOptions);
  return {
    complexityThreshold: cfg.get<number>('analysis.complexityThreshold', DEFAULT_ANALYSIS_OPTIONS.complexityThreshold),
    longFunctionLines: cfg.get<number>('analysis.longFunctionLines', DEFAULT_ANALYSIS_OPTIONS.longFunctionLines),
    duplicateBlockSize: cfg.get<number>('analysis.duplicateBlockSize', DEFAULT_ANALYSIS_OPTIONS.duplicateBlockSize),
    maxLineLength: cfg.get<number>('analysis.maxLineLength', DEFAULT_ANALYSIS_OPTIONS.maxLineLength),
    enableNaming: cfg.get<boolean>('enable.naming', true),
    enableUnusedVariables: cfg.get<boolean>('enable.unusedVariables', true),
    enableUnusedFunctions: cfg.get<boolean>('enable.unusedFunctions', true),
    enableDuplicate: cfg.get<boolean>('enable.duplicateCode', true),
    enableComplexity: cfg.get<boolean>('enable.complexity', true),
    enableQuality: cfg.get<boolean>('enable.codeQuality', true),
    enableSecurity: cfg.get<boolean>('enable.security', true),
    pythonPath: String(legacy('python.path', 'pythonPath', 'python')),
    ruffPath: String(legacy('ruff.path', 'ruffPath', 'ruff')),
    mypyPath: String(legacy('mypy.path', 'mypyPath', 'mypy')),
    enableRuff: Boolean(legacy('enable.ruff', 'enableRuff', true)),
    enableMypy: Boolean(legacy('enable.mypy', 'enableMypy', true)),
    enableExternalTools: cfg.get<boolean>('enable.externalTools', true),
    enableDiagnostics: Boolean(legacy('diagnostics.enabled', 'enableDiagnostics', true)),
    scanOnSave: Boolean(legacy('scan.onSave', 'scanOnSave', false)),
    scanExclusions: cfg.get<string[]>('scan.exclusions', [
      '**/node_modules/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**',
      '**/dist/**', '**/build/**', '**/.git/**', '**/target/**',
    ]),
    pythonOnly: Boolean(legacy('scan.pythonOnly', 'scanPythonOnly', false)),
    requireConfirmationBeforeFix: Boolean(legacy('fix.requireConfirmation', 'requireConfirmationBeforeFix', true)),
    validateSyntaxBeforeFix: Boolean(legacy('fix.validateSyntax', 'validateSyntaxBeforeFix', true)),
    autoRunTestsAfterFix: cfg.get<boolean>('test.autoRunAfterFix', false),
    testEnabledTools: cfg.get<string[]>('test.enabledTools', []),
    testCustomCommands: cfg.get<Record<string, string>>('test.customCommands', {}),
    testAutoRunEnabledTools: cfg.get<boolean>('test.autoRunEnabledTools', true),
    dependenciesAutoInstall: cfg.get<boolean>('dependencies.autoInstall', false),
    dependenciesCheckBeforeTests: cfg.get<boolean>('dependencies.checkBeforeTests', true),
  };
}
