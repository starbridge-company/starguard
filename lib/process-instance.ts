import { randomUUID } from "node:crypto";

/**
 * Identidade desta execucao do Node.
 *
 * Os jobs de scan vivem em memoria e, portanto, pertencem a uma execucao
 * especifica. Publicar essa identidade permite distinguir um job removido de
 * um reinicio/OOM ou de uma consulta roteada para outra replica.
 */
const g = globalThis as unknown as {
  __sg_process_instance?: { id: string; startedAt: number };
};

g.__sg_process_instance ||= {
  id: randomUUID(),
  startedAt: Date.now(),
};

export function processInstance() {
  const instance = g.__sg_process_instance!;
  return {
    id: instance.id,
    startedAt: new Date(instance.startedAt).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - instance.startedAt) / 1000)),
  };
}

export function processInstanceId(): string {
  return g.__sg_process_instance!.id;
}
