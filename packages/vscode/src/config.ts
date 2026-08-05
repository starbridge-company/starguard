// ============================================================
// Configuração da extensão, num lugar só.
//
// O servidor está aqui por um motivo prático: ele é **temporário** (hoje um
// Render de avaliação) e vai mudar. Espalhá-lo por `auth.ts`, `extension.ts` e
// o `package.json` significaria trocar em três lugares e descobrir o que
// esqueceu quando o login parasse de voltar — sem mensagem útil.
//
// Trocar de servidor = trocar `SERVIDOR_PADRAO` e o `default` da propriedade
// `starguard.server` no `package.json`. O `npm run icon`… não; o teste
// `config.test.ts` trava os dois em sincronia, para o esquecimento virar
// falha de suíte e não incidente.
// ============================================================
import * as vscode from "vscode";

/**
 * Servidor do StarGuard.
 *
 * ⚠️ TEMPORÁRIO — instância de avaliação no Render. Ao migrar para o domínio
 * definitivo, troque aqui **e** no `package.json` (`starguard.server` →
 * `default`). Quem já instalou continua no antigo até atualizar a extensão, a
 * menos que tenha a configuração preenchida à mão.
 */
export const SERVIDOR_PADRAO = "https://starguard-31l1.onrender.com";

/** Onde quem não tem conta pede acesso. */
export const URL_ACESSO_PADRAO = `${SERVIDOR_PADRAO}/login`;

export function cfg() {
  return vscode.workspace.getConfiguration("starguard");
}

/** URL do servidor, sem barra final — a configuração vence o padrão. */
export function servidor(): string {
  const v = cfg().get<string>("server")?.trim();
  return (v || SERVIDOR_PADRAO).replace(/\/+$/, "");
}

export function urlDeAcesso(): string {
  const v = cfg().get<string>("requestAccessUrl")?.trim();
  return v || URL_ACESSO_PADRAO;
}
