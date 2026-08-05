// ============================================================
// Validação de entrada (Zod) para TODAS as rotas + guardas anti-SSRF.
// Regra: nenhuma rota confia em body/query/params sem passar por aqui.
// ============================================================
import { z } from "zod";
import { LOCALES } from "@/lib/i18n/config";
// A allowlist e o parser de URL de repositório passaram para o núcleo: quem
// clona é o núcleo, e o terminal e o VS Code precisam da MESMA regra sem
// carregar o Zod junto. Reexportados aqui porque `@/lib/validation` é o
// endereço que a tela já usa (`RepoInput`, `app/page.tsx`, `BatchFixModal`).
import { parseGitHubRepo, type GitHubRepoRef } from "@starguard/core/repo-url";
import { ANALYZER_IDS, type AnalyzerId } from "@/types";

export { parseGitHubRepo };
export type { GitHubRepoRef };

// E-mail e URL validados por refine (independente de versão do zod).
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const emailField = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .refine((v) => emailRe.test(v), "email inválido");

export const githubUrlField = z
  .string()
  .trim()
  .max(300)
  .refine((v) => parseGitHubRepo(v) !== null, "URL de repositório GitHub inválida");

// UUID v4/v5 (independente da versão do zod).
const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuidField = z
  .string()
  .trim()
  .refine((v) => uuidRe.test(v), "id inválido");

// ---- Schemas por rota ----
export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
});

export const skillItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(200_000),
});

/**
 * Análise — as exigências dependem do que foi PEDIDO.
 *
 * Antes, `systemDescription` era obrigatória sempre, porque a modelagem de
 * ameaças era a fase 1 e rodava em toda análise. Com os analisadores
 * independentes isso vira uma pergunta sem sentido: quem quer validar uma
 * skill não deveria ter de descrever o sistema inteiro para poder fazê-lo.
 *
 * A regra passou a ser condicional, e por `superRefine` (não por campos
 * opcionais soltos) para que o erro aponte o CAMPO certo — a tela destaca o
 * que falta em vez de mostrar "requisição inválida".
 *
 * `select` vem de `ANALYZER_IDS`: acrescentar um analisador não pode depender
 * de alguém lembrar de repetir a lista aqui, ou o seletor ofereceria uma opção
 * que a rota recusa.
 */
export const analyzeSchema = z
  .object({
    projectName: z.string().trim().min(1).max(200),
    // Continua exigida quando `threat` ou `business` estão no pedido — ver o
    // `superRefine` abaixo. Vazia é aceita no schema para o erro sair de lá,
    // com o motivo, e não de um `min(1)` genérico.
    systemDescription: z.string().trim().max(50_000).default(""),
    repoUrl: z.union([githubUrlField, z.literal("")]).optional(),
    token: z.string().max(500).optional(),
    // Usar um token salvo na conta (id) em vez de digitar um novo.
    tokenId: uuidField.optional(),
    // Ao digitar um token novo: salvá-lo na conta (cifrado) com este nome.
    saveToken: z.boolean().optional(),
    tokenName: z.string().trim().max(100).optional(),
    skills: z.array(skillItemSchema).max(20).optional(),
    // Vazio ou ausente = todos (é o comportamento de sempre, e o que as
    // análises antigas fizeram).
    select: z.array(z.enum(ANALYZER_IDS)).optional(),
  })
  .superRefine((d, ctx) => {
    // Pedir explicitamente uma lista vazia é diferente de não pedir nada: o
    // primeiro é engano de quem chama, e rodar "todos" no lugar seria fazer
    // algo que ninguém autorizou (e que custa IA).
    if (d.select && d.select.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["select"],
        message: "Escolha ao menos um analisador.",
      });
      return;
    }

    // SEM seleção explícita = "rode o que der com o que eu forneci". É o que
    // toda análise fez até aqui: sem repositório, o scan devolvia um resultado
    // vazio com a nota "nenhum repositório informado", e isso é um resultado
    // legítimo. Exigir repositório aqui quebraria quem só quer a modelagem de
    // ameaças. O que o orquestrador faz com o que não pode rodar já está
    // resolvido: pula, COM motivo.
    //
    // O único piso é haver alguma coisa a analisar — senão a análise nasce
    // sabendo que não vai produzir nada.
    if (!d.select?.length) {
      if (!d.systemDescription.trim() && !d.repoUrl?.trim() && !d.skills?.length) {
        ctx.addIssue({
          code: "custom",
          path: ["systemDescription"],
          message:
            "Informe ao menos uma entrada: a descrição do sistema, um repositório ou uma skill.",
        });
      }
      return;
    }

    // COM seleção explícita, a exigência é firme: nomear `sast` sem informar
    // repositório é uma contradição, e aceitá-la só adiaria a descoberta para
    // o relatório vazio.
    const pedidos = new Set<AnalyzerId>(d.select);

    if (
      (pedidos.has("threat") || pedidos.has("business")) &&
      !d.systemDescription.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["systemDescription"],
        message:
          "Descreva o sistema: a modelagem de ameaças e a revisão de regras de negócio partem dela.",
      });
    }

    const precisaRepo = ["sast", "sca", "business"] as const;
    if (precisaRepo.some((id) => pedidos.has(id)) && !d.repoUrl?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["repoUrl"],
        message: "Informe o repositório: os analisadores escolhidos leem código.",
      });
    }

    if (pedidos.has("skills") && !d.skills?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["skills"],
        message: "Envie ao menos uma skill para validar.",
      });
    }
  });

// ---- OAuth de cliente público ----
//
// O `code_challenge` é base64url de um SHA-256: 43 caracteres, sempre. Aceitar
// qualquer tamanho deixaria passar um desafio construído à mão que não é hash
// de nada — e a comparação depois falharia num lugar mais fundo, com mensagem
// pior.
export const oauthAuthorizeSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  redirectUri: z.string().trim().min(1).max(500),
  codeChallenge: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9\-_]{43}$/, "code_challenge inválido (base64url de SHA-256)"),
  codeChallengeMethod: z.string().trim().max(16),
  // Opaco para o servidor: quem sorteia e quem confere é o cliente. Aqui só se
  // limita o tamanho, para não virar veículo de dado grande.
  state: z.string().trim().max(256).optional(),
});

/**
 * Proxy de IA (`/api/ai/complete`).
 *
 * Os limites de TAMANHO não são formalidade: esta rota chama um modelo com a
 * chave da Starbridge e cobra da conta. Um prompt de vários megabytes é engano
 * ou abuso, e nos dois casos custa caro — barrar na entrada é mais barato que
 * descobrir na fatura.
 *
 * `provider` e `model` vêm do CLIENTE porque é ele que sabe qual analisador
 * está rodando. Por isso são allowlist, não texto livre: sem ela, alguém
 * pediria um modelo caro que nunca autorizamos.
 */
export const aiCompleteSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  model: z.string().trim().min(1).max(100),
  system: z.string().max(100_000),
  prompt: z.string().min(1).max(400_000),
  // Teto duro do orçamento de saída. O cliente pede, o servidor limita.
  maxTokens: z.number().int().min(1).max(64_000),
  /** Só para atribuir o gasto na trilha: "threat", "business", "refactor"… */
  purpose: z.string().trim().max(40).optional(),
  /** Nome do repositório, quando a chamada nasceu de uma análise. */
  repo: z.string().trim().max(200).optional(),
});

// Cadastro de token do GitHub na conta.
export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  token: z.string().trim().min(8).max(500),
});

// Criação de usuário (somente superadmin). Papel escolhido no ato.
export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailField,
  password: z.string().min(8).max(200),
  role: z.enum(["superadmin", "admin"]),
});

// Alteração de papel de um usuário (somente superadmin).
export const roleUpdateSchema = z.object({
  role: z.enum(["superadmin", "admin"]),
});

// Atualização do próprio perfil (nome, login/e-mail, senha). Alterar e-mail ou
// senha exige a senha atual (verificada na rota).
export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: emailField.optional(),
    currentPassword: z.string().max(200).optional(),
    newPassword: z.string().min(8).max(200).optional(),
    // Vem de LOCALES: um idioma novo não pode depender de alguém lembrar de
    // repetir a lista aqui — o formulário aceitaria e a rota recusaria.
    locale: z.enum(LOCALES).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.email !== undefined ||
      d.newPassword !== undefined ||
      d.locale !== undefined,
    "nada para atualizar"
  );

export const step1Schema = z.object({
  systemDescription: z.string().trim().min(1).max(50_000),
});

export const step2Schema = z.object({
  skills: z.array(skillItemSchema).min(1).max(20),
});

export const step3Schema = z.object({
  repoUrl: githubUrlField,
  token: z.string().max(500).optional(),
  // Contexto para a revisão por IA (regra de negócio); ambos opcionais.
  systemDescription: z.string().trim().max(50_000).optional(),
  requirements: z.array(z.string()).max(200).optional(),
});

/**
 * Tamanho máximo do conteúdo de UM arquivo trafegado por aqui.
 *
 * Estava em 50 000 caracteres — cerca de 1 300 linhas de código denso, ou
 * seja, arquivo grande comum. O efeito era o pior possível: a correção era
 * gerada (gastando IA e minutos) e só então o PR era recusado, jogando fora
 * trabalho já pago. O limite não protegia nada nosso; só quebrava o fluxo no
 * último passo.
 *
 * 1 MB é o teto prático da API de conteúdo do GitHub — acima disso o caminho
 * correto seria a Git Data API (blobs), que este produto ainda não usa. Como
 * limite, é o do serviço, não um número inventado.
 */
export const MAX_FILE_CHARS = 1_000_000;

/**
 * Teto do somatório num PR em lote. Existe para a requisição não virar dezenas
 * de MB — o `files.max(50)` sozinho permitiria 50 MB.
 */
export const MAX_PR_TOTAL_CHARS = 8_000_000;

/**
 * Limites do PR no GitHub — os REAIS, não números escolhidos por nós.
 *
 * Título e corpo do PR são texto que NÓS montamos (explicação da IA + lista de
 * arquivos + avisos). Recusar a própria saída no último passo, depois de a
 * correção estar gerada e paga, é desperdício puro. Por isso existem duas
 * camadas: `clampPrBody`/`clampPrTitle` cortam na origem, e o schema fica com
 * o limite do serviço — que só é atingido se algo escapar do corte.
 */
export const MAX_PR_TITLE = 256;
export const MAX_PR_BODY = 65_536;

/** Corta preservando o começo, que é o que tem significado. */
function clamp(s: string, max: number, marca: string): string {
  if (s.length <= max) return s;
  return s.slice(0, max - marca.length) + marca;
}

export function clampPrTitle(s: string): string {
  return clamp(s.replace(/\s+/g, " ").trim(), MAX_PR_TITLE, "…");
}

export function clampPrBody(s: string): string {
  return clamp(s, MAX_PR_BODY, "\n\n_(texto truncado pelo StarGuard)_");
}

/**
 * Tetos dos campos de texto da correção — e o corte correspondente.
 *
 * O que chega aqui vem de scanner e de modelo: mensagem do Opengrep, trecho de
 * código, sugestão gerada. Nenhum deles tem tamanho garantido, e um texto fora
 * do comum não pode DERRUBAR a geração — foi assim que `alsoFix ≤ 20`,
 * `fixedCode ≤ 50k` e `body ≤ 20k` viraram, cada um na sua vez, um fluxo
 * quebrado no último passo.
 *
 * A regra que ficou: quem monta a requisição corta antes de enviar; o schema
 * mantém o mesmo número como rede, não como porteiro.
 */
export const FIX_LIMITS = {
  description: 5_000,
  suggestion: 5_000,
  originalCode: 50_000,
  userInstructions: 4_000,
} as const;

export function clampFix(
  field: keyof typeof FIX_LIMITS,
  s: string | undefined
): string | undefined {
  if (s === undefined) return undefined;
  return clamp(s, FIX_LIMITS[field], "…");
}

/**
 * Quantos achados do MESMO arquivo cabem numa passada de correção.
 *
 * O teto não é burocracia: pedir 80 correções num prompt só degrada a resposta
 * e estoura o orçamento de tokens. Mas ele também não pode DERRUBAR a
 * geração — era o que acontecia, com um `Too big: expected array to have <=20
 * items` em todo arquivo com 21+ achados, que é o caso comum (um scan real
 * deste repositório concentrou 576 achados em poucos arquivos).
 *
 * A saída é fatiar: o cliente quebra o arquivo em blocos deste tamanho e
 * encadeia, passando o resultado de um como `baseCode` do próximo. Nada é
 * descartado — descartar em silêncio é justamente o defeito que o agrupamento
 * por arquivo veio corrigir (AUDITORIA.md#BUG-06).
 *
 * O NÚMERO importa para a velocidade, e a intuição engana aqui: o caro de uma
 * correção não é listar os problemas na entrada (isso são poucas linhas por
 * achado), é a SAÍDA — o modelo reemite o arquivo inteiro. Esse custo é por
 * CHAMADA, não por achado. Fatia pequena multiplica reescritas do mesmo
 * arquivo: com 21, um arquivo de 80 achados custava 4 reescritas completas e
 * quatro vezes o tempo. Com 60, cabe em uma.
 *
 * Exportado para o cliente fatiar com o MESMO número: se as duas pontas
 * divergirem, o erro volta.
 */
export const FIX_CHUNK_SIZE = 60;

export const step4Schema = z.object({
  vulnerabilityId: z.string().min(1).max(120),
  file: z.string().min(1).max(500),
  originalCode: z.string().min(1).max(50_000),
  description: z.string().min(1).max(5_000),
  suggestion: z.string().max(5_000).optional(),
  language: z.string().max(40).optional(),
  // Contexto do erro + arquivo inteiro + prompt personalizado (Fase 4 real).
  line: z.number().int().min(0).max(10_000_000).optional(),
  endLine: z.number().int().min(0).max(10_000_000).optional(),
  // Regras do Opengrep costumam mandar o TÍTULO completo do CWE/OWASP, não só o id.
  cwe: z.string().max(300).optional(),
  owasp: z.string().max(300).optional(),
  ruleId: z.string().max(300).optional(),
  repoUrl: z.union([githubUrlField, z.literal("")]).optional(),
  userInstructions: z.string().max(4_000).optional(),
  // Achado persistido: habilita reaproveitar a correção já gerada em vez de
  // queimar IA de novo. Ver AUDITORIA.md#FEAT-02.
  findingId: uuidField.optional(),
  // Alternativa ao findingId: com a análise, o servidor acha o achado pelo id
  // local ("V-3") e o cache do FEAT-02 funciona mesmo que a tela ainda não
  // tenha carregado o mapa de ids.
  analysisId: uuidField.optional(),
  // "Refazer": ignora o cache e gera de novo (guardando a anterior).
  force: z.boolean().optional(),
  /**
   * Ponto de partida do arquivo quando esta chamada é a continuação de outra
   * (arquivo com mais achados do que cabe numa passada só). Ver
   * `FIX_CHUNK_SIZE` abaixo.
   */
  baseCode: z.string().max(MAX_FILE_CHARS).optional(),
  // Demais achados do MESMO arquivo, corrigidos na mesma passada — evita que
  // uma correção sobrescreva a outra no PR. Ver AUDITORIA.md#BUG-06.
  alsoFix: z
    .array(
      z.object({
        vulnerabilityId: z.string().min(1).max(120),
        description: z.string().min(1).max(5_000),
        suggestion: z.string().max(5_000).optional(),
        line: z.number().int().min(0).max(10_000_000).optional(),
        endLine: z.number().int().min(0).max(10_000_000).optional(),
        cwe: z.string().max(300).optional(),
        owasp: z.string().max(300).optional(),
        ruleId: z.string().max(300).optional(),
      })
    )
    .max(FIX_CHUNK_SIZE - 1)
    .optional(),
});

// Estado de um achado (marcar como corrigido / falso positivo / etc.).
export const findingStatusSchema = z.object({
  status: z.enum([
    "open",
    "fixed",
    "pr_open",
    "pr_merged",
    "false_positive",
    "accepted_risk",
  ]),
  note: z.string().trim().max(1_000).optional(),
});

export const cloneSchema = z.object({
  repoUrl: githubUrlField,
  token: z.string().max(500).optional(),
});

export const prSchema = z.object({
  repoUrl: githubUrlField,
  file: z.string().min(1).max(500),
  fixedCode: z
    .string()
    .min(1)
    .max(
      MAX_FILE_CHARS,
      `Arquivo acima de ${MAX_FILE_CHARS / 1_000_000} MB — acima do que a API de conteúdo do GitHub aceita neste fluxo.`
    ),
  title: z.string().min(1).max(MAX_PR_TITLE),
  body: z.string().max(MAX_PR_BODY).optional(),
  token: z.string().max(500).optional(),
  tokenId: uuidField.optional(),
  analysisId: uuidField.optional(),
});

// PR consolidado: várias correções commitadas numa única branch/PR.
export const prBatchSchema = z
  .object({
    repoUrl: githubUrlField,
    files: z
      .array(
        z.object({
          file: z.string().min(1).max(500),
          fixedCode: z
            .string()
            .min(1)
            .max(
              MAX_FILE_CHARS,
              `Arquivo acima de ${MAX_FILE_CHARS / 1_000_000} MB — acima do que a API de conteúdo do GitHub aceita neste fluxo.`
            ),
        })
      )
      .min(1)
      .max(50),
    title: z.string().min(1).max(MAX_PR_TITLE),
    body: z.string().max(MAX_PR_BODY).optional(),
    token: z.string().max(500).optional(),
    tokenId: uuidField.optional(),
    analysisId: uuidField.optional(),
  })
  .superRefine((v, ctx) => {
    const total = v.files.reduce((n, f) => n + f.fixedCode.length, 0);
    if (total > MAX_PR_TOTAL_CHARS) {
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: `O conjunto de arquivos soma ${Math.round(total / 1_000_000)} MB e excede o limite de ${MAX_PR_TOTAL_CHARS / 1_000_000} MB por PR. Abra o PR em partes, selecionando menos arquivos.`,
      });
    }
  });

// ---- Helper ----
export type Validated<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export function validate<T>(
  schema: z.ZodType<T>,
  data: unknown
): Validated<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, data: parsed.data };
  const first = parsed.error.issues[0];
  return {
    ok: false,
    message: first ? `${first.path.join(".")}: ${first.message}` : "entrada inválida",
  };
}
