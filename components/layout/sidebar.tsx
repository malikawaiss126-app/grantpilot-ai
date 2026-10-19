"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  FolderPlus,
  Sliders,
  Sparkles,
  CheckCircle2,
  Settings,
} from "lucide-react";
import { useT } from "@/components/providers/app-provider";

interface NavItem {
  name: string;
  href: string;
  icon: typeof Sparkles;
  /** Pages that work on one project keep the current ?project=<id>. */
  projectScoped?: boolean;
}

// "name" is also the translation key (see lib/i18n).
const navigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "New Project", href: "/projects/new", icon: FolderPlus },
  {
    name: "Prompt Studio",
    href: "/prompt-studio",
    icon: Sliders,
    projectScoped: true,
  },
  {
    name: "Generation",
    href: "/generation",
    icon: Sparkles,
    projectScoped: true,
  },
  {
    name: "Compliance",
    href: "/compliance",
    icon: CheckCircle2,
    projectScoped: true,
  },
  { name: "Settings", href: "/settings", icon: Settings },
];

interface ModelInfo {
  model: string;
  apiKeyConfigured: boolean;
}

function ModelBadge() {
  const t = useT();
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then(async (res) => {
        if (!res.ok) throw new Error("bad status");
        return (await res.json()) as ModelInfo;
      })
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="px-3 py-2.5 border border-[var(--sidebar-line)] bg-black/20 rounded-sm">
      <p className="text-xs text-white/60">{t("Active Model")}</p>
      {info ? (
        <>
          <p className="text-xs font-semibold text-[#8ab5f0] mt-0.5 break-all">
            {info.model}
          </p>
          {!info.apiKeyConfigured && (
            <p className="text-xs text-[#ff9b9b] mt-1">
              {t("API key missing")}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs font-semibold text-white/60 mt-0.5">
          {failed ? t("Unavailable") : t("Loading...")}
        </p>
      )}
    </div>
  );
}

function Nav() {
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  return (
    <nav className="flex-1 py-4 overflow-y-auto">
      {navigation.map((item) => {
        const isActive =
          pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const href =
          item.projectScoped && projectId
            ? `${item.href}?project=${encodeURIComponent(projectId)}`
            : item.href;
        return (
          <Link
            key={item.name}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-3 pl-5 pr-4 py-3 text-sm border-l-[3px] transition-colors ${
              isActive
                ? "border-[#3580e5] bg-white/10 text-white font-semibold"
                : "border-transparent text-white/75 hover:text-white hover:bg-white/5"
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t(item.name)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  const t = useT();
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <div className="px-5 py-5 border-b border-[var(--sidebar-line)] flex items-center gap-3">
      {logoFailed ? (
        <div className="w-12 h-12 shrink-0 flex items-center justify-center bg-[#2c69cb] rounded-sm">
          <Sparkles className="w-6 h-6 text-white" aria-hidden="true" />
        </div>
      ) : (
        <Image
          src="/logo.png"
          alt="GrantPilot AI"
          width={500}
          height={500}
          priority
          onError={() => setLogoFailed(true)}
          className="w-12 h-12 shrink-0 object-contain"
        />
      )}
      <div className="min-w-0">
        <h1 className="font-bold text-lg leading-tight text-white">
          GrantPilot AI
        </h1>
        <span className="text-xs text-white/65 leading-snug block">
          {t("Intelligent Grant Writing")}
        </span>
      </div>
    </div>
  );
}

export default function Sidebar() {
  return (
    <aside className="w-64 shrink-0 bg-[var(--sidebar)] text-white flex flex-col h-screen sticky top-0 border-r border-[var(--sidebar-line)]">
      <Brand />

      {/* useSearchParams needs a Suspense boundary */}
      <Suspense fallback={<nav className="flex-1" />}>
        <Nav />
      </Suspense>

      <div className="p-4 border-t border-[var(--sidebar-line)]">
        <ModelBadge />
      </div>
    </aside>
  );
}
