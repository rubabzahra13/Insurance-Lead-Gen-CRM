import express from 'express';
import cors from 'cors';
import { mountScrapeRoutes } from './src/scrape-routes.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

mountScrapeRoutes(app);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'scraper' });
});

export default app;

if (!process.env.VERCEL) {
  const port = Number(process.env.SCRAPER_PORT || process.env.PORT || 3002);
  app.listen(port, () => {
    console.log(`Scraper API → http://localhost:${port}`);
  });
}
