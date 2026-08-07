"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getTheme, toggleTheme, initTheme, type Theme } from "@/lib/theme";
import { useMe, clearMe } from "@/lib/useMe";
import type { MessageKey } from "@/lib/i18n";
import { apiPost, refreshIfStale } from "@/lib/client";
import { useT } from "@/lib/i18n";
import {
  IconBolt,
  IconReport,
  IconPullRequest,
  IconKey,
  IconDashboard,
  IconUsers,
  IconScan,
  IconMonitor,
  IconSun,
  IconMoon,
  IconLogout,
} from "@/lib/icons";

type NavItem = { href: string; labelKey: MessageKey; Icon: React.ComponentType; match: (p: string) => string };

const exact = (href: string) => (p: string) => (p === href ? "active" : "");
const prefix = (href: string) => (p: string) =>
  p === href || p.startsWith(href + "/") ? "active" : "";

// "Nova análise" cobre o fluxo de criação e o acompanhamento (results/report).
const NEW: NavItem = {
  href: "/",
  labelKey: "nav.newAnalysis",
  Icon: IconBolt,
  match: (p) =>
    p === "/" || p.startsWith("/results") || p.startsWith("/report")
      ? "active"
      : "",
};

const COMMON: NavItem[] = [
  { href: "/analyses", labelKey: "nav.analyses", Icon: IconReport, match: prefix("/analyses") },
  {
    href: "/pull-requests",
    labelKey: "nav.pullRequests",
    Icon: IconPullRequest,
    match: prefix("/pull-requests"),
  },
  { href: "/account", labelKey: "nav.account", Icon: IconKey, match: prefix("/account") },
];

const GOVERNANCE: NavItem[] = [
  { href: "/admin", labelKey: "nav.dashboard", Icon: IconDashboard, match: exact("/admin") },
  { href: "/admin/users", labelKey: "nav.users", Icon: IconUsers, match: prefix("/admin/users") },
  {
    href: "/admin/analyses",
    labelKey: "nav.globalAnalyses",
    Icon: IconScan,
    match: prefix("/admin/analyses"),
  },
  {
    href: "/admin/monitoring",
    labelKey: "nav.monitoring",
    Icon: IconMonitor,
    match: prefix("/admin/monitoring"),
  },
];


export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();
  const t = useT();
  const [theme, setThemeState] = useState<Theme>("dark");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    initTheme();
    setThemeState(getTheme());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  // Mantém a sessão viva enquanto a aba estiver em uso. O access token dura
  // 15 min; renovamos a cada 5 (se já tiver mais de 10 de idade) e ao voltar
  // para a aba, para que ninguém seja expulso no meio do trabalho.
  // Ver AUDITORIA.md#BUG-01.
  useEffect(() => {
    const KEEPALIVE_MS = 5 * 60_000;
    const MAX_AGE_MS = 10 * 60_000;

    const tick = () => {
      if (document.visibilityState === "visible") void refreshIfStale(MAX_AGE_MS);
    };
    const timer = setInterval(tick, KEEPALIVE_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await apiPost("/api/auth/logout");
    } catch {
      /* ignora: segue para o login de qualquer forma */
    }
    clearMe();
    router.push("/login");
  };

  const isSuper = me?.role === "superadmin";
  const items = [NEW, ...COMMON];

  const renderLink = (item: NavItem) => (
    <Link key={item.href} className={item.match(pathname)} href={item.href}>
      <item.Icon /> {t(item.labelKey)}
    </Link>
  );

  return (
    <div className={`app-shell ${open ? "sidebar-open" : ""}`}>
      <aside
        id="app-sidebar"
        className="sidebar"
        aria-label={t("nav.menu")}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        <div className="brand-col">
          <Image
            src="/starbridge-transparent.png"
            alt="Starbridge"
            width={150}
            height={34}
            priority
          />
          <span className="product-name">StarGuard</span>
        </div>

        <nav className="sidebar-nav">
          {items.map(renderLink)}

          {isSuper && (
            <>
              <div className="nav-section">{t("nav.governance")}</div>
              {GOVERNANCE.map(renderLink)}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-account">
            <span>{me?.name || "StarGuard"}</span>
            <p>
              {me
                ? `${t(me.role === "superadmin" ? "role.superadmin" : "role.admin")} · ${me.email}`
                : t("nav.activeAccount")}
            </p>
          </div>
          <div className="sidebar-actions">
            <button type="button" onClick={() => setThemeState(toggleTheme())}>
              {theme === "dark" ? <IconSun /> : <IconMoon />}
              {theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
            </button>
            <button type="button" className="danger" onClick={handleLogout}>
              <IconLogout /> {t("nav.logout")}
            </button>
          </div>
        </div>
      </aside>

      <button
        type="button"
        className="sidebar-overlay"
        aria-label={t("nav.close")}
        onClick={() => setOpen(false)}
      />
      <button
        type="button"
        className="mobile-menu-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="app-sidebar"
      >
        {open ? t("nav.close") : t("nav.menu")}
      </button>

      <main className="app-main">{children}</main>
    </div>
  );
}
