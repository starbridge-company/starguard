import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("fila persistente do painel", () => {
  it("leva o contexto cifrado, restaura no worker e apaga no estado terminal", async () => {
    const jobs = await readFile("lib/jobs.ts", "utf8");
    const handler = await readFile("lib/handlers/analysis.ts", "utf8");
    const queue = await readFile("lib/queue.ts", "utf8");
    expect(jobs).toContain("encryptToken(JSON.stringify(raw))");
    expect(jobs).toContain("abrirTransient(transientCifrado)");
    expect(handler).toContain("job.payload.transient");
    expect(queue).toContain("payload} - 'transient'");
  });

  it("renova tanto o lock da fila quanto o updatedAt da análise", async () => {
    const worker = await readFile("lib/worker.ts", "utf8");
    const jobs = await readFile("lib/jobs.ts", "utf8");
    expect(worker).toContain("renovarLock(job.id, WORKER_ID)");
    expect(jobs).toContain("touchAnalysis(id)");
  });
});
