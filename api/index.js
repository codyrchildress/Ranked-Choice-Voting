// Vercel serverless entry. vercel.json rewrites /api/* here, and Vercel
// hands the function the original request URL, so the Express app routes
// exactly as it does when self-hosted. One app per warm instance.
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';

const ready = openDatabase().then((db) => createApp({ db }));

export default async function handler(req, res) {
  (await ready)(req, res);
}
