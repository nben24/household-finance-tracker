import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppearancePicker } from "@/components/settings/appearance-picker";
import { TimeZonePicker } from "@/components/settings/time-zone-picker";
import { secondaryButton } from "@/components/styles";
import { COMMON_TIME_ZONES, householdTimeZone } from "@/lib/household-time";
import { CategoryEditor } from "@/components/settings/category-editor";
import { Card, PageHeader, TextLink } from "@/components/ui";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MODE_COOKIE, parseMode, parseTheme, THEME_COOKIE } from "@/lib/appearance";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireHousehold();
  const data = getDataSource();
  const [accounts, categories, cookieStore] = await Promise.all([
    data.listAccounts(session.household.id),
    data.listCategories(session.household.id),
    cookies(),
  ]);
  const memberNames = new Map(session.members.map((member) => [member.id, member.name]));

  return (
    <>
      <PageHeader title="Settings" subtitle={session.household.name} />

      <Card className="mb-4" title="Household calendar">
        <TimeZonePicker
          current={householdTimeZone(session.household)}
          options={[...new Set([householdTimeZone(session.household), ...COMMON_TIME_ZONES])]}
          readOnly={session.isDemo}
        />
      </Card>

      <Card className="mb-4" title="Appearance">
        <AppearancePicker
          theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
          mode={parseMode(cookieStore.get(MODE_COOKIE)?.value)}
        />
      </Card>

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
          <p className="mb-2 text-[13px] text-muted">Joint accounts&apos; purchases appear under Shared.</p>
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
                  <span className="text-right text-muted">
                    {account.owner_user_id ? (memberNames.get(account.owner_user_id) ?? "") : "Joint"}
                    {!account.is_active && <span className="block text-xs">retired</span>}
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
      <section id="backup" className="mt-4 scroll-mt-6">
        <Card title="Your records">
          <p className="max-w-prose text-sm text-muted">
            Download every transaction to the cent, or a complete backup (transactions with their split parts, accounts,
            balances, categories, rules, budgets and settings) in a versioned format. Downloads include only what you can
            see, so the other person&apos;s unrevealed private purchases are left out.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/reports/ledger" className={secondaryButton}>
              All transactions (CSV)
            </a>
            <a href="/settings/backup" className={secondaryButton}>
              Full backup (JSON)
            </a>
          </div>
        </Card>
      </section>
    </>
  );
}
