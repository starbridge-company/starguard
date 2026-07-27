// ============================================================
// Roda uma vez, na subida do servidor (convenção do Next).
//
// Este arquivo é compilado para os DOIS runtimes (node e edge), então ele não
// pode CONTER API de Node — nem protegida por `if`, porque a checagem do
// empacotador é estática. Por isso aqui só existe o desvio; o trabalho está em
// `lib/boot-check.ts`, carregado sob demanda.
// ============================================================

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { verifySchemaOnBoot } = await import("@/lib/boot-check");
  await verifySchemaOnBoot();
}
