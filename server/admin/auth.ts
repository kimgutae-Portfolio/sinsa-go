import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";

export interface AdminCredential {
  salt: string;
  hash: string;
}
export function hashAdminPassword(password: string): AdminCredential {
  if (password.length < 14 || password.length > 256)
    throw new Error("管理用パスワードは14〜256文字で設定してください。");
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, salt, 32).toString("hex") };
}
export function readAdminCredential(path: string): AdminCredential | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw);
  if (
    value.version !== 1 ||
    !/^[a-f0-9]{32}$/.test(value.salt) ||
    !/^[a-f0-9]{64}$/.test(value.hash)
  )
    throw new Error("管理者設定ファイルを確認してください。");
  return { salt: value.salt, hash: value.hash };
}
export interface AuthSession {
  csrfToken: string;
  expiresAt: number;
  lastSeenAt: number;
  credentialVersion: string;
}
export class AdminAuth {
  private sessions = new Map<string, AuthSession>();
  private failures = new Map<string, { count: number; until: number }>();
  constructor(
    private credential: () => AdminCredential | null,
    private now: () => number = Date.now,
  ) {}
  get configured() {
    return this.credential() !== null;
  }
  private digest(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  private cookie(request: IncomingMessage) {
    return (
      request.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("komorebi_admin="))
        ?.slice("komorebi_admin=".length) ?? ""
    );
  }
  current(request: IncomingMessage) {
    const token = this.cookie(request);
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
    const key = this.digest(token),
      session = this.sessions.get(key),
      now = this.now();
    if (!session) return null;
    if (session.expiresAt <= now || now - session.lastSeenAt >= 30 * 60000) {
      this.sessions.delete(key);
      return null;
    }
    const credential = this.credential();
    if (
      !credential ||
      session.credentialVersion !==
        this.digest(credential.salt + credential.hash)
    ) {
      this.sessions.delete(key);
      return null;
    }
    session.lastSeenAt = now;
    return session;
  }
  login(
    request: IncomingMessage,
    response: ServerResponse,
    password: unknown,
  ): { ok: boolean; status: number; message?: string; session?: AuthSession } {
    const now = this.now();
    for (const [key, value] of this.failures)
      if (value.until <= now) this.failures.delete(key);
    const address = this.digest(request.socket.remoteAddress ?? "unknown");
    const failure = this.failures.get(address);
    if (failure && failure.count >= 5)
      return {
        ok: false,
        status: 429,
        message: "ログイン試行が多すぎます。15分ほど待って再度お試しください。",
      };
    const credential = this.credential();
    if (!credential)
      return {
        ok: false,
        status: 503,
        message: "管理者設定がまだ完了していません。",
      };
    const candidate =
      typeof password === "string" && password.length <= 256 ? password : "";
    const actual = scryptSync(candidate, credential.salt, 32),
      expected = Buffer.from(credential.hash, "hex");
    if (!timingSafeEqual(actual, expected)) {
      const next = failure ?? { count: 0, until: now + 15 * 60000 };
      next.count++;
      if (this.failures.size >= 10000 && !this.failures.has(address))
        this.failures.delete(this.failures.keys().next().value!);
      this.failures.set(address, next);
      return {
        ok: false,
        status: 401,
        message: "パスワードを確認してください。",
      };
    }
    this.failures.delete(address);
    for (const [key, value] of this.sessions)
      if (value.expiresAt <= now || now - value.lastSeenAt >= 30 * 60000)
        this.sessions.delete(key);
    if (this.sessions.size >= 32)
      this.sessions.delete(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    const session = {
      csrfToken: randomBytes(24).toString("base64url"),
      expiresAt: now + 8 * 3600000,
      lastSeenAt: now,
      credentialVersion: this.digest(credential.salt + credential.hash),
    };
    this.sessions.set(this.digest(token), session);
    this.setCookie(request, response, token, 8 * 3600);
    return { ok: true, status: 200, session };
  }
  logout(request: IncomingMessage, response: ServerResponse) {
    this.sessions.delete(this.digest(this.cookie(request)));
    this.setCookie(request, response, "", 0);
  }
  private setCookie(
    request: IncomingMessage,
    response: ServerResponse,
    token: string,
    maxAge: number,
  ) {
    const secure =
      Boolean((request.socket as { encrypted?: boolean }).encrypted) ||
      request.headers["x-forwarded-proto"] === "https";
    response.setHeader(
      "Set-Cookie",
      `komorebi_admin=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
    );
  }
  dispose() {
    this.sessions.clear();
    this.failures.clear();
  }
}
