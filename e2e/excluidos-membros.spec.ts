import { test, expect, type Page } from "@playwright/test";
import {
  adminMemberName,
  authIdOf,
  callRpc,
  createAuthUser,
  deleteAuthUser,
  e2eEnv,
  expectNoButtonOverflow,
  lit,
  login,
  openDeleted,
  openList,
  passwordGrant,
  rpcAs,
  rpcsAs,
  sql,
  toast,
  trackRestRequests,
  type E2EEnv,
} from "./exclusao-support";

// Membros excluídos e restauração (E2.01, PR 3): RN-15, RN-16 e RN-19 e os
// critérios UX-13 a UX-17, UX-19, UX-22 e UX-40, com as personas AD
// (Administrador), AD2 (tem "Gerenciar Funções", mas não cobre a função de
// Fábio) e LE (exclui membros, sem "Gerenciar Funções"). Ver
// e2e/exclusao-support.ts para as variáveis.
//
// Cria a própria massa fictícia ("QA3 Exc Mem …", ids e2e201c0-…), exclui
// pela API (as mesmas regras da tela) e apaga tudo no fim (também no começo,
// se uma execução anterior parou no meio). As buscas usam sempre o prefixo:
// outras sessões criam excluídos na mesma stack. Cada teste usa os seus
// cadastros e não depende da ordem dos outros.

const PREFIX = "e2e201c0";
const NAME = "QA3 Exc Mem";
const PASSWORD = "Qa3ExcMem#2026";
const id = (kind: number, n: number) => `${PREFIX}-${String(kind).padStart(4, "0")}-0000-0000-${String(n).padStart(12, "0")}`;
const member = (n: number) => id(1, n);
/** Celular único por cadastro da massa: todo cadastro novo precisa de um identificador (E2.04, RN-08). */
const mobileOf = (n: number) => `5193208${String(n).padStart(4, "0")}`;
const role = (n: number) => id(4, n);
const who = (name: string) => `${NAME} ${name}`;

const LE = { email: "le.qa3-exc@teste.invalid", password: PASSWORD };
const AD2 = { email: "ad2.qa3-exc@teste.invalid", password: PASSWORD };
const ANA = { email: "ana.qa3-exc@teste.invalid", password: PASSWORD };
const BIA = { email: "bia.qa3-exc@teste.invalid", password: PASSWORD };
const ACCOUNTS = [LE, AD2, ANA, BIA];

const SHARED_MOBILE = "(51) 99999-0101";
const SEARCH_EMAIL = "qa3.busca.exc@teste.invalid";
const SEARCH_CPF = "529.982.247-25";
const DARIO_EMAIL = "dario.qa3-exc@teste.invalid";
const PAGES = Array.from({ length: 12 }, (_, i) => i + 1);
const pageName = (n: number) => who(`Pag ${String(n).padStart(2, "0")}`);
const pageMember = (n: number) => member(20 + n);

let env: E2EEnv;
let adminId = "";
let adminName = "";
/** A função padrão criada por este arquivo (vazio se já havia uma de outra sessão). */
let createdDefaultRole = "";

function cleanup() {
  const accounts = ACCOUNTS.map((account) => lit(account.email)).join(", ");
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_id::text LIKE '${PREFIX}%'
         OR metadata ->> 'member_id' LIKE '${PREFIX}%'
         OR actor_user_id IN (SELECT id FROM auth.users WHERE email IN (${accounts}));
     DELETE FROM public.cell_report_participants WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.cells WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     COMMIT;`,
  );
}

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
  cleanup();
  await removeAccounts();
  adminId = authIdOf(env, env.admin.email);
  adminName = adminMemberName(env);
  const auth = {
    le: await createAuthUser(env, LE.email, LE.password),
    ad2: await createAuthUser(env, AD2.email, AD2.password),
    ana: await createAuthUser(env, ANA.email, ANA.password),
    bia: await createAuthUser(env, BIA.email, BIA.password),
  };
  const pages = PAGES.map((n) => `(${lit(pageMember(n))}, ${lit(pageName(n))}, 'M', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(500 + n))}, NULL)`);
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES
       (${lit(role(1))}, '${NAME} LE'), (${lit(role(2))}, '${NAME} AD2'), (${lit(role(3))}, '${NAME} Alta'),
       (${lit(role(4))}, '${NAME} Membro'), (${lit(role(5))}, '${NAME} Líder');
     INSERT INTO public.role_permissions (role_id, permission)
     ${permissions(1, ["view_all_church", "view_all_reports", "view_dashboard", "edit_own_data", "delete_member", "delete_cell", "delete_cell_report"])}
     UNION ALL ${permissions(2, ["manage_roles", "view_all_church", "view_all_reports", "view_dashboard", "edit_own_data"])}
     UNION ALL ${permissions(3, ["manage_roles", "view_all_church", "view_dashboard", "delete_member", "assign_role"])}
     UNION ALL ${permissions(4, ["view_dashboard"])}
     UNION ALL ${permissions(5, ["view_dashboard", "view_all_church"])};
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id, auth_user_id, email, mobile_whatsapp, cpf) VALUES
       (${lit(member(90))}, ${lit(who("Lia Lopes"))}, 'F', false, true, ${lit(role(1))}, ${lit(auth.le)}, ${lit(LE.email)}, NULL, NULL),
       (${lit(member(91))}, ${lit(who("Ada Dutra"))}, 'F', false, true, ${lit(role(2))}, ${lit(auth.ad2)}, ${lit(AD2.email)}, NULL, NULL),
       (${lit(member(1))}, ${lit(who("Gil Souza"))}, 'M', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(1))}, NULL),
       (${lit(member(3))}, ${lit(who("Hugo Lima"))}, 'M', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(3))}, NULL),
       (${lit(member(4))}, ${lit(who("Carla Dias"))}, 'F', false, true, ${lit(role(4))}, NULL, NULL, ${lit(SHARED_MOBILE)}, NULL),
       (${lit(member(6))}, ${lit(who("Fábio Reis"))}, 'M', false, true, ${lit(role(3))}, NULL, NULL, ${lit(mobileOf(6))}, NULL),
       (${lit(member(7))}, ${lit(who("Bia Lopes"))}, 'F', false, true, ${lit(role(5))}, ${lit(auth.bia)}, ${lit(BIA.email)}, NULL, NULL),
       (${lit(member(8))}, ${lit(who("Ivone Prado"))}, 'F', false, false, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(8))}, NULL),
       (${lit(member(9))}, ${lit(who("Ana Costa"))}, 'F', false, true, ${lit(role(4))}, ${lit(auth.ana)}, ${lit(ANA.email)}, NULL, NULL),
       (${lit(member(10))}, ${lit(who("Otto Vaz"))}, 'M', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(10))}, NULL),
       (${lit(member(11))}, ${lit(who("Ordem Alfa"))}, 'M', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(11))}, NULL),
       (${lit(member(12))}, ${lit(who("Ordem Beta"))}, 'F', false, false, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(12))}, NULL),
       (${lit(member(13))}, ${lit(who("Ordem Gama"))}, 'M', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(13))}, NULL),
       (${lit(member(14))}, ${lit(who("Rita Auditoria"))}, 'F', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(14))}, NULL),
       (${lit(member(15))}, ${lit(who("Nara Estreita"))}, 'F', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(15))}, NULL),
       (${lit(member(16))}, ${lit(who("Leo Martins"))}, 'M', false, true, ${lit(role(4))}, NULL, NULL, ${lit(mobileOf(16))}, NULL),
       (${lit(member(40))}, ${lit(who("Busca Teles"))}, 'M', false, true, ${lit(role(4))}, NULL, ${lit(SEARCH_EMAIL)}, NULL, ${lit(SEARCH_CPF)}),
       ${pages.join(",\n       ")};
     INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, role_id, email, mobile_whatsapp) VALUES
       (${lit(member(2))}, ${lit(who("Bruno Almeida"))}, 'M', ${lit(member(1))}, true, true, ${lit(role(4))}, NULL, ${lit(mobileOf(2))}),
       (${lit(member(17))}, ${lit(who("Dario Neves"))}, 'M', ${lit(member(16))}, true, true, ${lit(role(3))}, ${lit(DARIO_EMAIL)}, '(51) 98888-0202');
     COMMIT;`,
  );
  // As exclusões pela API, como o administrador. Bruno antes de Gil (RN-04).
  rpcsAs(env, adminId, [
    `public.delete_member(${lit(member(2))})`,
    `public.delete_member(${lit(member(1))})`,
    ...[4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 40].map((n) => `public.delete_member(${lit(member(n))})`),
    ...PAGES.map((n) => `public.delete_member(${lit(pageMember(n))})`),
  ]);
  // RN-16 (e): Caio, cadastrado depois, com o celular de Carla.
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id, mobile_whatsapp)
     VALUES (${lit(member(5))}, ${lit(who("Caio Nunes"))}, 'M', false, true, ${lit(role(4))}, ${lit(SHARED_MOBILE)});`,
  );
  // Data e autor fixos onde o teste confere a ordem e o texto (RN-15, UX-14, UX-15).
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active)
     VALUES (${lit(id(3, 1))}, ${lit(member(1))}, ${lit(member(1))}, ${lit(member(1))}, 'Evangelística', 'Quarta', '20:00', true);
     UPDATE public.members SET deleted_at = '2026-11-10T17:32:00Z', deleted_by = (SELECT id FROM public.members WHERE auth_user_id = ${lit(adminId)}) WHERE id = ${lit(member(11))};
     UPDATE public.members SET deleted_at = '2026-11-02T12:10:00Z', deleted_by = NULL WHERE id = ${lit(member(12))};
     UPDATE public.members SET deleted_at = '2026-11-20T11:00:00Z', deleted_by = ${lit(member(90))} WHERE id = ${lit(member(13))};
     ${PAGES.map((n) => `UPDATE public.members SET deleted_at = timestamptz '2026-10-01T12:00:00Z' + interval '${n} hours' WHERE id = ${lit(pageMember(n))};`).join("\n     ")}
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
          + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.events WHERE entity_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email IN (${ACCOUNTS.map((a) => lit(a.email)).join(", ")}))`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

const state = (memberId: string) =>
  sql(
    env,
    `SELECT (deleted_at IS NULL)::text || '|' || is_active::text || '|' || coalesce(leader_id::text, '-') || '|' || has_leadership::text || '|' || coalesce(role_id::text, '-')
       FROM public.members WHERE id = ${lit(memberId)}`,
  );

/** Os nomes da primeira coluna da tabela (desktop), na ordem. */
const tableNames = (page: Page) => page.locator("tbody tr td:first-child").allTextContents();

async function confirmRestore(page: Page, name: string) {
  await page.getByRole("button", { name: `Restaurar ${name}`, exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: `Restaurar o cadastro de ${name}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Restaurar cadastro" }).click();
  return dialog;
}

test("RN-15 e UX-15 (AD, desktop): Membros excluídos vai da exclusão mais recente para a mais antiga, com data e hora de Brasília e o autor", async ({
  page,
}) => {
  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", who("Ordem"));

  await expect(page.getByRole("heading", { level: 1, name: "Membros excluídos" })).toBeVisible();
  await expect(page.getByText("Restaure o que foi excluído por engano. Os excluídos mais recentes aparecem primeiro.")).toBeVisible();
  expect(await tableNames(page)).toEqual([who("Ordem Gama"), who("Ordem Alfa"), who("Ordem Beta")]);
  await expect(page.getByRole("row", { name: new RegExp(who("Ordem Gama")) })).toContainText(`20/11/2026 08:00${who("Lia Lopes")}`);
  await expect(page.getByRole("row", { name: new RegExp(who("Ordem Alfa")) })).toContainText(`10/11/2026 14:32${adminName}`);
  const beta = page.getByRole("row", { name: new RegExp(who("Ordem Beta")) });
  await expect(beta).toContainText("02/11/2026 09:10Não registrado");
  await expect(beta).toContainText("Inativo");
  await expect(page.getByText("3 cadastros excluídos")).toBeVisible();
  for (const name of ["Ordem Gama", "Ordem Alfa", "Ordem Beta"]) {
    await expect(page.getByRole("button", { name: `Restaurar ${who(name)}`, exact: true })).toBeVisible();
  }
});

test.describe("navegador em outro fuso", () => {
  test.use({ timezoneId: "Asia/Tokyo" });

  test("UX-15 (navegador em Tóquio): os cards e a tabela continuam no horário de Brasília", async ({ page }) => {
    await login(page, env.admin);
    await page.setViewportSize({ width: 360, height: 800 });
    await openDeleted(page, "/members/deleted", who("Ordem"));
    const alfa = page.locator("li").filter({ hasText: who("Ordem Alfa") });
    await expect(alfa).toContainText("Excluído em 10/11/2026 às 14:32");
    await expect(alfa).toContainText(`por ${adminName}`);
    await expect(page.locator("li").filter({ hasText: who("Ordem Beta") })).toContainText("Excluído em 02/11/2026 às 09:10Autor não registrado");

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("row", { name: new RegExp(who("Ordem Gama")) })).toContainText("20/11/2026 08:00");
  });
});

test("UX-16: abaixo de 768 px, cards com o nome primeiro e 'Restaurar' com texto e 44 px; a partir de 768 px, tabela", async ({ page }) => {
  await login(page, env.admin);
  await page.setViewportSize({ width: 767, height: 900 });
  await openDeleted(page, "/members/deleted", who("Ordem"));

  await expect(page.locator("table")).toHaveCount(0);
  const cards = page.locator("main li");
  await expect(cards).toHaveCount(3);
  const first = cards.first();
  await expect(first.locator("p").first()).toHaveText(who("Ordem Gama"));
  await expect(first).toContainText("Excluído em 20/11/2026 às 08:00");
  await expect(first).toContainText(`por ${who("Lia Lopes")}`);
  await expect(first).toContainText("Sem líder");
  await expect(first).toContainText("Ativo");
  const button = first.getByRole("button", { name: `Restaurar ${who("Ordem Gama")}`, exact: true });
  await expect(button).toHaveText("Restaurar");
  const box = await button.boundingBox();
  expect(box?.height ?? 0, "altura do 'Restaurar' no card").toBeGreaterThanOrEqual(43.5);

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator("table")).toHaveCount(1);
  await expect(page.locator("main li")).toHaveCount(0);
  expect(await tableNames(page)).toEqual([who("Ordem Gama"), who("Ordem Alfa"), who("Ordem Beta")]);
});

test("UX-14: paginação no servidor; page, size e q na URL; recarregar mantém a busca e a página; a busca acha por e-mail e CPF", async ({
  page,
}) => {
  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", who("Pag"), "&size=10");

  await expect(page.getByText("12 cadastros excluídos")).toBeVisible();
  expect(await tableNames(page)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map(pageName));
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(page).toHaveURL(/[?&]size=10(&|$)/);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(who("Pag")).replace(/%20/g, "(\\+|%20)")}(&|$)`));
  await expect.poll(() => tableNames(page)).toEqual([2, 1].map(pageName));

  await page.reload();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Buscar membros excluídos" })).toHaveValue(who("Pag"));
  expect(await tableNames(page)).toEqual([2, 1].map(pageName));
  await expect(page.getByText("Página 2 de 2")).toBeVisible();

  // Os mesmos campos da lista principal: e-mail e CPF (com e sem máscara), para quem vê os dados sensíveis.
  for (const term of ["qa3.busca.exc", SEARCH_CPF, SEARCH_CPF.replace(/\D/g, "")]) {
    await openDeleted(page, "/members/deleted", term);
    expect(await tableNames(page), `busca por ${term}`).toEqual([who("Busca Teles")]);
  }
});

test("RN-15 e UX-17 (LE, com 'Excluir Membro' e sem 'Gerenciar Funções'): sem 'Excluídos' nas listas; as rotas mostram o aviso, sem nenhum registro nem consulta; a restauração pela API dá 42501", async ({
  page,
}) => {
  await login(page, LE);
  for (const path of ["/members", "/cells", "/cell-reports"]) {
    await openList(page, path, NAME);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Ver (membros|células|relatórios) excluíd/ })).toHaveCount(0);
    await expect(page.getByText(/^Excluíd(o|a)s$/)).toHaveCount(0);
  }

  for (const [path, list] of [
    ["/members/deleted", "Membros"],
    ["/cells/deleted", "Células"],
    ["/cell-reports/deleted", "Relatórios"],
  ] as const) {
    const requests = trackRestRequests(page);
    await page.goto(`${path}?q=${encodeURIComponent(NAME)}`);
    await expect(page.getByText("Você não tem acesso a esta lista.")).toBeVisible();
    const back = page.getByRole("link", { name: `Voltar para ${list}` });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", path.replace("/deleted", ""));
    await expect(page.getByRole("link", { name: `← ${list}` })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    // Nenhum registro: o nome de LE aparece só no menu lateral, fora da página.
    await expect(page.locator("main").getByText(NAME)).toHaveCount(0);
    await expect(page.locator("main li, main tr")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(requests.filter((url) => /_deleted_view|rpc\/restore_/.test(url)), `${path}: nenhuma consulta de excluídos`).toEqual([]);
    page.removeAllListeners("request");
  }

  const { status, body } = await callRpc(page, env, "restore_member", { _member_id: member(10) });
  expect(status).toBe(403);
  expect(body).toMatchObject({ code: "42501", message: "Você não tem permissão para esta ação." });
  expect(state(member(10)).split("|")[0], "Otto continua excluído").toBe("false");
});

test("RN-15 (AD): Dario, excluído por engano, volta às listas com o líder Leo, os mesmos dados e a mesma função, e o total de discípulos de Leo volta a 1", async ({
  page,
}) => {
  const dario = who("Dario Neves");
  const leo = who("Leo Martins");
  const disciplesOfLeo = () => sql(env, `SELECT total_disciples FROM private.member_hierarchy WHERE member_id = ${lit(member(16))}`);
  const data = () =>
    sql(env, `SELECT coalesce(email, '') || '|' || coalesce(mobile_whatsapp, '') || '|' || gender FROM public.members WHERE id = ${lit(member(17))}`);
  expect(disciplesOfLeo(), "com Dario excluído").toBe("0");

  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", dario);
  await expect(page.getByRole("row", { name: new RegExp(dario) })).toContainText(leo);
  await page.getByRole("button", { name: `Restaurar ${dario}`, exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: `Restaurar o cadastro de ${dario}?` });
  await expect(confirmation).toContainText(`com os mesmos dados e a função ${NAME} Alta.`);
  await expect(confirmation).not.toContainText("Volta sem líder");
  await confirmation.getByRole("button", { name: "Restaurar cadastro" }).click();

  // Sem nada a avisar: só o toast, e o item sai da lista.
  await expect(toast(page, "Cadastro restaurado.")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("Nenhum cadastro excluído encontrado para esta busca.")).toBeVisible();
  expect(state(member(17))).toBe(`true|true|${member(16)}|true|${role(3)}`);
  expect(data()).toBe(`${DARIO_EMAIL}|51988880202|M`);
  expect(disciplesOfLeo(), "restaurado, ele volta ao total do líder").toBe("1");
  await openList(page, "/members", dario);
  await expect(page.getByRole("row", { name: new RegExp(dario) })).toBeVisible();
});

test("RN-16 (d) e UX-22 (AD): Bruno, cujo líder Gil foi excluído depois, volta sem líder; 'Definir líder' abre o formulário com o foco no Líder", async ({
  page,
}) => {
  const bruno = who("Bruno Almeida");
  const gil = who("Gil Souza");
  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", bruno);
  await expect(page.getByRole("row", { name: new RegExp(bruno) })).toContainText(`${gil} (cadastro excluído)`);

  const confirmation = await confirmRestore(page, bruno);
  const result = page.getByRole("alertdialog", { name: "Cadastro restaurado" });
  await expect(result).toBeVisible();
  await expect(confirmation).toBeHidden();
  await expect(result).toContainText(`Cadastro restaurado sem líder, porque o líder anterior (${gil}) foi excluído. Defina o novo líder.`);
  await expect(result.getByRole("button", { name: "Agora não" })).toBeVisible();
  // DA-3: sem líder e com "Tem Liderança?" desligado; ele conta em "sem liderança".
  expect(state(member(2))).toBe(`true|true|-|false|${role(4)}`);

  await result.getByRole("button", { name: "Definir líder" }).click();
  const form = page.getByRole("dialog", { name: "Editar Membro" });
  await expect(form.getByLabel("Nome *")).toHaveValue(bruno);
  const leader = form.getByLabel("Líder *", { exact: true });
  await expect(leader).toBeVisible();
  await expect(leader).toBeFocused();
  await leader.pressSequentially(who("Hugo"));
  await page.getByRole("option", { name: who("Hugo Lima") }).click();
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
  await expect(form).toBeHidden();
  expect(state(member(2))).toBe(`true|true|${member(3)}|true|${role(4)}`);

  // O item saiu da lista de excluídos e voltou à de Membros.
  await openDeleted(page, "/members/deleted", bruno);
  await expect(page.getByText("Nenhum cadastro excluído encontrado para esta busca.")).toBeVisible();
  await openList(page, "/members", bruno);
  await expect(page.getByRole("row", { name: new RegExp(bruno) })).toBeVisible();
});

test("RN-16 (e) (AD): Carla, com o celular que Caio passou a usar, é recusada com 'outro cadastro já usa este celular', e nada muda", async ({
  page,
}) => {
  const carla = who("Carla Dias");
  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", carla);
  await confirmRestore(page, carla);

  const blocked = page.getByRole("alertdialog", { name: `Não é possível restaurar ${carla}` });
  await expect(blocked).toContainText("Não é possível restaurar: outro cadastro já usa este celular.");
  await expect(blocked.getByRole("button")).toHaveText(["Fechar"]);
  await blocked.getByRole("button", { name: "Fechar" }).click();
  await expect(blocked).toBeHidden();
  await expect(page.getByRole("button", { name: `Restaurar ${carla}`, exact: true })).toBeFocused();
  expect(state(member(4))).toBe(`false|true|-|false|${role(4)}`);
});

test("RN-16 (a) (AD): Bia, cuja função foi apagada depois, volta com a função padrão, avisada na confirmação e no resultado", async ({
  page,
}) => {
  const bia = who("Bia Lopes");
  // A função dela é apagada depois da exclusão; a stack não tem função padrão: cria uma (e apaga no fim).
  sql(env, `DELETE FROM public.roles WHERE id = ${lit(role(5))};`);
  let defaultRole = sql(env, `SELECT coalesce((SELECT id::text || '|' || name FROM public.roles WHERE is_default), '')`);
  if (!defaultRole) {
    sql(env, `INSERT INTO public.roles (id, name, is_default) VALUES (${lit(role(6))}, '${NAME} Padrão', true);
              INSERT INTO public.role_permissions (role_id, permission) VALUES (${lit(role(6))}, 'view_dashboard');`);
    createdDefaultRole = role(6);
    defaultRole = `${role(6)}|${NAME} Padrão`;
  }
  const [defaultId, defaultName] = defaultRole.split("|");
  try {
    expect(state(member(7))).toBe("false|true|-|false|-");

    await login(page, env.admin);
    await openDeleted(page, "/members/deleted", bia);
    await page.getByRole("button", { name: `Restaurar ${bia}`, exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: `Restaurar o cadastro de ${bia}?` });
    await expect(confirmation).toContainText(`O cadastro volta às listas e aos totais, com os mesmos dados e a função ${defaultName}.`);
    await expect(confirmation).toContainText("A pessoa volta a entrar no sistema com a mesma senha.");
    await confirmation.getByRole("button", { name: "Restaurar cadastro" }).click();

    const result = page.getByRole("alertdialog", { name: "Cadastro restaurado" });
    await expect(result).toContainText(`O cadastro voltou com a função padrão (${defaultName}), porque a função anterior foi apagada.`);
    await expect(result.getByRole("button", { name: "Definir líder" })).toHaveCount(0);
    await result.getByRole("button", { name: "Fechar" }).click();
    await expect(result).toBeHidden();
    expect(state(member(7))).toBe(`true|true|-|false|${defaultId}`);
  } finally {
    if (createdDefaultRole) {
      sql(env, `DELETE FROM public.role_permissions WHERE role_id = ${lit(createdDefaultRole)};
                DELETE FROM public.roles WHERE id = ${lit(createdDefaultRole)};`);
      createdDefaultRole = "";
    }
  }
  expect(sql(env, `SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%' AND is_default`), "a função padrão do teste foi apagada").toBe("0");
});

test("RN-16 (b) (AD2): quem não cobre a função de Fábio recebe 'Você não tem permissão para restaurar este membro.', e nada muda", async ({
  page,
}) => {
  const fabio = who("Fábio Reis");
  await login(page, AD2);
  await openDeleted(page, "/members/deleted", fabio);
  const confirmation = await confirmRestore(page, fabio);

  const blocked = page.getByRole("alertdialog", { name: `Não é possível restaurar ${fabio}` });
  await expect(blocked).toContainText("Você não tem permissão para restaurar este membro.");
  await expect(blocked.getByRole("button")).toHaveText(["Fechar"]);
  await expect(confirmation).toBeHidden();
  expect(state(member(6))).toBe(`false|true|-|false|${role(3)}`);
});

test("RN-16 (a) (AD): Ivone, inativa quando foi excluída, volta inativa", async ({ page }) => {
  const ivone = who("Ivone Prado");
  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", ivone);
  await expect(page.getByRole("row", { name: new RegExp(ivone) })).toContainText("Inativo");
  await confirmRestore(page, ivone);

  await expect(toast(page, "Cadastro restaurado.")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("Nenhum cadastro excluído encontrado para esta busca.")).toBeVisible();
  expect(state(member(8))).toBe(`true|false|-|false|${role(4)}`);
  await openList(page, "/members", ivone);
  await expect(page.getByRole("row", { name: new RegExp(ivone) })).toContainText("Inativo");
});

test("RN-16 (f) e RN-14 (AD e Ana): Ana, com conta, excluída não entra; restaurada, entra de novo pela tela de login com a mesma senha", async ({
  page,
  browser,
}, testInfo) => {
  const ana = who("Ana Costa");
  expect(await passwordGrant(env, ANA.email, ANA.password), "excluída, o login é recusado").toBe(401);

  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", ana);
  await page.getByRole("button", { name: `Restaurar ${ana}`, exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: `Restaurar o cadastro de ${ana}?` });
  await expect(confirmation).toContainText("A pessoa volta a entrar no sistema com a mesma senha.");
  await confirmation.getByRole("button", { name: "Restaurar cadastro" }).click();
  await expect(toast(page, "Cadastro restaurado.")).toBeVisible();
  expect(state(member(9))).toBe(`true|true|-|false|${role(4)}`);

  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  try {
    const anaPage = await context.newPage();
    await login(anaPage, ANA);
    await expect(anaPage).toHaveURL(/\/$/);
    await expect(anaPage.getByText(ana).first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test("RN-15 (AD): restaurar quem outra pessoa já restaurou mostra 'Este cadastro não está excluído.' como aviso informativo, e a lista recarrega", async ({
  page,
}) => {
  const otto = who("Otto Vaz");
  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", otto);
  await page.getByRole("button", { name: `Restaurar ${otto}`, exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: `Restaurar o cadastro de ${otto}?` });
  await expect(confirmation).toBeVisible();

  // Outra sessão restaura Otto enquanto a confirmação está aberta.
  rpcAs(env, adminId, `public.restore_member(${lit(member(10))})`);
  await confirmation.getByRole("button", { name: "Restaurar cadastro" }).click();

  const notice = toast(page, "Este cadastro não está excluído.");
  await expect(notice).toBeVisible();
  await expect(notice).not.toHaveClass(/destructive/);
  await expect(confirmation).toBeHidden();
  await expect(page.getByText("Nenhum cadastro excluído encontrado para esta busca.")).toBeVisible();
  expect(state(member(10))).toBe(`true|true|-|false|${role(4)}`);
});

test("RN-19 e UX-37 (AD): a Auditoria mostra a exclusão e a restauração de Rita, com 'Restauração', o autor e o horário", async ({ page }) => {
  const rita = who("Rita Auditoria");
  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", rita);
  await confirmRestore(page, rita);
  await expect(toast(page, "Cadastro restaurado.")).toBeVisible();

  const actor = sql(env, `SELECT actor_label FROM public.events WHERE entity_id = ${lit(member(14))} AND action = 'restore'`);
  expect(actor, "o autor da restauração").not.toBe("");
  await page.goto("/events");
  await page.getByPlaceholder("Autor, entidade, descrição...").fill(rita);
  const restoreRow = page.getByRole("row").filter({ hasText: "Restauração" }).filter({ hasText: rita });
  await expect(restoreRow).toHaveCount(1);
  await expect(restoreRow).toContainText(actor);
  await expect(restoreRow).toContainText(/\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}/);
  const deleteRow = page.getByRole("row").filter({ hasText: "Exclusão" }).filter({ hasText: rita });
  await expect(deleteRow).toHaveCount(1);
  await expect(deleteRow).toContainText(actor);
});

test("UX-13 (AD): 'Excluídos'/'Excluídas' no cabeçalho das três listas; em 360 px, na linha do título, sem empurrar a ação principal; no desktop, à esquerda dela", async ({
  page,
}) => {
  await login(page, env.admin);
  const lists = [
    { path: "/members", label: "Ver membros excluídos", text: "Excluídos", primary: "Novo membro" },
    { path: "/cells", label: "Ver células excluídas", text: "Excluídas", primary: "Nova Célula" },
    { path: "/cell-reports", label: "Ver relatórios excluídos", text: "Excluídos", primary: "Novo Relatório" },
  ];

  await page.setViewportSize({ width: 360, height: 800 });
  for (const list of lists) {
    await openList(page, list.path, NAME);
    const button = page.getByRole("link", { name: list.label });
    await expect(button).toHaveText(list.text);
    await expect(button).toHaveAttribute("href", `${list.path}/deleted`);
    const title = await page.getByRole("heading", { level: 1 }).boundingBox();
    const box = await button.boundingBox();
    const primary = await page.getByRole("button", { name: list.primary, exact: true }).boundingBox();
    if (!title || !box || !primary) throw new Error(`${list.path}: sem medidas`);
    expect(box.y, `${list.path}: na linha do título (topo)`).toBeLessThan(title.y + title.height);
    expect(box.y + box.height, `${list.path}: na linha do título (base)`).toBeGreaterThan(title.y);
    expect(box.x, `${list.path}: à direita do título`).toBeGreaterThanOrEqual(title.x + title.width - 0.5);
    expect(box.height, `${list.path}: 44 px`).toBeGreaterThanOrEqual(43.5);
    expect(primary.y, `${list.path}: a ação principal fica abaixo`).toBeGreaterThanOrEqual(box.y + box.height - 0.5);
    expect(primary.width, `${list.path}: a ação principal ocupa a largura`).toBeGreaterThanOrEqual(360 - 2 * 16 - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${list.path}: sem rolagem lateral`).toBeLessThanOrEqual(360);
  }
  // Relatórios: o título quebra em duas linhas, e o botão continua na primeira.
  const reportsTitle = await page.getByRole("heading", { level: 1 }).boundingBox();
  const reportsButton = await page.getByRole("link", { name: "Ver relatórios excluídos" }).boundingBox();
  expect(reportsTitle?.height ?? 0, "Relatórios de Células em duas linhas").toBeGreaterThan(50);
  expect(reportsButton?.y ?? 999).toBeLessThan((reportsTitle?.y ?? 0) + 40);

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const list of lists) {
    await openList(page, list.path, NAME);
    const box = await page.getByRole("link", { name: list.label }).boundingBox();
    const primary = await page.getByRole("button", { name: list.primary, exact: true }).boundingBox();
    if (!box || !primary) throw new Error(`${list.path}: sem medidas`);
    expect(box.x + box.width, `${list.path}: à esquerda da ação principal`).toBeLessThanOrEqual(primary.x);
    expect(Math.abs(box.y - primary.y), `${list.path}: na mesma linha da ação principal`).toBeLessThan(8);
  }
  await page.getByRole("link", { name: "Ver relatórios excluídos" }).click();
  await expect(page).toHaveURL(/\/cell-reports\/deleted$/);
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios excluídos" })).toBeVisible();
});

test("UX-19 (AD): '← Lista' volta com a busca e a página de antes; por link direto, vai para a lista sem parâmetros (Membros, Células e Relatórios)", async ({
  page,
}) => {
  await login(page, env.admin);
  const lists = [
    { path: "/members", back: "← Membros", button: "Ver membros excluídos", search: "a" },
    { path: "/cells", back: "← Células", button: "Ver células excluídas", search: "a" },
    { path: "/cell-reports", back: "← Relatórios", button: "Ver relatórios excluídos", search: "a" },
  ];
  for (const list of lists) {
    await openList(page, list.path, list.search, "&size=10&page=2");
    await expect(page).toHaveURL(/page=2/);
    const before = new URL(page.url());
    await page.getByRole("link", { name: list.button }).click();
    await expect(page).toHaveURL(new RegExp(`${list.path}/deleted$`));
    await page.getByRole("link", { name: list.back }).click();
    await expect(page).toHaveURL(new RegExp(`${list.path}\\?`));
    const after = new URL(page.url());
    expect(after.pathname, list.path).toBe(list.path);
    expect(Object.fromEntries(after.searchParams), `${list.path}: busca e página de antes`).toEqual(Object.fromEntries(before.searchParams));
    await expect(page.locator("main input[placeholder]").first()).toHaveValue(list.search);

    // Por link direto: a lista sem parâmetros.
    await page.goto(`${list.path}/deleted`);
    const back = page.getByRole("link", { name: list.back });
    await expect(back).toHaveAttribute("href", list.path);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`${list.path}$`));
  }
});

test("UX-40 (320 px): na lista de Membros excluídos, na confirmação e no bloqueio, nenhum botão com nome estoura a largura", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page, env.admin);
  await openDeleted(page, "/members/deleted", who("Pag"));
  await expect(page.locator("main li").first()).toBeVisible();
  await expectNoButtonOverflow(page, page.locator("main"), "lista de excluídos");

  const nara = who("Nara Estreita");
  await openDeleted(page, "/members/deleted", nara);
  await page.getByRole("button", { name: `Restaurar ${nara}`, exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation.getByRole("button", { name: "Restaurar cadastro" })).toBeVisible();
  await expectNoButtonOverflow(page, confirmation, "confirmação da restauração");
  await confirmation.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirmation).toBeHidden();

  const carla = who("Carla Dias");
  await openDeleted(page, "/members/deleted", carla);
  await confirmRestore(page, carla);
  const blocked = page.getByRole("alertdialog", { name: `Não é possível restaurar ${carla}` });
  await expect(blocked).toBeVisible();
  await expectNoButtonOverflow(page, blocked, "bloqueio da restauração");
  expect(state(member(15)).split("|")[0], "Nara continua excluída").toBe("false");
});
