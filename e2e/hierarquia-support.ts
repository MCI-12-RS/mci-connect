import { appendFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Browser, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";
import { createAuthUser, deleteAuthUser, lit, sql, type E2EEnv } from "./exclusao-support";

// Massa e apoio dos testes do E2.06 (PR 2): a árvore do spec ("Massa de exemplo"), as células C1 a C11,
// as funções e as contas de Rita, Pedro, Diego, André e Hugo. Só roda na stack local (ver
// e2e/exclusao-support.ts para as variáveis). Todas as gravações passam pelos gatilhos ligados
// (regras do E2.04: nome com sobrenome, sexo, celular válido e único, liderança coerente).

export const PREFIX = "e2e206b2";
export const PASSWORD = "QaHier#2026x";
export const ADMIN_EMAIL_SUFFIX = ".e206b2@teste.invalid";

export type Gender = "M" | "F";

export interface Person {
  n: number;
  name: string;
  gender: Gender;
  leader: number | null;
  pastor?: boolean;
  inactive?: boolean;
  noLeadership?: boolean;
  /** Sem `role`, é a função Membro (o formulário exige uma função ao salvar); "NONE" deixa o cadastro sem função, como Hugo. */
  role?: "ADMIN" | "ESCOPO" | "NONE";
  login?: boolean;
}

const p = (n: number, name: string, gender: Gender, leader: number | null, extra: Partial<Person> = {}): Person => ({ n, name, gender, leader, ...extra });

// n: 1 Samuel … Os ids seguem a ordem da tabela "Valores da massa" do spec.
export const SAMUEL = p(1, "Samuel Colares", "M", null, { pastor: true });
export const MAGDA = p(2, "Magda Colares", "F", null, { pastor: true });
export const PEDRO = p(3, "Pedro Alves", "M", 1, { role: "ESCOPO", login: true });
export const PAULA = p(4, "Paula Alves", "F", 2);
export const TIAGO = p(5, "Tiago Rocha", "M", 1);
export const TANIA = p(6, "Tânia Rocha", "F", 2);
export const ANDRE = p(7, "André Souza", "M", 3, { role: "ESCOPO", login: true });
export const BEATRIZ = p(8, "Beatriz Souza", "F", 6);
export const CARLA = p(9, "Carla Mendes", "F", 4);
export const RITA = p(10, "Rita Barros", "F", 6, { role: "ADMIN", login: true });
export const DIEGO = p(11, "Diego Reis", "M", 5, { role: "ESCOPO", login: true });
export const HUGO = p(12, "Hugo Prado", "M", 5, { role: "NONE", login: true });
export const CAIO = p(13, "Caio Lima", "M", 7);
export const FABIO = p(14, "Fábio Lima", "M", 7, { inactive: true });
export const DEBORA = p(15, "Débora Lopes", "F", 8);
export const LAURO = p(16, "Lauro Mendes", "M", 11);
export const VANIA = p(17, "Vânia Prado", "F", 12);
export const GABRIEL = p(18, "Gabriel Nunes", "M", 14);
export const OLGA = p(19, "Olga Reis", "F", 16);
export const ZELIA = p(20, "Zélia Lopes", "F", 17);
export const SONIA = p(21, "Sônia Castro", "F", 19);
export const ESTER = p(22, "Ester Ramos", "F", null, { noLeadership: true, role: "ESCOPO", login: true });
export const LUCIA = p(23, "Lúcia Freitas", "F", 22);

export const PEOPLE: Person[] = [
  SAMUEL, MAGDA, PEDRO, PAULA, TIAGO, TANIA, ANDRE, BEATRIZ, CARLA, RITA, DIEGO, HUGO, CAIO, FABIO,
  DEBORA, LAURO, VANIA, GABRIEL, OLGA, ZELIA, SONIA, ESTER, LUCIA,
];
export const COUPLES: Array<[Person, Person]> = [[SAMUEL, MAGDA], [PEDRO, PAULA], [TIAGO, TANIA], [ANDRE, BEATRIZ], [DIEGO, OLGA], [HUGO, VANIA]];

/** Células: C1 a C11 do spec; só C1 tem timóteo e anfitrião (Caio e Carla). */
export interface Cell {
  n: number;
  leader: Person;
  timothy?: Person;
  host?: Person;
  inactive?: boolean;
  deleted?: boolean;
}
export const CELLS: Cell[] = [
  { n: 1, leader: ANDRE, timothy: CAIO, host: CARLA },
  { n: 2, leader: DIEGO },
  { n: 3, leader: DEBORA },
  { n: 4, leader: GABRIEL },
  { n: 5, leader: CAIO, inactive: true },
  { n: 6, leader: LAURO },
  { n: 7, leader: SONIA },
  { n: 8, leader: CARLA },
  { n: 9, leader: LUCIA },
  { n: 10, leader: FABIO },
  { n: 11, leader: CAIO, deleted: true },
];

export const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;
export const cellId = (n: number) => `${PREFIX}-0003-0000-0000-${String(n).padStart(12, "0")}`;
export const ROLE_SCOPE = `${PREFIX}-0002-0000-0000-000000000001`;
export const memberId = (person: Person) => id(person.n);
const mobileOf = (n: number) => `5193206${String(n).padStart(4, "0")}`;
export const emailOf = (person: Person) =>
  `${person.name.split(" ")[0]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}${ADMIN_EMAIL_SUFFIX}`;

const SCOPE_PERMISSIONS = ["view_dashboard", "view_own_ministry", "edit_own_data", "submit_own_cell_report"];

/** A ordem de inserção: quem lidera antes de quem é liderado. */
function insertionOrder(): Person[] {
  const done = new Set<number>();
  const order: Person[] = [];
  while (order.length < PEOPLE.length) {
    for (const person of PEOPLE) {
      if (done.has(person.n)) continue;
      if (person.leader !== null && !done.has(person.leader)) continue;
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
     UNION SELECT id FROM auth.users WHERE email LIKE '%${ADMIN_EMAIL_SUFFIX}'`,
  );
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

export function cleanup(env: E2EEnv) {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR actor_label IN (${PEOPLE.map((x) => lit(x.name)).join(", ")}) OR entity_label IN (${PEOPLE.map((x) => lit(x.name)).join(", ")});
     DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id::text LIKE '${PREFIX}%');
     DELETE FROM public.cell_reports WHERE cell_id::text LIKE '${PREFIX}%';
     DELETE FROM public.cells WHERE id::text LIKE '${PREFIX}%' OR leader_id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     COMMIT;
     DELETE FROM private.sign_in_throttle;`,
  );
}

/** Cria a massa do spec, com os gatilhos ligados. As contas de Rita, Pedro, Diego, André e Hugo logam com PASSWORD. */
export async function seed(env: E2EEnv) {
  const adminRole = sql(env, "SELECT id FROM public.roles WHERE is_system AND name = 'Administrador'");
  const authIds: Record<number, string> = {};
  for (const person of PEOPLE.filter((x) => x.login)) authIds[person.n] = await createAuthUser(env, emailOf(person), PASSWORD);
  sql(
    env,
    `INSERT INTO public.roles (id, name) VALUES (${lit(ROLE_SCOPE)}, 'QA Hierarquia Escopo');
     INSERT INTO public.role_permissions (role_id, permission)
       SELECT ${lit(ROLE_SCOPE)}::uuid, p::public.permission_action FROM unnest(ARRAY[${SCOPE_PERMISSIONS.map(lit).join(", ")}]::text[]) p;`,
  );
  const memberRole = sql(env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Membro'");
  const roleOf = (person: Person) =>
    person.role === "ADMIN" ? lit(adminRole) : person.role === "ESCOPO" ? lit(ROLE_SCOPE) : person.role === "NONE" ? "NULL" : lit(memberRole);
  for (const person of insertionOrder()) {
    sql(
      env,
      `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, auth_user_id, role_id, email, mobile_whatsapp)
       VALUES (${lit(memberId(person))}, ${lit(person.name)}, ${lit(person.gender)}, ${!!person.pastor}, ${person.leader !== null},
               ${person.leader === null ? "NULL" : lit(id(person.leader))}, true,
               ${person.login ? lit(authIds[person.n]!) : "NULL"}, ${roleOf(person)}, ${person.login ? lit(emailOf(person)) : "NULL"}, ${lit(mobileOf(person.n))});`,
    );
  }
  for (const [a, b] of COUPLES) sql(env, `UPDATE public.members SET spouse_id = ${lit(memberId(b))} WHERE id = ${lit(memberId(a))};`);
  for (const cell of CELLS) {
    sql(
      env,
      `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active)
       VALUES (${lit(cellId(cell.n))}, ${lit(memberId(cell.leader))}, ${cell.timothy ? lit(memberId(cell.timothy)) : "NULL"},
               ${cell.host ? lit(memberId(cell.host)) : "NULL"}, 'Evangelística', 'Quarta', '20:00', true);`,
    );
  }
  // Inativos e excluídos por último (o líder inativo e o cadastro excluído não aceitam novos vínculos).
  for (const person of PEOPLE.filter((x) => x.inactive)) sql(env, `UPDATE public.members SET is_active = false WHERE id = ${lit(memberId(person))};`);
  for (const cell of CELLS.filter((c) => c.inactive)) sql(env, `UPDATE public.cells SET is_active = false WHERE id = ${lit(cellId(cell.n))};`);
  for (const cell of CELLS.filter((c) => c.deleted)) sql(env, `UPDATE public.cells SET deleted_at = now() WHERE id = ${lit(cellId(cell.n))};`);
}

/** Os totais guardados de cada pessoa (verificação da massa, lida como postgres, sem sessão). */
export function memberTotals(env: E2EEnv, person: Person) {
  const [disciples, cells] = sql(env, `SELECT total_disciples, total_cells FROM private.member_hierarchy WHERE member_id = ${lit(memberId(person))}`).split("|");
  return { disciples: Number(disciples), cells: Number(cells) };
}

export async function signIn(page: Page, person: Person | { email: string; password: string }) {
  const credentials = "name" in person ? { email: emailOf(person), password: PASSWORD } : person;
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(credentials.email);
  await page.getByLabel("Senha", { exact: true }).fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
}

/** Uma sessão nova (contexto próprio) de outra pessoa, no tamanho de tela pedido. */
export async function sessionOf(browser: Browser, person: Person, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  await signIn(page, person);
  return { page, close: () => context.close() };
}

/** Zera a trava de tentativas do login (todas as chamadas locais vêm de 127.0.0.1). */
export const resetThrottle = (env: E2EEnv) => sql(env, "DELETE FROM private.sign_in_throttle;");

/** Troca o tema (o app usa a classe `dark` no `html`) e espera a transição de cores. */
export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
  await page.waitForTimeout(400);
}

/** Sem rolagem horizontal na página (a tabela pode rolar dentro do cartão, a página não). */
export async function expectNoPageHScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: rolagem horizontal da página`).toBeLessThanOrEqual(0);
}

/** Simula a fonte do sistema a 200% (o Tailwind usa rem), sem trocar o viewport. */
export async function zoom200(page: Page) {
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
}

export interface AxeSummary {
  screen: string;
  width: number;
  theme: string;
  /** Violações novas (o que o teste cobra). */
  violations: Array<{ id: string; impact: string | null | undefined; nodes: number; first: string }>;
  /** Nós com o contraste conhecido do `--primary` (2,97:1, "Problemas conhecidos" do CLAUDE.md): contados, não cobrados. */
  knownPrimaryContrast: number;
}

const KNOWN_PRIMARY_CONTRAST = /contrast of 2\.97 \(foreground color: #ffffff, background color: #7599bd/;

/** Roda o axe (WCAG 2 A e AA) na página aberta. */
export async function axeScan(page: Page, screen: string, theme: "light" | "dark"): Promise<AxeSummary> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  let knownPrimaryContrast = 0;
  const violations = results.violations
    .map((v) => {
      const nodes = v.nodes.filter((n) => {
        const known = v.id === "color-contrast" && KNOWN_PRIMARY_CONTRAST.test(n.any[0]?.message ?? "");
        if (known) knownPrimaryContrast += 1;
        return !known;
      });
      return { id: v.id, impact: v.impact, nodes: nodes.length, first: nodes[0]?.target.join(" ") ?? "" };
    })
    .filter((v) => v.nodes > 0);
  const summary: AxeSummary = { screen, width: page.viewportSize()?.width ?? 0, theme, violations, knownPrimaryContrast };
  // AXE_OUT: arquivo (uma linha de JSON por tela) para o resumo das capturas da revisão de UI.
  if (process.env.AXE_OUT) appendFileSync(process.env.AXE_OUT, `${JSON.stringify(summary)}\n`);
  return summary;
}

/** A linha da tabela de Membros (a primeira coluna com o nome; com a foto, a segunda). */
export const memberRow = (page: Page, name: string, wide: boolean) =>
  page.locator("tbody tr").filter({ has: page.locator(`td:nth-child(${wide ? 2 : 1}) span.font-medium`, { hasText: new RegExp(`^${name}$`) }) });

/** O cartão de um membro (celular e tablet). */
export const memberCard = (page: Page, name: string) =>
  page.locator("div.space-y-3").filter({ has: page.locator("p.font-semibold", { hasText: new RegExp(`^${name}$`) }) });

/** O nó (botão) da árvore de Ministérios pelo começo do nome acessível. */
export const treeNode = (page: Page, start: string) => page.getByRole("button", { name: new RegExp(`^${start}`) });

/** Abre o nó da árvore (se estiver fechado) e espera os filhos. */
export async function expandNode(page: Page, start: string) {
  const node = treeNode(page, start).first();
  await expect(node).toBeVisible();
  if ((await node.getAttribute("aria-expanded")) !== "true") await node.click();
  await expect(node).toHaveAttribute("aria-expanded", "true");
  await expect(node.locator("xpath=..").getByRole("status")).toHaveCount(0);
}
