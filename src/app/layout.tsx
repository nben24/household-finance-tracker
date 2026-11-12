import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import { MODE_COOKIE, parseMode, parseTheme, THEME_COOKIE } from "@/lib/appearance";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Household Finance", template: "%s · Household Finance" },
  description: "Private household spending and budget tracker.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // read on the server so the page arrives in the right colors, with no flash
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  const mode = parseMode(cookieStore.get(MODE_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme}
      data-mode={mode}
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
