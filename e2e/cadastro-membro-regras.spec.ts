import { test, expect, type Page } from "@playwright/test";
import {
  authIdOf,
  deleteAuthUser,
  e2eEnv,
  lit,
  login,
  openList,
  sql,
  toast,
  type E2EEnv,
} from "./exclusao-support";

// Smoke do cadastro e da edição de membro pela tela atual, com as regras do E2.04 (PR 2) no banco e a
// `create-user-admin` nova: cadastro só com celular (sem e-mail fictício no DOM), CPF em uso com a
// mensagem amigável, edição que repete o celular de outro cadastro (nunca "duplicate key") e o login
// pela `sign-in` com o celular de quem acabou de ser cadastrado.
//
// Precisa do Supabase local com `sign-in` e `create-user-admin` servidas e do `npm run dev`; as
// variáveis são as de e2e/exclusao-support.ts. Massa fictícia "QA5 Reg …" (ids e2e204a0-…), apagada
// no fim (e no começo, se uma execução anterior parou no meio). Rode com `--workers=1`.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e204a0";
const NAME = "QA5 Reg";
const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;
const who = (name: string) => `${NAME} ${name}`;

const CAIO = { name: who("Caio Souza"), mobile: "(51) 98888-7701", cpf: "390.533.447-05" };
const DORA = { name: who("Dora Reis"), mobile: "(51) 98888-7702" };

let env: E2EEnv;
const createdIds: string[] = [];

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR entity_label LIKE '${NAME}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%';
     COMMIT;`,
  );
}

async function removeCreatedAccounts() {
  const ids = sql(env, `SELECT id FROM public.members WHERE name LIKE '${NAME}%' AND auth_user_id = id`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

test.beforeAll(async () => {
  env = e2eEnv();
  await removeCreatedAccounts();
  cleanup();
  // Dois cadastros prontos (pastores, para não depender de líder): Caio (celular e CPF) e Dora.
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, is_active, mobile_whatsapp, cpf, role_id) VALUES
       (${lit(id(1))}, ${lit(CAIO.name)}, 'M', true, false, true, ${lit(CAIO.mobile)}, ${lit(CAIO.cpf)}, (SELECT id FROM public.roles WHERE name = 'Membro')),
       (${lit(id(2))}, ${lit(DORA.name)}, 'F', true, false, true, ${lit(DORA.mobile)}, NULL, (SELECT id FROM public.roles WHERE name = 'Membro'));`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  await removeCreatedAccounts();
  cleanup();
  for (const userId of createdIds) await deleteAuthUser(env, userId);
  expect(sql(env, `SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%'`), "limpeza").toBe("0");
});

/** Abre "Novo membro" e preenche o mínimo: nome, gênero e "É Pastor(a)?" (para não depender de líder). */
async function openNewMember(page: Page, name: string) {
  await openList(page, "/members", NAME);
  await page.getByRole("button", { name: "Novo membro", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo membro" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nome *").fill(name);
  await dialog.getByRole("radio", { name: "Feminino" }).click();
  await dialog.getByRole("switch", { name: "É Pastor(a)?" }).click();
  return dialog;
}

test.describe("E2.04 PR 2: cadastro e edição de membro pela tela atual", () => {
  test("RN-05: cadastrar só com o celular termina com sucesso e sem e-mail fictício na tela", async ({ page }) => {
    await login(page, env.admin);
    const name = who("Lúcia Só Celular");
    const dialog = await openNewMember(page, name);
    await dialog.getByLabel("Celular / WhatsApp").fill("51988887703");
    await dialog.getByRole("button", { name: "Criar membro", exact: true }).click();

    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    await expect(dialog).toBeHidden();
    // O cadastro guarda e-mail nulo; a conta usa o e-mail técnico, que nunca aparece.
    const row = sql(env, `SELECT concat_ws('|', coalesce(email, '<nulo>'), mobile_whatsapp, (auth_user_id = id)::text) FROM public.members WHERE name = ${lit(name)}`);
    expect(row).toBe("<nulo>|51988887703|true");
    await openList(page, "/members", name);
    await expect(page.getByText(name).first()).toBeVisible();
    expect(await page.content(), "nenhum e-mail fictício no DOM").not.toContain("mci12fakemail");
    // Abrir o cadastro também não mostra e-mail nenhum (nem o fictício).
    await page.getByRole("button", { name: `Editar ${name}`, exact: true }).first().click();
    const edit = page.getByRole("dialog", { name: "Editar Membro" });
    await expect(edit.getByLabel("E-mail")).toHaveValue("");
    expect(await page.content()).not.toContain("mci12fakemail");
  });

  test("RN-09/RN-10: cadastrar com o CPF de outro cadastro mostra a mensagem amigável, sem texto técnico, e nada é criado", async ({ page }) => {
    await login(page, env.admin);
    const name = who("Eva Cpf Repetido");
    const dialog = await openNewMember(page, name);
    await dialog.getByLabel("Celular / WhatsApp").fill("51988887704");
    await dialog.getByLabel("CPF").fill("39053344705");
    await dialog.getByRole("button", { name: "Criar membro", exact: true }).click();

    await expect(dialog.getByText("Este CPF já está sendo usado por outro cadastro.").first()).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/duplicate key|23505|violates unique/i);
    expect(await dialog.textContent(), "a mensagem não diz de quem é o CPF").not.toContain("Caio");
    await expect(dialog, "o diálogo continua aberto, com o que foi digitado").toBeVisible();
    await expect(dialog.getByLabel("Nome *")).toHaveValue(name);
    expect(sql(env, `SELECT count(*) FROM public.members WHERE name = ${lit(name)}`)).toBe("0");
  });

  test("RN-09: editar Dora com o celular de Caio mostra 'Este celular já está sendo usado por outro cadastro.' (nunca duplicate key)", async ({ page }) => {
    await login(page, env.admin);
    await openList(page, "/members", DORA.name);
    await page.getByRole("button", { name: `Editar ${DORA.name}`, exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Editar Membro" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Celular / WhatsApp").fill("(51) 8888-7701"); // o celular de Caio, sem o 9
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();

    await expect(dialog.getByText("Este celular já está sendo usado por outro cadastro.").first()).toBeVisible();
    expect(await page.content()).not.toMatch(/duplicate key|23505|violates unique/i);
    expect(sql(env, `SELECT mobile_whatsapp FROM public.members WHERE id = ${lit(id(2))}`), "o celular de Dora não mudou").toBe("51988887702");
  });

  test("RN-05, RN-09: a conta criada pela tela entra pela sign-in com o celular, e o login continua funcionando", async ({ page }) => {
    await login(page, env.admin);
    const name = who("Ana Login Celular");
    const dialog = await openNewMember(page, name);
    await dialog.getByLabel("Celular / WhatsApp").fill("51988887705");
    await dialog.getByLabel("Senha para Acesso").fill("QaReg#2026");
    await dialog.getByRole("button", { name: "Criar membro", exact: true }).click();
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();
    createdIds.push(authIdOf(env, `${sql(env, `SELECT id FROM public.members WHERE name = ${lit(name)}`)}@mci12fakemail.com`));

    sql(env, "DELETE FROM private.sign_in_throttle;");
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await login(page, { email: "51988887705", password: "QaReg#2026" });
    await expect(page).toHaveURL(/\/$/);
  });
});
