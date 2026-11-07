import { describe, expect, it } from "vitest";
import { monthKey, monthRange } from "@/lib/dates";
import type { TransactionType } from "@/lib/db/types";
import {
  attributeSharedDeposits,
  matchMemberZelles,
  matchPassThroughPaybacks,
  matchSharedAccountFunding,
  pendingSharedFunding,
} from "@/lib/finance/shared-account";
import { spendingByPerson, spendingCents } from "@/lib/finance/summary";
import { parseView, viewParam } from "@/lib/finance/view-param";
import {
  PAYBACK_GROUP,
  contributionsByPerson,
  entriesByCategory,
  projectMonthEnd,
  viewEntries,
  viewTotals,
  type View,
} from "@/lib/finance/views";
import { normalizeMerchant, paymentAppPerson } from "@/lib/import/merchant";
import { generateSeedData } from "@/lib/seed/generate";

const N = "n";
const M = "m";
const everyone: View = { kind: "everyone" };
const shared: View = { kind: "shared" };
const john: View = { kind: "person", personId: N };
const jane: View = { kind: "person", personId: M };
const separate = { memberCount: 2, mode: "separate" as const };

type Row = Parameters<typeof viewEntries>[0][number];
function row(amount: number, type: TransactionType, overrides: Partial<Row> = {}): Row {
  return {
    transaction_date: "2026-09-15",
    amount,
    transaction_type: type,
    person_id: null,
    counterparty_id: null,
    category_id: null,
    subcategory_id: null,
    ...overrides,
  };
}

// A month in the life: John buys $400 of groceries, Jane pays him back
// $200 (seen on both sides), both fund the joint account, which pays the mortgage.
const month: Row[] = [
  row(6000, "income", { person_id: N }),
  row(5000, "income", { person_id: M }),
  row(-400, "expense", { person_id: N, category_id: "food", subcategory_id: "groceries" }),
  row(-50, "expense", { person_id: M, category_id: "fun" }),
  row(-200, "reimbursement", { person_id: M, counterparty_id: N, category_id: "food", subcategory_id: "groceries" }),
  row(200, "reimbursement", { person_id: N, counterparty_id: M, category_id: "food", subcategory_id: "groceries" }),
  row(-1500, "transfer", { person_id: N }),
  row(1500, "transfer", { person_id: null, counterparty_id: N }),
  row(-1000, "transfer", { person_id: M }),
  row(1000, "transfer", { person_id: null, counterparty_id: M }),
  row(-2450, "expense", { person_id: null, category_id: "housing" }),
];
const categories = [
  { id: "food", name: "Food" },
  { id: "fun", name: "Personal" },
  { id: "housing", name: "Housing" },
];
const totals = (view: View, mode: { memberCount: number; mode: "separate" | "split" } = separate) => viewTotals(viewEntries(month, view, mode), view);

describe("views", () => {
  it("Everyone is the whole household", () => {
    expect(totals(everyone)).toEqual({ incomeCents: 1100000, spendingCents: 290000, contributionCents: 0, savedCents: 0, investedCents: 0, netCents: 810000 });
  });

  it("a person's view shows their spending after paybacks, and what they paid into the shared account", () => {
    expect(totals(john)).toEqual({ incomeCents: 600000, spendingCents: 20000, contributionCents: 150000, savedCents: 0, investedCents: 0, netCents: 430000 });
    expect(totals(jane)).toEqual({ incomeCents: 500000, spendingCents: 25000, contributionCents: 100000, savedCents: 0, investedCents: 0, netCents: 375000 });
  });

  it("Shared shows the joint account's spending and who paid in", () => {
    expect(totals(shared)).toEqual({ incomeCents: 0, spendingCents: 245000, contributionCents: 250000, savedCents: 0, investedCents: 0, netCents: 5000 });
    const entries = viewEntries(month, shared, separate);
    expect(Object.fromEntries(contributionsByPerson(entries))).toEqual({ [N]: 150000, [M]: 100000 });
  });

  it("each person plus Shared adds up to Everyone", () => {
    const sum = [john, jane, shared].reduce((total, view) => total + totals(view).spendingCents, 0);
    expect(sum).toBe(totals(everyone).spendingCents);
  });

  it("splits a payback's category between the two of you", () => {
    const byCategory = (view: View) =>
      Object.fromEntries(entriesByCategory(viewEntries(month, view, separate), categories).map((t) => [t.name, t.cents]));
    expect(byCategory(everyone)).toEqual({ Housing: 245000, Food: 40000, Personal: 5000 });
    expect(byCategory(john)).toEqual({ Food: 20000 });
    expect(byCategory(jane)).toEqual({ Food: 20000, Personal: 5000 });
  });

  it("labels paybacks without a category on their own line", () => {
    const rows = [row(30, "reimbursement", { person_id: N, counterparty_id: M })];
    expect(entriesByCategory(viewEntries(rows, jane, separate), categories)).toEqual([
      { id: PAYBACK_GROUP, name: "Paybacks between you", cents: 3000 },
    ]);
  });

  it("in 'split' mode, each person carries half the shared spending instead of contributions", () => {
    const split = { memberCount: 2, mode: "split" as const };
    expect(totals(john, split)).toEqual({
      incomeCents: 600000,
      spendingCents: 20000 + 122500,
      contributionCents: 0,
      savedCents: 0,
      investedCents: 0,
      netCents: 600000 - 142500,
    });
    const sum = [john, jane].reduce((total, view) => total + totals(view, split).spendingCents, 0);
    expect(sum).toBe(totals(everyone).spendingCents);
  });

  it("counts money moved to savings and investing, and leaves it out of what's left over", () => {
    const rows = [
      row(2400, "income", { person_id: N }),
      row(-300, "expense", { person_id: N, category_id: "food" }),
      // Truist: to savings, labeled as a transfer between your own accounts
      row(-600, "transfer", { person_id: N, original_description: "MOBILE TO ****1234 TRUIST ONLINE TRANSFER", bank_category: "Transfers & Payments / Transfers between own accounts" }),
      row(-250, "investment_contribution", { person_id: N, original_description: "JPMORGAN" }),
      // Bank of America: to savings, then some taken back out
      row(-500, "transfer", { person_id: M, original_description: "Online Banking transfer to SAV 1234 Confirmation# 1" }),
      row(100, "transfer", { person_id: M, original_description: "Online Banking transfer from SAV 1234 Confirmation# 2" }),
      // into the joint account: not savings
      row(-1150, "transfer", { person_id: N, original_description: "JANE PAYMENT ID 1 ZELLE PAYMENT TO" }),
      row(-1000, "transfer", { person_id: M, original_description: "Online Banking transfer to CHK 0000 Confirmation# 3" }),
      // the savings account's own side doesn't name savings, so it isn't counted twice
      row(500, "transfer", { person_id: M, original_description: "Online Banking transfer from CHK 1111 Confirmation# 1" }),
    ];
    const n = viewTotals(viewEntries(rows, john, separate), john);
    expect(n).toMatchObject({ savedCents: 60000, investedCents: 25000, netCents: 240000 - 30000 - 60000 - 25000 });
    const m = viewTotals(viewEntries(rows, jane, separate), jane);
    expect(m).toMatchObject({ savedCents: 40000, investedCents: 0 });
    const all = viewTotals(viewEntries(rows, everyone, separate), everyone);
    expect(all).toMatchObject({ savedCents: 100000, investedCents: 25000 });
  });

  it("counts moves to and from an American Express savings account as savings", () => {
    const description = "TRANSFER AMERICANEXPRESS ***********1234 JOHN INTERNET PAYMENT";
    const rows = [
      row(-600, "transfer", { person_id: N, original_description: description }),
      row(150, "transfer", { person_id: N, original_description: description }),
    ];
    expect(viewTotals(viewEntries(rows, john, separate), john)).toMatchObject({ savedCents: 45000, netCents: -45000 });
  });

  it("round-trips through the URL and falls back to Everyone", () => {
    const members = [{ id: N }, { id: M }];
    expect(parseView(viewParam(john), members)).toEqual(john);
    expect(parseView("shared", members)).toEqual(shared);
    expect(parseView("someone-else", members)).toEqual(everyone);
    expect(parseView(undefined, members)).toEqual(everyone);
  });
});

describe("month-end projection", () => {
  const spend = (date: string, amount: number) => row(-amount, "expense", { transaction_date: date, person_id: N });

  it("adds what usually comes later in the month to what's been spent so far", () => {
    const rows = [
      spend("2026-07-05", 100), spend("2026-07-20", 300),
      spend("2026-08-05", 100), spend("2026-08-20", 500),
      spend("2026-09-05", 100), spend("2026-09-20", 400),
      spend("2026-10-05", 120),
    ];
    // so far 120; later-in-month spending averaged 400
    expect(projectMonthEnd(viewEntries(rows, everyone, separate), "2026-10-10", "2026-07-01")).toBe(52000);
  });

  it("only learns from months the data fully covers", () => {
    const rows = [spend("2026-08-20", 900), spend("2026-09-20", 100), spend("2026-10-05", 120)];
    // data starts mid-August, so only September counts
    expect(projectMonthEnd(viewEntries(rows, everyone, separate), "2026-10-10", "2026-08-14")).toBe(22000);
    expect(projectMonthEnd(viewEntries(rows, everyone, separate), "2026-10-10", "2026-09-14")).toBeNull();
    expect(projectMonthEnd(viewEntries(rows, everyone, separate), "2026-10-10", null)).toBeNull();
  });

  it("is just the total on the last day of the month", () => {
    const rows = [spend("2026-08-05", 100), spend("2026-09-30", 50)];
    expect(projectMonthEnd(viewEntries(rows, everyone, separate), "2026-09-30", "2026-08-01")).toBe(5000);
  });
});

describe("funding the shared account", () => {
  const accounts = new Map([
    ["truist", { owner_user_id: N }],
    ["joint", { owner_user_id: null }],
  ]);
  type Full = Parameters<typeof matchSharedAccountFunding>[0][number];
  const tx = (id: string, account: string, amount: number, date: string, overrides: Partial<Full> = {}): Full => ({
    id,
    original_description: "ZELLE PAYMENT",
    account_id: account,
    person_id: account === "joint" ? null : N,
    counterparty_id: null,
    amount,
    transaction_date: date,
    transaction_type: "transfer",
    review_status: "needs_review",
    ...overrides,
  });

  it("pairs John's 'Zelle to Jane' with the joint account's 'from John' deposit", () => {
    const rows = [
      tx("out", "truist", -800, "2026-09-01", { transaction_type: "reimbursement", counterparty_id: M }),
      tx("in", "joint", 800, "2026-09-02", { counterparty_id: N, review_status: "auto_categorized" }),
    ];
    expect(matchSharedAccountFunding(rows, accounts).map((r) => r.id)).toEqual(["out"]);
  });

  it("leaves real paybacks alone: different amount, too far apart, or someone else paid in", () => {
    const deposit = tx("in", "joint", 800, "2026-09-02", { counterparty_id: N });
    const payback = (amount: number, date: string) =>
      tx("out", "truist", amount, date, { transaction_type: "reimbursement", counterparty_id: M });
    expect(matchSharedAccountFunding([payback(-799, "2026-09-01"), deposit], accounts)).toEqual([]);
    expect(matchSharedAccountFunding([payback(-800, "2026-09-10"), deposit], accounts)).toEqual([]);
    expect(
      matchSharedAccountFunding([payback(-800, "2026-09-01"), { ...deposit, counterparty_id: M }], accounts),
    ).toEqual([]);
  });

  it("never overrides a decision already made in review, and pairs each deposit once", () => {
    const deposit = tx("in", "joint", 800, "2026-09-02", { counterparty_id: N });
    const reviewed = tx("a", "truist", -800, "2026-09-01", { transaction_type: "reimbursement", review_status: "reviewed" });
    expect(matchSharedAccountFunding([reviewed, deposit], accounts)).toEqual([]);
    const twins = [tx("a", "truist", -800, "2026-09-01"), tx("b", "truist", -800, "2026-09-02"), deposit];
    expect(matchSharedAccountFunding(twins, accounts)).toHaveLength(1);
  });
});

describe("paid into shared before the joint account's statement shows it", () => {
  const accounts = new Map([
    ["truist", { owner_user_id: N }],
    ["joint", { owner_user_id: null }],
  ]);
  type Full = Parameters<typeof pendingSharedFunding>[0][number];
  const tx = (id: string, account: string, amount: number, date: string, overrides: Partial<Full> = {}): Full => ({
    id,
    original_description: account === "joint" ? "Zelle payment from JOHN" : "Zelle to Our Joint Account",
    normalized_merchant: account === "joint" ? "Zelle · John" : "Zelle · Our Joint Account",
    account_id: account,
    person_id: account === "joint" ? null : N,
    counterparty_id: null,
    amount,
    transaction_date: date,
    transaction_type: account === "joint" ? "transfer" : "reimbursement",
    review_status: "needs_review",
    ...overrides,
  });
  // September: a deposit paired on both sides; the joint statement ends Sept 30.
  const september = [
    tx("sep-out", "truist", -1150, "2026-09-06", { transaction_type: "transfer", review_status: "auto_categorized" }),
    tx("sep-in", "joint", 1150, "2026-09-07", { counterparty_id: N }),
    tx("mortgage", "joint", -2000, "2026-09-30", { transaction_type: "expense", original_description: "MORTGAGE" }),
  ];
  const ids = (rows: Full[]) => rows.map((r) => r.id);

  it("counts a withdrawal to the usual place as paid in, until the joint statement catches up", () => {
    const october = tx("oct-out", "truist", -1150, "2026-10-06");
    const elsewhere = tx("other", "truist", -40, "2026-10-07", { original_description: "Zelle to a friend", normalized_merchant: "Zelle · Friend" });
    expect(ids(pendingSharedFunding([...september, october, elsewhere], accounts).pending)).toEqual(["oct-out"]);

    const marked = { ...october, transaction_type: "transfer" as const, counterparty_id: N, review_status: "auto_categorized" as const };
    const asRows = [...september, marked].map((r) => ({ ...r, category_id: null, subcategory_id: null }));
    const totals = (view: View) => viewTotals(viewEntries(asRows, view, separate).filter((e) => e.date >= "2026-10-01"), view);
    expect(totals(john)).toMatchObject({ contributionCents: 115000, netCents: -115000 });
    expect(totals(shared)).toMatchObject({ contributionCents: 115000 });
    expect(totals(everyone)).toMatchObject({ contributionCents: 0, netCents: 0 });
  });

  it("stops counting it once the deposit shows up, so it's never counted twice", () => {
    const marked = tx("oct-out", "truist", -1150, "2026-10-06", { transaction_type: "transfer", counterparty_id: N, review_status: "auto_categorized" });
    const deposit = tx("oct-in", "joint", 1150, "2026-10-07", { counterparty_id: N });
    expect(ids(matchSharedAccountFunding([...september, marked, deposit], accounts))).toContain("oct-out");
    expect(pendingSharedFunding([...september, marked, deposit], accounts)).toEqual({ pending: [], notPending: [] });
  });

  it("lets it go if the statement covers its date and shows no deposit, or shows one that passed through", () => {
    const marked = tx("oct-out", "truist", -1150, "2026-10-06", { transaction_type: "transfer", counterparty_id: N, review_status: "auto_categorized" });
    const later = tx("later", "joint", -5, "2026-10-20", { transaction_type: "expense", original_description: "FEE" });
    expect(ids(pendingSharedFunding([...september, marked, later], accounts).notPending)).toEqual(["oct-out"]);
    const passedThrough = tx("oct-in", "joint", 1150, "2026-10-06");
    expect(ids(pendingSharedFunding([...september, marked, passedThrough], accounts).notPending)).toEqual(["oct-out"]);
  });

  it("needs history: nothing is pending without an earlier paired deposit or any joint statement", () => {
    const october = tx("oct-out", "truist", -1150, "2026-10-06");
    expect(pendingSharedFunding([september[2], october], accounts).pending).toEqual([]);
    expect(pendingSharedFunding([september[0], october], accounts).pending).toEqual([]);
  });
});

describe("money between the two of you", () => {
  const accounts = new Map([
    ["truist", { owner_user_id: N }],
    ["her-checking", { owner_user_id: M }],
    ["joint", { owner_user_id: null }],
  ]);
  type Full = Parameters<typeof matchMemberZelles>[0][number];
  const tx = (id: string, account: string, amount: number, date: string, overrides: Partial<Full> = {}): Full => ({
    id,
    original_description: "ZELLE PAYMENT",
    account_id: account,
    person_id: accounts.get(account)!.owner_user_id,
    counterparty_id: null,
    amount,
    transaction_date: date,
    transaction_type: "expense",
    review_status: "needs_review",
    ...overrides,
  });

  it("recognizes her Zelle to you even when her contact name for you is a nickname", () => {
    const rows = [
      // her side: looked like a Zelle to someone outside the household
      tx("out", "her-checking", -60, "2026-09-10", { original_description: "Zelle payment to JOHNNY Conf# 1" }),
      // your side: already a payback from Jane
      tx("in", "truist", 60, "2026-09-11", { transaction_type: "reimbursement", counterparty_id: M }),
    ];
    expect(matchMemberZelles(rows, accounts).map(({ row, counterpartyId }) => [row.id, counterpartyId])).toEqual([["out", N]]);
  });

  it("leaves Zelles to other people, different amounts, and decided ones alone", () => {
    const receipt = tx("in", "truist", 60, "2026-09-11", { transaction_type: "reimbursement" });
    expect(matchMemberZelles([tx("out", "her-checking", -61, "2026-09-10"), receipt], accounts)).toEqual([]);
    expect(matchMemberZelles([tx("out", "her-checking", -60, "2026-09-20"), receipt], accounts)).toEqual([]);
    expect(matchMemberZelles([tx("out", "her-checking", -60, "2026-09-10", { review_status: "reviewed" }), receipt], accounts)).toEqual([]);
    // money out of an account into the same person's other account isn't between the two of you
    expect(matchMemberZelles([tx("out", "truist", -60, "2026-09-10"), receipt], accounts)).toEqual([]);
  });

  it("credits an unnamed deposit into the joint account to whoever sent it", () => {
    const rows = [
      tx("dep", "joint", 1380, "2026-09-12", { transaction_type: "transfer", original_description: "Online Banking transfer from CHK 0000" }),
      tx("wd", "her-checking", -1380, "2026-09-12", { transaction_type: "transfer", original_description: "Online Banking transfer to CHK 1234" }),
    ];
    expect(attributeSharedDeposits(rows, accounts).map(({ row, counterpartyId }) => [row.id, counterpartyId])).toEqual([["dep", M]]);
  });

  it("treats money she sends you through the joint account as her paying you back", () => {
    const rows = [
      tx("hers", "her-checking", -412.5, "2026-09-30", { transaction_type: "transfer", original_description: "Online Banking transfer to CHK 0000 Confirmation# 1" }),
      tx("dep", "joint", 412.5, "2026-09-30", { transaction_type: "transfer", original_description: "Online Banking transfer from CHK 1234 Confirmation# 1" }),
      tx("fwd", "joint", -412.5, "2026-10-01", { transaction_type: "transfer", original_description: "Zelle payment to JOHN Conf# 1" }),
      tx("yours", "truist", 412.5, "2026-10-01", { transaction_type: "transfer", original_description: "JOINT PAYMENT ID 1 ZELLE PAYMENT FROM" }),
    ];
    expect(matchPassThroughPaybacks(rows, accounts).map(({ row, counterpartyId }) => [row.id, counterpartyId])).toEqual([["yours", M]]);
    // from her savings (not imported), known from her own transfers to it
    const fromSavings = [
      tx("ref", "her-checking", -100, "2026-03-01", { transaction_type: "transfer", original_description: "Online Banking transfer to SAV 4321 Confirmation# 1" }),
      tx("dep", "joint", 560, "2026-04-10", { transaction_type: "transfer", original_description: "Online Banking transfer from SAV 4321 Confirmation# 2" }),
      tx("fwd", "joint", -560, "2026-04-10", { transaction_type: "transfer", original_description: "Zelle payment to JOHN Conf# 2" }),
      tx("yours", "truist", 560, "2026-04-11", { transaction_type: "transfer" }),
    ];
    expect(matchPassThroughPaybacks(fromSavings, accounts).map(({ row, counterpartyId }) => [row.id, counterpartyId])).toEqual([["yours", M]]);
    // money that stays in the joint account, or comes back to the sender, isn't a payback
    expect(matchPassThroughPaybacks(rows.slice(0, 2), accounts)).toEqual([]);
    expect(matchPassThroughPaybacks([...rows.slice(0, 3), tx("back", "her-checking", 412.5, "2026-10-01", { transaction_type: "transfer" })], accounts)).toEqual([]);
  });

  it("credits a deposit straight from someone's savings to the person whose savings it is", () => {
    const rows = [
      tx("dep", "joint", 1650, "2026-08-02", { transaction_type: "transfer", original_description: "Online Banking transfer from SAV 4321 Confirmation# 9" }),
      tx("hers", "her-checking", -500, "2026-07-10", { transaction_type: "transfer", original_description: "Online Banking transfer to SAV 4321 Confirmation# 1" }),
    ];
    expect(attributeSharedDeposits(rows, accounts).map(({ row, counterpartyId }) => [row.id, counterpartyId])).toEqual([["dep", M]]);
  });

  it("counts that deposit as drawn from her savings, and as a contribution, not as the joint account's savings", () => {
    const rows = [
      row(1650, "transfer", { person_id: null, counterparty_id: M, original_description: "Online Banking transfer from SAV 4321 Confirmation# 9" }),
    ];
    const totalsFor = (view: View) => viewTotals(viewEntries(rows, view, separate), view);
    expect(totalsFor(jane)).toMatchObject({ contributionCents: 165000, savedCents: -165000, netCents: 0 });
    expect(totalsFor(shared)).toMatchObject({ contributionCents: 165000, savedCents: 0 });
    expect(totalsFor(everyone)).toMatchObject({ savedCents: -165000 });
  });

  it("doesn't credit money that only passed through the joint account", () => {
    // her insurance half: into the joint account, then straight on to you
    const rows = [
      tx("dep", "joint", 412.5, "2026-09-30", { transaction_type: "transfer" }),
      tx("wd", "her-checking", -412.5, "2026-09-30", { transaction_type: "transfer" }),
      tx("fwd", "joint", -412.5, "2026-10-01", { transaction_type: "transfer" }),
    ];
    expect(attributeSharedDeposits(rows, accounts)).toEqual([]);
  });
});

describe("payment-app names", () => {
  it("keeps the other person's name, in each bank's layout", () => {
    expect(normalizeMerchant("RILEY TEST PAYMENT ID ABC123 ZELLE PAYMENT TO")).toBe("Zelle · Riley Test");
    expect(normalizeMerchant("ZELLE PAYMENT FROM JOHN TEST FOR RENT CONF# 123")).toBe("Zelle · John Test");
    expect(normalizeMerchant("Zelle payment to SAM R 12345")).toBe("Zelle · Sam R");
    expect(normalizeMerchant("VENMO *SAM R")).toBe("Venmo · Sam R");
  });

  it("falls back to the app name when there's no person", () => {
    expect(paymentAppPerson("VENMO PAYMENT 1234567")).toEqual({ app: "Venmo", person: null });
    expect(normalizeMerchant("VENMO PAYMENT 1234567")).toBe("Venmo");
  });
});

describe("demo data", () => {
  const seed = generateSeedData({ endDate: "2026-10-01", johnId: N, janeId: M });
  const august = seed.transactions.filter((t) => monthKey(t.transaction_date) === "2026-08");
  const options = { memberCount: 2, mode: "separate" as const };

  it("keeps Everyone = John + Jane + Shared", () => {
    const spend = (view: View) => viewTotals(viewEntries(august, view, options), view).spendingCents;
    expect(spend(john) + spend(jane) + spend(shared)).toBe(spend(everyone));
    expect(spend(everyone)).toBe(spendingCents(august));
  });

  it("agrees with the per-person breakdown", () => {
    const people = [
      { id: N, name: "John" },
      { id: M, name: "Jane" },
    ];
    const byPerson = Object.fromEntries(spendingByPerson(august, people).map((g) => [g.id ?? "shared", g.cents]));
    const spend = (view: View) => viewTotals(viewEntries(august, view, options), view).spendingCents;
    expect(byPerson[N]).toBe(spend(john));
    expect(byPerson[M]).toBe(spend(jane));
    expect(byPerson.shared).toBe(spend(shared));
  });

  it("records both people paying into the shared account every month", () => {
    const { from, to } = monthRange("2026-08");
    const inMonth = seed.transactions.filter((t) => t.transaction_date >= from && t.transaction_date <= to);
    const contributions = contributionsByPerson(viewEntries(inMonth, shared, options));
    expect(contributions.get(N)).toBe(190000);
    expect(contributions.get(M)).toBe(150000);
  });
});

describe("typical spending", () => {
  it("isn't thrown off by one big purchase", async () => {
    const { typicalByCategory } = await import("@/lib/finance/views");
    const rows = [
      row(-439, "expense", { transaction_date: "2026-06-10", person_id: N, category_id: "fun" }),
      row(-598, "expense", { transaction_date: "2026-07-10", person_id: N, category_id: "fun" }),
      row(-2858, "expense", { transaction_date: "2026-08-10", person_id: N, category_id: "fun" }),
    ];
    const entries = viewEntries(rows, john, separate);
    const months = ["2026-06", "2026-07", "2026-08"].map((m) => ({ from: `${m}-01`, to: `${m}-31` }));
    expect(typicalByCategory(entries, categories, months).get("fun")).toBe(59800);
  });

  it("counts months with no spending as zero", async () => {
    const { typicalByCategory } = await import("@/lib/finance/views");
    const entries = viewEntries([row(-600, "expense", { transaction_date: "2026-08-10", person_id: N, category_id: "fun" })], john, separate);
    const months = ["2026-06", "2026-07", "2026-08"].map((m) => ({ from: `${m}-01`, to: `${m}-31` }));
    expect(typicalByCategory(entries, categories, months).get("fun")).toBe(0);
  });
});
