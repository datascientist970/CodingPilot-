// Pure analyzer checks — no VS Code needed. Run with: npm run test:analysis
import * as fs from 'fs';
import * as path from 'path';
import { scanBuiltIn } from '../src/analysis';
import { parseDependencies, findMissingLocalDependencies, dependencyInfo, installCommandFor, KNOWN_DEPENDENCIES } from '../src/dependencies';
import { detectLanguage } from '../src/languages';

const root = path.join(process.cwd(), 'examples');
let failures = 0;
function check(file: string, code: string, label: string) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const issues = scanBuiltIn(text, path.join(root, file));
  const found = issues.some((i) => i.code === code);
  console.log(`${found ? 'PASS' : 'FAIL'}  ${file}  ${label} (${code})  — ${issues.length} issue(s) total`);
  if (!found) {
    failures++;
    console.log('  found codes:', [...new Set(issues.map((i) => i.code))].join(', '));
  }
  return issues;
}

check('sample.py', 'DP001', 'meaningless variable name');
check('sample.py', 'DP105', 'unused variable');
check('sample.py', 'DP104', 'undefined variable in print()');
check('sample.py', 'DP101', 'bare except');
check('sample.py', 'DP106', 'unused function');
check('sample.cpp', 'DP105', 'unused variable (C++)');
check('sample.cpp', 'DP106', 'unused function (C++)');
check('sample.cpp', 'DP109', 'unsafe strcpy (C++)');
check('sample.js', 'DP105', 'unused variable (JS)');
check('sample.js', 'DP104', 'undefined variable in console.log (JS)');
check('sample.js', 'DP115', 'loose == in JS');
// v1.2.0 languages
check('sample.html', 'DP403', 'mismatched tags (HTML)');
const unclosed = scanBuiltIn('<div><p>hello', path.join(root, 'unclosed.html'));
const unclosedFound = unclosed.some((i) => i.code === 'DP402');
console.log(`${unclosedFound ? 'PASS' : 'FAIL'}  unclosed tag at EOF (DP402)`);
if (!unclosedFound) failures++;
check('sample.html', 'DP404', 'duplicate id (HTML)');
check('sample.html', 'DP405', 'img without alt (HTML)');
check('sample.html', 'DP406', 'deprecated tag (HTML)');
check('sample.css', 'DP501', 'duplicate selector (CSS)');
check('sample.css', 'DP502', 'duplicate property (CSS)');
check('sample.css', 'DP504', '!important (CSS)');
check('sample.css', 'DP505', 'unused CSS variable (CSS)');
check('sample.R', 'DP105', 'unused variable (R)');
check('sample.R', 'DP106', 'unused function (R)');
check('sample.scala', 'DP105', 'unused val (Scala)');
check('sample.scala', 'DP106', 'unused method (Scala)');
check('sample.pl', 'DP105', 'unused variable (Perl)');
check('sample.pl', 'DP106', 'unused sub (Perl)');
check('sample.sql', 'DP301', 'SELECT * (SQL)');
check('sample.sql', 'DP302', 'DELETE/UPDATE without WHERE (SQL)');
check('sample.sql', 'DP303', 'table without PRIMARY KEY (SQL)');
check('sample.sql', 'DP106', 'unused procedure (SQL)');
const nbIssues = check('sample.ipynb', 'DP105', 'unused variable in notebook cell');
const nbTextLines = fs.readFileSync(path.join(root, 'sample.ipynb'), 'utf8').split(/\r?\n/);
const nbLineOk = nbIssues.some((i) => i.code === 'DP105' && (nbTextLines[i.line] ?? '').includes('unused_in_notebook'));
console.log(`${nbLineOk ? 'PASS' : 'FAIL'}  notebook issue maps to the exact .ipynb source line`);
if (!nbLineOk) failures++;
const nbCrossCell = nbIssues.some((i) => i.message.includes("'total'"));
console.log(`${!nbCrossCell ? 'PASS' : 'FAIL'}  notebook cross-cell variable 'total' is not flagged unused`);
if (nbCrossCell) failures++;

// Duplicate detection: two identical 6-line blocks must be flagged.
const dup = [
  'def a():', '    x = 1', '    y = 2', '    z = x + y', '    w = z * 2', '    print(w)', '    return w', '',
  'def b():', '    x = 1', '    y = 2', '    z = x + y', '    w = z * 2', '    print(w)', '    return w',
].join('\n');
const dupIssues = scanBuiltIn(dup, path.join(root, 'dup.py'));
const dupFound = dupIssues.some((i) => i.code === 'DP201');
console.log(`${dupFound ? 'PASS' : 'FAIL'}  duplicate code detection (DP201)`);
if (!dupFound) failures++;

// Complexity: a function with many branches must be flagged.
const complex = ['def f(a):', '    if a > 1:', '        print(1)', '    if a > 2:', '        print(2)', '    if a > 3:', '        print(3)', '    if a > 4:', '        print(4)', '    if a > 5:', '        print(5)', '    if a > 6:', '        print(6)', '    if a > 7:', '        print(7)', '    if a > 8:', '        print(8)', '    if a > 9:', '        print(9)', '    if a > 10:', '        print(10)', '    return a'].join('\n');
const cxIssues = scanBuiltIn(complex, path.join(root, 'cx.py'));
const cxFound = cxIssues.some((i) => i.code === 'DP202');
console.log(`${cxFound ? 'PASS' : 'FAIL'}  complexity detection (DP202)`);
if (!cxFound) failures++;

// v1.4.0 dependency checks (pure — no VS Code, no installs)
function depCheck(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
{
  const cLang = detectLanguage('x.cpp')!;
  const cDeps = parseDependencies('#include <curl/curl.h>\n#include <stdio.h>\n#include "myheader.h"\n#include "utils.h"\n', cLang);
  depCheck('C++ parse: curl + stdio + 2 local headers', cDeps.length === 4 && cDeps.some((d) => d.name === 'curl/curl.h') && cDeps.some((d) => d.name === 'myheader.h' && d.local));
  const missingLocal = findMissingLocalDependencies(cDeps, (name) => name === 'utils.h');
  depCheck('C++ missing local header = myheader.h only', missingLocal.length === 1 && missingLocal[0].name === 'myheader.h');
  const curlInfo = dependencyInfo(cDeps.find((d) => d.name === 'curl/curl.h')!, cLang, 'python3');
  depCheck('curl header: apt command + official link on linux', (curlInfo.installCommand ?? '').includes('libcurl4-openssl-dev') && (curlInfo.link ?? '').includes('curl.se'));
  const stdioInfo = dependencyInfo(cDeps.find((d) => d.name === 'stdio.h')!, cLang, 'python3');
  depCheck('stdio.h is system — never offered for install', stdioInfo.status === 'ok' && !stdioInfo.installCommand);
  const pyLang = detectLanguage('x.py')!;
  const pyDeps = parseDependencies('import os\nimport requests\nfrom PIL import Image\nimport mylib\n', pyLang);
  depCheck('Python parse: os + requests + PIL + mylib', pyDeps.length === 4);
  const pilInfo = dependencyInfo(pyDeps.find((d) => d.name === 'PIL')!, pyLang, 'python3');
  depCheck('PIL maps to pip Pillow', pilInfo.installCommand === 'python3 -m pip install Pillow');
  const osInfo = dependencyInfo(pyDeps.find((d) => d.name === 'os')!, pyLang, 'python3');
  depCheck('os is stdlib — never offered for install', osInfo.status === 'ok' && !osInfo.installCommand);
  const jsLang = detectLanguage('x.ts')!;
  const jsDeps = parseDependencies("import React from 'react';\nimport { x } from './local';\n", jsLang);
  depCheck('JS parse: react only (relative import ignored)', jsDeps.length === 1 && jsDeps[0].name === 'react');
  depCheck('installCommandFor on win32 uses vcpkg for curl', installCommandFor(KNOWN_DEPENDENCIES['curl/curl.h'], 'win32', 'python') === 'vcpkg install curl');
  depCheck('installCommandFor on darwin uses brew for openssl', installCommandFor(KNOWN_DEPENDENCIES['openssl/ssl.h'], 'darwin', 'python') === 'brew install openssl');
}

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nAll analyzer checks passed.');
