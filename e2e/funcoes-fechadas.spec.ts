import { expect, test, type Page } from "@playwright/test";
import { accessToken, createAuthUser, deleteAuthUser, e2eEnv, lit, login, sql, type E2EEnv } from "./exclusao-support";

// Funções fechadas pela API (E2.02, PR 6, tarefa 19, RN-23, DA-9): com a sessão
// de um Líder (sem view_roles nem assign_role), `roles` volta vazia, as
// escritas em `roles` e `role_permissions` são recusadas, `members.role_id`
// dá 42501 e `members_view.role_id` vem nula para outra pessoa e preenchida
// no próprio cadastro. Massa fictícia (ids e2e202f6-…), apagada no fim.
// Rodar com `--workers=1`.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e202f6";
const PASSWORD = "QaFechadas#2026";
const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;
const LIDER = { id: id(1), name: "QA Fechadas Pedro Dias", email: "pedro.e202f6@teste.invalid" };
const OUTRO = { id: id(2), name: "QA Fechadas Andre Souza" };

let env: E2EEnv;
let authId = "";

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id IN (${lit(LIDER.id)}, ${lit(OUTRO.id)});
     DELETE FROM public.members WHERE id IN (${lit(LIDER.id)}, ${lit(OUTRO.id)});
     COMMIT;`,
  );
}

async function api(page: Page, method: string, path: string, data?: object) {
  const token = await accessToken(page);
  const response = await page.request.fetch(`${env.apiUrl}/rest/v1/${path}`, {
    method,
    headers: { apikey: env.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    data,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status(), body };
}

const code = (body: unknown) => (typeof body === "object" && body !== null && "code" in body ? String(body.code) : "");

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  authId = await createAuthUser(env, LIDER.email, PASSWORD);
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, auth_user_id, email, role_id) VALUES
       (${lit(LIDER.id)}, ${lit(LIDER.name)}, 'M', true, false, ${lit(authId)}, ${lit(LIDER.email)},
        (SELECT id FROM public.roles WHERE name = 'Líder')),
       (${lit(OUTRO.id)}, ${lit(OUTRO.name)}, 'M', false, true, NULL, NULL,
        (SELECT id FROM public.roles WHERE name = 'Membro'));
     UPDATE public.members SET leader_id = ${lit(LIDER.id)} WHERE id = ${lit(OUTRO.id)};`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  if (authId) await deleteAuthUser(env, authId);
});

test.describe("RN-23: funções fechadas pela API (Líder)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, { email: LIDER.email, password: PASSWORD });
  });

  test("Dado um Líder, quando lê roles e role_permissions, então volta vazio", async ({ page }) => {
    const roles = await api(page, "GET", "roles?select=id");
    expect(roles.status).toBe(200);
    expect(roles.body).toEqual([]);
    const perms = await api(page, "GET", "role_permissions?select=role_id");
    expect(perms.status).toBe(200);
    expect(perms.body).toEqual([]);
  });

  test("Dado um Líder, quando tenta gravar em roles e role_permissions, então a API recusa e nada muda", async ({ page }) => {
    const before = sql(env, "SELECT (SELECT count(*) FROM public.roles) || '/' || (SELECT count(*) FROM public.role_permissions)");
    const attempts = [
      await api(page, "POST", "roles", { name: "QA Fechadas Intrusa" }),
      await api(page, "PATCH", "roles?name=eq.L%C3%ADder", { name: "QA Fechadas Renomeada" }),
      await api(page, "DELETE", "roles?name=eq.Membro"),
      await api(page, "POST", "role_permissions", { role_id: id(99), permission: "manage_roles" }),
      await api(page, "PATCH", "role_permissions?permission=eq.view_dashboard", { permission: "manage_roles" }),
      await api(page, "DELETE", "role_permissions?permission=eq.view_dashboard"),
    ];
    for (const result of attempts) {
      expect([401, 403]).toContain(result.status);
      expect(code(result.body)).toBe("42501");
    }
    const after = sql(env, "SELECT (SELECT count(*) FROM public.roles) || '/' || (SELECT count(*) FROM public.role_permissions)");
    expect(after).toBe(before);
    expect(sql(env, "SELECT count(*) FROM public.roles WHERE name = 'QA Fechadas Renomeada' OR name = 'QA Fechadas Intrusa'")).toBe("0");
  });

  test("Dado um Líder, quando lê members.role_id, então 42501", async ({ page }) => {
    const direct = await api(page, "GET", "members?select=role_id");
    expect(direct.status).toBe(403);
    expect(code(direct.body)).toBe("42501");
    const filtered = await api(page, "GET", `members?select=id&role_id=not.is.null`);
    expect(code(filtered.body)).toBe("42501");
  });

  test("Dado um Líder, quando lê a members_view, então a role_id é nula da outra pessoa e preenchida na própria", async ({ page }) => {
    const other = await api(page, "GET", `members_view?select=id,role_id&id=eq.${OUTRO.id}`);
    expect(other.status).toBe(200);
    expect(other.body).toEqual([{ id: OUTRO.id, role_id: null }]);
    const own = await api(page, "GET", `members_view?select=id,role_id&id=eq.${LIDER.id}`);
    expect(own.status).toBe(200);
    const expected = sql(env, "SELECT id FROM public.roles WHERE name = 'Líder'");
    expect(own.body).toEqual([{ id: LIDER.id, role_id: expected }]);
  });
});
