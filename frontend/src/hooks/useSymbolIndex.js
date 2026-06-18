/**
 * useSymbolIndex — lightweight, Lezer-based symbol extraction.
 *
 * Extracts functions, classes, variables, methods, arrow functions from
 * JS/JSX/TS/TSX source using the @lezer/javascript parser that is already
 * bundled as a transitive dep of @codemirror/lang-javascript.
 *
 * Works fully offline — no LSP, no network, no new runtime.
 */

let _parser = null;
function getParser() {
  if (_parser) return _parser;
  try {
    // @lezer/javascript is already installed as a dep of @codemirror/lang-javascript
    _parser = require('@lezer/javascript').parser;
  } catch {
    _parser = null;
  }
  return _parser;
}

/**
 * Extract symbols from source text.
 * Returns [{name, kind, line, col, endLine}]
 */
export function extractSymbols(src, filePath = '') {
  const parser = getParser();
  if (!parser || !src) return [];

  let tree;
  try {
    tree = parser.parse(src);
  } catch {
    return [];
  }

  const lines = src.split('\n');
  function lineOf(pos) {
    let lo = 0, hi = lines.length - 1;
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      if (acc + lines[i].length >= pos) return i + 1;
      acc += lines[i].length + 1;
    }
    return lines.length;
  }
  function colOf(pos) {
    let acc = 0;
    for (const l of lines) {
      if (acc + l.length + 1 > pos) return pos - acc;
      acc += l.length + 1;
    }
    return 0;
  }

  const symbols = [];
  const seen = new Set();

  function visit(node, depth) {
    const t = node.name;

    // FunctionDeclaration / ArrowFunction inside VariableDeclaration
    if (t === 'FunctionDeclaration') {
      const nameNode = node.firstChild?.nextSibling; // function → VariableDefinition
      if (nameNode?.name === 'VariableDefinition') {
        const name = src.slice(nameNode.from, nameNode.to);
        const line = lineOf(node.from);
        const key = `${filePath}:${name}:${line}`;
        if (name && !seen.has(key)) {
          seen.add(key);
          symbols.push({ name, kind: 'function', line, col: colOf(node.from), endLine: lineOf(node.to), filePath });
        }
      }
    }

    if (t === 'ClassDeclaration') {
      const nameNode = node.firstChild?.nextSibling; // class → VariableDefinition
      if (nameNode?.name === 'VariableDefinition') {
        const name = src.slice(nameNode.from, nameNode.to);
        const line = lineOf(node.from);
        const key = `${filePath}:${name}:${line}`;
        if (name && !seen.has(key)) {
          seen.add(key);
          symbols.push({ name, kind: 'class', line, col: colOf(node.from), endLine: lineOf(node.to), filePath });
        }
      }
    }

    if (t === 'MethodDeclaration') {
      // PropertyDefinition is the method name node
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'PropertyDefinition') {
          const name = src.slice(c.from, c.to);
          const line = lineOf(node.from);
          const key = `${filePath}:${name}:${line}`;
          if (name && !seen.has(key)) {
            seen.add(key);
            symbols.push({ name, kind: 'method', line, col: colOf(node.from), endLine: lineOf(node.to), filePath });
          }
          break;
        }
      }
    }

    // const foo = ... / const foo = () => ...  (only top-ish level)
    if (t === 'VariableDeclaration' && depth <= 3) {
      let nameNode = null;
      let hasArrow = false;
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'VariableDefinition' && !nameNode) nameNode = c;
        if (c.name === 'ArrowFunction') hasArrow = true;
      }
      if (nameNode) {
        const name = src.slice(nameNode.from, nameNode.to);
        const kind = hasArrow ? 'function' : 'variable';
        const line = lineOf(node.from);
        const key = `${filePath}:${name}:${line}`;
        if (name && !seen.has(key)) {
          seen.add(key);
          symbols.push({ name, kind, line, col: colOf(node.from), endLine: lineOf(node.to), filePath });
        }
      }
    }

    for (let c = node.firstChild; c; c = c.nextSibling) {
      visit(c, depth + 1);
    }
  }

  try { visit(tree.topNode, 0); } catch {}
  return symbols;
}

/**
 * Find all occurrences of a name in source (single-file, token-boundary match).
 * Returns [{line, col, length}]
 */
export function findOccurrences(src, name) {
  if (!src || !name) return [];
  const result = [];
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  const lines = src.split('\n');
  let lineStart = 0;
  for (let li = 0; li < lines.length; li++) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[li])) !== null) {
      result.push({ line: li + 1, col: m.index, length: name.length });
    }
    lineStart += lines[li].length + 1;
  }
  return result;
}

/**
 * Get the enclosing symbol name at a given line (for breadcrumb).
 */
export function enclosingSymbol(symbols, line) {
  // Find deepest symbol that contains the line
  let best = null;
  for (const s of symbols) {
    if (s.line <= line && (s.endLine == null || s.endLine >= line)) {
      if (!best || s.line > best.line) best = s;
    }
  }
  return best;
}
