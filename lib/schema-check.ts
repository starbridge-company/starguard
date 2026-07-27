// ============================================================
// O schema do banco está em dia com o código? Ver AUDITORIA.md#ARQ-12.
//
// Um banco atrás do código é o estado NORMAL logo depois de um deploy — e o
// modo de falha era o pior possível: o seed de `lib/auth.ts` monta o INSERT a
// partir do schema Drizzle, uma coluna faltando derruba a query, e o login
// respondia 500 para qualquer senha. Nada na aplicação dizia que o conserto
// era `npm run db:migrate`.
//
// A comparação é entre o jornal de migrações versionado no repositório e a
// tabela de controle que o migrator mantém no banco. NODE-ONLY.
// ============================================================
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import journal from "@/db/migrations/meta/_journal.json";

export interface SchemaStatus {
  ok: boolean;
  /** Quantas migrações o repositório tem. */
  expected: number;
  /** Quantas o banco registra como aplicadas. */
  applied: number;
  /** Tags das que faltam, na ordem. */
  pending: string[];
  /** Preenchido quando NÃO foi possível checar (banco fora do ar). */
  error?: string;
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const ENTRIES = (journal.entries as JournalEntry[])
  .slice()
  .sort((a, b) => a.idx - b.idx);

export const MIGRATE_HINT = "npm run db:migrate";

/**
 * O migrator do Drizzle grava `created_at` = o `when` do jornal. Casar por
 * esse carimbo é mais fiel que contar linhas: pega o caso de uma migração ter
 * sido aplicada fora de ordem.
 */
async function appliedTimestamps(): Promise<number[]> {
  const rows = await db.execute<{ created_at: string | number }>(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at`
  );
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  return (list as { created_at: string | number }[]).map((r) =>
    Number(r.created_at)
  );
}

// A checagem consulta o banco; a rota /api/health é pública. Sem cache, viraria
// um jeito barato de gerar carga. O TTL é curto de propósito: quem acabou de
// rodar as migrações precisa ver o resultado sem reiniciar o processo.
const TTL_MS = 15_000;
let cache: { at: number; status: SchemaStatus } | null = null;

export async function checkSchema(force = false): Promise<SchemaStatus> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.status;

  let status: SchemaStatus;
  try {
    const applied = new Set(await appliedTimestamps());
    const pending = ENTRIES.filter((e) => !applied.has(e.when)).map((e) => e.tag);
    status = {
      ok: pending.length === 0,
      expected: ENTRIES.length,
      applied: applied.size,
      pending,
    };
  } catch (e) {
    // Banco fora do ar é diferente de banco atrasado: não afirmamos nada sobre
    // o schema, e quem chama não deve derrubar o processo por causa disto.
    status = {
      ok: false,
      expected: ENTRIES.length,
      applied: 0,
      pending: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  cache = { at: Date.now(), status };
  return status;
}

/** Mensagem pronta para log e para a resposta HTTP. */
export function schemaMessage(s: SchemaStatus): string {
  if (s.ok) return "Schema em dia.";
  if (s.error) return `Não foi possível verificar o schema: ${s.error}`;
  return `Banco desatualizado: ${s.pending.length} migração(ões) pendente(s) (${s.pending.join(", ")}). Rode \`${MIGRATE_HINT}\`.`;
}
