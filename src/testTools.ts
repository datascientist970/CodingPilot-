import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Testing-tool registry for DevPilot.
 *
 * The user ticks tools in Settings (`devpilot.test.enabledTools`) or via
 * "DevPilot: Configure Test Tools" (a multi-select QuickPick). When
 * "DevPilot: Run Tests" runs, every ticked tool is auto-run.
 *
 * Honesty rule: a tool is only reported as run when its command actually
 * ran. Tools with no local CLI (SaaS test-management / AI tools) are
 * reported as "external" with a clear next step instead of a fake pass,
 * and tools that need a project-specific command (e.g. Selenium) run the
 * user's custom command from `devpilot.test.customCommands` if one is set.
 */
export type TestToolCategory = 'web' | 'api' | 'mobile' | 'ai' | 'performance' | 'management';

export interface TestTool {
  id: string;
  displayName: string;
  category: TestToolCategory;
  description: string;
  /** False for SaaS / IDE tools that cannot be run from this extension. */
  runnable: boolean;
  /** Human-readable setup hint shown when the tool is not detected. */
  hint: string;
}

export const TEST_TOOLS: TestTool[] = [
  { id: 'playwright', displayName: 'Playwright', category: 'web', runnable: true, description: 'Web automation (E2E) tests', hint: 'Add playwright.config.ts/js and install @playwright/test, then run: npx playwright test' },
  { id: 'selenium', displayName: 'Selenium', category: 'web', runnable: true, description: 'Browser automation via your test framework', hint: 'Selenium has no single CLI. Set devpilot.test.customCommands.selenium, e.g. "python -m pytest tests/test_selenium.py" or "npm test -- selenium".' },
  { id: 'cypress', displayName: 'Cypress', category: 'web', runnable: true, description: 'Web E2E tests in the browser', hint: 'Add cypress.config.ts/js and install cypress, then run: npx cypress run' },
  { id: 'postman', displayName: 'Postman', category: 'api', runnable: true, description: 'API collections run with Newman', hint: 'Export a *.postman_collection.json into the workspace and install newman (npm i -g newman).' },
  { id: 'bruno', displayName: 'Bruno', category: 'api', runnable: true, description: 'API collections in .bru files', hint: 'Put .bru files in a folder (e.g. api/) — DevPilot runs: npx @usebruno/cli run <folder>.' },
  { id: 'insomnia', displayName: 'Insomnia', category: 'api', runnable: true, description: 'API tests via the inso CLI', hint: 'Set devpilot.test.customCommands.insomnia, e.g. "inso run test <spec-id>", or export an Insomnia collection first.' },
  { id: 'restassured', displayName: 'RestAssured', category: 'api', runnable: true, description: 'Java API tests (JUnit + RestAssured)', hint: 'Add rest-assured to pom.xml / build.gradle; DevPilot runs mvn test or ./gradlew test.' },
  { id: 'appium', displayName: 'Appium', category: 'mobile', runnable: true, description: 'Mobile app automation via your framework', hint: 'Appium tests run through WebdriverIO / pytest-appium etc. Set devpilot.test.customCommands.appium to that command.' },
  { id: 'maestro', displayName: 'Maestro', category: 'mobile', runnable: true, description: 'Mobile flows in YAML', hint: 'Put Maestro flow YAML files in a flows/ folder and install the maestro CLI.' },
  { id: 'testim', displayName: 'Testim', category: 'ai', runnable: false, description: 'AI-powered web testing (SaaS)', hint: 'Testim runs from its dashboard / CLI with a Testim token and project — it cannot be auto-run from here without those credentials.' },
  { id: 'mabl', displayName: 'Mabl', category: 'ai', runnable: false, description: 'AI-powered testing (SaaS)', hint: 'Mabl runs from its dashboard / mabl CLI with a workspace and API key — set a custom command if you have mabl CLI configured.' },
  { id: 'copilot', displayName: 'GitHub Copilot', category: 'ai', runnable: false, description: 'AI assistant, not a test runner', hint: 'Copilot does not run tests. Use DevPilot "Generate Tests" to create tests, then run them with a real runner.' },
  { id: 'jmeter', displayName: 'Apache JMeter', category: 'performance', runnable: true, description: 'Load / performance tests from .jmx plans', hint: 'Put a .jmx test plan in the workspace and install the jmeter CLI.' },
  { id: 'k6', displayName: 'K6', category: 'performance', runnable: true, description: 'Load tests in JavaScript', hint: 'Write a k6 script (import http from \'k6/http\') and install the k6 CLI.' },
  { id: 'jira', displayName: 'Jira', category: 'management', runnable: false, description: 'Bug tracking — receives results, does not run tests', hint: 'Jira does not run tests. Set a custom command to post results (e.g. a script using the Jira API) if you want reporting.' },
  { id: 'testrail', displayName: 'TestRail', category: 'management', runnable: false, description: 'Test management — receives results, does not run tests', hint: 'TestRail does not run tests. Set a custom command to upload results (e.g. via the TestRail API) if you want reporting.' },
  { id: 'xray', displayName: 'Xray', category: 'management', runnable: false, description: 'Test management for Jira — imports results', hint: 'Xray imports JUnit XML results into Jira. Set a custom command to upload the XML if you want reporting.' },
  { id: 'zephyr', displayName: 'Zephyr', category: 'management', runnable: false, description: 'Test management for Jira — receives results', hint: 'Zephyr does not run tests. Set a custom command to report results via its API if you want reporting.' },
];

export function getTestTool(id: string): TestTool | undefined {
  return TEST_TOOLS.find((t) => t.id === id);
}

export const TEST_TOOL_CATEGORIES: Record<TestToolCategory, string> = {
  web: 'Web Automation Tools',
  api: 'API Testing Tools',
  mobile: 'Mobile App Testing Tools',
  ai: 'AI-Powered Testing Tools',
  performance: 'Performance & Load Testing Tools',
  management: 'Test Management & Bug Tracking Tools',
};

// --------------------------------------------------------------- detection

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', 'target', '.idea', '.vscode']);

function readPackageJson(root: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>; }
  catch { return {}; }
}

function hasDep(pkg: Record<string, unknown>, name: string): boolean {
  for (const key of ['dependencies', 'devDependencies']) {
    const deps = pkg[key];
    if (deps && typeof deps === 'object' && name in (deps as Record<string, unknown>)) return true;
  }
  return false;
}

function fileExists(root: string, rel: string): boolean {
  try { return fs.existsSync(path.join(root, rel)); } catch { return false; }
}

function anyFile(root: string, rels: string[]): boolean {
  return rels.some((r) => fileExists(root, r));
}

/** Depth-limited search for a file matching a predicate. Returns the first match. */
function findFile(root: string, predicate: (rel: string, content: string) => boolean, maxDepth = 3): string | null {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile()) {
        const rel = path.relative(root, full);
        let content = '';
        try { content = fs.readFileSync(full, 'utf8').slice(0, 4000); } catch { /* binary */ }
        if (predicate(rel, content)) return full;
      }
    }
  }
  return null;
}

export interface ToolDetection { found: boolean; detail: string; target?: string }

export function detectTool(root: string, toolId: string): ToolDetection {
  const pkg = readPackageJson(root);
  switch (toolId) {
    case 'playwright': {
      const found = anyFile(root, ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs']) || hasDep(pkg, '@playwright/test');
      return { found, detail: found ? 'Playwright config / dependency found.' : 'No playwright.config.* and no @playwright/test dependency.' };
    }
    case 'selenium': {
      const found = hasDep(pkg, 'selenium-webdriver') || findFile(root, (rel, c) => /\.py$/.test(rel) && c.includes('selenium')) !== null;
      return { found, detail: found ? 'Selenium usage found.' : 'No selenium-webdriver dependency or Selenium test file found.' };
    }
    case 'cypress': {
      const found = anyFile(root, ['cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs']) || hasDep(pkg, 'cypress');
      return { found, detail: found ? 'Cypress config / dependency found.' : 'No cypress.config.* and no cypress dependency.' };
    }
    case 'postman': {
      const target = findFile(root, (rel) => rel.endsWith('.postman_collection.json'));
      return { found: !!target, detail: target ? `Collection found: ${path.relative(root, target)}` : 'No *.postman_collection.json in the workspace.', target: target ?? undefined };
    }
    case 'bruno': {
      const target = findFile(root, (rel) => rel.endsWith('.bru'));
      return { found: !!target, detail: target ? `Bruno file found: ${path.relative(root, target)}` : 'No .bru files in the workspace.', target: target ? path.dirname(target) : undefined };
    }
    case 'insomnia': {
      const found = anyFile(root, ['insomnia.yaml', 'insomnia.yml', '.insomnia']) || findFile(root, (rel) => rel.includes('insomnia')) !== null;
      return { found, detail: found ? 'Insomnia workspace/config found.' : 'No Insomnia config found.' };
    }
    case 'restassured': {
      const pom = fileExists(root, 'pom.xml') ? fs.readFileSync(path.join(root, 'pom.xml'), 'utf8') : '';
      const gradle = findFile(root, (rel) => /build\.gradle(\.kts)?$/.test(rel));
      const gradleText = gradle ? fs.readFileSync(gradle, 'utf8') : '';
      const found = pom.includes('rest-assured') || gradleText.includes('rest-assured');
      return { found, detail: found ? 'RestAssured dependency found.' : 'No rest-assured dependency in pom.xml / build.gradle.' };
    }
    case 'appium': {
      const found = hasDep(pkg, 'appium') || hasDep(pkg, 'webdriverio') || findFile(root, (rel, c) => c.includes('appium')) !== null;
      return { found, detail: found ? 'Appium usage found.' : 'No Appium dependency or config found.' };
    }
    case 'maestro': {
      const target = findFile(root, (rel) => /(^|\/)flows\/[^/]+\.ya?ml$/.test(rel) || /\.maestro\//.test(rel));
      return { found: !!target, detail: target ? `Maestro flow found: ${path.relative(root, target)}` : 'No Maestro flows/ folder found.', target: target ? path.dirname(target) : undefined };
    }
    case 'jmeter': {
      const target = findFile(root, (rel) => rel.endsWith('.jmx'));
      return { found: !!target, detail: target ? `Test plan found: ${path.relative(root, target)}` : 'No .jmx test plan in the workspace.', target: target ?? undefined };
    }
    case 'k6': {
      const target = findFile(root, (rel, c) => /\.js$/.test(rel) && (c.includes("from 'k6'") || c.includes('from "k6"') || c.includes("k6/http")));
      return { found: !!target, detail: target ? `k6 script found: ${path.relative(root, target)}` : 'No k6 script found.', target: target ?? undefined };
    }
    default:
      return { found: false, detail: 'This tool has no local project detection — it is external / management tooling.' };
  }
}

function defaultCommand(toolId: string, detection: ToolDetection, root: string): string[] | null {
  switch (toolId) {
    case 'playwright': return ['npx', 'playwright', 'test'];
    case 'cypress': return ['npx', 'cypress', 'run'];
    case 'postman': return detection.target ? ['npx', 'newman', 'run', detection.target] : null;
    case 'bruno': return detection.target ? ['npx', '@usebruno/cli', 'run', detection.target] : null;
    case 'restassured': return fileExists(root, 'pom.xml') ? ['mvn', '-q', 'test'] : ['sh', './gradlew', 'test'];
    case 'maestro': return detection.target ? ['maestro', 'test', detection.target] : null;
    case 'jmeter': return detection.target ? ['jmeter', '-n', '-t', detection.target, '-l', path.join(os.tmpdir(), 'devpilot-jmeter-results.jtl')] : null;
    case 'k6': return detection.target ? ['k6', 'run', detection.target] : null;
    default: return null;
  }
}

// --------------------------------------------------------------- running

export interface ToolRunResult {
  toolId: string;
  displayName: string;
  status: 'passed' | 'failed' | 'skipped' | 'external';
  command?: string;
  output: string;
}

function runCommandArray(cmd: string[], cwd: string, timeoutMs = 180000): Promise<{ ok: boolean; output: string; notFound: boolean }> {
  return new Promise((resolve) => {
    const child = cp.execFile(cmd[0], cmd.slice(1), { cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      const output = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
      const notFound = !!err && ((err as NodeJS.ErrnoException).code === 'ENOENT' || /command not found|Cannot find (module|package)/i.test(output));
      resolve({ ok: !err, output, notFound });
    });
    child.on('error', (err) => resolve({ ok: false, output: String(err), notFound: (err as NodeJS.ErrnoException).code === 'ENOENT' }));
  });
}

function runShellCommand(command: string, cwd: string, timeoutMs = 180000): Promise<{ ok: boolean; output: string; notFound: boolean }> {
  return new Promise((resolve) => {
    cp.exec(command, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      const output = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
      resolve({ ok: !err, output, notFound: /command not found|Cannot find (module|package)/i.test(output) });
    });
  });
}

/**
 * Run every ticked tool, in the order the user ticked them.
 * A tool that is not installed, not detected, or external is reported as
 * skipped/external — never as a fake pass or fail.
 */
export async function runEnabledTools(
  root: string,
  enabledIds: string[],
  customCommands: Record<string, string>,
): Promise<ToolRunResult[]> {
  const results: ToolRunResult[] = [];
  for (const id of enabledIds) {
    const tool = getTestTool(id);
    if (!tool) { results.push({ toolId: id, displayName: id, status: 'skipped', output: `Unknown testing tool "${id}".` }); continue; }
    const custom = (customCommands[id] ?? '').trim();
    if (custom) {
      const r = await runShellCommand(custom, root);
      results.push({ toolId: id, displayName: tool.displayName, status: r.ok ? 'passed' : 'failed', command: custom, output: r.output.slice(0, 4000) || '(no output)' });
      continue;
    }
    if (!tool.runnable) {
      results.push({ toolId: id, displayName: tool.displayName, status: 'external', output: tool.hint });
      continue;
    }
    const detection = detectTool(root, id);
    if (!detection.found) {
      results.push({ toolId: id, displayName: tool.displayName, status: 'skipped', output: `${detection.detail} ${tool.hint}` });
      continue;
    }
    const cmd = defaultCommand(id, detection, root);
    if (!cmd) {
      results.push({ toolId: id, displayName: tool.displayName, status: 'skipped', output: tool.hint });
      continue;
    }
    const r = await runCommandArray(cmd, root);
    if (r.notFound) {
      results.push({ toolId: id, displayName: tool.displayName, status: 'skipped', command: cmd.join(' '), output: `Command not found: ${cmd[0]}. ${tool.hint}` });
    } else if (!r.ok && /No tests found|No specs found/i.test(r.output)) {
      results.push({ toolId: id, displayName: tool.displayName, status: 'skipped', command: cmd.join(' '), output: `${r.output.slice(0, 500)} — no tests found for this tool yet.` });
    } else {
      results.push({ toolId: id, displayName: tool.displayName, status: r.ok ? 'passed' : 'failed', command: cmd.join(' '), output: r.output.slice(0, 4000) || '(no output)' });
    }
  }
  return results;
}
