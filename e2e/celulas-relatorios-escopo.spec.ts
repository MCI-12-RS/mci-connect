import AxeBuilder from "@axe-core/playwright";
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, openList, sql, toast, type E2EEnv } from "./exclusao-support";
import { E2E_BASE_URL } from "./base-url";

// Células, Relatórios, Dashboard e Ministérios por escopo e por função (E2.02,
// PR 5, tarefa 17): UX-13, UX-14, UX-23, UX-24, UX-26, UX-27, UX-28, UX-31 e
// RN-03, 04, 12, 13 e 14 com a massa do spec. Login de verdade pela `sign-in`
// (stack local). A massa é fictícia ("QA Celula …", ids e2e202c5-…) e some no
// fim. As três células se reúnem no dia de hoje (Brasília) às 00:00 (E2.11: o
// lançamento só é aceito depois da reunião desta semana, e a data sugerida pelo
// `calculateCellDate` cai na semana passada quando a célula ainda não se
// reuniu). Os relatórios R1 a R3 ficam na semana passada, como no spec. Desde o
// E2.11 PR 2, o lançamento pela API é a `submit_cell_report` e a edição a
// `save_cell_report` (a escrita direta acabou). Rodar com `--workers=1`: a
// `sign_in_throttle` é por origem.

// Sem `mode: "serial"`: cada teste refaz a massa de células e relatórios, e uma falha não deve
// impedir os demais (o Playwright reinicia o worker e roda `beforeAll` de novo).

const PREFIX = "e2e202c5";
const NAME = "QA Celula";
const PASSWORD = "QaCelula#2026";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;
const person = (n: number) => id(1, n);
/** Celular único por cadastro da massa: todo cadastro novo precisa de um identificador (E2.04, RN-08). */
const mobileOf = (n: number) => `5193207${String(n).padStart(4, "0")}`;
const cellId = (n: number) => id(3, n);
const reportId = (n: number) => id(4, n);
const ROLE_ONLY_VIEW_REPORTS = id(2, 1);
const ROLE_SEND_ANY_VISIBLE = id(2, 2);
const ROLE_VIEW_ALL_REPORTS = id(2, 3);
const ROLE_OWN_DATA_ONLY = id(2, 4);
const ROLE_MINISTRY_ONLY = id(2, 5);

type RoleKey = "ADMIN" | "LIDER" | "MEMBRO" | null | string;

interface Who {
  n: number;
  name: string;
  gender: "M" | "F";
  leader: number | null;
  role: RoleKey;
  pastor?: boolean;
  inactive?: boolean;
  login?: boolean;
}

const who = (n: number, name: string, gender: "M" | "F", leader: number | null, role: RoleKey, extra: Partial<Who> = {}): Who => ({
  n,
  name: `${NAME} ${name}`,
  gender,
  leader,
  role,
  ...extra,
});

// n: 1 Samuel, 2 Magda, 3 Pedro, 4 Paula, 5 Tiago, 6 Tânia, 7 André, 8 Beatriz, 9 Caio, 10 Fábio, 11 Carla,
// 12 Débora, 13 Diego, 14 Hugo, 15 Rita, 16 Ester, 17 Lúcia, 18 Gabriel (discípulo de Fábio),
// 19 Helena (timóteo de C3) e 20 Isabel (anfitriã de C3), discípulas de Débora.
const SAMUEL = who(1, "Samuel Luz", "M", null, "LIDER", { pastor: true, login: true });
const MAGDA = who(2, "Magda Luz", "F", null, "LIDER", { pastor: true });
const PEDRO = who(3, "Pedro Dias", "M", 1, "LIDER", { login: true });
const PAULA = who(4, "Paula Dias", "F", 2, "LIDER");
const TIAGO = who(5, "Tiago Melo", "M", 1, "MEMBRO");
const TANIA = who(6, "Tânia Melo", "F", 2, "MEMBRO");
const ANDRE = who(7, "André Souza", "M", 3, "LIDER", { login: true });
const BEATRIZ = who(8, "Beatriz Souza", "F", 6, "MEMBRO");
const CAIO = who(9, "Caio Lima", "M", 7, "MEMBRO", { login: true });
const FABIO = who(10, "Fábio Lima", "M", 7, "MEMBRO", { inactive: true, login: true });
const CARLA = who(11, "Carla Reis", "F", 4, "MEMBRO", { login: true });
const DEBORA = who(12, "Débora Reis", "F", 8, "MEMBRO");
const DIEGO = who(13, "Diego Melo", "M", 5, "LIDER", { login: true });
const HUGO = who(14, "Hugo Melo", "M", 5, null, { login: true });
const RITA = who(15, "Rita Souza", "F", 6, "ADMIN", { login: true });
const ESTER = who(16, "Ester Prado", "F", null, "MEMBRO");
const LUCIA = who(17, "Lúcia Prado", "F", 16, "MEMBRO");
const GABRIEL = who(18, "Gabriel Lima", "M", 10, ROLE_ONLY_VIEW_REPORTS, { login: true });
const HELENA = who(19, "Helena Reis", "F", 12, "MEMBRO");
const ISABEL = who(20, "Isabel Reis", "F", 12, "MEMBRO");
const PEOPLE = [SAMUEL, MAGDA, PEDRO, PAULA, TIAGO, TANIA, ANDRE, BEATRIZ, CAIO, FABIO, CARLA, DEBORA, DIEGO, HUGO, RITA, ESTER, LUCIA, GABRIEL, HELENA, ISABEL];
const COUPLES: Array<[Who, Who]> = [[SAMUEL, MAGDA], [PEDRO, PAULA], [TIAGO, TANIA], [ANDRE, BEATRIZ]];

const emailOf = (w: Who) => `${w.name.split(" ")[2]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.e202c5@teste.invalid`;
const memberId = (w: Who) => person(w.n);

// Células (líder / timóteo / anfitrião) e relatórios da semana passada.
const CELLS = [
  { n: 1, leader: ANDRE, timothy: CAIO, host: CARLA },
  { n: 2, leader: DIEGO, timothy: HUGO, host: CAIO },
  { n: 3, leader: DEBORA, timothy: HELENA, host: ISABEL },
];
const C1 = CELLS[0]!;
const C2 = CELLS[1]!;
const C3 = CELLS[2]!;
const REPORT_PARTICIPANTS: Record<number, Who[]> = { 1: [ANDRE, CAIO, CARLA], 2: [DIEGO, HUGO, CAIO], 3: [DEBORA, HELENA, ISABEL] };

const PERMISSIONS: Record<string, string[]> = {
  [ROLE_ONLY_VIEW_REPORTS]: ["view_own_reports"],
  [ROLE_SEND_ANY_VISIBLE]: ["view_own_ministry", "submit_any_visible_report"],
  [ROLE_VIEW_ALL_REPORTS]: ["view_all_reports"],
  [ROLE_OWN_DATA_ONLY]: ["edit_own_data"],
  // Só envia nas células próprias: Pedro não é líder, timóteo nem anfitrião de C1 (a recusa da captura).
  [ROLE_MINISTRY_ONLY]: ["view_own_ministry", "submit_own_cell_report"],
};

const MSG = {
  cannotChoose: "Você só pode escolher pessoas que você vê.",
  cannotSend: "Você não pode enviar o relatório desta célula.",
  cellGone: "Esta célula não existe ou já foi excluída.",
  reportGone: "Este relatório não existe ou já foi excluído.",
  wouldLeaveCell:
    "Com esta alteração, você deixaria de ver esta célula. Mantenha pelo menos uma pessoa do seu ministério como líder, timóteo ou anfitrião. As alterações não foram salvas.",
};

let env: E2EEnv;
let adminRoleId = "";
let leaderRoleId = "";
let memberRoleId = "";
const authIds: Record<string, string> = {};

const roleRef = (role: RoleKey) =>
  role === "ADMIN" ? lit(adminRoleId) : role === "LIDER" ? lit(leaderRoleId) : role === "MEMBRO" ? lit(memberRoleId) : role === null ? "NULL" : lit(role);

const WEEKDAY_SQL = "(ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'])[extract(dow FROM public.sp_today())::int + 1]";

async function removeAccounts() {
  const ids = sql(
    env,
    `SELECT auth_user_id FROM public.members WHERE name LIKE '${NAME}%' AND auth_user_id IS NOT NULL
     UNION SELECT id FROM auth.users WHERE email LIKE '%.e202c5@teste.invalid'`,
  );
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR entity_label LIKE '${NAME}%' OR actor_label LIKE '${NAME}%';
     DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id IN (SELECT id FROM public.cells WHERE leader_id::text LIKE '${PREFIX}%'));
     DELETE FROM public.cell_reports WHERE cell_id IN (SELECT id FROM public.cells WHERE leader_id::text LIKE '${PREFIX}%');
     DELETE FROM public.cells WHERE leader_id::text LIKE '${PREFIX}%' OR id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

/** Células e relatórios como no spec (relatórios na semana passada) e as funções de cada pessoa, do zero. */
function resetWorld() {
  const participants = Object.entries(REPORT_PARTICIPANTS).flatMap(([report, list]) =>
    list.map((w) => `(${lit(reportId(Number(report)))}, ${lit(memberId(w))})`),
  );
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id IN (SELECT id FROM public.cells WHERE leader_id::text LIKE '${PREFIX}%'));
     DELETE FROM public.cell_reports WHERE cell_id IN (SELECT id FROM public.cells WHERE leader_id::text LIKE '${PREFIX}%');
     DELETE FROM public.cells WHERE leader_id::text LIKE '${PREFIX}%' OR id::text LIKE '${PREFIX}%';
     ${CELLS.map(
       (c) => `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active)
       VALUES (${lit(cellId(c.n))}, ${lit(memberId(c.leader))}, ${lit(memberId(c.timothy))}, ${lit(memberId(c.host))}, 'Evangelística', ${WEEKDAY_SQL}, '00:00', true);`,
     ).join("\n     ")}
     ${CELLS.map(
       (c) => `INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, visitors, offering)
       VALUES (${lit(reportId(c.n))}, ${lit(cellId(c.n))}, public.sp_today() - 7, '20:00', true, 'Tema ${c.n}', '{}', 0);`,
     ).join("\n     ")}
     INSERT INTO public.cell_report_participants (report_id, member_id) VALUES ${participants.join(", ")};
     ${PEOPLE.map((w) => `UPDATE public.members SET role_id = ${roleRef(w.role)} WHERE id = ${lit(memberId(w))};`).join("\n     ")}
     COMMIT;`,
  );
}

/** O relatório da semana passada passa para esta semana (hoje), para poder ser editado (o trigger só aceita a semana atual). */
const moveReportToThisWeek = (n: number) =>
  sql(env, `BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.cell_reports SET date = public.sp_today() WHERE id = ${lit(reportId(n))}; COMMIT;`);

const setRoleOf = (w: Who, role: RoleKey) => sql(env, `UPDATE public.members SET role_id = ${roleRef(role)} WHERE id = ${lit(memberId(w))};`);
const reportsOfCell = (n: number) => Number(sql(env, `SELECT count(*) FROM public.cell_reports WHERE cell_id = ${lit(cellId(n))} AND deleted_at IS NULL AND date >= public.sp_today() - extract(dow FROM public.sp_today())::int`));
const cellValue = (n: number, column: string) => sql(env, `SELECT coalesce(${column}::text, '') FROM public.cells WHERE id = ${lit(cellId(n))}`);
const reportValue = (n: number, column: string) => sql(env, `SELECT coalesce(${column}::text, '') FROM public.cell_reports WHERE id = ${lit(reportId(n))}`);
const participantsOf = (n: number) =>
  sql(env, `SELECT m.name FROM public.cell_report_participants p JOIN public.members m ON m.id = p.member_id WHERE p.report_id = ${lit(reportId(n))} ORDER BY m.name`)
    .split("\n")
    .filter(Boolean);

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
     ${Object.entries(PERMISSIONS)
       .map(
         ([role, list], i) => `INSERT INTO public.roles (id, name) VALUES (${lit(role)}, 'QA Celula Funcao ${i + 1}');
     INSERT INTO public.role_permissions (role_id, permission)
       SELECT ${lit(role)}::uuid, p::public.permission_action FROM unnest(ARRAY[${list.map(lit).join(", ")}]::text[]) p;`,
       )
       .join("\n     ")}
     ${tier(byLeader([null]))}
     ${tier(byLeader([1, 2, 16]))}
     ${tier(byLeader([3, 5, 6]))}
     ${tier(byLeader([4, 7, 8, 12]))}
     ${tier(byLeader([10]))}
     ${COUPLES.map(([a, b]) => `UPDATE public.members SET spouse_id = ${lit(memberId(b))} WHERE id = ${lit(memberId(a))};`).join("\n     ")}
     COMMIT;`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  await removeAccounts();
  cleanup();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%')
          + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${PREFIX}%' OR leader_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e202c5@teste.invalid')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.beforeEach(() => {
  sql(env, "DELETE FROM private.sign_in_throttle;");
  resetWorld();
});

async function signIn(page: Page, w: Who) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(emailOf(w));
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
}

/** Uma sessão nova (contexto próprio) de outra pessoa, para comparar quem vê o quê no mesmo teste. */
async function sessionOf(browser: Browser, w: Who, viewport?: { width: number; height: number }): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  await signIn(page, w);
  return { page, close: () => context.close() };
}

async function token(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      if (!key.endsWith("-auth-token")) continue;
      const session: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (typeof session === "object" && session !== null && "access_token" in session) return String(session.access_token);
    }
    return "";
  });
  expect(value, "sessão no localStorage").not.toBe("");
  return value;
}

interface Reply {
  status: number;
  body: unknown;
  rows: unknown[];
  message: string;
}

/** Uma chamada ao PostgREST com a sessão da página (pela API, fora da tela). */
async function api(page: Page, method: "GET" | "POST" | "PATCH", path: string, data?: object): Promise<Reply> {
  const response = await page.request.fetch(`${env.apiUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.publishableKey,
      Authorization: `Bearer ${await token(page)}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(data ? { data } : {}),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const message = typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message : "";
  return { status: response.status(), body, rows: Array.isArray(body) ? body : [], message };
}

const rpc = (page: Page, fn: string, args: object) => api(page, "POST", `rpc/${fn}`, args);

/** Hoje em Brasília, "AAAA-MM-DD". */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const reportPayload = (n: number) => ({ cell_id: cellId(n), date: today(), time: "00:00", was_held: true, theme: "Tema novo", visitors: [], offering: 0 });
/** O lançamento pela API (E2.11 PR 2): a `submit_cell_report`, com um id novo e os escolhidos. */
const submitReport = (page: Page, n: number, participantIds: string[] = []) =>
  rpc(page, "submit_cell_report", { _report_id: crypto.randomUUID(), _report: reportPayload(n), _participant_ids: participantIds });
/** A edição pela API (E2.11 PR 2): a `save_cell_report`, só com o que muda. */
const saveReport = (page: Page, n: number, patch: object) => rpc(page, "save_cell_report", { _report_id: reportId(n), _report: patch });

/** Os nomes (líder) que a lista mostra: a linha traz o nome do líder da célula ou do relatório. */
async function listedLeaders(page: Page): Promise<string[]> {
  const leaders = [ANDRE, DIEGO, DEBORA].map((w) => w.name);
  // Espera a lista chegar (a primeira leitura pode ser anterior ao pedido): alguma linha da massa ou o aviso de lista vazia.
  await expect
    .poll(async () => {
      const text = (await page.locator("tbody").allTextContents()).join(" ");
      return text.includes("Carregando...") ? false : leaders.some((name) => text.includes(name)) || /Nenhum/.test(text);
    })
    .toBe(true);
  const rows = await page.locator("tbody tr").allTextContents();
  return leaders.filter((name) => rows.some((text) => text.includes(name))).sort();
}

const names = (...list: Who[]) => list.map((w) => w.name).sort();

async function expectTouchSize(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, label).not.toBeNull();
  expect(Math.round(box!.width), `${label}: largura`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box!.height), `${label}: altura`).toBeGreaterThanOrEqual(44);
}

const newReportButton = (page: Page, w: Who) => page.getByRole("button", { name: `Novo relatório da célula de ${w.name}` });
const editCellButton = (page: Page, w: Who) => page.getByRole("button", { name: `Editar a célula de ${w.name}` });

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

test.describe("Dashboard (UX-13, UX-14)", () => {
  test("UX-13: Hugo (sem função) lê a mensagem e a orientação, sem card nem carregamento", async ({ page }) => {
    await signIn(page, HUGO);
    await page.goto("/");
    await expect(page.getByText("Você não tem acesso ao dashboard.")).toBeVisible();
    await expect(page.getByText("Sua conta ainda não tem uma função. Fale com um administrador.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Esta Semana/ })).toHaveCount(0);
    await expect(page.getByText("Total de Membros")).toHaveCount(0);
    await expect(page.locator(".animate-pulse")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo relatório" })).toHaveCount(0);
  });

  test("UX-14: o atalho 'Novo relatório' aparece para Carla, Caio e Pedro, e não para Fábio", async ({ browser }) => {
    for (const [w, expected] of [[CARLA, true], [CAIO, true], [PEDRO, true], [FABIO, false]] as const) {
      const session = await sessionOf(browser, w);
      try {
        await session.page.goto("/");
        await expect(session.page.getByRole("heading", { name: /Esta Semana/ })).toBeVisible();
        await expect(session.page.getByRole("button", { name: "Novo relatório" }), w.name).toHaveCount(expected ? 1 : 0);
      } finally {
        await session.close();
      }
    }
  });

  test("UX-14: no celular o atalho tem 44 px de altura e a largura toda, abre o formulário num diálogo e, ao salvar, os cards da semana recarregam", async ({ browser }) => {
    const session = await sessionOf(browser, CARLA, { width: 360, height: 800 });
    const page = session.page;
    try {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Esta Semana/ })).toBeVisible();
      const button = page.getByRole("button", { name: "Novo relatório" });
      const box = await button.boundingBox();
      expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(360 - 2 * 24);

      await button.click();
      const dialog = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Tema da Palavra").fill("Tema do atalho");

      const reloaded = page.waitForResponse((r) => new URL(r.url()).pathname === "/rest/v1/rpc/dashboard_summary" && r.request().method() === "POST");
      await dialog.getByRole("button", { name: "Salvar" }).click();
      await expect(toast(page, "Relatório salvo com sucesso")).toBeVisible();
      await reloaded;
      expect(reportsOfCell(1)).toBe(1);
    } finally {
      await session.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Células
// ---------------------------------------------------------------------------

test.describe("Células (RN-03, RN-12, UX-23, UX-24)", () => {
  test("RN-03: Pedro vê C1 e C2 (pelo anfitrião Caio), não C3; André vê as três; Diego vê C2 e C3, não C1", async ({ browser }) => {
    const expectations: Array<[Who, Who[]]> = [[PEDRO, [ANDRE, DIEGO]], [ANDRE, [ANDRE, DIEGO, DEBORA]], [DIEGO, [DIEGO, DEBORA]]];
    for (const [w, leaders] of expectations) {
      const session = await sessionOf(browser, w);
      try {
        await openList(session.page, "/cells", NAME);
        expect(await listedLeaders(session.page), w.name).toEqual(names(...leaders));
      } finally {
        await session.close();
      }
    }
  });

  test("UX-23: 'Novo relatório' no card de C1 para Carla; em C1 e C2 para Caio e Pedro; em nenhum para Fábio; 'Editar' só com 'Editar Célula' (Pedro, não Caio)", async ({ browser }) => {
    const rows: Array<[Who, { report: Who[]; edit: Who[] }]> = [
      [CARLA, { report: [ANDRE], edit: [] }],
      [CAIO, { report: [ANDRE, DIEGO], edit: [] }],
      [PEDRO, { report: [ANDRE, DIEGO], edit: [ANDRE, DIEGO] }],
      [FABIO, { report: [], edit: [] }],
    ];
    for (const [w, expected] of rows) {
      const session = await sessionOf(browser, w);
      try {
        await openList(session.page, "/cells", NAME);
        await expect(session.page.getByText(ANDRE.name).first()).toBeVisible();
        for (const leader of [ANDRE, DIEGO]) {
          await expect(newReportButton(session.page, leader), `${w.name}: Novo relatório em ${leader.name}`).toHaveCount(expected.report.includes(leader) ? 1 : 0);
          await expect(editCellButton(session.page, leader), `${w.name}: Editar em ${leader.name}`).toHaveCount(expected.edit.includes(leader) ? 1 : 0);
        }
      } finally {
        await session.close();
      }
    }
  });

  test("UX-23: abaixo de 768 px, 'Novo relatório' e 'Editar' têm 44×44 px", async ({ browser }) => {
    const session = await sessionOf(browser, PEDRO, { width: 360, height: 800 });
    try {
      await openList(session.page, "/cells", NAME);
      await expect(newReportButton(session.page, ANDRE)).toBeVisible();
      await expectTouchSize(newReportButton(session.page, ANDRE), "Novo relatório (C1)");
      await expectTouchSize(newReportButton(session.page, DIEGO), "Novo relatório (C2)");
      await expectTouchSize(editCellButton(session.page, ANDRE), "Editar (C1)");
      await expectTouchSize(editCellButton(session.page, DIEGO), "Editar (C2)");
    } finally {
      await session.close();
    }
  });

  test("RN-12: Pedro edita C1 pela tela e a alteração é aceita", async ({ page }) => {
    await signIn(page, PEDRO);
    await openList(page, "/cells", NAME);
    await editCellButton(page, ANDRE).click();
    const dialog = page.getByRole("dialog", { name: /^Editar célula/ });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Horário *").fill("21:15");
    await dialog.getByRole("button", { name: /Salvar|Atualizar/ }).click();
    await expect(dialog).toBeHidden();
    expect(cellValue(1, "meeting_time")).toBe("21:15:00");
  });

  test("RN-12: Caio (timóteo de C1, só 'Editar Próprio Cadastro') e Pedro (em C3, fora do escopo) não alteram nada pela API; André altera C1 e C3", async ({ browser }) => {
    const caio = await sessionOf(browser, CAIO);
    try {
      const r = await api(caio.page, "PATCH", `cells?id=eq.${cellId(1)}&select=id`, { meeting_time: "07:00:00" });
      expect(r.rows, `Caio: ${r.status} ${r.message}`).toHaveLength(0);
      expect(cellValue(1, "meeting_time")).toBe("00:00:00");
    } finally {
      await caio.close();
    }
    const pedro = await sessionOf(browser, PEDRO);
    try {
      const r = await api(pedro.page, "PATCH", `cells?id=eq.${cellId(3)}&select=id`, { meeting_time: "07:00:00" });
      expect(r.rows, `Pedro: ${r.status} ${r.message}`).toHaveLength(0);
      expect(cellValue(3, "meeting_time")).toBe("00:00:00");
    } finally {
      await pedro.close();
    }
    const andre = await sessionOf(browser, ANDRE);
    try {
      for (const n of [1, 3]) {
        const r = await api(andre.page, "PATCH", `cells?id=eq.${cellId(n)}&select=id`, { meeting_time: "18:00:00" });
        expect(r.rows, `André em C${n}: ${r.status} ${r.message}`).toHaveLength(1);
        expect(cellValue(n, "meeting_time")).toBe("18:00:00");
      }
    } finally {
      await andre.close();
    }
  });

  test("RN-12: Pedro cadastra célula com Beatriz como anfitriã e recebe a recusa; com Carla é aceita. Trocar o anfitrião de C2 para Rita também é recusado", async ({ page }) => {
    await signIn(page, PEDRO);
    const base = { type: "Evangelística", meeting_day: "Quarta", meeting_time: "19:00:00", is_active: true };
    const refused = await api(page, "POST", "cells?select=id", { ...base, leader_id: memberId(ANDRE), timothy_id: memberId(CAIO), host_id: memberId(BEATRIZ) });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.message).toBe(MSG.cannotChoose);

    const accepted = await api(page, "POST", "cells?select=id", { ...base, leader_id: memberId(ANDRE), timothy_id: memberId(CAIO), host_id: memberId(CARLA) });
    expect(accepted.status, accepted.message).toBe(201);

    const swap = await api(page, "PATCH", `cells?id=eq.${cellId(2)}&select=id`, { host_id: memberId(RITA) });
    expect(swap.status).toBeGreaterThanOrEqual(400);
    expect(swap.message).toBe(MSG.cannotChoose);
    expect(cellValue(2, "host_id")).toBe(memberId(CAIO));
  });

  test("RN-12: Diego, com 'Excluir Célula', não consegue excluir C1 (fora do escopo dele)", async ({ page }) => {
    await signIn(page, DIEGO);
    const r = await rpc(page, "delete_cell", { _cell_id: cellId(1) });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.message).toBe(MSG.cellGone);
    expect(cellValue(1, "deleted_at")).toBe("");
  });

  test("UX-24: no formulário de Pedro a dica de alcance fica acima dos três campos; os três seletores sem 'Limpar' (E2.08, P64) e a recusa de escopo pela API", async ({ page }) => {
    await signIn(page, PEDRO);
    await openList(page, "/cells", NAME);
    await editCellButton(page, DIEGO).click();
    const dialog = page.getByRole("dialog", { name: /^Editar célula/ });
    await expect(dialog).toBeVisible();

    const hint = dialog.getByText("Líder, timóteo e anfitrião são escolhidos entre as pessoas do seu ministério.");
    await expect(hint).toBeVisible();
    const hintBox = await hint.boundingBox();
    for (const label of ["Líder *", "Timóteo *", "Anfitrião *"]) {
      const box = await dialog.getByText(label, { exact: true }).boundingBox();
      expect(hintBox!.y, `a dica fica acima de "${label}"`).toBeLessThan(box!.y);
    }

    // O anfitrião salvo (Caio) aparece pelo nome. Desde o E2.08 (RN-02, P64), os três seletores são
    // obrigatórios e não têm "Limpar": a célula não fica sem anfitrião pela tela. A mensagem da
    // RN-09 (c) no topo, que só o servidor dá, fica no teste de componente do CellForm.
    await expect(dialog.getByText(CAIO.name)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Limpar seleção" })).toHaveCount(0);
    await expect(dialog.getByLabel("Horário *")).toHaveValue("00:00");
    expect(cellValue(2, "host_id")).toBe(memberId(CAIO));

    // Pela API, a recusa de escopo do E2.02 vem antes da regra do E2.08 (RN-14).
    const r = await api(page, "PATCH", `cells?id=eq.${cellId(2)}&select=id`, { host_id: null });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.message).toBe(MSG.wouldLeaveCell);
    expect(cellValue(2, "host_id")).toBe(memberId(CAIO));
  });

  test("RN-02 / UX-20 (DT-23): ao editar C2, Pedro lê Diego e Hugo (fora do escopo) pelo nome no Líder e no Timóteo, não 'Membro sem nome'", async ({ page }) => {
    await signIn(page, PEDRO);
    await openList(page, "/cells", NAME);
    await editCellButton(page, DIEGO).click();
    const dialog = page.getByRole("dialog", { name: /^Editar célula/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(CAIO.name)).toBeVisible();
    await expect(dialog.getByText("Membro sem nome")).toHaveCount(0);
    await expect(dialog.getByText(DIEGO.name)).toBeVisible();
    await expect(dialog.getByText(HUGO.name)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------

test.describe("Relatórios (RN-04, RN-13, RN-14, UX-26, UX-27)", () => {
  test("RN-04: Pedro vê R1 e R2 (pelo anfitrião Caio) e não R3; com 'Relatórios de Toda a Igreja', vê os três", async ({ browser }) => {
    const pedro = await sessionOf(browser, PEDRO);
    try {
      await openList(pedro.page, "/cell-reports", NAME);
      expect(await listedLeaders(pedro.page)).toEqual(names(ANDRE, DIEGO));
      setRoleOf(PEDRO, ROLE_VIEW_ALL_REPORTS);
      await pedro.page.reload();
      await openList(pedro.page, "/cell-reports", NAME);
      expect(await listedLeaders(pedro.page)).toEqual(names(ANDRE, DIEGO, DEBORA));
      await expect(pedro.page.getByText("Relatórios das células de toda a igreja")).toBeVisible();
    } finally {
      await pedro.close();
    }
  });

  test("RN-04: Gabriel, só com 'Visualizar Relatórios do Seu Ministério', vê R1 e R2; Membros e Células não aparecem no menu", async ({ page }) => {
    await signIn(page, GABRIEL);
    await expect(page.getByRole("button", { name: "Relatórios", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Membros", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Células", exact: true })).toHaveCount(0);
    await openList(page, "/cell-reports", NAME);
    expect(await listedLeaders(page)).toEqual(names(ANDRE, DIEGO));
    await expect(page.getByRole("button", { name: "Novo Relatório" })).toHaveCount(0);
  });

  test("UX-26: o seletor de célula de Caio oferece só C1 e C2", async ({ page }) => {
    await signIn(page, CAIO);
    await openList(page, "/cell-reports", NAME);
    await page.getByRole("button", { name: "Novo Relatório" }).click();
    const dialog = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Célula *").click();
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options.first()).toBeVisible();
    const texts = (await options.allTextContents()).join(" | ");
    expect(texts).toContain(ANDRE.name);
    expect(texts).toContain(DIEGO.name);
    expect(texts).not.toContain(DEBORA.name);
  });

  test("UX-26: o formulário de Carla abre com C1 escolhida e com a data e o horário preenchidos", async ({ page }) => {
    await signIn(page, CARLA);
    await openList(page, "/cell-reports", NAME);
    await page.getByRole("button", { name: "Novo Relatório" }).click();
    const dialog = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(ANDRE.name)).toBeVisible();
    await expect(dialog.getByLabel("Data *")).not.toHaveValue("");
    await expect(dialog.getByLabel("Horário *")).toHaveValue("00:00");
  });

  test("UX-26: Gabriel, com 'Enviar Relatório de Qualquer Célula Visível', escolhe entre C1 e C2, não C3", async ({ page }) => {
    setRoleOf(GABRIEL, ROLE_SEND_ANY_VISIBLE);
    await signIn(page, GABRIEL);
    await openList(page, "/cell-reports", NAME);
    await page.getByRole("button", { name: "Novo Relatório" }).click();
    const dialog = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Célula *").click();
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options.first()).toBeVisible();
    const texts = (await options.allTextContents()).join(" | ");
    expect(texts).toContain(ANDRE.name);
    expect(texts).toContain(DIEGO.name);
    expect(texts).not.toContain(DEBORA.name);
  });

  test("RN-13: Carla (anfitriã de C1) e Caio (timóteo de C1, anfitrião de C2) lançam; Fábio, Hugo e Caio sem permissão de enviar são recusados", async ({ browser }) => {
    const carla = await sessionOf(browser, CARLA);
    try {
      const r = await submitReport(carla.page, 1);
      expect(r.status, r.message).toBe(200);
    } finally {
      await carla.close();
    }
    resetWorld();
    const caio = await sessionOf(browser, CAIO);
    try {
      for (const n of [1, 2]) {
        const r = await submitReport(caio.page, n);
        expect(r.status, `Caio em C${n}: ${r.message}`).toBe(200);
      }
    } finally {
      await caio.close();
    }
    resetWorld();
    const fabio = await sessionOf(browser, FABIO);
    try {
      const r = await submitReport(fabio.page, 1);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.message).toBe(MSG.cannotSend);
      expect(reportsOfCell(1)).toBe(0);
    } finally {
      await fabio.close();
    }
    const hugo = await sessionOf(browser, HUGO);
    try {
      const r = await submitReport(hugo.page, 2);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(reportsOfCell(2)).toBe(0);
    } finally {
      await hugo.close();
    }
    setRoleOf(CAIO, ROLE_OWN_DATA_ONLY);
    const caioNoSend = await sessionOf(browser, CAIO);
    try {
      const r = await submitReport(caioNoSend.page, 1);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(reportsOfCell(1)).toBe(0);
    } finally {
      await caioNoSend.close();
    }
  });

  test("RN-13: Pedro (com 'Editar Célula') lança C2 e, em C3 (fora do escopo), recebe 'Esta célula não existe ou já foi excluída.'", async ({ page }) => {
    await signIn(page, PEDRO);
    const ok = await submitReport(page, 2);
    expect(ok.status, ok.message).toBe(200);
    const refused = await submitReport(page, 3);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.message).toBe(MSG.cellGone);
    expect(reportsOfCell(3)).toBe(0);
  });

  test("RN-13: Gabriel (qualquer célula visível, sem 'Editar Célula') lança C1 e C2, não C3", async ({ page }) => {
    setRoleOf(GABRIEL, ROLE_SEND_ANY_VISIBLE);
    await signIn(page, GABRIEL);
    for (const n of [1, 2]) {
      const r = await submitReport(page, n);
      expect(r.status, `C${n}: ${r.message}`).toBe(200);
    }
    const c3 = await submitReport(page, 3);
    expect(c3.status).toBeGreaterThanOrEqual(400);
    expect(reportsOfCell(3)).toBe(0);
  });

  test("RN-13: Pedro e André lançam C1 com Débora como participante: o de Pedro é recusado, o de André é aceito", async ({ browser }) => {
    // E2.11 PR 2: os participantes vão no próprio lançamento; a recusa desfaz tudo (RN-15).
    const pedro = await sessionOf(browser, PEDRO);
    try {
      const r = await submitReport(pedro.page, 1, [memberId(DEBORA)]);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.message).toBe(MSG.cannotChoose);
      expect(reportsOfCell(1)).toBe(0);
    } finally {
      await pedro.close();
    }
    resetWorld();
    const andre = await sessionOf(browser, ANDRE);
    try {
      const r = await submitReport(andre.page, 1, [memberId(DEBORA)]);
      expect(r.status, r.message).toBe(200);
      expect(reportsOfCell(1)).toBe(1);
    } finally {
      await andre.close();
    }
  });

  test("RN-14: Pedro edita R2 e a alteração é aceita; R3 (fora do escopo) não muda pela API", async ({ page }) => {
    moveReportToThisWeek(2);
    moveReportToThisWeek(3);
    await signIn(page, PEDRO);
    const ok = await saveReport(page, 2, { theme: "Editado por Pedro" });
    expect(ok.status, ok.message).toBe(200);
    expect(reportValue(2, "theme")).toBe("Editado por Pedro");
    const out = await saveReport(page, 3, { theme: "Editado por Pedro" });
    expect(out.status).toBeGreaterThanOrEqual(400);
    expect(out.message).toBe(MSG.reportGone);
    expect(reportValue(3, "theme")).toBe("Tema 3");
  });

  test("RN-14: Caio não vê 'Editar' nem 'Excluir' em R1, e pela API nada muda", async ({ page }) => {
    moveReportToThisWeek(1);
    await signIn(page, CAIO);
    await openList(page, "/cell-reports", NAME);
    await expect(page.getByText(ANDRE.name).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Editar o relatório/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Excluir o relatório/ })).toHaveCount(0);
    const patch = await saveReport(page, 1, { theme: "Editado por Caio" });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    expect(reportValue(1, "theme")).toBe("Tema 1");
    const del = await rpc(page, "delete_cell_report", { _report_id: reportId(1) });
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect(reportValue(1, "deleted_at")).toBe("");
  });

  test("RN-14: Diego, com 'Excluir Relatórios de Células', não consegue excluir R1 (fora do escopo)", async ({ page }) => {
    await signIn(page, DIEGO);
    const r = await rpc(page, "delete_cell_report", { _report_id: reportId(1) });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.message).toBe(MSG.reportGone);
    expect(reportValue(1, "deleted_at")).toBe("");
  });

  test("UX-27: Pedro edita R2: Diego e Hugo aparecem como participantes com o aviso; mudar só o tema mantém os dois, e o seletor nunca os oferece", async ({ page }) => {
    moveReportToThisWeek(2);
    await signIn(page, PEDRO);
    await openList(page, "/cell-reports", NAME);
    await page.getByRole("button", { name: new RegExp(`^Editar o relatório de .* da célula de ${DIEGO.name}$`) }).click();
    const dialog = page.getByRole("dialog", { name: "Editar Relatório" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(DIEGO.name, { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText(HUGO.name, { exact: true })).toBeVisible();
    await expect(dialog.getByText("Alguns participantes não são do seu ministério: se você retirá-los, não poderá incluí-los de novo.")).toBeVisible();

    // O seletor oferece só quem Pedro vê.
    const input = dialog.getByLabel("Participantes (Membros)");
    await input.click();
    await input.fill(DIEGO.name);
    await expect(page.getByText("Nenhum membro do seu ministério encontrado.", { exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: DIEGO.name })).toHaveCount(0);
    await input.fill("");
    await page.keyboard.press("Escape");

    await dialog.getByLabel("Tema da Palavra").fill("Tema mudado");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(toast(page, "Relatório salvo com sucesso")).toBeVisible();
    expect(reportValue(2, "theme")).toBe("Tema mudado");
    expect(participantsOf(2)).toEqual(names(DIEGO, HUGO, CAIO));
  });
});

// ---------------------------------------------------------------------------
// Ministérios
// ---------------------------------------------------------------------------

test.describe("Ministérios (UX-28)", () => {
  test("Pedro vê a árvore a partir do casal G12 dele (Pedro e Paula), sem Samuel; ao expandir, André e Beatriz e Carla", async ({ page }) => {
    await signIn(page, PEDRO);
    await page.goto("/ministries");
    const tree = page.getByRole("main").getByRole("list").first();
    await expect(tree.getByText(PEDRO.name)).toBeVisible();
    await expect(tree.getByText(PAULA.name)).toBeVisible();
    await expect(tree.getByText(SAMUEL.name)).toHaveCount(0);
    await expect(page.getByText("Ninguém visível para você na árvore.")).toHaveCount(0);
    await tree.getByRole("button", { name: new RegExp(PEDRO.name) }).click();
    await expect(tree.getByText(ANDRE.name)).toBeVisible();
    await expect(tree.getByText(CARLA.name)).toBeVisible();
  });

  test("Caio vê a árvore a partir do casal G12 dele (Pedro e Paula), não o estado vazio", async ({ page }) => {
    await signIn(page, CAIO);
    await page.goto("/ministries");
    await expect(page.getByText(PEDRO.name)).toBeVisible();
    await expect(page.getByText("Ninguém visível para você na árvore.")).toHaveCount(0);
    await expect(page.getByText(SAMUEL.name)).toHaveCount(0);
  });

  test("Samuel vê a árvore a partir dele e de Magda, e ao expandir, os casais G12", async ({ page }) => {
    await signIn(page, SAMUEL);
    await page.goto("/ministries");
    const tree = page.getByRole("main").getByRole("list").first();
    await expect(tree.getByText(SAMUEL.name)).toBeVisible();
    await expect(tree.getByText(MAGDA.name)).toBeVisible();
    await tree.getByRole("button", { name: new RegExp(SAMUEL.name) }).click();
    await expect(tree.getByText(PEDRO.name)).toBeVisible();
    await expect(tree.getByText(TIAGO.name)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// UX-31 (viewport)
// ---------------------------------------------------------------------------

test.describe("UX-31: 320 px sem rolagem horizontal", () => {
  test("Dashboard, Células, Relatórios e os formulários de Pedro cabem em 320 px", async ({ browser }) => {
    const session = await sessionOf(browser, PEDRO, { width: 320, height: 640 });
    const page = session.page;
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    try {
      for (const path of ["/", "/cells", "/cell-reports", "/ministries"]) {
        await page.goto(path);
        await expect(page.getByText("Carregando...")).toHaveCount(0);
        await page.waitForLoadState("networkidle");
        expect(await overflow(), `${path}: rolagem horizontal`).toBeLessThanOrEqual(0);
      }
      await openList(page, "/cells", NAME);
      await editCellButton(page, ANDRE).click();
      const dialog = page.getByRole("dialog", { name: /^Editar célula/ });
      await expect(dialog).toBeVisible();
      expect(await overflow(), "formulário de célula").toBeLessThanOrEqual(0);
      const box = await dialog.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    } finally {
      await session.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Capturas e axe para a revisão de UI (tarefa 17). Só rodam com E2E_CAPTURE_DIR
// (uma pasta fora do repositório); sem ela, são puladas e não entram no CI.
// ---------------------------------------------------------------------------

const CAPTURE_DIR = process.env.E2E_CAPTURE_DIR ?? "";

test.describe("Capturas da revisão de UI (E2E_CAPTURE_DIR)", () => {
  test.skip(!CAPTURE_DIR, "Defina E2E_CAPTURE_DIR para gerar as capturas e o relatório do axe.");
  test.setTimeout(600_000);

  const SIZES = [320, 360, 1280] as const;
  const THEMES = ["claro", "escuro"] as const;

  interface UiState {
    name: string;
    who: Who;
    prepare?: () => void;
    open: (page: Page) => Promise<void>;
    restore?: () => void;
  }

  const closeDialog = async (page: Page) => {
    await page.keyboard.press("Escape");
  };

  const STATES: UiState[] = [
    {
      name: "t7-celulas-lista",
      who: PEDRO,
      open: async (page) => {
        await openList(page, "/cells", NAME);
        await expect(page.getByText(ANDRE.name).first()).toBeVisible();
      },
    },
    {
      name: "t7-celulas-formulario",
      who: PEDRO,
      open: async (page) => {
        await openList(page, "/cells", NAME);
        await editCellButton(page, ANDRE).click();
        await expect(page.getByRole("dialog", { name: /^Editar célula/ })).toBeVisible();
        await expect(page.getByText("Membro sem nome")).toHaveCount(0);
      },
    },
    {
      name: "t8-relatorios-lista",
      who: PEDRO,
      open: async (page) => {
        await openList(page, "/cell-reports", NAME);
        await expect(page.getByText(ANDRE.name).first()).toBeVisible();
      },
    },
    {
      name: "t8-relatorio-formulario-novo",
      who: PEDRO,
      open: async (page) => {
        await openList(page, "/cell-reports", NAME);
        await page.getByRole("button", { name: "Novo Relatório" }).click();
        await expect(page.getByRole("dialog", { name: "Novo Relatório de Célula" })).toBeVisible();
      },
    },
    {
      name: "t8-relatorio-participantes-fora-do-escopo",
      who: PEDRO,
      prepare: () => moveReportToThisWeek(2),
      open: async (page) => {
        await openList(page, "/cell-reports", NAME);
        await page.getByRole("button", { name: new RegExp(`^Editar o relatório de .* da célula de ${DIEGO.name}$`) }).click();
        const dialog = page.getByRole("dialog", { name: "Editar Relatório" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("Alguns participantes não são do seu ministério", { exact: false })).toBeVisible();
      },
    },
    {
      name: "t8-relatorio-recusa-no-topo",
      who: PEDRO,
      open: async (page) => {
        await openList(page, "/cells", NAME);
        await newReportButton(page, ANDRE).click();
        const dialog = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel("Tema da Palavra").fill("Tema");
        // Enquanto o formulário está aberto, a pessoa perde a função: o servidor recusa o envio.
        setRoleOf(PEDRO, ROLE_MINISTRY_ONLY);
        await dialog.getByRole("button", { name: "Salvar" }).click();
        await expect(dialog.getByRole("alert").first()).toBeVisible();
      },
      restore: () => resetWorld(),
    },
    {
      name: "t9-dashboard-pedro",
      who: PEDRO,
      open: async (page) => {
        await page.goto("/");
        await expect(page.getByRole("heading", { name: /Esta Semana/ })).toBeVisible();
        await expect(page.getByText("Meu Ministério")).toBeVisible();
        await expect(page.locator(".animate-pulse")).toHaveCount(0);
      },
    },
    {
      name: "t9-dashboard-hugo-sem-acesso",
      who: HUGO,
      open: async (page) => {
        await page.goto("/");
        await expect(page.getByText("Você não tem acesso ao dashboard.")).toBeVisible();
      },
    },
    {
      name: "t10-ministerios-arvore-pedro",
      who: PEDRO,
      open: async (page) => {
        await page.goto("/ministries");
        const tree = page.getByRole("main").getByRole("list").first();
        await tree.getByRole("button", { name: new RegExp(PEDRO.name) }).click();
        await expect(tree.getByText(ANDRE.name)).toBeVisible();
      },
    },
    {
      name: "t10-ministerios-vazio",
      who: PEDRO,
      open: async (page) => {
        await page.route("**/rest/v1/rpc/ministry_tree_nodes", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
        await page.goto("/ministries");
        await expect(page.getByText("Ninguém visível para você na árvore.")).toBeVisible();
        await page.unroute("**/rest/v1/rpc/ministry_tree_nodes");
      },
    },
  ];

  for (const size of SIZES) {
    test(`capturas e axe em ${size} px`, async ({ browser }) => {
      mkdirSync(CAPTURE_DIR, { recursive: true });
      const sessions = new Map<number, { page: Page; close: () => Promise<void> }>();
      try {
        for (const state of STATES) {
          let session = sessions.get(state.who.n);
          if (!session) {
            session = await sessionOf(browser, state.who, { width: size, height: 800 });
            sessions.set(state.who.n, session);
          }
          const { page } = session;
          state.prepare?.();
          await page.goto("/");
          await state.open(page);
          for (const theme of THEMES) {
            await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "escuro"), theme);
            await page.waitForTimeout(250);
            const file = `${CAPTURE_DIR}/${state.name}-${size}-${theme}.png`;
            await page.screenshot({ path: file, fullPage: true });
            const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
            const violations = results.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.length,
              first: v.nodes[0]?.target.join(" "),
              html: v.nodes[0]?.html.slice(0, 200),
              message: v.nodes[0]?.any[0]?.message ?? v.nodes[0]?.all[0]?.message ?? "",
            }));
            appendFileSync(`${CAPTURE_DIR}/axe.jsonl`, `${JSON.stringify({ state: state.name, size, theme, violations })}\n`);
          }
          await page.evaluate(() => document.documentElement.classList.remove("dark"));
          if (state.restore) state.restore();
          else await closeDialog(page);
          resetWorld();
        }
      } finally {
        for (const session of sessions.values()) await session.close();
      }
    });
  }
});
