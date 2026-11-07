// Sets up a household in Supabase using the service-role key.
//
//   npm run db:seed        two demo logins + household + synthetic transactions
//   npm run db:bootstrap   your real logins + household + default categories and rules only
//   add `-- --reset` to delete the existing household of the same name first
//
// Run locally only. The service-role key bypasses Row Level Security.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HOUSEHOLD_TIME_ZONE } from "../src/lib/config";
import { todayInTimeZone } from "../src/lib/dates";
import { toTransactionInsert } from "../src/lib/db/types";
import { generateSeedData } from "../src/lib/seed/generate";

const args = process.argv.slice(2);
const withTransactions = !args.includes("--bootstrap");
const reset = args.includes("--reset");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Add it to .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

async function findOrCreateUser(
  supabase: SupabaseClient,
  email: string,
  name: string,
  password: string,
): Promise<string> {
  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) throw new Error(`Looking up ${email}: ${lookupError.message}`);
  if (existing) return existing.id as string;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) throw new Error(`Creating ${email}: ${error?.message}`);
  console.log(`Created login for ${email}`);
  return data.user.id;
}

async function insertInChunks(supabase: SupabaseClient, table: string, rows: object[]) {
  for (let start = 0; start < rows.length; start += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(start, start + 500));
    if (error) throw new Error(`Inserting into ${table}: ${error.message}`);
  }
}

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const password = requireEnv("SEED_USER_PASSWORD");
  const johnEmail = process.env.SEED_PERSON1_EMAIL || "john@example.com";
  const janeEmail = process.env.SEED_PERSON2_EMAIL || "jane@example.com";
  const johnName = process.env.SEED_PERSON1_NAME || "John";
  const janeName = process.env.SEED_PERSON2_NAME || "Jane";
  const householdName = process.env.SEED_HOUSEHOLD_NAME || "John & Jane";

  const { data: existing, error: existingError } = await supabase
    .from("households")
    .select("id")
    .eq("name", householdName);
  if (existingError) throw new Error(`Checking for household: ${existingError.message}`);
  if (existing.length > 0) {
    if (!reset) {
      console.error(`A household named "${householdName}" already exists. Re-run with -- --reset to replace it.`);
      process.exit(1);
    }
    const { error } = await supabase.from("households").delete().eq("name", householdName);
    if (error) throw new Error(`Removing old household: ${error.message}`);
    console.log("Removed the existing household and its data.");
  }

  const johnId = await findOrCreateUser(supabase, johnEmail, johnName, password);
  const janeId = await findOrCreateUser(supabase, janeEmail, janeName, password);

  const seed = generateSeedData({
    endDate: todayInTimeZone(HOUSEHOLD_TIME_ZONE),
    johnId,
    janeId,
    householdName,
  });

  await insertInChunks(supabase, "households", [seed.household]);
  await insertInChunks(supabase, "household_members", seed.members);
  // Parents first so subcategory foreign keys resolve.
  await insertInChunks(supabase, "categories", seed.categories.filter((c) => c.parent_id === null));
  await insertInChunks(supabase, "categories", seed.categories.filter((c) => c.parent_id !== null));
  await insertInChunks(supabase, "categorization_rules", seed.rules);

  if (withTransactions) {
    await insertInChunks(supabase, "accounts", seed.accounts);
    const transactions = seed.transactions.map(toTransactionInsert);
    await insertInChunks(supabase, "transactions", transactions);
    await insertInChunks(supabase, "budget_lines", seed.budgets);
    await insertInChunks(supabase, "account_balances", seed.balances);
    console.log(`Added ${seed.accounts.length} accounts and ${transactions.length} synthetic transactions.`);
  }

  console.log(`Household "${householdName}" is ready for ${johnEmail} and ${janeEmail}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
