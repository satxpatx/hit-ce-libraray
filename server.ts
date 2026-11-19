import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { initSchema } from './server/db.ts';
import { seedDatabaseIfEmpty } from './server/seed.ts';
import { coreRouter } from './server/routesCore.ts';
import { extendedRouter } from './server/routesExtended.ts';

// Initialize relational database tables and demonstration dataset on first run
initSchema();
seedDatabaseIfEmpty();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Basic security headers (preserving AI Studio iframe compatibility)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Serve uploaded institutional logos statically
app.use('/uploads/logos', express.static(path.resolve(process.cwd(), 'uploads', 'logos')));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'HIT Civil Engineering – Digital Library' });
});

// Mount REST API routes
app.use('/api', coreRouter);
app.use('/api', extendedRouter);

// Serve frontend via Vite middleware in dev or static dist in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HIT Civil Engineering – Digital Library server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
