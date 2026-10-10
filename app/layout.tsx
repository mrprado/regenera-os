import type { Metadata } from "next";
import "@/styles/globals.css";
import { cookies } from "next/headers";
import { THEME_COOKIE, themeOrDefault } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "Regenera OS", template: "%s | Regenera OS" },
  robots: { index: false, follow: false },
  // The gold R on white (public/, cropped from "Regenera Favicon.png", Brand_Website/Assets, 2026-10-08).
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/icon-32.png", type: "image/png", sizes: "32x32" }, { url: "/icon.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Phase 26: the theme is applied on the server so a page never flashes light before turning dark.
  const theme = themeOrDefault((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
