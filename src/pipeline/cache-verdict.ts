import type { StepRecord } from "../types.ts";

/** Why a step will run or be served from the cache. */
export type CacheReason = "cached" | "forced" | "no-record" | "prior-failure" | "input-changed";

export interface CacheVerdict {
  /** True when the prior success and its input hash still match. */
  readonly cached: boolean;
  readonly reason: CacheReason;
}

/**
 * The one cached-vs-run rule in bunsai, shared by the runner and the preview:
 * - `forced` (--force, or --from's downstream closure) always reruns;
 * - no prior record → run;
 * - a prior record that is not `success` (failure or dep-blocked skip) → run;
 * - a changed definition/inputs, or a record from before input hashing → run;
 * - otherwise the prior success still describes this step → cached.
 */
export function cacheVerdict(
  prior: StepRecord | undefined,
  inputHash: string | undefined,
  options: { readonly forced: boolean }
): CacheVerdict {
  if (options.forced) return { cached: false, reason: "forced" };
  if (prior === undefined) return { cached: false, reason: "no-record" };
  if (prior.status !== "success") return { cached: false, reason: "prior-failure" };
  if (inputHash === undefined || prior.inputHash !== inputHash) {
    return { cached: false, reason: "input-changed" };
  }
  return { cached: true, reason: "cached" };
}
