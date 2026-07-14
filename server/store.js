import { shortId } from './ids.js';

// elections.num_ranks/method/num_winners are legacy columns (counting rules
// live on questions now); constants keep the NOT NULL happy on old schemas.
const INSERT_ELECTION = `INSERT INTO elections (id, admin_token_hash, title, description, num_ranks, method, num_winners, ballot_privacy, security, status, created_at)
   VALUES (?, ?, ?, ?, 1, 'borda', 1, ?, ?, 'draft', ?)`;
const INSERT_QUESTION = `INSERT INTO questions (id, election_id, prompt, position, method, num_ranks, num_winners)
   VALUES (?, ?, ?, ?, ?, ?, ?)`;
const INSERT_CANDIDATE =
  'INSERT INTO candidates (id, election_id, question_id, name, position) VALUES (?, ?, ?, ?, ?)';

export function createStore(db) {
  return {
    async createElection({ title, description, ballotPrivacy, security, questions, adminTokenHash }) {
      for (let attempt = 0; ; attempt += 1) {
        const id = shortId(10);
        try {
          const statements = [
            {
              sql: INSERT_ELECTION,
              args: [id, adminTokenHash, title, description, ballotPrivacy, security, Date.now()],
            },
          ];
          questions.forEach((question, qIndex) => {
            const questionId = shortId(8);
            statements.push({
              sql: INSERT_QUESTION,
              args: [questionId, id, question.prompt, qIndex + 1, question.method, question.numRanks, question.numWinners],
            });
            question.candidateNames.forEach((name, cIndex) => {
              statements.push({
                sql: INSERT_CANDIDATE,
                args: [shortId(8), id, questionId, name, cIndex + 1],
              });
            });
          });
          await db.batch(statements);
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
        `UPDATE elections SET title = ?, description = ?, ballot_privacy = ?, security = ?, status = ?, opened_at = ?, closed_at = ?
         WHERE id = ?`,
        [el.title, el.description, el.ballotPrivacy, el.security, el.status, el.openedAt ?? null, el.closedAt ?? null, el.id],
      );
    },

    // Explicit cascade so behavior doesn't depend on the server's
    // foreign_keys pragma; the batch keeps it atomic.
    async deleteElection(id) {
      await db.batch([
        { sql: 'DELETE FROM ballots WHERE election_id = ?', args: [id] },
        { sql: 'DELETE FROM ballot_codes WHERE election_id = ?', args: [id] },
        { sql: 'DELETE FROM candidates WHERE election_id = ?', args: [id] },
        { sql: 'DELETE FROM questions WHERE election_id = ?', args: [id] },
        { sql: 'DELETE FROM elections WHERE id = ?', args: [id] },
      ]);
    },

    // ---- questions ----

    async listQuestions(electionId) {
      const rows = await db.query(
        `SELECT id, prompt, position, method, num_ranks AS numRanks, num_winners AS numWinners
         FROM questions WHERE election_id = ? ORDER BY position, rowid`,
        [electionId],
      );
      return rows.map((row) => ({
        id: row.id,
        prompt: row.prompt,
        position: row.position,
        method: row.method,
        numRanks: row.numRanks,
        numWinners: row.numWinners,
      }));
    },

    async getQuestion(electionId, questionId) {
      const rows = await db.query(
        `SELECT id, prompt, position, method, num_ranks AS numRanks, num_winners AS numWinners
         FROM questions WHERE election_id = ? AND id = ?`,
        [electionId, questionId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        prompt: row.prompt,
        position: row.position,
        method: row.method,
        numRanks: row.numRanks,
        numWinners: row.numWinners,
      };
    },

    async addQuestion(electionId, { prompt, method, numRanks, numWinners }) {
      await db.run(
        `INSERT INTO questions (id, election_id, prompt, position, method, num_ranks, num_winners)
         SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1, ?, ?, ? FROM questions WHERE election_id = ?`,
        [shortId(8), electionId, prompt, method, numRanks, numWinners, electionId],
      );
    },

    async saveQuestion(question) {
      await db.run(
        'UPDATE questions SET prompt = ?, method = ?, num_ranks = ?, num_winners = ? WHERE id = ?',
        [question.prompt, question.method, question.numRanks, question.numWinners, question.id],
      );
    },

    async removeQuestion(electionId, questionId) {
      await db.batch([
        { sql: 'DELETE FROM candidates WHERE question_id = ? AND election_id = ?', args: [questionId, electionId] },
        { sql: 'DELETE FROM questions WHERE id = ? AND election_id = ?', args: [questionId, electionId] },
      ]);
    },

    // ---- candidates ----

    async listCandidatesByElection(electionId) {
      const rows = await db.query(
        'SELECT id, question_id AS questionId, name FROM candidates WHERE election_id = ? ORDER BY position, rowid',
        [electionId],
      );
      return rows.map((row) => ({ id: row.id, questionId: row.questionId, name: row.name }));
    },

    async addCandidate(electionId, questionId, name) {
      await db.run(
        `INSERT INTO candidates (id, election_id, question_id, name, position)
         SELECT ?, ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM candidates WHERE question_id = ?`,
        [shortId(8), electionId, questionId, name, questionId],
      );
    },

    async removeCandidate(questionId, candidateId) {
      const { changes } = await db.run('DELETE FROM candidates WHERE id = ? AND question_id = ?', [
        candidateId,
        questionId,
      ]);
      return changes > 0;
    },

    // ---- ballots ----

    async insertBallot({ electionId, voterName, answers }) {
      const id = shortId(12);
      await db.run(
        'INSERT INTO ballots (id, election_id, voter_name, rankings, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, electionId, voterName, JSON.stringify(answers), Date.now()],
      );
      return id;
    },

    // Each ballot's answers: {questionId: [candidateId, ...], ...}
    async listAnswers(electionId) {
      const rows = await db.query(
        'SELECT rankings FROM ballots WHERE election_id = ? ORDER BY created_at, rowid',
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
        'SELECT voter_name AS name, created_at AS createdAt FROM ballots WHERE election_id = ? ORDER BY created_at, rowid',
        [electionId],
      );
      return rows.map((row) => ({ name: row.name, createdAt: row.createdAt }));
    },

    // Full signed ballots — only ever exposed for open-ballot elections.
    async listSignedBallots(electionId) {
      const rows = await db.query(
        'SELECT voter_name AS name, rankings, created_at AS createdAt FROM ballots WHERE election_id = ? ORDER BY created_at, rowid',
        [electionId],
      );
      return rows.map((row) => ({
        name: row.name,
        answers: JSON.parse(row.rankings),
        createdAt: row.createdAt,
      }));
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
  };
}

function mapElection(row) {
  if (!row) return null;
  return {
    id: row.id,
    adminTokenHash: row.admin_token_hash,
    title: row.title,
    description: row.description,
    ballotPrivacy: row.ballot_privacy,
    security: row.security,
    status: row.status,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}
