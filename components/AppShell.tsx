"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getTheme, toggleTheme, initTheme, type Theme } from "@/lib/theme";
import {
  IconDashboard,
  IconPlan,
  IconSkills,
  IconScan,
  IconRefactor,
  IconSun,
  IconMoon,
  IconLogout,
} from "@/lib/icons";

const PIPELINE = [
  { label: "Plan · Ameaças", Icon: IconPlan },
  { label: "Code · Skills", Icon: IconSkills },
  { label: "Code · Software", Icon: IconScan },
  { label: "Refactor · Correção", Icon: IconRefactor },
];

export default function AppShell({
  children,
  account = "Superadmin",
}: {
  children: React.ReactNode;
  account?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
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
    router.push("/login");
  };

  const isNew = pathname === "/";

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
          <Link className={isNew ? "active" : ""} href="/">
            <IconDashboard /> Nova análise
          </Link>

          <div className="nav-section">Pipeline DevSecOps</div>
          {PIPELINE.map((p, i) => (
            <div className="nav-static" key={p.label}>
              <p.Icon /> {p.label}
              <span className="nav-step-num">{i + 1}</span>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-account">
            <span>StarGuard</span>
            <p>{account} · conta ativa</p>
          </div>
          <div className="sidebar-actions">
            <button
              type="button"
              onClick={() => setThemeState(toggleTheme())}
            >
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
