import { shortId } from './ids.js';

const INSERT_ELECTION = `INSERT INTO elections (id, admin_token_hash, title, description, num_ranks, method, num_winners, status, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`;
const INSERT_CANDIDATE = 'INSERT INTO candidates (id, election_id, name, position) VALUES (?, ?, ?, ?)';

export function createStore(db) {
  return {
    async createElection({ title, description, numRanks, method, numWinners, candidateNames, adminTokenHash }) {
      for (let attempt = 0; ; attempt += 1) {
        const id = shortId(10);
        try {
          await db.batch([
            {
              sql: INSERT_ELECTION,
              args: [id, adminTokenHash, title, description, numRanks, method, numWinners, Date.now()],
            },
            ...candidateNames.map((name, i) => ({
              sql: INSERT_CANDIDATE,
              args: [shortId(8), id, name, i + 1],
            })),
          ]);
          return await this.getElection(id);
        } catch (err) {
          if (attempt < 5 && String(err.message).includes('UNIQUE')) continue;
          throw err;
        }
      }
    },

    async getElection(id) {
      const rows = await db.query('SELECT * FROM elections WHERE id = ?', [id]);
      return mapElection(rows[0]);
    },

    async getElectionByAdminHash(hash) {
      const rows = await db.query('SELECT * FROM elections WHERE admin_token_hash = ?', [hash]);
      return mapElection(rows[0]);
    },

    async saveElection(el) {
      await db.run(
        `UPDATE elections SET title = ?, description = ?, num_ranks = ?, method = ?, num_winners = ?, status = ?, opened_at = ?, closed_at = ?
         WHERE id = ?`,
        [el.title, el.description, el.numRanks, el.method, el.numWinners, el.status, el.openedAt ?? null, el.closedAt ?? null, el.id],
      );
    },

    // Explicit cascade so behavior doesn't depend on the server's
    // foreign_keys pragma; the batch keeps it atomic.
    async deleteElection(id) {
      await db.batch([
        { sql: 'DELETE FROM ballots WHERE election_id = ?', args: [id] },
        { sql: 'DELETE FROM candidates WHERE election_id = ?', args: [id] },
        { sql: 'DELETE FROM elections WHERE id = ?', args: [id] },
      ]);
    },

    async listCandidates(electionId) {
      const rows = await db.query(
        'SELECT id, name FROM candidates WHERE election_id = ? ORDER BY position, name',
        [electionId],
      );
      return rows.map((row) => ({ id: row.id, name: row.name }));
    },

    async addCandidate(electionId, name) {
      await db.run(
        `INSERT INTO candidates (id, election_id, name, position)
         SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM candidates WHERE election_id = ?`,
        [shortId(8), electionId, name, electionId],
      );
    },

    async removeCandidate(electionId, candidateId) {
      const { changes } = await db.run('DELETE FROM candidates WHERE id = ? AND election_id = ?', [
        candidateId,
        electionId,
      ]);
      return changes > 0;
    },

    async insertBallot({ electionId, voterName, rankings }) {
      const id = shortId(12);
      await db.run(
        'INSERT INTO ballots (id, election_id, voter_name, rankings, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, electionId, voterName, JSON.stringify(rankings), Date.now()],
      );
      return id;
    },

    async listBallotRankings(electionId) {
      const rows = await db.query(
        'SELECT rankings FROM ballots WHERE election_id = ? ORDER BY created_at, id',
        [electionId],
      );
      return rows.map((row) => JSON.parse(row.rankings));
    },

    async countBallots(electionId) {
      const rows = await db.query('SELECT COUNT(*) AS n FROM ballots WHERE election_id = ?', [electionId]);
      return rows[0].n;
    },

    async listVoters(electionId) {
      const rows = await db.query(
        'SELECT voter_name AS name, created_at AS createdAt FROM ballots WHERE election_id = ? ORDER BY created_at, id',
        [electionId],
      );
      return rows.map((row) => ({ name: row.name, createdAt: row.createdAt }));
    },
  };
}

function mapElection(row) {
  if (!row) return null;
  return {
    id: row.id,
    adminTokenHash: row.admin_token_hash,
    title: row.title,
    description: row.description,
    numRanks: row.num_ranks,
    method: row.method,
    numWinners: row.num_winners,
    status: row.status,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}
