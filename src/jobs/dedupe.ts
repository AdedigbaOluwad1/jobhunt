import { isAtsSource } from '../sources/source.interface';

export interface DuplicateResolution {
  /** duplicateOfId to store on the newly inserted job. */
  newJobDuplicateOfId: number | null;
  /** an existing job whose duplicateOfId should be repointed at the new job (ATS beats remote-board). */
  swapExistingId: number | null;
}

/**
 * When a newly inserted job shares a dedupeKey with an existing non-closed
 * job from a different (source, board), the ATS listing wins: if the new job
 * is ATS-sourced and the existing match came from a remote-board aggregator,
 * the existing entry gets repointed at the new one instead of the other way
 * around.
 */
export function resolveDuplicate(
  newJob: { source: string },
  existing: { id: number; source: string } | null,
): DuplicateResolution {
  if (!existing) return { newJobDuplicateOfId: null, swapExistingId: null };

  if (isAtsSource(newJob.source) && !isAtsSource(existing.source)) {
    return { newJobDuplicateOfId: null, swapExistingId: existing.id };
  }

  return { newJobDuplicateOfId: existing.id, swapExistingId: null };
}
