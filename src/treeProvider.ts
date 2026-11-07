import * as vscode from 'vscode';
import * as path from 'path';
import { DevIssue } from './types';

export class IssueItem extends vscode.TreeItem {
  constructor(public readonly issue: DevIssue) {
    super(issue.message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'devpilot.issue';
    this.description = `${path.basename(issue.file)}:${issue.line + 1}`;
    this.tooltip = `${issue.source ?? ''} ${issue.code ?? ''}\n${issue.message}${issue.suggestion ? `\nSuggestion: ${issue.suggestion}` : ''}`;
    this.iconPath = new vscode.ThemeIcon(
      issue.severity === 'error' ? 'error'
      : issue.severity === 'warning' ? 'warning'
      : issue.severity === 'success' ? 'pass'
      : 'info'
    );
    this.command = { command: 'devpilot.showIssue', title: 'Show Issue', arguments: [issue] };
    this.resourceUri = vscode.Uri.file(issue.file);
  }
}

export class ActionItem extends vscode.TreeItem {
  constructor(label: string, icon: string, command: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'devpilot.action';
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command, title: label };
  }
}

export class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly category: DevIssue['category'] | 'health' | 'actions' | 'settings' | 'follow',
    public readonly children: vscode.TreeItem[]
  ) {
    // Empty categories used to get CollapsibleState.None (no arrow, click did
    // nothing) — that looked broken. Collapsed lets the user expand and see
    // the "No issues" note instead of a dead heading.
    super(label, children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.description = children.length ? `${children.length}` : '';
    this.iconPath = new vscode.ThemeIcon(
      category === 'bug' ? 'bug'
      : category === 'naming' ? 'symbol-variable'
      : category === 'type' ? 'symbol-type-parameter'
      : category === 'security' ? 'shield'
      : category === 'test' ? 'beaker'
      : category === 'doc' ? 'book'
      : category === 'quality' ? 'pulse'
      : category === 'health' ? 'heart'
      : category === 'actions' ? 'zap'
      : category === 'follow' ? 'account'
      : 'settings-gear'
    );
  }
}

export class DevPilotProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private issues: DevIssue[] = [];
  private selectedIssue: DevIssue | undefined;
  private lastScanLabel = 'No scan yet';

  setIssues(issues: DevIssue[]) {
    this.issues = issues;
    if (this.selectedIssue) {
      const stillThere = issues.find((i) => i.id === this.selectedIssue!.id);
      if (!stillThere) this.selectedIssue = undefined;
    }
    this._onDidChange.fire();
  }
  getIssues() { return this.issues; }
  setSelectedIssue(issue: DevIssue | undefined) { this.selectedIssue = issue; }
  getSelectedIssue(): DevIssue | undefined { return this.selectedIssue; }
  setLastScanLabel(label: string) { this.lastScanLabel = label; this._onDidChange.fire(); }
  getTreeItem(el: vscode.TreeItem) { return el; }

  getChildren(el?: vscode.TreeItem): vscode.TreeItem[] {
    if (!el) {
      const by = (cat: DevIssue['category']) => this.issues.filter((i) => i.category === cat).map((i) => new IssueItem(i));
      const errors = this.issues.filter((i) => i.severity === 'error').length;
      const warnings = this.issues.filter((i) => i.severity === 'warning').length;
      const files = new Set(this.issues.map((i) => i.file)).size;
      return [
        new CategoryItem('Actions', 'actions', [
          new ActionItem('Scan Project', 'search', 'devpilot.scanProject'),
          new ActionItem('Scan Current File', 'file', 'devpilot.scanCurrentFile'),
          new ActionItem('Fix Selected Issues', 'wrench', 'devpilot.fixSelectedIssues'),
          new ActionItem('Check & Install Missing Dependencies', 'package', 'devpilot.checkDependencies'),
          new ActionItem('Generate Tests', 'beaker', 'devpilot.generateTests'),
          new ActionItem('Generate Documentation', 'book', 'devpilot.generateDocs'),
          new ActionItem('Run Tests', 'play', 'devpilot.runTests'),
          new ActionItem('Configure Test Tools', 'beaker', 'devpilot.configureTestTools'),
          new ActionItem('Configure AI', 'settings-gear', 'devpilot.configureAI'),
        ]),
        new CategoryItem('Project Health', 'health', [
          this.simpleItem(this.lastScanLabel, 'history'),
          this.simpleItem(`Files with issues: ${files}`, 'file'),
          this.simpleItem(`Errors: ${errors}`, 'error'),
          this.simpleItem(`Warnings: ${warnings}`, 'warning'),
          this.simpleItem(`Total issues: ${this.issues.length}`, 'info'),
        ]),
        new CategoryItem('Bugs', 'bug', by('bug')),
        new CategoryItem('Naming Issues', 'naming', by('naming')),
        new CategoryItem('Type Issues', 'type', by('type')),
        new CategoryItem('Security', 'security', by('security')),
        new CategoryItem('Code Quality', 'quality', by('quality')),
        new CategoryItem('Testing', 'test', by('test')),
        new CategoryItem('Documentation', 'doc', by('doc')),
        // Bottom of the panel: follow the author. Clicking opens the profile in a browser.
        new CategoryItem('Follow Me', 'follow', [
          new ActionItem('GitHub — @datascientist970', 'github', 'devpilot.followGithub'),
          new ActionItem('LinkedIn — dawood406', 'link-external', 'devpilot.followLinkedin'),
        ]),
      ];
    }
    const children = (el as CategoryItem).children ?? [];
    if (el instanceof CategoryItem && !children.length) {
      return [this.simpleItem(`No ${el.label.toLowerCase()} issues`, 'check')];
    }
    return children;
  }

  private simpleItem(label: string, icon: string, command?: string) {
    const i = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    i.iconPath = new vscode.ThemeIcon(icon);
    if (command) i.command = { command, title: label };
    return i;
  }
}
