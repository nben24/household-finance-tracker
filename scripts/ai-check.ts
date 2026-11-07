// Checks the Anthropic API key with a tiny request (well under a cent).
// Sends four made-up merchant names; nothing from your accounts.
//
//   npm run ai:check

import { AI_MODEL, categorizeMerchants, isAiConfigured } from "../src/lib/ai/categorize-merchants";
import { DEFAULT_CATEGORIES } from "../src/lib/categories/defaults";

async function main() {
  if (!isAiConfigured()) {
    console.error("ANTHROPIC_API_KEY isn't set. Add it to .env.local (see .env.example).");
    process.exit(1);
  }
  const options = DEFAULT_CATEGORIES.flatMap((category) =>
    category.subcategories.map((sub) => ({ label: `${category.name} › ${sub.name}`, subcategoryId: `${category.name} › ${sub.name}` })),
  );
  const answers = await categorizeMerchants(
    [
      { merchant: "Burger King", bankCategory: "Restaurant-Bar & Café" },
      { merchant: "Luna Nail Studio", bankCategory: null },
      { merchant: "Riverside Animal Hospital", bankCategory: null },
      { merchant: "K&M Enterprises", bankCategory: null },
    ],
    options,
  );
  console.log(`${AI_MODEL} answered:`);
  for (const answer of answers) {
    console.log(`  ${answer.merchant.padEnd(28)} → ${answer.subcategoryId ?? "(couldn't tell)"} [${answer.confidence}]`);
  }
}

main().catch((error) => {
  console.error("The check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
