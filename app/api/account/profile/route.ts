import type { NextRequest } from "next/server";
import {
  jsonError,
  jsonOk,
  readJson,
  requireSession,
  requireCsrf,
} from "@/lib/http";
import { validate, profileUpdateSchema } from "@/lib/validation";
import {
  hashPassword,
  verifyPassword,
  issueSession,
  setSessionCookies,
  revokeRefresh,
  audit,
} from "@/lib/auth";
import { verifyToken } from "@/lib/jwt";
import { COOKIE } from "@/lib/config";
import * as usersRepo from "@/lib/repos/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Atualiza o próprio perfil: nome, e-mail (login) e/ou senha.
// Alterar e-mail ou senha exige a senha atual. Ao mudar e-mail/senha, a sessão
// é reemitida para manter as claims coerentes e devolver um novo CSRF.
export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(profileUpdateSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  const user = await usersRepo.findById(session.sub);
  if (!user) return jsonError(404, "Usuário não encontrado.");

  const emailChanged =
    !!v.data.email && v.data.email.toLowerCase() !== user.email;
  const wantsPassword = !!v.data.newPassword;

  // Operações sensíveis exigem a senha atual.
  if (emailChanged || wantsPassword) {
    if (!v.data.currentPassword) {
      return jsonError(400, "Informe a senha atual para alterar e-mail ou senha.");
    }
    const ok = await verifyPassword(
      user.passwordHash,
      v.data.currentPassword
    );
    if (!ok) return jsonError(403, "Senha atual incorreta.");
  }

  const patch: {
    name?: string;
    email?: string;
    passwordHash?: string;
    locale?: string;
  } = {};
  // Idioma é preferência, não credencial: não exige senha atual.
  if (v.data.locale && v.data.locale !== user.locale) patch.locale = v.data.locale;
  if (v.data.name !== undefined && v.data.name !== user.name) {
    patch.name = v.data.name;
  }
  if (emailChanged) {
    if (await usersRepo.existsByEmail(v.data.email!)) {
      return jsonError(409, "Já existe um usuário com este e-mail.");
    }
    patch.email = v.data.email!.toLowerCase();
  }
  if (wantsPassword) {
    patch.passwordHash = await hashPassword(v.data.newPassword!);
  }

  if (Object.keys(patch).length === 0) {
    // Nada mudou de fato — devolve o estado atual.
    return jsonOk({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  }

  try {
    await usersRepo.updateProfile(user.id, patch);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") {
      return jsonError(409, "Já existe um usuário com este e-mail.");
    }
    const msg = e instanceof Error ? e.message : "Falha ao atualizar o perfil.";
    return jsonError(500, msg);
  }

  audit("account.update", {
    userId: user.id,
    fields: Object.keys(patch),
  });

  const profile = {
    locale: patch.locale ?? user.locale ?? null,
    id: user.id,
    email: patch.email ?? user.email,
    name: patch.name ?? user.name,
    role: user.role,
  };

  // Reemite a sessão quando e-mail/senha mudam (claim de e-mail + rotação).
  if (emailChanged || wantsPassword) {
    // Antes de emitir a nova, DERRUBA as antigas. Quem troca a senha porque
    // desconfia de invasão precisa que o refresh roubado pare de valer — ele
    // duraria mais 7 dias. Ver AUDITORIA.md#SEC-03.
    await usersRepo.invalidateSessions(user.id).catch(() => {});

    // Revoga também o refresh desta aba: o corte acima o invalidaria de todo
    // jeito, mas deixá-lo na blocklist torna a intenção explícita.
    const rt = req.cookies.get(COOKIE.refresh)?.value;
    if (rt) {
      const claims = await verifyToken(rt);
      if (claims?.jti) {
        await revokeRefresh(claims.jti, {
          userId: user.id,
          expiresAt: new Date(claims.exp * 1000),
        }).catch(() => {});
      }
    }

    const issued = await issueSession({
      id: profile.id,
      email: profile.email,
      role: profile.role,
    });
    const res = jsonOk({ ...profile, csrf: issued.csrf });
    setSessionCookies(res, issued);
    audit("session.revoked", { userId: user.id, reason: wantsPassword ? "password" : "email" });
    return res;
  }

  return jsonOk(profile);
}
