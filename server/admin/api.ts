import type { IncomingMessage, ServerResponse } from "node:http";
import { AdminAuth, type AdminCredential } from "./auth";
import {
  adminSnapshot,
  lanternRows,
  paginate,
  userRows,
  usersCsv,
} from "./data";
import type { ShrineRooms } from "../rooms";

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function readJson(request: IncomingMessage) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? ""))
    throw new RequestError(415, "JSON形式で送信してください。");
  if (Number(request.headers["content-length"] ?? 0) > 2048) {
    request.resume();
    throw new RequestError(413, "送信内容が大きすぎます。");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length <= 2048) chunks.push(bytes);
  }
  if (length > 2048) throw new RequestError(413, "送信内容が大きすぎます。");
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value as Record<string, unknown>;
  } catch {
    throw new RequestError(400, "送信内容を確認してください。");
  }
}
export function createAdminApi(
  rooms: ShrineRooms,
  options: {
    credential?: () => AdminCredential | null;
    allowedOrigins?: string[];
    now?: () => number;
  } = {},
) {
  const now = options.now ?? Date.now;
  const auth = new AdminAuth(options.credential ?? (() => null), now);
  const json = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(value));
  };
  return {
    auth,
    async handle(request: IncomingMessage, response: ServerResponse) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "same-origin");
      try {
        const url = new URL(request.url ?? "/", "http://localhost");
        const path = url.pathname;
        if (request.method === "POST") {
          let allowed = false;
          try {
            const origin = new URL(request.headers.origin ?? "");
            allowed =
              ["http:", "https:"].includes(origin.protocol) &&
              (origin.host === request.headers.host ||
                Boolean(options.allowedOrigins?.includes(origin.origin)));
          } catch {
            /* Missing origins cannot mutate a browser session. */
          }
          if (!allowed)
            throw new RequestError(403, "この接続元からは操作できません。");
          request.setTimeout(10000, () => request.destroy());
        }
        if (path === "/api/admin/session" && request.method === "GET") {
          const session = auth.current(request);
          json(response, 200, {
            configured: auth.configured,
            authenticated: Boolean(session),
            ...(session
              ? { csrfToken: session.csrfToken, expiresAt: session.expiresAt }
              : {}),
          });
          return;
        }
        if (path === "/api/admin/login" && request.method === "POST") {
          const body = await readJson(request),
            result = auth.login(request, response, body.password);
          if (result.ok)
            json(response, 200, {
              configured: true,
              authenticated: true,
              csrfToken: result.session!.csrfToken,
              expiresAt: result.session!.expiresAt,
            });
          else {
            if (result.status === 429) response.setHeader("Retry-After", "900");
            json(response, result.status, { message: result.message });
          }
          return;
        }
        const session = auth.current(request);
        if (!session)
          throw new RequestError(401, "管理者としてログインしてください。");
        if (path === "/api/admin/logout" && request.method === "POST") {
          if (request.headers["x-csrf-token"] !== session.csrfToken)
            throw new RequestError(
              403,
              "画面を更新してから再度お試しください。",
            );
          auth.logout(request, response);
          json(response, 200, { ok: true });
          return;
        }
        if (request.method !== "GET")
          throw new RequestError(405, "この操作には対応していません。");
        const snapshot = adminSnapshot(rooms, now());
        if (path === "/api/admin/overview") {
          json(response, 200, snapshot.overview);
          return;
        }
        if (path === "/api/admin/users") {
          json(
            response,
            200,
            paginate(
              userRows(snapshot.users, url.searchParams),
              url.searchParams,
              now(),
            ),
          );
          return;
        }
        if (path === "/api/admin/lanterns") {
          json(
            response,
            200,
            paginate(
              lanternRows(snapshot.lanterns, url.searchParams),
              url.searchParams,
              now(),
            ),
          );
          return;
        }
        if (path === "/api/admin/users.csv") {
          response.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="shrine-users-${new Date(now()).toISOString().slice(0, 10)}.csv"`,
          });
          response.end(usersCsv(userRows(snapshot.users, url.searchParams)));
          return;
        }
        if (path.startsWith("/api/admin/users/")) {
          const id = decodeURIComponent(path.slice("/api/admin/users/".length));
          const detail = snapshot.detail(id);
          if (!detail)
            throw new RequestError(404, "ユーザーが見つかりません。");
          json(response, 200, detail);
          return;
        }
        throw new RequestError(404, "ページが見つかりません。");
      } catch (error) {
        json(response, error instanceof RequestError ? error.status : 500, {
          message:
            error instanceof RequestError
              ? error.message
              : "データを取得できませんでした。しばらくしてからお試しください。",
        });
      }
    },
    dispose() {
      auth.dispose();
    },
  };
}
