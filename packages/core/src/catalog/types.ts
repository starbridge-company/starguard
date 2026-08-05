import type { FindingExplain } from "../types";

/** Entrada do catálogo: a explicação sem a marca de origem. */
export type Entry = Omit<FindingExplain, "source">;
