import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import { readJsonWithLimit } from "@/lib/http";

function pedido(body: BodyInit, headers?: HeadersInit): NextRequest {
  return new Request("http://localhost/api/scan", {
    method: "POST",
    body,
    headers,
  }) as NextRequest;
}

describe("readJsonWithLimit", () => {
  it("recusa pelo cabeçalho antes de ler o corpo", async () => {
    const req = pedido("{}", { "content-length": "1000" });
    await expect(readJsonWithLimit(req, 10)).resolves.toEqual({
      value: null,
      tooLarge: true,
    });
  });

  it("recusa corpo chunked mesmo sem content-length", async () => {
    const req = pedido('{"]":"' + "x".repeat(100) + '"}');
    const result = await readJsonWithLimit(req, 20);
    expect(result.tooLarge).toBe(true);
    expect(result.value).toBeNull();
  });

  it("parseia JSON válido abaixo do teto", async () => {
    const req = pedido(JSON.stringify({ analyzer: "sast" }));
    await expect(readJsonWithLimit(req, 1024)).resolves.toEqual({
      value: { analyzer: "sast" },
      tooLarge: false,
    });
  });
});
