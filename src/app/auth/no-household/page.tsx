import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { AuthCard } from "@/components/auth-card";
import { getSession } from "@/lib/data";

export const metadata: Metadata = { title: "Almost there" };

export const dynamic = "force-dynamic";

export default async function NoHouseholdPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.household) redirect("/");

  return (
    <AuthCard
      title="Almost there"
      subtitle={`You're signed in as ${session.user.email}, but this login hasn't been added to a household yet.`}
    >
      <p className="text-sm text-muted">Ask the person who set up the app to add you, then sign in again.</p>
      <form action={signOut} className="mt-6">
        <button type="submit" className="text-sm font-medium text-accent hover:underline">
          Sign out
        </button>
      </form>
    </AuthCard>
  );
}
