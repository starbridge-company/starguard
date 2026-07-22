/** @type {import('next').NextConfig} */

// Security headers aplicados a TODAS as respostas. O CSP dinâmico (com nonce por
// request) fica no middleware; aqui ficam os cabeçalhos estáticos e um CSP base.
// Em dev, o Next precisa de 'unsafe-eval'/'unsafe-inline' para HMR e do
// framework runtime — por isso o CSP é afrouxado quando NODE_ENV !== production.
const isProd = process.env.NODE_ENV === "production";

const scriptSrc = isProd
  ? "'self' 'unsafe-inline'"
  : "'self' 'unsafe-inline' 'unsafe-eval'";

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  isProd ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // O Claude Agent SDK traz um binário nativo e faz spawn de subprocesso —
  // deixa fora do bundle do servidor (require direto do node_modules).
  // `pg` tem binding nativo opcional (pg-native) — também fica externo.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "pg"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
