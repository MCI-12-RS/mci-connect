import { expect, test, type Browser, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, sql, toast, type E2EEnv } from "./exclusao-support";

// Acesso, menu e rotas (E2.02, PR 2, tarefa 8): UX-08, UX-09, UX-10 (duas
// sessões), UX-11 e o smoke de login. Login de verdade pela função `sign-in`
// (stack local; variáveis de `e2e/exclusao-support.ts`). Cria a própria massa
// fictícia (ids e2e202a8-…) e apaga tudo no fim. A conta X (sem cadastro) não
// entra pela `sign-in` (o login busca pelo cadastro); o menu dela é coberto no Vitest.
// Rodar com `--workers=1`: a `sign_in_throttle` é por origem (127.0.0.1).

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e202a8";
const PASSWORD = "QaAcesso#2026";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;
const ROLE_MEMBER = id(2, 1);
const ROLE_LEADER = id(2, 2);
const ROLE_REPORTS = id(2, 3);

interface Who {
  n: number;
  name: string;
  email: string;
  role: string | null;
}

const CAIO: Who = { n: 1, name: "QA Menu Caio Lima", email: "caio.e202a8@teste.invalid", role: ROLE_MEMBER };
const CARLA: Who = { n: 2, name: "QA Menu Carla Reis", email: "carla.e202a8@teste.invalid", role: ROLE_MEMBER };
const PEDRO: Who = { n: 3, name: "QA Menu Pedro Dias", email: "pedro.e202a8@teste.invalid", role: ROLE_LEADER };
const HUGO: Who = { n: 4, name: "QA Menu Hugo Melo", email: "hugo.e202a8@teste.invalid", role: null };
const GABRIEL: Who = { n: 5, name: "QA Menu Gabriel Paz", email: "gabriel.e202a8@teste.invalid", role: ROLE_REPORTS };
const RITA: Who = { n: 6, name: "QA Menu Rita Souza", email: "rita.e202a8@teste.invalid", role: "ADMIN" };
const PEOPLE = [CAIO, CARLA, PEDRO, HUGO, GABRIEL, RITA];

const MEMBER_PERMISSIONS = ["view_dashboard", "view_own_ministry", "edit_own_data", "submit_own_cell_report"];
const LEADER_PERMISSIONS = [...MEMBER_PERMISSIONS, "create_member", "edit_member", "create_cell", "edit_cell"];

const ALL_ITEMS = ["Dashboard", "Membros", "Células", "Relatórios", "Ministérios", "Funções", "Auditoria"];
const UPDATED = "Seu acesso foi atualizado.";

let env: E2EEnv;
const authIds: Record<string, string> = {};

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR actor_label LIKE 'QA Menu%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

async function removeAccounts() {
  const emails = PEOPLE.map((w) => w.email);
  const ids = sql(env, `SELECT id FROM auth.users WHERE email IN (${emails.map(lit).join(", ")})`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

/** Troca a função de quem tem cadastro (o que Rita faz pela tela de Membros). */
const setRole = (who: Who, role: string | null) =>
  sql(env, `UPDATE public.members SET role_id = ${role ? lit(role) : "NULL"} WHERE id = ${lit(id(1, who.n))};`);

/** Grava as permissões de uma função numa transação (a função padrão exige consistência no commit). */
const setPermissions = (role: string, permissions: string[]) =>
  sql(
    env,
    `BEGIN;
     DELETE FROM public.role_permissions WHERE role_id = ${lit(role)};
     INSERT INTO public.role_permissions (role_id, permission)
     SELECT ${lit(role)}::uuid, p::public.permission_action FROM unnest(ARRAY[${permissions.map(lit).join(", ")}]::text[]) p;
     COMMIT;`,
  );

/** "ADMIN" é a função de sistema Administrador, semeada pelas migrations. */
const roleRef = (role: string | null) =>
  role === "ADMIN" ? "(SELECT id FROM public.roles WHERE is_system AND name = 'Administrador')" : role ? lit(role) : "NULL";

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  for (const who of PEOPLE) authIds[who.email] = await createAuthUser(env, who.email, PASSWORD);
  const row = (who: Who) =>
    `(${lit(id(1, who.n))}, ${lit(who.name)}, 'F', false, true, ${lit(authIds[who.email])}, ${roleRef(who.role)}, ${lit(who.email)})`;
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES
       (${lit(ROLE_MEMBER)}, 'QA Menu Membro'), (${lit(ROLE_LEADER)}, 'QA Menu Líder'), (${lit(ROLE_REPORTS)}, 'QA Menu Relatórios');
     INSERT INTO public.role_permissions (role_id, permission)
       SELECT ${lit(ROLE_MEMBER)}::uuid, p::public.permission_action FROM unnest(ARRAY[${MEMBER_PERMISSIONS.map(lit).join(", ")}]::text[]) p;
     INSERT INTO public.role_permissions (role_id, permission)
       SELECT ${lit(ROLE_LEADER)}::uuid, p::public.permission_action FROM unnest(ARRAY[${LEADER_PERMISSIONS.map(lit).join(", ")}]::text[]) p;
     INSERT INTO public.role_permissions (role_id, permission) VALUES (${lit(ROLE_REPORTS)}, 'view_own_reports');
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, auth_user_id, role_id, email)
     VALUES ${PEOPLE.map(row).join(",\n            ")};
     COMMIT;`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e202a8@teste.invalid')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.beforeEach(() => {
  sql(env, "DELETE FROM private.sign_in_throttle;");
});

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
}

async function openSession(browser: Browser, email: string) {
  const context = await browser.newContext({ baseURL: "http://localhost:8080" });
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

/** A volta do foco, como o navegador a anuncia. */
async function returnFocus(page: Page) {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

const menuItem = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });
async function shownItems(page: Page) {
  const shown: string[] = [];
  for (const label of ALL_ITEMS) if (await menuItem(page, label).count()) shown.push(label);
  return shown;
}

test.describe("Smoke de login e UX-08: o menu de cada pessoa", () => {
  test("Dado Pedro (Líder), quando entra, então vê o menu de 5 itens e a função embaixo do nome", async ({ page }) => {
    await signIn(page, PEDRO.email);
    expect(await shownItems(page)).toEqual(["Dashboard", "Membros", "Células", "Relatórios", "Ministérios"]);
    await expect(page.getByTestId("menu-role")).toHaveText("QA Menu Líder");
    await expect(menuItem(page, "Dashboard")).toHaveAttribute("aria-current", "page");
  });

  test("Dado Caio (Membro), então vê os mesmos 5 itens", async ({ page }) => {
    await signIn(page, CAIO.email);
    expect(await shownItems(page)).toEqual(["Dashboard", "Membros", "Células", "Relatórios", "Ministérios"]);
  });

  test("Dado Gabriel (só Visualizar Relatórios do Seu Ministério), então vê só Relatórios", async ({ page }) => {
    await signIn(page, GABRIEL.email);
    expect(await shownItems(page)).toEqual(["Relatórios"]);
  });

  test("Dado Hugo (sem função), então não vê nenhum item, e a função é 'Sem função'", async ({ page }) => {
    await signIn(page, HUGO.email);
    expect(await shownItems(page)).toEqual([]);
    await expect(page.getByTestId("menu-role")).toHaveText("Sem função");
  });

  test("Dado a administradora, então vê os 7 itens", async ({ page }) => {
    await signIn(page, RITA.email);
    expect(await shownItems(page)).toEqual(ALL_ITEMS);
  });
});

test.describe("UX-09: meus dados", () => {
  test("Caio vê 'Editar meus dados'; Hugo vê 'Ver meus dados', que abre 'Meus dados' sem Salvar", async ({ page }) => {
    await signIn(page, CAIO.email);
    await expect(page.getByRole("button", { name: "Editar meus dados" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver meus dados" })).toHaveCount(0);
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    await signIn(page, HUGO.email);
    await expect(page.getByRole("button", { name: "Editar meus dados" })).toHaveCount(0);
    await page.getByRole("button", { name: "Ver meus dados" }).click();
    const dialog = page.getByRole("dialog", { name: "Meus dados" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Salvar" })).toHaveCount(0);
  });

  test("abaixo de 768 px, o botão tem 44x44 px", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: "http://localhost:8080", viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    await signIn(page, CAIO.email);
    await page.getByRole("button", { name: "Abrir menu" }).click();
    const box = await page.getByRole("button", { name: "Editar meus dados" }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    await context.close();
  });
});

test.describe("UX-11: rota sem permissão", () => {
  test("Dado Pedro, quando abre /roles pelo link, então vê o título, o aviso e 'Ir para o início', sem redirecionar nem nomes de função", async ({ page }) => {
    await signIn(page, PEDRO.email);
    await page.goto("/roles");
    const screen = page.getByTestId("no-access");
    await expect(screen).toBeVisible();
    await expect(page).toHaveURL(/\/roles$/);
    await expect(page.getByRole("heading", { level: 1, name: "Funções" })).toBeVisible();
    await expect(screen.getByText("Você não tem acesso a esta tela.")).toBeVisible();
    await expect(screen.getByRole("link", { name: "Ir para o início" })).toBeVisible();
    const body = (await page.locator("body").textContent()) ?? "";
    for (const forbidden of ["QA Menu Membro", "QA Menu Relatórios", "Administrador", "manage_roles", "view_roles", "Gerenciar Funções"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    await screen.getByRole("link", { name: "Ir para o início" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a rota sem permissão não faz nenhuma consulta de dados", async ({ page }) => {
    await signIn(page, PEDRO.email);
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      // A leitura do próprio cadastro e do acesso são do AuthContext, não da tela.
      if (/\/rest\/v1\//.test(url) && !/rpc\/my_access|members_view\?.*auth_user_id=eq\./.test(url)) requests.push(url);
    });
    await page.goto("/roles");
    await expect(page.getByTestId("no-access")).toBeVisible();
    await page.waitForTimeout(500);
    expect(requests, "consultas de dados feitas pela tela sem acesso").toEqual([]);
  });
});

test.describe("UX-10: o acesso muda com a sessão aberta (duas sessões)", () => {
  test("Dado Caio (Membro) aberto, quando a função dele vira Líder, então 'Novo membro' aparece ao voltar para a aba, sem sair e entrar, e o aviso sai uma vez", async ({ browser }) => {
    const caio = await openSession(browser, CAIO.email);
    try {
      await caio.page.goto("/members");
      await expect(caio.page.getByRole("heading", { level: 1, name: "Membros" })).toBeVisible();
      await expect(caio.page.getByRole("button", { name: /novo membro/i })).toHaveCount(0);
      await expect(toast(caio.page, UPDATED)).toHaveCount(0);

      setRole(CAIO, ROLE_LEADER);
      await returnFocus(caio.page);

      await expect(caio.page.getByRole("button", { name: /novo membro/i })).toBeVisible();
      await expect(toast(caio.page, UPDATED)).toHaveCount(1);
      await caio.page.waitForTimeout(1000);
      await expect(toast(caio.page, UPDATED)).toHaveCount(1);
    } finally {
      setRole(CAIO, ROLE_MEMBER);
      await caio.context.close();
    }
  });

  test("Dado Carla aberta, quando a função perde Visualizar Seu Ministério, então Membros, Células e Ministérios somem do menu na navegação seguinte", async ({ browser }) => {
    const carla = await openSession(browser, CARLA.email);
    try {
      expect(await shownItems(carla.page)).toEqual(["Dashboard", "Membros", "Células", "Relatórios", "Ministérios"]);

      setPermissions(ROLE_MEMBER, MEMBER_PERMISSIONS.filter((p) => p !== "view_own_ministry"));
      await menuItem(carla.page, "Relatórios").click();

      await expect(menuItem(carla.page, "Membros")).toHaveCount(0);
      expect(await shownItems(carla.page)).toEqual(["Dashboard", "Relatórios"]);
      await expect(toast(carla.page, UPDATED)).toHaveCount(1);

      // A rota que saiu do menu mostra o estado sem acesso, sem redirecionar.
      await carla.page.goto("/members");
      await expect(carla.page.getByTestId("no-access")).toBeVisible();
    } finally {
      setPermissions(ROLE_MEMBER, MEMBER_PERMISSIONS);
      await carla.context.close();
    }
  });
});
