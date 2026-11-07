import * as path from 'path';

/**
 * Pure (no vscode dependency) language registry.
 * Every language gets the built-in DevPilot analyzers. External tools
 * (Ruff, Mypy, clang-tidy, ESLint, go vet, ...) are optional extras
 * handled in externalTools.ts — if a tool is missing, the built-in
 * analysis still works, so no language is ever "unsupported".
 */
export interface LanguageConfig {
  id: string;
  displayName: string;
  extensions: string[];
  /** Line comment marker, e.g. '#' or '//'. */
  lineComment: string;
  /** Block comment delimiters, if any. */
  blockComment?: [string, string];
  /** Entry-point / framework names that are never "unused". */
  entryFunctions: string[];
  /** Test framework used for generated tests. */
  testFramework: string;
  /** How a generated test file is named from a source file name. */
  testFileName: (base: string) => string;
  /** Doc-comment style: 'docstring' | 'javadoc' | 'go' | 'rustdoc' | 'hash' */
  docStyle: 'docstring' | 'javadoc' | 'go' | 'rustdoc' | 'hash' | 'slash' | 'html' | 'css';
  /** Keywords + builtins that must never be reported as undefined/unused. */
  ignoreIdentifiers: Set<string>;
  /** Words that count as decision points for cyclomatic complexity. */
  decisionWords: string[];
}

const PY_IGNORE = new Set([
  'print', 'def', 'return', 'if', 'else', 'elif', 'for', 'while', 'in', 'not',
  'and', 'or', 'True', 'False', 'None', 'class', 'import', 'from', 'as', 'try',
  'except', 'finally', 'with', 'lambda', 'yield', 'pass', 'break', 'continue',
  'raise', 'global', 'nonlocal', 'assert', 'del', 'is', 'int', 'str', 'float',
  'bool', 'list', 'dict', 'set', 'tuple', 'len', 'range', 'enumerate', 'zip',
  'open', 'super', 'self', 'cls', 'type', 'isinstance', 'abs', 'min', 'max',
  'sum', 'sorted', 'reversed', 'input', 'format', 'round', 'any', 'all',
]);
const JS_IGNORE = new Set([
  'const', 'let', 'var', 'function', 'new', 'this', 'null', 'undefined',
  'true', 'false', 'async', 'await', 'catch', 'throw', 'typeof',
  'instanceof', 'console', 'document', 'window', 'process', 'require',
  'module', 'exports', 'globalThis', 'return', 'if', 'else', 'for', 'while',
  'class', 'import', 'export', 'from', 'as', 'try', 'finally', 'switch',
  'case', 'default', 'break', 'continue', 'do', 'void', 'delete', 'in', 'of',
  'yield', 'static', 'extends', 'super', 'get', 'set', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'Math', 'JSON', 'Promise', 'Error', 'Map',
  'Set', 'Date', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'setTimeout',
  'setInterval', 'clearTimeout', 'fetch', 'alert', 'localStorage',
]);
const C_IGNORE = new Set([
  'int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned',
  'signed', 'const', 'static', 'extern', 'volatile', 'struct', 'union',
  'enum', 'typedef', 'sizeof', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'default', 'break', 'continue', 'goto', 'include',
  'define', 'ifdef', 'endif', 'NULL', 'true', 'false', 'bool', 'printf',
  'fprintf', 'scanf', 'puts', 'malloc', 'free', 'calloc', 'realloc',
  'strlen', 'strcpy', 'strcmp', 'memcpy', 'exit', 'main', 'argc', 'argv',
  'FILE', 'size_t', 'ssize_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'int8_t', 'int16_t', 'int32_t', 'int64_t', 'std', 'cout', 'cin', 'cerr',
  'endl', 'string', 'vector', 'map', 'set', 'list', 'auto', 'namespace',
  'using', 'class', 'public', 'private', 'protected', 'virtual', 'override',
  'template', 'typename', 'new', 'delete', 'this', 'nullptr', 'try', 'catch',
  'throw', 'friend', 'inline', 'mutable', 'constexpr', 'noexcept',
]);
const JAVA_IGNORE = new Set([
  'public', 'private', 'protected', 'static', 'final', 'void', 'class',
  'interface', 'abstract', 'synchronized', 'extends', 'implements',
  'package', 'import', 'new', 'this', 'super', 'null', 'true', 'false',
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws',
  'instanceof', 'int', 'long', 'short', 'byte', 'char', 'float', 'double',
  'boolean', 'String', 'System', 'out', 'println', 'print', 'Math', 'Object',
  'List', 'Map', 'Set', 'ArrayList', 'HashMap', 'Exception', 'RuntimeException',
  'void', 'enum', 'var', 'record', 'sealed', 'permits',
]);
const GO_IGNORE = new Set([
  'func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface',
  'map', 'chan', 'go', 'defer', 'select', 'range', 'return', 'if', 'else',
  'for', 'switch', 'case', 'default', 'break', 'continue', 'fallthrough',
  'goto', 'new', 'make', 'len', 'cap', 'append', 'copy', 'delete', 'panic',
  'recover', 'print', 'println', 'true', 'false', 'nil', 'iota', 'string',
  'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'float32', 'float64',
  'bool', 'byte', 'rune', 'error', 'fmt', 'os', 'strings', 'errors',
]);
const RUST_IGNORE = new Set([
  'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait',
  'pub', 'mod', 'use', 'crate', 'super', 'self', 'Self', 'return', 'if',
  'else', 'for', 'while', 'loop', 'match', 'break', 'continue', 'in', 'as',
  'ref', 'move', 'where', 'type', 'unsafe', 'extern', 'dyn', 'async',
  'await', 'try', 'true', 'false', 'Some', 'None', 'Ok', 'Err', 'Result',
  'Option', 'Vec', 'String', 'Box', 'println', 'print', 'format', 'vec',
  'main', 'i32', 'i64', 'u32', 'u64', 'f32', 'f64', 'bool', 'char', 'usize',
  'isize', 'str', 'assert', 'assert_eq', 'panic', 'todo', 'unimplemented',
]);
const GENERIC_IGNORE = new Set([
  'return', 'if', 'else', 'for', 'while', 'true', 'false', 'null', 'nil',
  'new', 'this', 'self', 'super', 'class', 'def', 'function', 'import',
  'from', 'try', 'catch', 'finally', 'throw', 'break', 'continue', 'print',
]);

function union(...sets: Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

export const LANGUAGES: LanguageConfig[] = [
  {
    id: 'python', displayName: 'Python', extensions: ['.py', '.pyw', '.pyi'],
    lineComment: '#', docStyle: 'docstring', testFramework: 'pytest',
    testFileName: (b) => `test_${b}.py`, entryFunctions: ['main'],
    ignoreIdentifiers: PY_IGNORE, decisionWords: ['if', 'elif', 'for', 'while', 'and', 'or', 'except', 'with', 'assert'],
  },
  {
    id: 'c', displayName: 'C', extensions: ['.c', '.h'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'assert-based C tests',
    testFileName: (b) => `test_${b}.c`, entryFunctions: ['main'],
    ignoreIdentifiers: C_IGNORE, decisionWords: ['if', 'for', 'while', 'case', 'catch'],
  },
  {
    id: 'cpp', displayName: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.C'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'assert-based C++ tests',
    testFileName: (b) => `test_${b}.cpp`, entryFunctions: ['main'],
    ignoreIdentifiers: C_IGNORE, decisionWords: ['if', 'for', 'while', 'case', 'catch'],
  },
  {
    id: 'javascript', displayName: 'JavaScript', extensions: ['.js', '.mjs', '.cjs'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'Jest',
    testFileName: (b) => `${b}.test.js`, entryFunctions: ['main', 'default', 'constructor', 'render'],
    ignoreIdentifiers: JS_IGNORE, decisionWords: ['if', 'for', 'while', 'case', 'catch'],
  },
  {
    id: 'typescript', displayName: 'TypeScript', extensions: ['.ts', '.mts', '.cts'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'Jest / Vitest',
    testFileName: (b) => `${b}.test.ts`, entryFunctions: ['main', 'default', 'constructor', 'render'],
    ignoreIdentifiers: union(JS_IGNORE, new Set(['type', 'interface', 'readonly', 'private', 'public', 'protected', 'namespace', 'declare', 'abstract', 'implements', 'keyof', 'unknown', 'never', 'any', 'string', 'number', 'boolean'])),
    decisionWords: ['if', 'for', 'while', 'case', 'catch'],
  },
  {
    id: 'javascriptreact', displayName: 'JavaScript React', extensions: ['.jsx'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'Jest',
    testFileName: (b) => `${b}.test.jsx`, entryFunctions: ['main', 'default', 'constructor', 'render', 'App'],
    ignoreIdentifiers: JS_IGNORE, decisionWords: ['if', 'for', 'while', 'case', 'catch'],
  },
  {
    id: 'typescriptreact', displayName: 'TypeScript React', extensions: ['.tsx'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'Jest / Vitest',
    testFileName: (b) => `${b}.test.tsx`, entryFunctions: ['main', 'default', 'constructor', 'render', 'App'],
    ignoreIdentifiers: JS_IGNORE, decisionWords: ['if', 'for', 'while', 'case', 'catch'],
  },
  {
    id: 'java', displayName: 'Java', extensions: ['.java'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'JUnit 5',
    testFileName: (b) => `${capitalize(b)}Test.java`, entryFunctions: ['main', 'toString', 'equals', 'hashCode'],
    ignoreIdentifiers: JAVA_IGNORE, decisionWords: ['if', 'for', 'while', 'case', 'catch'],
  },
  {
    id: 'csharp', displayName: 'C#', extensions: ['.cs'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'xUnit / NUnit',
    testFileName: (b) => `${capitalize(b)}Tests.cs`, entryFunctions: ['Main', 'ToString', 'Equals', 'GetHashCode'],
    ignoreIdentifiers: union(JAVA_IGNORE, new Set(['var', 'using', 'namespace', 'string', 'bool', 'decimal', 'foreach', 'in', 'is', 'as', 'await', 'async', 'get', 'set', 'add', 'remove', 'event', 'delegate', 'where', 'select', 'from', 'Console', 'WriteLine'])),
    decisionWords: ['if', 'for', 'foreach', 'while', 'case', 'catch'],
  },
  {
    id: 'go', displayName: 'Go', extensions: ['.go'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'go', testFramework: 'go test',
    testFileName: (b) => `${b}_test.go`, entryFunctions: ['main', 'init', 'String'],
    ignoreIdentifiers: GO_IGNORE, decisionWords: ['if', 'for', 'case', 'select'],
  },
  {
    id: 'rust', displayName: 'Rust', extensions: ['.rs'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'rustdoc', testFramework: 'cargo test',
    testFileName: (b) => `${b}_tests.rs`, entryFunctions: ['main'],
    ignoreIdentifiers: RUST_IGNORE, decisionWords: ['if', 'for', 'while', 'match'],
  },
  {
    id: 'php', displayName: 'PHP', extensions: ['.php'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'PHPUnit',
    testFileName: (b) => `${capitalize(b)}Test.php`, entryFunctions: ['main'],
    ignoreIdentifiers: union(GENERIC_IGNORE, new Set(['echo', 'function', 'class', 'public', 'private', 'protected', 'static', 'final', 'abstract', 'interface', 'trait', 'namespace', 'use', 'require', 'include', 'var', 'global', 'foreach', 'as', 'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw', 'extends', 'implements', 'instanceof', 'isset', 'empty', 'array', 'list', 'count', 'strlen', 'strtolower', 'strtoupper', '_GET', '_POST', '_SERVER', '_SESSION', '_COOKIE', '_FILES', '_ENV'])),
    decisionWords: ['if', 'elseif', 'for', 'foreach', 'while', 'case', 'catch'],
  },
  {
    id: 'ruby', displayName: 'Ruby', extensions: ['.rb'],
    lineComment: '#', docStyle: 'hash', testFramework: 'Minitest / RSpec',
    testFileName: (b) => `test_${b}.rb`, entryFunctions: ['main', 'initialize', 'to_s'],
    ignoreIdentifiers: union(GENERIC_IGNORE, new Set(['def', 'end', 'do', 'puts', 'print', 'p', 'gets', 'require', 'require_relative', 'attr_accessor', 'attr_reader', 'attr_writer', 'module', 'class', 'begin', 'rescue', 'ensure', 'raise', 'yield', 'lambda', 'proc', 'nil', 'elsif', 'unless', 'until', 'when', 'then', 'and', 'or', 'not', 'self', 'nil', 'true', 'false', 'Array', 'Hash', 'String', 'Integer'])),
    decisionWords: ['if', 'elsif', 'for', 'while', 'until', 'when', 'rescue'],
  },
  {
    id: 'swift', displayName: 'Swift', extensions: ['.swift'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'XCTest',
    testFileName: (b) => `${capitalize(b)}Tests.swift`, entryFunctions: ['main', 'init', 'deinit'],
    ignoreIdentifiers: union(GENERIC_IGNORE, new Set(['func', 'var', 'let', 'struct', 'enum', 'protocol', 'extension', 'guard', 'switch', 'case', 'default', 'do', 'catch', 'throws', 'try', 'defer', 'inout', 'some', 'any', 'String', 'Int', 'Double', 'Bool', 'Array', 'Dictionary', 'Optional', 'print', 'fatalError'])),
    decisionWords: ['if', 'for', 'while', 'case', 'catch', 'guard'],
  },
  {
    id: 'kotlin', displayName: 'Kotlin', extensions: ['.kt', '.kts'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'JUnit 5',
    testFileName: (b) => `${capitalize(b)}Test.kt`, entryFunctions: ['main', 'toString', 'equals', 'hashCode'],
    ignoreIdentifiers: union(JAVA_IGNORE, new Set(['fun', 'val', 'var', 'object', 'companion', 'data', 'sealed', 'when', 'is', 'in', 'out', 'by', 'lazy', 'suspend', 'inline', 'crossinline', 'reified', 'println', 'print', 'TODO'])),
    decisionWords: ['if', 'for', 'while', 'when', 'catch'],
  },
  {
    id: 'dart', displayName: 'Dart', extensions: ['.dart'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'flutter_test / test',
    testFileName: (b) => `${b}_test.dart`, entryFunctions: ['main'],
    ignoreIdentifiers: union(JS_IGNORE, new Set(['void', 'dynamic', 'final', 'const', 'late', 'required', 'extends', 'implements', 'with', 'mixin', 'enum', 'typedef', 'show', 'hide', 'library', 'part', 'export', 'Future', 'Stream', 'print'])),
    decisionWords: ['if', 'for', 'while', 'case', 'catch'],
  },
  {
    id: 'lua', displayName: 'Lua', extensions: ['.lua'],
    lineComment: '--', docStyle: 'slash', testFramework: 'busted',
    testFileName: (b) => `test_${b}.lua`, entryFunctions: ['main'],
    ignoreIdentifiers: union(GENERIC_IGNORE, new Set(['local', 'function', 'end', 'then', 'elseif', 'repeat', 'until', 'pairs', 'ipairs', 'tostring', 'tonumber', 'type', 'print', 'require', 'do', 'and', 'or', 'not', 'nil', 'true', 'false'])),
    decisionWords: ['if', 'elseif', 'for', 'while', 'repeat'],
  },
  {
    id: 'sql', displayName: 'SQL', extensions: ['.sql'],
    lineComment: '--', blockComment: ['/*', '*/'], docStyle: 'slash', testFramework: 'manual queries',
    testFileName: (b) => `test_${b}.sql`, entryFunctions: [],
    ignoreIdentifiers: new Set(['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'TABLE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'IN', 'IS', 'LIKE', 'BETWEEN', 'UNION', 'ALL', 'VALUES', 'INTO', 'SET', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'INDEX', 'VIEW', 'DROP', 'ALTER', 'ADD', 'COLUMN', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'BEGIN', 'END', 'DECLARE', 'IF', 'ELSE', 'WHILE', 'FOR', 'LOOP', 'RETURN', 'CASE', 'WHEN', 'THEN', 'EXISTS', 'GRANT', 'REVOKE', 'TRUNCATE', 'USE', 'DATABASE', 'SCHEMA']),
    decisionWords: ['CASE', 'WHEN', 'IF', 'ELSE'],
  },
  {
    id: 'html', displayName: 'HTML', extensions: ['.html', '.htm'],
    lineComment: '', blockComment: ['<!--', '-->'], docStyle: 'html', testFramework: 'Playwright / Cypress',
    testFileName: (b) => `${b}.test.js`, entryFunctions: [],
    ignoreIdentifiers: new Set(['html', 'head', 'body', 'div', 'span', 'class', 'id', 'href', 'src', 'alt', 'title']),
    decisionWords: [],
  },
  {
    id: 'css', displayName: 'CSS', extensions: ['.css', '.scss'],
    lineComment: '', blockComment: ['/*', '*/'], docStyle: 'css', testFramework: 'manual visual checks',
    testFileName: (b) => `${b}.test.js`, entryFunctions: [],
    ignoreIdentifiers: new Set(['color', 'background', 'margin', 'padding', 'display', 'font', 'width', 'height']),
    decisionWords: [],
  },
  {
    id: 'r', displayName: 'R', extensions: ['.r', '.R'],
    lineComment: '#', docStyle: 'hash', testFramework: 'testthat',
    testFileName: (b) => `test-${b}.R`, entryFunctions: ['main'],
    ignoreIdentifiers: union(GENERIC_IGNORE, new Set(['function', 'library', 'require', 'print', 'cat', 'paste', 'paste0', 'length', 'nrow', 'ncol', 'names', 'data', 'frame', 'c', 'list', 'vector', 'matrix', 'TRUE', 'FALSE', 'NULL', 'NA', 'if', 'else', 'for', 'while', 'repeat', 'in', 'next', 'break', 'return', 'invisible', 'stop', 'warning', 'message', 'source', 'setwd', 'getwd'])),
    decisionWords: ['if', 'for', 'while', 'repeat'],
  },
  {
    id: 'scala', displayName: 'Scala', extensions: ['.scala', '.sc'],
    lineComment: '//', blockComment: ['/*', '*/'], docStyle: 'javadoc', testFramework: 'ScalaTest / MUnit',
    testFileName: (b) => `${capitalize(b)}Suite.scala`, entryFunctions: ['main', 'toString', 'equals', 'hashCode'],
    ignoreIdentifiers: union(JAVA_IGNORE, new Set(['def', 'val', 'var', 'object', 'trait', 'case', 'match', 'for', 'yield', 'lazy', 'sealed', 'given', 'using', 'extension', 'derives', 'enum', 'println', 'print', 'Option', 'Some', 'None', 'List', 'Map', 'Seq', 'String', 'Int', 'Double', 'Boolean'])),
    decisionWords: ['if', 'for', 'while', 'case', 'match', 'catch'],
  },
  {
    id: 'perl', displayName: 'Perl', extensions: ['.pl', '.pm'],
    lineComment: '#', docStyle: 'hash', testFramework: 'Test::More / prove',
    testFileName: (b) => `${b}.t`, entryFunctions: ['main'],
    ignoreIdentifiers: union(GENERIC_IGNORE, new Set(['sub', 'my', 'our', 'local', 'use', 'require', 'print', 'say', 'printf', 'chomp', 'push', 'pop', 'shift', 'unshift', 'split', 'join', 'keys', 'values', 'scalar', 'defined', 'undef', 'die', 'warn', 'return', 'if', 'else', 'elsif', 'unless', 'for', 'foreach', 'while', 'until', 'given', 'when', 'default', 'last', 'next', 'redo', 'package', 'strict', 'warnings', 'ARGV', 'STDIN', 'STDOUT', 'STDERR', '_', 'a', 'b'])),
    decisionWords: ['if', 'elsif', 'for', 'foreach', 'while', 'until', 'when'],
  },
  {
    id: 'jupyter', displayName: 'Jupyter Notebook', extensions: ['.ipynb'],
    lineComment: '#', docStyle: 'docstring', testFramework: 'pytest',
    testFileName: (b) => `test_${b}.py`, entryFunctions: ['main'],
    ignoreIdentifiers: PY_IGNORE,
    decisionWords: ['if', 'elif', 'for', 'while', 'and', 'or', 'except', 'with', 'assert'],
  },
];

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const EXT_INDEX = new Map<string, LanguageConfig>();
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) EXT_INDEX.set(ext.toLowerCase(), lang);
}

export function detectLanguage(filePath: string): LanguageConfig | undefined {
  return EXT_INDEX.get(path.extname(filePath).toLowerCase());
}
export function detectLanguageById(id: string): LanguageConfig | undefined {
  return LANGUAGES.find((l) => l.id === id);
}
export function supportedExtensions(): string[] {
  return LANGUAGES.flatMap((l) => l.extensions.map((e) => e.slice(1)));
}
export function globForAllLanguages(): string {
  return `**/*.{${supportedExtensions().join(',')}}`;
}
export function globForPythonOnly(): string {
  return '**/*.{py,pyw,pyi}';
}
export function vscodeLanguageIds(): string[] {
  return LANGUAGES.map((l) => l.id);
}
export function isPythonFile(filePath: string): boolean {
  return detectLanguage(filePath)?.id === 'python';
}
export function isSupportedFile(filePath: string): boolean {
  return detectLanguage(filePath) !== undefined;
}
/** Generic fallback for a file whose extension is not in the registry. */
export function isGenericCodeFile(filePath: string): boolean {
  return /\.(txt|md|json|yaml|yml|toml|ini|cfg|sh|ps1|bat)$/i.test(filePath) === false
    && path.extname(filePath).length > 0;
}
