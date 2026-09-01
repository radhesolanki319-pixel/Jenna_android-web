/**
 * Entry point — the server implementation lives in server/.
 * Kept as a thin bootstrap so existing scripts (`npm run dev`, esbuild
 * bundling to dist/server.cjs) keep working unchanged.
 */

import dotenv from 'dotenv';

dotenv.config();

import { startServer } from './server/index';

startServer();
