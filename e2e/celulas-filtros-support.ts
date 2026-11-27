import { expect, type Page, type Response } from "@playwright/test";
import { createAuthUser, deleteAuthUser, lit, sql, type E2EEnv } from "./exclusao-support";

// Massa e apoio dos testes do E2.10 (filtros de Células e o filtro Célula em Relatórios): a árvore da
// "Massa de exemplo" do spec (20 pessoas, com Lia), as células C1 a C8 e os relatórios R1 a R10, com
// as datas relativas a hoje para a situação do relatório não depender da hora em que a suíte roda.
// Só roda na stack local (ver e2e/exclusao-support.ts). Pessoas e células passam pelos gatilhos; os
// relatórios e as datas de cadastro vão em `replica`.

export const PREFIX = "e2e210f1";
export const PASSWORD = "QaCelFil#2026x";
export const EMAIL_SUFFIX = ".e210f1@teste.invalid";

export interface Person {
  n: number;
  name: string;
  gender: "M" | "F";
  leader: number | null;
  pastor?: boolean;
  inactive?: boolean;
  role?: "ADMIN" | "LEADER" | "MEMBER" | "SECRETARY" | "NONE";
  login?: boolean;
}

const p = (n: number, name: string, gender: "M" | "F", leader: number | null, extra: Partial<Person> = {}): Person => ({
  n,
  name,
  gender,
  leader,
  role: "MEMBER",
  ...extra,
});

export const SAMUEL = p(1, "Samuel Colares", "M", null, { pastor: true, role: "LEADER" });
export const MAGDA = p(2, "Magda Colares", "F", null, { pastor: true, role: "LEADER" });
export const PEDRO = p(3, "Pedro Alves", "M", 1, { role: "LEADER", login: true });
export const PAULA = p(4, "Paula Alves", "F", 2, { role: "LEADER" });
export const TIAGO = p(5, "Tiago Rocha", "M", 1);
export const TANIA = p(6, "Tânia Rocha", "F", 2);
export const ANDRE = p(7, "André Souza", "M", 3, { role: "LEADER", login: true });
export const BEATRIZ = p(8, "Beatriz Souza", "F", 6);
export const CAIO = p(9, "Caio Lima", "M", 7);
export const FABIO = p(10, "Fábio Lima", "M", 7, { inactive: true });
export const GABRIEL = p(11, "Gabriel Costa", "M", 10);
export const JONAS = p(12, "Jonas Prado", "M", 11);
export const CARLA = p(13, "Carla Dias", "F", 4);
export const DEBORA = p(14, "Débora Lins", "F", 8);
export const RITA = p(15, "Rita Gomes", "F", 6, { role: "ADMIN", login: true });
export const DIEGO = p(16, "Diego Reis", "M", 5, { role: "LEADER", login: true });
export const HUGO = p(17, "Hugo Melo", "M", 5, { role: "NONE" });
export const ESTER = p(18, "Ester Ramos", "F", null, { login: true });
export const LUCIA = p(19, "Lúcia Freitas", "F", 18);
export const LIA = p(20, "Lia Moura", "F", 18, { role: "SECRETARY", login: true });

export const PEOPLE: Person[] = [
  SAMUEL, MAGDA, PEDRO, PAULA, TIAGO, TANIA, ANDRE, BEATRIZ, CAIO, FABIO, GABRIEL, JONAS, CARLA, DEBORA, RITA, DIEGO, HUGO, ESTER, LUCIA, LIA,
];
const COUPLES: Array<[Person, Person]> = [[SAMUEL, MAGDA], [PEDRO, PAULA], [TIAGO, TANIA], [ANDRE, BEATRIZ]];

export interface Cell {
  n: number;
  leader: Person;
  timothy: Person;
  host: Person;
  type: "Evangelística" | "Discipulado" | "Macrocélula";
  day: string;
  time: string;
  address: { zip?: string; street?: string; number?: string; neighborhood?: string; city?: string; state?: string };
  /** O `created_at` em SQL (nulo: "data não registrada", do legado). */
  createdAt: string | null;
  /** Desde quando a célula conta para a situação do relatório (E2.09); padrão: desde sempre. */
  activeSince?: string;
  inactive?: boolean;
  deleted?: boolean;
}

const WEEK = "public.week_start(public.sp_today())";
export const CELLS: Cell[] = [
  { n: 1, leader: ANDRE, timothy: CAIO, host: CARLA, type: "Evangelística", day: "Quarta", time: "20:00",
    address: { zip: "90010000", street: "Rua das Flores", number: "100", neighborhood: "Centro", city: "Porto Alegre", state: "RS" },
    createdAt: "'2025-03-10 12:00-03'" },
  { n: 2, leader: DIEGO, timothy: HUGO, host: CAIO, type: "Evangelística", day: "Quinta", time: "20:00",
    address: { street: "Av. São João", number: "45", neighborhood: "São João", city: "Porto Alegre", state: "RS" },
    createdAt: `public.sp_instant(${WEEK} + time '00:10')`, activeSince: `public.sp_instant(${WEEK} + time '00:10')` },
  { n: 3, leader: DEBORA, timothy: RITA, host: BEATRIZ, type: "Discipulado", day: "Terça", time: "19:30",
    address: { street: "Rua Sao Joao", number: "12", neighborhood: "Niterói", city: "Canoas", state: "RS" }, createdAt: null },
  { n: 4, leader: GABRIEL, timothy: JONAS, host: FABIO, type: "Evangelística", day: "Sábado", time: "10:00",
    address: { street: "Rua Brasil", number: "500", neighborhood: "Centro", city: "Alegrete", state: "RS" },
    createdAt: "'2026-06-05 12:00-03'", inactive: true },
  { n: 5, leader: JONAS, timothy: GABRIEL, host: FABIO, type: "Evangelística", day: "Sexta", time: "20:00", address: {},
    createdAt: "'2026-09-01 12:00-03'", deleted: true },
  { n: 6, leader: PAULA, timothy: CARLA, host: PAULA, type: "Discipulado", day: "Segunda", time: "20:00", address: {},
    createdAt: `public.sp_instant(${WEEK} - 1 + time '23:30')` },
  { n: 7, leader: SAMUEL, timothy: TIAGO, host: MAGDA, type: "Macrocélula", day: "Domingo", time: "18:00",
    address: { street: "Rua da Igreja", number: "1", neighborhood: "Centro", city: "Porto Alegre", state: "RS" },
    createdAt: "'2024-01-15 12:00-03'" },
  { n: 8, leader: ESTER, timothy: LUCIA, host: ESTER, type: "Evangelística", day: "Sábado", time: "16:00",
    address: { street: "Rua das Flores", number: "7", neighborhood: "Rio Branco", city: "Canoas", state: "RS" },
    createdAt: "'2026-02-02 12:00-03'" },
];

/** Os relatórios: célula, dia em relação ao domingo desta semana, realizada ou não, tema, oferta e se foi excluído. */
interface Report {
  n: number;
  cell: number;
  /** Dias a partir do domingo desta semana (negativo: semanas anteriores). */
  day: number;
  time: string;
  held: boolean;
  theme?: string;
  reason?: string;
  offering?: number;
  deleted?: boolean;
}
const REPORTS: Report[] = [
  { n: 1, cell: 1, day: -4, time: "20:00", held: true, theme: "A fé que vence", offering: 50 },
  { n: 2, cell: 1, day: -11, time: "20:00", held: false, reason: "Chuva forte no bairro" },
  { n: 3, cell: 1, day: -18, time: "20:15", held: true, theme: "Esperança", offering: 30, deleted: true },
  { n: 4, cell: 1, day: -25, time: "20:00", held: true, theme: "Perdão", offering: 20 },
  { n: 5, cell: 1, day: -32, time: "20:00", held: true, theme: "Oração", offering: 15 },
  { n: 8, cell: 3, day: -12, time: "19:30", held: true, theme: "Tema C3", offering: 10 },
  { n: 6, cell: 5, day: -2, time: "20:00", held: true, theme: "Tema C5", offering: 10 },
  // C6 e C7: enviados nesta semana (o domingo), "Enviado" a qualquer hora da semana.
  { n: 9, cell: 6, day: 0, time: "00:00", held: true, theme: "Tema C6", offering: 10 },
  { n: 10, cell: 7, day: 0, time: "00:00", held: true, theme: "Tema C7", offering: 10 },
];

export const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;
export const cellId = (n: number) => `${PREFIX}-0003-0000-0000-${String(n).padStart(12, "0")}`;
export const reportId = (n: number) => `${PREFIX}-0004-0000-0000-${String(n).padStart(12, "0")}`;
const roleId = (n: number) => `${PREFIX}-0005-0000-0000-${String(n).padStart(12, "0")}`;
/** Um id com formato válido de nada. */
export const NOBODY_ID = `${PREFIX}-0009-0000-0000-000000000001`;
export const memberId = (person: Person) => id(person.n);
const mobileOf = (n: number) => `5193210${String(n).padStart(4, "0")}`;
export const emailOf = (person: Person) =>
  `${person.name.split(" ")[0]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}${EMAIL_SUFFIX}`;

function insertionOrder(): Person[] {
  const done = new Set<number>();
  const order: Person[] = [];
  while (order.length < PEOPLE.length) {
    for (const person of PEOPLE) {
      if (done.has(person.n) || (person.leader !== null && !done.has(person.leader))) continue;
      done.add(person.n);
      order.push(person);
    }
  }
  return order;
}

export async function removeAccounts(env: E2EEnv) {
  const ids = sql(
    env,
    `SELECT auth_user_id FROM public.members WHERE id::text LIKE '${PREFIX}%' AND auth_user_id IS NOT NULL
     UNION SELECT id FROM auth.users WHERE email LIKE '%${EMAIL_SUFFIX}'`,
  );
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

export function cleanup(env: E2EEnv) {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id::text LIKE '${PREFIX}%');
     DELETE FROM public.cell_reports WHERE cell_id::text LIKE '${PREFIX}%';
     DELETE FROM public.cells WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.cell_active_periods WHERE cell_id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     COMMIT;
     DELETE FROM private.sign_in_throttle;`,
  );
}

/** Cria a massa do spec. Quem tem `login` entra com PASSWORD. */
export async function seed(env: E2EEnv) {
  sql(
    env,
    `INSERT INTO public.roles (id, name) VALUES (${lit(roleId(1))}, 'Secretaria E2E210');
     INSERT INTO public.role_permissions (role_id, permission) VALUES (${lit(roleId(1))}, 'view_all_reports');`,
  );
  const roles = {
    ADMIN: lit(sql(env, "SELECT id FROM public.roles WHERE is_system AND name = 'Administrador'")),
    LEADER: lit(sql(env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Líder'")),
    MEMBER: lit(sql(env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Membro'")),
    SECRETARY: lit(roleId(1)),
    NONE: "NULL",
  };
  const authIds: Record<number, string> = {};
  for (const person of PEOPLE.filter((x) => x.login)) authIds[person.n] = await createAuthUser(env, emailOf(person), PASSWORD);
  for (const person of insertionOrder()) {
    const login = authIds[person.n];
    sql(
      env,
      `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, auth_user_id, role_id, email, mobile_whatsapp)
       VALUES (${lit(memberId(person))}, ${lit(person.name)}, ${lit(person.gender)}, ${!!person.pastor}, ${person.leader !== null},
               ${person.leader === null ? "NULL" : lit(id(person.leader))}, true, ${login ? lit(login) : "NULL"}, ${roles[person.role ?? "MEMBER"]},
               ${login ? lit(emailOf(person)) : "NULL"}, ${lit(mobileOf(person.n))});`,
    );
  }
  for (const [a, b] of COUPLES) sql(env, `UPDATE public.members SET spouse_id = ${lit(memberId(b))} WHERE id = ${lit(memberId(a))};`);
  const text = (value: string | undefined) => (value ? lit(value) : "NULL");
  for (const cell of CELLS) {
    const a = cell.address;
    sql(
      env,
      `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active, zip_code, street, number, neighborhood, city, state)
       VALUES (${lit(cellId(cell.n))}, ${lit(memberId(cell.leader))}, ${lit(memberId(cell.timothy))}, ${lit(memberId(cell.host))},
               ${lit(cell.type)}, ${lit(cell.day)}, ${lit(cell.time)}, true, ${text(a.zip)}, ${text(a.street)}, ${text(a.number)},
               ${text(a.neighborhood)}, ${text(a.city)}, ${text(a.state)});`,
    );
  }
  // Os relatórios, lançados antes da exclusão da C5 e da inativação (em `replica`, como a carga).
  const reports = REPORTS.map(
    (r) => `(${lit(reportId(r.n))}, ${lit(cellId(r.cell))}, ${WEEK} + ${r.day}, ${lit(r.time)}, ${r.held}, ${text(r.theme)},
             ${text(r.reason)}, ${r.offering ?? "NULL"})`,
  );
  sql(
    env,
    `BEGIN; SET LOCAL session_replication_role = replica;
     INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, reason_not_held, offering) VALUES ${reports.join(",\n")};
     UPDATE public.cell_reports SET deleted_at = now() WHERE id IN (${REPORTS.filter((r) => r.deleted).map((r) => lit(reportId(r.n))).join(", ")});
     COMMIT;`,
  );
  // Inativos e excluídos por último (o líder inativo e o cadastro excluído não aceitam novos vínculos).
  for (const person of PEOPLE.filter((x) => x.inactive)) sql(env, `UPDATE public.members SET is_active = false WHERE id = ${lit(memberId(person))};`);
  for (const cell of CELLS.filter((c) => c.inactive)) sql(env, `UPDATE public.cells SET is_active = false WHERE id = ${lit(cellId(cell.n))};`);
  for (const cell of CELLS.filter((c) => c.deleted)) sql(env, `UPDATE public.cells SET deleted_at = now() WHERE id = ${lit(cellId(cell.n))};`);
  // As datas de cadastro e os períodos ativos (E2.09) só mudam como postgres, em `replica`.
  // Sem data (o legado, E2.05 DT-03), o autor fica "desconhecido".
  const dates = CELLS.map((c) =>
    c.createdAt
      ? `UPDATE public.cells SET created_at = ${c.createdAt} WHERE id = ${lit(cellId(c.n))};`
      : `UPDATE public.cells SET created_at = NULL, created_by_kind = 'unknown', created_by = NULL WHERE id = ${lit(cellId(c.n))};`,
  );
  const periods = CELLS.filter((c) => !c.inactive && !c.deleted).map(
    (c) =>
      `UPDATE private.cell_active_periods SET periods = ${c.activeSince ? `tstzmultirange(tstzrange(${c.activeSince}, NULL))` : "'{(,)}'"} WHERE cell_id = ${lit(cellId(c.n))};`,
  );
  sql(env, `BEGIN; SET LOCAL session_replication_role = replica; ${dates.join("\n")} ${periods.join("\n")} COMMIT;`);
}

export const resetThrottle = (env: E2EEnv) => sql(env, "DELETE FROM private.sign_in_throttle;");

/** O domingo e o sábado desta semana, em "aaaa-mm-dd" (Brasília). */
export function thisWeek(env: E2EEnv): { start: string; end: string } {
  const [start, end] = sql(env, `SELECT ${WEEK}, ${WEEK} + 6`).split("|");
  return { start: start!, end: end! };
}

export async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(emailOf(person));
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
}

/** Guarda o corpo de toda resposta do Supabase (rede inspecionada, RN-06 e RN-19). */
export function recordResponses(page: Page): { bodies: string[]; urls: string[] } {
  const record = { bodies: [] as string[], urls: [] as string[] };
  page.on("response", (response: Response) => {
    if (!/\/rest\/v1\//.test(response.url())) return;
    record.urls.push(response.url());
    void response.text().then(
      (body) => record.bodies.push(body),
      () => undefined,
    );
  });
  return record;
}

/** Espera a lista de Células terminar de carregar (o total na tela, sem `Skeleton` e sem recarga). */
export async function waitForCells(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^\d[\d.]* células?$/ }).first()).toBeVisible();
  await expect(page.getByTestId("cells-loading")).toHaveCount(0);
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
}

const LEADER_NAMES = new Set(CELLS.map((c) => c.leader.name));

/** Os líderes das células da massa na lista aberta (cartões), na ordem da tela. */
export async function listedLeaders(page: Page): Promise<string[]> {
  const names = await page.getByRole("main").locator("li p a > span.font-semibold").allTextContents();
  return names
    .map((name) => name.replace(/\s*\(.*$/, "").replace(/,.*$/, "").trim())
    .filter((name) => LEADER_NAMES.has(name));
}
