// The import's server actions, run end to end against an in-memory database:
// staged saving, retries that never duplicate, accurate partial results,
// privacy chosen before saving, and answers about hand-added entries.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedTransaction } from "@/lib/import/types";
import { generateSeedData } from "@/lib/seed/generate";
import { memoryData, type MemoryData } from "./helpers/memory-data";

const TODAY = "2026-10-20";
let data: MemoryData;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: () => {},
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/data/supabase", () => ({ MISSING_MIGRATION: "The database needs an update." }));
vi.mock("@/lib/data", async () => {
  const filters = await import("@/lib/data/filters");
  return {
    ...filters,
    getDataSource: () => data,
    requireHousehold: async () => data.getSession(),
    getSession: async () => data.getSession(),
  };
});
vi.mock("@/lib/household-time", async () => {
  const actual = await vi.importActual<typeof import("@/lib/household-time")>("@/lib/household-time");
  return { ...actual, householdToday: () => TODAY };
});

const { previewImport, saveImport, sortImport } = await import("@/app/(app)/import/actions");

const row = (date: string, description: string, amount: number): NormalizedTransaction => ({
  transactionDate: date,
  postingDate: null,
  originalDescription: description,
  amount,
  transactionTypeHint: null,
  sourceId: null,
  merchantHint: null,
  bankCategory: null,
});

let seed: ReturnType<typeof generateSeedData>;
let john: string;
let jane: string;
const johnsCard = () => seed.accounts.find((a) => a.owner_user_id === john && a.account_type === "credit_card")!;
const janesChecking = () => seed.accounts.find((a) => a.owner_user_id === jane && a.account_type === "checking")!;

const file = (accountId: string, rows: NormalizedTransaction[], coveredThrough: string | null = "2026-10-14") => ({
  fileKey: randomUUID(),
  fileName: "activity.csv",
  accountId,
  coveredThrough,
  transactions: rows,
  latestBalance: null,
});

const october = () => [
  row("2026-10-05", "WHOLE FOODS MARKET #123", -84.21),
  row("2026-10-07", "UNFAMILIAR BOUTIQUE 77", -120),
  row("2026-10-09", "SHELL OIL 5532", -45.5),
];

beforeEach(() => {
  john = randomUUID();
  jane = randomUUID();
  seed = generateSeedData({ endDate: "2026-10-01", johnId: john, janeId: jane, months: 3 });
  data = memoryData(seed, TODAY);
  data.as(john);
});

const ofBatch = (batchId: string) => data.transactions.filter((t) => t.import_batch_id === batchId);

describe("saving an import", () => {
  it("saves new rows once, records what the file covers, and reports exact counts", async () => {
    const batchId = randomUUID();
    const result = await saveImport({ batchId, files: [file(johnsCard().id, october())] });
    expect(result).toMatchObject({ ok: true, batchId, added: 3, matched: 0, duplicatesSkipped: 0 });
    expect(ofBatch(batchId)).toHaveLength(3);
    expect(data.batches[0]).toMatchObject({ id: batchId, status: "saved" });
    expect(data.coverage.at(-1)).toMatchObject({
      account_id: johnsCard().id,
      covered_from: "2026-10-05",
      covered_through: "2026-10-14",
      source: "import",
    });
  });

  it("can be retried with the same batch without saving anything twice", async () => {
    const batchId = randomUUID();
    const request = { batchId, files: [file(johnsCard().id, october())] };
    await saveImport(request);
    const again = await saveImport(request);
    expect(again).toMatchObject({ ok: true, added: 3, duplicatesSkipped: 0 });
    expect(ofBatch(batchId)).toHaveLength(3);
    expect(data.coverage.filter((c) => c.covered_from === "2026-10-05")).toHaveLength(1);
  });

  it("reports a save that stopped partway honestly, then finishes on retry", async () => {
    const batchId = randomUUID();
    const request = { batchId, files: [file(johnsCard().id, october())] };
    data.failOn("listCoverage"); // after the rows are saved, before the import is finished
    const failed = await saveImport(request);
    expect(failed).toMatchObject({ ok: false, batchId, savedSoFar: 3 });
    expect(!failed.ok && failed.error).toMatch(/3 transactions were saved.*nothing will be saved twice/i);
    expect(data.batches[0].status).toBe("saving");

    const retried = await saveImport(request);
    expect(retried).toMatchObject({ ok: true, added: 3 });
    expect(ofBatch(batchId)).toHaveLength(3);
    expect(data.batches[0].status).toBe("saved");
  });

  it("says nothing was saved when nothing was", async () => {
    data.failOn("insertTransactions");
    const failed = await saveImport({ batchId: randomUUID(), files: [file(johnsCard().id, october())] });
    expect(failed).toMatchObject({ ok: false });
    expect(!failed.ok && failed.error).toMatch(/nothing was saved/i);
  });

  it("refuses an import without a valid batch id", async () => {
    expect(await saveImport({ batchId: "nope", files: [file(johnsCard().id, october())] })).toMatchObject({ ok: false });
  });

  it("never records coverage ending before the file's own last row", async () => {
    const batchId = randomUUID();
    await saveImport({ batchId, files: [file(johnsCard().id, october(), "2026-10-01")] });
    expect(data.coverage.at(-1)).toMatchObject({ covered_from: "2026-10-05", covered_through: "2026-10-09" });
  });
});

describe("sorting after saving", () => {
  it("counts this import's decisions separately from everything waiting", async () => {
    const batchId = randomUUID();
    await saveImport({ batchId, files: [file(johnsCard().id, october())] });
    const sorted = await sortImport({ batchId });
    expect(sorted.ok).toBe(true);
    if (!sorted.ok) return;
    const waitingFromBatch = ofBatch(batchId).filter((t) => t.review_status === "needs_review").length;
    const waitingAll = data.transactions.filter((t) => t.review_status === "needs_review").length;
    expect(sorted.newDecisions).toBe(waitingFromBatch);
    expect(sorted.allWaiting).toBe(waitingAll);
    expect(sorted.allWaiting).toBeGreaterThanOrEqual(sorted.newDecisions);
    expect(data.batches[0].status).toBe("sorted");
  });

  it("keeps the saved transactions when sorting fails, and can be run again", async () => {
    const batchId = randomUUID();
    await saveImport({ batchId, files: [file(johnsCard().id, october())] });
    data.failOn("listTransactions");
    const failed = await sortImport({ batchId });
    expect(failed).toMatchObject({ ok: false });
    expect(!failed.ok && failed.error).toMatch(/transactions are saved/i);
    expect(ofBatch(batchId)).toHaveLength(3);
    expect(data.batches[0].status).toBe("saved");
    expect((await sortImport({ batchId })).ok).toBe(true);
  });
});

describe("keeping an imported purchase private before it's saved", () => {
  it("saves it private, so the other person never sees it and it's never sent to the AI", async () => {
    const batchId = randomUUID();
    const preview = await previewImport({ batchId, files: [file(johnsCard().id, october())] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const boutique = preview.files[0].fresh.find((r) => r.description.startsWith("UNFAMILIAR"))!;
    expect(boutique.privateEligible).toBe(true);

    await saveImport({
      batchId,
      files: [file(johnsCard().id, october())],
      privateChoices: [{ sourceHash: boutique.key, until: "2026-12-25" }],
    });
    const saved = data.transactions.find((t) => t.source_hash === boutique.key)!;
    expect(saved).toMatchObject({ is_private: true, private_until: "2026-12-25" });

    const { merchantsToAsk } = await import("@/lib/categories/ai-sort");
    expect(merchantsToAsk([saved], new Set()).map((q) => q.merchant)).not.toContain(saved.normalized_merchant);

    data.as(jane);
    expect(await data.getTransaction(seed.household.id, saved.id)).toBeNull();
  });

  it("refuses to make someone else's purchase private", async () => {
    const batchId = randomUUID();
    const files = [file(janesChecking().id, [row("2026-10-06", "TARGET 0099", -30)])];
    const preview = await previewImport({ batchId, files });
    if (!preview.ok) throw new Error(preview.error);
    const target = preview.files[0].fresh[0];
    expect(target.privateEligible).toBe(false);
    const result = await saveImport({ batchId, files, privateChoices: [{ sourceHash: target.key, until: null }] });
    expect(result).toMatchObject({ ok: false });
    expect(data.transactions.some((t) => t.source_hash === target.key)).toBe(false);
  });
});

describe("hand-added entries in an import", () => {
  const addEntry = (merchant: string, date: string, amount: number, extra: Record<string, unknown> = {}) => {
    const entry = {
      ...seed.transactions[0],
      id: randomUUID(),
      account_id: johnsCard().id,
      person_id: john,
      transaction_date: date,
      original_description: merchant,
      normalized_merchant: merchant,
      amount,
      transaction_type: "expense" as const,
      is_manual: true,
      awaiting_post: true,
      source_hash: null,
      is_private: false,
      private_until: null,
      ...extra,
    };
    data.transactions.push(entry);
    return entry;
  };

  it("replaces a clear match automatically, keeping its privacy and reveal date", async () => {
    const entry = addEntry("Whole Foods", "2026-10-04", -80, { is_private: true, private_until: "2026-11-30", notes: "party" });
    const batchId = randomUUID();
    const preview = await previewImport({ batchId, files: [file(johnsCard().id, october())] });
    if (!preview.ok) throw new Error(preview.error);
    const match = preview.files[0].fresh.find((r) => r.match)!;
    expect(match.match).toMatchObject({ entryId: entry.id, strength: "strong", merchant: "Private purchase", isPrivate: true });

    const saved = await saveImport({ batchId, files: [file(johnsCard().id, october())] });
    expect(saved).toMatchObject({ ok: true, matched: 1, added: 2 });
    expect(data.transactions.find((t) => t.id === entry.id)).toMatchObject({
      amount: -84.21,
      is_manual: false,
      awaiting_post: false,
      is_private: true,
      private_until: "2026-11-30",
      notes: "party",
    });
  });

  it("keeps an unclear match separate unless the person says it's the same purchase", async () => {
    const entry = addEntry("Corner Cafe", "2026-10-08", -45);
    const files = [file(johnsCard().id, october())];
    const batchId = randomUUID();
    const preview = await previewImport({ batchId, files });
    if (!preview.ok) throw new Error(preview.error);
    const shell = preview.files[0].fresh.find((r) => r.description.startsWith("SHELL"))!;
    expect(shell.match).toMatchObject({ entryId: entry.id, strength: "possible" });

    await saveImport({ batchId, files, matchDecisions: [{ entryId: entry.id, sourceHash: shell.key, same: false }] });
    expect(data.transactions.find((t) => t.id === entry.id)).toMatchObject({ awaiting_post: true, is_manual: true });
    expect(data.transactions.filter((t) => t.source_hash === shell.key)).toHaveLength(1);
  });

  it("replaces it when the person says 'Same purchase'", async () => {
    const entry = addEntry("Corner Cafe", "2026-10-08", -45);
    const files = [file(johnsCard().id, october())];
    const batchId = randomUUID();
    const preview = await previewImport({ batchId, files });
    if (!preview.ok) throw new Error(preview.error);
    const shell = preview.files[0].fresh.find((r) => r.description.startsWith("SHELL"))!;
    const saved = await saveImport({ batchId, files, matchDecisions: [{ entryId: entry.id, sourceHash: shell.key, same: true }] });
    expect(saved).toMatchObject({ ok: true, matched: 1, added: 2 });
    expect(data.transactions.find((t) => t.id === entry.id)).toMatchObject({ awaiting_post: false, source_hash: shell.key });
  });

  it("doesn't replace the same entry again when the same file is imported later", async () => {
    addEntry("Whole Foods", "2026-10-04", -80);
    const files = [file(johnsCard().id, october())];
    await saveImport({ batchId: randomUUID(), files });
    const count = data.transactions.length;
    const second = await saveImport({ batchId: randomUUID(), files });
    expect(second).toMatchObject({ ok: true, added: 0, matched: 0, duplicatesSkipped: 3 });
    expect(data.transactions.length).toBe(count);
  });
});
