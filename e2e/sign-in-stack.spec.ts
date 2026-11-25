import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, login, sql, type E2EEnv } from "./exclusao-support";

// Login de verdade na stack local (E1.04, PR 2): RN-01 a RN-04, RN-08, RN-13,
// RN-14 e RN-15 (Auditoria, UX-15 a UX-18). Precisa do Supabase local com a
// função `sign-in` servida (`supabase functions serve sign-in`) e do `npm run dev`
// apontando para ele; as variáveis são as de `e2e/exclusao-support.ts`
// (VITE_SUPABASE_URL local, VITE_SUPABASE_PUBLISHABLE_KEY, E2E_SERVICE_ROLE_KEY,
// E2E_PSQL e a conta de Administrador E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD).
// Sem elas, ou fora da stack local, os testes são pulados. Cria a própria massa
// fictícia (ids e2e104b0-…) e apaga tudo no fim.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e104b0";
const PASSWORD = "QaSignIn#2026";
const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;

const ANA = { name: "QA Sign Ana Souza", email: "ana.e2e104@teste.invalid", cpf: "52998224725", mobile: "(51) 98888-5001" };
const BIA = { name: "QA Sign Bia Reis", email: "bia.e2e104@teste.invalid", mobile: "(51) 97777-5002" };
const CAIO = { name: "QA Sign Caio Dias", email: "caio.e2e104@teste.invalid", cpf: "00000000191" };
const DENIS = { name: "QA Sign Denis Melo", email: "denis.e2e104@teste.invalid", mobile: "(51) 96666-5003" };
const ACCOUNTS = [ANA, BIA, CAIO, DENIS];

let env: E2EEnv;

const identifier = (page: Page) => page.getByLabel("Identificação");
const password = (page: Page) => page.getByLabel("Senha", { exact: true });
const submit = (page: Page) => page.locator('button[type="submit"]');
const message = (page: Page) => page.locator("#login-message");

const INVALID_MESSAGE = "Usuário ou senha inválidos. Confira os dados e tente de novo.";

async function signInApi(identifierText: string, passwordText: string) {
  const response = await fetch(`${env.apiUrl}/functions/v1/sign-in`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: identifierText, password: passwordText }),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

function resetThrottle() {
  sql(env, "DELETE FROM private.sign_in_throttle;");
}

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity = 'auth';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

async function removeAccounts() {
  const ids = sql(env, `SELECT id FROM auth.users WHERE email IN (${ACCOUNTS.map((a) => lit(a.email)).join(", ")})`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  const authIds = await Promise.all(ACCOUNTS.map((a) => createAuthUser(env, a.email, PASSWORD)));
  const row = (n: number, who: { name: string; email: string; cpf?: string; mobile?: string }, auth: string) =>
    `(${lit(id(n))}, ${lit(who.name)}, 'F', false, true, ${lit(auth)}, (SELECT id FROM public.roles WHERE name = 'Membro'), ${lit(who.email)},
      ${who.cpf ? lit(who.cpf) : "NULL"}, ${who.mobile ? lit(who.mobile) : "NULL"})`;
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, has_leadership, is_active, auth_user_id, role_id, email, cpf, mobile_whatsapp)
     VALUES ${row(1, ANA, authIds[0])}, ${row(2, BIA, authIds[1])}, ${row(3, CAIO, authIds[2])}, ${row(4, DENIS, authIds[3])};`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email IN (${ACCOUNTS.map((a) => lit(a.email)).join(", ")}))`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.beforeEach(() => {
  resetThrottle();
});

async function typeAndSubmit(page: Page, who: string, pw: string) {
  await page.goto("/login");
  await identifier(page).fill(who);
  await password(page).fill(pw);
  await submit(page).click();
}

async function expectSignedIn(page: Page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

test.describe("RN-01 a RN-04: entrar pela tela com e-mail, CPF e celular", () => {
  test("RN-01/RN-02: e-mail, sem diferenciar maiúsculas e com espaços nas pontas", async ({ page }) => {
    await typeAndSubmit(page, `  ${ANA.email.toUpperCase()}  `, PASSWORD);
    await expectSignedIn(page);
  });

  test("RN-01/RN-03: celular com máscara, com +55 e só dígitos", async ({ page }) => {
    for (const typed of ["(51) 97777-5002", "+55 (51) 97777-5002", "51977775002"]) {
      await typeAndSubmit(page, typed, PASSWORD);
      await expectSignedIn(page);
      await page.evaluate(() => localStorage.clear());
      await page.context().clearCookies();
    }
  });

  test("RN-03: o celular sem o nono dígito casa com o cadastro novo (chave de comparação)", async ({ page }) => {
    await typeAndSubmit(page, "(51) 7777-5002", PASSWORD);
    await expectSignedIn(page);
  });

  test("RN-04: CPF com máscara e só dígitos (a Ana tem o CPF e o mesmo número vale como celular)", async ({ page }) => {
    await typeAndSubmit(page, "529.982.247-25", PASSWORD);
    await expectSignedIn(page);
    await page.evaluate(() => localStorage.clear());
    await page.context().clearCookies();
    await typeAndSubmit(page, "52998224725", PASSWORD);
    await expectSignedIn(page);
  });

  test("RN-04: um CPF que não é celular (zeros à esquerda) entra pelo indicador 'CPF'", async ({ page }) => {
    await page.goto("/login");
    await identifier(page).fill("000.000.001-91");
    await expect(page.getByTestId("identifier-indicator")).toHaveText("CPF");
    await password(page).fill(PASSWORD);
    await submit(page).click();
    await expectSignedIn(page);
  });

  test("RN-07: senha errada, e-mail desconhecido e CPF desconhecido dão a mesma mensagem na tela", async ({ page }) => {
    for (const typed of [ANA.email, "ninguem@teste.invalid", "123.456.789-09"]) {
      await typeAndSubmit(page, typed, "senha-errada");
      await expect(message(page)).toHaveText(INVALID_MESSAGE);
      await expect(message(page)).toHaveAttribute("role", "alert");
      await expect(password(page)).toHaveValue("");
      await expect(password(page)).toBeFocused();
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});

test.describe("RN-08: campos vazios", () => {
  test("a tela não chama a função; a função devolve 400 empty_fields sem contar tentativa", async ({ page }) => {
    let calls = 0;
    page.on("request", (request) => {
      if (request.url().includes("/functions/v1/sign-in") && request.method() === "POST") calls++;
    });
    await page.goto("/login");
    await submit(page).click();
    await expect(message(page)).toHaveText("Informe a identificação e a senha.");
    expect(calls).toBe(0);

    const api = await signInApi("   ", "x");
    expect(api.status).toBe(400);
    expect(api.body).toEqual({ result: "empty_fields" });
    expect(sql(env, "SELECT count(*) FROM private.sign_in_throttle")).toBe("0");
  });
});

test.describe("RN-13: sessão persistida e renovada", () => {
  test("a sessão sobrevive ao recarregar, e o refresh token renova o acesso", async ({ page }) => {
    await typeAndSubmit(page, ANA.email, PASSWORD);
    await expectSignedIn(page);

    const stored = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? "";
        if (key.endsWith("-auth-token")) return localStorage.getItem(key);
      }
      return null;
    });
    expect(stored, "sessão no localStorage").not.toBeNull();
    const session: { access_token?: string; refresh_token?: string; user?: { email?: string } } = JSON.parse(stored ?? "{}");
    expect(session.access_token).toBeTruthy();
    expect(session.refresh_token).toBeTruthy();
    expect(session.user?.email).toBe(ANA.email);

    await page.reload();
    await expectSignedIn(page);
    await expect(page).not.toHaveURL(/\/login/);

    const refreshed = await fetch(`${env.apiUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    expect(refreshed.status).toBe(200);
    const body: { access_token?: string; refresh_token?: string } = await refreshed.json();
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).not.toBe(session.refresh_token);
  });

  test("a resposta da função traz só a sessão mínima, sem dados do cadastro", async () => {
    const api = await signInApi(ANA.email, PASSWORD);
    expect(api.status).toBe(200);
    expect(Object.keys(api.body).sort()).toEqual(["result", "session"]);
    const session = api.body.session as Record<string, unknown>;
    expect(Object.keys(session).sort()).toEqual(["access_token", "expires_at", "expires_in", "refresh_token", "token_type"]);
    expect(api.text).not.toContain(ANA.name);
    expect(api.text).not.toContain(ANA.cpf);
  });

  test("sair limpa a sessão: voltar para / leva ao login", async ({ page }) => {
    await typeAndSubmit(page, ANA.email, PASSWORD);
    await expectSignedIn(page);
    await page.evaluate(async () => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i) ?? "";
        if (key.endsWith("-auth-token")) localStorage.removeItem(key);
      }
    });
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("RN-14: o login direto no Auth fica recusado", () => {
  test("grant_type=password com e-mail e senha certos é recusado (provedor de e-mail desligado)", async () => {
    const response = await fetch(`${env.apiUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: ANA.email, password: PASSWORD }),
    });
    const text = await response.text();
    expect(response.status, text).toBeGreaterThanOrEqual(400);
    expect(response.status, text).toBeLessThan(500);
    expect(text).toContain("email_provider_disabled");
    expect(text).not.toContain("access_token");
  });

  test("a mesma conta entra normalmente pela função sign-in", async () => {
    const api = await signInApi(ANA.email, PASSWORD);
    expect(api.status).toBe(200);
  });

  test("o cadastro público (signup) também é recusado", async () => {
    const response = await fetch(`${env.apiUrl}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "intruso.e2e104@teste.invalid", password: "Intruso#2026" }),
    });
    const text = await response.text();
    expect(response.status, text).toBeGreaterThanOrEqual(400);
    expect(sql(env, "SELECT count(*) FROM auth.users WHERE email = 'intruso.e2e104@teste.invalid'")).toBe("0");
  });
});

test.describe("RN-12 e UX-06: bloqueio pela tela com a função de verdade", () => {
  test("Dado 5 falhas seguidas do mesmo cadastro, então a 5ª mostra o bloqueio com os minutos da resposta e a senha certa continua recusada", async ({
    page,
  }) => {
    await page.goto("/login");
    for (let attempt = 1; attempt <= 5; attempt++) {
      await identifier(page).fill(DENIS.email);
      await password(page).fill(`errada-${attempt}`);
      await submit(page).click();
      // A senha só é limpa quando a resposta chega: espera por ela antes da próxima tentativa
      // (a mensagem anterior continua na tela enquanto envia, UX-04).
      await expect(password(page), `tentativa ${attempt}`).toHaveValue("");
      if (attempt < 5) {
        await expect(message(page), `tentativa ${attempt}`).toHaveText(INVALID_MESSAGE);
      }
    }
    await expect(message(page)).toContainText("Muitas tentativas sem sucesso. Aguarde");
    await expect(message(page)).toContainText("minutos e tente de novo. Se esqueceu a senha, fale com o seu líder.");
    await expect(message(page)).toBeFocused();
    await expect(message(page)).not.toHaveAttribute("role", /.+/);
    await expect(identifier(page)).toHaveValue(DENIS.email);
    await expect(password(page)).toHaveValue("");
    await expect(submit(page)).toBeEnabled();

    await password(page).fill(PASSWORD);
    await submit(page).click();
    await expect(message(page)).toContainText("Muitas tentativas sem sucesso");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("RN-15 e UX-15 a UX-17: Auditoria dos eventos de login", () => {
  test.beforeAll(() => {
    // Começa sem eventos de login antigos (as linhas dos testes de cima).
    sql(env, "BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM public.events WHERE entity = 'auth'; COMMIT;");
  });

  test("os eventos de login, falha e bloqueio aparecem na Auditoria com rótulo, segunda linha e painel", async ({ page, browser }) => {
    // Gera os eventos pela API (a tela de login é a mesma função).
    expect((await signInApi(CAIO.email, PASSWORD)).status).toBe(200); // login
    expect((await signInApi(BIA.email, "errada")).status).toBe(401); // falha, senha incorreta (Bia)
    expect((await signInApi("ana.souza", "x")).status).toBe(401); // identificação inválida
    expect((await signInApi("ninguem@teste.invalid", "x")).status).toBe(401); // não encontrada
    for (let i = 0; i < 4; i++) await signInApi(DENIS.email, `errada-${i}`); // 4 falhas, a 5ª bloqueia
    const blocked = await signInApi(DENIS.email, "errada-5");
    expect(blocked.status).toBe(429);

    const admin = await browser.newContext();
    const adminPage = await admin.newPage();
    await login(adminPage, env.admin);
    await adminPage.goto("/events");
    await expect(adminPage.getByRole("heading", { name: "Auditoria" })).toBeVisible();
    await expect(adminPage.getByText("Carregando...")).toHaveCount(0);

    // UX-15 e UX-16: o bloqueio.
    const blockRow = adminPage.getByRole("row", { name: /Login \(bloqueio\)/ }).first();
    await expect(blockRow).toBeVisible();
    await expect(blockRow).toContainText("Login bloqueado por excesso de tentativas");
    await expect(blockRow).toContainText(/Por identificação · \d+ minutos? · QA Sign Denis Melo/);
    await expect(blockRow.getByRole("cell").nth(1)).toHaveText("—");

    // UX-16: a falha com cadastro e a falha sem cadastro.
    const wrongPassword = adminPage.getByRole("row", { name: /Senha incorreta · QA Sign Bia Reis/ });
    await expect(wrongPassword).toContainText("Login (falha)");
    await expect(wrongPassword).toContainText("Senha incorreta · QA Sign Bia Reis");
    const invalid = adminPage.getByRole("row", { name: /Identificação inválida/ }).first();
    await expect(invalid).toContainText("Login (falha)");
    const notFound = adminPage.getByRole("row", { name: /Identificação não encontrada/ }).first();
    await expect(notFound).toBeVisible();
    // O login que deu certo.
    const ok = adminPage.getByRole("row", { name: /QA Sign Caio Dias.*Login realizado/ });
    await expect(ok).toContainText("Login");

    // UX-17: o painel da identificação inválida (só "***") e o da falha com cadastro.
    await invalid.click();
    let panel = adminPage.getByRole("dialog");
    await expect(panel.getByText("Motivo", { exact: true })).toBeVisible();
    await expect(panel.getByText("Identificação inválida")).toBeVisible();
    await expect(panel.getByText("Identificação", { exact: true })).toBeVisible();
    await expect(panel.getByText("***", { exact: true })).toBeVisible();
    await expect(panel.getByText("ana.souza")).toHaveCount(0);
    await expect(panel.getByText("Metadados")).toHaveCount(0);
    await adminPage.keyboard.press("Escape");

    await wrongPassword.click();
    panel = adminPage.getByRole("dialog");
    for (const label of ["Cadastro", "Motivo", "Tipo de identificação", "Identificação"]) {
      await expect(panel.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(panel.getByText("E-mail", { exact: true })).toBeVisible();
    await expect(panel.getByText("b***@teste.invalid")).toBeVisible();
    await expect(panel.getByText("Tipo de bloqueio")).toHaveCount(0);
    await expect(panel.getByText("Metadados")).toHaveCount(0);
    await adminPage.keyboard.press("Escape");

    await blockRow.click();
    panel = adminPage.getByRole("dialog");
    await expect(panel.getByText("Tipo de bloqueio", { exact: true })).toBeVisible();
    await expect(panel.getByText("Por identificação", { exact: true })).toBeVisible();
    await expect(panel.getByText("Duração", { exact: true })).toBeVisible();
    await adminPage.keyboard.press("Escape");

    // A origem não aparece em lugar nenhum da tela nem do banco (RN-15 d).
    const bodyText = (await adminPage.locator("body").innerText()).toLowerCase();
    expect(bodyText).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(sql(env, "SELECT count(*) FROM public.events WHERE entity = 'auth' AND metadata ?| ARRAY['ip', 'origin', 'origin_key', 'password']")).toBe("0");

    // UX-15: o filtro "Ação" lista só os bloqueios.
    const block = adminPage.getByText("Ação", { exact: true }).locator("xpath=..");
    await block.getByRole("combobox").click();
    await adminPage.getByRole("option", { name: "Login (bloqueio)" }).click();
    await expect(adminPage.getByRole("row", { name: /Login \(bloqueio\)/ }).first()).toBeVisible();
    await expect(adminPage.getByRole("row", { name: /Login \(falha\)/ })).toHaveCount(0);
    await expect(adminPage.getByRole("row", { name: /Login realizado/ })).toHaveCount(0);

    await admin.close();
    void page;
  });

  for (const theme of ["light", "dark"] as const) {
    test(`UX-18: o 'OK' e a ação da Auditoria têm contraste (axe, tema ${theme})`, async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await login(page, env.admin);
      await page.goto("/events");
      await expect(page.getByText("Carregando...")).toHaveCount(0);
      await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
      await expect(page.getByRole("row").nth(1)).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa"])
        .include("table")
        .analyze();
      const found = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} :: ${n.any[0]?.message ?? ""}`).join(" | ")}`);
      expect(found).toEqual([]);
      await context.close();
    });
  }
});
