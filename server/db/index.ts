/**
 * Jarvis server persistence — SQLite via node:sqlite (built into Node 22+).
 * Stores agent runs, tool-call logs, and encrypted account connections.
 * Zero native-module dependencies; DB file lives outside git (data/ is ignored).
 */

import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createRequire } from 'node:module';
import path from 'path';
import fs from 'fs';

// Loaded via createRequire so Vite/Vitest bundlers don't try to statically
// resolve the (Node 22+) built-in module.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export interface AgentRunRow {
  id: string;
  status: string;
  mode: string;
  plan_json: string | null;
  events_json: string;
  created_at: number;
  updated_at: number;
}

export interface ToolCallRow {
  id: string;
  run_id: string;
  tool_id: string;
  args_json: string;
  result_json: string | null;
  permission: string;
  approved: number;
  created_at: number;
}

export interface ConnectionRow {
  provider: string;
  enc_blob: string;
  scopes: string;
  created_at: number;
  updated_at: number;
}

let db: DatabaseSyncType | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  plan_json TEXT,
  events_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  args_json TEXT NOT NULL,
  result_json TEXT,
  permission TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(run_id);
CREATE TABLE IF NOT EXISTS connections (
  provider TEXT PRIMARY KEY,
  enc_blob TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function getDb(): DatabaseSyncType {
  if (db) return db;
  const dataDir = process.env.JARVIS_DATA_DIR || path.join(process.cwd(), 'data');
  let location: string;
  if (process.env.JARVIS_DB_MEMORY === 'true') {
    location = ':memory:';
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    location = path.join(dataDir, 'jarvis.sqlite');
  }
  db = new DatabaseSync(location);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Test hook: close and reset the singleton. */
export function _closeDb(): void {
  try {
    db?.close();
  } catch {
    // ignore
  }
  db = null;
}

// ---------------------------------------------------------------------------
// Agent runs
// ---------------------------------------------------------------------------

export function insertRun(run: {
  id: string;
  status: string;
  mode: string;
}): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO agent_runs (id, status, mode, events_json, created_at, updated_at)
       VALUES (?, ?, ?, '[]', ?, ?)`
    )
    .run(run.id, run.status, run.mode, now, now);
}

export function updateRun(
  id: string,
  fields: { status?: string; planJson?: string; eventsJson?: string }
): void {
  const existing = getRun(id);
  if (!existing) return;
  getDb()
    .prepare(
      `UPDATE agent_runs SET status = ?, plan_json = ?, events_json = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      fields.status ?? existing.status,
      fields.planJson ?? existing.plan_json,
      fields.eventsJson ?? existing.events_json,
      Date.now(),
      id
    );
}

export function getRun(id: string): AgentRunRow | undefined {
  return getDb().prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as unknown as
    | AgentRunRow
    | undefined;
}

// ---------------------------------------------------------------------------
// Tool call log
// ---------------------------------------------------------------------------

export function logToolCall(row: {
  id: string;
  runId: string;
  toolId: string;
  argsJson: string;
  permission: string;
  approved: boolean;
}): void {
  getDb()
    .prepare(
      `INSERT INTO tool_calls (id, run_id, tool_id, args_json, permission, approved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(row.id, row.runId, row.toolId, row.argsJson, row.permission, row.approved ? 1 : 0, Date.now());
}

export function completeToolCall(id: string, resultJson: string): void {
  getDb().prepare(`UPDATE tool_calls SET result_json = ? WHERE id = ?`).run(resultJson, id);
}

export function getToolCallsForRun(runId: string): ToolCallRow[] {
  return getDb()
    .prepare(`SELECT * FROM tool_calls WHERE run_id = ? ORDER BY created_at ASC`)
    .all(runId) as unknown as ToolCallRow[];
}

// ---------------------------------------------------------------------------
// Connections (encrypted blobs — encryption handled by connections/store.ts)
// ---------------------------------------------------------------------------

export function upsertConnection(provider: string, encBlob: string, scopes: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO connections (provider, enc_blob, scopes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET enc_blob = excluded.enc_blob,
         scopes = excluded.scopes, updated_at = excluded.updated_at`
    )
    .run(provider, encBlob, scopes, now, now);
}

export function getConnection(provider: string): ConnectionRow | undefined {
  return getDb().prepare(`SELECT * FROM connections WHERE provider = ?`).get(provider) as unknown as
    | ConnectionRow
    | undefined;
}

export function deleteConnection(provider: string): void {
  getDb().prepare(`DELETE FROM connections WHERE provider = ?`).run(provider);
}

export function listConnections(): Array<{ provider: string; scopes: string; createdAt: number }> {
  const rows = getDb()
    .prepare(`SELECT provider, scopes, created_at FROM connections`)
    .all() as unknown as Array<{ provider: string; scopes: string; created_at: number }>;
  return rows.map((r) => ({ provider: r.provider, scopes: r.scopes, createdAt: r.created_at }));
}
