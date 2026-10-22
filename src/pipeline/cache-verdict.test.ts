import { describe, expect, test } from "bun:test";
import type { StepRecord } from "../types.ts";
import { cacheVerdict } from "./cache-verdict.ts";

const HASH = "sha256:abc";
const ok = (inputHash?: string): StepRecord => ({
  status: "success",
  startedAt: "2026-10-22T10:00:00.000Z",
  attempts: 1,
  inputHash,
});

describe("cacheVerdict", () => {
  test("a success whose input hash still matches is cached", () => {
    expect(cacheVerdict(ok(HASH), HASH, { forced: false })).toEqual({ cached: true, reason: "cached" });
  });

  test("--force and --from downstream always rerun", () => {
    expect(cacheVerdict(ok(HASH), HASH, { forced: true })).toEqual({ cached: false, reason: "forced" });
  });

  test("no prior record runs the step", () => {
    expect(cacheVerdict(undefined, HASH, { forced: false })).toEqual({ cached: false, reason: "no-record" });
  });

  test("a failed or skipped prior record runs the step", () => {
    const failed: StepRecord = { status: "failure", startedAt: "2026-10-22T10:00:00.000Z", attempts: 2, inputHash: HASH };
    const blocked: StepRecord = { status: "skipped", startedAt: "2026-10-22T10:00:00.000Z", attempts: 0 };
    expect(cacheVerdict(failed, HASH, { forced: false }).reason).toBe("prior-failure");
    expect(cacheVerdict(blocked, HASH, { forced: false })).toEqual({ cached: false, reason: "prior-failure" });
  });

  test("a changed hash, or a legacy record without one, runs the step", () => {
    expect(cacheVerdict(ok(HASH), "sha256:def", { forced: false })).toEqual({
      cached: false,
      reason: "input-changed",
    });
    expect(cacheVerdict(ok(undefined), HASH, { forced: false }).reason).toBe("input-changed");
    expect(cacheVerdict(ok(HASH), undefined, { forced: false }).reason).toBe("input-changed");
  });
});
