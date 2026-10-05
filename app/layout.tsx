import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { PyramidProvider } from "@/components/pyramid-provider";
import { AppShell } from "@/components/app-shell";
import { PwaRegister } from "@/components/pwa-register";
import { AuthProvider } from "@/components/auth-provider";
import { SyncProvider } from "@/components/sync-provider";
import { ModeProvider } from "@/components/mode-provider";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "CoachOps - كوتش أوبس",
  description: "تطبيق لإدارة الأندية ومدربي كرة القدم",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48 32x32 16x16", type: "image/x-icon" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "CoachOps",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>
          <SyncProvider>
            <PyramidProvider>
              {/* Inside the providers, so the sidebar and pages can both read
                  the current mode. */}
              <ModeProvider>
                <AppShell>{children}</AppShell>
              </ModeProvider>
            </PyramidProvider>
          </SyncProvider>
        </AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
