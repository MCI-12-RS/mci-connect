import { test, expect, type Page } from "@playwright/test";
import {
  authIdOf,
  createAuthUser,
  deleteAuthUser,
  e2eEnv,
  expectDialogFitsSmallScreen,
  expectTouchTargets,
  lit,
  login,
  openList,
  rpcsAs,
  sql,
  toast,
  type Credentials,
  type E2EEnv,
} from "./exclusao-support";

// Cadastro de membro novo com dados de um membro excluído (E2.01, PR 5): RN-18
// e os critérios UX-31 a UX-34, com as personas AD (Administrador), LE (Líder:
// cria e exclui membros, sem "Gerenciar Funções") e CM (só "Criar Membro").
//
// Precisa da `create-user-admin` servida na stack local (`supabase functions
// serve`); sem ela, o teste é pulado. As demais variáveis são as de
// e2e/exclusao-support.ts. Cria a própria massa fictícia ("QA5 Cad Exc …", ids
// e2e201e0-…) e apaga tudo no fim (e no começo, se uma execução anterior parou
// no meio). Rode com `--workers=1`: o arquivo cria a função padrão da stack,
// se não houver, e os testes rodam em série.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e201e0";
const NAME = "QA5 Cad Exc";
const PASSWORD = "Qa5CadExc#2026";
const id = (kind: number, n: number) => `${PREFIX}-${String(kind).padStart(4, "0")}-0000-0000-${String(n).padStart(12, "0")}`;
const member = (n: number) => id(1, n);
const role = (n: number) => id(4, n);
const who = (name: string) => `${NAME} ${name}`;

const LE: Credentials = { email: "le.qa5-cad@teste.invalid", password: PASSWORD };
const CM: Credentials = { email: "cm.qa5-cad@teste.invalid", password: PASSWORD };
const BRUNO: Credentials = { email: "bruno.qa5-cad@teste.invalid", password: PASSWORD };
const ACCOUNTS = [LE, CM, BRUNO];

// Cada dado de excluído é de um cadastro só, e nenhum teste restaura o de outro.
const DORA_MOBILE = "(51) 97777-0501";
const EVA_MOBILE = "(51) 97777-0502";
const IARA_CPF = "390.533.447-05";
const GIL_CPF = "111.444.777-35";
const FABIO_EMAIL = "fabio.qa5-cad@teste.invalid";
const MARTA_MOBILE = "(51) 97777-0503";

let env: E2EEnv;
let adminId = "";
/** A função padrão criada por este arquivo (vazio se já havia uma). */
let createdDefaultRole = "";

function cleanup() {
  const actors = ACCOUNTS.map((a) => lit(a.email)).join(", ");
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_id::text LIKE '${PREFIX}%'
         OR entity_label LIKE '${NAME}%'
         OR metadata ->> 'member_id' LIKE '${PREFIX}%'
         OR actor_user_id IN (SELECT id FROM auth.users WHERE email IN (${actors}));
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%';
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     COMMIT;`,
  );
}

/** As contas de acesso dos membros criados pelos testes (e-mail fictício ou informado). */
const createdAccountIds = () =>
  sql(env, `SELECT m.auth_user_id FROM public.members m WHERE m.name LIKE '${NAME}%' AND m.auth_user_id IS NOT NULL`)
    .split("\n")
    .filter(Boolean);

async function removeAccounts() {
  for (const account of ACCOUNTS) {
    const userId = authIdOf(env, account.email);
    if (userId) await deleteAuthUser(env, userId);
  }
}

const permissions = (roleNumber: number, list: readonly string[]) =>
  `SELECT ${lit(role(roleNumber))}::uuid, p::public.permission_action FROM unnest(ARRAY[${list.map(lit).join(", ")}]) p`;

test.beforeAll(async () => {
  env = e2eEnv();
  const probe = await fetch(`${env.apiUrl}/functions/v1/create-user-admin`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => null);
  test.skip(!probe || probe.status !== 401, "Sirva a create-user-admin na stack local (supabase functions serve).");

  for (const userId of createdAccountIds()) await deleteAuthUser(env, userId);
  cleanup();
  await removeAccounts();
  adminId = authIdOf(env, env.admin.email);
  const auth = {
    le: await createAuthUser(env, LE.email, LE.password),
    cm: await createAuthUser(env, CM.email, CM.password),
    bruno: await createAuthUser(env, BRUNO.email, BRUNO.password),
  };
  // O cadastro novo recebe a função padrão; a stack local pode não ter uma.
  if (!sql(env, `SELECT 1 FROM public.roles WHERE is_default`)) {
    sql(
      env,
      `INSERT INTO public.roles (id, name, is_default) VALUES (${lit(role(9))}, '${NAME} Padrão', true);
       INSERT INTO public.role_permissions (role_id, permission) VALUES (${lit(role(9))}, 'view_dashboard');`,
    );
    createdDefaultRole = role(9);
  }
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES
       (${lit(role(1))}, '${NAME} LE'), (${lit(role(2))}, '${NAME} CM'), (${lit(role(3))}, '${NAME} Membro');
     INSERT INTO public.role_permissions (role_id, permission)
     ${permissions(1, ["view_all_church", "view_dashboard", "create_member", "view_own_ministry", "edit_own_data", "submit_own_cell_report", "delete_member"])}
     UNION ALL ${permissions(2, ["view_all_church", "view_dashboard", "create_member", "view_own_ministry", "edit_own_data", "submit_own_cell_report"])}
     UNION ALL ${permissions(3, ["view_dashboard"])};
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id, auth_user_id, email, mobile_whatsapp, cpf) VALUES
       (${lit(member(90))}, ${lit(who("Lia Lopes"))}, 'F', false, true, ${lit(role(1))}, ${lit(auth.le)}, ${lit(LE.email)}, NULL, NULL),
       (${lit(member(91))}, ${lit(who("Caio Mota"))}, 'M', false, true, ${lit(role(2))}, ${lit(auth.cm)}, ${lit(CM.email)}, NULL, NULL),
       (${lit(member(1))}, ${lit(who("Bruno Almeida"))}, 'M', false, true, ${lit(role(3))}, ${lit(auth.bruno)}, ${lit(BRUNO.email)}, NULL, NULL),
       (${lit(member(2))}, ${lit(who("Dora Reis"))}, 'F', false, true, ${lit(role(3))}, NULL, NULL, ${lit(DORA_MOBILE)}, NULL),
       (${lit(member(3))}, ${lit(who("Eva Prado"))}, 'F', false, true, ${lit(role(3))}, NULL, NULL, ${lit(EVA_MOBILE)}, NULL),
       (${lit(member(4))}, ${lit(who("Iara Neves"))}, 'F', false, true, ${lit(role(3))}, NULL, NULL, NULL, ${lit(IARA_CPF)}),
       (${lit(member(5))}, ${lit(who("Fábio Reis"))}, 'M', false, true, ${lit(role(3))}, NULL, ${lit(FABIO_EMAIL)}, NULL, NULL),
       (${lit(member(6))}, ${lit(who("Gil Souza"))}, 'M', false, true, ${lit(role(3))}, NULL, NULL, NULL, ${lit(GIL_CPF)}),
       (${lit(member(7))}, ${lit(who("Marta Dias"))}, 'F', false, true, ${lit(role(3))}, NULL, NULL, ${lit(MARTA_MOBILE)}, NULL);
     COMMIT;`,
  );
  rpcsAs(env, adminId, [1, 2, 3, 4, 5, 6, 7].map((n) => `public.delete_member(${lit(member(n))})`));
  // A data que o spec usa no exemplo (RN-18): "excluído em 10/11/2026".
  sql(env, `UPDATE public.members SET deleted_at = '2026-11-10T15:00:00Z' WHERE id = ${lit(member(1))}`);
});

test.afterAll(async () => {
  if (!env) return;
  for (const userId of createdAccountIds()) await deleteAuthUser(env, userId);
  cleanup();
  await removeAccounts();
  if (createdDefaultRole) {
    sql(env, `DELETE FROM public.role_permissions WHERE role_id = ${lit(createdDefaultRole)}; DELETE FROM public.roles WHERE id = ${lit(createdDefaultRole)};`);
  }
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email IN (${ACCOUNTS.map((a) => lit(a.email)).join(", ")}))`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

const isDeleted = (memberId: string) => sql(env, `SELECT (deleted_at IS NOT NULL)::text FROM public.members WHERE id = ${lit(memberId)}`);
const membersNamed = (name: string) => Number(sql(env, `SELECT count(*) FROM public.members WHERE name = ${lit(name)}`));

interface NewMember {
  name: string;
  email?: string;
  mobile?: string;
  cpf?: string;
}

/** Abre o formulário "Novo membro" e preenche; não envia. */
async function fillNewMember(page: Page, data: NewMember) {
  await openList(page, "/members", NAME);
  await page.getByRole("button", { name: "Novo membro", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo membro" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nome *").fill(data.name);
  if (data.email) await dialog.getByLabel("E-mail").fill(data.email);
  if (data.mobile) await dialog.getByLabel("Celular / WhatsApp").fill(data.mobile);
  if (data.cpf) await dialog.getByLabel("CPF").fill(data.cpf);
  return dialog;
}

const submit = (dialog: ReturnType<Page["getByRole"]>) => dialog.getByRole("button", { name: "Criar membro", exact: true }).click();

/** O aviso do cadastro excluído (T9). */
const warning = (page: Page) => page.getByRole("alertdialog");

/** As respostas da Edge Function a partir de agora (status e texto). */
function trackFunction(page: Page) {
  const replies: Array<{ status: number; text: string }> = [];
  page.on("response", (response) => {
    if (response.url().includes("/functions/v1/create-user-admin") && response.request().method() === "POST") {
      void response.text().then((text) => replies.push({ status: response.status(), text }));
    }
  });
  return replies;
}

test.describe("RN-18 / UX-31 (AD)", () => {
  test("Dado Bruno excluído, com conta no e-mail dele, quando AD cadastra um membro novo com esse e-mail, então o aviso nomeia Bruno, oferece Restaurar e Voltar, sem Cadastrar mesmo assim", async ({ page }) => {
    await login(page, env.admin);
    const novo = who("Novo Com Email Bruno");
    const dialog = await fillNewMember(page, { name: novo, email: BRUNO.email, mobile: "(51) 96666-0501" });
    await submit(dialog);

    const aviso = warning(page);
    await expect(aviso).toBeVisible();
    await expect(aviso.getByRole("heading", { name: "Há um cadastro excluído com estes dados" })).toBeVisible();
    await expect(aviso.getByTestId("deleted-matches-restorable")).toContainText(
      `Já existe um cadastro excluído com este e-mail: ${who("Bruno Almeida")}, excluído em 10/11/2026.`,
    );
    await expect(aviso.getByRole("button", { name: `Restaurar ${who("Bruno Almeida")}`, exact: true })).toBeVisible();
    await expect(aviso).toContainText("Para cadastrar outra pessoa, volte e use outro e-mail.");
    await expect(aviso.getByRole("button", { name: "Cadastrar mesmo assim" })).toHaveCount(0);
    await expect(aviso.getByRole("button", { name: "Voltar ao formulário", exact: true })).toBeFocused();

    // Voltar ao formulário: o aviso fecha e tudo o que foi digitado continua.
    await aviso.getByRole("button", { name: "Voltar ao formulário", exact: true }).click();
    await expect(aviso).toBeHidden();
    await expect(dialog.getByLabel("Nome *")).toHaveValue(novo);
    await expect(dialog.getByLabel("E-mail")).toHaveValue(BRUNO.email);
    await expect(dialog.getByLabel("Celular / WhatsApp")).toHaveValue("(51)96666-0501");

    expect(membersNamed(novo), "nada foi gravado").toBe(0);
    expect(isDeleted(member(1)), "Bruno continua excluído").toBe("true");
  });

  test("Dado dois excluídos (e-mail de Fábio, CPF de Gil), quando AD salva, então vê os dois, cada um com o seu Restaurar, e pode cadastrar mesmo assim", async ({ page }) => {
    await login(page, env.admin);
    const novo = who("Novo Com Dois");
    const dialog = await fillNewMember(page, { name: novo, email: FABIO_EMAIL, cpf: GIL_CPF });
    await submit(dialog);

    const aviso = warning(page);
    await expect(aviso.getByRole("heading", { name: "Há 2 cadastros excluídos com estes dados" })).toBeVisible();
    const list = aviso.getByTestId("deleted-matches-restorable");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText(`Já existe um cadastro excluído com este e-mail: ${who("Fábio Reis")}`);
    await expect(list).toContainText(`Já existe um cadastro excluído com este CPF: ${who("Gil Souza")}`);
    await expect(aviso.getByRole("button", { name: `Restaurar ${who("Fábio Reis")}`, exact: true })).toBeVisible();
    await expect(aviso.getByRole("button", { name: `Restaurar ${who("Gil Souza")}`, exact: true })).toBeVisible();
    await expect(aviso.getByRole("button", { name: "Cadastrar mesmo assim" })).toBeVisible();

    // "Cadastrar mesmo assim" também vale para o administrador.
    await aviso.getByRole("button", { name: "Cadastrar mesmo assim" }).click();
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    expect(membersNamed(novo)).toBe(1);
    expect(isDeleted(member(5)) + isDeleted(member(6)), "os excluídos continuam excluídos").toBe("truetrue");
  });

  test("UX-31 no celular (360×800): o aviso cabe na tela, com os botões à vista e alvos de toque de 44 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, env.admin);
    const dialog = await fillNewMember(page, { name: who("Novo Celular Estreito"), email: FABIO_EMAIL, cpf: GIL_CPF });
    await submit(dialog);
    const aviso = warning(page);
    await expect(aviso).toBeVisible();
    await expectDialogFitsSmallScreen(
      page,
      aviso,
      [`Restaurar ${who("Fábio Reis")}`, `Restaurar ${who("Gil Souza")}`, "Cadastrar mesmo assim", "Voltar ao formulário"],
      "UX-31 (360×800)",
    );
    await expectTouchTargets(aviso, "UX-31 (360×800)");
  });
});

test.describe("RN-18 / UX-32 (AD): restaurar pelo aviso", () => {
  test("Dado o celular de Dora excluída, quando AD restaura pelo aviso, então o diálogo vira Editar Membro com os dados de Dora, o Alert com o foco, e nada do que foi digitado é gravado", async ({ page }) => {
    await login(page, env.admin);
    const digitado = who("Digitado Para Dora");
    const dialog = await fillNewMember(page, { name: digitado, mobile: DORA_MOBILE, cpf: "529.982.247-25" });
    await submit(dialog);

    const aviso = warning(page);
    await expect(aviso.getByTestId("deleted-matches-restorable")).toContainText(`com este celular: ${who("Dora Reis")}`);
    await aviso.getByRole("button", { name: `Restaurar ${who("Dora Reis")}`, exact: true }).click();

    const edit = page.getByRole("dialog", { name: "Editar Membro" });
    await expect(edit).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const status = edit.getByRole("status").filter({ hasText: "restaurado" });
    await expect(status).toContainText(`Cadastro de ${who("Dora Reis")} restaurado. Confira os dados e, se precisar, altere e salve.`);
    await expect(status).toBeFocused();
    await expect(edit.getByLabel("Nome *")).toHaveValue(who("Dora Reis"));
    await expect(edit.getByLabel("Celular / WhatsApp")).toHaveValue(DORA_MOBILE);
    await expect(edit.getByLabel("CPF")).toHaveValue("");
    await expect(edit.getByRole("button", { name: "Salvar", exact: true })).toBeVisible();

    expect(isDeleted(member(2)), "Dora voltou").toBe("false");
    expect(membersNamed(digitado), "o que foi digitado não é gravado").toBe(0);
    expect(sql(env, `SELECT count(*) FROM public.members WHERE cpf = '52998224725' OR cpf = '529.982.247-25'`), "o CPF digitado não foi gravado").toBe("0");

    // Salvar edita o cadastro restaurado (não cria outro).
    await edit.getByLabel("Observações").fill("Conferido após restaurar");
    await edit.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(edit).toBeHidden();
    expect(sql(env, `SELECT notes FROM public.members WHERE id = ${lit(member(2))}`)).toBe("Conferido após restaurar");
    expect(sql(env, `SELECT count(*) FROM public.members WHERE name = ${lit(who("Dora Reis"))}`)).toBe("1");
  });
});

test.describe("RN-18 / UX-33 (LE e CM)", () => {
  test("Dado Bruno excluído, quando LE cadastra com o e-mail dele, então o erro fica embaixo do campo E-mail, com o foco, sem diálogo e sem o nome de Bruno", async ({ page }) => {
    const replies = trackFunction(page);
    await login(page, LE);
    const novo = who("Novo LE Email Bruno");
    const dialog = await fillNewMember(page, { name: novo, email: BRUNO.email });
    await submit(dialog);

    const message = "Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.";
    await expect(dialog.locator("#email-error")).toHaveText(message);
    const email = dialog.getByLabel("E-mail");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAttribute("aria-describedby", "email-error");
    await expect(email).toBeFocused();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("Bruno Almeida")).toHaveCount(0);
    expect((await page.content()).includes("Bruno Almeida"), "o nome do excluído não está no DOM").toBe(false);
    expect(replies.map((r) => r.status)).toEqual([409]);
    expect(replies[0].text, "nem na resposta do servidor").not.toContain("Bruno Almeida");
    expect(membersNamed(novo)).toBe(0);
    await expect(dialog.getByLabel("Nome *")).toHaveValue(novo);

    // Trocar o e-mail limpa o erro e o cadastro segue.
    const outro = "novo-le.qa5-cad@teste.invalid";
    await email.fill(outro);
    await expect(dialog.locator("#email-error")).toHaveCount(0);
    await submit(dialog);
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    expect(membersNamed(novo)).toBe(1);
  });

  test("Dado Eva excluída com o celular, quando CM cadastra, então o aviso não nomeia ninguém (nem o DOM, nem a resposta), com Cadastrar mesmo assim e Voltar ao formulário", async ({ page }) => {
    const replies = trackFunction(page);
    await login(page, CM);
    const novo = who("Novo CM Celular Eva");
    const dialog = await fillNewMember(page, { name: novo, mobile: EVA_MOBILE });
    await submit(dialog);

    const aviso = warning(page);
    await expect(aviso.getByRole("heading", { name: "Há um cadastro excluído com este celular" })).toBeVisible();
    await expect(aviso).toContainText("Se for a mesma pessoa, peça a um administrador para restaurá-lo. Se for outra pessoa, você pode cadastrar mesmo assim.");
    await expect(aviso.getByRole("button", { name: "Cadastrar mesmo assim" })).toBeVisible();
    await expect(aviso.getByRole("button", { name: "Voltar ao formulário", exact: true })).toBeFocused();
    await expect(aviso.getByRole("button", { name: /^Restaurar/ })).toHaveCount(0);
    await expect(aviso.getByTestId("deleted-matches-restorable")).toHaveCount(0);
    expect((await page.content()).includes("Eva Prado"), "o nome do excluído não está no DOM").toBe(false);
    expect(replies.map((r) => r.status)).toEqual([409]);
    expect(replies[0].text, "nem na resposta do servidor").not.toContain("Eva Prado");
    expect(replies[0].text).not.toContain(member(3));

    // Voltar ao formulário mantém o que foi digitado.
    await aviso.getByRole("button", { name: "Voltar ao formulário", exact: true }).click();
    await expect(aviso).toBeHidden();
    await expect(dialog.getByLabel("Nome *")).toHaveValue(novo);
    await expect(dialog.getByLabel("Celular / WhatsApp")).toHaveValue("(51)97777-0502");
    expect(membersNamed(novo)).toBe(0);
  });

  test("O mesmo vale para o CPF: Iara excluída, CM cadastra com o CPF dela, e o aviso fala do CPF, sem nome", async ({ page }) => {
    await login(page, CM);
    const dialog = await fillNewMember(page, { name: who("Novo CM Cpf Iara"), cpf: IARA_CPF });
    await submit(dialog);
    const aviso = warning(page);
    await expect(aviso.getByRole("heading", { name: "Há um cadastro excluído com este CPF" })).toBeVisible();
    await expect(aviso.getByRole("button", { name: "Cadastrar mesmo assim" })).toBeVisible();
    expect((await page.content()).includes("Iara Neves"), "o nome do excluído não está no DOM").toBe(false);
  });

  test("UX-33 (CM) no celular (360×800): o e-mail da conta vira erro no campo, e o aviso do celular cabe na tela", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, CM);
    const dialog = await fillNewMember(page, { name: who("Novo CM Estreito"), email: BRUNO.email });
    await submit(dialog);
    await expect(dialog.locator("#email-error")).toBeVisible();
    await expect(dialog.getByLabel("E-mail")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "sem rolagem lateral").toBeLessThanOrEqual(360);

    await dialog.getByLabel("E-mail").fill("");
    await dialog.getByLabel("Celular / WhatsApp").fill(EVA_MOBILE);
    await submit(dialog);
    const aviso = warning(page);
    await expect(aviso).toBeVisible();
    await expectDialogFitsSmallScreen(page, aviso, ["Cadastrar mesmo assim", "Voltar ao formulário"], "UX-33 (360×800)");
    await expectTouchTargets(aviso, "UX-33 (360×800)");
  });
});

test.describe("RN-18 / UX-34: cadastrar mesmo assim", () => {
  test("Dado o celular de Marta excluída, quando CM escolhe Cadastrar mesmo assim, então o cadastro é criado com um toque, sem nova pergunta, e o toast é o de sempre", async ({ page }) => {
    const replies = trackFunction(page);
    await login(page, CM);
    const novo = who("Novo CM Mesmo Assim");
    const dialog = await fillNewMember(page, { name: novo, mobile: MARTA_MOBILE });
    await submit(dialog);

    const aviso = warning(page);
    await expect(aviso).toBeVisible();
    expect(membersNamed(novo)).toBe(0);
    await aviso.getByRole("button", { name: "Cadastrar mesmo assim" }).click();

    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Novo membro" })).toBeHidden();
    await expect.poll(() => replies.map((r) => r.status)).toEqual([409, 200]);
    expect(membersNamed(novo)).toBe(1);
    expect(isDeleted(member(7)), "Marta continua excluída").toBe("true");
  });

  test("Dado o celular de Marta excluída, quando CM só digita o celular e passa para o próximo campo, então nenhum aviso aparece e nada vai ao servidor (a conferência é ao salvar)", async ({ page }) => {
    const replies = trackFunction(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(decodeURIComponent(request.url())));
    await login(page, CM);
    const dialog = await fillNewMember(page, { name: who("Novo CM Sem Salvar"), mobile: MARTA_MOBILE });
    await dialog.getByLabel("Telefone").focus();
    await page.waitForTimeout(500);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(replies).toHaveLength(0);
    // O login em si (a função sign-in, E1.04) não conta: o que não pode haver é a conferência de excluídos.
    expect(
      requests.filter(
        (url) => url.includes("find_deleted_member_matches") || (url.includes("/functions/v1/") && !url.includes("/functions/v1/sign-in")),
      ),
    ).toEqual([]);
  });
});
