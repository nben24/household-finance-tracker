import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Asks Claude to pick a category for merchants the rules don't know.
//
// Privacy: only the cleaned-up merchant name and the bank's own category label
// are sent. Never amounts, dates, accounts, descriptions or people's names
// (payment-app merchants such as "Zelle · Name" are filtered out before this).

export const AI_MODEL = "claude-haiku-4-5";
const BATCH_SIZE = 100;
export const MAX_MERCHANTS_PER_RUN = 300;

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface MerchantQuestion {
  merchant: string;
  bankCategory: string | null;
}

export interface MerchantAnswer {
  merchant: string;
  /** a subcategory id, or null when the model couldn't tell */
  subcategoryId: string | null;
  confidence: "high" | "low";
}

export interface CategoryOption {
  /** "Food › Restaurants" */
  label: string;
  subcategoryId: string;
}

const UNKNOWN = "Unknown";

const SYSTEM = `You sort merchants from a US household's bank and credit card statements into budget categories.

For each merchant, choose the single best category from the allowed list. Merchant names have been cleaned up from bank descriptions; a bank's own category label is included when available and is usually a good hint.

Use confidence "high" only when the merchant clearly belongs in that category (for example, a well-known restaurant chain is Food › Restaurants). Use "low" when the merchant could reasonably belong in more than one category, or when you are inferring from a vague name. If you cannot tell at all, answer "${UNKNOWN}" with confidence "low".`;

/** The smallest surface the rest of the app needs, so tests can supply a fake. */
export type AskModel = (system: string, user: string, schema: Record<string, unknown>) => Promise<string>;

export const askClaude: AskModel = async (system, user, schema) => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema } },
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to answer.");
  if (response.stop_reason === "max_tokens") throw new Error("The AI's answer was cut off.");
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("The AI returned no answer.");
  return text.text;
};

function schemaFor(labels: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            category: { type: "string", enum: [...labels, UNKNOWN] },
            confidence: { type: "string", enum: ["high", "low"] },
          },
          required: ["index", "category", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };
}

export async function categorizeMerchants(
  questions: MerchantQuestion[],
  options: CategoryOption[],
  ask: AskModel = askClaude,
): Promise<MerchantAnswer[]> {
  const byLabel = new Map(options.map((option) => [option.label, option.subcategoryId]));
  const labels = options.map((option) => option.label);
  const answers: MerchantAnswer[] = [];

  for (let start = 0; start < Math.min(questions.length, MAX_MERCHANTS_PER_RUN); start += BATCH_SIZE) {
    const batch = questions.slice(start, start + BATCH_SIZE);
    const user = [
      "Categorize each merchant. Answer once per index.",
      "",
      ...batch.map((question, index) =>
        JSON.stringify({ index, merchant: question.merchant.slice(0, 60), bank_label: question.bankCategory?.slice(0, 60) ?? null }),
      ),
    ].join("\n");

    const parsed = JSON.parse(await ask(SYSTEM, user, schemaFor(labels))) as {
      results?: { index?: unknown; category?: unknown; confidence?: unknown }[];
    };
    const seen = new Set<number>();
    for (const result of parsed.results ?? []) {
      const index = typeof result.index === "number" ? result.index : -1;
      const question = batch[index];
      if (!question || seen.has(index)) continue;
      seen.add(index);
      const subcategoryId = typeof result.category === "string" ? (byLabel.get(result.category) ?? null) : null;
      answers.push({
        merchant: question.merchant,
        subcategoryId,
        confidence: subcategoryId && result.confidence === "high" ? "high" : "low",
      });
    }
  }
  return answers;
}
