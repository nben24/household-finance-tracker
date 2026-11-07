"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/routes";
import { isSupabaseConfigured } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export interface AuthFormState {
  error?: string;
  message?: string;
}

const MIN_PASSWORD_LENGTH = 10;
const LINK_SENT = "If that email belongs to this household, a link is on its way. Check your inbox.";

function emailFrom(formData: FormData): string {
  return String(formData.get("email") ?? "").trim().toLowerCase();
}

async function siteOrigin(): Promise<string> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin) return origin;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}

export async function signIn(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseConfigured) redirect("/");
  const email = emailFrom(formData);
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "That email and password didn't match. Please try again." };

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function sendMagicLink(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseConfigured) redirect("/");
  const email = emailFrom(formData);
  if (!email) return { error: "Enter your email address." };

  const supabase = await createClient();
  // shouldCreateUser: false — only existing household members can sign in.
  // Errors are not shown so the form never reveals which emails have accounts.
  await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${await siteOrigin()}/auth/confirm` },
  });
  return { message: LINK_SENT };
}

export async function sendPasswordReset(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseConfigured) redirect("/");
  const email = emailFrom(formData);
  if (!email) return { error: "Enter your email address." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/auth/reset-password`,
  });
  return { message: LINK_SENT };
}

export async function updatePassword(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseConfigured) redirect("/");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmation) return { error: "The two passwords don't match." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Please request a new one." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "We couldn't save that password. Please try a different one." };

  redirect("/");
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
