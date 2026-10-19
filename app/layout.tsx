import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/sidebar";
import TopBar from "@/components/layout/top-bar";
import { AppProvider } from "@/components/providers/app-provider";

export const metadata: Metadata = {
  title: "GrantPilot AI — Intelligent Grant Application Agent",
  description:
    "AI-assisted grant application generation & compliance checking workflow",
};

// Runs before the page paints, so the saved theme / language never flashes.
const preferenceScript = `
try {
  var d = document.documentElement;
  var theme = localStorage.getItem("grantpilot.theme");
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  if (theme === "dark") d.classList.add("dark");
  d.lang = localStorage.getItem("grantpilot.lang") === "en" ? "en" : "zh-CN";
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferenceScript }} />
      </head>
      <body className="bg-slate-50 text-slate-900 flex min-h-screen">
        <AppProvider>
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <TopBar />
            <main className="flex-1 p-8">{children}</main>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}