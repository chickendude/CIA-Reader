# API Versioning Policy

CIA Reader's stable web and mobile API is the SvelteKit API under `/api/v1/*`.
Other endpoints, including `/api/openapi.json`, `/api/docs`, and the internal
FastAPI NLP service, are support surfaces but are not the stable public client
contract.

## Stability

- `/api/v1/*` is the only stable public API prefix.
- Backward-compatible additions stay in `/api/v1/*`.
- Breaking API changes must ship under `/api/v2/*` or a later major prefix.
- A breaking change is any removal, rename, type change, required-field addition,
  status-code contract change, or response-shape change that can break an
  existing client.

## Deprecation

When a v1 endpoint is superseded by a v2 endpoint, the v1 endpoint remains
supported for at least six calendar months after the v2 endpoint ships.

Deprecated v1 responses include an `API-Deprecation` header. Route handlers
should use `buildApiDeprecationHeaders` from
`apps/web/src/lib/server/api-versioning.ts` so the six-month support window is
enforced consistently.

Example:

```ts
return json(payload, {
  headers: buildApiDeprecationHeaders({
    since: '2026-04-30',
    sunset: '2026-10-30',
    replacement: '/api/v2/texts',
  }),
});
```

The helper also emits `Sunset` and, when a replacement is provided, the
`Link: <...>; rel="successor-version"` header for clients that understand those
standard signals.

## Documentation

The generated OpenAPI document is published at `/api/openapi.json`, and the docs
UI is published at `/api/docs`. The OpenAPI document declares this policy in its
`x-api-versioning` metadata and documents the `API-Deprecation` response header
component for deprecated operations.
