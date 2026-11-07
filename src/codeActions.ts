import * as vscode from 'vscode';
import { DevIssue } from './types';

export interface IssueStore {
  getIssues(): DevIssue[];
  setIssues(issues: DevIssue[]): void;
}

/**
 * Provides QuickFix actions on each DevPilot issue:
 *   - Fix this  (inline edit of the affected snippet only)
 *   - Fix all   (inline edit of every DevPilot issue in the file)
 *   - Explain with AI (result cached and shown as a disabled info action)
 *
 * Registered for ALL languages (selector is just `{ scheme: 'file' }`).
 * The issue store only contains issues for the currently scanned languages,
 * so this provider naturally no-ops for files with no issues.
 */
export class DevPilotCodeActionProvider implements vscode.CodeActionProvider {
  private explainCache = new Map<string, string>();

  constructor(private store: IssueStore) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const fileIssues = this.store
      .getIssues()
      .filter(i => i.file === document.uri.fsPath)
      .filter(i => {
        const r = new vscode.Range(i.line, i.column, i.endLine, i.endColumn);
        return r.intersection(range) !== undefined || r.contains(range.start);
      });

    if (!fileIssues.length) return [];

    const actions: vscode.CodeAction[] = [];

    // --- Fix this (one per issue under the cursor) ---
    for (const issue of fileIssues) {
      const fix = new vscode.CodeAction(
        `$(wrench) DevPilot: Fix this — ${issue.message}`,
        vscode.CodeActionKind.QuickFix
      );
      fix.command = {
        command: 'devpilot.inlineFixOne',
        title: 'Fix this',
        arguments: [issue],
      };
      actions.push(fix);
    }

    // --- Fix all (once per file) ---
    const fixAll = new vscode.CodeAction(
      `$(wand) DevPilot: Fix all (${fileIssues.length}) issues in this file`,
      vscode.CodeActionKind.QuickFix
    );
    fixAll.command = {
      command: 'devpilot.inlineFixAll',
      title: 'Fix all',
      arguments: [document.uri.fsPath],
    };
    actions.push(fixAll);

    // --- Explain (cached or button) ---
    for (const issue of fileIssues) {
      const cached = this.explainCache.get(issue.id);
      if (cached) {
        const act = new vscode.CodeAction(
          `$(info) ${cached.split('\n')[0]}`,
          vscode.CodeActionKind.QuickFix
        );
        act.disabled = { reason: 'AI explanation (cached)' };
        actions.push(act);
      } else {
        const act = new vscode.CodeAction(
          `$(info) DevPilot: Explain with AI — ${issue.message}`,
          vscode.CodeActionKind.QuickFix
        );
        act.command = {
          command: 'devpilot.explainInline',
          title: 'Explain',
          arguments: [issue],
        };
        actions.push(act);
      }
    }

    return actions;
  }

  setExplanation(id: string, text: string) {
    this.explainCache.set(id, text);
  }
}