// Resolve authored anchors. Never guess a location from the first definition.
export function pythonSymbols(text) {
  const lines = text.split(/\r?\n/);
  const stack = [],
    symbols = [];
  lines.forEach((line, index) => {
    // Named module-level registries are code anchors too. Restrict this to
    // multiline mappings with an unindented closing brace, never a text guess.
    const mapping = line.match(/^([A-Z_][A-Z_0-9]*)\s*=\s*\{\s*(?:#.*)?$/);
    if (mapping) {
      const end = lines.findIndex((value, i) => i > index && /^\}\s*(?:#.*)?$/.test(value));
      if (end >= 0) symbols.push({ name: mapping[1], start: index + 1, end: end + 1 });
    }
    const match = line.match(/^(\s*)(?:async\s+)?(class|def)\s+(\w+)/);
    if (!match) return;
    const indent = match[1].length;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const name = [...stack.map((s) => s.name), match[3]].join('.');
    let headerEnd = index;
    while (headerEnd < lines.length - 1 && !/:\s*(?:#.*)?$|:\s+\.\.\./.test(lines[headerEnd]))
      headerEnd++;
    let end = headerEnd + 1;
    while (end < lines.length) {
      const next = lines[end];
      if (next.trim() && !next.trim().startsWith('#') && next.search(/\S/) <= indent) break;
      end++;
    }
    symbols.push({ name, start: index + 1, end });
    stack.push({ name: match[3], indent });
  });
  return symbols;
}

export function locateSource(text, ref) {
  const lines = text.split(/\r?\n/);
  let start = 1,
    end = lines.length,
    line = 1;
  if (ref.symbol) {
    const matches = pythonSymbols(text).filter((s) => s.name === ref.symbol);
    if (matches.length !== 1)
      throw Error(`${ref.path}: symbol ${ref.symbol} matched ${matches.length} definitions`);
    ({ start, end } = matches[0]);
    line = start;
  }
  if (ref.heading) {
    const matches = lines.flatMap((s, i) => (s.trim() === ref.heading ? [i] : []));
    if (matches.length !== 1)
      throw Error(`${ref.path}: heading ${ref.heading} matched ${matches.length} sections`);
    line = start = matches[0] + 1;
    const level = ref.heading.match(/^#+/)[0].length;
    end = lines.findIndex((s, i) => i >= start && new RegExp(`^#{1,${level}} `).test(s));
    if (end < 0) end = lines.length;
  }
  if (ref.needle) {
    const matches = lines.flatMap((s, i) =>
      i >= start - 1 && i < end && s.includes(ref.needle) ? [i + 1] : [],
    );
    if (!matches.length || (ref.symbol && matches.length > 1))
      throw Error(`${ref.path}: ambiguous or missing text ${ref.needle}`);
    line = matches[0];
  }
  const snippetStart = Math.max(start, line - 2);
  const snippetEnd = Math.min(end, line + 22);
  return {
    path: ref.path,
    line,
    start: snippetStart,
    end: snippetEnd,
    rangeStart: start,
    rangeEnd: end,
    symbol: ref.symbol || ref.heading || null,
    kind: ref.symbol ? 'implementation' : ref.heading ? 'documentation' : 'reference',
    code: lines.slice(snippetStart - 1, snippetEnd).join('\n'),
  };
}
