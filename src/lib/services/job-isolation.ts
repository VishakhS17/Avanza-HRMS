export type JobFailure = {
  employeeId: string;
  message: string;
};

/**
 * Runs one employee at a time. A throw is recorded and the next employee still runs.
 * The caller keeps its own idempotency check inside `work`.
 */
export async function forEachEmployee<T>(
  items: readonly T[],
  employeeId: (item: T) => string,
  work: (item: T) => Promise<void>,
): Promise<{ failures: JobFailure[] }> {
  const failures: JobFailure[] = [];
  for (const item of items) {
    const id = employeeId(item);
    try {
      await work(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Scheduled job failed for employee ${id}: ${message}`);
      failures.push({ employeeId: id, message });
    }
  }
  return { failures };
}

export function jobFailed(failures: readonly JobFailure[]): boolean {
  return failures.length > 0;
}
