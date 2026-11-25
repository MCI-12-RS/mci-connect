import { expect, test, type Locator, type Page } from "@playwright/test";
import { accessToken, createAuthUser, deleteAuthUser, e2eEnv, lit, openList, sql, toast, type E2EEnv } from "./exclusao-support";

// Membros por escopo e por função (E2.02, PR 4, tarefa 14): UX-15 (Membros),
// UX-16, UX-17, UX-19, UX-20 (só Líder e Cônjuge), UX-21 e UX-22 pela tela, e
// RN-09, 10, 11, 18 e 19 com a massa do spec. Login de verdade pela `sign-in`
// e `create-user-admin` servidas na stack local. A massa é fictícia
// ("QA Escopo …", ids e2e202c4-…) e some no fim; o que um teste muda (função
// padrão, função de Pedro, cônjuge e líder de Ester) volta no `finally`.
// Rodar com `--workers=1`: a `sign_in_throttle` é por origem (127.0.0.1).

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e202c4";
const NAME = "QA Escopo";
const PASSWORD = "QaEscopo#2026";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;
const person = (n: number) => id(1, n);
/** Celular único por cadastro da massa: todo cadastro novo precisa de um identificador (E2.04, RN-08). */
const mobileOf = (n: number) => `5193206${String(n).padStart(4, "0")}`;
const ROLE_SECRETARIA = id(2, 1);
const ROLE_COORDENACAO = id(2, 2);

interface Who {
  n: number;
  name: string;
  gender: "M" | "F";
  /** Líder (número da pessoa) ou `null`. */
  leader: number | null;
  role: "ADMIN" | "LIDER" | "MEMBRO" | null;
  pastor?: boolean;
  inactive?: boolean;
  /** Tem conta de acesso: o e-mail de login. */
  login?: boolean;
}

const who = (n: number, name: string, gender: "M" | "F", leader: number | null, role: Who["role"], extra: Partial<Who> = {}): Who => ({
  n,
  name: `${NAME} ${name}`,
  gender,
  leader,
  role,
  ...extra,
});

// n: 1 Samuel, 2 Magda, 3 Pedro, 4 Paula, 5 Tiago, 6 Tânia, 7 André, 8 Beatriz, 9 Caio, 10 Fábio,
// 11 Carla, 12 Débora, 13 Diego, 14 Hugo, 15 Rita, 16 Ester, 17 Lúcia, 18 Nuno (Administrador, discípulo de André).
const SAMUEL = who(1, "Samuel Luz", "M", null, "LIDER", { pastor: true, login: true });
const MAGDA = who(2, "Magda Luz", "F", null, "LIDER", { pastor: true });
const PEDRO = who(3, "Pedro Dias", "M", 1, "LIDER", { login: true });
const PAULA = who(4, "Paula Dias", "F", 2, "LIDER");
const TIAGO = who(5, "Tiago Melo", "M", 1, "MEMBRO");
const TANIA = who(6, "Tânia Melo", "F", 2, "MEMBRO");
const ANDRE = who(7, "André Souza", "M", 3, "LIDER", { login: true });
const BEATRIZ = who(8, "Beatriz Souza", "F", 6, "MEMBRO");
const CAIO = who(9, "Caio Lima", "M", 7, "MEMBRO", { login: true });
const FABIO = who(10, "Fábio Lima", "M", 7, "MEMBRO", { inactive: true });
const CARLA = who(11, "Carla Reis", "F", 4, "MEMBRO");
const DEBORA = who(12, "Débora Reis", "F", 8, "MEMBRO");
const DIEGO = who(13, "Diego Melo", "M", 5, "LIDER", { login: true });
const HUGO = who(14, "Hugo Melo", "M", 5, null);
const RITA = who(15, "Rita Souza", "F", 6, "ADMIN", { login: true });
const ESTER = who(16, "Ester Prado", "F", null, "MEMBRO");
const LUCIA = who(17, "Lúcia Prado", "F", 16, "MEMBRO");
const NUNO = who(18, "Nuno Admin", "M", 7, "ADMIN");
const PEOPLE = [SAMUEL, MAGDA, PEDRO, PAULA, TIAGO, TANIA, ANDRE, BEATRIZ, CAIO, FABIO, CARLA, DEBORA, DIEGO, HUGO, RITA, ESTER, LUCIA, NUNO];
const COUPLES: Array<[Who, Who]> = [[SAMUEL, MAGDA], [PEDRO, PAULA], [TIAGO, TANIA], [ANDRE, BEATRIZ]];

const emailOf = (w: Who) => `${w.name.split(" ")[2]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.e202c4@teste.invalid`;
const memberId = (w: Who) => person(w.n);

const SECRETARIA_PERMISSIONS = ["view_all_church", "view_own_ministry", "create_member", "edit_member", "edit_own_data", "view_dashboard"];
const COORDENACAO_PERMISSIONS = ["assign_role", "view_own_ministry", "create_member", "edit_member", "edit_own_data", "view_dashboard", "submit_own_cell_report"];

let env: E2EEnv;
let adminRoleId = "";
let leaderRoleId = "";
let memberRoleId = "";
const authIds: Record<string, string> = {};

const roleRef = (role: Who["role"]) =>
  role === "ADMIN" ? lit(adminRoleId) : role === "LIDER" ? lit(leaderRoleId) : role === "MEMBRO" ? lit(memberRoleId) : "NULL";

/** Apaga as contas de acesso dos cadastros da massa (inclusive os criados pelos testes). */
async function removeAccounts() {
  const ids = sql(
    env,
    `SELECT auth_user_id FROM public.members WHERE name LIKE '${NAME}%' AND auth_user_id IS NOT NULL
     UNION SELECT id FROM auth.users WHERE email LIKE '%.e202c4@teste.invalid'`,
  );
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR entity_label LIKE '${NAME}%' OR actor_label LIKE '${NAME}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%';
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     UPDATE public.roles SET is_default = false WHERE is_default;
     UPDATE public.roles SET is_default = true WHERE name = 'Membro' AND NOT is_system;
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

const setDefaultRole = (role: string) =>
  sql(env, `BEGIN; UPDATE public.roles SET is_default = false WHERE is_default; UPDATE public.roles SET is_default = true WHERE id = ${lit(role)}; COMMIT;`);
const restoreDefaultRole = () =>
  sql(env, `BEGIN; UPDATE public.roles SET is_default = false WHERE is_default; UPDATE public.roles SET is_default = true WHERE name = 'Membro' AND NOT is_system; COMMIT;`);
const setRoleOf = (w: Who, role: string) => sql(env, `UPDATE public.members SET role_id = ${lit(role)} WHERE id = ${lit(memberId(w))};`);
const column = (w: Who, expression: string) => sql(env, `SELECT coalesce((${expression})::text, '') FROM public.members WHERE id = ${lit(memberId(w))}`);

test.beforeAll(async () => {
  env = e2eEnv();
  await removeAccounts();
  cleanup();
  adminRoleId = sql(env, "SELECT id FROM public.roles WHERE is_system AND name = 'Administrador'");
  leaderRoleId = sql(env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Líder'");
  memberRoleId = sql(env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Membro'");
  for (const w of PEOPLE.filter((p) => p.login)) authIds[w.name] = await createAuthUser(env, emailOf(w), PASSWORD);

  const row = (w: Who) =>
    `(${lit(memberId(w))}, ${lit(w.name)}, ${lit(w.gender)}, ${!!w.pastor}, ${w.leader !== null}, ${w.leader === null ? "NULL" : lit(person(w.leader))}, ${!w.inactive}, ` +
    `${w.login ? lit(authIds[w.name]!) : "NULL"}, ${roleRef(w.role)}, ${w.login ? lit(emailOf(w)) : "NULL"}, ${lit(mobileOf(w.n))})`;
  const tier = (members: Who[]) =>
    `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, auth_user_id, role_id, email, mobile_whatsapp)
     VALUES ${members.map(row).join(",\n            ")};`;
  const byLeader = (leaders: Array<number | null>) => PEOPLE.filter((p) => leaders.includes(p.leader));
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES (${lit(ROLE_SECRETARIA)}, 'QA Escopo Secretaria'), (${lit(ROLE_COORDENACAO)}, 'QA Escopo Coordenação');
     INSERT INTO public.role_permissions (role_id, permission)
       SELECT ${lit(ROLE_SECRETARIA)}::uuid, p::public.permission_action FROM unnest(ARRAY[${SECRETARIA_PERMISSIONS.map(lit).join(", ")}]::text[]) p;
     INSERT INTO public.role_permissions (role_id, permission)
       SELECT ${lit(ROLE_COORDENACAO)}::uuid, p::public.permission_action FROM unnest(ARRAY[${COORDENACAO_PERMISSIONS.map(lit).join(", ")}]::text[]) p;
     ${tier(byLeader([null]))}
     ${tier(byLeader([1, 2, 16]))}
     ${tier(byLeader([3, 5, 6]))}
     ${tier(byLeader([4, 7, 8]))}
     ${COUPLES.map(([a, b]) => `UPDATE public.members SET spouse_id = ${lit(memberId(b))} WHERE id = ${lit(memberId(a))};`).join("\n     ")}
     COMMIT;`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  restoreDefaultRole();
  await removeAccounts();
  cleanup();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e202c4@teste.invalid')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.beforeEach(() => {
  sql(env, "DELETE FROM private.sign_in_throttle;");
});

async function signIn(page: Page, w: Who) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(emailOf(w));
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
}

interface Reply {
  status: number;
  /** PostgREST: `{ code, message, hint, details }`; a Edge Function: `{ error, code, field }`. */
  body: Record<string, unknown>;
  text: string;
}

async function reply(response: Awaited<ReturnType<Page["request"]["fetch"]>>): Promise<Reply> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) body = Object.fromEntries(Object.entries(parsed));
    else body = { value: parsed };
  } catch {
    // corpo que não é JSON
  }
  return { status: response.status(), body, text };
}

/** PATCH em `members`, como a sessão da página (pela API, fora da tela). `rows` é o que o RETURNING devolveu. */
async function patchMember(page: Page, w: Who, data: object): Promise<Reply & { rows: unknown[] }> {
  const token = await accessToken(page);
  const response = await page.request.fetch(`${env.apiUrl}/rest/v1/members?id=eq.${memberId(w)}&select=id`, {
    method: "PATCH",
    headers: {
      apikey: env.publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    data,
  });
  const result = await reply(response);
  const rows: unknown[] = Array.isArray(JSON.parse(result.text || "null")) ? JSON.parse(result.text) : [];
  return { ...result, rows };
}

/** A Edge Function `create-user-admin`, como a sessão da página. */
async function createMember(page: Page, email: string, memberData: object): Promise<Reply> {
  const token = await accessToken(page);
  const response = await page.request.post(`${env.apiUrl}/functions/v1/create-user-admin`, {
    headers: { apikey: env.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // Contrato do E2.04: o e-mail real vai em `memberData.email`; todo cadastro tem um identificador (RN-08).
    data: { password: "Senha#2026", memberData: { gender: "M", is_active: true, email, mobile_whatsapp: `5193209${String(Date.now()).slice(-4)}`, ...memberData } },
  });
  return reply(response);
}

async function rpc(page: Page, fn: string, args: object): Promise<Reply> {
  const token = await accessToken(page);
  const response = await page.request.post(`${env.apiUrl}/rest/v1/rpc/${fn}`, {
    headers: { apikey: env.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: args,
  });
  return reply(response);
}

const message = (r: Reply) => (typeof r.body.message === "string" ? r.body.message : typeof r.body.error === "string" ? r.body.error : "");
const accountsWith = (email: string) => Number(sql(env, `SELECT count(*) FROM auth.users WHERE email = ${lit(email)}`));
const membersNamed = (name: string) => Number(sql(env, `SELECT count(*) FROM public.members WHERE name = ${lit(name)}`));

const MSG = {
  cannotChoose: "Você só pode escolher pessoas que você vê.",
  wouldLeaveMember: "Com esta alteração, você deixaria de ver este cadastro. As alterações não foram salvas.",
  pastorOrNoLeadership: "Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.",
  defaultRoleNotCovered: "A função padrão tem permissões que você não tem. Peça a um administrador para fazer este cadastro.",
  ownRole: "Ninguém pode alterar a própria função.",
  roleChangeNotAllowed: "Você não tem permissão para alterar a função deste membro.",
  roleNotAssignable: "Você não tem permissão para atribuir esta função.",
  notFound: "Este cadastro não existe ou já foi excluído.",
  ownDataOnly: "Você só pode alterar os seus dados pessoais. Não é permitido alterar:",
};

async function openEdit(page: Page, w: Who): Promise<Locator> {
  await openList(page, "/members", w.name);
  await page.getByRole("button", { name: `Editar ${w.name}` }).first().click();
  const dialog = page.getByRole("dialog", { name: "Editar Membro" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openNew(page: Page): Promise<Locator> {
  await openList(page, "/members", NAME);
  await page.getByRole("button", { name: "Novo membro" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo membro" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Escolhe uma pessoa num seletor de membro (`#leader` ou `#spouse`). */
async function pickPerson(page: Page, dialog: Locator, field: "leader" | "spouse", search: string, optionName: string) {
  const input = dialog.locator(`#${field}`);
  await input.click();
  await input.fill(search);
  await page.getByRole("option", { name: optionName }).click();
}

/** Os nomes que um seletor de membro oferece para a busca (só as opções de pessoa). */
async function optionsFor(page: Page, dialog: Locator, field: "leader" | "spouse", search: string): Promise<string[]> {
  const input = dialog.locator(`#${field}`);
  await input.click();
  await input.fill(search);
  const listbox = page.getByRole("listbox");
  await expect(listbox.getByRole("option").first()).toBeVisible();
  await expect(listbox.getByText("Carregando…")).toHaveCount(0);
  const names = await listbox.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  return names.filter((n) => n.startsWith(NAME));
}

const visibleNames = (list: Who[]) => list.map((w) => w.name).sort();

/** Quais pessoas da massa a lista mostra (a linha traz o nome seguido de outros dados). */
async function listedNames(page: Page): Promise<string[]> {
  await expect(page.getByText("Carregando...")).toHaveCount(0);
  // Só a coluna do nome: as outras linhas citam o líder ("Líder: Samuel").
  const cells = await page.locator("tbody tr td:nth-child(2)").allTextContents();
  return PEOPLE.map((w) => w.name).filter((name) => cells.some((text) => text.includes(name))).sort();
}

test.describe("Lista de Membros e seletores por escopo (UX-15, UX-20)", () => {
  test("UX-15: o subtítulo diz o alcance, e a lista de Pedro traz só o ministério dele (nunca Samuel, Beatriz, Diego nem Débora)", async ({ page }) => {
    await signIn(page, PEDRO);
    await openList(page, "/members", NAME);
    await expect(page.getByText("Membros do seu ministério")).toBeVisible();
    expect(await listedNames(page)).toEqual(visibleNames([PEDRO, PAULA, ANDRE, CAIO, FABIO, CARLA, NUNO]));
  });

  test("UX-15: o de Rita (Administrador) diz 'toda a igreja' e a lista traz a massa toda", async ({ page }) => {
    await signIn(page, RITA);
    await openList(page, "/members", NAME);
    await expect(page.getByText("Membros de toda a igreja")).toBeVisible();
    await expect(page.getByText("Membros do seu ministério")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo membro" })).toBeVisible();
  });

  test("UX-20: os seletores de Líder e de Cônjuge de Pedro só oferecem quem ele vê; sem resultado, 'Nenhum membro do seu ministério encontrado.'", async ({ page }) => {
    await signIn(page, PEDRO);
    const dialog = await openEdit(page, CAIO);
    const expectedForCaio = visibleNames([PEDRO, PAULA, ANDRE, FABIO, CARLA, NUNO]);
    expect(await optionsFor(page, dialog, "leader", NAME)).toEqual(expect.arrayContaining(expectedForCaio));
    expect((await optionsFor(page, dialog, "leader", NAME)).sort()).toEqual(expectedForCaio);
    expect((await optionsFor(page, dialog, "spouse", NAME)).sort()).toEqual(expectedForCaio);
    // Quem ele não vê não aparece nem pela busca do nome inteiro: o servidor não devolve.
    const input = dialog.locator("#leader");
    await input.click();
    for (const hidden of [SAMUEL, BEATRIZ, DIEGO, DEBORA]) {
      await input.fill(hidden.name);
      await expect(page.getByText("Nenhum membro do seu ministério encontrado.", { exact: true })).toBeVisible();
      await expect(page.getByRole("option", { name: hidden.name })).toHaveCount(0);
    }
  });

  test("UX-20: o líder salvo fora do ministério (Samuel, no cadastro de Pedro) aparece pelo nome e continua depois de salvar outro campo", async ({ page }) => {
    await signIn(page, PEDRO);
    const dialog = await openEdit(page, PEDRO);
    await expect(dialog.getByText(SAMUEL.name)).toBeVisible();
    await dialog.getByLabel("Observações").fill("Observação do próprio Pedro");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(column(PEDRO, "leader_id")).toBe(memberId(SAMUEL));
    expect(column(PEDRO, "notes")).toBe("Observação do próprio Pedro");
  });
});

test.describe("RN-10, RN-19, UX-17: cadastro novo por quem vê só o ministério (Pedro)", () => {
  test("UX-17: sem 'É Pastor(a)?' nem 'Tem Liderança?'; 'Líder *' vem com Pedro, com a dica ligada; sem líder, 'Escolha o líder.' com o foco e nada vai ao servidor", async ({ page }) => {
    await signIn(page, PEDRO);
    const dialog = await openNew(page);
    await expect(dialog.getByRole("switch", { name: "É Pastor(a)?" })).toHaveCount(0);
    await expect(dialog.getByRole("switch", { name: "Tem Liderança?" })).toHaveCount(0);
    await expect(dialog.getByText("Líder *")).toBeVisible();
    await expect(dialog.getByText(PEDRO.name)).toBeVisible();
    const hint = "O líder é obrigatório e é escolhido entre as pessoas do seu ministério.";
    await expect(dialog.getByText(hint)).toBeVisible();
    await expect(dialog.locator("#leader")).toHaveAttribute("aria-describedby", /leader-hint/);

    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/functions/v1/create-user-admin")) calls.push(request.url());
    });
    await dialog.getByLabel("Nome *").fill(`${NAME} Igor Sem Lider`);
    // E2.04: o sexo e um identificador são conferidos antes do líder (ordem da tela); só o Líder fica com erro.
    await dialog.getByRole("radio", { name: "Masculino" }).click();
    await dialog.getByLabel("Celular / WhatsApp").fill("51932090099");
    await dialog.getByRole("button", { name: "Limpar seleção" }).click();
    await dialog.getByRole("button", { name: /^Criar membro$/i }).click();
    await expect(dialog.getByText("Escolha o líder.")).toBeVisible();
    await expect(dialog.locator("#leader")).toBeFocused();
    expect(calls).toEqual([]);
    expect(membersNamed(`${NAME} Igor Sem Lider`)).toBe(0);
  });

  test("RN-10 e RN-19: Pedro cadastra Igor com André como líder e sem escolher função: aceito, Igor aparece para Pedro e fica com a função Membro", async ({ page }) => {
    await signIn(page, PEDRO);
    const dialog = await openNew(page);
    // UX-21: Pedro, cadastrando, vê a função como texto, com a dica.
    await expect(dialog.getByText("Membro (padrão)")).toBeVisible();
    await expect(dialog.getByText("Novos membros recebem a função padrão.")).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: /Função/ })).toHaveCount(0);
    expect(await dialog.locator("input:disabled").count()).toBe(0);

    await dialog.getByLabel("Nome *").fill(`${NAME} Igor Teixeira`);
    // E2.04 (RN-03, RN-08): o sexo e um identificador (aqui o celular) são obrigatórios.
    await dialog.getByRole("radio", { name: "Masculino" }).click();
    await dialog.getByLabel("Celular / WhatsApp").fill("51932090001");
    await pickPerson(page, dialog, "leader", "André", ANDRE.name);
    await dialog.getByRole("button", { name: /^Criar membro$/i }).click();
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();

    await openList(page, "/members", `${NAME} Igor Teixeira`);
    await expect(page.getByRole("row", { name: new RegExp(`${NAME} Igor Teixeira`) })).toBeVisible();
    expect(sql(env, `SELECT r.name FROM public.members m JOIN public.roles r ON r.id = m.role_id WHERE m.name = ${lit(`${NAME} Igor Teixeira`)}`)).toBe("Membro");
    expect(sql(env, `SELECT leader_id FROM public.members WHERE name = ${lit(`${NAME} Igor Teixeira`)}`)).toBe(memberId(ANDRE));
  });

  test("RN-09 d: pela API, Pedro cadastra Igor com Diego como líder: recusado, e nenhuma conta de acesso fica criada", async ({ page }) => {
    await signIn(page, PEDRO);
    const email = "igor.diego.e202c4@teste.invalid";
    const result = await createMember(page, email, { name: `${NAME} Igor Diego`, leader_id: memberId(DIEGO), has_leadership: true });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(message(result)).toBe(MSG.cannotChoose);
    expect(accountsWith(email)).toBe(0);
    expect(membersNamed(`${NAME} Igor Diego`)).toBe(0);
  });
});

test.describe("RN-19, UX-16: função padrão acima de quem cadastra", () => {
  test("com a Membro como padrão, o 'Novo membro' de Pedro abre o formulário", async ({ page }) => {
    await signIn(page, PEDRO);
    const dialog = await openNew(page);
    await expect(dialog.getByLabel("Nome *")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("com a 'Secretaria' como padrão (vê a igreja toda), o 'Novo membro' de Pedro abre o bloqueio, antes do formulário", async ({ page }) => {
    setDefaultRole(ROLE_SECRETARIA);
    try {
      await signIn(page, PEDRO);
      await openList(page, "/members", NAME);
      await page.getByRole("button", { name: "Novo membro" }).click();
      const blocked = page.getByRole("alertdialog", { name: "Não é possível cadastrar membros" });
      await expect(blocked).toBeVisible();
      await expect(blocked.getByText(MSG.defaultRoleNotCovered)).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Novo membro" })).toHaveCount(0);
      await blocked.getByRole("button", { name: "Fechar" }).click();
      await expect(blocked).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Novo membro" })).toBeFocused();
    } finally {
      restoreDefaultRole();
    }
  });

  test("sem a pré-checagem, o formulário abre e a recusa ao salvar vai ao Alert do topo, com o foco e os dados mantidos", async ({ page }) => {
    setDefaultRole(ROLE_SECRETARIA);
    try {
      // `my_access` sem a pré-checagem (AQ-1): como se o acesso ainda não tivesse chegado.
      await page.route("**/rest/v1/rpc/my_access", async (route) => {
        const response = await route.fetch();
        const json: unknown = await response.json();
        const rows = Array.isArray(json) ? json.map((row: object) => ({ ...row, can_create_member: true })) : json;
        await route.fulfill({ response, json: rows });
      });
      await signIn(page, PEDRO);
      const dialog = await openNew(page);
      await dialog.getByLabel("Nome *").fill(`${NAME} Igor Secretaria`);
      // E2.04: o sexo e um identificador são conferidos na tela; com eles, a recusa do servidor chega ao Alert.
      await dialog.getByRole("radio", { name: "Masculino" }).click();
      await dialog.getByLabel("Celular / WhatsApp").fill("51932090098");
      await dialog.getByRole("button", { name: /^Criar membro$/i }).click();

      const alert = dialog.getByRole("alert").filter({ hasText: MSG.defaultRoleNotCovered });
      await expect(alert).toBeVisible();
      await expect(alert).toBeFocused();
      await expect(dialog.getByLabel("Nome *")).toHaveValue(`${NAME} Igor Secretaria`);
      await expect(toast(page, "Membro criado com sucesso")).toHaveCount(0);
      expect(membersNamed(`${NAME} Igor Secretaria`)).toBe(0);
    } finally {
      restoreDefaultRole();
    }
  });
});

test.describe("RN-10, UX-19: pastor e sem liderança sem ver a igreja toda", () => {
  test("UX-19: Samuel edita Magda: 'Pastor(a)' como texto com o motivo, sem interruptor e sem Líder; salvar a data de nascimento funciona e Magda continua pastora", async ({ page }) => {
    await signIn(page, SAMUEL);
    const dialog = await openEdit(page, MAGDA);
    await expect(dialog.getByText("Pastor(a)", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Só quem vê a igreja toda pode mudar esta marcação.")).toBeVisible();
    await expect(dialog.getByRole("switch", { name: "É Pastor(a)?" })).toHaveCount(0);
    await expect(dialog.getByText("Líder", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("switch", { name: "Tem Liderança?" })).toHaveCount(0);

    await dialog.getByLabel("Data de Nascimento").fill("1970-05-17");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(column(MAGDA, "birth_date")).toBe("1970-05-17");
    expect(column(MAGDA, "is_pastor")).toBe("true");
  });

  test("RN-10: pela API, Samuel desmarca Magda como pastora: recusado, e nada muda", async ({ page }) => {
    await signIn(page, SAMUEL);
    const result = await patchMember(page, MAGDA, { is_pastor: false });
    expect(message(result)).toBe(MSG.pastorOrNoLeadership);
    expect(column(MAGDA, "is_pastor")).toBe("true");
  });

  test("RN-10 e RN-06: Diego, que vê Ester pelo casamento, muda as observações (continua sem liderança); escolhe Rita como líder (deixa de estar sem liderança)", async ({ page }) => {
    sql(env, `UPDATE public.members SET spouse_id = ${lit(memberId(DIEGO))} WHERE id = ${lit(memberId(ESTER))};`);
    try {
      await signIn(page, DIEGO);
      const dialog = await openEdit(page, ESTER);
      await expect(dialog.getByText("Sem liderança", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("switch", { name: "Tem Liderança?" })).toHaveCount(0);
      await dialog.getByLabel("Observações").fill("Observação do Diego");
      await dialog.getByRole("button", { name: "Salvar" }).click();
      await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
      await expect(dialog).toHaveCount(0);
      expect(column(ESTER, "notes")).toBe("Observação do Diego");
      expect(column(ESTER, "leader_id")).toBe("");
      expect(column(ESTER, "has_leadership")).toBe("false");

      const again = await openEdit(page, ESTER);
      await pickPerson(page, again, "leader", "Rita", RITA.name);
      await again.getByRole("button", { name: "Salvar" }).click();
      await expect(again).toHaveCount(0);
      expect(column(ESTER, "leader_id")).toBe(memberId(RITA));
      expect(column(ESTER, "has_leadership")).toBe("true");
    } finally {
      sql(env, `UPDATE public.members SET spouse_id = NULL, leader_id = NULL, has_leadership = false, notes = NULL WHERE id = ${lit(memberId(ESTER))};`);
    }
  });

  test("RN-10: pela API, Diego cadastra Igor sem líder e tira o líder de Hugo: recusado nos dois, nada gravado", async ({ page }) => {
    await signIn(page, DIEGO);
    const email = "igor.semlider.e202c4@teste.invalid";
    const created = await createMember(page, email, { name: `${NAME} Igor Sem Líder API`, has_leadership: false });
    expect(created.status).toBeGreaterThanOrEqual(400);
    expect(message(created)).toBe(MSG.pastorOrNoLeadership);
    expect(accountsWith(email)).toBe(0);
    expect(membersNamed(`${NAME} Igor Sem Líder API`)).toBe(0);

    const removed = await patchMember(page, HUGO, { leader_id: null, has_leadership: false });
    expect(message(removed)).toBe(MSG.pastorOrNoLeadership);
    expect(column(HUGO, "leader_id")).toBe(memberId(TIAGO));
  });

  test("RN-10: Rita cadastra Igor como sem liderança: aceito", async ({ page }) => {
    await signIn(page, RITA);
    const email = "igor.rita.e202c4@teste.invalid";
    const created = await createMember(page, email, { name: `${NAME} Igor Rita`, has_leadership: false });
    expect(created.status).toBe(200);
    expect(membersNamed(`${NAME} Igor Rita`)).toBe(1);
  });

  test("RN-10: Caio (Membro) não vê 'Novo membro', e o cadastro pela API recebe erro de permissão; Pedro não exclui Débora (fora do escopo)", async ({ page, browser }) => {
    await signIn(page, CAIO);
    await openList(page, "/members", NAME);
    await expect(page.getByRole("heading", { level: 1, name: "Membros" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novo membro" })).toHaveCount(0);
    const created = await createMember(page, "igor.caio.e202c4@teste.invalid", { name: `${NAME} Igor Caio`, leader_id: memberId(ANDRE) });
    expect(created.status).toBe(403);
    expect(membersNamed(`${NAME} Igor Caio`)).toBe(0);

    const context = await browser.newContext({ baseURL: "http://localhost:8080" });
    try {
      const pedro = await context.newPage();
      await signIn(pedro, PEDRO);
      const deletion = await rpc(pedro, "delete_member", { _member_id: memberId(DEBORA) });
      expect(message(deletion)).toBe(MSG.notFound);
      expect(column(DEBORA, "deleted_at")).toBe("");
    } finally {
      await context.close();
    }
  });
});

test.describe("RN-09: escolher pessoas e sair do que se vê", () => {
  test("Pedro, pela API: editar Beatriz não muda nada; Diego como líder de Caio e Beatriz como cônjuge de Caio são recusados", async ({ page }) => {
    await signIn(page, PEDRO);
    const beatriz = await patchMember(page, BEATRIZ, { notes: "invadida" });
    expect(beatriz.rows).toEqual([]);
    expect(column(BEATRIZ, "notes")).toBe("");

    const leader = await patchMember(page, CAIO, { leader_id: memberId(DIEGO) });
    expect(message(leader)).toBe(MSG.cannotChoose);
    expect(column(CAIO, "leader_id")).toBe(memberId(ANDRE));
    const spouse = await patchMember(page, CAIO, { spouse_id: memberId(BEATRIZ) });
    expect(message(spouse)).toBe(MSG.cannotChoose);
    expect(column(CAIO, "spouse_id")).toBe("");
  });

  test("UX-22: André, que vê Beatriz só por ser cônjuge dela, tira o cônjuge no cadastro dela: Alert no topo (role=alert, com o foco), dados mantidos, e os dois continuam casados", async ({ page }) => {
    await signIn(page, ANDRE);
    const dialog = await openEdit(page, BEATRIZ);
    await dialog.getByLabel("Observações").fill("Texto que não pode se perder");
    await dialog.locator("#spouse").locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]").getByRole("button", { name: "Limpar seleção" }).click();
    await dialog.getByRole("button", { name: "Salvar" }).click();

    const alert = dialog.getByRole("alert").filter({ hasText: MSG.wouldLeaveMember });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Observações")).toHaveValue("Texto que não pode se perder");
    await expect(toast(page, "Membro atualizado com sucesso")).toHaveCount(0);
    expect(column(BEATRIZ, "spouse_id")).toBe(memberId(ANDRE));
    expect(column(ANDRE, "spouse_id")).toBe(memberId(BEATRIZ));
  });
});

test.describe("RN-11: quem só tem 'Editar Próprio Cadastro' (Caio)", () => {
  test("Caio muda o próprio celular, o endereço e o Instagram pela tela", async ({ page }) => {
    await signIn(page, CAIO);
    await page.getByRole("button", { name: "Editar meus dados" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar meus dados" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Celular / WhatsApp").fill("51987654321");
    await dialog.getByLabel("Instagram").fill("@caio.lima");
    await dialog.getByLabel("Rua").fill("Rua das Flores");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(column(CAIO, "mobile_whatsapp")).toBe("51987654321");
    expect(column(CAIO, "instagram")).toBe("@caio.lima");
    expect(column(CAIO, "street")).toBe("Rua das Flores");
  });

  test("Pela API, Caio muda o próprio líder, cônjuge, batismo e situação: recusado com os campos, e nada muda; editar Carla não muda nada", async ({ page }) => {
    await signIn(page, CAIO);
    const own = await patchMember(page, CAIO, { leader_id: memberId(PEDRO), is_baptized: true, is_active: false });
    expect(message(own)).toContain(MSG.ownDataOnly);
    expect(column(CAIO, "leader_id")).toBe(memberId(ANDRE));
    expect(column(CAIO, "is_active")).toBe("true");
    expect(column(CAIO, "is_baptized")).toBe("false");

    const carla = await patchMember(page, CARLA, { instagram: "@invadida" });
    expect(carla.rows).toEqual([]);
    expect(column(CARLA, "instagram")).toBe("");
  });
});

test.describe("RN-18, UX-21: função do membro", () => {
  test("Rita edita Caio: o seletor só oferece funções que ela atribui, com '(padrão)' na padrão; dar a função Líder a Caio é aceito", async ({ page }) => {
    await signIn(page, RITA);
    const dialog = await openEdit(page, CAIO);
    const select = dialog.getByRole("combobox", { name: "Função *" });
    await expect(select).toContainText("Membro");
    await select.click();
    const options = await page.getByRole("option").allTextContents();
    expect(options).toEqual(expect.arrayContaining(["Administrador", "Líder", "Membro (padrão)"]));
    await page.getByRole("option", { name: "Líder", exact: true }).click();
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
    expect(sql(env, `SELECT r.name FROM public.members m JOIN public.roles r ON r.id = m.role_id WHERE m.id = ${lit(memberId(CAIO))}`)).toBe("Líder");
    setRoleOf(CAIO, memberRoleId);
  });

  test("Rita no próprio cadastro: o texto 'Administrador' com 'Ninguém pode alterar a própria função.', sem Input desabilitado; pela API, trocar a própria função é recusado", async ({ page }) => {
    await signIn(page, RITA);
    const dialog = await openEdit(page, RITA);
    await expect(dialog.getByText("Administrador", { exact: true })).toBeVisible();
    await expect(dialog.getByText(MSG.ownRole)).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: /Função/ })).toHaveCount(0);
    expect(await dialog.locator("input:disabled, textarea:disabled").count()).toBe(0);

    const result = await patchMember(page, RITA, { role_id: leaderRoleId });
    expect(message(result)).toBe(MSG.ownRole);
    expect(column(RITA, "role_id")).toBe(adminRoleId);
  });

  test("Pedro (Líder, sem atribuir funções): editando Caio, o campo Função não aparece; pela API, trocar a função de Caio é recusado", async ({ page }) => {
    await signIn(page, PEDRO);
    const dialog = await openEdit(page, CAIO);
    await expect(dialog.getByText("Função", { exact: false }).filter({ hasText: /^Função/ })).toHaveCount(0);
    await expect(dialog.getByRole("combobox", { name: /Função/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    const result = await patchMember(page, CAIO, { role_id: leaderRoleId });
    expect(message(result)).toBe(MSG.roleChangeNotAllowed);
    expect(column(CAIO, "role_id")).toBe(memberRoleId);
  });

  test("Pedro com uma função que atribui funções mas não cobre a Administrador: o seletor não oferece a Administrador; diante de Nuno (Administrador), o texto com o motivo; a API recusa atribuí-la e não muda Beatriz", async ({ page }) => {
    setRoleOf(PEDRO, ROLE_COORDENACAO);
    try {
      await signIn(page, PEDRO);
      const dialog = await openEdit(page, CAIO);
      const select = dialog.getByRole("combobox", { name: "Função *" });
      await select.click();
      const options = await page.getByRole("option").allTextContents();
      expect(options).toContain("Membro (padrão)");
      expect(options).not.toContain("Administrador");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      const nuno = await openEdit(page, NUNO);
      await expect(nuno.getByText("Administrador", { exact: true })).toBeVisible();
      await expect(nuno.getByText(MSG.roleChangeNotAllowed)).toBeVisible();
      expect(await nuno.locator("input:disabled, textarea:disabled").count()).toBe(0);
      await page.keyboard.press("Escape");

      const assign = await patchMember(page, CAIO, { role_id: adminRoleId });
      expect(message(assign)).toBe(MSG.roleNotAssignable);
      expect(column(CAIO, "role_id")).toBe(memberRoleId);

      const beatriz = await patchMember(page, BEATRIZ, { role_id: leaderRoleId });
      expect(beatriz.rows).toEqual([]);
      expect(column(BEATRIZ, "role_id")).toBe(memberRoleId);
    } finally {
      setRoleOf(PEDRO, leaderRoleId);
    }
  });
});
