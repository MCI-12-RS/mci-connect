import { expect, test, type Page } from "@playwright/test";
import { accessToken, createAuthUser, deleteAuthUser, e2eEnv, lit, openList, sql, type E2EEnv } from "./exclusao-support";

// O portão no banco (E2.03, PR 4, tarefa 13): UX-03 e UX-13 contra o banco
// real (sem resposta simulada), a RN-09 e a RN-16 com dois contextos, a marca
// na publicação (RN-08 c) com a sessão aberta, a Líder redefinindo (RN-01) e
// "13 permissões" na Líder (UX-32). Login de verdade pela `sign-in`; a stack
// local precisa da migration e203_05_gate. Cria a própria massa (ids
// e2e203d4-…) e apaga tudo no fim. Rodar com `--workers=1`.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e203d4";
const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;

interface Who {
  n: number;
  name: string;
  email: string;
  password: string;
  role: "Líder" | "Membro";
  leader?: number;
}

// Pedro (Líder, pastor da massa) redefine Caio, discípulo dele.
const PEDRO: Who = { n: 1, name: "QA Portão Pedro Alves", email: "pedro.e203d4@teste.invalid", password: "Pastoreio#2026", role: "Líder" };
const CAIO: Who = { n: 2, name: "QA Portão Caio Lima", email: "caio.e203d4@teste.invalid", password: "Caminho#2026x", role: "Membro", leader: 1 };
// Vera recebe a marca com a sessão aberta (UX-13); Ivo tem a senha 123456 na publicação (RN-08 c).
const VERA: Who = { n: 3, name: "QA Portão Vera Nunes", email: "vera.e203d4@teste.invalid", password: "Vereda#2026x", role: "Membro", leader: 1 };
const IVO: Who = { n: 4, name: "QA Portão Ivo Souza", email: "ivo.e203d4@teste.invalid", password: "Ipê#Roxo2026", role: "Membro", leader: 1 };
const PEOPLE = [PEDRO, CAIO, VERA, IVO];
const ROUTES = ["/", "/members", "/cells", "/cell-reports", "/ministries", "/roles", "/events", "/login"];

let env: E2EEnv;
const authIds: Record<string, string> = {};

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR actor_label LIKE 'QA Portão%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

async function removeAccounts() {
  const ids = sql(env, `SELECT id FROM auth.users WHERE email IN (${PEOPLE.map((w) => lit(w.email)).join(", ")})`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

async function signIn(page: Page, identifier: string, password: string) {
  sql(env, "DELETE FROM private.sign_in_throttle;");
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(identifier);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
}

const mark = (who: Who) => sql(env, `SELECT private.set_must_change(${lit(authIds[who.email])}::uuid, 'initial', NULL);`);
const unmark = (who: Who) =>
  sql(
    env,
    `UPDATE private.account_passwords SET must_change = false, must_change_reason = NULL, must_change_since = NULL, temp_expires_at = NULL
      WHERE auth_user_id = ${lit(authIds[who.email])};`,
  );

/** Uma leitura pela API com o token da página: o status e o corpo do PostgREST. */
async function apiGet(page: Page, path: string, token?: string) {
  const response = await page.request.get(`${env.apiUrl}/rest/v1/${path}`, {
    headers: { apikey: env.publishableKey, Authorization: `Bearer ${token ?? (await accessToken(page))}` },
  });
  const text = await response.text();
  let body: { code?: string; details?: string; hint?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  return { status: response.status(), code: body.code, gate: body.hint === "app_error" ? JSON.parse(body.details ?? "{}").code : undefined };
}

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  for (const who of PEOPLE) authIds[who.email] = await createAuthUser(env, who.email, who.password);
  const row = (who: Who) =>
    `(${lit(id(who.n))}, ${lit(who.name)}, 'M', ${who.leader ? "false" : "true"}, ${who.leader ? "true" : "false"}, ${
      who.leader ? lit(id(who.leader)) : "NULL"
    }, true, ${lit(authIds[who.email])}, (SELECT id FROM public.roles WHERE name = ${lit(who.role)}), ${lit(who.email)})`;
  // O líder antes dos discípulos (E2.06).
  for (const who of PEOPLE)
    sql(
      env,
      `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, auth_user_id, role_id, email)
       VALUES ${row(who)};`,
    );
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e203d4@teste.invalid')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.describe("E2.03 PR 4: o portão no banco", () => {
  test("UX-13 (banco real): a marca posta com a sessão aberta numa lista leva à troca na próxima leitura, sem toast nem erro; a sessão continua", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, VERA.email, VERA.password);
    await expect(page).toHaveURL(/\/$/);
    await openList(page, "/members", "QA Portão");
    await expect(page.getByText(PEDRO.name).first()).toBeVisible();

    mark(VERA);
    // A próxima leitura (outra lista) volta com 42501 + password_change_required do próprio banco.
    await page.getByTestId("menu-content").getByRole("button", { name: "Células" }).click();
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole("heading", { name: "Crie uma nova senha" })).toBeVisible();
    await expect(page.locator("li[role='status']")).toHaveCount(0);
    await expect(page.getByText("Você não tem permissão")).toHaveCount(0);
    await expect(page.getByText("Sua sessão terminou")).toHaveCount(0);
    expect(sql(env, `SELECT count(*) FROM auth.sessions WHERE user_id = ${lit(authIds[VERA.email])}`), "RN-16: a marca não encerra a sessão").not.toBe("0");
    unmark(VERA);
  });

  test("UX-03 e RN-09 (banco real): com a marca, toda rota leva à troca, e a API recusa com 42501 password_change_required", async ({ page }) => {
    mark(CAIO);
    await signIn(page, CAIO.email, CAIO.password);
    await expect(page).toHaveURL(/\/change-password$/);
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page, `${route} leva à troca`).toHaveURL(/\/change-password$/);
      await expect(page.getByTestId("menu-content")).toHaveCount(0);
      await expect(page.getByText(PEDRO.name)).toHaveCount(0);
    }
    // RN-09 b: a mesma sessão, direto na API, é recusada com erro de permissão e o código do portão.
    // (Uma view sem nenhuma linha no banco volta vazia, sem chegar ao portão; por isso a lista de membros e as RPCs.)
    for (const path of ["members_view?select=id&limit=1", "rpc/my_access", "rpc/dashboard_summary"]) {
      const r = await apiGet(page, path);
      expect(r.status, `${path}: status`).toBe(403);
      expect(r.code, `${path}: SQLSTATE`).toBe("42501");
      expect(r.gate, `${path}: código`).toBe("password_change_required");
    }
    // A lista fechada responde: my_password_status diz que há marca.
    const status = await page.request.post(`${env.apiUrl}/rest/v1/rpc/my_password_status`, {
      headers: { apikey: env.publishableKey, Authorization: `Bearer ${await accessToken(page)}`, "Content-Type": "application/json" },
      data: {},
    });
    expect(status.status()).toBe(200);
    expect(await status.json()).toEqual([{ must_change_password: true }]);
    unmark(CAIO);
    // Sem a marca, /change-password leva ao início.
    await page.goto("/change-password");
    await expect(page).toHaveURL(/\/$/);
  });

  test("RN-01, RN-09 e RN-16 com dois contextos: Pedro (Líder) redefine Caio; a sessão aberta de Caio termina na próxima ação e o token antigo é recusado", async ({ browser, page }) => {
    // Caio no celular (outro contexto), com uma lista aberta.
    const phone = await browser.newContext();
    const caioPage = await phone.newPage();
    await signIn(caioPage, CAIO.email, CAIO.password);
    await expect(caioPage).toHaveURL(/\/$/);
    await openList(caioPage, "/members", "QA Portão");
    const oldToken = await accessToken(caioPage);

    // Pedro (Líder) redefine Caio pela linha da lista (RN-01: a Líder tem a permissão desde a migration 5).
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, PEDRO.email, PEDRO.password);
    await expect(page).toHaveURL(/\/$/);
    await openList(page, "/members", "QA Portão");
    await page.getByRole("button", { name: `Redefinir a senha de ${CAIO.name}`, exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: `Redefinir a senha de ${CAIO.name}?` });
    await confirm.getByRole("button", { name: "Redefinir senha" }).click();
    const result = page.getByRole("alertdialog", { name: `Senha temporária de ${CAIO.name}` });
    await expect(result).toBeVisible();
    const temporary = (await result.getByTestId("temporary-password").textContent()) ?? "";
    expect(temporary).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    await result.getByRole("button", { name: "Concluir" }).click();
    await expect(result).toHaveCount(0);

    // RN-16 na API: o token emitido antes da redefinição deixa de servir na hora.
    const stale = await apiGet(caioPage, "members_view?select=id&limit=1", oldToken);
    expect(stale.status).toBe(403);
    expect(stale.gate).toBe("session_ended");

    // RN-16 na tela: a próxima ação de Caio leva ao login com o aviso.
    await caioPage.getByTestId("menu-content").getByRole("button", { name: "Células" }).click();
    await expect(caioPage).toHaveURL(/\/login$/);
    await expect(caioPage.getByText("Sua sessão terminou. Entre de novo para continuar.")).toBeVisible();

    // Com a temporária, Caio entra e vai para a troca obrigatória (RN-08 a, RN-09 a).
    await signIn(caioPage, CAIO.email, temporary);
    await expect(caioPage).toHaveURL(/\/change-password$/);
    await phone.close();

    // As sessões de Pedro não mudam: ele continua na lista.
    await page.reload();
    await expect(page).toHaveURL(/\/members/);
    await expect(page.getByText(CAIO.name).first()).toBeVisible();
    unmark(CAIO);
  });

  test("RN-08 c: a marca na publicação pega a conta com 123456 e a sessão aberta vai para a troca na próxima leitura", async ({ page }) => {
    await signIn(page, IVO.email, IVO.password);
    await expect(page).toHaveURL(/\/$/);
    // A conta passa a ter 123456 (como as contas criadas antes do E2.03), e a publicação roda.
    sql(env, `SELECT private.write_password(${lit(authIds[IVO.email])}::uuid, NULL, '123456', NULL);`);
    sql(env, "SELECT private.mark_initial_passwords();");
    expect(sql(env, `SELECT must_change_reason FROM private.account_passwords WHERE auth_user_id = ${lit(authIds[IVO.email])} AND must_change`)).toBe(
      "initial",
    );
    expect(
      sql(
        env,
        `SELECT count(*) FROM public.events WHERE action = 'password_change_required' AND entity_id = ${lit(id(IVO.n))}
            AND actor_user_id IS NULL AND metadata ->> 'reason' = 'initial_password'`,
      ),
    ).toBe("1");
    await page.getByTestId("menu-content").getByRole("button", { name: "Membros" }).click();
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.locator("li[role='status']")).toHaveCount(0);
  });

  test("UX-32: em Funções, a Líder tem 'Redefinir Senha de Membros' e mostra 13 permissões", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, env.admin.email, env.admin.password);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/roles");
    const leader = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Editar a função Líder" }) });
    await expect(leader.getByRole("cell").nth(2).locator("span, div > *")).toHaveCount(13);
    await expect(leader).toContainText("Redefinir Senha de Membros");
    // No celular, o cartão traz a contagem.
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByText(/^13 permissões/).first()).toBeVisible();
  });
});
