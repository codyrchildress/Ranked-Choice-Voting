import path from 'node:path';
import express from 'express';
import { createApiRouter } from './api.js';

const publicDir = path.join(import.meta.dirname, '..', 'public');

export function createApp({ db, rateLimits }) {
  const app = express();
  app.disable('x-powered-by');
  // Vercel (and any reverse proxy) forwards the real client IP in
  // x-forwarded-for; trust it so rate limits key on the voter, not the proxy.
  if (process.env.TRUST_PROXY || process.env.VERCEL) app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com',
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    next();
  });

  app.use('/api', createApiRouter({ db, rateLimits }));

  app.use(express.static(publicDir, {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  }));

  const page = (name) => (req, res) => res.sendFile(path.join(publicDir, name));
  app.get('/e/:id', page('vote.html'));
  app.get('/e/:id/results', page('results.html'));
  app.get('/a/:token', page('admin.html'));

  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  return app;
}
