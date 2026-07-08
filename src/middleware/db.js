import { initDb } from '../db/index.js';

export function attachDb() {
  return async (_req, res, next) => {
    try {
      await initDb();
      next();
    } catch (error) {
      next(error);
    }
  };
}
