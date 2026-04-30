type JsonContract =
  | 'array'
  | 'boolean'
  | 'null'
  | 'number'
  | 'string'
  | { readonly [key: string]: JsonContract }
  | readonly [JsonContract];

export function jsonContract(value: unknown): JsonContract {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'array' : [jsonContract(value[0])];
  }
  if (typeof value === 'object') {
    const out: Record<string, JsonContract> = {};
    for (const [key, nested] of Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      out[key] = jsonContract(nested);
    }
    return out;
  }
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  throw new TypeError(`Unsupported JSON contract value: ${typeof value}`);
}
