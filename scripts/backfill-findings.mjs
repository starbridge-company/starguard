#!/usr/bin/env node
// ============================================================
// Backfill de achados para análises anteriores à tabela `findings`.
//
// Antes do FEAT-01, os achados só existiam dentro do JSONB `analyses.phases`.
// Análises antigas continuam funcionando, mas sem os controles de estado
// ("já corrigi", "falso positivo") — este script cria as linhas que faltam.
// Ver AUDITORIA.md#PEND-11.
//
// Idempotente: quem já tem achados é pulado, e a inserção usa
// ON CONFLICT DO NOTHING por (analysis_id, local_id).
//
//   node scripts/backfill-findings.mjs           # aplica
//   node scripts/backfill-findings.mjs --dry-run # só mostra o que faria
// ============================================================
import "./load-env.mjs";
import { createHash } from "node:crypto";
import pg from "pg";

const DRY = process.argv.includes("--dry-run");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[backfill] DATABASE_URL ausente.");
  process.exit(1);
}

// Mesma lógica de lib/fingerprint.ts — reimplementada aqui porque este script
// roda fora do bundler (sem alias "@/"). Qualquer mudança lá precisa vir junto.
const normPath = (p) => (p || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
const normSnippet = (s) =>
  !s
    ? ""
    : s
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .slice(0, 2000);
const hash = (parts) =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);

const vulnFp = (v) =>
  hash([v.source, v.ruleId || "", normPath(v.file), normSnippet(v.codeSnippet) || normSnippet(v.title)]);
const depFp = (d) =>
  hash(["sca", (d.package || "").toLowerCase(), (d.cve || "").toUpperCase()]);

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const { rows: analises } = await client.query(`
    select a.id, a.user_id, a.repo_url, a.phases
    from starguard.analyses a
    where a.deleted_at is null
      and a.phases is not null
      and not exists (select 1 from starguard.findings f where f.analysis_id = a.id)
    order by a.created_at
  `);

  console.log(`[backfill] ${analises.length} análise(s) sem achados persistidos.`);
  let totalAchados = 0;
  let comAchados = 0;

  for (const a of analises) {
    const scan = a.phases?.software?.result;
    if (!scan) continue;

    const itens = [
      ...(scan.sast?.vulnerabilities || []).map((v) => ({ f: v, fp: vulnFp(v) })),
      ...(scan.review?.findings || []).map((v) => ({ f: v, fp: vulnFp(v) })),
      ...(scan.sca?.dependencies || []).map((d) => ({ f: d, fp: depFp(d) })),
    ];
    if (!itens.length) continue;

    comAchados++;
    totalAchados += itens.length;
    if (DRY) {
      console.log(`  ${a.id}: ${itens.length} achado(s)`);
      continue;
    }

    for (const { f, fp } of itens) {
      const isDep = f.source === "sca";
      await client.query(
        `insert into starguard.findings
           (analysis_id, user_id, local_id, fingerprint, repo_url, source,
            rule_id, severity, file, line, title, payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (analysis_id, local_id) do nothing`,
        [
          a.id,
          a.user_id,
          f.id,
          fp,
          a.repo_url,
          f.source,
          isDep ? f.cve : f.ruleId || "",
          f.severity,
          isDep ? null : f.file,
          isDep ? null : f.line,
          f.title,
          JSON.stringify(f),
        ]
      );
    }
  }

  console.log(
    `[backfill] ${DRY ? "(simulação) " : ""}${totalAchados} achado(s) em ${comAchados} análise(s).`
  );
  if (DRY) console.log("[backfill] rode sem --dry-run para aplicar.");
} catch (e) {
  console.error("[backfill] falhou:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
