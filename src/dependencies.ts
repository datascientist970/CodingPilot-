import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LanguageConfig } from './languages';
import { runTool } from './externalTools';

export type DependencyKind = 'header' | 'import' | 'package';
export type DependencyStatus = 'ok' | 'missing' | 'unknown';

export interface ParsedDependency {
  name: string;
  kind: DependencyKind;
  /** True for #include "..." / relative imports — a project file, not a system package. */
  local: boolean;
  line: number;
  column: number;
}

export interface DependencyInfo extends ParsedDependency {
  status: DependencyStatus;
  /** The package to install (pip / npm / system package name), when known. */
  packageName?: string;
  /** A runnable install command for this machine, when one exists. */
  installCommand?: string;
  /** Official download / docs page, when no command exists or as a fallback. */
  link?: string;
  hint: string;
}

export interface KnownDependency {
  packageName: string;
  apt?: string;
  brew?: string;
  vcpkg?: string;
  choco?: string;
  pip?: string;
  npm?: string;
  link: string;
}

/**
 * Known third-party headers / modules / packages and how to get them.
 * System headers (stdio.h, vector, ...) and Python stdlib are NOT here —
 * they are treated as "ok" and never offered for install.
 */
export const KNOWN_DEPENDENCIES: Record<string, KnownDependency> = {
  // C / C++ headers
  'curl/curl.h': { packageName: 'libcurl', apt: 'libcurl4-openssl-dev', brew: 'curl', vcpkg: 'curl', link: 'https://curl.se/libcurl/' },
  'openssl/ssl.h': { packageName: 'libssl', apt: 'libssl-dev', brew: 'openssl', vcpkg: 'openssl', link: 'https://www.openssl.org/' },
  'openssl/crypto.h': { packageName: 'libssl', apt: 'libssl-dev', brew: 'openssl', vcpkg: 'openssl', link: 'https://www.openssl.org/' },
  'sqlite3.h': { packageName: 'sqlite3', apt: 'libsqlite3-dev', brew: 'sqlite', vcpkg: 'sqlite3', link: 'https://www.sqlite.org/' },
  'zlib.h': { packageName: 'zlib', apt: 'zlib1g-dev', brew: 'zlib', vcpkg: 'zlib', link: 'https://www.zlib.net/' },
  'png.h': { packageName: 'libpng', apt: 'libpng-dev', brew: 'libpng', vcpkg: 'libpng', link: 'http://www.libpng.org/' },
  'nlohmann/json.hpp': { packageName: 'nlohmann-json', apt: 'nlohmann-json3-dev', brew: 'nlohmann-json', vcpkg: 'nlohmann-json', link: 'https://github.com/nlohmann/json' },
  'gtest/gtest.h': { packageName: 'googletest', apt: 'libgtest-dev', brew: 'googletest', vcpkg: 'gtest', link: 'https://github.com/google/googletest' },
  'gmock/gmock.h': { packageName: 'googletest', apt: 'libgtest-dev', brew: 'googletest', vcpkg: 'gtest', link: 'https://github.com/google/googletest' },
  'fmt/format.h': { packageName: 'fmt', apt: 'libfmt-dev', brew: 'fmt', vcpkg: 'fmt', link: 'https://fmt.dev/' },
  'spdlog/spdlog.h': { packageName: 'spdlog', apt: 'libspdlog-dev', brew: 'spdlog', vcpkg: 'spdlog', link: 'https://github.com/gabime/spdlog' },
  'SDL2/SDL.h': { packageName: 'sdl2', apt: 'libsdl2-dev', brew: 'sdl2', vcpkg: 'sdl2', link: 'https://www.libsdl.org/' },
  'GLFW/glfw3.h': { packageName: 'glfw', apt: 'libglfw3-dev', brew: 'glfw', vcpkg: 'glfw', link: 'https://www.glfw.org/' },
  // Python modules (module -> pip package)
  'pytest': { packageName: 'pytest', pip: 'pytest', link: 'https://docs.pytest.org/' },
  'requests': { packageName: 'requests', pip: 'requests', link: 'https://requests.readthedocs.io/' },
  'numpy': { packageName: 'numpy', pip: 'numpy', link: 'https://numpy.org/' },
  'pandas': { packageName: 'pandas', pip: 'pandas', link: 'https://pandas.pydata.org/' },
  'flask': { packageName: 'flask', pip: 'flask', link: 'https://flask.palletsprojects.com/' },
  'django': { packageName: 'django', pip: 'django', link: 'https://www.djangoproject.com/' },
  'fastapi': { packageName: 'fastapi', pip: 'fastapi', link: 'https://fastapi.tiangolo.com/' },
  'PIL': { packageName: 'Pillow', pip: 'Pillow', link: 'https://pillow.readthedocs.io/' },
  'cv2': { packageName: 'opencv-python', pip: 'opencv-python', link: 'https://opencv.org/' },
  'sklearn': { packageName: 'scikit-learn', pip: 'scikit-learn', link: 'https://scikit-learn.org/' },
  'bs4': { packageName: 'beautifulsoup4', pip: 'beautifulsoup4', link: 'https://www.crummy.com/software/BeautifulSoup/' },
  'yaml': { packageName: 'PyYAML', pip: 'PyYAML', link: 'https://pyyaml.org/' },
  'dotenv': { packageName: 'python-dotenv', pip: 'python-dotenv', link: 'https://github.com/theskumar/python-dotenv' },
  'sqlalchemy': { packageName: 'SQLAlchemy', pip: 'SQLAlchemy', link: 'https://www.sqlalchemy.org/' },
  'selenium': { packageName: 'selenium', pip: 'selenium', link: 'https://www.selenium.dev/' },
  'playwright': { packageName: 'playwright', pip: 'playwright', link: 'https://playwright.dev/python/' },
  // JavaScript / TypeScript packages (package name == import name)
  'react': { packageName: 'react', npm: 'react', link: 'https://react.dev/' },
  'express': { packageName: 'express', npm: 'express', link: 'https://expressjs.com/' },
  'lodash': { packageName: 'lodash', npm: 'lodash', link: 'https://lodash.com/' },
  'axios': { packageName: 'axios', npm: 'axios', link: 'https://axios-http.com/' },
  'jest': { packageName: 'jest', npm: 'jest', link: 'https://jestjs.io/' },
  'vitest': { packageName: 'vitest', npm: 'vitest', link: 'https://vitest.dev/' },
  '@playwright/test': { packageName: '@playwright/test', npm: '@playwright/test', link: 'https://playwright.dev/' },
  'cypress': { packageName: 'cypress', npm: 'cypress', link: 'https://www.cypress.io/' },
  'typescript': { packageName: 'typescript', npm: 'typescript', link: 'https://www.typescriptlang.org/' },
};

const SYSTEM_HEADERS = new Set([
  'stdio.h', 'stdlib.h', 'string.h', 'math.h', 'ctype.h', 'time.h', 'stdbool.h',
  'stdint.h', 'stddef.h', 'limits.h', 'float.h', 'assert.h', 'errno.h', 'signal.h',
  'unistd.h', 'fcntl.h', 'sys/types.h', 'sys/stat.h', 'sys/socket.h', 'netinet/in.h',
  'arpa/inet.h', 'pthread.h', 'windows.h', 'winsock2.h',
  // C++ standard headers (no .h)
  'iostream', 'vector', 'string', 'map', 'unordered_map', 'set', 'unordered_set',
  'algorithm', 'memory', 'functional', 'numeric', 'iterator', 'fstream', 'sstream',
  'queue', 'stack', 'list', 'deque', 'array', 'tuple', 'optional', 'variant',
  'thread', 'mutex', 'future', 'chrono', 'random', 'exception', 'stdexcept',
  'cstdint', 'cstddef', 'cstring', 'cmath', 'cstdlib', 'cstdio',
]);

const PYTHON_STDLIB = new Set([
  'sys', 'os', 'json', 're', 'math', 'random', 'datetime', 'time', 'collections',
  'itertools', 'functools', 'pathlib', 'typing', 'dataclasses', 'enum', 'abc',
  'io', 'csv', 'sqlite3', 'urllib', 'http', 'socket', 'threading', 'multiprocessing',
  'subprocess', 'argparse', 'logging', 'unittest', 'copy', 'pickle', 'hashlib',
  'statistics', 'decimal', 'fractions', 'array', 'struct', 'string', 'textwrap',
  'operator', 'contextlib', 'warnings', 'traceback', 'inspect', 'importlib',
  'pkgutil', 'shutil', 'glob', 'tempfile', 'zipfile', 'tarfile', 'base64',
  'secrets', 'uuid', 'email', 'html', 'xml', 'concurrent', 'asyncio', 'queue',
  'heapq', 'bisect', 'weakref', 'gc', 'platform', 'getpass', 'configparser',
]);

export function isSystemDependency(name: string, lang: LanguageConfig): boolean {
  if (lang.id === 'c' || lang.id === 'cpp') return SYSTEM_HEADERS.has(name) || name.startsWith('sys/') || name.startsWith('bits/');
  if (lang.id === 'python') return PYTHON_STDLIB.has(name.split('.')[0]);
  return false;
}

/** Parse #include / import / require from a file's text (pure, testable). */
export function parseDependencies(text: string, lang: LanguageConfig): ParsedDependency[] {
  const out: ParsedDependency[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: DependencyKind, local: boolean, line: number, column: number) => {
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, kind, local, line, column });
  };
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (lang.id === 'c' || lang.id === 'cpp') {
      if ((m = line.match(/^#\s*include\s*<([^>]+)>/))) push(m[1], 'header', false, idx, raw.indexOf(m[1]));
      else if ((m = line.match(/^#\s*include\s*"([^"]+)"/))) push(m[1], 'header', true, idx, raw.indexOf(m[1]));
      return;
    }
    if (lang.id === 'python') {
      if ((m = line.match(/^import\s+([A-Za-z_][\w.]*)/))) push(m[1].split('.')[0], 'import', false, idx, raw.indexOf(m[1]));
      else if ((m = line.match(/^from\s+([A-Za-z_][\w.]*)\s+import\b/))) {
        if (!m[1].startsWith('.')) push(m[1].split('.')[0], 'import', false, idx, raw.indexOf(m[1]));
      }
      return;
    }
    if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(lang.id)) {
      if ((m = line.match(/^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/))) {
        const pkg = m[1];
        if (!pkg.startsWith('.') && !pkg.startsWith('/')) push(pkg, 'package', false, idx, raw.indexOf(pkg));
      } else if ((m = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/))) {
        const pkg = m[1];
        if (!pkg.startsWith('.') && !pkg.startsWith('/')) push(pkg, 'package', false, idx, raw.indexOf(pkg));
      }
    }
  });
  return out;
}

/** Quoted / local headers that are not found (pure — caller supplies the existence check). */
export function findMissingLocalDependencies(
  deps: ParsedDependency[],
  exists: (name: string) => boolean,
): ParsedDependency[] {
  return deps.filter((d) => d.local && !exists(d.name));
}

/** Install command for a known dependency on this OS, or undefined when there is none. */
export function installCommandFor(known: KnownDependency, platform: string, pythonPath: string): string | undefined {
  if (known.pip) return `${pythonPath} -m pip install ${known.pip}`;
  if (known.npm) return `npm install ${known.npm}`;
  if (platform === 'win32') return known.vcpkg ? `vcpkg install ${known.vcpkg}` : known.choco ? `choco install ${known.choco}` : undefined;
  if (platform === 'darwin') return known.brew ? `brew install ${known.brew}` : undefined;
  return known.apt ? `sudo apt install ${known.apt}` : undefined;
}

/** Build the full info (command + link + hint) for one parsed dependency. */
export function dependencyInfo(dep: ParsedDependency, lang: LanguageConfig, pythonPath: string, platform = process.platform): DependencyInfo {
  const known = KNOWN_DEPENDENCIES[dep.name];
  if (dep.local) {
    return { ...dep, status: 'unknown', hint: `Local file "${dep.name}" — create it in the project or fix the include path.` };
  }
  if (isSystemDependency(dep.name, lang)) {
    return { ...dep, status: 'ok', hint: 'System / standard library — no install needed.' };
  }
  if (known) {
    const cmd = installCommandFor(known, platform, pythonPath);
    return {
      ...dep, status: 'unknown', packageName: known.packageName,
      installCommand: cmd, link: known.link,
      hint: cmd ? `Install with: ${cmd}` : `No one-click install on this OS — download from: ${known.link}`,
    };
  }
  return {
    ...dep, status: 'unknown',
    hint: `Unknown third-party dependency "${dep.name}" — search for its official download page if it is missing.`,
  };
}

/** Check whether a dependency is actually present (async — runs the real tool, when available). */
export async function checkDependencyPresent(
  dep: ParsedDependency,
  lang: LanguageConfig,
  workspaceFolder: string | undefined,
  pythonPath: string,
): Promise<DependencyStatus> {
  if (dep.local) return 'unknown';
  if (isSystemDependency(dep.name, lang)) return 'ok';
  try {
    if (lang.id === 'python') {
      const out = await runTool(pythonPath, ['-c', `import ${dep.name}`], workspaceFolder ?? process.cwd(), 15000);
      // "import x" failing for a missing module prints ModuleNotFoundError; any other
      // error (e.g. the module exists but its own code fails) still means it is present.
      if (out.ok) return 'ok';
      if (/ModuleNotFoundError|No module named/.test(out.stderr)) return 'missing';
      return 'ok';
    }
    if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(lang.id)) {
      if (!workspaceFolder) return 'unknown';
      const pkgDir = path.join(workspaceFolder, 'node_modules', ...dep.name.split('/'));
      return fs.existsSync(path.join(pkgDir, 'package.json')) ? 'ok' : 'missing';
    }
    if (lang.id === 'c' || lang.id === 'cpp') {
      const known = KNOWN_DEPENDENCIES[dep.name];
      if (!known) return 'unknown';
      // Try the compiler: a snippet including the header either compiles or reports
      // "fatal error: <header>: No such file or directory".
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devpilot-dep-')), 'check.cpp');
      try {
        fs.writeFileSync(tmp, `#include <${dep.name}>\nint main(){return 0;}\n`);
        const out = await runTool('g++', ['-fsyntax-only', tmp], workspaceFolder ?? process.cwd(), 20000);
        if (out.ok) return 'ok';
        if (/No such file or directory/.test(out.stderr)) return 'missing';
        return 'unknown';
      } finally {
        try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  } catch { return 'unknown'; }
  return 'unknown';
}
