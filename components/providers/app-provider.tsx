"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  isLang,
  localeOf,
  translate,
  type Dict,
  type Lang,
  type Params,
} from "@/lib/i18n";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "grantpilot.theme";
const CHANGE_EVENT = "grantpilot:prefs";

// --- Preferences are kept in localStorage and read with useSyncExternalStore.
//     The server always renders Chinese + light; the browser then switches to
//     the saved choice right after loading.

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function readLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable: fall through to the system setting */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode etc.: the choice just won't be remembered */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// --- Context -----------------------------------------------------------------

interface AppContextValue {
  lang: Lang;
  theme: Theme;
  locale: string;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, readLang, () => DEFAULT_LANG);
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    readTheme,
    () => "light",
  );

  // Keep <html> in sync: the "dark" class drives all colours (see globals.css).
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setLang = useCallback(
    (next: Lang) => writePref(LANG_STORAGE_KEY, next),
    [],
  );
  const setTheme = useCallback(
    (next: Theme) => writePref(THEME_STORAGE_KEY, next),
    [],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      lang,
      theme,
      locale: localeOf(lang),
      setLang,
      toggleLang: () => setLang(lang === "zh" ? "en" : "zh"),
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [lang, theme, setLang, setTheme],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** Current language / theme and the functions that change them. */
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>.");
  return ctx;
}

/**
 * Translation function for a component.
 * Pass the page's own Chinese dictionary (defined at module level) as `pageDict`.
 *
 *   const zh = { "Create Project": "创建项目" };
 *   const t = useT(zh);
 *   <h1>{t("Create Project")}</h1>
 */
export function useT(pageDict?: Dict) {
  const { lang } = useApp();
  return useCallback(
    (key: string, params?: Params) => translate(lang, key, params, pageDict),
    [lang, pageDict],
  );
}
