/**
 * Readers can make a personal copy of an official translation. Offer that action only for
 * eligible rows.
 */

type OfficialTranslation = {
  id: string;
};

type PersonalTranslation = {
  parentTranslationId: string | null;
};

/**
 * Return the set of official-translation ids that the viewer is allowed
 * to fork right now. Empty when the viewer is not the owner. Excludes
 * any official that the viewer has already customized (i.e. their
 * personal bucket already contains a row with `parentTranslationId`
 * pointing at it) — re-customizing the same official would just create
 * a redundant fork.
 */
export function customizableOfficialIds(
  isOwner: boolean,
  officials: ReadonlyArray<OfficialTranslation>,
  personal: ReadonlyArray<PersonalTranslation>,
): Set<string> {
  if (!isOwner) return new Set();
  const alreadyForked = new Set<string>();
  for (const p of personal) {
    if (p.parentTranslationId) alreadyForked.add(p.parentTranslationId);
  }
  const eligible = new Set<string>();
  for (const o of officials) {
    if (!alreadyForked.has(o.id)) eligible.add(o.id);
  }
  return eligible;
}
