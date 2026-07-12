# Runoff — ranked-choice voting

A small, self-hosted web app for holding **instant-runoff (ranked-choice) elections** with a team, club, or friend group.

- **Create an election** — add the options and choose how many ranked choices each voter gets (top 3, top 5, …).
- **Share one link** — anyone with the voter link casts one ballot. No accounts, no sign-ins.
- **Results stay sealed** until the organizer closes voting; then the full round-by-round count goes public.

Elections are unlisted (random URLs) and each one is managed through a private **admin link** generated at creation time — there are no user accounts to run.

## Quick start

Requires **Node.js ≥ 22.13** (local mode uses the built-in `node:sqlite`; the only npm dependencies are Express and the Turso client).

```sh
npm install
npm start          # http://localhost:3000
```

`npm run dev` restarts on file changes. `npm test` runs the tabulation and API test suites.

## How a vote is counted

Runoff uses single-winner **instant-runoff voting (IRV)**:

1. Every ballot counts for its highest-ranked option still in the race.
2. If an option holds a **majority of active ballots** (more than half), it wins.
3. Otherwise the last-place option is eliminated and its ballots transfer to each voter's next surviving choice. Repeat.

Details, all covered by tests in [test/tabulate.test.js](test/tabulate.test.js):

- **Exhausted ballots** — if every option a voter ranked has been eliminated, their ballot sits out the remaining rounds; majorities are computed over ballots still active.
- **Zero-vote options** are eliminated together in one round (they have no ballots to transfer).
- **Elimination ties** break by comparing earlier-round totals (most recent first); a tie across all rounds is broken by a random draw **seeded from the election id**, so recounts are deterministic.
- An exact tie between the final options is reported as a tie.

The whole algorithm lives in [server/tabulate.js](server/tabulate.js) and results are recomputed from the stored ballots on demand.

## Election lifecycle

| Status | Voters see | Admin can |
|---|---|---|
| **In setup** | "Not open yet" | Edit title/description, add/remove options, change ranks per voter |
| **Voting open** | The ballot | Watch a private live tally, close voting, or return to setup while no ballots exist |
| **Closed** | Results | Reopen voting (seals results again), delete the election |

Ranks per voter are clamped to the number of options when voting opens. Options are locked while voting is open so every ballot refers to the same candidate set.

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

- **One ballot per browser** is enforced with a cookie. A determined person can clear cookies or use another browser to vote again. Voter names are optional and unverified.
- **Admin power is a secret link.** Anyone who has the admin URL controls the election; if you lose it, it cannot be recovered.
- Ballot rankings are stored anonymously; optional voter names are shown only on the admin page (as a turnout roster, not linked to rankings in the UI).
- Anyone who can reach the site can create elections. To restrict who can *host* elections, put the whole app behind an auth proxy (Cloudflare Access, Tailscale, basic auth) — voters and admins are unaffected since links carry the access.

Hardening ideas if you outgrow this: per-voter one-time ballot codes, email verification, or real accounts.

## API overview

All endpoints are JSON under `/api`. The interesting ones:

| Method & path | What it does |
|---|---|
| `POST /api/elections` | Create (`{title, description?, numRanks, candidates[]}`) → returns the one-time `adminToken` |
| `GET /api/elections/:id` | Public election info + your voted status |
| `POST /api/elections/:id/ballots` | Cast `{rankings: [candidateId…], voterName?}` (only while open) |
| `GET /api/elections/:id/results` | Full rounds/transfers/winners — `403` until the election closes |
| `GET /api/admin/:token` | Everything, including the live tally and voter roster |
| `POST /api/admin/:token/status` | `{status: "open" \| "closed" \| "draft"}` transitions |
| `PATCH /api/admin/:token` | Edit title/description (anytime) and numRanks (setup only) |
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
  schema.js     shared table definitions
  tabulate.js   the instant-runoff engine (pure function)
  ids.js        short ids, admin tokens, hashing
api/index.js    Vercel serverless entry (same Express app)
vercel.json     Vercel routing + security headers
public/         no-build-step frontend (vanilla ES modules)
test/           node:test suites: tabulation math + full API lifecycle
```
