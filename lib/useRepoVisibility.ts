"use client";

// ============================================================
// O repositório da análise é privado?
//
// A tela precisa saber ANTES de o usuário clicar em "Abrir PR": privado exige
// token dele, público usa o do servidor. Sem essa resposta antecipada, o
// caminho era tentar, falhar, e só então pedir a credencial — uma ida perdida
// ao servidor que ainda deixava um spinner e um erro no meio do caminho.
// ============================================================
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";

// A visibilidade não muda no meio de uma sessão e a mesma análise é reaberta
// várias vezes; um cache de módulo evita repetir a consulta a cada modal.
const cache = new Map<string, boolean>();

export function useRepoVisibility(repoUrl?: string | null): {
  isPrivate: boolean | null;
} {
  // O valor em cache é LIDO no render, não copiado para o estado por um
  // efeito: copiar exigiria um setState síncrono dentro do efeito, que é
  // render em cascata sem ganho nenhum. O estado guarda só o que veio da rede.
  const emCache = repoUrl ? cache.get(repoUrl) : undefined;
  const [buscado, setBuscado] = useState<boolean | null>(null);
  const isPrivate = emCache ?? buscado;

  useEffect(() => {
    if (!repoUrl || cache.has(repoUrl)) return;
    let ativo = true;
    apiGet<{ private: boolean }>(
      `/api/github/repo-visibility?repoUrl=${encodeURIComponent(repoUrl)}`
    )
      .then((r) => {
        cache.set(repoUrl, r.private);
        if (ativo) setBuscado(r.private);
      })
      // Falha aqui não pode travar nada: `null` significa "não sei", e o fluxo
      // volta a descobrir pela tentativa, como antes.
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [repoUrl]);

  return { isPrivate };
}
