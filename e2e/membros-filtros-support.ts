import { expect, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, lit, sql, type E2EEnv } from "./exclusao-support";

// Massa e apoio dos testes do E2.07 (filtros de Membros e o líder já preenchido): a árvore da "Massa
// de exemplo" do spec (19 pessoas), as células C1 a C5 e as contas de Rita (Administrador) e Pedro
// (Líder). Só roda na stack local (ver e2e/exclusao-support.ts). As gravações passam pelos gatilhos
// ligados (regras do E2.04 e do E2.08); só o relatório e a data de cadastro antiga vão em `replica`.

export const PREFIX = "e2e207f1";
export const PASSWORD = "QaFiltros#2026x";
export const EMAIL_SUFFIX = ".e207f1@teste.invalid";

export interface Person {
  n: number;
  name: string;
  gender: "M" | "F";
  leader: number | null;
  pastor?: boolean;
  inactive?: boolean;
  role?: "ADMIN" | "LEADER";
  neighborhood?: string;
  city?: string;
}

const p = (n: number, name: string, gender: "M" | "F", leader: number | null, extra: Partial<Person> = {}): Person => ({
  n,
  name,
  gender,
  leader,
  ...extra,
});

export const SAMUEL = p(1, "Samuel Colares", "M", null, { pastor: true });
export const MAGDA = p(2, "Magda Colares", "F", null, { pastor: true });
export const PEDRO = p(3, "Pedro Alves", "M", 1, { role: "LEADER" });
export const PAULA = p(4, "Paula Alves", "F", 2);
export const TIAGO = p(5, "Tiago Rocha", "M", 1);
export const TANIA = p(6, "Tânia Rocha", "F", 2);
export const ANDRE = p(7, "André Souza", "M", 3, { neighborhood: "Centro", city: "Porto Alegre" });
export const BEATRIZ = p(8, "Beatriz Souza", "F", 6);
export const CAIO = p(9, "Caio Lima", "M", 7, { neighborhood: "São João", city: "Porto Alegre" });
export const FABIO = p(10, "Fábio Lima", "M", 7, { inactive: true });
export const GABRIEL = p(11, "Gabriel Costa", "M", 10);
export const JONAS = p(12, "Jonas Prado", "M", 11);
export const CARLA = p(13, "Carla Dias", "F", 4, { neighborhood: "Vila São João", city: "Canoas" });
export const DEBORA = p(14, "Débora Lopes", "F", 8);
export const RITA = p(15, "Rita Gomes", "F", 6, { role: "ADMIN" });
export const DIEGO = p(16, "Diego Reis", "M", 5);
export const HUGO = p(17, "Hugo Prado", "M", 5);
export const ESTER = p(18, "Ester Ramos", "F", null);
export const LUCIA = p(19, "Lúcia Freitas", "F", 18);

export const PEOPLE: Person[] = [
  SAMUEL, MAGDA, PEDRO, PAULA, TIAGO, TANIA, ANDRE, BEATRIZ, CAIO, FABIO, GABRIEL, JONAS, CARLA, DEBORA, RITA, DIEGO, HUGO, ESTER, LUCIA,
];
const COUPLES: Array<[Person, Person]> = [[SAMUEL, MAGDA], [PEDRO, PAULA], [TIAGO, TANIA], [ANDRE, BEATRIZ]];

/** C1 a C5 do spec (líder / timóteo / anfitrião). */
interface Cell {
  n: number;
  leader: Person;
  timothy: Person;
  host: Person;
  inactive?: boolean;
  deleted?: boolean;
}
const CELLS: Cell[] = [
  { n: 1, leader: ANDRE, timothy: CAIO, host: CARLA },
  { n: 2, leader: DIEGO, timothy: HUGO, host: CAIO },
  { n: 3, leader: DEBORA, timothy: RITA, host: BEATRIZ },
  { n: 4, leader: GABRIEL, timothy: JONAS, host: FABIO, inactive: true },
  { n: 5, leader: JONAS, timothy: GABRIEL, host: FABIO, deleted: true },
];

export const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;
export const cellId = (n: number) => `${PREFIX}-0003-0000-0000-${String(n).padStart(12, "0")}`;
export const reportId = (n: number) => `${PREFIX}-0004-0000-0000-${String(n).padStart(12, "0")}`;
/** Um id com formato válido de ninguém (RN-05). */
export const NOBODY_ID = `${PREFIX}-0009-0000-0000-000000000001`;
export const memberId = (person: Person) => id(person.n);
const mobileOf = (n: number) => `5193207${String(n).padStart(4, "0")}`;
export const emailOf = (person: Person) =>
  `${person.name.split(" ")[0]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}${EMAIL_SUFFIX}`;
export const LOGINS: Person[] = [RITA, PEDRO];

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
    `SELECT auth_user_id FROM public.members WHERE (id::text LIKE '${PREFIX}%' OR name LIKE '%E2E207') AND auth_user_id IS NOT NULL
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
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '%E2E207';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
     COMMIT;
     DELETE FROM private.sign_in_throttle;`,
  );
}

/** Cria a massa do spec, com os gatilhos ligados. Rita e Pedro logam com PASSWORD. */
export async function seed(env: E2EEnv) {
  const adminRole = sql(env, "SELECT id FROM public.roles WHERE is_system AND name = 'Administrador'");
  const leaderRole = sql(env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Líder'");
  const memberRole = sql(env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Membro'");
  const authIds: Record<number, string> = {};
  for (const person of LOGINS) authIds[person.n] = await createAuthUser(env, emailOf(person), PASSWORD);
  const roleOf = (person: Person) => lit(person.role === "ADMIN" ? adminRole : person.role === "LEADER" ? leaderRole : memberRole);
  const text = (value: string | undefined) => (value ? lit(value) : "NULL");
  for (const person of insertionOrder()) {
    const login = authIds[person.n];
    sql(
      env,
      `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, auth_user_id, role_id, email, mobile_whatsapp, neighborhood, city)
       VALUES (${lit(memberId(person))}, ${lit(person.name)}, ${lit(person.gender)}, ${!!person.pastor}, ${person.leader !== null},
               ${person.leader === null ? "NULL" : lit(id(person.leader))}, true, ${login ? lit(login) : "NULL"}, ${roleOf(person)},
               ${login ? lit(emailOf(person)) : "NULL"}, ${lit(mobileOf(person.n))}, ${text(person.neighborhood)}, ${text(person.city)});`,
    );
  }
  for (const [a, b] of COUPLES) sql(env, `UPDATE public.members SET spouse_id = ${lit(memberId(b))} WHERE id = ${lit(memberId(a))};`);
  for (const cell of CELLS) {
    sql(
      env,
      `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active)
       VALUES (${lit(cellId(cell.n))}, ${lit(memberId(cell.leader))}, ${lit(memberId(cell.timothy))}, ${lit(memberId(cell.host))},
               'Evangelística', 'Quarta', '20:00', true);`,
    );
  }
  // Inativos e excluídos por último (o líder inativo e o cadastro excluído não aceitam novos vínculos).
  for (const person of PEOPLE.filter((x) => x.inactive)) sql(env, `UPDATE public.members SET is_active = false WHERE id = ${lit(memberId(person))};`);
  for (const cell of CELLS.filter((c) => c.inactive)) sql(env, `UPDATE public.cells SET is_active = false WHERE id = ${lit(cellId(cell.n))};`);
  for (const cell of CELLS.filter((c) => c.deleted)) sql(env, `UPDATE public.cells SET deleted_at = now() WHERE id = ${lit(cellId(cell.n))};`);
  // Jonas foi cadastrado há 10 dias (a data de cadastro é carimbada pelo banco: muda só em `replica`).
  sql(
    env,
    `BEGIN; SET LOCAL session_replication_role = replica;
     UPDATE public.members SET created_at = now() - interval '10 days' WHERE id = ${lit(memberId(JONAS))};
     COMMIT;`,
  );
}

/** Um relatório de C1, realizado há `daysAgo` dias, com os participantes (a carga vai em `replica`). */
export function addReport(env: E2EEnv, n: number, daysAgo: number, participants: Person[]) {
  sql(
    env,
    `BEGIN; SET LOCAL session_replication_role = replica;
     INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme)
       VALUES (${lit(reportId(n))}, ${lit(cellId(1))}, public.sp_today() - ${daysAgo}, '20:00', true, 'Tema E2E');
     INSERT INTO public.cell_report_participants (report_id, member_id)
       SELECT ${lit(reportId(n))}::uuid, m::uuid FROM unnest(ARRAY[${participants.map((x) => lit(memberId(x))).join(", ")}]::text[]) m;
     COMMIT;`,
  );
}

export const resetThrottle = (env: E2EEnv) => sql(env, "DELETE FROM private.sign_in_throttle;");

export async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(emailOf(person));
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
}

const MASSA_NAMES = new Set(PEOPLE.map((x) => x.name));

/** Os nomes da massa na lista aberta, na ordem da tela (cartões ou tabela), sem os cadastros de outros testes. */
export async function listedNames(page: Page): Promise<string[]> {
  const names = await page.getByRole("main").locator("tbody tr td > div.break-words > span.font-medium, p.font-semibold").allTextContents();
  return names.map((name) => name.trim()).filter((name) => MASSA_NAMES.has(name));
}

/** Espera a lista terminar de carregar (sem `Skeleton` e sem recarga). */
export async function waitForList(page: Page) {
  // O total ("N membros") só aparece com a resposta da lista.
  await expect(page.getByRole("status").filter({ hasText: /^\d[\d.]* membros?$/ }).first()).toBeVisible();
  await expect(page.getByTestId("members-loading")).toHaveCount(0);
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
}
