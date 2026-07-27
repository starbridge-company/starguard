// ============================================================
// Aviso de subida: o banco está atrás do código? Ver AUDITORIA.md#ARQ-12.
//
// Aqui só AVISA. Quem realmente recusa subir é `scripts/check-schema.mjs`, no
// `prestart` — script Node puro, fora do empacotador.
//
// O motivo é concreto: `instrumentation.ts` é compilado para os dois runtimes
// (node e edge) e arrasta o que importa junto. Um `process.exit` neste módulo
// fazia o bundler acusar "Node.js API não suportada no Edge Runtime" a cada
// recompilação, mesmo protegido por `if` — a checagem dele é estática. Entre
// esconder a chamada do analisador e movê-la para a camada certa, a segunda é
// a honesta: derrubar processo é trabalho de script de inicialização, não de
// hook de framework.
//
// A rede de proteção em runtime continua: /api/health responde 503 e o login
// devolve 503 com texto acionável em vez de 500 mudo.
// ============================================================
import "server-only";
import { checkSchema, schemaMessage } from "@/lib/schema-check";

export async function verifySchemaOnBoot(): Promise<void> {
  if (process.env.SCHEMA_CHECK === "off") return;
  if (!process.env.DATABASE_URL) return;

  const status = await checkSchema(true);
  if (status.ok) return;

  // Banco INALCANÇÁVEL não é banco atrasado: pode ser oscilação de rede na
  // subida, e alarmar por isso ensina a ignorar o alarme.
  if (status.error) return;

  console.error(
    `\n[starguard] ${schemaMessage(status)}\n` +
      "[starguard] A aplicação subiu, mas o login vai recusar (503) até isso ser resolvido.\n"
  );
}
