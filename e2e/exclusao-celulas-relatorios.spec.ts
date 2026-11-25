import { test, expect, type Page } from "@playwright/test";
import {
  createAuthUser,
  deleteAuthUser,
  e2eEnv,
  expectDialogFitsSmallScreen,
  expectTouchTargets,
  largeFont,
  lit,
  login,
  openList,
  rpcAs,
  sql,
  toast,
  type E2EEnv,
} from "./exclusao-support";

// Exclusão lógica de células e relatórios (E2.01, PR 2): RN-02, RN-06, RN-11,
// RN-12 e RN-13, e os critérios UX-01, UX-05, UX-07, UX-12, UX-25 e UX-29,
// com as personas AD (Administrador), LE (exclui, sem editar) e MB (sem
// permissão de excluir). Ver e2e/exclusao-support.ts para as variáveis.
//
// Cria a própria massa fictícia ("QA E2E Cel …", ids e2e201b0-…) e as contas
// de LE e MB, e apaga tudo no fim (também no começo, se uma execução anterior
// parou no meio). Os relatórios são da semana atual (domingo, 00:00, no
// horário de Brasília). Os testes rodam em série, na ordem do arquivo.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e201b0";
const NAME = "QA E2E Cel";
const PASSWORD = "QaE2eCel#2026";
const id = (kind: number, n: number) => `${PREFIX}-${String(kind).padStart(4, "0")}-0000-0000-${String(n).padStart(12, "0")}`;
const member = (n: number) => id(1, n);
const cell = (n: number) => id(2, n);
const report = (n: number) => id(3, n);
const role = (n: number) => id(4, n);

const LE = { email: "le.e2e-cel@teste.invalid", password: PASSWORD };
const MB = { email: "mb.e2e-cel@teste.invalid", password: PASSWORD };
const ANA = `${NAME} Ana Souza`;
const SARA = `${NAME} Sara Reis`;
const QUINTINO = `${NAME} Quintino Reis`;
const QUIRINO = `${NAME} Quirino Neves`;
const RUI = `${NAME} Rui Campos`;
const ZECA = `${NAME} Zeca Lima`;
const TEO = `${NAME} Teo Prado`;
const BIA = `${NAME} Bia Bastos`;
const ELI = `${NAME} Eli Faria`;
const FABIO = `${NAME} Fábio Faria`;

let env: E2EEnv;
let weekStart = "";
const authIds: { le?: string; mb?: string } = {};

/** "2026-11-22" → "22/11/2026". */
const shown = (isoDate: string) => isoDate.split("-").reverse().join("/");

function cleanup() {
  const actors = [authIds.le, authIds.mb].filter(Boolean).map((v) => lit(String(v)));
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_id::text LIKE '${PREFIX}%'
         OR entity_id IN (SELECT r.id FROM public.cell_reports r WHERE r.cell_id::text LIKE '${PREFIX}%')
         OR metadata ->> 'member_id' LIKE '${PREFIX}%'
         ${actors.length ? `OR actor_user_id IN (${actors.join(", ")})` : ""};
     DELETE FROM public.cell_report_participants
      WHERE member_id::text LIKE '${PREFIX}%'
         OR report_id IN (SELECT r.id FROM public.cell_reports r WHERE r.id::text LIKE '${PREFIX}%' OR r.cell_id::text LIKE '${PREFIX}%');
     DELETE FROM public.cell_reports WHERE id::text LIKE '${PREFIX}%' OR cell_id::text LIKE '${PREFIX}%';
     DELETE FROM public.cells WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     COMMIT;`,
  );
}

async function removeAccounts() {
  const ids = sql(env, `SELECT id FROM auth.users WHERE email IN (${lit(LE.email)}, ${lit(MB.email)})`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  authIds.le = await createAuthUser(env, LE.email, LE.password);
  authIds.mb = await createAuthUser(env, MB.email, MB.password);
  weekStart = sql(env, "SELECT public.week_start(public.sp_today())");
  const people: [number, string, string][] = [
    [1, ANA, "F"], [2, SARA, "F"], [3, QUINTINO, "M"], [4, QUIRINO, "M"], [5, RUI, "M"], [6, ZECA, "M"],
    [7, TEO, "M"], [8, BIA, "F"], [9, ELI, "F"], [10, FABIO, "M"],
  ];
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES
       (${lit(role(1))}, '${NAME} LE'), (${lit(role(2))}, '${NAME} MB'), (${lit(role(3))}, '${NAME} Membro');
     INSERT INTO public.role_permissions (role_id, permission)
     SELECT ${lit(role(1))}::uuid, p::public.permission_action FROM unnest(ARRAY['view_all_church', 'view_all_reports',
            'view_dashboard', 'edit_own_data', 'delete_member', 'delete_cell', 'delete_cell_report']) p
     UNION ALL
     SELECT ${lit(role(2))}::uuid, p::public.permission_action FROM unnest(ARRAY['view_all_church', 'view_all_reports',
            'view_dashboard', 'edit_own_data']) p
     UNION ALL SELECT ${lit(role(3))}::uuid, 'view_dashboard'::public.permission_action;
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, auth_user_id, role_id, email) VALUES
       (${lit(member(90))}, '${NAME} Lia Lopes', 'F', false, true, ${lit(authIds.le)}, ${lit(role(1))}, ${lit(LE.email)}),
       (${lit(member(91))}, '${NAME} Mauro Melo', 'M', false, true, ${lit(authIds.mb)}, ${lit(role(2))}, ${lit(MB.email)});
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id) VALUES
       ${people.map(([n, name, gender]) => `(${lit(member(n))}, ${lit(name)}, '${gender}', false, true, ${lit(role(3))})`).join(",\n       ")};
     INSERT INTO public.cells (id, leader_id, host_id, type, meeting_day, meeting_time, street, number, neighborhood) VALUES
       (${lit(cell(1))}, ${lit(member(5))}, ${lit(member(5))}, 'Evangelística', 'Domingo', '00:00', 'Rua QA', '1', 'Centro'),
       (${lit(cell(2))}, ${lit(member(6))}, ${lit(member(6))}, 'Evangelística', 'Domingo', '00:00', 'Rua QA', '2', 'Centro'),
       (${lit(cell(3))}, ${lit(member(7))}, ${lit(member(7))}, 'Discipulado', 'Domingo', '00:00', 'Rua QA', '3', 'Centro'),
       (${lit(cell(4))}, ${lit(member(9))}, ${lit(member(9))}, 'Evangelística', 'Quarta', '20:00', 'Rua QA', '4', 'Centro'),
       (${lit(cell(5))}, ${lit(member(10))}, ${lit(member(10))}, 'Discipulado', 'Quinta', '20:00', 'Rua QA', '5', 'Centro');
     INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, visitors, offering) VALUES
       (${lit(report(1))}, ${lit(cell(1))}, ${lit(weekStart)}, '00:00', '${NAME} tema Rui', true, ARRAY['V1', 'V2'], 50),
       (${lit(report(2))}, ${lit(cell(2))}, ${lit(weekStart)}, '00:00', '${NAME} tema Zeca', true, '{}', 0),
       (${lit(report(3))}, ${lit(cell(3))}, ${lit(weekStart)}, '00:00', '${NAME} tema Teo', true, '{}', 0);
     INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
       (${lit(report(1))}, ${lit(member(1))}),
       (${lit(report(3))}, ${lit(member(1))}), (${lit(report(3))}, ${lit(member(2))});
     COMMIT;`,
  );
  // Exclusões pela API, como o administrador: Sara (participante de R), Quintino e a célula de Rui.
  const adminId = sql(env, `SELECT id FROM auth.users WHERE email = ${lit(env.admin.email)}`);
  rpcAs(env, adminId, `public.delete_member(${lit(member(2))})`);
  rpcAs(env, adminId, `public.delete_member(${lit(member(3))})`);
  rpcAs(env, adminId, `public.delete_cell(${lit(cell(1))})`);
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cell_reports WHERE cell_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email IN (${lit(LE.email)}, ${lit(MB.email)}))`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

/** Minúsculas e sem acento, como a busca do servidor. */
const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Abre um seletor (react-select), digita e devolve os nomes das opções que o
 * servidor mandou para esse texto: espera até todas as opções terem todas as
 * palavras digitadas (ou a lista vazia), para não ler a lista de antes.
 */
async function optionsFor(page: Page, field: ReturnType<Page["getByLabel"]>, text: string) {
  const words = normalized(text).split(" ").filter(Boolean);
  // Sem fill(""): Delete com o campo vazio retira o último escolhido (react-select). O Esc já limpa o texto.
  await field.click();
  // A resposta da busca; o mesmo texto já pesquisado vem do cache, sem requisição.
  const answered = page
    .waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return /\/rest\/v1\/(members_view|cells_view)$/.test(url.pathname) && normalized(decodeURIComponent(url.search)).includes(words[words.length - 1]);
      },
      { timeout: 5000 },
    )
    .catch(() => null);
  await field.pressSequentially(text);
  await answered;
  const listbox = page.getByRole("listbox");
  let names: string[] = [];
  await expect
    .poll(async () => {
      names = await listbox.getByRole("option").allTextContents();
      const empty = names.length === 0 && (await page.getByText(/^Nenhum(a)? (membro|célula) encontrad[oa]$/).count()) > 0;
      return empty || (names.length > 0 && names.every((name) => words.every((word) => normalized(name).includes(word))));
    })
    .toBe(true);
  await field.press("Escape");
  return names;
}

const participantsOf = (reportId: string) =>
  sql(
    env,
    `SELECT string_agg(m.name, ',' ORDER BY m.name) FROM public.cell_report_participants p
       JOIN public.members m ON m.id = p.member_id WHERE p.report_id = ${lit(reportId)}`,
  );

test("RN-06 (AD): os seletores de líder, timóteo, anfitrião, cônjuge, líder do membro, célula e participantes não oferecem o membro excluído nem a célula excluída", async ({
  page,
}) => {
  await login(page, env.admin);

  // Célula nova: líder, timóteo e anfitrião.
  await openList(page, "/cells", NAME);
  await page.getByRole("button", { name: "Nova Célula" }).click();
  const cellForm = page.getByRole("dialog", { name: "Nova Célula" });
  for (const label of ["Líder *", "Timóteo (Auxiliar)", "Anfitrião"]) {
    const names = await optionsFor(page, cellForm.getByLabel(label, { exact: true }), `${NAME} Qui`);
    expect(names, label).toContain(QUIRINO);
    expect(names, label).not.toContain(QUINTINO);
  }
  await cellForm.getByRole("button", { name: "Cancelar" }).click();

  // Cadastro de membro: cônjuge e líder.
  await openList(page, "/members", ANA);
  await page.getByRole("button", { name: `Editar ${ANA}` }).click();
  const memberForm = page.getByRole("dialog", { name: "Editar Membro" });
  await memberForm.getByLabel("Tem Liderança?").click();
  for (const label of ["Cônjuge", "Líder"]) {
    const names = await optionsFor(page, memberForm.getByLabel(label, { exact: true }), `${NAME} Qui`);
    expect(names, label).toContain(QUIRINO);
    expect(names, label).not.toContain(QUINTINO);
  }
  await memberForm.getByRole("button", { name: "Cancelar" }).click();

  // Relatório novo: célula e participantes.
  await openList(page, "/cell-reports", NAME);
  await page.getByRole("button", { name: "Novo Relatório" }).click();
  const reportForm = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
  const cellField = reportForm.getByLabel("Célula *");
  expect(await optionsFor(page, cellField, RUI)).toEqual([]);
  expect(await optionsFor(page, cellField, ZECA)).toEqual([expect.stringContaining(`Célula de ${ZECA}`)]);
  const participantsField = reportForm.getByLabel("Participantes (Membros)");
  const participantNames = await optionsFor(page, participantsField, NAME);
  expect(participantNames).toContain(ANA);
  expect(participantNames).toContain(QUIRINO);
  expect(participantNames).not.toContain(SARA);
  expect(participantNames).not.toContain(QUINTINO);
  await reportForm.getByRole("button", { name: "Cancelar" }).click();
});

test("RN-11 (MB): o relatório da célula excluída aparece com 'Célula excluída', sem 'Editar' e sem 'Excluir'", async ({ page }) => {
  await login(page, MB);
  await openList(page, "/cell-reports", RUI);
  const row = page.getByRole("row", { name: new RegExp(RUI) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Célula excluída")).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
});

test("UX-01 e UX-25 (360×800): em Células e Relatórios, 'Excluir' fica só no '⋯'; 'Novo relatório', 'Editar' e '⋯' têm 44×44 px, a 8 px um do outro; o card da célula excluída tem o badge e não tem 'Editar'", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, env.admin);

  await openList(page, "/cells", NAME);
  const cellMenus = page.getByRole("button", { name: new RegExp(`^Ações da célula de ${NAME}`) });
  await expect(cellMenus.first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Excluir/ })).toHaveCount(0);
  const cellCount = await cellMenus.count();
  expect(cellCount).toBe(4); // a célula de Rui foi excluída
  for (let i = 0; i < cellCount; i++) {
    const group = cellMenus.nth(i).locator("xpath=..");
    // Os rótulos trazem a célula do card, como o do "⋯".
    const leader = (await cellMenus.nth(i).getAttribute("aria-label"))?.replace("Ações da célula de ", "") ?? "";
    await expect(group.getByRole("button", { name: `Novo relatório da célula de ${leader}`, exact: true })).toBeVisible();
    await expect(group.getByRole("button", { name: `Editar a célula de ${leader}`, exact: true })).toBeVisible();
    await expectTouchTargets(group, `célula ${i + 1}`);
  }
  await cellMenus.first().click();
  await expect(page.getByRole("menuitem", { name: "Excluir célula" })).toBeVisible();
  await page.keyboard.press("Escape");

  await openList(page, "/cell-reports", NAME);
  const reportMenus = page.getByRole("button", { name: /^Ações do relatório de/ });
  await expect(reportMenus.first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Excluir/ })).toHaveCount(0);
  const reportCount = await reportMenus.count();
  expect(reportCount).toBe(3);
  let deletedCellCards = 0;
  for (let i = 0; i < reportCount; i++) {
    const group = reportMenus.nth(i).locator("xpath=..");
    await expectTouchTargets(group, `relatório ${i + 1}`);
    const card = group.locator("xpath=..");
    // Os rótulos trazem a data e o líder do card, como o do "⋯".
    const reportOf = (await reportMenus.nth(i).getAttribute("aria-label"))?.replace("Ações do relatório de ", "") ?? "";
    if ((await card.getByText("Célula excluída").count()) > 0) {
      deletedCellCards++;
      await expect(card).toContainText(RUI);
      await expect(group.getByRole("button", { name: /^Editar o relatório/ })).toHaveCount(0);
    } else {
      await expect(group.getByRole("button", { name: `Editar o relatório de ${reportOf}`, exact: true })).toBeVisible();
    }
  }
  expect(deletedCellCards).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("UX-12 (360×640, fonte 200%): as confirmações de célula e de relatório rolam por dentro, com margem, texto à esquerda e botões alcançáveis", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await login(page, env.admin);

  await openList(page, "/cells", TEO);
  await largeFont(page);
  await page.getByRole("button", { name: `Ações da célula de ${TEO}` }).click();
  await page.getByRole("menuitem", { name: "Excluir célula" }).click();
  let dialog = page.getByRole("alertdialog");
  const cellMetrics = await expectDialogFitsSmallScreen(page, dialog, ["Marcar como inativa", "Cancelar", "Excluir célula"], "confirmação de célula");
  expect(cellMetrics.scrollHeight, "a confirmação de célula precisa rolar com a fonte em 200%").toBeGreaterThan(cellMetrics.clientHeight);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();

  await openList(page, "/cell-reports", TEO);
  await largeFont(page);
  await page.getByRole("button", { name: `Ações do relatório de ${shown(weekStart)} da célula de ${TEO}` }).click();
  await page.getByRole("menuitem", { name: "Excluir relatório" }).click();
  dialog = page.getByRole("alertdialog");
  await expectDialogFitsSmallScreen(page, dialog, ["Cancelar", "Excluir relatório"], "confirmação de relatório");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  expect(sql(env, `SELECT count(*) FROM public.cell_reports WHERE id = ${lit(report(3))} AND deleted_at IS NULL`)).toBe("1");
  expect(sql(env, `SELECT count(*) FROM public.cells WHERE id = ${lit(cell(3))} AND deleted_at IS NULL`)).toBe("1");
});

test("RN-11 e UX-25 (AD): o relatório da célula excluída tem o badge, não tem 'Editar' e pode ser excluído; os participantes ficam guardados", async ({
  page,
}) => {
  await login(page, env.admin);
  await openList(page, "/cell-reports", RUI);
  const row = page.getByRole("row", { name: new RegExp(RUI) });
  await expect(row.getByText("Célula excluída")).toBeVisible();
  await expect(row.getByRole("button", { name: /^Editar o relatório/ })).toHaveCount(0);

  await row.getByRole("button", { name: `Excluir o relatório de ${shown(weekStart)} da célula de ${RUI}` }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: `Excluir o relatório de ${shown(weekStart)} da célula de ${RUI}?` })).toBeVisible();
  await dialog.getByRole("button", { name: "Excluir relatório" }).click();
  await expect(toast(page, "Relatório excluído.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  await expect(page.getByText("Nenhum relatório encontrado")).toBeVisible();
  expect(sql(env, `SELECT (deleted_at IS NOT NULL)::text FROM public.cell_reports WHERE id = ${lit(report(1))}`)).toBe("true");
  expect(participantsOf(report(1)), "RN-01: os participantes ficam guardados com o relatório excluído").toBe(ANA);
});

test("RN-12 (AD): com o relatório da semana, outro é recusado; excluído o relatório, a célula de Zeca recebe outro relatório na mesma semana", async ({
  page,
}) => {
  await login(page, env.admin);

  async function newReportForZeca() {
    await openList(page, "/cells", ZECA);
    await page.getByRole("button", { name: `Novo relatório da célula de ${ZECA}` }).click();
    const form = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
    await expect(form.getByLabel("Data *")).toHaveValue(weekStart);
    await form.getByLabel("Tema da Palavra").fill(`${NAME} tema novo`);
    await form.getByRole("button", { name: "Salvar" }).click();
    return form;
  }

  let form = await newReportForZeca();
  // O aviso traz só a mensagem, sem um título repetido.
  await expect(toast(page, "Já existe um relatório dessa célula nesta semana (domingo a sábado).")).toBeVisible();
  await expect(toast(page, "Erro ao salvar")).toHaveCount(0);
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Cancelar" }).click();

  await openList(page, "/cell-reports", ZECA);
  await page.getByRole("button", { name: `Excluir o relatório de ${shown(weekStart)} da célula de ${ZECA}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir relatório" }).click();
  await expect(toast(page, "Relatório excluído.")).toBeVisible();

  form = await newReportForZeca();
  await expect(toast(page, "Relatório salvo com sucesso")).toBeVisible();
  await expect(form).toBeHidden();
  expect(
    sql(
      env,
      `SELECT count(*) FILTER (WHERE deleted_at IS NULL) || '|' || count(*) FILTER (WHERE deleted_at IS NOT NULL)
         FROM public.cell_reports WHERE cell_id = ${lit(cell(2))} AND public.week_start(date) = ${lit(weekStart)}`,
    ),
  ).toBe("1|1");
});

test("RN-13 e UX-29 (AD): editar o relatório com Sara excluída a mantém fora do seletor, na linha só de leitura, e no relatório depois de salvar, numa chamada só de participantes e sem DELETE", async ({
  page,
}) => {
  await login(page, env.admin);
  await openList(page, "/cell-reports", TEO);
  await page.getByRole("button", { name: `Editar o relatório de ${shown(weekStart)} da célula de ${TEO}` }).click();
  const form = page.getByRole("dialog", { name: "Editar Relatório" });

  const keptLine = `Continuam no relatório (cadastros excluídos): ${SARA}.`;
  await expect(form.getByText(keptLine)).toBeVisible();
  await expect(form.getByRole("button", { name: `Remover ${ANA}` })).toBeVisible();
  await expect(form.getByRole("button", { name: `Remover ${SARA}` })).toHaveCount(0);

  const participantsField = form.getByLabel("Participantes (Membros)");
  expect(await optionsFor(page, participantsField, `${NAME} Sa`)).toEqual([]);
  await participantsField.click();
  await participantsField.pressSequentially(BIA);
  await page.getByRole("option", { name: BIA }).click();
  await participantsField.press("Escape");
  await form.getByLabel("Tema da Palavra").fill(`${NAME} tema Teo editado`);
  // Critério de pronto 6: uma chamada só para os participantes, e nenhum DELETE.
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/rest/v1/") && request.method() !== "GET") writes.push(`${request.method()} ${path}`);
  });
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, "Relatório salvo com sucesso")).toBeVisible();
  await expect(form).toBeHidden();
  expect(writes.filter((write) => write.includes("participants"))).toEqual(["POST /rest/v1/rpc/set_cell_report_participants"]);
  expect(writes.filter((write) => write.startsWith("DELETE"))).toEqual([]);

  expect(participantsOf(report(3))).toBe([ANA, BIA, SARA].sort().join(","));
  expect(sql(env, `SELECT theme FROM public.cell_reports WHERE id = ${lit(report(3))}`)).toBe(`${NAME} tema Teo editado`);

  await page.getByRole("button", { name: `Editar o relatório de ${shown(weekStart)} da célula de ${TEO}` }).click();
  const reopened = page.getByRole("dialog", { name: "Editar Relatório" });
  await expect(reopened.getByText(keptLine)).toBeVisible();
  await expect(reopened.getByRole("button", { name: `Remover ${BIA}` })).toBeVisible();
  await expect(reopened.getByRole("button", { name: `Remover ${SARA}` })).toHaveCount(0);
  await reopened.getByRole("button", { name: "Cancelar" }).click();
});

test("UX-05 (AD): 'Marcar como inativa' grava só a situação da célula de Eli, fecha com 'Célula marcada como inativa.' e não exclui; inativa, a confirmação não traz mais o aviso", async ({
  page,
}) => {
  await login(page, env.admin);
  await openList(page, "/cells", ELI);
  await page.getByRole("button", { name: `Excluir a célula de ${ELI}`, exact: true }).click();
  let dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Quarta, 20:00 · Rua QA, 4")).toBeVisible();
  await expect(dialog.getByText("Se a célula só parou de se reunir, prefira marcá-la como inativa.")).toBeVisible();
  await dialog.getByRole("button", { name: "Marcar como inativa" }).click();

  await expect(toast(page, "Célula marcada como inativa.")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(sql(env, `SELECT is_active::text || '|' || (deleted_at IS NULL)::text FROM public.cells WHERE id = ${lit(cell(4))}`)).toBe("false|true");

  await page.getByRole("button", { name: `Excluir a célula de ${ELI}`, exact: true }).click();
  dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Excluir célula" })).toBeEnabled();
  await expect(dialog.getByText(/prefira marcá-la como inativa/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
});

test("RN-02 (LE) e UX-07: LE exclui a célula de Fábio (sem 'Marcar como inativa', que pede editar), vê 'Célula excluída.' sem 'Desfazer', e em Relatórios tem 'Excluir' sem 'Editar'", async ({
  page,
}) => {
  await login(page, LE);
  await openList(page, "/cells", FABIO);
  await page.getByRole("button", { name: `Excluir a célula de ${FABIO}`, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Se a célula só parou de se reunir, prefira marcá-la como inativa.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Marcar como inativa" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Excluir célula" }).click();

  await expect(toast(page, "Célula excluída.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  await expect(page.getByText("Nenhuma célula encontrada")).toBeVisible();
  expect(sql(env, `SELECT (deleted_at IS NOT NULL AND deleted_by = ${lit(member(90))})::text FROM public.cells WHERE id = ${lit(cell(5))}`)).toBe("true");

  await openList(page, "/cell-reports", TEO);
  const row = page.getByRole("row", { name: new RegExp(TEO) });
  await expect(row.getByRole("button", { name: `Excluir o relatório de ${shown(weekStart)} da célula de ${TEO}` })).toBeVisible();
  await expect(row.getByRole("button", { name: /^Editar o relatório/ })).toHaveCount(0);
});
