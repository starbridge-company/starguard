"use client";

// Hook do usuário atual (/api/me), com cache de módulo para não refazer o
// fetch a cada navegação entre páginas.
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: "superadmin" | "admin";
}

let cached: Me | null = null;
let inflight: Promise<Me> | null = null;

function loadMe(): Promise<Me> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = apiGet<Me>("/api/me")
      .then((m) => {
        cached = m;
        return m;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function clearMe() {
  cached = null;
}

export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let active = true;
    if (cached) {
      setMe(cached);
      setLoading(false);
      return;
    }
    loadMe()
      .then((m) => {
        if (active) setMe(m);
      })
      .catch(() => {
        if (active) setMe(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { me, loading };
}
