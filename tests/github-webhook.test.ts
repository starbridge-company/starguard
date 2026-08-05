// ============================================================
// Webhook do GitHub App — AUDITORIA.md#SEC-12.
//
// A rota do webhook é PÚBLICA (o GitHub não faz login) e dispara análise que
// gasta IA e abre Pull Request. A assinatura HMAC é a única coisa entre ela e
// qualquer pessoa da internet — então é o que este arquivo cobre, quase todo
// pelo caminho negativo.
//
// O segundo tema é a deduplicação. O GitHub reenvia quando não recebe 2xx a
// tempo; sem dedupe, uma entrega repetida geraria duas análises do mesmo
// estado — trabalho e dinheiro em dobro.
// ============================================================
import { describe, it, expect } from "vitest";
import { createHmac, createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { verificarAssinatura, appJwt, normalizarChave } from "@/lib/github-app";

const SEGREDO = "segredo-de-teste";

function assinar(corpo: string, secret = SEGREDO): string {
  return "sha256=" + createHmac("sha256", secret).update(corpo, "utf8").digest("hex");
}

describe("assinatura do webhook — a única barreira da rota", () => {
  const corpo = JSON.stringify({ action: "opened", number: 7 });

  it("aceita a assinatura correta", () => {
    expect(verificarAssinatura(corpo, assinar(corpo), SEGREDO)).toBe(true);
  });

  it("RECUSA assinatura ausente", () => {
    expect(verificarAssinatura(corpo, null, SEGREDO)).toBe(false);
    expect(verificarAssinatura(corpo, "", SEGREDO)).toBe(false);
  });

  it("RECUSA assinatura de outro segredo", () => {
    // É o ataque direto: alguém que descobriu a URL do webhook mas não o
    // segredo. Se passasse, dispararia análise em nome de qualquer repositório.
    expect(verificarAssinatura(corpo, assinar(corpo, "outro-segredo"), SEGREDO)).toBe(false);
  });

  it("RECUSA quando o CORPO mudou, ainda que um byte", () => {
    const assinatura = assinar(corpo);
    const adulterado = JSON.stringify({ action: "opened", number: 8 });
    expect(verificarAssinatura(adulterado, assinatura, SEGREDO)).toBe(false);
  });

  it("RECUSA prefixo diferente de sha256=", () => {
    // `sha1=` é o cabeçalho legado do GitHub. Aceitá-lo seria aceitar um
    // algoritmo que já não se considera adequado para autenticar.
    const hex = createHmac("sha256", SEGREDO).update(corpo).digest("hex");
    expect(verificarAssinatura(corpo, `sha1=${hex}`, SEGREDO)).toBe(false);
    expect(verificarAssinatura(corpo, hex, SEGREDO)).toBe(false);
  });

  it("RECUSA assinatura truncada", () => {
    // Comprimento diferente sai antes da comparação — e é por isso que a
    // checagem de tamanho vem primeiro, senão `timingSafeEqual` lançaria.
    const a = assinar(corpo);
    expect(verificarAssinatura(corpo, a.slice(0, -4), SEGREDO)).toBe(false);
  });

  it("é sensível a espaço no corpo — por isso a rota usa o corpo CRU", () => {
    // Reserializar o JSON muda espaços e ordem de chave, e o HMAC deixa de
    // bater. Este teste existe para travar essa exigência: se alguém trocar
    // `req.text()` por `req.json()` na rota, a assinatura para de validar e a
    // causa fica óbvia aqui.
    const compacto = '{"a":1}';
    const espacado = '{ "a": 1 }';
    expect(verificarAssinatura(espacado, assinar(compacto), SEGREDO)).toBe(false);
  });

  it("corpo vazio com assinatura correta é aceito", () => {
    // O evento `ping` do GitHub chega assim. Recusá-lo faria a configuração do
    // webhook parecer quebrada logo no primeiro teste da tela do GitHub.
    expect(verificarAssinatura("", assinar(""), SEGREDO)).toBe(true);
  });
});

describe("normalização da chave privada", () => {
  // Nasceu de um caso REAL: a chave estava no `.env.local` como o miolo do PEM,
  // sem as linhas BEGIN/END. É base64 válido, decodifica para bytes válidos, e
  // mesmo assim o `createSign` recusa com `DECODER routines::unsupported` — um
  // erro que não diz nada sobre cabeçalho faltando.
  //
  // As quatro formas abaixo aparecem na prática, e a falha de todas é idêntica
  // e silenciosa: "o bot nunca responde".
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  /**
   * Consegue assinar? É o único teste que vale — quem decide é o Node.
   *
   * O `catch` distingue "o OpenSSL recusou a chave" (o que se quer medir) de
   * qualquer outro erro, que é relançado. Um `catch` vazio aqui já escondeu um
   * `ReferenceError` de import faltando e fez os cinco testes falharem por um
   * motivo sem relação nenhuma com o que estava sob teste.
   */
  const assina = (pem: string | null) => {
    if (!pem) return false;
    try {
      createSign("RSA-SHA256").update("x").sign(pem);
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      if (/DECODER|unsupported|PEM|asn1|no start line/i.test(msg)) return false;
      throw e;
    }
  };

  it("1. PEM completo, com quebras reais", () => {
    expect(assina(normalizarChave(privateKey))).toBe(true);
  });

  it("2. PEM com `\\n` LITERAIS (painel que não aceita multi-linha)", () => {
    const escapado = privateKey.replace(/\n/g, "\\n");
    expect(assina(normalizarChave(escapado))).toBe(true);
  });

  it("3. PEM inteiro em base64, numa linha só", () => {
    const b64 = Buffer.from(privateKey).toString("base64");
    expect(assina(normalizarChave(b64))).toBe(true);
  });

  it("4. SÓ o miolo, sem BEGIN/END — o caso que quebrou de verdade", () => {
    const miolo = privateKey
      .replace(/-----[A-Z ]+-----/g, "")
      .replace(/\s+/g, "");
    expect(assina(normalizarChave(miolo))).toBe(true);
  });

  it("PKCS#8 sem cabeçalho também funciona", () => {
    // Pelo texto do base64 não dá para distinguir PKCS#1 de PKCS#8, e é por
    // isso que a implementação monta os dois rótulos e deixa o Node decidir em
    // vez de adivinhar por prefixo.
    //
    // Descoberto ao escrever este teste: o OpenSSL **não se importa com o
    // rótulo** — ele detecta o formato pelo DER e aceita um corpo PKCS#8 sob
    // `BEGIN RSA PRIVATE KEY`. Ou seja, o primeiro rótulo tentado quase sempre
    // vence. Isso não invalida o laço (uma chave que o primeiro recusasse ainda
    // teria a segunda chance), mas invalida asserir QUAL rótulo saiu: o que
    // importa, e o que se verifica, é que a chave ASSINA.
    const { privateKey: pkcs8 } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const miolo = pkcs8.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    expect(assina(normalizarChave(miolo))).toBe(true);
  });

  it("RECUSA lixo, em vez de devolver algo que falha depois", () => {
    // Falhar aqui é acionável; falhar no `createSign` lá dentro produz um erro
    // de OpenSSL que ninguém relaciona com a variável de ambiente.
    expect(normalizarChave("")).toBeNull();
    expect(normalizarChave("   ")).toBeNull();
    expect(normalizarChave("C:/caminho/para/chave.pem")).toBeNull();
    expect(normalizarChave("isto não é uma chave")).toBeNull();
  });

  it("RECUSA base64 válido que não é chave", () => {
    expect(normalizarChave(Buffer.from("bom dia").toString("base64"))).toBeNull();
  });
});

describe("JWT do App", () => {
  // A chave é gerada NA HORA, e não colada aqui: um bloco `BEGIN PRIVATE KEY`
  // versionado no repositório dispara varredor de segredo (inclusive o nosso
  // próprio SAST) e ensina o hábito errado a quem copiar o padrão.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const CHAVE = privateKey;

  it("monta três partes e o issuer é o App", () => {
    const jwt = appJwt({ appId: "123456", privateKey: CHAVE, webhookSecret: "x" });
    const partes = jwt.split(".");
    expect(partes).toHaveLength(3);

    const payload = JSON.parse(Buffer.from(partes[1]!, "base64url").toString());
    expect(payload.iss).toBe("123456");
  });

  it("o `iat` é RECUADO — relógio adiantado derrubaria o webhook", () => {
    // O GitHub recusa com "issued at is in the future" se o nosso relógio
    // estiver alguns segundos à frente, e o sintoma seria um webhook que falha
    // sem explicação aparente.
    const jwt = appJwt({ appId: "1", privateKey: CHAVE, webhookSecret: "x" });
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    const agora = Math.floor(Date.now() / 1000);
    expect(payload.iat).toBeLessThan(agora);
  });

  it("vive no máximo 10 minutos — é o teto do GitHub", () => {
    const jwt = appJwt({ appId: "1", privateKey: CHAVE, webhookSecret: "x" });
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(660);
  });

  it("a assinatura é verificável com a chave pública correspondente", () => {
    // Sem isto, um JWT malformado passaria nos testes de forma e só o GitHub
    // recusaria — em produção, no primeiro webhook.
    const jwt = appJwt({ appId: "1", privateKey: CHAVE, webhookSecret: "x" });
    const [h, p, sig] = jwt.split(".");
    const ok = createVerify("RSA-SHA256")
      .update(`${h}.${p}`)
      .verify(publicKey, Buffer.from(sig!, "base64url"));
    expect(ok).toBe(true);
  });
});
