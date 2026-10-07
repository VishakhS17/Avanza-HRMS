export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertNotProductionHost } = await import("../scripts/db-host-guard.mjs");
  assertNotProductionHost();
}
