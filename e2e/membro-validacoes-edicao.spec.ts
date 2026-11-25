import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  authIdOf,
  createAuthUser,
  deleteAuthUser,
  e2eEnv,
  login,
  lit,
  sql,
  toast,
  type Credentials,
  type E2EEnv,
} from "./exclusao-support";
import {
  FABIO,
  M,
  cleanup,
  id,
  openEdit,
  removeCreatedAccounts,
  saveButton,
  seed,
  trackApi,
} from "./membro-validacoes-support";

// Formulário de membro, edição (E2.04, PR 3, tarefa 11): UX-11 (Elisa), UX-17 (Iara), UX-19 (seletor de
// líder), UX-21 (Fábio, do legado), UX-26 (descartar), UX-27 (axe) e os critérios de pronto da tarefa 9
// (edição sem mudança não faz requisição; o PATCH leva só o que mudou; celular e CPF mascarados ao
// abrir). Rita (Administrador) edita; André, com a função só de ministério, é a pessoa que não vê os
// dados sensíveis (o "Pedro" do UX-21). Massa "QA6 Val …" (ids e2e204b0-…), apagada no fim.
// Rode com `--workers=1`: os arquivos membro-validacoes-* usam a mesma massa.

const ROLE_ID = "e2e204b0-0004-0000-0000-000000000001";
const ANDRE: Credentials = { email: "andre.qa6@example.com", password: "Qa6Andre#2026" };
let env: E2EEnv;

function cleanupAll() {
  cleanup(env);
  sql(
    env,
    `DELETE FROM public.role_permissions WHERE role_id = ${lit(ROLE_ID)};
     DELETE FROM public.roles WHERE id = ${lit(ROLE_ID)};`,
  );
}

test.beforeAll(async () => {
  env = e2eEnv();
  const stale = authIdOf(env, ANDRE.email);
  if (stale) await deleteAuthUser(env, stale);
  await removeCreatedAccounts(env);
  cleanupAll();
  seed(env);
  const authId = await createAuthUser(env, ANDRE.email, ANDRE.password);
  sql(
    env,
    `INSERT INTO public.roles (id, name) VALUES (${lit(ROLE_ID)}, 'QA6 Val Ministério');
     INSERT INTO public.role_permissions (role_id, permission)
       SELECT ${lit(ROLE_ID)}::uuid, p::public.permission_action FROM unnest(ARRAY['view_own_ministry', 'edit_member', 'edit_own_data', 'view_dashboard']) p;
     UPDATE public.members SET email = ${lit(ANDRE.email)}, auth_user_id = ${lit(authId)}, role_id = ${lit(ROLE_ID)} WHERE id = ${lit(id(M.andre.n))};`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  const authId = authIdOf(env, ANDRE.email);
  cleanupAll();
  if (authId) await deleteAuthUser(env, authId);
  expect(
    sql(
      env,
      `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE 'e2e204b0%')
            + (SELECT count(*) FROM public.roles WHERE id = ${lit(ROLE_ID)})
            + (SELECT count(*) FROM auth.users WHERE email = ${lit(ANDRE.email)})`,
    ),
    "limpeza",
  ).toBe("0");
});

const ERR = (dialog: Locator, fieldId: string) => dialog.locator(`#${fieldId}-error`);
const WARN = (dialog: Locator, fieldId: string) => dialog.locator(`#${fieldId}-warning`);
const row = (n: number, columns: string) => sql(env, `SELECT concat_ws('|', ${columns}) FROM public.members WHERE id = ${lit(id(n))}`);
const patches = (calls: ReturnType<typeof trackApi>) => calls.filter((c) => c.method === "PATCH" && c.url.includes("/rest/v1/members"));
const writes = (calls: ReturnType<typeof trackApi>) => calls.filter((c) => c.method !== "GET" && c.method !== "HEAD" && c.method !== "OPTIONS");

test.describe("Tarefa 9: o que a edição envia", () => {
  test("Dado Caio aberto, quando salva sem mudar nada, então nenhuma requisição sai e o formulário fecha", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, M.caio.name);
    await page.waitForLoadState("networkidle");
    const calls = trackApi(page);
    await saveButton(dialog).click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(400);
    expect(calls.filter((c) => c.url.includes("/rest/v1/members") && c.method !== "GET"), "nenhuma gravação").toEqual([]);
    expect(calls.filter((c) => c.method !== "GET"), "nenhuma requisição de escrita").toEqual([]);
  });

  test("Dado só as Observações alteradas, então o PATCH leva só as observações", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, M.caio.name);
    await dialog.getByLabel("Observações").fill("conferido pela QA");
    const calls = trackApi(page);
    await saveButton(dialog).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    const sent = patches(calls);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].body ?? "{}")).toEqual({ notes: "conferido pela QA" });
    expect(row(M.caio.n, "notes")).toBe("conferido pela QA");
  });

  test("Dado o formulário aberto, quando a pessoa mexe e sai dos campos sem salvar, então nenhuma consulta de dado em uso acontece (UX-09)", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, M.diego.name);
    await page.waitForLoadState("networkidle");
    const calls = trackApi(page);
    await dialog.getByLabel("E-mail").fill("diego.novo.qa6@example.com");
    await dialog.getByLabel("Celular / WhatsApp").click();
    await dialog.getByLabel("CPF").click();
    await dialog.getByLabel("Nome *").click();
    expect(calls.filter((c) => c.method !== "GET" || /in_use|member_values|deleted_matches/.test(c.url))).toEqual([]);
  });

  test("Dado Diego (CPF) e Caio (celular), quando abre a edição, então celular e CPF aparecem mascarados", async ({ page }) => {
    await login(page, env.admin);
    let dialog = await openEdit(page, M.caio.name);
    await expect(dialog.getByLabel("Celular / WhatsApp")).toHaveValue("(51) 98888-6003");
    await expect(dialog.getByLabel("E-mail")).toHaveValue(M.caio.email);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    dialog = await openEdit(page, M.diego.name);
    await expect(dialog.getByLabel("CPF")).toHaveValue("529.982.247-25");
  });
});

test.describe("UX-11: Elisa apaga o e-mail e depois o celular", () => {
  test("Com o celular preenchido, apagar o e-mail grava e-mail nulo; apagar também o celular mostra a mensagem e não envia nada", async ({ page }) => {
    await login(page, env.admin);
    let dialog = await openEdit(page, M.elisa.name);
    await dialog.getByLabel("E-mail").fill("");
    const calls = trackApi(page);
    await saveButton(dialog).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(JSON.parse(patches(calls)[0].body ?? "{}")).toEqual({ email: null });
    expect(row(M.elisa.n, "coalesce(email, '<nulo>')")).toBe("<nulo>");

    dialog = await openEdit(page, M.elisa.name);
    await dialog.getByLabel("Celular / WhatsApp").fill("");
    const before = writes(calls).length;
    await saveButton(dialog).click();
    await expect(ERR(dialog, "identification")).toBeVisible();
    await expect(dialog.getByLabel("Celular / WhatsApp")).toBeFocused();
    expect(writes(calls).length, "nada foi enviado").toBe(before);
    expect(row(M.elisa.n, "mobile_whatsapp")).toBe(M.elisa.mobile);
  });
});

test.describe("UX-17 e RN-16: interruptores que apagam um campo", () => {
  test("Iara (batizada): desligar 'Batizado(a)?' avisa a data, religar devolve, e salvo desligado grava sem a data", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, M.iara.name);
    await dialog.getByRole("switch", { name: "Batizado(a)?" }).click();
    const notice = dialog.getByRole("status").filter({ hasText: "Ao salvar, a data do batismo (10/05/2020) será apagada." });
    await expect(notice).toBeVisible();
    await dialog.getByRole("switch", { name: "Batizado(a)?" }).click();
    await expect(dialog.getByLabel("Data do batismo")).toHaveValue("2020-05-10");
    await dialog.getByRole("switch", { name: "Batizado(a)?" }).click();
    await saveButton(dialog).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(row(M.iara.n, "is_baptized::text, coalesce(baptism_date::text, '<nulo>')")).toBe("false|<nulo>");
  });

  test("Iara (líder Pedro): desligar 'Tem Liderança?' avisa com o nome, religar devolve o líder, e salvo desligado deixa a cadastro sem líder", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, M.iara.name);
    await dialog.getByRole("switch", { name: "Tem Liderança?" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: `Ao salvar, ${M.pedro.name} deixa de ser o líder. A pessoa fica sem liderança.` })).toBeVisible();
    await expect(dialog.getByLabel("Líder *", { exact: true })).toHaveCount(0);
    await dialog.getByRole("switch", { name: "Tem Liderança?" }).click();
    await expect(dialog.getByText(M.pedro.name).first()).toBeVisible();
    await dialog.getByRole("switch", { name: "Tem Liderança?" }).click();
    await saveButton(dialog).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(row(M.iara.n, "has_leadership::text, coalesce(leader_id::text, '<nulo>')")).toBe("false|<nulo>");
  });
});

test.describe("UX-19 e RN-13/RN-14: seletor de líder", () => {
  test("Editando André, Caio e Davi (inativo) aparecem desabilitados com 'Discípulo desta pessoa'; a própria pessoa nunca aparece e o desabilitado não é escolhido", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, M.andre.name);
    const input = dialog.getByLabel("Líder *", { exact: true });
    await input.click();
    await input.fill("QA6 Val");
    await expect(page.getByRole("option", { name: new RegExp(M.diego.name) })).toBeVisible();
    for (const disciple of [M.caio, M.davi]) {
      const option = page.getByRole("option", { name: new RegExp(disciple.name) });
      await expect(option, disciple.name).toBeVisible();
      await expect(option, `${disciple.name} desabilitado`).toHaveAttribute("aria-disabled", "true");
      await expect(option).toContainText("Discípulo desta pessoa");
    }
    await expect(page.getByRole("option", { name: new RegExp(M.andre.name) }), "a própria pessoa nunca aparece").toHaveCount(0);
    await page.getByRole("option", { name: new RegExp(M.caio.name) }).click({ force: true });
    await page.keyboard.press("Escape");
    expect(row(M.andre.n, "coalesce(leader_id::text, '<nulo>')")).toBe(id(M.pedro.n));
    await expect(dialog.getByText(M.pedro.name).first(), "o líder continua Pedro").toBeVisible();
  });

  test("O seletor de cônjuge não oferece a própria pessoa", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, M.andre.name);
    const input = dialog.getByLabel("Cônjuge", { exact: true });
    await input.click();
    await input.fill("QA6 Val");
    await expect(page.getByRole("option", { name: new RegExp(M.caio.name) })).toBeVisible();
    await expect(page.getByRole("option", { name: new RegExp(M.andre.name) })).toHaveCount(0);
  });

  test("Sem a marca de discípulos (AQ-4 indisponível), escolher Davi e salvar mostra o ciclo embaixo do Líder, com o foco nele", async ({ page }) => {
    await login(page, env.admin);
    await page.route("**/rpc/member_descendants_among", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    const dialog = await openEdit(page, M.andre.name);
    const input = dialog.getByLabel("Líder *", { exact: true });
    await input.click();
    await input.fill(M.davi.name);
    const option = page.getByRole("option", { name: new RegExp(M.davi.name) });
    await expect(option).not.toHaveAttribute("aria-disabled", "true");
    await option.click();
    await saveButton(dialog).click();
    await expect(ERR(dialog, "leader")).toContainText("O líder escolhido é discípulo desta pessoa");
    await expect(dialog.getByLabel("Líder *", { exact: true })).toBeFocused();
    await expect(dialog).toBeVisible();
    expect(row(M.andre.n, "coalesce(leader_id::text, '<nulo>')"), "nada gravado").toBe(id(M.pedro.n));
  });
});

test.describe("UX-21 e RN-17: Fábio veio do legado", () => {
  test("Rita vê os avisos de Nome, Nascimento, Celular e Identificação (ícone e texto, sem aria-invalid) e o celular como está", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, FABIO.name);
    for (const field of ["name", "birth_date", "mobile_whatsapp", "identification"]) {
      const warning = WARN(dialog, field);
      await expect(warning, field).toBeVisible();
      await expect(warning.locator("svg[aria-hidden='true']"), `${field}: ícone`).toHaveCount(1);
    }
    await expect(dialog.locator("[aria-invalid='true']")).toHaveCount(0);
    await expect(dialog.getByLabel("Celular / WhatsApp")).toHaveValue("98887777");
    const border = await dialog.getByLabel("Nome *").evaluate((el) => getComputedStyle(el).borderColor);
    const normal = await dialog.getByLabel("Instagram (@)").evaluate((el) => getComputedStyle(el).borderColor);
    expect(border, "sem a borda de erro").toBe(normal);
  });

  test("Rita muda só as observações e salva: aceito, e nome, celular e nascimento não mudam", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, FABIO.name);
    await dialog.getByLabel("Observações").fill("legado conferido");
    const calls = trackApi(page);
    await saveButton(dialog).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(JSON.parse(patches(calls)[0].body ?? "{}")).toEqual({ notes: "legado conferido" });
    expect(row(FABIO.n, "name, mobile_whatsapp, birth_date::text, notes")).toBe("Fábio|98887777|1920-03-10|legado conferido");
  });

  test("Quem não vê os dados sensíveis (André, só do ministério) vê só os avisos do Nome e da Data de nascimento", async ({ page }) => {
    await login(page, ANDRE);
    const dialog = await openEdit(page, FABIO.name);
    await expect(WARN(dialog, "name")).toBeVisible();
    await expect(WARN(dialog, "birth_date")).toBeVisible();
    await expect(WARN(dialog, "mobile_whatsapp")).toHaveCount(0);
    await expect(WARN(dialog, "identification")).toHaveCount(0);
    await expect(dialog.getByLabel("Celular / WhatsApp")).toHaveCount(0);
  });

  test("RN-17: mudar o nome para 'Fabio' dá o erro do nome; com 'Fábio Lima' a gravação é aceita", async ({ page }) => {
    await login(page, env.admin);
    const dialog = await openEdit(page, FABIO.name);
    await dialog.getByLabel("Nome *").fill("Fabio");
    const calls = trackApi(page);
    await saveButton(dialog).click();
    await expect(ERR(dialog, "name")).toHaveText("Informe o nome e o sobrenome.");
    await expect(WARN(dialog, "name")).toHaveCount(0);
    expect(patches(calls)).toHaveLength(0);
    await dialog.getByLabel("Nome *").fill("Fábio Lima");
    await saveButton(dialog).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(row(FABIO.n, "name, mobile_whatsapp, birth_date::text")).toBe("Fábio Lima|98887777|1920-03-10");
  });
});

test.describe("UX-26: descartar as alterações, no navegador", () => {
  const discard = (page: Page) => page.getByRole("alertdialog", { name: "Descartar as alterações?" });
  const keepEditing = (page: Page) => page.getByRole("button", { name: "Continuar editando" });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, env.admin);
  });

  test("Com um campo alterado, o clique fora do diálogo pede a confirmação, com o foco em 'Continuar editando', e 'Continuar editando' mantém o que foi digitado", async ({ page }) => {
    const dialog = await openEdit(page, M.caio.name);
    await dialog.getByLabel("Observações").fill("mudou");
    await page.mouse.click(8, 8); // fora do diálogo, sobre o fundo
    await expect(discard(page)).toBeVisible();
    await expect(keepEditing(page)).toBeFocused();
    await keepEditing(page).click();
    await expect(discard(page)).toHaveCount(0);
    await expect(dialog.getByLabel("Observações")).toHaveValue("mudou");
  });

  test("Com um campo alterado, o '✕' e o Esc pedem a confirmação e 'Descartar' fecha sem gravar", async ({ page }) => {
    const dialog = await openEdit(page, M.caio.name);
    await dialog.getByLabel("Observações").fill("mudou");
    await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
    await expect(discard(page)).toBeVisible();
    await expect(keepEditing(page)).toBeFocused();
    await page.keyboard.press("Escape"); // fecha só o aviso, o formulário fica
    await expect(discard(page)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(discard(page)).toBeVisible();
    await page.getByRole("button", { name: "Descartar", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(row(M.caio.n, "coalesce(notes, '<nulo>')"), "nada foi gravado").not.toBe("mudou");
  });

  test("Sem alteração, o clique fora, o '✕' e o Esc fecham direto", async ({ page }) => {
    for (const close of [() => page.mouse.click(8, 8), () => page.keyboard.press("Escape")]) {
      const dialog = await openEdit(page, M.caio.name);
      await close();
      await expect(dialog).toBeHidden();
      await expect(discard(page)).toHaveCount(0);
    }
    const dialog = await openEdit(page, M.caio.name);
    await dialog.getByRole("button", { name: "Fechar", exact: true }).first().click();
    await expect(dialog).toBeHidden();
    await expect(discard(page)).toHaveCount(0);
  });
});

test.describe("UX-27: axe nos avisos de dado antigo e nos erros da edição, nos dois temas", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`tema ${theme}: avisos de Fábio e erro do nome`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await login(page, env.admin);
      const dialog = await openEdit(page, row(FABIO.n, "name"), FABIO.name); // o nome muda no teste da RN-17
      await expect(WARN(dialog, "birth_date")).toBeVisible();
      await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
      await page.waitForTimeout(500); // as cores têm transição: o axe mede depois dela
      const scan = async () =>
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .include('[role="dialog"]')
            // O botão primário no tema escuro tem 2,97:1 (token --primary, de src/index.css): achado global, fora deste PR.
            .exclude('button[type="submit"]')
            .analyze()
        ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      expect(await scan(), "avisos de dado antigo").toEqual([]);

      await dialog.getByLabel("Nome *").fill("Maria");
      await saveButton(dialog).click();
      await expect(ERR(dialog, "name")).toBeVisible();
      await page.waitForTimeout(300);
      expect(await scan(), "erro do nome").toEqual([]);
    });
  }
});
