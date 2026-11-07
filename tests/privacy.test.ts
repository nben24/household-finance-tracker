import { describe, expect, it } from "vitest";
import { merchantsToAsk } from "@/lib/categories/ai-sort";
import { groupByMerchant } from "@/lib/categories/catch-up";
import { toReviewItem } from "@/lib/categories/view";
import { PRIVATE_LABEL, canKeepPrivate, isPrivateNow } from "@/lib/finance/privacy";
import { generateSeedData } from "@/lib/seed/generate";

const seed = generateSeedData({ endDate: "2026-10-01", johnId: "n", janeId: "m" });
const purchase = seed.transactions.find((t) => t.transaction_type === "expense" && t.person_id === "n")!;
const gift = { ...purchase, normalized_merchant: "Tiffany & Co", original_description: "TIFFANY & CO 123", is_private: true, private_until: null };

describe("private purchases", () => {
  it("stay private until their reveal date", () => {
    expect(isPrivateNow(gift, "2026-10-01")).toBe(true);
    expect(isPrivateNow({ ...gift, private_until: "2026-10-15" }, "2026-10-14")).toBe(true);
    expect(isPrivateNow({ ...gift, private_until: "2026-10-15" }, "2026-10-15")).toBe(false);
    expect(isPrivateNow({ ...gift, is_private: false }, "2026-10-01")).toBe(false);
  });

  it("can only be your own purchases or refunds", () => {
    expect(canKeepPrivate(gift, "n")).toBe(true);
    expect(canKeepPrivate(gift, "m")).toBe(false);
    expect(canKeepPrivate({ ...gift, transaction_type: "transfer" }, "n")).toBe(false);
    expect(canKeepPrivate({ ...gift, transaction_type: "reimbursement" }, "n")).toBe(false);
    expect(canKeepPrivate({ ...gift, person_id: null }, "n")).toBe(false);
  });

  it("are masked in queues, but shown in full on their own page", () => {
    const accounts = new Map(seed.accounts.map((a) => [a.id, a]));
    const members = new Map([["n", { id: "n", name: "John", email: "", role: "owner" as const, created_at: "" }]]);
    const inQueue = toReviewItem(gift, accounts, members, seed.rules, "2026-10-01");
    expect(inQueue.merchant).toBe(PRIVATE_LABEL);
    expect(JSON.stringify(inQueue)).not.toContain("TIFFANY");
    expect(inQueue.alwaysDefault).toBe(false);
    const onItsPage = toReviewItem(gift, accounts, members, seed.rules);
    expect(onItsPage.merchant).toBe("Tiffany & Co");
  });

  it("are masked in Catch-up groups", () => {
    const [group] = groupByMerchant([gift]);
    expect(group.displayName).toBe(PRIVATE_LABEL);
    expect(group.example).not.toContain("TIFFANY");
  });

  it("are never sent to the AI", () => {
    const uncategorized = { ...gift, category_id: null, subcategory_id: null };
    expect(merchantsToAsk([uncategorized], new Set())).toEqual([]);
    expect(merchantsToAsk([{ ...uncategorized, is_private: false }], new Set())).toHaveLength(1);
  });
});
