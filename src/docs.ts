import { LanguageConfig, detectLanguage } from './languages';
import { findFunctionDefs, stripCommentsAndStrings } from './analysis';

/**
 * Local (no-AI) documentation insertion: adds a doc comment above every
 * function/class that does not already have one. AI documentation
 * (ai.ts buildDocumentationPrompt) is used when a provider is configured;
 * this fallback means "Generate Documentation" works with no API key.
 */
/** Class definitions, which findFunctionDefs only partly covers (e.g. Python `class`). */
export function findClassDefs(text: string, lang: LanguageConfig): { name: string; line: number; column: number }[] {
  const codeLines = stripCommentsAndStrings(text, lang);
  const defs: { name: string; line: number; column: number }[] = [];
  codeLines.forEach((line, idx) => {
    let m: RegExpMatchArray | null;
    if (lang.id === 'python') m = line.match(/^\s*class\s+([A-Za-z_]\w*)/);
    else m = line.match(/^\s*(?:export\s+)?(?:public\s+|abstract\s+|final\s+|case\s+|sealed\s+)?(?:class|interface|struct|enum|object|trait)\s+([A-Za-z_]\w*)/);
    if (m) defs.push({ name: m[1], line: idx, column: Math.max(line.indexOf(m[1]), 0) });
  });
  return defs;
}

function moduleHeader(file: string, lang: LanguageConfig): string[] {
  const base = file.split(/[\\/]/).pop() ?? 'module';
  switch (lang.docStyle) {
    case 'docstring': return [`"""${base} — TODO: describe what this module does.""`, ''];
    case 'go': return [`// Package ${base} — TODO: describe what this package does.`, ''];
    case 'rustdoc': return [`//! TODO: describe what this module does.`, ''];
    case 'hash': return [`# ${base} — TODO: describe what this module does.`, ''];
    case 'slash': return [`-- ${base} — TODO: describe what this module does.`, ''];
    case 'html': return [`<!-- ${base} — TODO: describe what this page does. -->`, ''];
    case 'css': return [`/* ${base} — TODO: describe what this stylesheet does. */`, ''];
    default: return [`/**`, ` * ${base} — TODO: describe what this module does.`, ` */`, ''];
  }
}

export function addLocalDocs(text: string, file: string): { text: string; added: number } {
  const lang = detectLanguage(file);
  if (!lang) return { text, added: 0 };
  const lines = text.split(/\r?\n/);
  let added = 0;
  // Module-level header (only if the file does not already start with a doc/comment).
  const first = lines.find((l) => l.trim().length > 0) ?? '';
  const startsWithDoc = first.trim().startsWith('"""') || first.trim().startsWith("'''") || first.trim().startsWith('/**') || first.trim().startsWith('//') || first.trim().startsWith('#') || first.trim().startsWith('/*') || first.trim().startsWith('//!') || first.trim().startsWith('--') || first.trim().startsWith('<!--');
  if (!startsWithDoc) {
    const header = moduleHeader(file, lang);
    lines.splice(0, 0, ...header);
    added++;
  }
  // Classes + functions, bottom-up so line numbers stay valid.
  const items: { name: string; line: number; column: number; params: string[] }[] = [
    ...findFunctionDefs(text, lang).map((d) => ({ name: d.name, line: d.line + (added > 0 ? moduleHeader(file, lang).length : 0), column: d.column, params: d.params })),
    ...findClassDefs(text, lang).map((d) => ({ name: d.name, line: d.line + (added > 0 ? moduleHeader(file, lang).length : 0), column: d.column, params: [] as string[] })),
  ];
  for (const item of [...items].sort((a, b) => b.line - a.line)) {
    if (hasDocAbove(lines, item.line, lang)) continue;
    const indent = (lines[item.line].match(/^\s*/) ?? [''])[0];
    const doc = buildDocBlock(item.name, item.params, lang, indent);
    if (!doc.length) continue;
    lines.splice(item.line, 0, ...doc);
    added++;
  }
  return { text: lines.join('\n'), added };
}

function hasDocAbove(lines: string[], defLine: number, lang: LanguageConfig): boolean {
  if (defLine <= 0) return false;
  // A doc comment must sit directly above the definition. A blank line
  // breaks the link — otherwise a module header at the top of the file
  // would be mistaken for the first class/function's doc comment.
  const prev = lines[defLine - 1].trim();
  if (!prev) return false;
  void lang;
  return prev.startsWith('"""') || prev.startsWith("'''") || prev.startsWith('/**') || prev.startsWith('//') || prev.startsWith('#') || prev.startsWith('///') || prev.startsWith('/*') || prev.endsWith('"""') || prev.endsWith("'''") || prev.endsWith('*/');
}

function buildDocBlock(name: string, params: string[], lang: LanguageConfig, indent: string): string[] {
  const paramLines = params.map((p) => ` @param ${p} - TODO: describe ${p}.`);
  switch (lang.docStyle) {
    case 'docstring': {
      const body = [`${indent}"""${name} — TODO: describe what this does.`, ...params.map((p) => `${indent}    ${p}: TODO: describe ${p}.`), `${indent}"""`];
      return body;
    }
    case 'go': {
      return [`${indent}// ${name} TODO: describe what this does.`, ...params.map((p) => `${indent}// ${p} - TODO: describe ${p}.`)];
    }
    case 'rustdoc': {
      return [`${indent}/// TODO: describe what ${name} does.`, ...params.map((p) => `${indent}/// \`${p}\` - TODO: describe ${p}.`)];
    }
    case 'hash': {
      return [`${indent}# TODO: describe what ${name} does.`];
    }
    case 'slash': {
      return [`${indent}-- TODO: describe what ${name} does.`];
    }
    case 'html': {
      return [`${indent}<!-- TODO: describe what ${name} does. -->`];
    }
    case 'css': {
      return [`${indent}/* TODO: describe what ${name} does. */`];
    }
    default: {
      return [`${indent}/**`, `${indent} * TODO: describe what ${name} does.`, ...paramLines.map((l) => `${indent} *${l}`), `${indent} * @returns TODO: describe the return value.`, `${indent} */`];
    }
  }
}

/** Names of functions/classes in a file — used by test generation prompts. */
export function listDocumentables(text: string, file: string): string[] {
  const lang = detectLanguage(file);
  if (!lang) return [];
  return findFunctionDefs(text, lang).map((d) => d.name);
}

export function stripForPrompt(text: string, file: string): string {
  const lang = detectLanguage(file);
  if (!lang) return text;
  return stripCommentsAndStrings(text, lang).join('\n');
}
