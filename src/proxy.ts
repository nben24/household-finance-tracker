import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRedirectFor } from "@/lib/auth/routes";
import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

// Keeps the login session fresh and turns away signed-out visitors early.
// This is a convenience layer: pages re-check the session, and the database
// enforces access with Row Level Security.
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const destination = authRedirectFor(request.nextUrl.pathname, Boolean(data?.claims));
  if (!destination) return response;

  const url = request.nextUrl.clone();
  url.pathname = destination;
  url.search = "";
  if (destination === "/login" && request.nextUrl.pathname !== "/") {
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  }
  const redirectResponse = NextResponse.redirect(url);
  // carry over any refreshed session cookies
  for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
  return redirectResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
