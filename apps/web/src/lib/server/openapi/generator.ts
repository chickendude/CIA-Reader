/**
 * OpenAPI generator (T-12.1).
 *
 * The v1 API surface is defined by SvelteKit route files. Rather than keep a
 * parallel hand-written path list, this generator scans `src/routes/api/v1`
 * for exported HTTP handlers and emits an OpenAPI 3.1 operation for each one.
 * Route-specific Zod schemas still live beside handlers today; M12's later
 * contract tests can tighten individual JSON shapes without losing this
 * coverage guard.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  API_DEPRECATION_HEADER,
  API_DEPRECATION_MIN_SUPPORT_MONTHS,
  NEXT_BREAKING_API_PREFIX,
  STABLE_API_PREFIX,
} from '$lib/server/api-versioning.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

type JsonSchema = Record<string, unknown>;

export type OpenApiDocument = {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  externalDocs: { description: string; url: string };
  components: {
    securitySchemes: Record<string, JsonSchema>;
    schemas: Record<string, JsonSchema>;
    responses: Record<string, JsonSchema>;
    headers: Record<string, JsonSchema>;
  };
  paths: Record<string, Record<string, JsonSchema>>;
  'x-api-versioning': {
    stablePrefix: string;
    nextBreakingPrefix: string;
    deprecationHeader: string;
    minimumDeprecatedV1SupportMonths: number;
  };
};

export type RouteOperation = {
  file: string;
  path: string;
  method: Lowercase<HttpMethod>;
  operationId: string;
};

const WEB_ROOT = path.resolve(
  fileURLToPath(new URL('../../../..', import.meta.url)),
);
const V1_ROUTES_DIR = path.join(WEB_ROOT, 'src/routes/api/v1');

const jsonContent = {
  'application/json': {
    schema: { $ref: '#/components/schemas/JsonObject' },
  },
};

function routeSegmentToOpenApi(segment: string): string {
  if (segment.startsWith('[...') && segment.endsWith(']')) {
    return `{${segment.slice(4, -1)}}`;
  }
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return `{${segment.slice(1, -1)}}`;
  }
  return segment;
}

function routeFileToPath(file: string): string {
  const rel = path.relative(path.join(WEB_ROOT, 'src/routes'), file);
  const parts = rel.split(path.sep).slice(0, -1).map(routeSegmentToOpenApi);
  return `/${parts.join('/')}`;
}

function operationIdFor(apiPath: string, method: string): string {
  const suffix = apiPath
    .replace(/^\/api\//, '')
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9]+/g, ' '))
    .flatMap((part) => part.split(' '))
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
  return `${method.toLowerCase()}${suffix}`;
}

function tagFor(apiPath: string): string {
  const parts = apiPath.split('/').filter(Boolean);
  if (parts[2] === 'admin') return 'Admin';
  if (parts[2] === 'auth') return 'Auth';
  if (parts[2] === 'me') return 'Me';
  if (parts[2] === 'texts') return 'Texts';
  if (parts[2] === 'collections') return 'Collections';
  if (parts[2] === 'groups') return 'Groups';
  if (parts[2] === 'dictionary' || parts[2] === 'lemmas') return 'Dictionary';
  if (parts[2] === 'translations') return 'Translations';
  if (parts[2] === 'audio') return 'Audio';
  return 'System';
}

function summaryFor(apiPath: string, method: string): string {
  const humanPath = apiPath
    .replace(/^\/api\/v1\//, '')
    .replace(/[{}]/g, '')
    .replace(/[-/]/g, ' ');
  return `${method.toUpperCase()} ${humanPath}`;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(abs)));
    } else if (entry.name === '+server.ts') {
      out.push(abs);
    }
  }
  return out.sort();
}

export async function discoverSvelteKitApiOperations(
  rootDir: string = V1_ROUTES_DIR,
): Promise<RouteOperation[]> {
  const files = await walk(rootDir);
  const operations: RouteOperation[] = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const apiPath = routeFileToPath(file);
    for (const method of HTTP_METHODS) {
      if (new RegExp(`export\\s+const\\s+${method}\\b`).test(source)) {
        operations.push({
          file,
          path: apiPath,
          method: method.toLowerCase() as Lowercase<HttpMethod>,
          operationId: operationIdFor(apiPath, method),
        });
      }
    }
  }
  return operations;
}

function requestBodyFor(method: string): JsonSchema | undefined {
  if (method === 'get' || method === 'delete') return undefined;
  return {
    required: true,
    content: jsonContent,
  };
}

function responsesFor(method: string): JsonSchema {
  const successStatus = method === 'post' ? '201' : '200';
  const responses: JsonSchema = {
    [successStatus]: {
      description: 'Successful response',
      ...(method === 'post'
        ? {
            headers: {
              'X-RateLimit-Limit': {
                $ref: '#/components/headers/X-RateLimit-Limit',
              },
              'X-RateLimit-Remaining': {
                $ref: '#/components/headers/X-RateLimit-Remaining',
              },
            },
          }
        : {}),
      content: jsonContent,
    },
    '400': { $ref: '#/components/responses/BadRequest' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '404': { $ref: '#/components/responses/NotFound' },
  };
  if (method === 'post') {
    responses['429'] = { $ref: '#/components/responses/RateLimited' };
  }
  if (method === 'delete') {
    delete responses[successStatus];
    responses['204'] = { description: 'Deleted' };
  }
  return responses;
}

function operationFor(op: RouteOperation): JsonSchema {
  const requestBody = requestBodyFor(op.method);
  return {
    operationId: op.operationId,
    tags: [tagFor(op.path)],
    summary: summaryFor(op.path, op.method),
    description:
      'Generated from the matching SvelteKit API route. Endpoint-specific request validation is implemented with local Zod schemas in the route/service layer.',
    security: [{ bearerAuth: [] }, { personalApiKeyAuth: [] }, { cookieAuth: [] }],
    ...(requestBody ? { requestBody } : {}),
    responses: responsesFor(op.method),
    'x-source-file': path.relative(WEB_ROOT, op.file),
  };
}

function nlpOperations(): Record<string, Record<string, JsonSchema>> {
  return {
    '/nlp/health': {
      get: {
        operationId: 'getNlpHealth',
        tags: ['NLP'],
        summary: 'GET NLP health',
        description: 'FastAPI NLP service health endpoint.',
        responses: {
          '200': {
            description: 'NLP service status and supported language codes',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NlpHealthResponse' },
              },
            },
          },
        },
        'x-source-file': 'services/nlp/app/main.py',
      },
    },
    '/nlp/process': {
      post: {
        operationId: 'postNlpProcess',
        tags: ['NLP'],
        summary: 'POST NLP process',
        description:
          'FastAPI endpoint that tokenizes and lemmatizes supported language text.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NlpProcessRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Processed token payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NlpProcessResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '422': { $ref: '#/components/responses/ValidationError' },
        },
        'x-source-file': 'services/nlp/app/main.py',
      },
    },
  };
}

export async function generateOpenApiDocument(): Promise<OpenApiDocument> {
  const operations = await discoverSvelteKitApiOperations();
  const paths: OpenApiDocument['paths'] = {};
  for (const op of operations) {
    paths[op.path] ??= {};
    paths[op.path]![op.method] = operationFor(op);
  }
  Object.assign(paths, nlpOperations());

  return {
    openapi: '3.1.0',
    info: {
      title: 'CIA Reader API',
      version: '1.0.0',
      description:
        'Stable v1 web/mobile API plus the internal NLP FastAPI service surface.',
    },
    servers: [
      { url: '/', description: 'CIA Reader web app' },
      { url: 'http://nlp:8000', description: 'NLP service in docker compose' },
    ],
    externalDocs: {
      description: 'Client API reference',
      url: '/docs/api/',
    },
    'x-api-versioning': {
      stablePrefix: STABLE_API_PREFIX,
      nextBreakingPrefix: NEXT_BREAKING_API_PREFIX,
      deprecationHeader: API_DEPRECATION_HEADER,
      minimumDeprecatedV1SupportMonths: API_DEPRECATION_MIN_SUPPORT_MONTHS,
    },
    tags: [
      { name: 'Auth', description: 'Login, registration, token refresh' },
      { name: 'Me', description: 'Authenticated user profile and learning data' },
      { name: 'Texts', description: 'Text upload, status, chapters, sharing' },
      { name: 'Collections', description: 'Collections, course items, sharing' },
      { name: 'Groups', description: 'Groups and memberships' },
      { name: 'Dictionary', description: 'Dictionary and lemma lookups' },
      { name: 'Translations', description: 'Community translation endpoints' },
      { name: 'Audio', description: 'Audio files and alignments' },
      { name: 'Admin', description: 'Admin and curator endpoints' },
      { name: 'NLP', description: 'FastAPI NLP service endpoints' },
      { name: 'System', description: 'Smoke and health endpoints' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        personalApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description:
            'Personal API key generated from the user profile. Keys are scoped to the owning account and stored hashed.',
        },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ciar_session' },
      },
      responses: {
        BadRequest: {
          description: 'Invalid request',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
        Unauthorized: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
        Forbidden: {
          description: 'Authenticated caller lacks access',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
        ValidationError: {
          description: 'Request validation failed',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
        RateLimited: {
          description: 'Request exceeded a per-user, per-device, or per-API-key limit',
          headers: {
            'Retry-After': { $ref: '#/components/headers/Retry-After' },
            'X-RateLimit-Limit': {
              $ref: '#/components/headers/X-RateLimit-Limit',
            },
            'X-RateLimit-Remaining': {
              $ref: '#/components/headers/X-RateLimit-Remaining',
            },
          },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
      },
      headers: {
        [API_DEPRECATION_HEADER]: {
          description:
            'Present on deprecated v1 routes. Includes since, sunset, and optional replacement metadata. Deprecated v1 endpoints stay supported for at least six months after the v2 replacement ships.',
          schema: { type: 'string' },
          example:
            'deprecated; since="2026-04-30"; sunset="2026-10-30"; replacement="/api/v2/texts"',
        },
        'Retry-After': {
          description: 'Seconds to wait before retrying a rate-limited request.',
          schema: { type: 'integer', minimum: 1 },
        },
        'X-RateLimit-Limit': {
          description: 'Maximum requests permitted in the current rolling window.',
          schema: { type: 'integer', minimum: 1 },
        },
        'X-RateLimit-Remaining': {
          description: 'Requests remaining in the current rolling window.',
          schema: { type: 'integer', minimum: 0 },
        },
      },
      schemas: {
        JsonObject: {
          type: 'object',
          additionalProperties: true,
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string' },
            code: { type: 'string' },
            issues: { type: 'array', items: { type: 'object' } },
          },
          additionalProperties: true,
        },
        NlpHealthResponse: {
          type: 'object',
          required: ['status', 'languages'],
          properties: {
            status: { type: 'string', enum: ['ok'] },
            languages: {
              type: 'array',
              items: { type: 'string', enum: ['hi', 'mr', 'or'] },
            },
          },
        },
        NlpProcessRequest: {
          type: 'object',
          required: ['language', 'text'],
          properties: {
            language: { type: 'string', enum: ['hi', 'mr', 'or'] },
            text: { type: 'string', minLength: 1 },
          },
        },
        NlpProcessResponse: {
          type: 'object',
          required: ['language', 'pipeline_id', 'tokens'],
          properties: {
            language: { type: 'string' },
            pipeline_id: { type: 'string' },
            tokens: {
              type: 'array',
              items: { $ref: '#/components/schemas/NlpToken' },
            },
          },
        },
        NlpToken: {
          type: 'object',
          required: ['idx', 'surface', 'is_word', 'candidates'],
          properties: {
            idx: { type: 'integer' },
            surface: { type: 'string' },
            is_word: { type: 'boolean' },
            candidates: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            is_ambiguous: { type: 'boolean' },
            is_oov: { type: 'boolean' },
            romanization: { type: ['string', 'null'] },
            number_forms: { type: ['object', 'null'], additionalProperties: true },
          },
        },
      },
    },
    paths,
  };
}
