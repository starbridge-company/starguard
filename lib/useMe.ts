"use client";

// Hook do usuário atual (/api/me), com cache de módulo para não refazer o
// fetch a cada navegação entre páginas.
//
// O cache tinha validade infinita: se um superadmin trocasse o papel de alguém,
// a interface daquela pessoa continuava mostrando o papel antigo até um reload
// completo da página. Agora ele revalida ao voltar o foco para a aba (que é
// exatamente quando o usuário vai olhar para a tela de novo) e envelhece por
// tempo. Ver AUDITORIA.md#BUG-19.
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: "superadmin" | "admin";
  locale?: string | null;
}

/** Depois disto, o próximo foco na aba revalida. */
const MAX_AGE_MS = 60_000;

let cached: Me | null = null;
let cachedAt = 0;
let inflight: Promise<Me> | null = null;

// Todos os `useMe()` montados: uma revalidação atualiza a tela inteira, não só
// o componente que disparou o fetch.
const subscribers = new Set<(m: Me | null) => void>();

function publish(m: Me | null): void {
  cached = m;
  cachedAt = m ? Date.now() : 0;
  for (const fn of subscribers) fn(m);
}

function fetchMe(): Promise<Me> {
  if (!inflight) {
    inflight = apiGet<Me>("/api/me")
      .then((m) => {
        publish(m);
        return m;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function loadMe(): Promise<Me> {
  if (cached) return Promise.resolve(cached);
  return fetchMe();
}

function isStale(): boolean {
  return !cached || Date.now() - cachedAt > MAX_AGE_MS;
}

export function clearMe() {
  cached = null;
  cachedAt = 0;
}

/** Refaz a busca agora e avisa todas as telas montadas. */
export function refreshMe(): Promise<Me | null> {
  return fetchMe().catch(() => {
    publish(null);
    return null;
  });
}

export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let active = true;
    const onChange = (m: Me | null) => {
      if (active) setMe(m);
    };
    subscribers.add(onChange);

    // O estado já nasce com o cache (useState(cached)); reatribuí-lo aqui era
    // render em cascata sem ganho — e o que o react-hooks apontava.
    // Ver AUDITORIA.md#PEND-20.
    if (!cached) {
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
    }

    // Voltar para a aba é o momento em que uma mudança feita por outra pessoa
    // (promoção, rebaixamento, troca de nome) precisa aparecer.
    const revalidate = () => {
      if (document.visibilityState !== "visible") return;
      if (!isStale()) return;
      void refreshMe();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);

    return () => {
      active = false;
      subscribers.delete(onChange);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, []);

  return { me, loading };
}
