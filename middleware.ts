// ============================================================
// Middleware (edge) — authn/authz default-deny + rate limit global por IP,
// em TODAS as rotas. Só importa libs edge-safe (jose, config, ratelimit).
// A verificação criptográfica completa também é refeita nas rotas (defesa
// em profundidade), mas nada passa daqui sem sessão válida.
// ============================================================
import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { API_RATE, COOKIE, ROLES } from "@/lib/config";
import { credencialDoPedido, decidirAcesso } from "@/lib/auth-edge";

// Rotas públicas (não exigem sessão).
//
// `/api/oauth/token` é pública por DEFINIÇÃO: é onde um cliente que ainda não
// tem credencial vem buscar a primeira. Ela se defende sozinha — cota própria,
// mais apertada que a global, e PKCE. Ver `app/api/oauth/token/route.ts`.
//
// `/oauth/authorize` (a PÁGINA) também entra, mas por outro motivo: ela precisa
// ser alcançável para poder redirecionar quem não tem sessão até o login. O
// POST que de fato emite o código (`/api/oauth/authorize`) NÃO está aqui —
// aquele exige sessão e CSRF.
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/health",
  "/oauth/authorize",
  "/api/oauth/token",
]);

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

// Rotas fora do balde global por IP:
//  - /api/auth/login  -> cobrado na própria rota, só quando a tentativa falha.
//  - /api/status/*    -> polling da tela de resultados (já com backoff no
//                        cliente); o custo da UI não pode consumir a cota
//                        anti-abuso e derrubar a própria tela.
//  - /api/oauth/token -> tem cota PRÓPRIA e mais apertada (20/min por
//                        cliente+IP). Deixá-la também no balde global faria a
//                        renovação silenciosa da extensão competir com o
//                        tráfego de navegação e derrubar o editor de quem não
//                        fez nada de errado.
function isRateExempt(path: string): boolean {
  return (
    path === "/api/auth/login" ||
    path === "/api/oauth/token" ||
    path.startsWith("/api/status/")
  );
}

function json(status: number, body: Record<string, unknown>): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api");
  const ip = clientIp(req.headers);

  // ---- Rate limit ----
  // O login NÃO é cobrado aqui: só a rota conhece o e-mail e sabe se a
  // tentativa falhou. Cobrar nos dois lugares gastava a cota em dobro e
  // trancava quem só estava entrando de novo (com a sessão expirando em 15min,
  // uma manhã de trabalho estourava o limite). Ver AUDITORIA.md#BUG-02.
  // O polling da tela de resultados também fica de fora: é a própria interface
  // conversando com o servidor, não abuso — ver AUDITORIA.md#BUG-03.
  if (isApi && !isRateExempt(pathname)) {
    const rl = await rateLimit(`api:${ip}`, API_RATE);
    if (!rl.allowed) {
      const res = json(429, {
        error: "Muitas requisições. Tente novamente em instantes.",
        errorKey: "err.tooManyRequests",
      });
      res.headers.set("Retry-After", String(Math.ceil(rl.resetMs / 1000)));
      return res;
    }
  }

  // ---- Sessão ----
  //
  // Cookie E Bearer. O segundo demorou a existir aqui, e a ausência dele foi
  // um bug caro: a extensão e o CLI levavam 401 na borda, sem nunca chegar à
  // rota que já sabia tratá-los. Ver `lib/auth-edge.ts`.
  //
  // O público do token é o que separa as duas credenciais: cookie de
  // navegador é `web`, token de cliente é `client`. Um não vale pelo outro,
  // então um cookie roubado não serve à API de ferramenta e vice-versa.
  const credencial = credencialDoPedido(
    req.headers.get("authorization"),
    req.cookies.get(COOKIE.access)?.value
  );
  const claims = credencial
    ? await verifyToken(credencial.token, credencial.origem === "bearer" ? "client" : "web")
    : null;

  // Usuário logado tentando abrir /login -> manda pra home. Só faz sentido
  // para navegação: quem chega com Bearer não está numa aba de navegador.
  if (
    credencial?.origem === "cookie" &&
    claims?.type === "access" &&
    !!claims.role &&
    pathname === "/login"
  ) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const areaAdmin =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin");

  const veredito = decidirAcesso({
    origem: credencial?.origem ?? null,
    claims,
    areaAdmin,
    papelDeAdmin: ROLES.superadmin,
  });

  if (veredito.acao === "recusar") {
    if (veredito.motivo === "sem_credencial") {
      if (isApi) {
        return json(401, {
          error: "Não autenticado.",
          errorKey: "err.unauthenticated",
        });
      }
      const url = new URL("/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    // Proibido. Quem chegou com Bearer recebe JSON mesmo fora de `/api`:
    // redirecionar uma ferramenta para uma página de login devolve HTML que
    // ela não sabe ler, e o erro vira "resposta inesperada".
    if (isApi || credencial?.origem === "bearer") {
      return json(403, { error: "Acesso restrito.", errorKey: "err.forbidden" });
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  const res = NextResponse.next();
  if (veredito.sub) res.headers.set("x-sg-user", veredito.sub);
  return res;
}

export const config = {
  // Roda em tudo, exceto assets estáticos do Next e arquivos públicos comuns.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|starbridge-transparent.png|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map)$).*)",
  ],
};
