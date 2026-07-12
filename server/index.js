import { createApp } from './app.js';
import { openDatabase } from './db.js';

const db = await openDatabase();
const app = createApp({ db });

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
  console.log(`Runoff is listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  });
}
