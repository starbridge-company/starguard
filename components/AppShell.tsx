"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getTheme, toggleTheme, initTheme, type Theme } from "@/lib/theme";
import { useMe, clearMe } from "@/lib/useMe";
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

type NavItem = { href: string; label: string; Icon: React.ComponentType; match: (p: string) => string };

const exact = (href: string) => (p: string) => (p === href ? "active" : "");
const prefix = (href: string) => (p: string) =>
  p === href || p.startsWith(href + "/") ? "active" : "";

// "Nova análise" cobre o fluxo de criação e o acompanhamento (results/report).
const NEW: NavItem = {
  href: "/",
  label: "Nova análise",
  Icon: IconBolt,
  match: (p) =>
    p === "/" || p.startsWith("/results") || p.startsWith("/report")
      ? "active"
      : "",
};

const COMMON: NavItem[] = [
  { href: "/analyses", label: "Análises", Icon: IconReport, match: prefix("/analyses") },
  {
    href: "/pull-requests",
    label: "Pull Requests",
    Icon: IconPullRequest,
    match: prefix("/pull-requests"),
  },
  { href: "/account", label: "Conta", Icon: IconKey, match: prefix("/account") },
];

const GOVERNANCE: NavItem[] = [
  { href: "/admin", label: "Painel", Icon: IconDashboard, match: exact("/admin") },
  { href: "/admin/users", label: "Usuários", Icon: IconUsers, match: prefix("/admin/users") },
  {
    href: "/admin/analyses",
    label: "Análises globais",
    Icon: IconScan,
    match: prefix("/admin/analyses"),
  },
  {
    href: "/admin/monitoring",
    label: "Monitoramento",
    Icon: IconMonitor,
    match: prefix("/admin/monitoring"),
  },
];

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();
  const [theme, setThemeState] = useState<Theme>("dark");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    initTheme();
    setThemeState(getTheme());
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
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
      <item.Icon /> {item.label}
    </Link>
  );

  return (
    <div className={`app-shell ${open ? "sidebar-open" : ""}`}>
      <aside
        className="sidebar"
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
              <div className="nav-section">Governança</div>
              {GOVERNANCE.map(renderLink)}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-account">
            <span>{me?.name || "StarGuard"}</span>
            <p>
              {me ? `${ROLE_LABEL[me.role] || me.role} · ${me.email}` : "conta ativa"}
            </p>
          </div>
          <div className="sidebar-actions">
            <button type="button" onClick={() => setThemeState(toggleTheme())}>
              {theme === "dark" ? <IconSun /> : <IconMoon />}
              {theme === "dark" ? "Modo claro" : "Modo escuro"}
            </button>
            <button type="button" className="danger" onClick={handleLogout}>
              <IconLogout /> Sair
            </button>
          </div>
        </div>
      </aside>

      <button
        type="button"
        className="sidebar-overlay"
        aria-label="Fechar menu"
        onClick={() => setOpen(false)}
      />
      <button
        type="button"
        className="mobile-menu-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Fechar" : "Menu"}
      </button>

      <main className="app-main">{children}</main>
    </div>
  );
}
