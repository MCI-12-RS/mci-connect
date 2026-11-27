import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  authIdOf,
  createAuthUser,
  deleteAuthUser,
  e2eEnv,
  expectNoButtonOverflow,
  largeFont,
  lit,
  login,
  openList,
  rpcAs,
  rpcsAs,
  sql,
  trackRestRequests,
  type E2EEnv,
} from "./exclusao-support";

// A consulta do relatório de célula excluída (E2.01, PR 4, T7: RN-11, RN-09 b, RN-13), com as regras
// da consulta do E2.12 (T10 a T12; RN-16, RN-17): ela abre em toda linha, para todos que veem o
// relatório. Personas AD (Administrador), LE (edit_cell_report, sem manage_roles) e MB (sem
// edit_cell_report). Ver e2e/exclusao-support.ts para as variáveis.
//
// Cria a própria massa fictícia ("QA4 Ver Rel …", ids e2e201e0-…), com um
// relatório de 1.051 participantes, e as contas de LE e MB; apaga tudo no fim
// (também no começo, se uma execução anterior parou no meio). As buscas usam
// sempre o prefixo: outras sessões criam massa na mesma stack.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e201e0";
const NAME = "QA4 Ver Rel";
const PASSWORD = "Qa4VerRel#2026";
const id = (kind: number, n: number) => `${PREFIX}-${String(kind).padStart(4, "0")}-0000-0000-${String(n).padStart(12, "0")}`;
const member = (n: number) => id(1, n);
/** Celular único por cadastro da massa: todo cadastro novo precisa de um identificador (E2.04, RN-08). */
const mobileOf = (n: number) => `5193204${String(n).padStart(4, "0")}`;
const cell = (n: number) => id(2, n);
const report = (n: number) => id(3, n);
const role = (n: number) => id(4, n);
const who = (name: string) => `${NAME} ${name}`;

const LE = { email: "le.qa4-ver@teste.invalid", password: PASSWORD };
const MB = { email: "mb.qa4-ver@teste.invalid", password: PASSWORD };

const CARLOS = who("Carlos Lima");
const ANA = who("Ana Souza");
const SARA = who("Sara Reis");
const BRUNO = who("Bruno Lima");
const ALVARO = who("Álvaro Dias");
const RUI = who("Rui Prado");
const YARA = who("Yara Neves");
const ZULEICA = who("Zuleica Zanetti");
const HUGO = who("Hugo Prado");

// Célula de Carlos (excluída): R1 realizado e completo, R2 "não houve célula",
// R3 sem dados, R4 para a corrida. Célula de Rui (não excluída): R5. Célula de
// Yara (excluída): R6, com 1.050 participantes "Part NNNN" e Zuleica. Célula de
// Hugo (excluída, restaurada no meio do teste): R7.
const R1 = report(1);
const R2 = report(2);
const R3 = report(3);
const R4 = report(4);
const R5 = report(5);
const R6 = report(6);
const R7 = report(7);
const VOLUME = 1050;
const partName = (n: number) => who(`Part ${String(n).padStart(4, "0")}`);
const partId = (n: number) => member(1000 + n);

let env: E2EEnv;
let adminId = "";
const authIds: { le?: string; mb?: string } = {};
const dates: Record<string, string> = {};

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_id::text LIKE '${PREFIX}%'
         OR entity_id IN (SELECT r.id FROM public.cell_reports r WHERE r.cell_id::text LIKE '${PREFIX}%')
         OR metadata ->> 'member_id' LIKE '${PREFIX}%'
         OR metadata::text LIKE '%${PREFIX}%'
         OR entity_label LIKE '%${NAME}%'
         OR actor_user_id IN (SELECT u.id FROM auth.users u WHERE u.email IN (${lit(LE.email)}, ${lit(MB.email)}));
     DELETE FROM public.cell_report_participants
      WHERE member_id::text LIKE '${PREFIX}%'
         OR report_id IN (SELECT r.id FROM public.cell_reports r WHERE r.id::text LIKE '${PREFIX}%' OR r.cell_id::text LIKE '${PREFIX}%');
     DELETE FROM public.cell_reports WHERE id::text LIKE '${PREFIX}%' OR cell_id::text LIKE '${PREFIX}%';
     DELETE FROM public.cells WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     COMMIT;`,
  );
}

/** As contas de LE e MB, pela Admin API (apaga identidades, sessões e tokens junto). */
async function removeAccounts() {
  const ids = sql(env, `SELECT id FROM auth.users WHERE email IN (${lit(LE.email)}, ${lit(MB.email)})`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  adminId = authIdOf(env, env.admin.email);
  authIds.le = await createAuthUser(env, LE.email, LE.password);
  authIds.mb = await createAuthUser(env, MB.email, MB.password);
  const parts = Array.from({ length: VOLUME }, (_, i) => `(${lit(partId(i + 1))}, ${lit(partName(i + 1))}, 'M', false, true, ${lit(role(3))})`);
  const partLinks = Array.from({ length: VOLUME }, (_, i) => `(${lit(R6)}, ${lit(partId(i + 1))})`);
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES
       (${lit(role(1))}, '${NAME} LE'), (${lit(role(2))}, '${NAME} MB'), (${lit(role(3))}, '${NAME} Membro');
     INSERT INTO public.role_permissions (role_id, permission)
     SELECT ${lit(role(1))}::uuid, p::public.permission_action
       FROM unnest(ARRAY['view_dashboard', 'view_all_reports', 'edit_cell_report', 'delete_cell_report']) p
     UNION ALL
     SELECT ${lit(role(2))}::uuid, p::public.permission_action FROM unnest(ARRAY['view_dashboard', 'view_all_reports']) p
     UNION ALL SELECT ${lit(role(3))}::uuid, 'view_dashboard'::public.permission_action;
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, auth_user_id, role_id, email) VALUES
       (${lit(member(90))}, ${lit(who("Lia Lopes"))}, 'F', false, true, ${lit(authIds.le)}, ${lit(role(1))}, ${lit(LE.email)}),
       (${lit(member(91))}, ${lit(who("Mauro Melo"))}, 'M', false, true, ${lit(authIds.mb)}, ${lit(role(2))}, ${lit(MB.email)});
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id, mobile_whatsapp) VALUES
       (${lit(member(1))}, ${lit(CARLOS)}, 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(1))}),
       (${lit(member(2))}, ${lit(ANA)}, 'F', false, true, ${lit(role(3))}, ${lit(mobileOf(2))}),
       (${lit(member(3))}, ${lit(SARA)}, 'F', false, true, ${lit(role(3))}, ${lit(mobileOf(3))}),
       (${lit(member(4))}, ${lit(BRUNO)}, 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(4))}),
       (${lit(member(5))}, ${lit(ALVARO)}, 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(5))}),
       (${lit(member(6))}, ${lit(RUI)}, 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(6))}),
       (${lit(member(7))}, ${lit(YARA)}, 'F', false, true, ${lit(role(3))}, ${lit(mobileOf(7))}),
       (${lit(member(8))}, ${lit(ZULEICA)}, 'F', false, true, ${lit(role(3))}, ${lit(mobileOf(8))}),
       (${lit(member(9))}, ${lit(HUGO)}, 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(9))});
     INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active, street, number, neighborhood) VALUES
       (${lit(cell(1))}, ${lit(member(1))}, ${lit(member(1))}, ${lit(member(1))}, 'Evangelística', 'Quarta', '20:00', true, 'Rua QA4 das Flores', '120', 'Centro'),
       (${lit(cell(2))}, ${lit(member(6))}, ${lit(member(6))}, ${lit(member(6))}, 'Discipulado', 'Quarta', '20:00', true, 'Rua QA4 do Sol', '45', 'Centro'),
       (${lit(cell(3))}, ${lit(member(7))}, ${lit(member(7))}, ${lit(member(7))}, 'Evangelística', 'Quarta', '20:00', true, 'Rua QA4 da Lua', '7', 'Centro'),
       (${lit(cell(4))}, ${lit(member(9))}, ${lit(member(9))}, ${lit(member(9))}, 'Discipulado', 'Quarta', '20:00', true, 'Rua QA4 do Mar', '9', 'Centro');
     SET LOCAL session_replication_role = replica;
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id) VALUES
       ${parts.join(",\n       ")};
     INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, reason_not_held, observations, visitors, offering) VALUES
       (${lit(R1)}, ${lit(cell(1))}, public.week_start(public.sp_today()) - 4, '20:00', '${NAME} Fé que move montanhas', true, NULL,
        '${NAME} Trazer a lista de oração', '{João,Maria,"  "}', 1234.5),
       (${lit(R2)}, ${lit(cell(1))}, public.week_start(public.sp_today()) - 11, '20:00', NULL, false, '${NAME} Chuva forte',
        '${NAME} Remarcada para sábado', '{}', NULL),
       (${lit(R3)}, ${lit(cell(1))}, public.week_start(public.sp_today()) - 18, '20:00', NULL, true, NULL, NULL, '{}', NULL),
       (${lit(R4)}, ${lit(cell(1))}, public.week_start(public.sp_today()) - 25, '20:00', '${NAME} corrida', true, NULL, NULL, '{}', 10),
       (${lit(R5)}, ${lit(cell(2))}, public.week_start(public.sp_today()) - 4, '20:00', '${NAME} tema de Rui', true, NULL, NULL, '{}', 20),
       (${lit(R6)}, ${lit(cell(3))}, public.week_start(public.sp_today()) - 4, '20:00', '${NAME} volume', true, NULL, NULL, '{}', 5),
       (${lit(R7)}, ${lit(cell(4))}, public.week_start(public.sp_today()) - 4, '20:00', '${NAME} restaurada', true, NULL, NULL, '{}', 7);
     INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
       (${lit(R1)}, ${lit(member(1))}), (${lit(R1)}, ${lit(member(2))}), (${lit(R1)}, ${lit(member(3))}),
       (${lit(R1)}, ${lit(member(4))}), (${lit(R1)}, ${lit(member(5))}),
       (${lit(R5)}, ${lit(member(6))}),
       (${lit(R6)}, ${lit(member(8))}),
       ${partLinks.join(",\n       ")};
     COMMIT;`,
  );
  // As exclusões pela API, como o administrador: Sara (participante de R1) e as células de Carlos e de Yara.
  rpcsAs(env, adminId, [
    `public.delete_member(${lit(member(3))})`,
    `public.delete_cell(${lit(cell(1))})`,
    `public.delete_cell(${lit(cell(3))})`,
    `public.delete_cell(${lit(cell(4))})`,
  ]);
  for (const r of [R1, R2, R3, R4, R5, R6, R7]) {
    dates[r] = sql(env, `SELECT to_char(date, 'DD/MM/YYYY') FROM public.cell_reports WHERE id = ${lit(r)}`);
  }
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cell_reports WHERE id::text LIKE '${PREFIX}%' OR cell_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cell_report_participants WHERE member_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR entity_label LIKE '%${NAME}%')
          + (SELECT count(*) FROM auth.users WHERE email IN (${lit(LE.email)}, ${lit(MB.email)}))
          + (SELECT count(*) FROM auth.identities WHERE identity_data ->> 'email' IN (${lit(LE.email)}, ${lit(MB.email)}))`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

// ---------------------------------------------------------------------------
// Rótulos e partes da tela.

// A consulta abre em toda linha, pelo nome do líder (E2.12, P91).
const viewName = (r: string, leader: string) => `Ver o relatório de ${dates[r]}, ${leader}`;
const editName = (r: string, leader: string) => `Editar o relatório de ${dates[r]} da célula de ${leader}`;
const deleteName = (r: string, leader: string) => `Excluir o relatório de ${dates[r]} da célula de ${leader}`;
const actionsName = (r: string, leader: string) => `Ações do relatório de ${dates[r]} da célula de ${leader}`;

const NOTICE = "A célula deste relatório foi excluída. Restaure a célula para editar o relatório.";
const NOT_FOUND = "Ele não existe, foi excluído ou não está disponível para você.";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** O painel "Relatório" (o `Sheet` do Radix tem role="dialog"). */
const sheet = (page: Page) => page.getByRole("dialog");

/** O valor (`dd`) de um campo do painel, pelo nome (`dt`). */
const field = (dialog: Locator, label: string) =>
  dialog.locator(`xpath=.//dt[normalize-space(.)=${JSON.stringify(label)}]/following-sibling::dd[1]`);

/** Os nomes de uma lista da consulta (P94): o `ul` ligado ao `h3` "Participantes (N)". */
const names = (dialog: Locator, heading: string) => dialog.getByRole("list", { name: heading }).getByRole("listitem");

/** O "R$" do Intl vem com espaço inseparável. */
const normalizeSpaces = (text: string) => text.replace(/\u00a0/g, " ");

/** Os parâmetros da URL atual, como objeto. */
const urlParams = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

/** Ordem alfabética em pt-BR (acentos e maiúsculas não separam). */
const ptBR = new Intl.Collator("pt-BR");

/** Espera o painel parar de deslizar e devolve a largura e a borda direita. */
async function settledBox(dialog: Locator) {
  let last = "";
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      const now = box ? `${Math.round(box.x)}:${Math.round(box.width)}` : "";
      const stable = now !== "" && now === last;
      last = now;
      return stable;
    }, { intervals: [100, 150, 200, 250] })
    .toBe(true);
  const box = await dialog.boundingBox();
  if (!box) throw new Error("painel sem caixa");
  return box;
}

/** O painel ocupa a largura `width`, encostado na borda direita. */
async function expectSheetWidth(page: Page, width: number, label: string) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("sem viewport");
  const box = await settledBox(sheet(page));
  expect(Math.round(box.width), `${label}: largura do painel`).toBe(width);
  expect(Math.round(box.x + box.width), `${label}: encostado à direita`).toBe(viewport.width);
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth, `${label}: sem rolagem lateral`).toBeLessThanOrEqual(viewport.width);
}

/** Abre Relatórios buscando `search` e espera a lista. */
const openReports = (page: Page, search: string, extra = "") => openList(page, "/cell-reports", search, extra);

// ---------------------------------------------------------------------------
// UX-26 do E2.01, com a consulta do E2.12 (P91): toda linha abre a consulta pelo nome do líder.

test("RN-11 (AD, 1280 px): na linha de célula excluída, sem 'Editar' e com a lixeira; a consulta abre pelo nome, com o aviso e 'Ver células excluídas'", async ({
  page,
}) => {
  await login(page, env.admin);
  await openReports(page, NAME);

  const view = button(page, viewName(R1, CARLOS));
  const trash = button(page, deleteName(R1, CARLOS));
  await expect(view).toBeVisible();
  await expect(trash).toBeVisible();
  await expect(button(page, editName(R1, CARLOS))).toHaveCount(0);
  const row = page.getByRole("row").filter({ has: view });
  await expect(row).toContainText("Célula excluída");
  // Toda linha abre a consulta, inclusive a da célula não excluída, que continua com "Editar".
  await expect(button(page, viewName(R5, RUI))).toBeVisible();
  await expect(button(page, editName(R5, RUI))).toBeVisible();
  await expect(page.getByRole("row").filter({ has: button(page, editName(R5, RUI)) })).not.toContainText("Célula excluída");

  await trash.click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(`${deleteName(R1, CARLOS)}?`);
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toHaveCount(0);

  await view.click();
  const dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  await expect(dialog.getByRole("note")).toHaveText(`${NOTICE}Ver células excluídas`);
  // Sem "Editar relatório" e sem "Ver célula"; "Excluir relatório" continua (RN-16 c).
  await expect(dialog.getByRole("button", { name: "Editar relatório" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: /^Ver a célula/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Excluir relatório" })).toBeVisible();
  const toDeletedCells = dialog.getByRole("link", { name: "Ver células excluídas" });
  await expect(toDeletedCells).toHaveAttribute("href", `/cells/deleted?${new URLSearchParams({ q: CARLOS })}`);
  await toDeletedCells.click();
  await expect(page).toHaveURL((url) => url.pathname === "/cells/deleted" && url.searchParams.get("q") === CARLOS);
  await expect(page.getByRole("heading", { level: 1, name: "Células excluídas" })).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
});

test("UX-26 (AD, 360×800): o cartão de célula excluída abre a consulta, com o '⋯' fora do botão; o painel ocupa a tela, o 'Fechar' tem 44 px e o foco volta ao cartão", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, env.admin);
  await openReports(page, NAME);

  const open = button(page, viewName(R1, CARLOS));
  await expect(open).toBeVisible();
  const card = page.getByRole("listitem").filter({ has: open });
  await expect(card).toContainText("Célula excluída");
  const menu = button(page, actionsName(R1, CARLOS));
  await expect(menu).toBeVisible();
  expect(await open.evaluate((el, label) => el.contains(document.querySelector(`[aria-label="${label}"]`)), actionsName(R1, CARLOS))).toBe(false);
  await expect(button(page, editName(R1, CARLOS))).toHaveCount(0);
  await menu.click();
  await expect(page.getByRole("menuitem", { name: "Excluir relatório" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem")).toHaveCount(0);

  await open.click();
  const dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  await expectSheetWidth(page, 360, "360 px");
  await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);
  const close = dialog.getByRole("button", { name: "Fechar", exact: true });
  const closeBox = await close.boundingBox();
  expect(closeBox && closeBox.width >= 43.5 && closeBox.height >= 43.5, "'Fechar' com 44×44 px").toBe(true);
  await close.click();
  await expect(dialog).toHaveCount(0);
  expect(urlParams(page)).toEqual({ q: NAME });
  await expect(open).toBeFocused();
});

test("UX-12 e UX-40 (AD): em 360×640 com a fonte em 200%, a consulta rola por dentro, sem rolagem lateral; em 320 px, ocupa a tela e nenhum botão estoura a largura", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await login(page, env.admin);
  await openReports(page, NAME, `&report=${R1}`);
  await largeFont(page);
  const dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  await expect(names(dialog, "Participantes (5)").filter({ hasText: SARA })).toHaveCount(1);
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth, "sem rolagem lateral").toBeLessThanOrEqual(360);
  for (const target of [dialog.getByRole("link", { name: "Ver células excluídas" }), field(dialog, "Observações")]) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 640 && box.x + box.width <= 360, "alcançável na tela").toBe(true);
  }
  await expectNoButtonOverflow(page, dialog, "consulta em 360 px, fonte 200%");

  await page.setViewportSize({ width: 320, height: 640 });
  await page.reload();
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  await expectSheetWidth(page, 320, "320 px");
  await expectNoButtonOverflow(page, dialog, "consulta em 320 px");
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("RN-11 (LE, edit_cell_report sem manage_roles): a consulta tem o aviso, sem 'Ver células excluídas'; 'Excluir relatório' continua", async ({ page }) => {
  await login(page, LE);
  await openReports(page, NAME);
  await expect(button(page, editName(R1, CARLOS))).toHaveCount(0);
  await expect(button(page, deleteName(R1, CARLOS))).toBeVisible();
  const view = button(page, viewName(R1, CARLOS));
  await view.click();
  const dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  await expect(dialog.getByRole("note")).toHaveText(NOTICE);
  await expect(names(dialog, "Participantes (5)").filter({ hasText: SARA })).toHaveCount(1);
  await expect(dialog.getByText("Ver células excluídas")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(view).toBeFocused();
});

test("RN-16 (MB, sem edit_cell_report): a consulta do relatório de célula excluída abre para quem vê o relatório, sem rodapé de edição nem de exclusão", async ({
  page,
}) => {
  await login(page, MB);
  await openReports(page, NAME, `&size=10&report=${R1}`);
  const dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  await expect(dialog.getByText("Célula excluída").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^(Editar|Excluir) relatório$/ })).toHaveCount(0);
  expect(urlParams(page)).toEqual({ q: NAME, size: "10", report: R1 });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL((url) => !url.searchParams.has("report"));
  await expect(page.getByRole("button", { name: /^(Editar|Excluir) o relatório de / })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// A consulta (T10, T11).

test.describe("navegador em Honolulu (UTC−10)", () => {
  test.use({ timezoneId: "Pacific/Honolulu" });

  test("RN-16, RN-17 e RN-13 do E2.01 (AD): a data e a hora de Brasília, o tema, os participantes em ordem alfabética com Sara (excluída) só pelo nome, os visitantes, a oferta e as observações", async ({
    page,
  }) => {
    await login(page, env.admin);
    await openReports(page, `${NAME} Fé que move`);
    await button(page, viewName(R1, CARLOS)).click();

    const dialog = sheet(page);
    await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
    await expect(dialog.getByText("Célula excluída", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Célula realizada", { exact: true })).toBeVisible();
    // A data do relatório (coluna sem fuso) não muda com o navegador em outro fuso.
    await expect(field(dialog, "Data e horário")).toHaveText(`Quarta, ${dates[R1]} às 20:00`);
    await expect(field(dialog, "Tema")).toHaveText(`${NAME} Fé que move montanhas`);
    const expected = [CARLOS, ANA, SARA, BRUNO, ALVARO].sort(new Intl.Collator("pt-BR", { sensitivity: "base" }).compare);
    expect(expected[0], "a ordem pt-BR põe Álvaro antes de Ana").toBe(ALVARO);
    await expect(names(dialog, "Participantes (5)")).toHaveText(expected);
    await expect(dialog.getByRole("list", { name: "Participantes (5)" }).getByRole("link")).toHaveCount(0);
    // O visitante em branco não conta.
    await expect(names(dialog, "Visitantes (2)")).toHaveText(["João", "Maria"]);
    expect(normalizeSpaces(await field(dialog, "Oferta").innerText())).toBe("R$ 1.234,50");
    await expect(field(dialog, "Observações")).toHaveText(`${NAME} Trazer a lista de oração`);
    await expect(dialog.getByRole("button", { name: "Editar relatório" })).toHaveCount(0);
  });
});

test("RN-16 (AD): 'Não houve célula' mostra a Reunião prevista e o Motivo, sem tema, participantes, visitantes e oferta; o relatório sem dados mostra 'Participantes (0)' com 'Nenhum membro.' e a oferta não informada", async ({
  page,
}) => {
  await login(page, env.admin);
  await openReports(page, NAME);

  await button(page, viewName(R2, CARLOS)).click();
  let dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R2]}`);
  await expect(dialog.getByText("Não houve célula", { exact: true })).toBeVisible();
  await expect(field(dialog, "Reunião prevista")).toHaveText(`Quarta, ${dates[R2]} às 20:00`);
  await expect(field(dialog, "Motivo")).toHaveText(`${NAME} Chuva forte`);
  await expect(field(dialog, "Observações")).toHaveText(`${NAME} Remarcada para sábado`);
  await expect(field(dialog, "Tema")).toHaveCount(0);
  await expect(field(dialog, "Oferta")).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: /^Participantes/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await button(page, viewName(R3, CARLOS)).click();
  dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R3]}`);
  await expect(dialog.getByRole("heading", { name: "Participantes (0)" })).toBeVisible();
  await expect(dialog).toContainText("Nenhum membro.");
  await expect(dialog.getByRole("heading", { name: "Visitantes (0)" })).toBeVisible();
  await expect(dialog).toContainText("Nenhum visitante.");
  await expect(field(dialog, "Oferta")).toHaveText("Não informada");
  await expect(field(dialog, "Observações")).toHaveCount(0);
});

test("UX-22 (AD): ?report= reabre a consulta ao recarregar, com q e size; aberta pela linha, fechar volta a entrada e devolve o foco; depois de recarregar, fechar tira o parâmetro e o foco vai para o h1; 512 px a partir de 640 px", async ({
  page,
}) => {
  await login(page, env.admin);
  await openReports(page, NAME, "&size=10");
  const view = button(page, viewName(R1, CARLOS));
  await view.click();
  await expect(sheet(page)).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  expect(urlParams(page)).toEqual({ q: NAME, size: "10", report: R1 });
  await expectSheetWidth(page, 512, "1280 px");

  await sheet(page).getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(urlParams(page)).toEqual({ q: NAME, size: "10" });
  await expect(view).toBeFocused();

  await view.click();
  await expect(sheet(page)).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  await page.reload();
  await expect(sheet(page)).toHaveAccessibleName(`Relatório de ${dates[R1]}`);
  await expect(names(sheet(page), "Participantes (5)").filter({ hasText: SARA })).toHaveCount(1);
  expect(urlParams(page)).toEqual({ q: NAME, size: "10", report: R1 });
  await expect(page.locator("#cell-reports-search")).toHaveValue(NAME);

  await page.setViewportSize({ width: 639, height: 800 });
  await expectSheetWidth(page, 639, "639 px");
  await page.setViewportSize({ width: 640, height: 800 });
  await expectSheetWidth(page, 512, "640 px");

  // O histórico guarda a origem: a entrada reaberta por recarregar ainda é da linha, e fechar a volta.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  expect(urlParams(page)).toEqual({ q: NAME, size: "10" });
});

test("UX-23 (AD): ?report= de relatório de célula não excluída também abre a consulta, com 'Editar relatório'", async ({ page }) => {
  await login(page, env.admin);
  await openReports(page, NAME, `&size=10&report=${R5}`);
  const dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R5]}`);
  await expect(dialog.getByRole("button", { name: "Editar relatório" }).first()).toBeAttached();
  expect(urlParams(page)).toEqual({ q: NAME, size: "10", report: R5 });
});

test("RN-11 e 'Estados' (AD, lista grande): o relatório com 1.051 participantes mostra todos, em ordem alfabética, sem o corte de 1.000 do PostgREST", async ({
  page,
}) => {
  await login(page, env.admin);
  const requests = trackRestRequests(page);
  await openReports(page, YARA);
  await button(page, viewName(R6, YARA)).click();

  const dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R6]}`);
  const total = VOLUME + 1;
  const list = names(dialog, `Participantes (${total})`);
  await expect(list).toHaveCount(total);
  await expect(list.first()).toHaveText(partName(1));
  await expect(list.nth(1000)).toHaveText(partName(1001));
  await expect(list.last()).toHaveText(ZULEICA);
  const listed = await list.allTextContents();
  expect(listed, "ordem alfabética").toEqual([...listed].sort(ptBR.compare));
  expect(new Set(listed).size, "sem repetição").toBe(total);
  // Dois blocos: 0 a 999 e 1000 a 1999.
  const blocks = requests.filter((url) => url.includes("cell_report_participants_view"));
  expect(blocks.some((url) => /offset=1000\b/.test(url)), `bloco a partir de 1.000: ${blocks.join(" | ")}`).toBe(true);
  // A linha mostra o mesmo número de participantes.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row").filter({ has: button(page, viewName(R6, YARA)) })).toContainText(String(total));
});

test("T12 (AD, corrida): o relatório excluído com a consulta aberta, depois de recarregar, mostra 'Relatório não encontrado' e 'Fechar'; a lista recarrega sem ele", async ({
  page,
}) => {
  await login(page, env.admin);
  await openReports(page, NAME);
  await button(page, viewName(R4, CARLOS)).click();
  await expect(sheet(page)).toHaveAccessibleName(`Relatório de ${dates[R4]}`);

  // Outra sessão exclui o relatório (o de célula excluída também pode ser excluído, RN-11).
  rpcAs(env, adminId, `public.delete_cell_report(${lit(R4)})`);
  expect(sql(env, `SELECT (deleted_at IS NOT NULL)::text FROM public.cell_reports WHERE id = ${lit(R4)}`)).toBe("true");

  await page.reload();
  const dialog = sheet(page);
  await expect(dialog).toContainText(NOT_FOUND);
  await expect(dialog).toHaveAccessibleName("Relatório não encontrado");
  await dialog.getByRole("button", { name: "Fechar", exact: true }).filter({ hasText: "Fechar" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL((url) => !url.searchParams.has("report"));
  // A lista (fora da árvore de acessibilidade enquanto o painel estava aberto) já veio sem R4.
  await expect(button(page, viewName(R1, CARLOS))).toHaveCount(1);
  await expect(button(page, viewName(R4, CARLOS))).toHaveCount(0);
  await expect(page.getByText(`${NAME} corrida`)).toHaveCount(0);
});

test("RN-17 do E2.01 (AD, corrida): com a célula restaurada no meio tempo, recarregar reabre a consulta sem o aviso e com 'Editar relatório'; a linha volta a ter 'Editar'", async ({
  page,
}) => {
  await login(page, env.admin);
  await openReports(page, HUGO, "&size=10");
  await button(page, viewName(R7, HUGO)).click();
  await expect(sheet(page)).toHaveAccessibleName(`Relatório de ${dates[R7]}`);
  await expect(sheet(page).getByRole("note")).toBeVisible();

  rpcAs(env, adminId, `public.restore_cell(${lit(cell(4))})`);
  await page.reload();

  const dialog = sheet(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R7]}`);
  await expect(dialog.getByRole("note")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Editar relatório" }).first()).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(button(page, editName(R7, HUGO))).toBeVisible();
  await expect(page.getByRole("row").filter({ has: button(page, editName(R7, HUGO)) })).not.toContainText("Célula excluída");
});

// Defeito encontrado pelo QA (QA-E201-PR4-1): num link direto para um relatório
// que não está na página da lista, "Tentar de novo" fecha o painel enquanto
// consulta de novo (cerca de 7 s, com as 3 tentativas do React Query) e o
// reabre com o resultado. Fica por último: a spec roda em série.
test("QA-E201-PR4-1 'Estados' (AD, link direto, erro ao carregar): 'Tentar de novo' mantém o painel aberto até o resultado, sem fechar, e o foco fica no painel", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page, env.admin);
  // A leitura do relatório e dos participantes falha até `failing` virar false.
  let failing = true;
  await page.route(/\/rest\/v1\/(cell_reports_view\?select=id(%2C|,)cell_id|cell_report_participants_view)/, (route) =>
    failing ? route.abort("failed") : route.continue(),
  );
  // Um link direto para R1, com uma busca em que R1 não aparece (como um link compartilhado para um relatório antigo).
  await openReports(page, `${NAME} nada`, `&report=${R1}`);
  const dialog = sheet(page);
  const retry = dialog.getByRole("button", { name: "Tentar de novo" });
  await expect(retry).toBeVisible({ timeout: 30000 });
  await expect(dialog).toContainText("Não foi possível carregar o relatório. Verifique a conexão e tente de novo.");

  // Daqui em diante, o painel não pode fechar (nem por um instante) enquanto consulta de novo.
  await page.evaluate(() => {
    const w = window as unknown as { __sheetClosed?: boolean };
    w.__sheetClosed = false;
    const check = () => {
      const d = document.querySelector('[role="dialog"]');
      if (!d || d.getAttribute("data-state") !== "open") w.__sheetClosed = true;
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
  });
  const sheetClosed = () => page.evaluate(() => (window as unknown as { __sheetClosed?: boolean }).__sheetClosed === true);
  const focusInSheet = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

  // A rede continua fora: a nova tentativa falha de novo, com o painel aberto.
  await retry.click();
  await expect(retry).toBeVisible({ timeout: 30000 });
  expect(await sheetClosed(), "'Tentar de novo' (falhando de novo): o painel ficou aberto").toBe(false);
  expect(await focusInSheet(), "'Tentar de novo' (falhando de novo): o foco ficou no painel").toBe(true);

  // A rede volta: o relatório aparece, sem o painel fechar.
  failing = false;
  await retry.click();
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dates[R1]}`, { timeout: 30000 });
  await expect(names(dialog, "Participantes (5)").filter({ hasText: SARA })).toHaveCount(1);
  expect(await sheetClosed(), "'Tentar de novo' (com a rede de volta): o painel ficou aberto").toBe(false);
  expect(await focusInSheet(), "'Tentar de novo' (com a rede de volta): o foco ficou no painel").toBe(true);
  expect(urlParams(page)).toEqual({ q: `${NAME} nada`, report: R1 });
});
