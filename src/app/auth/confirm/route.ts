import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/routes";
import { isSupabaseConfigured } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

// Landing point for links in sign-in and password-reset emails.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const destination = request.nextUrl.clone();
  destination.search = "";

  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const code = searchParams.get("code");
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type") as EmailOtpType | null;

    const result = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : tokenHash && type
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        : null;

    if (result && !result.error) {
      const next = new URL(safeNextPath(searchParams.get("next")), request.nextUrl.origin);
      destination.pathname = next.pathname;
      destination.search = next.search;
      return NextResponse.redirect(destination);
    }
  }

  destination.pathname = "/login";
  destination.searchParams.set("problem", "link");
  return NextResponse.redirect(destination);
}
