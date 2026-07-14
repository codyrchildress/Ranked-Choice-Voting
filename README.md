# Runoff — ranked-choice voting

A small, self-hosted web app for holding **ranked elections** with a team, club, or friend group — counted by your choice of five methods.

- **Create an election** — add the options, pick the counting method (instant-runoff, STV, Borda, Condorcet, or contingent), choose how many ranked choices each voter gets (top 3, top 5, …), and pick the ballot privacy: **secret** (default) or **open ballots**, where voters sign their ballot and every name and ranking is published with the results.
- **Share one link** — anyone with the voter link casts one ballot. No accounts, no sign-ins. The ballot itself tells voters whether the election is secret or on the record.
- **Or hold a secure election** — switch the voter check to **one-time ballot codes**: generate single-use codes on the admin page (optionally labeled with names) and hand them out as personal links. Exactly one ballot per code, enforced server-side.
- **Results stay sealed** until the organizer closes voting; then the official count goes public — along with a "what if?" view recounting the same ballots under every other method, just for fun.

Elections are unlisted (random URLs) and each one is managed through a private **admin link** generated at creation time — there are no user accounts to run.

## Quick start

Requires **Node.js ≥ 22.13** (local mode uses the built-in `node:sqlite`; the only npm dependencies are Express and the Turso client).

```sh
npm install
npm start          # http://localhost:3000
```

`npm run dev` restarts on file changes. `npm test` runs the tabulation and API test suites.

## The five counting methods

Every ballot is the same — a ranking of up to K options — so the admin's chosen method decides how those rankings become a result, and the results page can recount the same ballots under all five:

| Method | In one line |
|---|---|
| **Instant-Runoff (IRV)** | Count 1st choices; repeatedly eliminate last place and transfer those ballots to their next surviving pick, until someone holds a majority of the still-active ballots. |
| **Single Transferable Vote (STV)** | Multi-winner IRV: the admin picks how many seats to fill. Options reaching the [Droop quota](https://en.wikipedia.org/wiki/Droop_quota) are elected and their **surplus** transfers onward at fractional weight (Gregory method), so few votes are wasted. |
| **Borda Count** | Every rank earns points (1st = K, 2nd = K−1, … unranked = 0). Highest total wins; rewards broad appeal and yields a full running order. |
| **Condorcet** | Every pair of options goes head-to-head; a winner must beat all rivals one-on-one. Paradox cycles fall back to the best win–loss record (Copeland's rule), then total vote margin. |
| **Contingent Vote** | If no option takes a majority of 1st choices, all but the top two are eliminated at once and every ballot backs whichever finalist it ranks higher. |

Shared rules, all deterministic:

- **Elimination and finalist ties** break by earlier-round totals where they exist, then a random draw **seeded from the election id** — so recounting always gives the same answer.
- **Exhausted ballots** (every ranked option eliminated) sit out the remaining rounds; majorities are computed over ballots still active.
- Exact unresolved ties are reported as ties rather than silently broken.

The engines live in [server/methods/](server/methods/) (one file per method, each covered by its own test suite in [test/](test/)) and results are recomputed from the stored ballots on demand — changing nothing about how ballots are cast or stored.

## Election lifecycle

| Status | Voters see | Admin can |
|---|---|---|
| **In setup** | "Not open yet" | Edit title/description, add/remove options, change the counting method, seats (STV), ranks per voter, ballot privacy, and voter check |
| **Voting open** | The ballot | Watch a private live tally (all five methods), manage ballot codes (generate more, revoke unused), close voting, or return to setup while no ballots exist |
| **Closed** | Results | Reopen voting (seals results again), delete the election |

Ranks per voter are clamped to the number of options when voting opens, and STV seats are clamped below the option count. Options and counting rules are locked while voting is open so every ballot is cast under the same rules.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port (self-hosted mode) |
| `RCV_DB_PATH` | `./data/runoff.db` | Local SQLite database file (directory is created automatically) |
| `TURSO_DATABASE_URL` | unset | When set, the app uses hosted [Turso](https://turso.tech) instead of the local file — this is what Vercel deployments use |
| `TURSO_AUTH_TOKEN` | unset | Auth token for the Turso database |
| `TRUST_PROXY` | unset | Set to `1` when running behind a reverse proxy so rate limits key on the real client IP (automatic on Vercel) |

The database layer has two interchangeable drivers behind one interface ([server/db.js](server/db.js)): the built-in `node:sqlite` file for local dev, tests, Docker, and VPS hosting, and Turso (hosted libSQL — same SQL dialect) for serverless hosting. The schema is created automatically on first use in both.

## Deploying to Vercel + Turso (free)

The repo is pre-configured for this ([vercel.json](vercel.json) + [api/index.js](api/index.js) run the same Express app as a serverless function; static files come off Vercel's CDN):

1. **Create the database** — install the [Turso CLI](https://docs.turso.tech/cli/installation) (or use their dashboard) and run:
   ```sh
   turso db create runoff
   turso db show runoff --url        # -> TURSO_DATABASE_URL
   turso db tokens create runoff     # -> TURSO_AUTH_TOKEN
   ```
2. **Import the repo on [vercel.com](https://vercel.com/new)** — framework preset "Other", no build command. Add the two environment variables from step 1.
3. **Deploy.** Tables are created automatically on the first request. Create a test election to confirm, and note its admin link works before sharing anything real.

Notes for serverless: the rate limiter is per-instance (best-effort) there, and Vercel's Hobby tier is for non-commercial use.

## Self-hosting

Alternatively, run it as a single Node process with the SQLite file — anywhere Node runs. Point `RCV_DB_PATH` at a **persistent disk** and put HTTPS in front of it.

**Docker**

```sh
docker build -t runoff .
docker run -p 3000:3000 -v runoff-data:/data runoff
```

**Fly.io** — `fly launch`, add a volume (`fly volumes create runoff_data`), mount it at `/data`, and set `RCV_DB_PATH=/data/runoff.db`.

**Railway / Render / a VPS** — run `npm start` with a volume or disk mounted for the data directory. On a VPS, a systemd unit plus Caddy/nginx for TLS is plenty.

> Free tiers with **ephemeral** filesystems (e.g. Render free) will lose the database on every restart — use a hosted disk/volume, or accept that elections are throwaway.

## Trust model — read before using for anything serious

This is a tool for **casual, good-faith elections** (team decisions, club votes, friend groups):

- **One ballot per browser** (the default, link-shared mode) is enforced with a cookie. A determined person can clear cookies or use another browser to vote again. Voter names are unverified — in an open-ballot election, anyone could sign someone else's name, so open ballots rely on the same good faith as a show of hands.
- **Secure mode: one-time ballot codes.** Switching the voter check to codes makes "one person, one vote" real: each code is claimed atomically by exactly one ballot, invalid or reused codes are rejected, and the browser cookie stops being the gate (so two people can share a device). Codes are bearer tokens, like paper tickets — whoever holds one can vote with it — and the admin page stores them in plain text so the organizer can re-copy them. Codes are never linked to the ballot they cast, so labeled codes don't compromise a secret ballot.
- **Admin power is a secret link.** Anyone who has the admin URL controls the election; if you lose it, it cannot be recovered.
- **Ballot privacy is per-election and locked once voting opens.** Secret ballots (default): rankings are never linked to names in any view; an optional name feeds only the organizer's turnout roster. Open ballots: voters must sign, and every name and full ranking is published with the results (the admin sees them live). The ballot page states which mode applies before anyone votes.
- Anyone who can reach the site can create elections. To restrict who can *host* elections, put the whole app behind an auth proxy (Cloudflare Access, Tailscale, basic auth) — voters and admins are unaffected since links carry the access.

Hardening ideas if you outgrow this: per-voter one-time ballot codes, email verification, or real accounts.

## API overview

All endpoints are JSON under `/api`. The interesting ones:

| Method & path | What it does |
|---|---|
| `POST /api/elections` | Create (`{title, description?, numRanks, method?, numWinners?, ballotPrivacy?, security?, candidates[]}`) → returns the one-time `adminToken` |
| `GET /api/elections/:id` | Public election info + your voted status |
| `POST /api/elections/:id/ballots` | Cast `{rankings: [candidateId…], voterName?, code?}` (only while open; `code` required for code-secured elections) |
| `GET /api/elections/:id/codes/:code` | Pre-check a ballot code: `{ok, label?}` or `{ok: false, reason: "used"\|"invalid"}` |
| `POST /api/admin/:token/codes` · `DELETE …/codes/:codeId` | Generate codes (`{count}` or `{labels: [name…]}`) · revoke an unused code |
| `GET /api/elections/:id/results` | The official result plus recounts under all five methods (and the signed ballots, for open-ballot elections) — `403` until the election closes |
| `GET /api/admin/:token` | Everything, including the live tally and voter roster |
| `POST /api/admin/:token/status` | `{status: "open" \| "closed" \| "draft"}` transitions |
| `PATCH /api/admin/:token` | Edit title/description (anytime); numRanks, method, numWinners (setup only) |
| `POST /api/admin/:token/candidates` · `DELETE …/candidates/:cid` | Edit options (setup only) |
| `DELETE /api/admin/:token` | Delete the election and all its ballots |

Admin tokens are 144-bit random strings stored only as SHA-256 hashes.

## Project layout

```
server/
  index.js      self-hosted entry point (start server, graceful shutdown)
  app.js        Express wiring: security headers, static files, page routes
  api.js        REST endpoints, validation, rate limiting
  store.js      all SQL, async
  db.js         driver chooser (local file vs Turso)
  db-local.js   node:sqlite driver (dev, tests, Docker, VPS)
  db-turso.js   hosted libSQL driver (Vercel)
  schema.js     shared table definitions + additive migrations
  tabulate.js   tally registry: runs every counting method
  methods/      one pure engine per method (irv, stv, borda,
                condorcet, contingent) + shared tiebreak helpers
  ids.js        short ids, admin tokens, hashing
api/index.js    Vercel serverless entry (same Express app)
vercel.json     Vercel routing + security headers
public/         no-build-step frontend (vanilla ES modules)
test/           node:test suites: tabulation math + full API lifecycle
```
