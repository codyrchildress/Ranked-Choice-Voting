import { shortId } from './ids.js';

/**
 * Data backfill for the multi-question era, run once per election and safe
 * to re-run: every election created before questions existed gets a single
 * question carrying its old counting rules, its candidates are assigned to
 * that question, and its ballots move from a flat rankings array to the
 * per-question answers object ({questionId: [candidateId, …]}).
 *
 * Driver-agnostic: works through the async query/batch interface, so the
 * same code migrates the local file and Turso.
 */
export async function runDataMigrations(db) {
  const orphans = await db.query(
    `SELECT id, method, num_ranks AS numRanks, num_winners AS numWinners
     FROM elections
     WHERE id NOT IN (SELECT election_id FROM questions)`,
  );

  for (const election of orphans) {
    const questionId = shortId(8);
    const statements = [
      {
        sql: `INSERT INTO questions (id, election_id, prompt, position, method, num_ranks, num_winners)
              VALUES (?, ?, '', 1, ?, ?, ?)`,
        args: [questionId, election.id, election.method, election.numRanks, election.numWinners],
      },
      {
        sql: 'UPDATE candidates SET question_id = ? WHERE election_id = ?',
        args: [questionId, election.id],
      },
    ];

    const ballots = await db.query('SELECT id, rankings FROM ballots WHERE election_id = ?', [
      election.id,
    ]);
    for (const ballot of ballots) {
      if (String(ballot.rankings).trimStart().startsWith('[')) {
        statements.push({
          sql: 'UPDATE ballots SET rankings = ? WHERE id = ?',
          args: [JSON.stringify({ [questionId]: JSON.parse(ballot.rankings) }), ballot.id],
        });
      }
    }

    await db.batch(statements);
  }
}
