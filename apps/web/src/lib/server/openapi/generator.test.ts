// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  API_DEPRECATION_HEADER,
  STABLE_API_PREFIX,
} from '$lib/server/api-versioning.js';

import {
  discoverSvelteKitApiOperations,
  generateOpenApiDocument,
} from './generator.js';

describe('OpenAPI generator', () => {
  it('emits OpenAPI 3.1 with web and NLP paths', async () => {
    const doc = await generateOpenApiDocument();

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/api/v1/auth/login']?.post).toBeDefined();
    expect(doc.paths['/api/v1/me/profile']?.get).toBeDefined();
    expect(doc.paths['/nlp/process']?.post).toBeDefined();
    expect(doc['x-api-versioning']).toMatchObject({
      stablePrefix: STABLE_API_PREFIX,
      deprecationHeader: API_DEPRECATION_HEADER,
    });
    expect(doc.components.headers[API_DEPRECATION_HEADER]).toBeDefined();
  });

  it('represents every exported SvelteKit API handler with schemas', async () => {
    const operations = await discoverSvelteKitApiOperations();
    const doc = await generateOpenApiDocument();

    expect(operations.length).toBeGreaterThan(40);
    for (const op of operations) {
      const documented = doc.paths[op.path]?.[op.method];
      expect(documented, `${op.method.toUpperCase()} ${op.path}`).toBeDefined();
      expect(documented?.responses).toBeDefined();
      if (op.method !== 'get' && op.method !== 'delete') {
        expect(documented?.requestBody).toBeDefined();
      }
    }
  });

  it('only treats /api/v1 SvelteKit routes as stable public API paths', async () => {
    const operations = await discoverSvelteKitApiOperations();

    expect(operations).not.toHaveLength(0);
    expect(operations.every((op) => op.path.startsWith(`${STABLE_API_PREFIX}/`))).toBe(
      true,
    );
  });
});
