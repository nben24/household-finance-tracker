// Runs the real migration files against an in-process Postgres (PGlite) so
// schema and Row Level Security can be tested without Docker or a Supabase
// project. The shim below recreates the small part of Supabase the
// migrations rely on: the auth schema, auth.uid(), and the API roles.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { toTransactionInsert } from "@/lib/db/types";
import type { SeedData } from "@/lib/seed/generate";

const MIGRATIONS_DIR = join(__dirname, "../../supabase/migrations");

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;
`;

export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** Creates a login; the migration's trigger creates the matching profile. */
export async function createUser(db: PGlite, email: string, name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ name })],
  );
  return result.rows[0].id;
}

async function insertRows(db: PGlite, table: string, rows: object[]) {
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    await db.query(
      `insert into public.${table} (${columns.join(", ")}) values (${placeholders})`,
      Object.values(row),
    );
  }
}

/** Inserts generated seed data the same way scripts/seed.ts does (as admin). */
export async function insertSeed(db: PGlite, seed: SeedData) {
  await insertRows(db, "households", [seed.household]);
  await insertRows(db, "household_members", seed.members);
  await insertRows(db, "categories", seed.categories.filter((c) => c.parent_id === null));
  await insertRows(db, "categories", seed.categories.filter((c) => c.parent_id !== null));
  await insertRows(db, "categorization_rules", seed.rules);
  await insertRows(db, "accounts", seed.accounts);
  await insertRows(db, "transactions", seed.transactions.map(toTransactionInsert));
  await insertRows(db, "budget_lines", seed.budgets);
  await insertRows(db, "account_balances", seed.balances);
}

/**
 * Runs a callback as a signed-in user (or as a signed-out visitor when
 * userId is null), exactly as a request through the Supabase API would.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  run: (db: PGlite) => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await run(db);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
