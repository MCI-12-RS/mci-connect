import { expect, type Locator, type Page } from "@playwright/test";
import { deleteAuthUser, lit, openList, sql, type E2EEnv } from "./exclusao-support";

// Apoio dos testes do formulário de membro (E2.04, PR 3): a massa fictícia ("QA6 Val …", ids
// e2e204b0-…), a abertura do formulário e as medidas de tela. Só roda na stack local (ver
// e2e/exclusao-support.ts para as variáveis).

export const PREFIX = "e2e204b0";
export const NAME = "QA6 Val";
export const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;
export const who = (name: string) => `${NAME} ${name}`;

/** Quem é quem na massa: Pedro (pastor) lidera André e Diego; André lidera Caio e Fábio; Caio lidera Davi. */
export const M = {
  pedro: { n: 1, name: who("Pedro Alves"), mobile: "51988886001", email: "pedro.qa6@example.com" },
  andre: { n: 2, name: who("André Souza"), mobile: "51988886002" },
  caio: { n: 3, name: who("Caio Lima"), mobile: "51988886003", email: "caio.qa6@example.com" },
  davi: { n: 4, name: who("Davi Reis"), mobile: "51988886004" },
  diego: { n: 5, name: who("Diego Prado"), mobile: "51988886005", cpf: "52998224725" },
  samuel: { n: 7, name: who("Samuel Dias"), mobile: "51988886007" },
  /** Para o UX-11: tem celular e e-mail, e o teste apaga um e depois o outro. */
  elisa: { n: 9, name: who("Elisa Matos"), mobile: "51988886009", email: "elisa.qa6@example.com" },
  /** Para o UX-16: discípulo de Pedro que vira pastor. */
  hugo: { n: 10, name: who("Hugo Neves"), mobile: "51988886010" },
  /** Para o UX-17: discípula de Pedro, batizada em 10/05/2020. */
  iara: { n: 11, name: who("Iara Campos"), mobile: "51988886011" },
  /** Excluído: só o CPF dele importa (UX-14). */
  lucia: { n: 8, name: who("Lúcia Excluída"), cpf: "11144477735" },
} as const;
/** Fábio vem do legado: uma palavra só, inativo, nascido em 1920, celular sem DDD (RN-17). */
export const FABIO = { n: 6, name: "Fábio" };

/** O sufixo de cada celular ou CPF digitado nos testes, para não repetir dado entre testes. */
export const FREE_CPF = "39053344705";
/** Celulares livres para os cadastros novos dos testes (nenhum da massa os usa). */
export const free = (n: number) => `5198888${String(7000 + n)}`;

export function cleanup(env: E2EEnv) {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR entity_label LIKE '${NAME}%' OR entity_label = ${lit(FABIO.name)};
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%';
     COMMIT;`,
  );
}

export async function removeCreatedAccounts(env: E2EEnv) {
  const ids = sql(env, `SELECT auth_user_id FROM public.members WHERE name LIKE '${NAME}%' AND auth_user_id IS NOT NULL`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

/** Cria a massa. Lúcia é excluída (o CPF dela é "dado de excluído"). */
export function seed(env: E2EEnv) {
  const roleId = `(SELECT id FROM public.roles WHERE name = 'Membro')`;
  const row = (m: { n: number; name: string }, extra: { gender?: string; leader?: number; pastor?: boolean; active?: boolean; mobile?: string; email?: string; cpf?: string }) =>
    `(${lit(id(m.n))}, ${lit(m.name)}, ${lit(extra.gender ?? "M")}, ${extra.pastor ? "true" : "false"}, ${extra.leader ? "true" : "false"}, ${
      extra.leader ? lit(id(extra.leader)) : "NULL"
    }, ${extra.active === false ? "false" : "true"}, ${extra.mobile ? lit(extra.mobile) : "NULL"}, ${extra.email ? lit(extra.email) : "NULL"}, ${
      extra.cpf ? lit(extra.cpf) : "NULL"
    }, ${roleId})`;
  const insert = (rows: string[]) =>
    sql(
      env,
      `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, email, cpf, role_id) VALUES ${rows.join(",\n")};`,
    );
  insert([
    row(M.pedro, { pastor: true, mobile: M.pedro.mobile, email: M.pedro.email }),
    row(M.samuel, { pastor: true, mobile: M.samuel.mobile }),
  ]);
  insert([
    row(M.andre, { leader: M.pedro.n, mobile: M.andre.mobile }),
    row(M.diego, { leader: M.pedro.n, mobile: M.diego.mobile, cpf: M.diego.cpf }),
    row(M.elisa, { leader: M.pedro.n, mobile: M.elisa.mobile, email: M.elisa.email }),
    row(M.hugo, { leader: M.pedro.n, mobile: M.hugo.mobile }),
    row(M.iara, { leader: M.pedro.n, mobile: M.iara.mobile, gender: "F" }),
  ]);
  sql(env, `UPDATE public.members SET is_baptized = true, baptism_date = '2020-05-10' WHERE id = ${lit(id(M.iara.n))}`);
  insert([row(M.caio, { leader: M.andre.n, mobile: M.caio.mobile, email: M.caio.email })]);
  insert([row(M.davi, { leader: M.caio.n, active: false, mobile: M.davi.mobile })]);
  // Fábio: dado fora da regra, só com os gatilhos desligados (como na carga do legado).
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, birth_date, role_id, g12_level)
     VALUES (${lit(id(FABIO.n))}, ${lit(FABIO.name)}, 'M', false, true, ${lit(id(M.andre.n))}, false, '98887777', '1920-03-10', ${roleId}, 2);
     COMMIT;`,
  );
  insert([row(M.lucia, { cpf: M.lucia.cpf, mobile: undefined })]);
  sql(env, `UPDATE public.members SET deleted_at = now() WHERE id = ${lit(id(M.lucia.n))}`);
}

export const dbValue = (env: E2EEnv, n: number, column: string) =>
  sql(env, `SELECT coalesce(${column}::text, '<nulo>') FROM public.members WHERE id = ${lit(id(n))}`);

/** Abre "Novo membro" (a lista filtrada pela massa) e devolve o diálogo. */
export async function openNew(page: Page) {
  await openList(page, "/members", NAME);
  await page.getByRole("button", { name: "Novo membro", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo membro" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Abre a edição de um cadastro da lista (título "Editar membro"). */
export async function openEdit(page: Page, name: string, search = name) {
  await openList(page, "/members", search);
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Editar membro" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export const createButton = (dialog: Locator) => dialog.getByRole("button", { name: "Criar membro", exact: true });
export const saveButton = (dialog: Locator) => dialog.getByRole("button", { name: "Salvar alterações", exact: true });

/** Escolhe uma opção do seletor de membro (react-select): digita a busca e clica na opção. */
export async function pickMember(page: Page, dialog: Locator, field: "Líder *" | "Cônjuge" | "Líder", name: string) {
  const input = dialog.getByLabel(field, { exact: true });
  await input.click();
  await input.fill(name.split(" ").slice(-1)[0]);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

/** Mede o elemento e confere a altura mínima de 44 px (UX-04, UX-31). */
export async function expectMinHeight(locator: Locator, label: string, min = 43.5) {
  const box = await locator.boundingBox();
  expect(box, `${label}: visível`).not.toBeNull();
  expect(box?.height ?? 0, `${label}: altura`).toBeGreaterThanOrEqual(min);
}

/** As requisições da página ao banco e às funções: método e URL, a partir de agora. */
export function trackApi(page: Page) {
  const calls: Array<{ method: string; url: string; body: string | null }> = [];
  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());
    if (!url.includes("/rest/v1/") && !url.includes("/functions/v1/")) return;
    calls.push({ method: request.method(), url, body: request.postData() });
  });
  return calls;
}

/** O texto das respostas de `create-user-admin`, a partir de agora. */
export function trackCreateReplies(page: Page) {
  const replies: Array<{ status: number; text: string }> = [];
  page.on("response", (response) => {
    if (response.url().includes("/functions/v1/create-user-admin") && response.request().method() === "POST") {
      void response.text().then((text) => replies.push({ status: response.status(), text }));
    }
  });
  return replies;
}
