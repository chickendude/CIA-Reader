// @vitest-environment node
import { describe, expect, it } from 'vitest';

type GetFn = (typeof import('./+server.js'))['GET'];

describe('GET /api/openapi.json', () => {
  it('serves the generated OpenAPI document', async () => {
    const { GET } = await import('./+server.js');
    const res = (await GET({
      request: new Request('http://x/api/openapi.json'),
    } as unknown as Parameters<GetFn>[0])) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    const body = await res.json();
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/api/v1/smoke'].get).toBeDefined();
  });
});
