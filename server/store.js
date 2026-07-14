import { shortId } from './ids.js';

const INSERT_ELECTION = `INSERT INTO elections (id, admin_token_hash, title, description, num_ranks, method, num_winners, ballot_privacy, security, status, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`;
const INSERT_CANDIDATE = 'INSERT INTO candidates (id, election_id, name, position) VALUES (?, ?, ?, ?)';

export function createStore(db) {
  return {
    async createElection({
      title,
      description,
      numRanks,
      method,
      numWinners,
      ballotPrivacy,
      security,
      candidateNames,
      adminTokenHash,
    }) {
      for (let attempt = 0; ; attempt += 1) {
        const id = shortId(10);
        try {
          await db.batch([
            {
              sql: INSERT_ELECTION,
              args: [id, adminTokenHash, title, description, numRanks, method, numWinners, ballotPrivacy, security, Date.now()],
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
        `UPDATE elections SET title = ?, description = ?, num_ranks = ?, method = ?, num_winners = ?, ballot_privacy = ?, security = ?, status = ?, opened_at = ?, closed_at = ?
         WHERE id = ?`,
        [el.title, el.description, el.numRanks, el.method, el.numWinners, el.ballotPrivacy, el.security, el.status, el.openedAt ?? null, el.closedAt ?? null, el.id],
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

    // ---- one-time ballot codes (secure elections) ----
    // Codes are one-vote bearer tokens, stored in plaintext so the admin can
    // re-copy them any time. Deliberately NOT linked to the ballot they cast:
    // even a labeled code can't be joined to a ranking.

    async createCodes(electionId, labels) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await db.batch(
            labels.map((label) => ({
              sql: 'INSERT INTO ballot_codes (id, election_id, code, label, created_at) VALUES (?, ?, ?, ?, ?)',
              args: [shortId(8), electionId, shortId(9), label, Date.now()],
            })),
          );
          return;
        } catch (err) {
          if (attempt < 3 && String(err.message).includes('UNIQUE')) continue;
          throw err;
        }
      }
    },

    async listCodes(electionId) {
      // rowid keeps insertion order even when a batch lands in one millisecond
      const rows = await db.query(
        'SELECT id, code, label, created_at AS createdAt, used_at AS usedAt FROM ballot_codes WHERE election_id = ? ORDER BY created_at, rowid',
        [electionId],
      );
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        label: row.label,
        createdAt: row.createdAt,
        usedAt: row.usedAt,
      }));
    },

    async findCode(electionId, code) {
      const rows = await db.query(
        'SELECT id, code, label, used_at AS usedAt FROM ballot_codes WHERE election_id = ? AND code = ?',
        [electionId, code],
      );
      return rows[0] ? { id: rows[0].id, code: rows[0].code, label: rows[0].label, usedAt: rows[0].usedAt } : null;
    },

    // Atomic claim: only one ballot can ever consume a code, even under
    // concurrent submissions.
    async claimCode(codeId) {
      const { changes } = await db.run(
        'UPDATE ballot_codes SET used_at = ? WHERE id = ? AND used_at IS NULL',
        [Date.now(), codeId],
      );
      return changes > 0;
    },

    async revokeCode(electionId, codeId) {
      const { changes } = await db.run(
        'DELETE FROM ballot_codes WHERE id = ? AND election_id = ? AND used_at IS NULL',
        [codeId, electionId],
      );
      return changes > 0;
    },

    async countCodes(electionId) {
      const rows = await db.query(
        'SELECT COUNT(*) AS total, COUNT(used_at) AS used FROM ballot_codes WHERE election_id = ?',
        [electionId],
      );
      return { total: rows[0].total, used: rows[0].used };
    },

    // Full signed ballots — only ever exposed for open-ballot elections.
    async listSignedBallots(electionId) {
      const rows = await db.query(
        'SELECT voter_name AS name, rankings, created_at AS createdAt FROM ballots WHERE election_id = ? ORDER BY created_at, id',
        [electionId],
      );
      return rows.map((row) => ({
        name: row.name,
        rankings: JSON.parse(row.rankings),
        createdAt: row.createdAt,
      }));
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
    ballotPrivacy: row.ballot_privacy,
    security: row.security,
    status: row.status,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}
