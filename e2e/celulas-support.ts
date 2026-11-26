import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import { E2E_BASE_URL } from "./base-url";

// Massa do cadastro de células (E2.08, PRs 3 a 5): pessoas, endereços e três
// células, com os nomes da massa do spec. Fictícia ("QA Cel208 …", ids
// e2e208f5-…), refeita a cada teste e apagada no fim. As células se reúnem
// hoje (Brasília): o relatório sugerido cai nesta semana.

export const PREFIX = "e2e208f5";
export const NAME = "QA Cel208";
export const PASSWORD = "QaCel208#2026";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;
export const cellId = (n: number) => id(3, n);

type RoleKey = "ADMIN" | "LIDER" | "MEMBRO";

export interface Who {
  n: number;
  name: string;
  gender: "M" | "F";
  leader: number | null;
  role: RoleKey;
  pastor?: boolean;
  inactive?: boolean;
  login?: boolean;
  address?: { street: string; number: string; complement: string | null; neighborhood: string; city: string; state: string; zip_code: string };
}

const who = (n: number, name: string, gender: "M" | "F", leader: number | null, role: RoleKey, extra: Partial<Who> = {}): Who => ({
  n,
  name: `${NAME} ${name}`,
  gender,
  leader,
  role,
  ...extra,
});

export const CARLA_ADDRESS = {
  street: "Rua das Flores",
  number: "100",
  complement: "ap. 2",
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  zip_code: "90010-000",
};

export const SAMUEL = who(1, "Samuel Luz", "M", null, "LIDER", { pastor: true });
export const PEDRO = who(2, "Pedro Dias", "M", 1, "LIDER", { login: true });
export const ANDRE = who(3, "André Souza", "M", 2, "LIDER");
export const CAIO = who(4, "Caio Lima", "M", 3, "MEMBRO", { login: true });
export const CARLA = who(5, "Carla Dias", "F", 2, "MEMBRO", { login: true, address: CARLA_ADDRESS });
export const FABIO = who(6, "Fábio Lima", "M", 3, "MEMBRO", {
  inactive: true,
  address: { street: "Av. Ipiranga", number: "5", complement: null, neighborhood: "Azenha", city: "Porto Alegre", state: "RS", zip_code: "90160-000" },
});
export const GABRIEL = who(7, "Gabriel Nunes", "M", 3, "MEMBRO");
export const RITA = who(8, "Rita Reis", "F", 1, "ADMIN", { login: true });
export const TIAGO = who(9, "Tiago Melo", "M", 1, "MEMBRO");
export const BEATRIZ = who(10, "Beatriz Melo", "F", 9, "MEMBRO", { inactive: true });
export const PEOPLE = [SAMUEL, PEDRO, ANDRE, CAIO, CARLA, FABIO, GABRIEL, RITA, TIAGO, BEATRIZ];

/** C1 (André, Caio, Carla), C2 (Caio, André, Gabriel) e C3 (Gabriel, Caio, Beatriz, fora do escopo de Pedro). */
export const CELLS = [
  { n: 1, leader: ANDRE, timothy: CAIO, host: CARLA, time: "20:00", address: CARLA_ADDRESS },
  { n: 2, leader: CAIO, timothy: ANDRE, host: GABRIEL, time: "19:00", address: null },
  { n: 3, leader: GABRIEL, timothy: CAIO, host: BEATRIZ, time: "18:00", address: null },
];

export const emailOf = (w: Who) =>
  `${w.name.split(" ")[2]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.e208f5@teste.invalid`;
export const memberId = (w: Who) => id(1, w.n);
const mobileOf = (n: number) => `5193208${String(n).padStart(4, "0")}`;

const WEEKDAY_SQL = "(ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'])[extract(dow FROM public.sp_today())::int + 1]";

const opt = (value: string | null | undefined) => (value == null ? "NULL" : lit(value));

export class CellsWorld {
  env!: E2EEnv;
  private roles: Record<RoleKey, string> = { ADMIN: "", LIDER: "", MEMBRO: "" };
  private authIds: Record<string, string> = {};

  private async removeAccounts() {
    const ids = sql(
      this.env,
      `SELECT auth_user_id FROM public.members WHERE name LIKE '${NAME}%' AND auth_user_id IS NOT NULL
       UNION SELECT id FROM auth.users WHERE email LIKE '%.e208f5@teste.invalid'`,
    );
    for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(this.env, userId);
  }

  private cleanup() {
    sql(
      this.env,
      `BEGIN;
       SET LOCAL session_replication_role = replica;
       DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR entity_label LIKE '${NAME}%' OR actor_label LIKE '${NAME}%';
       ${this.cellsCleanupSql()}
       DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%';
       DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
       DELETE FROM private.sign_in_throttle;
       COMMIT;`,
    );
  }

  /** As células da massa e as criadas pela tela (pelas pessoas da massa), com os relatórios. */
  private cellsCleanupSql() {
    const cells = `SELECT id FROM public.cells WHERE id::text LIKE '${PREFIX}%' OR leader_id::text LIKE '${PREFIX}%'`;
    return `DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id IN (${cells}));
       DELETE FROM public.cell_reports WHERE cell_id IN (${cells});
       DELETE FROM public.cells WHERE id IN (${cells});`;
  }

  async setUp() {
    this.env = e2eEnv();
    await this.removeAccounts();
    this.cleanup();
    this.roles = {
      ADMIN: sql(this.env, "SELECT id FROM public.roles WHERE is_system AND name = 'Administrador'"),
      LIDER: sql(this.env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Líder'"),
      MEMBRO: sql(this.env, "SELECT id FROM public.roles WHERE NOT is_system AND name = 'Membro'"),
    };
    for (const w of PEOPLE.filter((p) => p.login)) this.authIds[w.name] = await createAuthUser(this.env, emailOf(w), PASSWORD);
    const row = (w: Who) => {
      const a = w.address;
      return (
        `(${lit(memberId(w))}, ${lit(w.name)}, ${lit(w.gender)}, ${!!w.pastor}, ${w.leader !== null}, ${w.leader === null ? "NULL" : lit(id(1, w.leader))}, ` +
        `${!w.inactive}, ${w.login ? lit(this.authIds[w.name]!) : "NULL"}, ${lit(this.roles[w.role])}, ${w.login ? lit(emailOf(w)) : "NULL"}, ${lit(mobileOf(w.n))}, ` +
        `${opt(a?.street)}, ${opt(a?.number)}, ${opt(a?.complement)}, ${opt(a?.neighborhood)}, ${opt(a?.city)}, ${opt(a?.state)}, ${opt(a?.zip_code)})`
      );
    };
    const tier = (members: Who[]) =>
      `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, auth_user_id, role_id, email, mobile_whatsapp,
         street, number, complement, neighborhood, city, state, zip_code)
       VALUES ${members.map(row).join(",\n              ")};`;
    const byLeader = (leaders: Array<number | null>) => PEOPLE.filter((p) => leaders.includes(p.leader));
    sql(
      this.env,
      `BEGIN;
       ${tier(byLeader([null]))}
       ${tier(byLeader([1]))}
       ${tier(byLeader([2, 9]))}
       ${tier(byLeader([3]))}
       COMMIT;`,
    );
  }

  async tearDown() {
    if (!this.env) return;
    await this.removeAccounts();
    this.cleanup();
    const leftovers = sql(
      this.env,
      `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%')
            + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${PREFIX}%' OR leader_id::text LIKE '${PREFIX}%')
            + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e208f5@teste.invalid')`,
    );
    expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
  }

  /** As três células, ativas, do zero (e nenhuma criada pela tela). */
  resetCells() {
    sql(
      this.env,
      `BEGIN;
       SET LOCAL session_replication_role = replica;
       ${this.cellsCleanupSql()}
       DELETE FROM private.sign_in_throttle;
       COMMIT;
       ${CELLS.map((c) => {
         const a = c.address;
         return `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active, street, number, complement, neighborhood, city, state, zip_code)
         VALUES (${lit(cellId(c.n))}, ${lit(memberId(c.leader))}, ${lit(memberId(c.timothy))}, ${lit(memberId(c.host))}, 'Evangelística', ${WEEKDAY_SQL}, ${lit(c.time)}, true,
                 ${opt(a?.street)}, ${opt(a?.number)}, ${opt(a?.complement)}, ${opt(a?.neighborhood)}, ${opt(a?.city)}, ${opt(a?.state)}, ${opt(a?.zip_code)});`;
       }).join("\n       ")}`,
    );
  }

  /** Inativa ou reativa uma célula direto no banco (outra pessoa no meio tempo). */
  setCellActive(n: number, active: boolean) {
    sql(this.env, `UPDATE public.cells SET is_active = ${active} WHERE id = ${lit(cellId(n))};`);
  }

  cellValue(n: number, column: string) {
    return sql(this.env, `SELECT coalesce(${column}::text, '') FROM public.cells WHERE id = ${lit(cellId(n))}`);
  }

  /** As células criadas pela tela com esse líder, timóteo e anfitrião. */
  createdCells(leader: Who, timothy: Who, host: Who) {
    return sql(
      this.env,
      `SELECT meeting_day || ' ' || meeting_time::text || ' ' || coalesce(street, '') || ' ' || coalesce(complement, '') || ' ' || is_active
         FROM public.cells
        WHERE id::text NOT LIKE '${PREFIX}%' AND leader_id = ${lit(memberId(leader))} AND timothy_id = ${lit(memberId(timothy))}
          AND host_id = ${lit(memberId(host))} AND deleted_at IS NULL`,
    )
      .split("\n")
      .filter(Boolean);
  }

  reportsOfCell(n: number) {
    return Number(sql(this.env, `SELECT count(*) FROM public.cell_reports WHERE cell_id = ${lit(cellId(n))} AND deleted_at IS NULL`));
  }
}

export async function signIn(page: Page, w: Who) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(emailOf(w));
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
}

export async function sessionOf(browser: Browser, w: Who, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  await signIn(page, w);
  return { page, context, close: () => context.close() };
}

export const newReportButton = (page: Page, w: Who) => page.getByRole("button", { name: `Novo relatório da célula de ${w.name}` });
export const editCellButton = (page: Page, w: Who) => page.getByRole("button", { name: `Editar a célula de ${w.name}` });

/** Busca e escolhe uma pessoa num seletor (react-select) do formulário. */
export async function pickPerson(page: Page, field: Locator, search: string, option: string | RegExp) {
  await field.click();
  await field.pressSequentially(search);
  await page.getByRole("option", { name: option }).click();
}

/** Escolhe um valor num Select do Radix pelo rótulo. */
export async function chooseOption(page: Page, dialog: Locator, label: string, option: string) {
  await dialog.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
