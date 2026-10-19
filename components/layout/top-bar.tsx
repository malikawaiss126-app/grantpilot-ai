"use client";

import { Moon, Sun } from "lucide-react";
import { useApp, useT } from "@/components/providers/app-provider";

export default function TopBar() {
  const { lang, theme, setLang, toggleTheme } = useApp();
  const t = useT();

  const segment = (active: boolean) =>
    `px-3 h-7 text-xs font-semibold transition-colors ${
      active
        ? "bg-[#2c69cb] text-white"
        : "text-white/70 hover:text-white hover:bg-white/10"
    }`;

  return (
    <header className="sticky top-0 z-30 h-11 shrink-0 flex items-center justify-end gap-3 px-6 bg-[var(--sidebar)] border-b border-[var(--sidebar-line)]">
      {/* Language: 中文 | EN */}
      <div
        role="group"
        aria-label={t("Language")}
        className="flex items-center border border-white/25 rounded-sm overflow-hidden"
      >
        <button
          type="button"
          onClick={() => setLang("zh")}
          aria-pressed={lang === "zh"}
          aria-label={t("Switch language to Chinese")}
          title={t("Switch language to Chinese")}
          className={segment(lang === "zh")}
        >
          中文
        </button>
        <button
          type="button"
          onClick={() => setLang("en")}
          aria-pressed={lang === "en"}
          aria-label={t("Switch language to English")}
          title={t("Switch language to English")}
          className={`${segment(lang === "en")} border-l border-white/25`}
        >
          EN
        </button>
      </div>

      {/* Dark / light mode */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={
          theme === "dark"
            ? t("Switch to light mode")
            : t("Switch to dark mode")
        }
        title={
          theme === "dark"
            ? t("Switch to light mode")
            : t("Switch to dark mode")
        }
        className="flex items-center gap-1.5 h-7 px-2.5 text-xs font-semibold text-white/80 hover:text-white border border-white/25 rounded-sm hover:bg-white/10 transition-colors"
      >
        {theme === "dark" ? (
          <Sun className="w-3.5 h-3.5" aria-hidden="true" />
        ) : (
          <Moon className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        <span>{theme === "dark" ? t("Light mode") : t("Dark mode")}</span>
      </button>
    </header>
  );
}
