import type { Job } from "./types";

/** Progress events can arrive before the RPC response that created a job. */
export function mergeJobs(current: Job[], incoming: Job[]): Job[] {
  const records = new Map(current.map((job) => [job.id, job]));
  for (const job of incoming) {
    const previous = records.get(job.id);
    if (!previous || previous.updated_at <= job.updated_at)
      records.set(job.id, job);
  }
  return [...records.values()];
}
