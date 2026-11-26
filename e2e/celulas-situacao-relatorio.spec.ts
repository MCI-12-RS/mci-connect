import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, sql, toast, type E2EEnv } from "./exclusao-support";
import { axeScan, setTheme, zoom200 } from "./hierarquia-support";
import { E2E_BASE_URL } from "./base-url";

// Situação do relatório na lista de Células e no card do Dashboard (E2.09,
// PRs 2 e 3, tarefas 7 e 11): UX-01, UX-02, UX-06, UX-07, UX-09, UX-10, UX-11,
// UX-12, UX-13 e UX-15, com login de verdade na stack local (variáveis de
// `e2e/exclusao-support.ts`).
//
// O relógio é o do servidor (`now()` da `cells_view`): a massa é montada em
// volta do momento do teste. As células "passadas" se reúnem 2 horas antes de
// agora e as "futuras", 2 horas depois; os períodos ativos e os relatórios das
// semanas anteriores são gravados direto no banco. Nas 3 primeiras horas do
// domingo e nas 3 últimas do sábado (Brasília) os dois horários não cabem na
// mesma semana, e os testes são pulados.
//
// Massa fictícia ("QA Sit209 …", ids e2e209a1-…), refeita a cada teste e apagada no fim.

const PREFIX = "e2e209a1";
const NAME = "QA Sit209";
const PASSWORD = "QaSit209#2026";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;

type RoleKey = "ADMIN" | "LIDER" | "MEMBRO";
interface Who {
  n: number;
  name: string;
  gender: "M" | "F";
  leader: number | null;
  role: RoleKey;
  pastor?: boolean;
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

const SAMUEL = who(1, "Samuel Luz", "M", null, "LIDER", { pastor: true });
const PEDRO = who(2, "Pedro Dias", "M", 1, "LIDER", { login: true });
const ANDRE = who(3, "André Souza", "M", 2, "LIDER");
const CARLA = who(4, "Carla Dias", "F", 2, "MEMBRO", { login: true });
const RITA = who(5, "Rita Reis", "F", 1, "ADMIN", { login: true });
const BRUNO = who(6, "Bruno Alves", "M", 2, "MEMBRO");
const DAVI = who(7, "Davi Rocha", "M", 2, "MEMBRO");
const ELISA = who(8, "Elisa Prado", "F", 2, "MEMBRO");
const TIAGO = who(9, "Tiago Melo", "M", 2, "MEMBRO");
const OTTO = who(10, "Otto Cruz", "M", 5, "MEMBRO");
const SARA = who(11, "Sara Cruz", "F", 5, "MEMBRO");
const PEOPLE = [SAMUEL, PEDRO, ANDRE, CARLA, RITA, BRUNO, DAVI, ELISA, TIAGO, OTTO, SARA];

const memberId = (w: Who) => id(1, w.n);
const cellId = (n: number) => id(3, n);
const reportId = (n: number) => id(4, n);
const emailOf = (w: Who) => `${w.name.split(" ")[2]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.e209a1@teste.invalid`;
const mobileOf = (n: number) => `5193209${String(n).padStart(4, "0")}`;

/** Quando a célula se reúne e desde quando ela conta (RN-06). */
type Slot = "past" | "future";
type Since = "week" | "long" | "now";
interface CellSpec {
  n: number;
  leader: Who;
  timothy: Who;
  host: Who;
  slot: Slot;
  since: Since;
  active?: boolean;
  /** O relatório desta semana: realizado ou "Não houve célula". */
  report?: "held" | "not_held";
  /** Um relatório de semanas atrás (o resto, sem relatório). */
  reportWeeksAgo?: number;
  /** O que a lista mostra (cartão), na ordem: o badge e a linha das semanas. */
  expected: string | null;
}

const CELLS: CellSpec[] = [
  { n: 1, leader: ANDRE, timothy: BRUNO, host: CARLA, slot: "past", since: "week", expected: "Relatório: Pendente" },
  {
    n: 2,
    leader: PEDRO,
    timothy: ANDRE,
    host: CARLA,
    slot: "past",
    since: "long",
    reportWeeksAgo: 3,
    expected: "Relatório: Pendente Sem relatório nas 2 semanas anteriores",
  },
  {
    n: 3,
    leader: BRUNO,
    timothy: ANDRE,
    host: CARLA,
    slot: "future",
    since: "long",
    expected: "Relatório: Ainda não ocorreu Sem relatório nas 4 ou mais semanas anteriores",
  },
  { n: 4, leader: DAVI, timothy: ANDRE, host: CARLA, slot: "past", since: "week", report: "held", expected: "Relatório: Enviado · Célula realizada" },
  {
    n: 5,
    leader: SAMUEL,
    timothy: ANDRE,
    host: CARLA,
    slot: "past",
    since: "week",
    report: "not_held",
    expected: "Relatório: Enviado · Não houve célula",
  },
  { n: 6, leader: ELISA, timothy: ANDRE, host: CARLA, slot: "past", since: "now", expected: "Relatório: Conta a partir da próxima semana" },
  { n: 7, leader: TIAGO, timothy: ANDRE, host: CARLA, slot: "past", since: "week", active: false, expected: null },
  // Fora do escopo de Pedro: só Rita vê (e conta no card dela).
  { n: 8, leader: OTTO, timothy: SARA, host: RITA, slot: "past", since: "week", expected: "Relatório: Pendente" },
];
const PEDRO_CELLS = CELLS.filter((c) => c.n !== 8);

const SLOT_SQL: Record<Slot, string> = {
  past: "public.sp_local(now() - interval '2 hours')",
  future: "public.sp_local(now() + interval '2 hours')",
};
const WEEKDAYS = "ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado']";
const dayOf = (slot: Slot) => `(${WEEKDAYS})[extract(dow FROM ${SLOT_SQL[slot]})::int + 1]`;
const timeOf = (slot: Slot) => `to_char(${SLOT_SQL[slot]}, 'HH24:MI')::time`;
const WEEK_START_INSTANT = "public.sp_instant(public.week_start(public.sp_today())::timestamp)";
const SINCE_SQL: Record<Exclude<Since, "now">, string> = {
  week: WEEK_START_INSTANT,
  long: "now() - interval '10 weeks'",
};

class SituationWorld {
  env!: E2EEnv;
  private roles: Record<RoleKey, string> = { ADMIN: "", LIDER: "", MEMBRO: "" };
  private authIds: Record<string, string> = {};

  /** Os dois horários (2 h antes e 3 h depois de agora) cabem na semana atual? */
  slotsFitThisWeek(): boolean {
    this.env = e2eEnv();
    return (
      sql(
        this.env,
        `SELECT public.week_start(public.sp_local(now() - interval '2 hours')::date) = public.week_start(public.sp_today())
            AND public.week_start(public.sp_local(now() + interval '3 hours')::date) = public.week_start(public.sp_today())`,
      ) === "t"
    );
  }

  private async removeAccounts() {
    const ids = sql(
      this.env,
      `SELECT auth_user_id FROM public.members WHERE name LIKE '${NAME}%' AND auth_user_id IS NOT NULL
       UNION SELECT id FROM auth.users WHERE email LIKE '%.e209a1@teste.invalid'`,
    );
    for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(this.env, userId);
  }

  private cleanup() {
    const cells = `SELECT id FROM public.cells WHERE id::text LIKE '${PREFIX}%' OR leader_id::text LIKE '${PREFIX}%'`;
    sql(
      this.env,
      `BEGIN;
       SET LOCAL session_replication_role = replica;
       DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR entity_label LIKE '${NAME}%' OR actor_label LIKE '${NAME}%';
       DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id IN (${cells}));
       DELETE FROM public.cell_reports WHERE cell_id IN (${cells});
       DELETE FROM private.cell_active_periods WHERE cell_id IN (${cells});
       DELETE FROM public.cells WHERE id IN (${cells});
       DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%';
       DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
       DELETE FROM private.sign_in_throttle;
       COMMIT;`,
    );
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
    const row = (w: Who) =>
      `(${lit(memberId(w))}, ${lit(w.name)}, ${lit(w.gender)}, ${!!w.pastor}, ${w.leader !== null}, ${w.leader === null ? "NULL" : lit(id(1, w.leader))}, ` +
      `true, ${w.login ? lit(this.authIds[w.name]!) : "NULL"}, ${lit(this.roles[w.role])}, ${w.login ? lit(emailOf(w)) : "NULL"}, ${lit(mobileOf(w.n))})`;
    const tier = (leaders: Array<number | null>) =>
      `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, auth_user_id, role_id, email, mobile_whatsapp)
       VALUES ${PEOPLE.filter((p) => leaders.includes(p.leader)).map(row).join(",\n              ")};`;
    const cell = (c: CellSpec) =>
      `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active, street, number, neighborhood)
       VALUES (${lit(cellId(c.n))}, ${lit(memberId(c.leader))}, ${lit(memberId(c.timothy))}, ${lit(memberId(c.host))}, 'Evangelística',
               ${dayOf(c.slot)}, ${timeOf(c.slot)}, true, 'Rua das Flores', ${lit(String(100 + c.n))}, 'Centro');` +
      // Uma célula nova sempre começa ativa (E2.08): a inativa é inativada depois.
      (c.active === false ? `\n       UPDATE public.cells SET is_active = false WHERE id = ${lit(cellId(c.n))};` : "");
    const period = (c: CellSpec) =>
      c.since === "now" || c.active === false
        ? ""
        : `UPDATE private.cell_active_periods SET periods = tstzmultirange(tstzrange(${SINCE_SQL[c.since]}, NULL)) WHERE cell_id = ${lit(cellId(c.n))};`;
    const report = (c: CellSpec, n: number, weeksAgo: number, held: boolean) =>
      `INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, reason_not_held, theme)
       VALUES (${lit(reportId(n))}, ${lit(cellId(c.n))}, (${SLOT_SQL[c.slot]})::date - ${7 * weeksAgo}, ${timeOf(c.slot)}, ${held},
               ${held ? "NULL" : "'Chuva forte'"}, ${held ? `'Tema ${n}'` : "NULL"});`;
    sql(
      this.env,
      `BEGIN;
       ${tier([null])}
       ${tier([1])}
       ${tier([2, 5])}
       ${CELLS.map(cell).join("\n       ")}
       ${CELLS.map(period).join("\n       ")}
       ${CELLS.filter((c) => c.report).map((c) => report(c, c.n, 0, c.report === "held")).join("\n       ")}
       COMMIT;
       BEGIN;
       SET LOCAL session_replication_role = replica;
       ${CELLS.filter((c) => c.reportWeeksAgo).map((c) => report(c, 10 + c.n, c.reportWeeksAgo!, true)).join("\n       ")}
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
            + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${PREFIX}%')
            + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e209a1@teste.invalid')`,
    );
    expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
  }

  /** A situação que a cells_view calcula agora, para conferir a massa antes da tela. */
  serverStatus(n: number) {
    return sql(
      this.env,
      `SELECT coalesce(s.report_status::text, '') || ' ' || coalesce(s.report_missing_weeks::text, '')
         FROM public.cells c, private.cell_report_situation(c.id, c.is_active, c.meeting_day, c.meeting_time, now()) s
        WHERE c.id = ${lit(cellId(n))}`,
    );
  }

  reportDate(n: number) {
    return sql(this.env, `SELECT to_char(date, 'DD/MM/YYYY') FROM public.cell_reports WHERE id = ${lit(reportId(n))}`);
  }

  setCellActive(n: number, active: boolean) {
    sql(this.env, `UPDATE public.cells SET is_active = ${active} WHERE id = ${lit(cellId(n))};`);
  }
}

const world = new SituationWorld();

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  test.skip(!world.slotsFitThisWeek(), "Os horários da massa (2 h antes e 3 h depois de agora) caem em semanas diferentes.");
  await world.setUp();
});
test.afterEach(async () => world.tearDown());

async function signIn(page: Page, w: Who) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(emailOf(w));
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
}

async function sessionOf(browser: Browser, w: Who, options: { viewport?: { width: number; height: number }; timezoneId?: string } = {}) {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL, ...options });
  const page = await context.newPage();
  await signIn(page, w);
  return { page, close: () => context.close() };
}

async function openCells(page: Page) {
  await page.goto(`/cells?q=${encodeURIComponent(NAME)}&size=50`);
  await expect(page.getByText("Carregando...")).toHaveCount(0);
}

/** O cartão de uma célula pelo líder (o G12 pode ter o mesmo nome; o líder é o primeiro `span.break-words`). */
const cardOf = (page: Page, leader: Who) =>
  page.locator("main li").filter({ has: page.locator("p.text-sm span.break-words", { hasText: new RegExp(`^${leader.name}`) }) });
const rowOf = (page: Page, leader: Who) =>
  page.locator("tbody tr").filter({ has: page.locator("td:first-child span.break-words", { hasText: new RegExp(`^${leader.name}`) }) });
/** A linha "Relatório:" do cartão, como se vê. */
const reportLine = (card: Locator) => card.locator('[data-part="meeting"] > div').last();
const seenText = (el: Locator) =>
  el.evaluate((node) => {
    const clone = node.cloneNode(true) as Element;
    clone.querySelectorAll(".sr-only").forEach((n) => n.replaceWith(" "));
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  });

/** O número do card de pendentes do Dashboard. */
const pendingCard = (page: Page) =>
  page.locator("div.rounded-lg", { has: page.getByRole("heading", { name: "Células com relatório pendente", exact: true }) }).locator("div.text-3xl");

/** Guarda, desde agora, todo texto que o elemento escolhido mostrar (inclusive o que aparecer só por um instante). */
async function watchTexts(page: Page, key: string, selector: string) {
  await page.evaluate(
    ({ key, selector }) => {
      const store = window as unknown as Record<string, string[]>;
      store[key] = [];
      const record = () => document.querySelectorAll(selector).forEach((el) => store[key].push(el.textContent ?? ""));
      new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true });
      record();
    },
    { key, selector },
  );
}
const watched = (page: Page, key: string) => page.evaluate((k) => (window as unknown as Record<string, string[]>)[k] ?? [], key);

test("a massa: a situação calculada pelo servidor é a que a tela deve mostrar", async () => {
  expect(world.serverStatus(1)).toBe("pending 0");
  expect(world.serverStatus(2)).toBe("pending 2");
  expect(world.serverStatus(3)).toBe("not_yet 4");
  expect(world.serverStatus(4)).toBe("sent_held 0");
  expect(world.serverStatus(5)).toBe("sent_not_held 0");
  expect(world.serverStatus(6)).toMatch(/^next_week /);
  expect(world.serverStatus(7), "inativa: sem situação").toBe("");
});

test("UX-01 e UX-03: nos cartões (360×800), cada célula ativa mostra a situação da semana e as semanas anteriores; a inativa não tem 'Relatório'", async ({ browser }) => {
  const rita = await sessionOf(browser, RITA, { viewport: { width: 360, height: 800 } });
  try {
    await openCells(rita.page);
    for (const c of CELLS) {
      const card = cardOf(rita.page, c.leader);
      await expect(card, c.leader.name).toHaveCount(1);
      if (c.expected) expect(await seenText(reportLine(card)), c.leader.name).toBe(c.expected);
      else {
        await expect(card).toContainText("Inativa");
        await expect(card).not.toContainText("Relatório");
      }
    }
  } finally {
    await rita.close();
  }

  // Pedro vê só o ministério dele: C8 (de Otto) não aparece, e o resto é igual.
  const pedro = await sessionOf(browser, PEDRO, { viewport: { width: 360, height: 800 } });
  try {
    await openCells(pedro.page);
    await expect(cardOf(pedro.page, OTTO)).toHaveCount(0);
    for (const c of PEDRO_CELLS.filter((x) => x.expected)) expect(await seenText(reportLine(cardOf(pedro.page, c.leader))), c.leader.name).toBe(c.expected);
  } finally {
    await pedro.close();
  }
});

test("UX-02 e UX-06: tabela a partir de 1280 px (Reunião e Relatório, '—' na inativa); cartões até 1279 px, com duas colunas de 1024 a 1279", async ({ page }) => {
  await signIn(page, RITA);
  for (const [width, height, kind] of [
    [1280, 800, "tabela"],
    [1440, 900, "tabela"],
    [1024, 768, "cartões em duas colunas"],
    [768, 1024, "cartões"],
    [360, 800, "cartões"],
  ] as const) {
    await page.setViewportSize({ width, height });
    // O primeiro render já é a forma certa: antes da lista chegar.
    await page.route("**/rest/v1/cells_view*", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.goto(`/cells?q=${encodeURIComponent(NAME)}&size=50`);
    await expect(page.getByText("Carregando...").first()).toBeVisible();
    await expect(page.getByRole("table"), `${width} px`).toHaveCount(kind === "tabela" ? 1 : 0);
    await page.unrouteAll({ behavior: "wait" });
    await expect(page.getByText("Carregando...")).toHaveCount(0);

    if (kind === "tabela") {
      const headers = (await page.getByRole("columnheader").allTextContents()).map((h) => h.trim());
      expect(headers).toEqual(["Líder", "G12", "Endereço", "Reunião", "Relatório", "Situação", "Ações"]);
      const reportCol = (w: Who) => rowOf(page, w).locator("td").nth(4);
      expect(await seenText(reportCol(ANDRE))).toBe("Pendente");
      expect(await seenText(reportCol(PEDRO))).toBe("Pendente Sem relatório nas 2 semanas anteriores");
      expect(await seenText(reportCol(SAMUEL))).toBe("Enviado · Não houve célula");
      expect(await seenText(reportCol(TIAGO))).toBe("—");
      await expect(reportCol(TIAGO).locator(".sr-only")).toHaveText("Não se aplica, célula inativa");
      await expect(rowOf(page, ANDRE).locator("td").nth(3)).toContainText("Evangelística");
      expect(await seenText(rowOf(page, ANDRE).locator("td").nth(3).locator("span.text-sm"))).toMatch(/^\S+ · \d\d:\d\d$/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width} px: sem rolagem horizontal`).toBeLessThanOrEqual(0);
    } else {
      const card = cardOf(page, ANDRE);
      const people = await card.locator('[data-part="people"]').boundingBox();
      const meeting = await card.locator('[data-part="meeting"]').boundingBox();
      if (kind === "cartões em duas colunas") {
        expect(meeting!.x, "reunião à direita das pessoas").toBeGreaterThan(people!.x + people!.width - 1);
        expect(Math.abs(meeting!.y - people!.y), "lado a lado").toBeLessThan(4);
      } else {
        expect(meeting!.y, "reunião embaixo das pessoas").toBeGreaterThanOrEqual(people!.y + people!.height - 1);
      }
    }
  }
});

test("UX-07: em 320×640 com fonte a 200%, os badges e a linha das semanas quebram por dentro, sem corte e sem rolar a página", async ({ page }) => {
  await signIn(page, RITA);
  await page.setViewportSize({ width: 320, height: 640 });
  await openCells(page);
  await zoom200(page);
  for (const [leader, text] of [
    [ELISA, "Conta a partir da próxima semana"],
    [SAMUEL, "Não houve célula"],
    [BRUNO, "Sem relatório nas 4 ou mais semanas anteriores"],
  ] as const) {
    const el = cardOf(page, leader).getByText(text);
    const box = await el.boundingBox();
    expect(box, leader.name).not.toBeNull();
    expect(box!.x + box!.width, `${leader.name}: dentro da tela`).toBeLessThanOrEqual(320);
    // Quebrou linha: mais alto que uma linha só do texto.
    const lineHeight = await el.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
    expect(box!.height, `${leader.name}: quebra de linha`).toBeGreaterThan(lineHeight * 1.5);
    expect(await el.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), `${leader.name}: sem corte`).toBe(true);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "sem rolagem horizontal").toBeLessThanOrEqual(0);
});

test("UX-09: a legenda começa fechada, com o botão de 44 px no celular; aberta, explica os cinco valores, as semanas e o carregamento", async ({ page }) => {
  await signIn(page, PEDRO);
  await page.setViewportSize({ width: 360, height: 800 });
  await openCells(page);
  const button = page.getByRole("button", { name: "Entenda a situação do relatório" });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("A reunião desta semana já passou e o relatório não foi enviado.")).toHaveCount(0);

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const legend = page.locator("dl");
  await expect(legend.locator("dt")).toHaveCount(6);
  await expect(legend).toContainText("O relatório fica pendente 1 hora depois do horário da célula.");
  await expect(page.getByText("A semana vai de domingo a sábado. A situação é a do momento em que a lista foi carregada.")).toBeVisible();

  // Sem resultado na busca, a legenda continua; e volta fechada numa visita nova.
  await page.goto("/cells?q=zzzz-nada");
  await expect(page.getByText("Nenhuma célula encontrada")).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("UX-10: Carla envia o relatório de C1 pela lista; sem recarregar, o cartão passa a 'Enviado · Célula realizada', com a lista em opacity-60 e aria-busy enquanto recarrega", async ({ browser }) => {
  const carla = await sessionOf(browser, CARLA, { viewport: { width: 360, height: 800 } });
  const { page } = carla;
  try {
    await openCells(page);
    const card = cardOf(page, ANDRE);
    expect(await seenText(reportLine(card))).toBe("Relatório: Pendente");
    const opener = page.getByRole("button", { name: `Novo relatório da célula de ${ANDRE.name}` });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
    await dialog.getByLabel("Tema da Palavra").fill("Fé que move montanhas");

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    // Segura só a releitura da lista (a única leitura da cells_view que pede a situação).
    await page.route("**/rest/v1/cells_view*", async (route) => {
      if (route.request().method() === "GET" && route.request().url().includes("report_status")) await held;
      await route.continue();
    });
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog).toHaveCount(0);
    const list = page.locator("main ul.divide-y");
    await expect(list).toHaveAttribute("aria-busy", "true");
    await expect(list).toHaveClass(/opacity-60/);
    release();
    await page.unrouteAll({ behavior: "wait" });

    await expect.poll(() => seenText(reportLine(card))).toBe("Relatório: Enviado · Célula realizada");
    await expect(list).toHaveAttribute("aria-busy", "false");
    await expect(opener).toBeFocused();
  } finally {
    await carla.close();
  }

  // Pedro inativa C1 (no banco, como outra pessoa): a próxima consulta tira a linha "Relatório".
  world.setCellActive(1, false);
  const pedro = await sessionOf(browser, PEDRO, { viewport: { width: 1280, height: 800 } });
  try {
    await openCells(pedro.page);
    expect(await seenText(rowOf(pedro.page, ANDRE).locator("td").nth(4))).toBe("—");
  } finally {
    await pedro.close();
  }
});

test("UX-11 e UX-13: Rita exclui e restaura o relatório de C4; a lista de Células e o card do Dashboard nunca mostram o valor de antes, e o card bate com a lista", async ({ page }) => {
  test.slow();
  await signIn(page, RITA);
  const menu = (name: string) => page.locator("nav").getByRole("button", { name, exact: true });

  // UX-13: o card de Rita é o número de células "Pendente" na lista dela (a da igreja toda).
  const pendingInList = async () => {
    const token = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? "";
        if (key.endsWith("-auth-token")) return String(JSON.parse(localStorage.getItem(key) ?? "{}").access_token ?? "");
      }
      return "";
    });
    const env = e2eEnv();
    const response = await page.request.get(`${env.apiUrl}/rest/v1/cells_view?select=id&report_status=eq.pending`, {
      headers: { apikey: env.publishableKey, Authorization: `Bearer ${token}`, Prefer: "count=exact", Range: "0-0" },
    });
    return Number(response.headers()["content-range"]?.split("/")[1]);
  };
  await expect(pendingCard(page)).toHaveText(/^\d+$/);
  const before = Number(await pendingCard(page).textContent());
  expect(before).toBe(await pendingInList());
  await expect(page.getByRole("heading", { name: "Células com relatório pendente" }).locator("xpath=..").locator("svg.lucide-triangle-alert")).toHaveAttribute(
    "aria-hidden",
    "true",
  );

  // A lista de Células, guardada no cache com C4 "Enviado".
  await menu("Células").click();
  await expect(rowOf(page, DAVI)).toContainText("Célula realizada");

  // Exclui o relatório de C4 em Relatórios.
  await menu("Relatórios").click();
  const date = world.reportDate(4);
  await page.getByRole("button", { name: `Excluir o relatório de ${date} da célula de ${DAVI.name}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir relatório" }).click();
  await expect(toast(page, "Relatório excluído.")).toBeVisible();

  // Células: a primeira lista exibida já é a nova.
  await watchTexts(page, "c4", "tbody tr");
  await menu("Células").click();
  await expect(rowOf(page, DAVI)).toContainText("Pendente");
  expect((await watched(page, "c4")).filter((t) => t.includes(DAVI.name) && t.includes("Enviado")), "C4 nunca 'Enviado'").toEqual([]);

  // Dashboard: de N para N + 1, sem mostrar N.
  // O card de pendentes é o 2º de "Esta Semana" (T4): o número dele, a cada mudança.
  await watchTexts(page, "card", "main div.grid > div.rounded-lg:nth-child(2) div.text-3xl");
  await menu("Dashboard").click();
  await expect(pendingCard(page)).toHaveText(String(before + 1));
  expect(await pendingInList()).toBe(before + 1);
  const shown = await watched(page, "card");
  expect(shown, "o card mostrou o número novo").toContain(String(before + 1));
  expect(shown.filter((t) => t === String(before)), "o card nunca mostrou o número de antes").toEqual([]);

  // Restaura: C4 volta a "Enviado" e o card a N.
  await menu("Relatórios").click();
  await page.getByRole("link", { name: "Ver relatórios excluídos" }).or(page.getByRole("button", { name: "Ver relatórios excluídos" })).click();
  await page.getByRole("button", { name: `Restaurar o relatório de ${date} da célula de ${DAVI.name}` }).click();
  await expect(toast(page, "restaurado")).toBeVisible();
  await watchTexts(page, "c4b", "tbody tr");
  await menu("Células").click();
  await expect(rowOf(page, DAVI)).toContainText("Célula realizada");
  expect((await watched(page, "c4b")).filter((t) => t.includes(DAVI.name) && t.includes("Pendente")), "C4 nunca 'Pendente'").toEqual([]);
  await menu("Dashboard").click();
  await expect(pendingCard(page)).toHaveText(String(before));
});

test("UX-13: o card de Pedro é o número de 'Pendente' na lista dele (C1 e C2, sem C8 de fora do ministério)", async ({ browser }) => {
  const pedro = await sessionOf(browser, PEDRO, { viewport: { width: 360, height: 800 } });
  try {
    await expect(pedro.page.getByRole("heading", { name: "Células com relatório pendente" })).toBeVisible();
    await expect(pendingCard(pedro.page)).toHaveText("2");
    await expect(pedro.page.getByText("Células sem Relatório")).toHaveCount(0);
    await openCells(pedro.page);
    await expect(pedro.page.locator("main li").filter({ hasText: "Relatório: Pendente" })).toHaveCount(2);
  } finally {
    await pedro.close();
  }
});

test("UX-12: com o navegador em Tóquio, a lista mostra a mesma situação do servidor", async ({ browser }) => {
  const rita = await sessionOf(browser, RITA, { viewport: { width: 360, height: 800 }, timezoneId: "Asia/Tokyo" });
  try {
    await openCells(rita.page);
    for (const c of CELLS.filter((x) => x.expected)) expect(await seenText(reportLine(cardOf(rita.page, c.leader))), c.leader.name).toBe(c.expected);
  } finally {
    await rita.close();
  }
});

test("UX-15: axe na lista com a legenda aberta, em 360 e 1280 px, nos temas claro e escuro", async ({ page }, testInfo) => {
  await signIn(page, RITA);
  const summaries = [];
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await openCells(page);
    await page.getByRole("button", { name: "Entenda a situação do relatório" }).click();
    await expect(page.locator("dl")).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      summaries.push(await axeScan(page, "Células (situação)", theme));
    }
    await setTheme(page, "light");
  }
  await testInfo.attach("axe-situacao.json", { body: JSON.stringify(summaries, null, 2), contentType: "application/json" });
  const withViolations = summaries.filter((s) => s.violations.length > 0);
  expect(withViolations, JSON.stringify(withViolations, null, 1)).toEqual([]);
});
