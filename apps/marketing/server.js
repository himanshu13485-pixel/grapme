/**
 * Standalone entry point for hosts that start Node apps by requiring a file
 * directly (e.g. cPanel's "Setup Node.js App" / Phusion Passenger), rather
 * than running `next start` via a shell. Reads the port the host assigns via
 * the PORT env var (falls back to 3200 for local use).
 */
const { createServer } = require('http');
const next = require('next');

const port = process.env.PORT || 3200;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, () => {
    console.log(`GrapMe marketing site listening on port ${port}`);
  });
});
