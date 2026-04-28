/**
 * Reader-popup customize-action eligibility (T-3.11 → completes T-3.5).
 *
 * The pop-up shows a "Customize" button on each official translation row.
 * Clicking it forks that official into a personal translation via
 * `POST /api/v1/translations` with `parentTranslationId`. The wire and the
 * server-side validation already exist (T-3.2 / T-3.5 schema work) — this
 * helper just decides which officials should expose the button.
 *
 * Extracted to a pure module so the rule is unit-testable without booting
 * the Svelte component. Vitest excludes `.svelte` files from coverage; the
 * eligibility predicate is the only branch worth covering and it lives
 * here.
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
