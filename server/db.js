// Chooses the database driver. With TURSO_DATABASE_URL set the app talks to
// hosted libSQL (Vercel/serverless deployments); otherwise it uses the
// built-in SQLite file, so self-hosting and tests need no external services.
// Drivers are imported dynamically so each environment loads only its own.
export async function openDatabase({ path } = {}) {
  if (!path && process.env.TURSO_DATABASE_URL) {
    const { createTursoDb } = await import('./db-turso.js');
    return createTursoDb();
  }
  const { createLocalDb } = await import('./db-local.js');
  return createLocalDb(path);
}
