import "server-only";
import type {
  MonthClosingRow,
  SplitRow,
  AccountCoverageRow,
  ImportBatchRow,
  IncomeSourceRow,
  AccountBalanceRow,
  AccountRow,
  BudgetLineRow,
  RecurringOverrideRow,
  CategorizationRuleRow,
  CategoryRow,
  HouseholdMemberRow,
  HouseholdRow,
  ProfileRow,
  TransactionRow,
} from "@/lib/db/types";
import { SHARED_SPENDING_MODE } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { BudgetError, SplitError, UndoError, type DataSource, type Member, type Page, type TransactionFilter } from "./types";

const FETCH_ALL_CHUNK = 1000;
const INSERT_CHUNK = 500;
const UPDATE_CHUNK = 200;
export const DUPLICATE_CATEGORY = "There's already a category with that name here.";
export const MISSING_MIGRATION =
  "The database needs an update. Ask the person who set up the app to apply the latest database update.";

function fail(action: string, error: { message: string }): never {
  throw new Error(`Could not ${action}: ${error.message}`);
}

/** Turns the budget functions' refusals into BudgetError; a missing function means the database needs its update. */
function budgetFailure(action: string, error: { message: string; code?: string }): never {
  if (error.code === "PGRST202" || error.code === "42883") throw new Error(MISSING_MIGRATION);
  for (const reason of ["conflict", "stale", "not_found"] as const) {
    if (error.message.includes(`budget_${reason}`)) throw new BudgetError(reason);
  }
  fail(action, error);
}

/** Keep only characters that are safe inside a PostgREST `or` filter. */
export function sanitizeSearch(search: string): string {
  return search.replace(/[^\p{L}\p{N} '&.\-]/gu, " ").trim().slice(0, 80);
}

// Split parts are loaded with their transaction. Until the split-purchases
// update is applied the relationship doesn't exist; then rows load without them.
let splitsAvailable = true;
const WITH_SPLITS = "*, transaction_splits(*)";

function withSplits(row: Record<string, unknown>): TransactionRow {
  const { transaction_splits: parts, ...rest } = row as Record<string, unknown> & { transaction_splits?: SplitRow[] };
  const splits = (parts ?? [])
    .map((part) => ({ ...part, amount: Number(part.amount) }))
    .sort((a, b) => a.position - b.position);
  return { ...(rest as unknown as TransactionRow), amount: Number(rest.amount), ...(splits.length > 0 ? { splits } : {}) };
}

function isMissingRelation(error: { code?: string }) {
  return error.code === "PGRST200" || error.code === "42P01" || error.code === "PGRST205";
}

async function fetchTransactions(
  householdId: string,
  filter: TransactionFilter,
  page: Page,
  { withTotal = true }: { withTotal?: boolean } = {},
): Promise<{ rows: TransactionRow[]; total: number }> {
  try {
    return await fetchTransactionsOnce(householdId, filter, page, withTotal, splitsAvailable);
  } catch (error) {
    if (splitsAvailable && error instanceof MissingSplits) {
      splitsAvailable = false;
      return fetchTransactionsOnce(householdId, filter, page, withTotal, false);
    }
    throw error;
  }
}

class MissingSplits extends Error {}

async function fetchTransactionsOnce(
  householdId: string,
  filter: TransactionFilter,
  page: Page,
  withTotal: boolean,
  includeSplits: boolean,
): Promise<{ rows: TransactionRow[]; total: number }> {
  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    // Counting every match is extra work for the database; only a page needs the total.
    .select(includeSplits ? WITH_SPLITS : "*", withTotal ? { count: "exact" } : undefined)
    .eq("household_id", householdId);

  if (filter.from) query = query.gte("transaction_date", filter.from);
  if (filter.to) query = query.lte("transaction_date", filter.to);
  if (filter.accountId) query = query.eq("account_id", filter.accountId);
  if (filter.categoryId) query = query.eq("category_id", filter.categoryId);
  if (filter.personId === "household") query = query.is("person_id", null);
  else if (filter.personId) query = query.eq("person_id", filter.personId);
  if (filter.needsReview) query = query.eq("review_status", "needs_review");
  if (filter.awaitingPost) query = query.eq("awaiting_post", true);
  if (filter.importBatchId) query = query.eq("import_batch_id", filter.importBatchId);
  const search = filter.search ? sanitizeSearch(filter.search) : "";
  if (search) {
    query = query.or(
      `normalized_merchant.ilike."%${search}%",original_description.ilike."%${search}%"`,
    );
  }

  const sort = page.sort ?? "newest";
  if (sort === "largest_out" || sort === "largest_in") {
    query = query.order("amount", { ascending: sort === "largest_out" });
  }
  const { data, error, count } = await query
    .order("transaction_date", { ascending: sort === "oldest" })
    .order("id", { ascending: true })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) {
    if (includeSplits && isMissingRelation(error)) throw new MissingSplits();
    fail("load transactions", error);
  }

  const rows = (data as unknown as Record<string, unknown>[]).map(withSplits);
  return { rows, total: count ?? rows.length };
}

export const supabaseDataSource: DataSource = {
  async getSession() {
    const supabase = await createClient();
    // Verifies the signed login token without a trip to the auth server when
    // the project uses signing keys (it asks the server otherwise).
    const { data: auth } = await supabase.auth.getClaims();
    const claims = auth?.claims;
    if (!claims?.sub) return null;
    const userId = claims.sub;
    const email = typeof claims.email === "string" ? claims.email : "";
    const fallbackName = email.split("@")[0] ?? "";

    // One request: my first household, with everyone in it and their names.
    const { data: membership, error } = await supabase
      .from("household_members")
      .select("households(*, household_members(*, profiles(*)))")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) fail("load your household", error);

    type Joined = HouseholdRow & { household_members: (HouseholdMemberRow & { profiles: ProfileRow | null })[] };
    const household = (membership as { households: Joined | null } | null)?.households;
    if (!household) {
      return { user: { id: userId, email, name: fallbackName }, household: null, members: [], isDemo: false };
    }

    const { household_members: memberships, ...householdRow } = household;
    const members: Member[] = memberships
      .flatMap((member) => (member.profiles ? [{ ...member.profiles, role: member.role }] : []))
      .sort((a, b) => a.name.localeCompare(b.name));

    const me = members.find((member) => member.id === userId);
    return {
      user: { id: userId, email, name: me?.name || fallbackName },
      household: householdRow,
      members,
      isDemo: false,
    };
  },

  async listAccounts(householdId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("household_id", householdId)
      .order("institution")
      .order("account_name");
    if (error) fail("load accounts", error);
    return data as AccountRow[];
  },

  async listCategories(householdId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("household_id", householdId)
      .order("sort_order")
      .order("name");
    if (error) fail("load categories", error);
    return data as CategoryRow[];
  },

  async listTransactions(householdId, filter = {}, page) {
    if (page) return fetchTransactions(householdId, filter, page);

    // The first batch says how many match; the rest are fetched at the same time.
    const first = await fetchTransactions(householdId, filter, { limit: FETCH_ALL_CHUNK, offset: 0 });
    const offsets: number[] = [];
    for (let offset = FETCH_ALL_CHUNK; offset < first.total; offset += FETCH_ALL_CHUNK) offsets.push(offset);
    const rest = await Promise.all(
      offsets.map((offset) =>
        fetchTransactions(householdId, filter, { limit: FETCH_ALL_CHUNK, offset }, { withTotal: false }),
      ),
    );
    const rows = [first, ...rest].flatMap((chunk) => chunk.rows);
    return { rows, total: rows.length };
  },

  async createAccount(householdId, account) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("accounts")
      .insert({ ...account, household_id: householdId })
      .select("*")
      .single();
    if (error) fail("add the account", error);
    return data as AccountRow;
  },

  async listSourceHashes(householdId, accountId, from, to) {
    const supabase = await createClient();
    const hashes: string[] = [];
    for (let offset = 0; ; offset += FETCH_ALL_CHUNK) {
      const { data, error } = await supabase
        .from("transactions")
        .select("source_hash")
        .eq("household_id", householdId)
        .eq("account_id", accountId)
        .gte("transaction_date", from)
        .lte("transaction_date", to)
        .not("source_hash", "is", null)
        .order("id")
        .range(offset, offset + FETCH_ALL_CHUNK - 1);
      if (error) fail("check for duplicates", error);
      hashes.push(...(data as { source_hash: string }[]).map((row) => row.source_hash));
      if (data.length < FETCH_ALL_CHUNK) break;
    }
    return hashes;
  },

  async insertTransactions(rows) {
    const supabase = await createClient();
    let added = 0;
    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      const { data, error } = await supabase
        .from("transactions")
        .upsert(rows.slice(start, start + INSERT_CHUNK), {
          onConflict: "account_id,source_hash",
          ignoreDuplicates: true,
        })
        .select("id");
      // 42P10: the unique index from the import_fingerprint migration is missing
      if (error?.code === "42P10") throw new Error(MISSING_MIGRATION);
      if (error) fail("save transactions", error);
      added += data.length;
    }
    return added;
  },

  async fillBankCategories(householdId, rows) {
    const supabase = await createClient();
    const groups = new Map<string, { accountId: string; bankCategory: string; hashes: string[] }>();
    for (const row of rows) {
      if (!row.bank_category) continue;
      const key = `${row.account_id}|${row.bank_category}`;
      const group = groups.get(key) ?? { accountId: row.account_id, bankCategory: row.bank_category, hashes: [] };
      group.hashes.push(row.source_hash);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      for (let start = 0; start < group.hashes.length; start += UPDATE_CHUNK) {
        const { error } = await supabase
          .from("transactions")
          .update({ bank_category: group.bankCategory })
          .eq("household_id", householdId)
          .eq("account_id", group.accountId)
          .is("bank_category", null)
          .in("source_hash", group.hashes.slice(start, start + UPDATE_CHUNK));
        if (error) fail("update transactions", error);
      }
    }
  },

  async getTransaction(householdId, id) {
    const supabase = await createClient();
    const load = (columns: string) =>
      supabase.from("transactions").select(columns).eq("household_id", householdId).eq("id", id).maybeSingle();
    let { data, error } = await load(splitsAvailable ? WITH_SPLITS : "*");
    if (error && splitsAvailable && isMissingRelation(error)) {
      splitsAvailable = false;
      ({ data, error } = await load("*"));
    }
    if (error) fail("load the transaction", error);
    return data ? withSplits(data as unknown as Record<string, unknown>) : null;
  },

  async transactionsByIds(householdId, ids) {
    const supabase = await createClient();
    const rows: TransactionRow[] = [];
    for (let start = 0; start < ids.length; start += UPDATE_CHUNK) {
      const { data, error } = await supabase
        .from("transactions")
        .select(splitsAvailable ? WITH_SPLITS : "*")
        .eq("household_id", householdId)
        .in("id", ids.slice(start, start + UPDATE_CHUNK));
      if (error) fail("load transactions", error);
      rows.push(...(data as unknown as Record<string, unknown>[]).map(withSplits));
    }
    return rows;
  },

  async recordReviewOperation(householdId, operation) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("review_operations")
      .insert({ ...operation, household_id: householdId })
      .select("id")
      .single();
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
      fail("remember the decision", error);
    }
    return (data as { id: string }).id;
  },

  async undoReviewOperation(householdId, id) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("undo_review_operation", { target_operation_id: id });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") throw new Error(MISSING_MIGRATION);
      if (error.message.includes("undo_conflict")) throw new UndoError("conflict");
      if (error.message.includes("undo_gone")) throw new UndoError("gone");
      fail("undo the decision", error);
    }
  },

  async saveSplits(householdId, transactionId, parts) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_transaction_splits", {
      target_transaction_id: transactionId,
      splits: parts.map((part) => ({
        category_id: part.category_id,
        subcategory_id: part.subcategory_id ?? "",
        amount: part.amount,
        note: part.note ?? "",
        refund_of_split_id: part.refund_of_split_id ?? "",
      })),
    });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") throw new Error(MISSING_MIGRATION);
      const reason = /split_(not_found|kind|count|sign|total)/.exec(error.message)?.[1];
      if (reason) throw new SplitError(reason as SplitError["reason"]);
      fail("save the split", error);
    }
  },

  async updateTransactions(householdId, ids, changes) {
    const supabase = await createClient();
    let updated = 0;
    for (let start = 0; start < ids.length; start += UPDATE_CHUNK) {
      const { data, error } = await supabase
        .from("transactions")
        .update(changes)
        .eq("household_id", householdId)
        .in("id", ids.slice(start, start + UPDATE_CHUNK))
        .select("id");
      if (error) fail("save the change", error);
      updated += data.length;
    }
    return updated;
  },

  async listRules(householdId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("categorization_rules")
      .select("*")
      .eq("household_id", householdId)
      .order("match_type")
      .order("pattern");
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
      fail("load rules", error);
    }
    return data as CategorizationRuleRow[];
  },

  async saveRule(householdId, rule) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("categorization_rules")
      .upsert({ ...rule, household_id: householdId }, { onConflict: "household_id,match_type,pattern" });
    if (error) fail("save the rule", error);
  },

  async addMissingRules(householdId, rules) {
    if (rules.length === 0) return;
    const supabase = await createClient();
    const { error } = await supabase.from("categorization_rules").upsert(
      rules.map((rule) => ({ ...rule, household_id: householdId })),
      { onConflict: "household_id,match_type,pattern", ignoreDuplicates: true },
    );
    if (error) fail("add rules", error);
  },

  async updateRule(householdId, id, changes) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("categorization_rules")
      .update(changes)
      .eq("household_id", householdId)
      .eq("id", id);
    if (error) fail("update the rule", error);
  },

  async deleteRule(householdId, id) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("categorization_rules")
      .delete()
      .eq("household_id", householdId)
      .eq("id", id);
    if (error) fail("delete the rule", error);
  },

  async createCategory(householdId, category) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("categories")
      .insert({ ...category, household_id: householdId })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(DUPLICATE_CATEGORY);
      fail("add the category", error);
    }
    return data as CategoryRow;
  },

  async updateCategory(householdId, id, changes) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("categories")
      .update(changes)
      .eq("household_id", householdId)
      .eq("id", id);
    if (error) {
      if (error.code === "23505") throw new Error(DUPLICATE_CATEGORY);
      fail("update the category", error);
    }
  },

  async listBudgetLines(householdId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("budget_lines")
      .select("*")
      .eq("household_id", householdId)
      .order("starts_month");
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
      fail("load budgets", error);
    }
    return (data as BudgetLineRow[]).map((line) => ({ ...line, amount: Number(line.amount) }));
  },

  async createBudgetLine(householdId, line) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_budget_line", {
      target_household_id: householdId,
      new_scope: line.scope,
      new_person_id: line.person_id,
      new_category_id: line.category_id,
      new_subcategory_id: line.subcategory_id,
      new_kind: line.kind,
      new_amount: line.amount,
      from_month: line.starts_month,
      split_mode: SHARED_SPENDING_MODE === "split",
    });
    if (error) budgetFailure("save the budget", error);
  },

  async changeBudgetLine(householdId, id, fromMonth, changes) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("change_budget_line", {
      target_line_id: id,
      from_month: `${fromMonth}-01`,
      new_amount: changes.amount,
      new_kind: changes.kind,
    });
    if (error) budgetFailure("save the budget", error);
  },

  async endBudgetLine(householdId, id, fromMonth) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("end_budget_line", { target_line_id: id, from_month: `${fromMonth}-01` });
    if (error) budgetFailure("remove the budget", error);
  },

  async updateHouseholdSettings(householdId, changes) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("households").update(changes).eq("id", householdId).select("id");
    if (error) {
      if (error.code === "42703" || error.code === "PGRST204") throw new Error(MISSING_MIGRATION);
      fail("save the setting", error);
    }
    if (data.length === 0) throw new Error(MISSING_MIGRATION);
  },

  async deleteTransaction(householdId, id) {
    const supabase = await createClient();
    const { error } = await supabase.from("transactions").delete().eq("household_id", householdId).eq("id", id);
    if (error) fail("delete the transaction", error);
  },

  async replaceManualEntry(householdId, id, row) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("transactions")
      .update(row)
      .eq("household_id", householdId)
      .eq("id", id)
      .eq("is_manual", true)
      .eq("awaiting_post", true)
      .select("id");
    if (error) {
      if (error.code === "42703" || error.code === "PGRST204") throw new Error(MISSING_MIGRATION);
      // The bank row's fingerprint is already saved (another import got there first).
      if (error.code === "23505") return false;
      fail("match the transaction", error);
    }
    return data.length > 0;
  },

  async listRecurringOverrides(householdId) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("recurring_overrides").select("*").eq("household_id", householdId);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
      fail("load recurring settings", error);
    }
    return data as RecurringOverrideRow[];
  },

  async setRecurringOverride(householdId, key, status) {
    const supabase = await createClient();
    const { error } =
      status === null
        ? await supabase.from("recurring_overrides").delete().eq("household_id", householdId).eq("recurring_key", key)
        : await supabase
            .from("recurring_overrides")
            .upsert({ household_id: householdId, recurring_key: key, status }, { onConflict: "household_id,recurring_key" });
    if (error) fail("save the change", error);
  },

  async listBalances(householdId) {
    const supabase = await createClient();
    const rows: AccountBalanceRow[] = [];
    for (let offset = 0; ; offset += FETCH_ALL_CHUNK) {
      const { data, error } = await supabase
        .from("account_balances")
        .select("*")
        .eq("household_id", householdId)
        .order("as_of")
        .order("id")
        .range(offset, offset + FETCH_ALL_CHUNK - 1);
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
        fail("load balances", error);
      }
      rows.push(...(data as AccountBalanceRow[]).map((row) => ({ ...row, balance: Number(row.balance) })));
      if (data.length < FETCH_ALL_CHUNK) break;
    }
    return rows;
  },

  async saveBalance(householdId, balance) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("account_balances")
      .upsert({ ...balance, household_id: householdId, source: "manual" }, { onConflict: "account_id,as_of" });
    if (error) fail("save the balance", error);
  },

  async recordImportedBalance(householdId, balance) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("account_balances")
      .upsert({ ...balance, household_id: householdId, source: "import" }, { onConflict: "account_id,as_of", ignoreDuplicates: true });
    // Before the net-worth update is applied, imports still work; balances are simply skipped.
    if (error && error.code !== "42P01" && error.code !== "PGRST205") fail("save the balance", error);
  },

  async deleteBalance(householdId, id) {
    const supabase = await createClient();
    const { error } = await supabase.from("account_balances").delete().eq("household_id", householdId).eq("id", id);
    if (error) fail("delete the balance", error);
  },

  async updateAccount(householdId, id, changes) {
    const supabase = await createClient();
    const { error } = await supabase.from("accounts").update(changes).eq("household_id", householdId).eq("id", id);
    if (error) fail("update the account", error);
  },

  async listIncomeSources(householdId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("income_sources")
      .select("*")
      .eq("household_id", householdId)
      .eq("is_active", true)
      .order("created_at");
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
      fail("load expected income", error);
    }
    return (data as IncomeSourceRow[]).map((row) => ({ ...row, amount: Number(row.amount) }));
  },

  async saveIncomeSource(householdId, source, id) {
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from("income_sources").update(source).eq("household_id", householdId).eq("id", id)
      : await supabase.from("income_sources").insert({ ...source, household_id: householdId });
    if (error) fail("save expected income", error);
  },

  async deleteIncomeSource(householdId, id) {
    const supabase = await createClient();
    const { error } = await supabase.from("income_sources").delete().eq("household_id", householdId).eq("id", id);
    if (error) fail("remove expected income", error);
  },

  async startImportBatch(householdId, batch) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("import_batches")
      .upsert({ ...batch, household_id: householdId }, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
      fail("start the import", error);
    }
    const saved = await supabaseDataSource.getImportBatch(householdId, batch.id);
    // Someone else's batch with this id (or another household's) is invisible here.
    if (!saved) throw new Error("Could not start the import: unknown batch");
    return saved;
  },

  async getImportBatch(householdId, id) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("import_batches")
      .select("*")
      .eq("household_id", householdId)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return null;
      fail("load the import", error);
    }
    return (data as ImportBatchRow | null) ?? null;
  },

  async updateImportBatch(householdId, id, changes) {
    const supabase = await createClient();
    const { error } = await supabase.from("import_batches").update(changes).eq("household_id", householdId).eq("id", id);
    if (error) fail("update the import", error);
  },

  async unfinishedImport(householdId) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getClaims();
    const { data, error } = await supabase
      .from("import_batches")
      .select("*")
      .eq("household_id", householdId)
      .eq("user_id", auth?.claims?.sub ?? "")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return null;
      fail("load the last import", error);
    }
    const batch = data as ImportBatchRow | null;
    return batch && batch.status !== "sorted" ? batch : null;
  },

  async getMonthClosing(householdId, month) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("month_closings")
      .select("*")
      .eq("household_id", householdId)
      .eq("month", `${month}-01`)
      .maybeSingle();
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return null;
      fail("load the month's review", error);
    }
    const row = data as MonthClosingRow | null;
    return row ? { ...row, spending_cents: Number(row.spending_cents), income_cents: Number(row.income_cents) } : null;
  },

  async saveMonthClosing(householdId, closing) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getClaims();
    const { error } = await supabase.from("month_closings").upsert(
      {
        ...closing,
        month: `${closing.month}-01`,
        household_id: householdId,
        closed_by: auth?.claims?.sub ?? null,
        closed_at: new Date().toISOString(),
      },
      { onConflict: "household_id,month" },
    );
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
      fail("close the month", error);
    }
  },

  async listCoverage(householdId) {
    const supabase = await createClient();
    const rows: AccountCoverageRow[] = [];
    for (let offset = 0; ; offset += FETCH_ALL_CHUNK) {
      const { data, error } = await supabase
        .from("account_coverage")
        .select("*")
        .eq("household_id", householdId)
        .order("covered_from")
        .order("id")
        .range(offset, offset + FETCH_ALL_CHUNK - 1);
      if (error) {
        // Before the coverage update is applied, nothing is known about coverage.
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        fail("load account coverage", error);
      }
      rows.push(...(data as AccountCoverageRow[]));
      if (data.length < FETCH_ALL_CHUNK) break;
    }
    return rows;
  },

  async recordCoverage(householdId, period) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getClaims();
    const { error } = await supabase
      .from("account_coverage")
      .insert({ ...period, household_id: householdId, recorded_by: auth?.claims?.sub ?? null });
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error(MISSING_MIGRATION);
      fail("record what was imported", error);
    }
  },
};
