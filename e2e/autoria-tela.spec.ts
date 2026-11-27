import { test, expect, type Page } from "@playwright/test";
import {
  adminMemberName,
  callRpc,
  createAuthUser,
  deleteAuthUser,
  e2eEnv,
  largeFont,
  lit,
  login,
  openDeleted,
  openList,
  sql,
  toast,
  type E2EEnv,
} from "./exclusao-support";

// E2.05 (PR 3, autoria na tela), na stack local, pela tela:
//   - RN-01, RN-02, RN-07, UX-03, UX-05: o bloco no topo do registro aberto, com quem cadastrou e quem
//     alterou por último; o autor só como texto; nada no cadastro novo;
//   - RN-08: o nome atual do autor, também depois de renomeado e de excluído;
//   - RN-10 e RN-11, UX-10: autores do sistema anterior, gravados em `replica`, com a marca;
//   - UX-04: o relatório enviado mostra só "Enviado por"; incluir um participante mostra "Alterado por";
//   - UX-06 e UX-07: "Ver histórico" só para quem audita, com "Descartar as alterações?" quando há
//     mudança; o "voltar" leva à lista de antes, com o formulário fechado;
//   - UX-28: 320 px com a fonte em 200%, sem corte nem rolagem lateral.
// Massa fictícia "Tela Autoria …", apagada no começo e no fim. Roda em série (`--workers=1`).

test.describe.configure({ mode: "serial" });
test.use({ timezoneId: "America/Sao_Paulo" });

const NAME = "Tela Autoria";
const PREFIX = "e2e205c3";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;

const TARGET = { id: id(1, 1), name: `${NAME} Alvo`, mobile: "51977730001" };
const CHANGED = { id: id(1, 2), name: `${NAME} Mudado`, mobile: "51977730002" };
const AUTHOR = { id: id(1, 3), name: `${NAME} Xis`, mobile: "51977730003" };
const LEGACY = { id: id(1, 4), name: `${NAME} Legado`, mobile: "51977730004" };
const LEADER = { id: id(1, 5), name: `${NAME} Lider`, mobile: "51977730005" };
const PEOPLE = ["Ana", "Bia", "Caio", "Davi", "Eva", "Fabio", "Gil", "Hugo", "Ivo"].map((first, i) => ({
  id: id(2, i + 1),
  name: `${NAME} ${first}`,
  mobile: `519777400${String(i + 1).padStart(2, "0")}`,
}));
const MEMBER_USER = { email: "e2e205c3-davi@example.com", password: "TelaAutoria2026x", name: `${NAME} Usuario`, mobile: "51977730009" };
const CELL = id(3, 1);
const OLD_REPORT_1 = id(4, 1);
const OLD_REPORT_2 = id(4, 2);

let env: E2EEnv;
let admin = "";
let memberUserId = "";

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_label LIKE '%${NAME}%' OR description LIKE '%${NAME}%'
         OR entity_id IN (SELECT id FROM public.cell_reports WHERE cell_id = ${lit(CELL)}) OR entity_id = ${lit(CELL)};
     DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id = ${lit(CELL)});
     DELETE FROM public.cell_reports WHERE cell_id = ${lit(CELL)};
     DELETE FROM private.cell_active_periods WHERE cell_id = ${lit(CELL)};
     DELETE FROM public.cells WHERE id = ${lit(CELL)};
     UPDATE public.members SET updated_by = NULL, updated_by_kind = NULL, updated_at = NULL WHERE updated_by IN (SELECT id FROM public.members WHERE name LIKE '${NAME}%');
     DELETE FROM public.members WHERE name LIKE '${NAME}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
     COMMIT;
     SELECT private.rebuild_member_hierarchy();`,
  );
}

async function seed() {
  const adminId = sql(env, `SELECT m.id FROM public.members m JOIN auth.users u ON u.id = m.auth_user_id WHERE u.email = ${lit(env.admin.email)}`);
  const member = (p: { id: string; name: string; mobile: string }, leader: string) =>
    `(${lit(p.id)}, ${lit(p.name)}, 'M', false, true, ${lit(leader)}, true, ${lit(p.mobile)}, (SELECT id FROM public.roles WHERE is_default))`;
  const today = `(ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'])[extract(dow FROM public.sp_today())::int + 1]`;
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, role_id)
     VALUES ${[TARGET, CHANGED, AUTHOR, LEADER].map((p) => member(p, adminId)).join(", ")};
     INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, role_id)
     VALUES ${PEOPLE.map((p) => member(p, LEADER.id)).join(", ")};
     INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, street, number, neighborhood, is_active)
     VALUES (${lit(CELL)}, ${lit(LEADER.id)}, ${lit(LEADER.id)}, ${lit(LEADER.id)}, 'Evangelística', ${today}, '00:00', 'Rua Autoria', '10', 'Centro', true);
     -- RN-08: "Mudado" foi alterado pelo "Xis" (gravado como o carimbo gravaria).
     BEGIN;
     SET LOCAL session_replication_role = replica;
     UPDATE public.members SET updated_by = ${lit(AUTHOR.id)}, updated_by_kind = 'member', updated_at = '2026-11-20 13:15:00+00'
      WHERE id = ${lit(CHANGED.id)};
     -- RN-10: um cadastro do sistema anterior (data de cadastro em Brasília 10/03/2023 14:00).
     INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, role_id,
                                 created_at, created_by_kind, created_by_legacy, updated_at, updated_by_kind, updated_by_legacy)
     VALUES (${lit(LEGACY.id)}, ${lit(LEGACY.name)}, 'M', false, true, ${lit(adminId)}, true, ${lit(LEGACY.mobile)},
             (SELECT id FROM public.roles WHERE is_default),
             '2023-03-10 17:00:00+00', 'legacy', 'Maria Alves', '2024-06-05 12:15:00+00', 'legacy', 'João Pires');
     -- RN-11: relatórios excluídos no sistema anterior.
     INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, created_at, created_by_kind, created_by_legacy,
                                      deleted_at, deleted_by_kind, deleted_by_legacy)
     VALUES (${lit(OLD_REPORT_1)}, ${lit(CELL)}, '2025-01-26', '20:00', true, 'Fé', '2025-01-26 23:30:00+00', 'legacy', 'João Pires',
             '2025-02-02 13:00:00+00', 'legacy', 'João Pires'),
            (${lit(OLD_REPORT_2)}, ${lit(CELL)}, '2024-05-12', '20:00', true, 'Paz', '2024-05-12 23:30:00+00', 'legacy', 'AdminUser',
             '2024-05-14 21:20:00+00', 'legacy', 'AdminUser');
     COMMIT;
     SELECT private.rebuild_member_hierarchy();`,
  );
  // Quem não audita (a função padrão, Membro): o próprio cadastro, com conta.
  memberUserId = await createAuthUser(env, MEMBER_USER.email, MEMBER_USER.password);
  sql(
    env,
    `INSERT INTO public.members (id, auth_user_id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, email, role_id)
     VALUES (${lit(memberUserId)}, ${lit(memberUserId)}, ${lit(MEMBER_USER.name)}, 'M', false, true, ${lit(adminId)}, true,
             ${lit(MEMBER_USER.mobile)}, ${lit(MEMBER_USER.email)}, (SELECT id FROM public.roles WHERE is_default));`,
  );
}

async function openMemberEdit(page: Page, name: string) {
  await openList(page, "/members", name);
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Editar membro" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Função *" })).toBeVisible();
  return dialog;
}

const authorship = (page: Page) => page.getByRole("dialog").getByTestId("record-authorship");
const BR_DATE_TIME = /em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/;

test.beforeAll(async () => {
  env = e2eEnv();
  const stale = sql(env, `SELECT coalesce((SELECT id::text FROM auth.users WHERE email = ${lit(MEMBER_USER.email)}), '')`);
  cleanup();
  if (stale) await deleteAuthUser(env, stale);
  await seed();
  admin = adminMemberName(env);
});
test.afterAll(async () => {
  if (!env) return;
  cleanup();
  if (memberUserId) await deleteAuthUser(env, memberUserId);
});

test("RN-01, RN-02, UX-03 e UX-05: o cadastro feito pelo Sistema e, depois de salvar, 'Alterado por' quem salvou; o autor só como texto", async ({ page }) => {
  await login(page, env.admin);
  let dialog = await openMemberEdit(page, TARGET.name);
  let block = authorship(page);
  await expect(block).toContainText(/Cadastrado por Sistema em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
  await expect(block).not.toContainText("Alterado");
  // O único link do bloco é "Ver histórico" (UX-05); nenhum botão.
  await expect(block.getByRole("link")).toHaveCount(1);
  await expect(block.getByRole("button")).toHaveCount(0);
  // Antes de "Campos com * são obrigatórios." e do primeiro campo.
  const order = await dialog.evaluate((root) => {
    const blockEl = root.querySelector("[data-testid=record-authorship]");
    const note = Array.from(root.querySelectorAll("p")).find((p) => p.textContent?.includes("Campos com * são obrigatórios."));
    return !!blockEl && !!note && (blockEl.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  expect(order, "a autoria antes da nota dos obrigatórios").toBe(true);

  await dialog.getByLabel("Observações").fill("Alterado pelo teste de autoria");
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
  await expect(dialog).toBeHidden();

  dialog = await openMemberEdit(page, TARGET.name);
  block = authorship(page);
  await expect(block).toContainText(new RegExp(`Alterado por ${admin} em \\d{2}/\\d{2}/\\d{4} às \\d{2}:\\d{2}`));
  // Nenhum dado do autor além do nome (UX-05).
  await expect(block).not.toContainText("@");
});

test("RN-08: o nome atual do autor, depois de renomeado e de excluído", async ({ page }) => {
  await login(page, env.admin);
  await openMemberEdit(page, CHANGED.name);
  await expect(authorship(page)).toContainText(`Alterado por ${AUTHOR.name} em 20/11/2026 às 10:15`);

  sql(env, `UPDATE public.members SET name = ${lit(`${NAME} Xavier`)} WHERE id = ${lit(AUTHOR.id)};`);
  await openMemberEdit(page, CHANGED.name);
  await expect(authorship(page)).toContainText(`Alterado por ${NAME} Xavier em 20/11/2026 às 10:15`);

  sql(env, `BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.members SET deleted_at = now() WHERE id = ${lit(AUTHOR.id)}; COMMIT;`);
  await openMemberEdit(page, CHANGED.name);
  await expect(authorship(page)).toContainText(`Alterado por ${NAME} Xavier em 20/11/2026 às 10:15`);
});

test("RN-10: o cadastro do sistema anterior, com '(sistema anterior)' nas duas linhas", async ({ page }) => {
  await login(page, env.admin);
  await openMemberEdit(page, LEGACY.name);
  const block = authorship(page);
  await expect(block).toContainText("Cadastrado por Maria Alves (sistema anterior) em 10/03/2023 às 14:00");
  await expect(block).toContainText("Alterado por João Pires (sistema anterior) em 05/06/2024 às 09:15");
});

test("RN-11 e UX-10: os relatórios excluídos no sistema anterior, com a marca; 'AdminUser' como 'Administrador'", async ({ page }) => {
  await login(page, env.admin);
  await page.setViewportSize({ width: 360, height: 800 });
  await openDeleted(page, "/cell-reports/deleted", NAME);
  await expect(page.locator("main li").filter({ hasText: "26/01/2025" })).toContainText("por João Pires (sistema anterior)");
  await expect(page.locator("main li").filter({ hasText: "12/05/2024" })).toContainText("por Administrador (sistema anterior)");
  await expect(page.locator("main")).not.toContainText("AdminUser");
});

test("RN-07 e UX-06: quem não audita vê a autoria do próprio cadastro, sem 'Ver histórico'; o cadastro novo não tem autoria", async ({ page }) => {
  await login(page, { email: MEMBER_USER.email, password: MEMBER_USER.password });
  await page.getByRole("button", { name: "Editar meus dados" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar meus dados" });
  await expect(dialog).toBeVisible();
  await expect(authorship(page)).toContainText(/Cadastrado por Sistema em/);
  await expect(authorship(page).getByRole("link")).toHaveCount(0);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());

  await login(page, env.admin);
  await page.goto("/members");
  await page.getByRole("button", { name: "Novo membro" }).click();
  await expect(page.getByRole("dialog", { name: "Novo membro" })).toBeVisible();
  await expect(page.getByTestId("record-authorship")).toHaveCount(0);
});

test("UX-04: o relatório enviado mostra só 'Enviado por'; incluir um participante mostra 'Alterado por'", async ({ page }) => {
  await login(page, env.admin);
  const date = sql(env, `SELECT public.sp_today()::text`);
  const sent = await callRpc(page, env, "save_cell_report", {
    _report_id: null,
    // E2.11: depois da reunião desta semana (hoje, 00:00) e com a oferta (obrigatória na célula realizada).
    _report: { cell_id: CELL, date, time: "00:00", was_held: true, theme: "Autoria", offering: 0 },
    _participant_ids: PEOPLE.slice(0, 8).map((p) => p.id),
  });
  expect(sent.status).toBe(200);
  const reportId = sql(env, `SELECT id FROM public.cell_reports WHERE cell_id = ${lit(CELL)} AND deleted_at IS NULL`);
  const brDate = sql(env, `SELECT to_char(public.sp_today(), 'DD/MM/YYYY')`);

  const openReport = async () => {
    await openList(page, "/cell-reports", LEADER.name);
    await page.getByRole("button", { name: `Editar o relatório de ${brDate} da célula de ${LEADER.name}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Editar Relatório" });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  let dialog = await openReport();
  await expect(authorship(page)).toContainText(new RegExp(`Enviado por ${admin} ${BR_DATE_TIME.source}`));
  await expect(authorship(page)).not.toContainText("Alterado");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const changed = await callRpc(page, env, "save_cell_report", {
    _report_id: reportId,
    _report: {},
    // O líder registrado (automático no envio, RN-11 do E2.11) continua no conjunto final.
    _participant_ids: [LEADER.id, ...PEOPLE.map((p) => p.id)],
  });
  expect(changed.status).toBe(200);
  dialog = await openReport();
  await expect(authorship(page)).toContainText(new RegExp(`Alterado por ${admin} ${BR_DATE_TIME.source}`));
  await expect(dialog.getByRole("link", { name: `Ver histórico do relatório de ${brDate}` })).toBeVisible();
});

test("UX-06 e UX-07: 'Ver histórico' com 44 px no celular; com mudança, 'Descartar as alterações?'; o voltar leva à lista de antes", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, env.admin);
  const dialog = await openMemberEdit(page, TARGET.name);
  const link = dialog.getByRole("link", { name: `Ver histórico de ${TARGET.name}` });
  await expect(link).toHaveAttribute("href", `/events?record_type=member&record_id=${TARGET.id}`);
  expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await dialog.getByLabel("Observações").fill("Mudança não salva");
  await link.click();
  const confirm = page.getByRole("alertdialog", { name: "Descartar as alterações?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Continuar editando" }).click();
  await expect(dialog.getByLabel("Observações")).toHaveValue("Mudança não salva");

  await link.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
  await expect(page).toHaveURL(new RegExp(`/events\\?record_type=member&record_id=${TARGET.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: `Histórico de ${TARGET.name}` })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/members\\?q=${encodeURIComponent(TARGET.name).replace(/%20/g, "(%20|\\+)")}`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("UX-28: em 320 px com a fonte em 200%, a autoria quebra linha sem corte nem rolagem lateral", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page, env.admin);
  await largeFont(page);
  await openMemberEdit(page, LEGACY.name);
  const block = authorship(page);
  await expect(block).toContainText("(sistema anterior)");
  const metrics = await block.evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
    right: element.getBoundingClientRect().right,
  }));
  expect(metrics.scroll, "sem corte").toBeLessThanOrEqual(metrics.client + 1);
  expect(metrics.right, "dentro da tela").toBeLessThanOrEqual(320);
  const link = block.getByRole("link");
  const box = await link.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0), "o botão não estoura").toBeLessThanOrEqual(320);
});

test("UX-07 (ligação real do isDirty): sem alteração, 'Ver histórico' navega direto; com alteração, pede 'Descartar as alterações?' em membro, célula e relatório", async ({ page }) => {
  await login(page, env.admin);
  const expectDirect = async (dialog: ReturnType<Page["getByRole"]>, hrefPart: string) => {
    await dialog.getByRole("link", { name: /^Ver histórico/ }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/events\\?record_type=${hrefPart}`));
  };
  const expectAsks = async (dialog: ReturnType<Page["getByRole"]>) => {
    await dialog.getByRole("link", { name: /^Ver histórico/ }).click();
    await expect(page.getByRole("alertdialog", { name: "Descartar as alterações?" })).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Continuar editando" }).click();
    await expect(page).not.toHaveURL(/\/events/);
  };

  // Membro: sem mudança, direto.
  let dialog = await openMemberEdit(page, TARGET.name);
  await expectDirect(dialog, "member");

  // Célula: com mudança pergunta; sem mudança vai direto.
  await openList(page, "/cells", LEADER.name);
  await page.getByRole("button", { name: `Editar a célula de ${LEADER.name}`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Editar célula" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Complemento").fill("Mudança não salva");
  await expectAsks(dialog);
  await dialog.getByLabel("Complemento").fill("");
  await page.keyboard.press("Escape");
  await page.goto("/cells");
  await openList(page, "/cells", LEADER.name);
  await page.getByRole("button", { name: `Editar a célula de ${LEADER.name}`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Editar célula" });
  await expectDirect(dialog, "cell");

  // Relatório: com mudança pergunta.
  const brDate = sql(env, `SELECT to_char(public.sp_today(), 'DD/MM/YYYY')`);
  await openList(page, "/cell-reports", LEADER.name);
  await page.getByRole("button", { name: `Editar o relatório de ${brDate} da célula de ${LEADER.name}`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Editar Relatório" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Tema da Palavra").fill("Tema não salvo");
  await expectAsks(dialog);
});
