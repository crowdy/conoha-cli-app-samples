/**
 * Vitest globalSetup: runs in the main process before any test workers start.
 * Sets ADMIN_USER and ADMIN_PASSWORD so that config.ts captures them when
 * db/client.ts (which imports config) is first evaluated in the worker.
 */
export function setup() {
  process.env.ADMIN_USER = "testadmin";
  process.env.ADMIN_PASSWORD = "testadmin-pw";
}
