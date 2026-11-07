import { describe, expect, it } from "vitest";
import {
  accountsForView,
  balancesOn,
  holdsTransactions,
  isDebt,
  latestBalance,
  monthlyHistory,
  netWorthOn,
} from "@/lib/finance/net-worth";
import { parseCsvFile } from "@/lib/import/parse-file";
import { generateSeedData } from "@/lib/seed/generate";

const account = (id: string, type: Parameters<typeof isDebt>[0], owner: string | null = "n", active = true) => ({
  id,
  account_type: type,
  owner_user_id: owner,
  is_active: active,
});
const balance = (account_id: string, as_of: string, amount: number) => ({ account_id, as_of, balance: amount });

describe("what counts as owed", () => {
  it("treats cards, the mortgage and loans as debts, everything else as owned", () => {
    expect(["credit_card", "mortgage", "loan"].every((type) => isDebt(type as never))).toBe(true);
    expect(["checking", "savings", "brokerage", "retirement", "hsa", "crypto", "property", "vehicle", "other"].some((type) => isDebt(type as never))).toBe(false);
    expect(holdsTransactions("property")).toBe(false);
    expect(holdsTransactions("checking")).toBe(true);
  });
});

describe("net worth on a date", () => {
  const accounts = [
    account("checking", "checking"),
    account("401k", "retirement", "m"),
    account("house", "property", null),
    account("mortgage", "mortgage", null),
    account("card", "credit_card"),
  ];
  const balances = [
    balance("checking", "2026-08-31", 4000),
    balance("checking", "2026-09-30", 4500),
    balance("401k", "2026-09-30", 41000),
    balance("house", "2026-06-30", 520000),
    balance("mortgage", "2026-09-30", 410000),
    balance("card", "2026-09-30", 1850.5),
  ];

  it("uses each account's latest balance on or before the date", () => {
    expect(balancesOn(balances, "2026-09-15").get("checking")?.balance).toBe(4000);
    expect(balancesOn(balances, "2026-10-01").get("checking")?.balance).toBe(4500);
  });

  it("adds up what you own and subtracts what you owe", () => {
    const result = netWorthOn(accounts, balances, "2026-10-01");
    expect(result.assetsCents).toBe((4500 + 41000 + 520000) * 100);
    expect(result.debtsCents).toBe((410000 + 1850.5) * 100);
    expect(result.netCents).toBe(result.assetsCents - result.debtsCents);
  });

  it("points out balances that are old, and accounts with no balance yet", () => {
    const result = netWorthOn([...accounts, account("crypto", "crypto")], balances, "2026-10-01");
    expect(result.stale).toEqual(["house"]);
    expect(result.missing).toEqual(["crypto"]);
  });

  it("splits by view: each person's own, the shared ones, or everything", () => {
    const ids = (view: Parameters<typeof accountsForView>[1]) => accountsForView(accounts, view).map((a) => a.id);
    expect(ids({ kind: "person", personId: "n" })).toEqual(["checking", "card"]);
    expect(ids({ kind: "person", personId: "m" })).toEqual(["401k"]);
    expect(ids({ kind: "shared" })).toEqual(["house", "mortgage"]);
    expect(ids({ kind: "everyone" })).toHaveLength(5);
    expect(accountsForView([account("old", "checking", "n", false)], { kind: "everyone" })).toEqual([]);
  });

  it("builds a month-by-month history from when balances begin", () => {
    const history = monthlyHistory(accounts, balances, "2026-10-03", 6);
    expect(history.map((entry) => entry.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(history[history.length - 1].date).toBe("2026-10-03");
    expect(history[0].netWorth.assetsCents).toBe(52000000); // only the house had a value in June
  });
});

describe("balances from bank exports", () => {
  it("takes the balance on the last date in the file", () => {
    expect(
      latestBalance([
        { date: "2026-09-02", balance: 100 },
        { date: "2026-09-30", balance: 250 },
        { date: "2026-09-15", balance: 175 },
        { date: "2026-09-30", balance: null },
      ]),
    ).toEqual({ date: "2026-09-30", balance: 250 });
    expect(latestBalance([{ date: "2026-09-02", balance: null }])).toBeNull();
  });

  it("reads Truist's daily posted balance, by posted date", () => {
    const file = parseCsvFile(
      "Posted Date,Transaction Date,Transaction Type,Check/Serial #,Full description,Merchant name,Category name,Sub-category name,Amount,Daily Posted Balance\n" +
        '09/30/2026,09/29/2026,Debit,,SHELL OIL 1,Shell,,,($40.00),"$1,960.00"\n' +
        '09/28/2026,09/27/2026,Debit,,TRADER JOE S,,,,($60.00),"$2,000.00"\n',
    );
    expect(file.status === "ok" && file.latestBalance).toEqual({ date: "2026-09-30", balance: 1960 });
  });

  it("reads Bank of America's running balance", () => {
    const file = parseCsvFile(
      "Date,Description,Amount,Running Bal.\n" +
        '09/01/2026,Beginning balance as of 09/01/2026,,"1,000.00"\n' +
        '09/03/2026,"HOA DUES","-285.00","715.00"\n' +
        '09/04/2026,"PAYROLL","3,150.00","3,865.00"\n',
    );
    expect(file.status === "ok" && file.latestBalance).toEqual({ date: "2026-09-04", balance: 3865 });
  });

  it("has nothing for exports without a balance column", () => {
    const file = parseCsvFile("Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n09/26/2026,09/27/2026,TARGET,Shopping,Sale,-20.00,\n");
    expect(file.status === "ok" && file.latestBalance).toBeNull();
  });
});

describe("the demo household", () => {
  it("has a few months of balances for every account", () => {
    const seed = generateSeedData({ endDate: "2026-10-03", johnId: "n", janeId: "m" });
    const accountsWithBalances = new Set(seed.balances.map((b) => b.account_id));
    expect(accountsWithBalances.size).toBe(seed.accounts.length);
    const result = netWorthOn(seed.accounts, seed.balances, "2026-10-03");
    expect(result.netCents).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
  });
});
