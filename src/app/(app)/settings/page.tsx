import type { Metadata } from "next";
import { CategoryEditor } from "@/components/settings/category-editor";
import { Card, PageHeader, TextLink } from "@/components/ui";
import { getDataSource, requireHousehold } from "@/lib/data";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireHousehold();
  const data = getDataSource();
  const [accounts, categories] = await Promise.all([
    data.listAccounts(session.household.id),
    data.listCategories(session.household.id),
  ]);
  const memberNames = new Map(session.members.map((member) => [member.id, member.name]));

  return (
    <>
      <PageHeader title="Settings" subtitle={session.household.name} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="People">
          <ul className="divide-y divide-line">
            {session.members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{member.name}</span>
                  {member.id === session.user.id && <span className="ml-2 text-xs text-muted">you</span>}
                </span>
                <span className="truncate text-muted">{member.email}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Accounts">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">No accounts yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">
                      {account.institution} {account.account_name}
                    </span>
                    <span className="block text-xs text-muted">
                      {ACCOUNT_TYPE_LABELS[account.account_type]}
                      {account.last_four && ` ·· ${account.last_four}`}
                    </span>
                  </span>
                  <span className="text-muted">
                    {account.owner_user_id ? (memberNames.get(account.owner_user_id) ?? "") : "Joint"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        className="mt-4"
        title="Categories"
        action={<TextLink href="/settings/rules">Sorting rules →</TextLink>}
      >
        <CategoryEditor categories={categories} readOnly={session.isDemo} />
      </Card>
    </>
  );
}
