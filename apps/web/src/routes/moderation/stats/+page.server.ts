/**
 * Correction-quality stats dashboard (T-6.9).
 *
 * Admin-scoped — curators see /moderation/parses for their language
 * grants; the cross-language stats view is admin-only because it
 * exposes data outside any single curator's scope.
 */
import { error } from '@sveltejs/kit';

import {
  getAccuracyByLanguage,
  getBacklogSize,
  getMedianTimeToResolution,
  topReportedSurfaces,
} from '$lib/server/correction-stats.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { moderator } = await parent();
  if (moderator.role !== 'admin') {
    throw error(403, 'Admin role required');
  }

  // Run the four queries in parallel — they don't share state and
  // each is small enough that the round-trip dominates.
  const [accuracy, backlog, latency, top] = await Promise.all([
    getAccuracyByLanguage(),
    getBacklogSize(),
    getMedianTimeToResolution(),
    topReportedSurfaces(null, 20),
  ]);

  return {
    accuracy,
    backlog,
    latency,
    topReportedSurfaces: top,
  };
};
