import type { Metadata } from "next";
import { RuleManager } from "@/components/settings/rule-manager";
import { Card, PageHeader, TextLink } from "@/components/ui";
import { categoryGroups } from "@/lib/categories/view";
import { getDataSource, requireHousehold } from "@/lib/data";

export const metadata: Metadata = { title: "Sorting rules" };

export default async function RulesPage() {
  const session = await requireHousehold();
  const data = getDataSource();
  const [rules, categories] = await Promise.all([
    data.listRules(session.household.id),
    data.listCategories(session.household.id),
  ]);

  return (
    <>
      <PageHeader
        title="Sorting rules"
        subtitle="How the app picks a category for each purchase. The most specific rule wins: merchant, then description, then the bank's own category."
      >
        <TextLink href="/settings">← Settings</TextLink>
      </PageHeader>
      <Card>
        <RuleManager rules={rules} groups={categoryGroups(categories)} readOnly={session.isDemo} />
      </Card>
      <p className="mt-3 max-w-prose text-xs text-muted">
        Rules are also learned during Sunday Review: ticking “Always use this category” adds a rule that sorts
        automatically, and leaving it unticked saves a suggestion for next time.
      </p>
    </>
  );
}
