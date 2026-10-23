import { expect, it } from "vitest";
import { mergeJobs } from "./jobs";
import type { Job } from "./types";

it("preserves newer progress when the submission response arrives late", () => {
  const queued = { id: "a", status: "queued", updated_at: 1 } as Job;
  const finished = { ...queued, status: "success", updated_at: 2 } as Job;
  expect(mergeJobs([finished], [queued])).toEqual([finished]);
  expect(mergeJobs([queued], [finished])).toEqual([finished]);
});

it("merges bootstrap snapshots without losing concurrent background tasks", () => {
  const a = { id: "a", updated_at: 1 } as Job;
  const b = { id: "b", updated_at: 2 } as Job;
  expect(mergeJobs([b], [a])).toEqual([b, a]);
  expect(mergeJobs([a], [a])).toEqual([a]);
});
