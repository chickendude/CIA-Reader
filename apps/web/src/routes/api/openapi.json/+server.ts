import { json } from '@sveltejs/kit';

import { generateOpenApiDocument } from '$lib/server/openapi/generator.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const doc = await generateOpenApiDocument();
  return json(doc, {
    headers: {
      'cache-control': 'public, max-age=300',
    },
  });
};
