// ============================================================
// Middleware (edge) — authn/authz default-deny + rate limit global por IP,
// em TODAS as rotas. Só importa libs edge-safe (jose, config, ratelimit).
// A verificação criptográfica completa também é refeita nas rotas (defesa
// em profundidade), mas nada passa daqui sem sessão válida.
// ============================================================
import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { API_RATE, LOGIN_RATE, COOKIE } from "@/lib/config";

// Rotas públicas (não exigem sessão).
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/health",
]);

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

function json(status: number, body: unknown): NextResponse {
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
  if (isApi) {
    const spec = pathname === "/api/auth/login" ? LOGIN_RATE : API_RATE;
    const keyPrefix = pathname === "/api/auth/login" ? "login" : "api";
    const rl = rateLimit(`${keyPrefix}:${ip}`, spec);
    if (!rl.allowed) {
      const res = json(429, {
        error: "Muitas requisições. Tente novamente em instantes.",
      });
      res.headers.set("Retry-After", String(Math.ceil(rl.resetMs / 1000)));
      return res;
    }
  }

  // ---- Sessão ----
  const token = req.cookies.get(COOKIE.access)?.value;
  const claims = token ? await verifyToken(token) : null;
  const authed = !!claims && claims.type === "access" && !!claims.role;

  // Usuário logado tentando abrir /login -> manda pra home.
  if (authed && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Default-deny.
  if (!authed) {
    if (isApi) {
      return json(401, { error: "Não autenticado." });
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // RBAC mínimo (papel Superadmin no MVP).
  const res = NextResponse.next();
  res.headers.set("x-sg-user", claims!.sub);
  return res;
}

export const config = {
  // Roda em tudo, exceto assets estáticos do Next e arquivos públicos comuns.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|starbridge-transparent.png|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map)$).*)",
  ],
};
