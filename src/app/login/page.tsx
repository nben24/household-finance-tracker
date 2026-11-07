import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/components/auth-forms";
import { safeNextPath } from "@/lib/auth/routes";
import { isDemoMode } from "@/lib/config";
import { firstParam } from "@/lib/params";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (isDemoMode) redirect("/");
  const params = await searchParams;
  const linkProblem = firstParam(params.problem) === "link";

  return (
    <AuthCard title="Sign in" subtitle="For household members only.">
      {linkProblem && (
        <p role="alert" className="mb-4 rounded-lg bg-notice-soft px-3 py-2 text-sm text-notice">
          That link has expired or was already used. Please request a new one.
        </p>
      )}
      <LoginForm next={safeNextPath(firstParam(params.next))} />
    </AuthCard>
  );
}
