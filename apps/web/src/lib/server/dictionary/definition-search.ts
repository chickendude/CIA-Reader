export function definitionWordPrefix(query: string): string {
  // PostgreSQL's \\m matches the start of a word. Treat the search text as literal.
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return '\\m' + literal;
}
