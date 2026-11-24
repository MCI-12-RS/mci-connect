import { test, expect, type Page } from "@playwright/test";
import {
  adminMemberName,
  authIdOf,
  e2eEnv,
  expectNoButtonOverflow,
  lit,
  login,
  openDeleted,
  openList,
  rpcAs,
  rpcsAs,
  sql,
  toast,
  trackRestRequests,
  type E2EEnv,
} from "./exclusao-support";

// Células e relatórios excluídos e restauração (E2.01, PR 3): RN-15, RN-17 e
// RN-19 e os critérios UX-15, UX-16, UX-21, UX-23 e UX-40, com a persona AD
// (Administrador). Ver e2e/exclusao-support.ts para as variáveis.
//
// Cria a própria massa fictícia ("QA3 Exc Cel …", ids e2e201d0-…), exclui
// pela API e apaga tudo no fim (também no começo, se uma execução anterior
// parou no meio). As buscas usam sempre o prefixo: outras sessões criam
// excluídos na mesma stack.

const PREFIX = "e2e201d0";
const NAME = "QA3 Exc Cel";
const id = (kind: number, n: number) => `${PREFIX}-${String(kind).padStart(4, "0")}-0000-0000-${String(n).padStart(12, "0")}`;
const member = (n: number) => id(1, n);
const cell = (n: number) => id(2, n);
const report = (n: number) => id(3, n);
const who = (name: string) => `${NAME} ${name}`;

const RUI = who("Rui Prado");
const QUINTINO = who("Quintino Reis");
const CARLOS = who("Carlos Lima");
const DAVI = who("Davi Melo");
const HELIO = who("Hélio Souza");
const ZECA = who("Zeca Prado");
const PAULO = who("Paulo Pag");
const OTAVIO = who("Otávio Nunes");
const ESTELA = who("Estela Rios");

// Relatórios de Zeca: R desta semana (com S lançado depois), o da semana passada e o de duas semanas atrás.
const R_TAKEN = report(10);
const S_TAKEN = report(11);
const R_LAST = report(12);
const R_RACE = report(13);
const S_RACE = report(14);
const CARLOS_REPORT = report(1);
const PAG = Array.from({ length: 11 }, (_, i) => i + 1);
const pagReport = (n: number) => report(20 + n);

let env: E2EEnv;
let adminId = "";
let adminName = "";

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_id::text LIKE '${PREFIX}%'
         OR entity_id IN (SELECT r.id FROM public.cell_reports r WHERE r.cell_id::text LIKE '${PREFIX}%')
         OR metadata ->> 'member_id' LIKE '${PREFIX}%';
     DELETE FROM public.cell_report_participants
      WHERE member_id::text LIKE '${PREFIX}%'
         OR report_id IN (SELECT r.id FROM public.cell_reports r WHERE r.id::text LIKE '${PREFIX}%' OR r.cell_id::text LIKE '${PREFIX}%');
     DELETE FROM public.cell_reports WHERE id::text LIKE '${PREFIX}%' OR cell_id::text LIKE '${PREFIX}%';
     DELETE FROM public.cells WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     COMMIT;`,
  );
}

test.beforeAll(() => {
  env = e2eEnv();
  cleanup();
  adminId = authIdOf(env, env.admin.email);
  adminName = adminMemberName(env);
  const people: Array<[number, string, "M" | "F"]> = [
    [1, RUI, "M"],
    [2, who("Tito Lima"), "M"],
    [3, QUINTINO, "M"],
    [4, CARLOS, "M"],
    [6, DAVI, "M"],
    [7, HELIO, "M"],
    [8, ZECA, "M"],
    [9, PAULO, "M"],
    [10, OTAVIO, "M"],
    [11, ESTELA, "F"],
  ];
  const pagReports = PAG.map(
    (n) => `(${lit(pagReport(n))}, ${lit(cell(5))}, public.week_start(public.sp_today()) - ${7 * (n + 2) - 3}, '20:00', '${NAME} pag ${n}', true)`,
  );
  sql(
    env,
    `BEGIN;
     INSERT INTO public.members (id, name, gender, has_leadership, is_active) VALUES
       ${people.map(([n, name, gender]) => `(${lit(member(n))}, ${lit(name)}, '${gender}', false, true)`).join(",\n       ")};
     INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active, street, number, neighborhood) VALUES
       (${lit(cell(1))}, ${lit(member(1))}, ${lit(member(2))}, ${lit(member(3))}, 'Evangelística', 'Quarta', '20:00', true, 'Rua QA3 das Flores', '120', 'Centro'),
       (${lit(cell(2))}, ${lit(member(4))}, NULL, ${lit(member(4))}, 'Discipulado', 'Sexta', '19:30', true, 'Rua QA3 do Sol', '45', 'Centro'),
       (${lit(cell(3))}, ${lit(member(6))}, NULL, ${lit(member(7))}, 'Evangelística', 'Terça', '20:00', true, 'Rua QA3 da Lua', '7', 'Centro'),
       (${lit(cell(4))}, ${lit(member(8))}, NULL, ${lit(member(8))}, 'Evangelística', 'Domingo', '18:00', true, 'Rua QA3 do Mar', '9', 'Centro'),
       (${lit(cell(5))}, ${lit(member(9))}, NULL, ${lit(member(9))}, 'Evangelística', 'Quarta', '20:00', true, 'Rua QA3 do Rio', '3', 'Centro'),
       (${lit(cell(6))}, ${lit(member(10))}, NULL, ${lit(member(10))}, 'Macrocélula', 'Sábado', '16:00', true, 'Rua QA3 da Serra', '2', 'Centro'),
       (${lit(cell(7))}, ${lit(member(11))}, NULL, ${lit(member(11))}, 'Discipulado', 'Quinta', '19:00', true, 'Rua QA3 do Vale', '8', 'Centro');
     SET LOCAL session_replication_role = replica;
     INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held) VALUES
       (${lit(CARLOS_REPORT)}, ${lit(cell(2))}, public.week_start(public.sp_today()) - 16, '19:30', '${NAME} tema de Carlos', true),
       (${lit(R_TAKEN)}, ${lit(cell(4))}, public.week_start(public.sp_today()), '18:00', '${NAME} tema R', true),
       (${lit(R_LAST)}, ${lit(cell(4))}, public.week_start(public.sp_today()) - 7, '18:00', '${NAME} tema passado', true),
       (${lit(R_RACE)}, ${lit(cell(4))}, public.week_start(public.sp_today()) - 14, '18:00', '${NAME} tema retrasado', false),
       ${pagReports.join(",\n       ")};
     COMMIT;`,
  );
  // As exclusões pela API, como o administrador: a célula de Rui antes do anfitrião dela (RN-04).
  rpcsAs(env, adminId, [
    ...[R_TAKEN, R_LAST, R_RACE, ...PAG.map(pagReport)].map((r) => `public.delete_cell_report(${lit(r)})`),
    ...[1, 2, 3, 6, 7].map((n) => `public.delete_cell(${lit(cell(n))})`),
    `public.delete_member(${lit(member(3))})`,
  ]);
  // S: lançado depois, na mesma semana de R. Data e autor fixos onde o teste confere a ordem e o texto.
  const admin = `(SELECT id FROM public.members WHERE auth_user_id = ${lit(adminId)})`;
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held)
     VALUES (${lit(S_TAKEN)}, ${lit(cell(4))}, public.week_start(public.sp_today()) + 1, '18:00', '${NAME} tema S', true);
     UPDATE public.cells SET deleted_at = '2026-11-12T13:05:00Z', deleted_by = ${admin} WHERE id = ${lit(cell(1))};
     UPDATE public.cells SET deleted_at = '2026-11-15T18:00:00Z', deleted_by = NULL WHERE id = ${lit(cell(2))};
     UPDATE public.cells SET deleted_at = '2026-11-18T01:30:00Z', deleted_by = ${admin} WHERE id = ${lit(cell(3))};
     UPDATE public.cells SET deleted_at = '2026-11-05T10:00:00Z', deleted_by = ${admin} WHERE id = ${lit(cell(6))};
     UPDATE public.cells SET deleted_at = '2026-11-04T10:00:00Z', deleted_by = ${admin} WHERE id = ${lit(cell(7))};
     UPDATE public.cell_reports SET deleted_at = '2026-11-23T15:00:00Z', deleted_by = ${admin} WHERE id = ${lit(R_TAKEN)};
     UPDATE public.cell_reports SET deleted_at = '2026-11-22T23:59:00Z', deleted_by = NULL WHERE id = ${lit(R_LAST)};
     UPDATE public.cell_reports SET deleted_at = '2026-11-20T03:00:00Z', deleted_by = ${admin} WHERE id = ${lit(R_RACE)};
     ${PAG.map((n) => `UPDATE public.cell_reports SET deleted_at = timestamptz '2026-10-01T12:00:00Z' + interval '${n} hours' WHERE id = ${lit(pagReport(n))};`).join("\n     ")}
     COMMIT;`,
  );
});

test.afterAll(() => {
  if (!env) return;
  cleanup();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cell_reports WHERE id::text LIKE '${PREFIX}%' OR cell_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.events WHERE entity_id::text LIKE '${PREFIX}%')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

const isDeleted = (table: "cells" | "cell_reports" | "members", rowId: string) =>
  sql(env, `SELECT (deleted_at IS NOT NULL)::text FROM public.${table} WHERE id = ${lit(rowId)}`);

/** "dd/MM/aaaa" da data de um relatório. */
const reportDate = (reportId: string) => sql(env, `SELECT to_char(date, 'DD/MM/YYYY') FROM public.cell_reports WHERE id = ${lit(reportId)}`);

/** O texto da primeira coluna de cada linha da tabela (desktop), na ordem. */
const firstColumn = (page: Page) => page.locator("tbody tr td:first-child").allTextContents();

/** Segura as chamadas de uma RPC até `release()`: para ver o estado "Restaurando…". */
async function holdRpc(page: Page, fn: string) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/rest/v1/rpc/${fn}`, async (route) => {
    await gate;
    await route.continue();
  });
  return () => release();
}

test("RN-15 e UX-15 (AD, desktop): Células e Relatórios excluídos vão da exclusão mais recente para a mais antiga, com data e hora de Brasília e o autor", async ({
  page,
}) => {
  await login(page, env.admin);
  await openDeleted(page, "/cells/deleted", NAME);
  await expect(page.getByRole("heading", { level: 1, name: "Células excluídas" })).toBeVisible();
  const cells = await firstColumn(page);
  expect(cells.map((text) => text.split(" (")[0].replace(/Anfitrião:.*$/, ""))).toEqual([DAVI, CARLOS, RUI, OTAVIO, ESTELA]);
  await expect(page.getByRole("row", { name: new RegExp(DAVI) })).toContainText(`17/11/2026 22:30${adminName}`);
  await expect(page.getByRole("row", { name: new RegExp(CARLOS) })).toContainText("15/11/2026 15:00Não registrado");
  const rui = page.getByRole("row", { name: new RegExp(RUI) });
  await expect(rui).toContainText(`12/11/2026 10:05${adminName}`);
  await expect(rui).toContainText(`Anfitrião: ${QUINTINO} (cadastro excluído)`);
  await expect(rui).toContainText("Quarta · 20:00");
  await expect(page.getByText("5 células excluídas")).toBeVisible();

  await openDeleted(page, "/cell-reports/deleted", ZECA);
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios excluídos" })).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(reportDate(R_TAKEN));
  await expect(rows.nth(0)).toContainText(`23/11/2026 12:00${adminName}`);
  await expect(rows.nth(0)).toContainText("Já há outro relatório desta célula na mesma semana.");
  await expect(rows.nth(1)).toContainText(reportDate(R_LAST));
  await expect(rows.nth(1)).toContainText("22/11/2026 20:59Não registrado");
  await expect(rows.nth(2)).toContainText(reportDate(R_RACE));
  await expect(rows.nth(2)).toContainText(`20/11/2026 00:00${adminName}`);
  await expect(rows.nth(2)).toContainText("Não realizada");
  await expect(page.getByText("3 relatórios excluídos")).toBeVisible();
});

test("UX-16: abaixo de 768 px, cards de célula e de relatório com 'Célula de {Líder}' primeiro e 'Restaurar' com texto e 44 px; a partir de 768 px, tabelas", async ({
  page,
}) => {
  await login(page, env.admin);
  await page.setViewportSize({ width: 767, height: 900 });

  await openDeleted(page, "/cells/deleted", DAVI);
  await expect(page.locator("table")).toHaveCount(0);
  const cellCard = page.locator("main li").first();
  await expect(cellCard.locator("p").first()).toHaveText(`Célula de ${DAVI}`);
  await expect(cellCard).toContainText("Terça · 20:00 · Evangelística");
  await expect(cellCard).toContainText("Excluída em 17/11/2026 às 22:30");
  await expect(cellCard).toContainText(`por ${adminName}`);
  let button = cellCard.getByRole("button", { name: `Restaurar a célula de ${DAVI}` });
  await expect(button).toHaveText("Restaurar");
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);

  await openDeleted(page, "/cell-reports/deleted", ZECA);
  const reportCard = page.locator("main li").filter({ hasText: "Não realizada" });
  await expect(reportCard.locator("p").first()).toHaveText(`Célula de ${ZECA}`);
  await expect(reportCard).toContainText(`Relatório de ${reportDate(R_RACE)} · 18:00`);
  await expect(reportCard).toContainText("Tema: QA3 Exc Cel tema retrasado");
  await expect(reportCard).toContainText("Excluído em 20/11/2026 às 00:00");
  button = reportCard.getByRole("button", { name: `Restaurar o relatório de ${reportDate(R_RACE)}` });
  await expect(button).toHaveText("Restaurar");
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator("table")).toHaveCount(1);
  await expect(page.locator("main li")).toHaveCount(0);
  await openDeleted(page, "/cells/deleted", DAVI);
  await expect(page.locator("table")).toHaveCount(1);
});

test("RN-17 e UX-23 (AD): a célula de Rui, cujo anfitrião Quintino foi excluído, é recusada sem chamar o servidor; 'Ver membros excluídos' abre a lista com ele", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, env.admin);
  await openDeleted(page, "/cells/deleted", RUI);
  const card = page.locator("main li").filter({ hasText: `Célula de ${RUI}` });
  await expect(card).toContainText(`Anfitrião: ${QUINTINO} (cadastro excluído)`);

  const requests = trackRestRequests(page);
  await card.getByRole("button", { name: `Restaurar a célula de ${RUI}` }).click();
  const dialog = page.getByRole("alertdialog", { name: `Não é possível restaurar a célula de ${RUI}` });
  await expect(dialog).toContainText(
    `Não é possível restaurar a célula: o anfitrião ${QUINTINO} foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.`,
  );
  const action = dialog.getByRole("button", { name: "Ver membros excluídos" });
  await expect(action).toBeFocused();
  expect(requests.filter((url) => url.includes("rpc/restore_")), "sem chamar o servidor").toEqual([]);
  expect(isDeleted("cells", cell(1))).toBe("true");

  await action.click();
  await expect(page).toHaveURL(/\/members\/deleted\?q=/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(QUINTINO);
  await expect(page.getByRole("textbox", { name: "Buscar membros excluídos" })).toHaveValue(QUINTINO);
  await expect(page.locator("main li").filter({ hasText: QUINTINO })).toHaveCount(1);
});

test("RN-17 e UX-23 (AD): o anfitrião Hélio é excluído depois de a lista carregar; o servidor recusa a célula de Davi, com a mensagem e 'Ver membros excluídos'", async ({
  page,
}) => {
  await login(page, env.admin);
  await openDeleted(page, "/cells/deleted", DAVI);
  await expect(page.getByRole("row", { name: new RegExp(DAVI) })).not.toContainText("cadastro excluído");

  rpcAs(env, adminId, `public.delete_member(${lit(member(7))})`);
  const requests = trackRestRequests(page);
  await page.getByRole("button", { name: `Restaurar a célula de ${DAVI}` }).click();

  const dialog = page.getByRole("alertdialog", { name: `Não é possível restaurar a célula de ${DAVI}` });
  await expect(dialog).toContainText(`Não é possível restaurar a célula: o anfitrião ${HELIO} foi excluído.`);
  expect(requests.filter((url) => url.includes("rpc/restore_cell")).length, "uma chamada ao servidor").toBe(1);
  expect(isDeleted("cells", cell(3))).toBe("true");
  await dialog.getByRole("button", { name: "Ver membros excluídos" }).click();
  await expect(page).toHaveURL(/\/members\/deleted\?q=/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(HELIO);
  await expect(page.getByRole("row", { name: new RegExp(HELIO) })).toBeVisible();
});

test("RN-17 (AD): a célula de Carlos, com as pessoas não excluídas, volta às listas e aos totais, e os relatórios dela voltam a poder ser editados", async ({
  page,
}) => {
  const totalCells = () => sql(env, `SELECT total_cells FROM public.members WHERE id = ${lit(member(4))}`);
  const reportLabel = `Editar o relatório de ${reportDate(CARLOS_REPORT)} da célula de ${CARLOS}`;
  expect(totalCells(), "com a célula excluída, Carlos não tem célula").toBe("0");
  await login(page, env.admin);
  await openList(page, "/cell-reports", CARLOS);
  const row = page.getByRole("row", { name: new RegExp(CARLOS) });
  await expect(row).toContainText("Célula excluída");
  await expect(page.getByRole("button", { name: reportLabel })).toHaveCount(0);

  await openDeleted(page, "/cells/deleted", CARLOS);
  await page.getByRole("button", { name: `Restaurar a célula de ${CARLOS}` }).click();
  await expect(toast(page, "Célula restaurada.")).toBeVisible();
  await expect(page.getByText("Nenhuma célula excluída encontrada para esta busca.")).toBeVisible();
  expect(isDeleted("cells", cell(2))).toBe("false");
  expect(totalCells(), "restaurada, ela volta aos totais").toBe("1");

  await openList(page, "/cells", CARLOS);
  await expect(page.getByRole("row", { name: new RegExp(CARLOS) })).toBeVisible();
  await openList(page, "/cell-reports", CARLOS);
  await expect(page.getByRole("row", { name: new RegExp(CARLOS) })).not.toContainText("Célula excluída");
  await expect(page.getByRole("button", { name: reportLabel })).toBeVisible();
});

test("RN-17 e UX-23 (AD, 360 px): R desta semana, com S lançado depois, é recusado sem chamar o servidor; 'Ver relatórios da célula' busca pelo líder", async ({
  page,
}) => {
  const date = reportDate(R_TAKEN);
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, env.admin);
  await openDeleted(page, "/cell-reports/deleted", ZECA);
  const card = page.locator("main li").filter({ hasText: `Relatório de ${date}` });
  await expect(card).toContainText("Já há outro relatório desta célula na mesma semana.");

  const requests = trackRestRequests(page);
  await card.getByRole("button", { name: `Restaurar o relatório de ${date}` }).click();
  const dialog = page.getByRole("alertdialog", { name: `Não é possível restaurar o relatório de ${date}` });
  await expect(dialog).toContainText("Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.");
  const action = dialog.getByRole("button", { name: "Ver relatórios da célula" });
  await expect(action).toBeFocused();
  expect(requests.filter((url) => url.includes("rpc/restore_")), "sem chamar o servidor").toEqual([]);
  expect(isDeleted("cell_reports", R_TAKEN)).toBe("true");

  await action.click();
  await expect(page).toHaveURL(/\/cell-reports\?q=/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(ZECA);
  await expect(page.getByText("Carregando...")).toHaveCount(0);
  // O mais recente primeiro: S, o relatório que ocupa a semana.
  await expect(page.locator("main").getByText(reportDate(S_TAKEN)).first()).toBeVisible();
});

test("RN-17 (AD): R e S de duas semanas atrás, com S lançado depois de a lista carregar; o servidor recusa 'na mesma semana', e nada muda", async ({
  page,
}) => {
  const date = reportDate(R_RACE);
  await login(page, env.admin);
  await openDeleted(page, "/cell-reports/deleted", ZECA);
  await expect(page.getByRole("row").filter({ hasText: date })).not.toContainText("Já há outro relatório");

  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held)
     VALUES (${lit(S_RACE)}, ${lit(cell(4))}, public.week_start(public.sp_today()) - 13, '18:00', '${NAME} tema S retrasado', true);
     COMMIT;`,
  );
  await page.getByRole("button", { name: `Restaurar o relatório de ${date}` }).click();
  const dialog = page.getByRole("alertdialog", { name: `Não é possível restaurar o relatório de ${date}` });
  await expect(dialog).toContainText("Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.");
  await expect(dialog.getByRole("button", { name: "Ver relatórios da célula" })).toBeFocused();
  expect(isDeleted("cell_reports", R_RACE)).toBe("true");
  // A lista recarrega e passa a avisar.
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("row").filter({ hasText: date })).toContainText("Já há outro relatório desta célula na mesma semana.");
});

test("RN-17 (AD): R, de uma semana que já passou e sem outro relatório nela, volta mesmo fora da semana atual", async ({ page }) => {
  const date = reportDate(R_LAST);
  await login(page, env.admin);
  await openDeleted(page, "/cell-reports/deleted", ZECA);
  await page.getByRole("button", { name: `Restaurar o relatório de ${date}` }).click();

  await expect(toast(page, "Relatório restaurado.")).toBeVisible();
  await expect(page.getByRole("button", { name: `Restaurar o relatório de ${date}` })).toHaveCount(0);
  expect(isDeleted("cell_reports", R_LAST)).toBe("false");
  await openList(page, "/cell-reports", ZECA);
  await expect(page.locator("main").getByText(date).first()).toBeVisible();
});

test("UX-21 (AD): só o botão do item fica 'Restaurando…' e indisponível; no sucesso, o item sai, a página se ajusta e aparece 'Relatório restaurado.'", async ({
  page,
}) => {
  await login(page, env.admin);
  await openDeleted(page, "/cell-reports/deleted", PAULO, "&size=10&page=2");
  await expect(page.getByText("11 relatórios excluídos")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);

  // Página 2, com um item só: restaurado, a lista volta para a página 1.
  let release = await holdRpc(page, "restore_cell_report");
  const oldest = reportDate(pagReport(1));
  const only = page.getByRole("button", { name: `Restaurar o relatório de ${oldest}` });
  await only.click();
  await expect(only).toHaveText("Restaurando…");
  await expect(only).toHaveAttribute("aria-disabled", "true");
  release();
  await expect(toast(page, "Relatório restaurado.")).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]page=2/);
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.getByText("10 relatórios excluídos")).toBeVisible();
  expect(isDeleted("cell_reports", pagReport(1))).toBe("false");
  await page.unroute("**/rest/v1/rpc/restore_cell_report");

  // Página 1: enquanto um restaura, os outros continuam livres.
  release = await holdRpc(page, "restore_cell_report");
  const newest = reportDate(pagReport(11));
  const target = page.getByRole("button", { name: `Restaurar o relatório de ${newest}` });
  await target.click();
  await expect(target).toHaveText("Restaurando…");
  await expect(target).toHaveAttribute("aria-disabled", "true");
  const others = page.locator("tbody tr").filter({ hasNotText: newest }).getByRole("button");
  await expect(others).toHaveCount(9);
  for (const button of await others.all()) {
    await expect(button).toHaveText("Restaurar");
    await expect(button).not.toHaveAttribute("aria-disabled");
  }
  release();
  await expect(page.getByRole("button", { name: `Restaurar o relatório de ${newest}` })).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(9);
  await expect(page.getByText("9 relatórios excluídos")).toBeVisible();
  await page.unroute("**/rest/v1/rpc/restore_cell_report");
});

test("RN-15 (AD): restaurar a célula de Otávio, que outra pessoa já restaurou, mostra 'Esta célula não está excluída.' como aviso informativo, e a lista recarrega", async ({
  page,
}) => {
  await login(page, env.admin);
  await openDeleted(page, "/cells/deleted", OTAVIO);
  const button = page.getByRole("button", { name: `Restaurar a célula de ${OTAVIO}` });
  await expect(button).toBeVisible();

  rpcAs(env, adminId, `public.restore_cell(${lit(cell(6))})`);
  await button.click();
  const notice = toast(page, "Esta célula não está excluída.");
  await expect(notice).toBeVisible();
  await expect(notice).not.toHaveClass(/destructive/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("Nenhuma célula excluída encontrada para esta busca.")).toBeVisible();
});

test("RN-19 (AD): a Auditoria mostra dois registros da célula de Estela, a exclusão e a restauração, cada um com o autor e o horário", async ({
  page,
}) => {
  await login(page, env.admin);
  await openDeleted(page, "/cells/deleted", ESTELA);
  await page.getByRole("button", { name: `Restaurar a célula de ${ESTELA}` }).click();
  await expect(toast(page, "Célula restaurada.")).toBeVisible();

  const actor = sql(env, `SELECT actor_label FROM public.events WHERE entity_id = ${lit(cell(7))} AND action = 'restore'`);
  expect(actor, "o autor da restauração").not.toBe("");
  await page.goto("/events");
  await page.getByPlaceholder("Autor, entidade, descrição...").fill(ESTELA);
  // A célula de Estela tem a criação, a exclusão e a restauração; o cadastro dela, só a criação.
  const rows = page.getByRole("row").filter({ hasText: `célula de ${ESTELA}` });
  await expect(rows).toHaveCount(3);
  const restoreRow = rows.filter({ hasText: "Restauração" });
  const deleteRow = rows.filter({ hasText: "Exclusão" });
  await expect(restoreRow).toHaveCount(1);
  await expect(deleteRow).toHaveCount(1);
  await expect(rows.first()).toContainText("Restauração");
  for (const row of [restoreRow, deleteRow]) {
    await expect(row).toContainText(actor);
    await expect(row).toContainText("Célula");
    await expect(row).toContainText(/\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}/);
  }
});

test("UX-40 (320 px): nas listas de células e relatórios excluídos e nos bloqueios, nenhum botão com nome estoura a largura", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page, env.admin);

  await openDeleted(page, "/cells/deleted", NAME);
  await expect(page.locator("main li").first()).toBeVisible();
  await expectNoButtonOverflow(page, page.locator("main"), "células excluídas");
  await page.getByRole("button", { name: `Restaurar a célula de ${RUI}` }).click();
  let dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Ver membros excluídos" })).toBeVisible();
  await expectNoButtonOverflow(page, dialog, "bloqueio da célula");
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(dialog).toBeHidden();

  await openDeleted(page, "/cell-reports/deleted", NAME);
  await expect(page.locator("main li").first()).toBeVisible();
  await expectNoButtonOverflow(page, page.locator("main"), "relatórios excluídos");
  await page.getByRole("button", { name: `Restaurar o relatório de ${reportDate(R_TAKEN)}` }).click();
  dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Ver relatórios da célula" })).toBeVisible();
  await expectNoButtonOverflow(page, dialog, "bloqueio do relatório");
  expect(isDeleted("cell_reports", R_TAKEN)).toBe("true");
});
