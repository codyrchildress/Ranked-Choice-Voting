// One statement per entry so drivers can run them individually (libSQL's
// batch API) or joined (node:sqlite exec). All idempotent.
//
// Note: elections.num_ranks / method / num_winners are legacy columns from
// the single-question era — counting rules live on questions now. They're
// kept (and written with constants) because SQLite can't cheaply drop
// NOT NULL columns from existing databases.
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS elections (
    id TEXT PRIMARY KEY,
    admin_token_hash TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    num_ranks INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'borda',
    num_winners INTEGER NOT NULL DEFAULT 1,
    ballot_privacy TEXT NOT NULL DEFAULT 'anonymous',
    security TEXT NOT NULL DEFAULT 'link',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    created_at INTEGER NOT NULL,
    opened_at INTEGER,
    closed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'borda',
    num_ranks INTEGER NOT NULL DEFAULT 3,
    num_winners INTEGER NOT NULL DEFAULT 1
  )`,
  'CREATE INDEX IF NOT EXISTS idx_questions_election ON questions(election_id, position)',
  `CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    question_id TEXT,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_candidates_election ON candidates(election_id, position)',
  `CREATE TABLE IF NOT EXISTS ballots (
    id TEXT PRIMARY KEY,
    election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    voter_name TEXT,
    rankings TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ballots_election ON ballots(election_id, created_at)',
  `CREATE TABLE IF NOT EXISTS ballot_codes (
    id TEXT PRIMARY KEY,
    election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at INTEGER NOT NULL,
    used_at INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ballot_codes_election ON ballot_codes(election_id, created_at)',
];

// Additive migrations for databases created before these columns existed.
// Drivers run them on startup and ignore "duplicate column" errors, so both
// fresh and existing databases converge on the same shape.
export const MIGRATION_STATEMENTS = [
  "ALTER TABLE elections ADD COLUMN method TEXT NOT NULL DEFAULT 'borda'",
  'ALTER TABLE elections ADD COLUMN num_winners INTEGER NOT NULL DEFAULT 1',
  "ALTER TABLE elections ADD COLUMN ballot_privacy TEXT NOT NULL DEFAULT 'anonymous'",
  "ALTER TABLE elections ADD COLUMN security TEXT NOT NULL DEFAULT 'link'",
  'ALTER TABLE candidates ADD COLUMN question_id TEXT',
];

export function isDuplicateColumnError(err) {
  return /duplicate column/i.test(String(err?.message ?? err));
}
