import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { detectRecurring, upcoming } from "@/lib/finance/recurring";
import { generateSeedData } from "@/lib/seed/generate";

const today = "2026-10-03";
type Row = Parameters<typeof detectRecurring>[0][number];
let next = 0;
function row(merchant: string, date: string, amount: number, overrides: Partial<Row> = {}): Row {
  next += 1;
  return {
    id: `r${next}`,
    transaction_date: date,
    amount,
    transaction_type: amount < 0 ? "expense" : "income",
    normalized_merchant: merchant,
    person_id: "n",
    category_id: "subs",
    subcategory_id: "streaming",
    ...overrides,
  };
}
const monthly = (merchant: string, day: number, amounts: number[], overrides: Partial<Row> = {}) =>
  amounts.map((amount, index) => row(merchant, `2026-${String(4 + index).padStart(2, "0")}-${String(day).padStart(2, "0")}`, amount, overrides));
const detect = (rows: Row[]) => detectRecurring(rows, { today });

describe("finding recurring charges", () => {
  it("finds a monthly subscription and works out its cost", () => {
    const [netflix] = detect(monthly("Netflix", 7, [-19.99, -19.99, -19.99, -19.99, -19.99, -19.99]));
    expect(netflix).toMatchObject({
      merchant: "Netflix",
      kind: "charge",
      frequency: "monthly",
      amountCents: 1999,
      monthlyCents: 1999,
      annualCents: 23988,
      count: 6,
      lastDate: "2026-09-07",
      confidence: "high",
      maybeStopped: false,
      priceChange: null,
    });
    expect(netflix.nextDate).toBe("2026-10-07");
  });

  it("tolerates billing dates that shift around weekends, and expects the same day next month", () => {
    const rows = ["2026-04-01", "2026-05-01", "2026-06-02", "2026-07-01", "2026-07-31", "2026-09-01"].map((date) =>
      row("Summit Home Loans", date, -2450, { category_id: "housing" }),
    );
    expect(detect(rows).map((item) => item.nextDate)).toEqual(["2026-10-01"]);
  });

  it("keeps end-of-month bills at the end of shorter months", () => {
    const rows = ["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"].map((date) => row("Rent Co", date, -1000));
    const [rent] = detectRecurring(rows, { today: "2026-09-10" });
    expect(rent.nextDate).toBe("2026-09-30");
  });

  it("allows a bill whose amount varies a bit, like electricity", () => {
    expect(detect(monthly("City Power", 12, [-95, -130, -160, -142, -110, -101]))).toHaveLength(1);
  });

  it("does not flag habits with varying amounts, like coffee or groceries", () => {
    const coffee = Array.from({ length: 20 }, (_, i) => row("Starbucks", addDays("2026-06-01", i * 7), -(4.5 + (i % 5))));
    const groceries = Array.from({ length: 12 }, (_, i) => row("Trader Joe's", addDays("2026-06-01", i * 14), -(40 + i * 11)));
    expect(detect([...coffee, ...groceries])).toEqual([]);
  });

  it("does not mistake a place you visit with widely varying bills for a steady charge", () => {
    const amounts = [12, 48, 85, 40, 22, 60, 44, 51, 15, 70, 46, 38];
    const rows = amounts.map((amount, i) => row("Chipotle", addDays("2026-04-03", i * 14 + (i % 3)), -amount));
    expect(detect(rows)).toEqual([]);
  });

  it("does not flag irregular purchases at the same place", () => {
    const rows = ["2026-04-02", "2026-04-20", "2026-06-11", "2026-06-13", "2026-09-01"].map((date) => row("Target", date, -25));
    expect(detect(rows)).toEqual([]);
  });

  it("catches a twice-yearly bill from two near-identical charges", () => {
    const [insurance] = detect([
      row("Geico", "2026-03-15", -977, { category_id: "transport" }),
      row("Geico", "2026-09-14", -977, { category_id: "transport" }),
    ]);
    expect(insurance).toMatchObject({ frequency: "semiannual", confidence: "medium", monthlyCents: 16283 });
  });

  it("needs three charges for anything more frequent", () => {
    expect(detect([row("Gym", "2026-08-08", -25), row("Gym", "2026-09-08", -25)])).toEqual([]);
  });

  it("finds paychecks as recurring income", () => {
    const pay = Array.from({ length: 10 }, (_, i) => row("Acme Payroll", addDays("2026-05-29", i * 14), 3150));
    expect(detect(pay)[0]).toMatchObject({ kind: "income", frequency: "biweekly", monthlyCents: 682500, annualCents: 8190000 });
  });

  it("notices a price change", () => {
    const [spotify] = detect(monthly("Spotify", 3, [-11.99, -11.99, -11.99, -11.99, -12.99, -12.99]));
    expect(spotify.priceChange).toEqual({ fromCents: 1199, toCents: 1299, date: "2026-09-03" });
    const [peacock] = detect(monthly("Peacock", 9, [-7.99, -7.99, -7.99, -7.99, -7.99, -10.99]));
    expect(peacock.priceChange).toEqual({ fromCents: 799, toCents: 1099, date: "2026-09-09" });
  });

  it("flags a charge that stopped arriving", () => {
    const [old] = detect(monthly("Hulu", 5, [-9.99, -9.99, -9.99]));
    expect(old.lastDate).toBe("2026-06-05");
    expect(old.maybeStopped).toBe(true);
  });

  it("marks a newly started subscription", () => {
    const [fresh] = detect([row("Claude", "2026-08-18", -20), row("Claude", "2026-09-18", -20), row("Claude", "2026-10-18", -20)].slice(0, 2).concat([]));
    expect(fresh).toBeUndefined(); // two monthly charges aren't enough yet
    const rows = ["2026-08-20", "2026-09-03", "2026-09-17", "2026-10-01"].map((date) => row("Rover", date, -45));
    expect(detect(rows)[0]).toMatchObject({ frequency: "biweekly", isNew: true });
  });

  it("keeps each person's and the shared account's charges separate", () => {
    const rows = [
      ...monthly("Apple", 20, [-9.99, -9.99, -9.99], { person_id: "n" }),
      ...monthly("Apple", 21, [-2.99, -2.99, -2.99], { person_id: "m" }),
    ];
    expect(detect(rows).map((item) => [item.personId, item.amountCents])).toEqual([
      ["n", 999],
      ["m", 299],
    ]);
  });

  it("ignores transfers, card payments and paybacks", () => {
    const rows = [
      ...monthly("Transfer to Savings", 2, [-500, -500, -500, -500], { transaction_type: "transfer" }),
      ...monthly("Chase Card Payment", 25, [-900, -900, -900, -900], { transaction_type: "credit_card_payment" }),
      ...monthly("Zelle · Jane", 26, [200, 200, 200, 200], { transaction_type: "reimbursement" }),
    ];
    expect(detect(rows)).toEqual([]);
  });
});

describe("one-off charges from a regular merchant", () => {
  it("doesn't call a yearly fee a price change, or let it hide the monthly charge", () => {
    const rows = [
      ...monthly("PureFitness", 8, [-25.99, -25.99, -25.99, -25.99, -25.99, -25.99]),
      row("PureFitness", "2026-08-15", -64.99),
    ];
    const [gym] = detect(rows);
    expect(gym).toMatchObject({ frequency: "monthly", amountCents: 2599, priceChange: null });
    expect(gym.oneOffs).toEqual([{ date: "2026-08-15", cents: 6499 }]);
  });

  it("keeps a monthly insurance payment separate from the six-month lump", () => {
    const rows = [
      ...monthly("Progressive", 14, [-85.12, -84.9, -85.12, -84.4, -85.12, -84.9]),
      row("Progressive", "2026-09-30", -412.5),
    ];
    const [insurance] = detect(rows);
    expect(insurance).toMatchObject({ frequency: "monthly", priceChange: null, oneOffs: [{ date: "2026-09-30", cents: 41250 }] });
    expect(insurance.amountCents).toBe(8490);
  });

  it("still sees a real price change that sticks", () => {
    const [peacock] = detect(monthly("Peacock", 9, [-7.99, -7.99, -7.99, -7.99, -10.99, -10.99]));
    expect(peacock.priceChange).toMatchObject({ fromCents: 799, toCents: 1099 });
  });
});

describe("paydays", () => {
  it("recognizes twice-a-month pay on fixed days, with weekend shifts", () => {
    // the 6th and 21st, with two paid early because of weekends
    const dates = ["2026-07-06", "2026-07-21", "2026-08-06", "2026-08-21", "2026-09-04", "2026-09-21", "2026-10-06"];
    const [pay] = detect(dates.map((date) => row("New Job Payroll", date, 2400)));
    expect(pay).toMatchObject({ frequency: "semimonthly", daysOfMonth: [6, 21], monthlyCents: 480000, annualCents: 5760000 });
    expect(pay.nextDate).toBe("2026-10-21");
    expect(pay.flexibleDay).toBe(false);
  });

  it("predicts the next payday across months", () => {
    const dates = ["2026-07-12", "2026-07-27", "2026-08-12", "2026-08-27", "2026-09-11", "2026-09-27"];
    const [pay] = detectRecurring(dates.map((date) => row("Northside Payroll", date, 2780, { person_id: "m" })), { today: "2026-09-28" });
    expect(pay).toMatchObject({ frequency: "semimonthly", daysOfMonth: [12, 27], nextDate: "2026-10-12" });
    expect(upcoming([pay], "2026-09-28", 31).map((entry) => entry.date)).toEqual(["2026-10-12", "2026-10-27"]);
  });

  it("still treats every-two-weeks pay as every two weeks", () => {
    const pay = Array.from({ length: 8 }, (_, i) => row("Acme Payroll", addDays("2026-06-05", i * 14), 3150));
    expect(detect(pay)[0]).toMatchObject({ frequency: "biweekly", daysOfMonth: null });
  });
});

describe("approximate dates", () => {
  it("marks a bill paid on varying days as approximate", () => {
    const dates = ["2026-04-14", "2026-05-09", "2026-06-17", "2026-07-12", "2026-08-15", "2026-09-10"];
    const [bill] = detect(dates.map((date) => row("Progressive", date, -85)));
    expect(bill.flexibleDay).toBe(true);
  });

  it("doesn't count a bill landing on the 31st instead of the 1st as moving around", () => {
    const dates = ["2026-04-01", "2026-05-01", "2026-05-31", "2026-07-01", "2026-08-01", "2026-09-01"];
    const [mortgage] = detect(dates.map((date) => row("Mortgage", date, -2450)));
    expect(mortgage.flexibleDay).toBe(false);
  });
});

describe("coming up", () => {
  it("lists expected dates in the window, repeating frequent ones", () => {
    const items = detect([
      ...monthly("Netflix", 7, [-19.99, -19.99, -19.99, -19.99, -19.99, -19.99]),
      ...Array.from({ length: 6 }, (_, i) => row("Acme Payroll", addDays("2026-07-17", i * 14), 3150)),
    ]);
    const soon = upcoming(items, today, 30).map(({ item, date }) => [item.merchant, date]);
    expect(soon).toEqual([
      ["Acme Payroll", "2026-10-09"],
      ["Netflix", "2026-10-07"],
      ["Acme Payroll", "2026-10-23"],
    ].sort((a, b) => a[1].localeCompare(b[1])));
  });
});

describe("the demo household", () => {
  it("finds its subscriptions, mortgage and paychecks", () => {
    const seed = generateSeedData({ endDate: today, johnId: "n", janeId: "m" });
    const merchants = detectRecurring(seed.transactions, { today }).map((item) => item.merchant);
    for (const name of ["Netflix", "Peacock", "Ring", "ChatGPT", "Summit Home Loans", "Oakwood Commons HOA", "Acme Corp Payroll"]) {
      expect(merchants, name).toContain(name);
    }
    for (const name of ["Starbucks", "Trader Joe's", "Chipotle"]) expect(merchants, name).not.toContain(name);
  });
});
