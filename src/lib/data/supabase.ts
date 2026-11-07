import "server-only";
import type {
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
import { createClient } from "@/lib/supabase/server";
import type { DataSource, Member, Page, TransactionFilter } from "./types";

const FETCH_ALL_CHUNK = 1000;
const INSERT_CHUNK = 500;
const UPDATE_CHUNK = 200;
export const DUPLICATE_CATEGORY = "There's already a category with that name here.";
export const MISSING_MIGRATION =
  "The database needs an update. Ask the person who set up the app to apply the latest database update.";

function fail(action: string, error: { message: string }): never {
  throw new Error(`Could not ${action}: ${error.message}`);
}

/** Keep only characters that are safe inside a PostgREST `or` filter. */
export function sanitizeSearch(search: string): string {
  return search.replace(/[^\p{L}\p{N} '&.\-]/gu, " ").trim().slice(0, 80);
}

async function fetchTransactions(
  householdId: string,
  filter: TransactionFilter,
  page: Page,
): Promise<{ rows: TransactionRow[]; total: number }> {
  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select("*", { count: "exact" })
    .eq("household_id", householdId);

  if (filter.from) query = query.gte("transaction_date", filter.from);
  if (filter.to) query = query.lte("transaction_date", filter.to);
  if (filter.accountId) query = query.eq("account_id", filter.accountId);
  if (filter.categoryId) query = query.eq("category_id", filter.categoryId);
  if (filter.personId === "household") query = query.is("person_id", null);
  else if (filter.personId) query = query.eq("person_id", filter.personId);
  if (filter.needsReview) query = query.eq("review_status", "needs_review");
  if (filter.awaitingPost) query = query.eq("awaiting_post", true);
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
  if (error) fail("load transactions", error);

  const rows = (data as TransactionRow[]).map((row) => ({ ...row, amount: Number(row.amount) }));
  return { rows, total: count ?? rows.length };
}

export const supabaseDataSource: DataSource = {
  async getSession() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const email = user.email ?? "";
    const fallbackName = email.split("@")[0] ?? "";

    const { data: membership, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipError) fail("load your household", membershipError);

    if (!membership) {
      return { user: { id: user.id, email, name: fallbackName }, household: null, members: [], isDemo: false };
    }

    const householdId = (membership as Pick<HouseholdMemberRow, "household_id">).household_id;
    const [household, memberRows] = await Promise.all([
      supabase.from("households").select("*").eq("id", householdId).single(),
      supabase.from("household_members").select("*").eq("household_id", householdId),
    ]);
    if (household.error) fail("load your household", household.error);
    if (memberRows.error) fail("load household members", memberRows.error);

    const memberships = memberRows.data as HouseholdMemberRow[];
    const profiles = await supabase
      .from("profiles")
      .select("*")
      .in("id", memberships.map((member) => member.user_id));
    if (profiles.error) fail("load household members", profiles.error);

    const members: Member[] = (profiles.data as ProfileRow[])
      .map((profile) => ({
        ...profile,
        role: memberships.find((member) => member.user_id === profile.id)?.role ?? "member",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const me = members.find((member) => member.id === user.id);
    return {
      user: { id: user.id, email, name: me?.name || fallbackName },
      household: household.data as HouseholdRow,
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

    const rows: TransactionRow[] = [];
    for (let offset = 0; ; offset += FETCH_ALL_CHUNK) {
      const chunk = await fetchTransactions(householdId, filter, { limit: FETCH_ALL_CHUNK, offset });
      rows.push(...chunk.rows);
      if (chunk.rows.length < FETCH_ALL_CHUNK) break;
    }
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
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("household_id", householdId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail("load the transaction", error);
    return data ? { ...(data as TransactionRow), amount: Number(data.amount) } : null;
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
    const { error } = await supabase.from("budget_lines").insert({ ...line, household_id: householdId });
    if (error) fail("save the budget", error);
  },

  async updateBudgetLine(householdId, id, changes) {
    const supabase = await createClient();
    const { error } = await supabase.from("budget_lines").update(changes).eq("household_id", householdId).eq("id", id);
    if (error) fail("save the budget", error);
  },

  async deleteBudgetLine(householdId, id) {
    const supabase = await createClient();
    const { error } = await supabase.from("budget_lines").delete().eq("household_id", householdId).eq("id", id);
    if (error) fail("remove the budget", error);
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
    const { error } = await supabase
      .from("transactions")
      .update(row)
      .eq("household_id", householdId)
      .eq("id", id)
      .eq("is_manual", true);
    if (error) {
      if (error.code === "42703" || error.code === "PGRST204") throw new Error(MISSING_MIGRATION);
      fail("match the transaction", error);
    }
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
};
