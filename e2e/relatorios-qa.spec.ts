import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// QA do E2.12 (PRs 2 e 3): o que os specs do desenvolvedor não cobrem. A paridade da lista pela tela com
// o banco, por persona, com filtros e atalhos (RN-01 a RN-14); o link de Diego (RN-07, UX-11); os
// atalhos com o relógio do servidor controlado (RN-10, UX-04); a corrida entre respostas; os curingas
// da busca (RN-14, risco 1); a consulta fora do escopo, excluída e de célula excluída (RN-16, UX-23);
// editar, lançar, excluir e restaurar com a lista e a consulta atualizadas (UX-24); o voltar do
// aparelho com o formulário aberto (divergência 1). A massa é a do E2.10 (celulas-filtros-support), com
// participantes em R1 e R6 e dois relatórios com curingas no tema. Rodar com `--workers=1`.

let env: E2EEnv;

const REPORT_WITH_WILDCARDS = 4; // R4, de C1 (André): tema "Meta 100% _ a\b"
const WILDCARD_THEME = "Meta 100% _ a\\b";

test.beforeAll(async () => {
  env = e2eEnv();
  await F.removeAccounts(env);
  F.cleanup(env);
  await F.seed(env);
  const members = (names: string[]) => names.map((n) => lit(F.memberId(F.PEOPLE.find((p) => p.name === n)!))).join(", ");
  sql(
    env,
    `BEGIN; SET LOCAL session_replication_role = replica;
     INSERT INTO public.cell_report_participants (report_id, member_id)
       SELECT ${lit(F.reportId(1))}, m FROM unnest(ARRAY[${members(["André Souza", "Carla Dias", "Beatriz Souza"])}]::uuid[]) m;
     INSERT INTO public.cell_report_participants (report_id, member_id)
       SELECT ${lit(F.reportId(6))}, m FROM unnest(ARRAY[${members(["Gabriel Costa", "Jonas Prado"])}]::uuid[]) m;
     UPDATE public.cell_reports SET theme = ${lit(WILDCARD_THEME)} WHERE id = ${lit(F.reportId(REPORT_WITH_WILDCARDS))};
     COMMIT;`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  await F.removeAccounts(env);
  F.cleanup(env);
});

test.beforeEach(() => F.resetThrottle(env));

const PHONE = { width: 360, height: 800 };
const DESKTOP = { width: 1280, height: 800 };
const total = (page: Page) => page.getByRole("status").filter({ hasText: /^\d[\d.]* relatórios?$/ });
const shortcut = (page: Page, name: string) => page.getByRole("radio", { name: new RegExp(`^${name}, de `) });

function weeks() {
  const [thisStart, thisEnd, lastStart, lastEnd, beforeStart, beforeEnd] = sql(
    env,
    `SELECT w, w + 6, w - 7, w - 1, w - 14, w - 8 FROM (SELECT public.week_start(public.sp_today()) AS w) s`,
  ).split("|");
  return { thisStart: thisStart!, thisEnd: thisEnd!, lastStart: lastStart!, lastEnd: lastEnd!, beforeStart: beforeStart!, beforeEnd: beforeEnd! };
}

async function openReports(page: Page, query = "") {
  await page.goto(`/cell-reports${query}`);
  await expect(total(page)).toBeVisible();
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
}


/**
 * O relógio do aparelho adiantado 5 anos, só para o código do app (`/src/`); as bibliotecas (supabase-js e
 * a sessão) continuam com a hora certa. Quem usar `new Date()` ou `Date.now()` para as semanas erra.
 */
async function skewAppClock(context: BrowserContext) {
  await context.addInitScript(() => {
    const RealDate = Date;
    const skew = 5 * 365 * 86_400_000;
    const fromApp = () => (new Error().stack ?? "").split("\n")[3]?.includes("/src/") ?? false;
    window.Date = new Proxy(RealDate, {
      construct(target, args, newTarget) {
        if (args.length === 0 && fromApp()) return new target(target.now() + skew);
        return Reflect.construct(target, args, newTarget);
      },
      get(target, prop) {
        if (prop === "now") return () => (fromApp() ? target.now() + skew : target.now());
        return Reflect.get(target, prop, target);
      },
    });
  });
}

/** Troca de pessoa na mesma página: sai da sessão guardada e entra de novo. */
async function switchTo(page: Page, person: F.Person) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.evaluate(() => localStorage.clear());
  await F.signIn(page, person);
}

const authIdOf = (person: F.Person) => sql(env, `SELECT auth_user_id FROM public.members WHERE id = ${lit(F.memberId(person))}`);

/** Os ids da lista como a pessoa os recebe pela API: a `cell_reports_view` com a sessão dela, o WHERE escrito à mão. */
function oracle(person: F.Person, where: string): string[] {
  const claims = JSON.stringify({ sub: authIdOf(person), role: "authenticated" });
  const out = sql(
    env,
    `BEGIN;
     SET LOCAL ROLE authenticated;
     SELECT set_config('request.jwt.claims', ${lit(claims)}, true) AS _c \\gset
     SELECT id FROM public.cell_reports_view WHERE ${where} ORDER BY date DESC, time DESC, id;
     COMMIT;`,
  );
  return out.split("\n").filter((line) => /^[0-9a-f]{8}-/.test(line));
}

const listedIds = (page: Page) => page.locator("[data-report-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-report-id") ?? ""));

// ---------------------------------------------------------------------------------------------------
// Paridade da lista pela tela com o banco, por persona (RN-01 a RN-14, RN-16).
// ---------------------------------------------------------------------------------------------------

interface Variant {
  name: string;
  query: (w: ReturnType<typeof weeks>) => string;
  where: (w: ReturnType<typeof weeks>) => string;
}
const idList = (people: F.Person[]) => people.map((p) => lit(F.memberId(p))).join(", ");
const VARIANTS: Variant[] = [
  { name: "sem filtros", query: () => "", where: () => "true" },
  { name: "Esta semana", query: (w) => `&from=${w.thisStart}&to=${w.thisEnd}`, where: (w) => `date BETWEEN '${w.thisStart}' AND '${w.thisEnd}'` },
  { name: "Semana passada", query: (w) => `&from=${w.lastStart}&to=${w.lastEnd}`, where: (w) => `date BETWEEN '${w.lastStart}' AND '${w.lastEnd}'` },
  { name: "Semana retrasada", query: (w) => `&from=${w.beforeStart}&to=${w.beforeEnd}`, where: (w) => `date BETWEEN '${w.beforeStart}' AND '${w.beforeEnd}'` },
  { name: "so De", query: (w) => `&from=${w.lastStart}`, where: (w) => `date >= '${w.lastStart}'` },
  { name: "so Ate", query: (w) => `&to=${w.lastEnd}`, where: (w) => `date <= '${w.lastEnd}'` },
  { name: "Reuniao: Nao houve celula", query: () => "&held=no", where: () => "NOT was_held" },
  { name: "Reuniao: Celula realizada", query: () => "&held=yes", where: () => "was_held" },
  { name: "Tipo Discipulado", query: () => "&type=discipleship", where: () => "snapshot_cell_type = 'Discipulado'" },
  { name: "Tipo Evangelistica e Macrocelula", query: () => "&type=evangelistic,macrocell", where: () => "snapshot_cell_type IN ('Evangelística', 'Macrocélula')" },
  { name: "Lider Andre e Debora", query: () => `&leaders=${F.memberId(F.ANDRE)},${F.memberId(F.DEBORA)}`, where: () => `snapshot_leader_id IN (${idList([F.ANDRE, F.DEBORA])})` },
  { name: "Lider Samuel", query: () => `&leaders=${F.memberId(F.SAMUEL)}`, where: () => `snapshot_leader_id IN (${idList([F.SAMUEL])})` },
  { name: "G12 Pedro", query: () => `&g12=${F.memberId(F.PEDRO)}`, where: () => `snapshot_g12_leader_id IN (${idList([F.PEDRO])})` },
  { name: "G12 Tania e Paula", query: () => `&g12=${F.memberId(F.TANIA)},${F.memberId(F.PAULA)}`, where: () => `snapshot_g12_leader_id IN (${idList([F.TANIA, F.PAULA])})` },
  { name: "Celula C1", query: () => `&cell=${F.cellId(1)}`, where: () => `cell_id = ${lit(F.cellId(1))}` },
  { name: "Celula C3 + Semana retrasada + Discipulado", query: (w) => `&cell=${F.cellId(3)}&from=${w.beforeStart}&to=${w.beforeEnd}&type=discipleship`, where: (w) => `cell_id = ${lit(F.cellId(3))} AND date BETWEEN '${w.beforeStart}' AND '${w.beforeEnd}' AND snapshot_cell_type = 'Discipulado'` },
  { name: "Combinacao RN-12", query: (w) => `&cell=${F.cellId(1)}&leaders=${F.memberId(F.ANDRE)},${F.memberId(F.DEBORA)}&g12=${F.memberId(F.PEDRO)}&from=${w.lastStart}&to=${w.lastEnd}&type=evangelistic,discipleship&held=yes`, where: (w) => `cell_id = ${lit(F.cellId(1))} AND snapshot_leader_id IN (${idList([F.ANDRE, F.DEBORA])}) AND snapshot_g12_leader_id IN (${idList([F.PEDRO])}) AND date BETWEEN '${w.lastStart}' AND '${w.lastEnd}' AND snapshot_cell_type IN ('Evangelística','Discipulado') AND was_held` },
  { name: "busca fe", query: () => "&q=fe", where: () => "search_text LIKE '%fe%'" },
  { name: "datas invertidas (DA-6)", query: (w) => `&from=${w.lastEnd}&to=${w.lastStart}`, where: () => "true" },
];

for (const person of [F.RITA, F.PEDRO, F.LIA, F.DIEGO, F.ESTER]) {
  test(`Paridade: ${person.name} vê pela tela o que o banco entrega com a sessão dela, nos mesmos filtros, na mesma ordem e com o total igual`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(PHONE);
    await F.signIn(page, person);
    const w = weeks();
    for (const variant of VARIANTS) {
      const expected = oracle(person, variant.where(w));
      await openReports(page, `?size=100${variant.query(w)}`);
      const screen = await listedIds(page);
      expect(screen, `${person.name}: ${variant.name}`).toEqual(expected);
      await expect(total(page), `${person.name}: ${variant.name}: total`).toHaveText(`${expected.length} ${expected.length === 1 ? "relatório" : "relatórios"}`);
    }
  });
}

test("Paridade: a lista pela tela é a mesma nas páginas de 10 em 10, sem repetir nem pular (Rita, RN-13)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  const expected = oracle(F.RITA, "true");
  const seen: string[] = [];
  for (let n = 1; n <= Math.ceil(expected.length / 10); n++) {
    await openReports(page, `?size=10&page=${n}`);
    seen.push(...(await listedIds(page)));
  }
  expect(seen).toEqual(expected);
});

// ---------------------------------------------------------------------------------------------------
// Link de Diego: nem nome nem id do líder de C1 (RN-07, UX-11).
// ---------------------------------------------------------------------------------------------------

test("UX-11: Diego com o link do líder de C1 (André), do G12 e da Célula: Pessoa indisponível, sem nome nem id de André, de Pedro e de C1 no DOM ou nas respostas", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.DIEGO);
  const network = F.recordResponses(page);
  const andre = F.memberId(F.ANDRE);
  await openReports(page, `?leaders=${andre}&g12=${F.memberId(F.PEDRO)}`);
  await expect(page.getByRole("button", { name: "Remover filtro Líder: Pessoa indisponível" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover filtro G12: Pessoa indisponível" })).toBeVisible();
  await expect(total(page)).toHaveText("0 relatórios");
  await openReports(page, `?cell=${F.cellId(1)}`);
  await expect(page.getByText("Célula indisponível").first()).toBeVisible();
  await expect(total(page)).toHaveText("0 relatórios");
  await page.waitForLoadState("networkidle");
  const html = await page.locator("body").innerHTML();
  for (const secret of ["André", "Andre", "Pedro", andre, F.memberId(F.PEDRO), F.cellId(1), "A fé que vence"]) {
    expect(html, `DOM: ${secret}`).not.toContain(secret);
    expect(network.bodies.join("\n"), `respostas: ${secret}`).not.toContain(secret);
  }
  expect(network.urls.join("\n")).not.toContain("member_names");
});

test("UX-11: Lia com Líder: Caio (timóteo de C1, sem relatório próprio) vê Pessoa indisponível; com André vê o nome e os relatórios dele", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.LIA);
  await openReports(page, `?leaders=${F.memberId(F.CAIO)}`);
  await expect(page.getByRole("button", { name: "Remover filtro Líder: Pessoa indisponível" })).toBeVisible();
  await expect(total(page)).toHaveText("0 relatórios");
  await openReports(page, `?leaders=${F.memberId(F.ANDRE)}`);
  await expect(page.getByRole("button", { name: "Remover filtro Líder: André Souza" })).toBeVisible();
  expect(await listedIds(page)).toEqual(oracle(F.LIA, `snapshot_leader_id = ${lit(F.memberId(F.ANDRE))}`));
});

// ---------------------------------------------------------------------------------------------------
// Atalhos de semana com o relógio do servidor (RN-10, UX-04, UX-05).
// ---------------------------------------------------------------------------------------------------

/** A resposta da `server_weeks` para "agora" no instante dado (em Brasília). */
function weeksRow(today: string, thisStart: string) {
  const day = (iso: string, plus: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + plus * 86_400_000).toISOString().slice(0, 10);
  return [
    {
      today,
      this_week_start: thisStart,
      this_week_end: day(thisStart, 6),
      last_week_start: day(thisStart, -7),
      last_week_end: day(thisStart, -1),
      week_before_last_start: day(thisStart, -14),
      week_before_last_end: day(thisStart, -8),
    },
  ];
}

test("UX-04: o servidor diz sábado 28/11 23:30 (Brasília) e o aparelho, outro fuso e outro ano: Esta semana grava 22/11 a 28/11; no domingo 29/11 00:00, 29/11 a 05/12", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Europe/Lisbon", viewport: PHONE });
  await skewAppClock(context);
  const page = await context.newPage();
  try {
    await F.signIn(page, F.PEDRO);
    let row = weeksRow("2026-11-28", "2026-11-22");
    await page.route("**/rpc/server_weeks*", (route) => route.fulfill({ json: row }));
    await openReports(page);
    await shortcut(page, "Esta semana").click();
    await expect(page).toHaveURL(/from=2026-11-22&to=2026-11-28/);
    await expect(shortcut(page, "Esta semana")).toHaveAttribute("aria-checked", "true");
    await shortcut(page, "Semana passada").click();
    await expect(page).toHaveURL(/from=2026-11-15&to=2026-11-21/);
    await shortcut(page, "Semana retrasada").click();
    await expect(page).toHaveURL(/from=2026-11-08&to=2026-11-14/);

    // Passa a meia-noite: o servidor responde domingo. O mesmo link passa a ser "Semana passada".
    row = weeksRow("2026-11-29", "2026-11-29");
    await openReports(page, "?from=2026-11-22&to=2026-11-28");
    await expect(shortcut(page, "Semana passada")).toHaveAttribute("aria-checked", "true");
    await expect(shortcut(page, "Esta semana")).toHaveAttribute("aria-checked", "false");
    await shortcut(page, "Esta semana").click();
    await expect(page).toHaveURL(/from=2026-11-29&to=2026-12-05/);
    // Terça 01/12: o link de 22/11 a 28/11 marca a Semana passada.
    row = weeksRow("2026-12-01", "2026-11-29");
    await openReports(page, "?from=2026-11-22&to=2026-11-28");
    await expect(shortcut(page, "Semana passada")).toHaveAttribute("aria-checked", "true");
  } finally {
    await context.close();
  }
});

test("UX-04: com o servidor de verdade e o navegador em Asia/Tokyo e no ano 2031, os três atalhos gravam as semanas do banco", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Asia/Tokyo", viewport: PHONE });
  await skewAppClock(context);
  const page = await context.newPage();
  try {
    await F.signIn(page, F.RITA);
    const w = weeks();
    await openReports(page);
    // Controle: o código do app (`spToday`, de /src/) enxerga o relógio adiantado, as bibliotecas não.
    const appYear = await page.evaluate(async () => {
      const module = await import("/src/lib/dates/sao-paulo.ts");
      return module.spToday().slice(0, 4);
    });
    expect(appYear).toBe(String(new Date().getUTCFullYear() + 5));
    await shortcut(page, "Esta semana").click();
    await expect(page).toHaveURL(new RegExp(`from=${w.thisStart}&to=${w.thisEnd}`));
    await shortcut(page, "Semana passada").click();
    await expect(page).toHaveURL(new RegExp(`from=${w.lastStart}&to=${w.lastEnd}`));
    await shortcut(page, "Semana retrasada").click();
    await expect(page).toHaveURL(new RegExp(`from=${w.beforeStart}&to=${w.beforeEnd}`));
    const expected = oracle(F.RITA, `date BETWEEN '${w.beforeStart}' AND '${w.beforeEnd}'`);
    await expect(total(page)).toHaveText(`${expected.length} relatórios`);
    await expect.poll(() => listedIds(page)).toEqual(expected);
  } finally {
    await context.close();
  }
});

test("UX-05: sem a resposta da server_weeks (atrasada ou com falha) os atalhos ficam desabilitados, nenhum marcado, a lista funciona e nada pula", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  const w = weeks();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/rpc/server_weeks*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/cell-reports?from=${w.lastStart}&to=${w.lastEnd}`);
  await expect(total(page)).toBeVisible();
  for (const name of ["Esta semana", "Semana passada", "Semana retrasada"]) {
    const item = page.getByRole("radio", { name: new RegExp(`^${name}`) });
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute("aria-checked", "false");
  }
  // Relativo ao título: a página entra com uma animação e a posição absoluta oscila nos primeiros 300 ms.
  const offset = async () => (await total(page).boundingBox())!.y - (await page.getByRole("heading", { level: 1 }).boundingBox())!.y;
  const topBefore = await offset();
  release();
  await expect(shortcut(page, "Semana passada")).toBeEnabled();
  await expect(shortcut(page, "Semana passada")).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(600);
  expect(Math.abs((await offset()) - topBefore)).toBeLessThanOrEqual(1);

  // Com a leitura falhando, continuam desabilitados e o relógio do aparelho não serve de reserva.
  await page.unroute("**/rpc/server_weeks*");
  await page.route("**/rpc/server_weeks*", (route) => route.abort("failed"));
  await page.goto(`/cell-reports?from=${w.lastStart}&to=${w.lastEnd}`);
  await expect(total(page)).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Esta semana/ })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /^Semana passada/ })).toBeDisabled();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  expect(await listedIds(page)).toEqual(oracle(F.RITA, `date BETWEEN '${w.lastStart}' AND '${w.lastEnd}'`));
});

// ---------------------------------------------------------------------------------------------------
// Corrida entre respostas.
// ---------------------------------------------------------------------------------------------------

test("Corrida: a resposta atrasada do filtro antigo não sobrescreve a do novo, na lista nem no total", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  const w = weeks();
  await openReports(page, "?size=50");
  await expect(total(page)).toHaveText("8 relatórios");
  // O pedido da Semana passada (R6 e R1) é segurado por 2,5 s; o da Semana retrasada (R2 e R8) passa direto.
  await page.route(/rpc\/cell_reports_list(_count)?(\?|$)/, async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes(w.lastStart)) await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  await shortcut(page, "Semana passada").click();
  await shortcut(page, "Semana retrasada").click();
  await expect(page).toHaveURL(new RegExp(`from=${w.beforeStart}`));
  const expected = oracle(F.RITA, `date BETWEEN '${w.beforeStart}' AND '${w.beforeEnd}'`);
  await expect(total(page)).toHaveText(`${expected.length} relatórios`);
  expect(await listedIds(page)).toEqual(expected);
  await page.waitForTimeout(3500);
  await expect(total(page)).toHaveText(`${expected.length} relatórios`);
  expect(await listedIds(page)).toEqual(expected);
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
});

test("Corrida: a ordem inversa (o filtro novo responde por último) e a troca de página também terminam no estado da URL", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  await openReports(page, "?size=10");
  // Os pedidos do held=yes demoram, os do held=no (R2) não; depois o contrário.
  await page.route(/rpc\/cell_reports_list(_count)?(\?|$)/, async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes('"_held":true')) await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.goto("/cell-reports?size=10&held=yes");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("radio", { name: "Não houve célula" }).click();
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(total(page)).toHaveText("1 relatório");
  await page.waitForTimeout(2500);
  await expect(total(page)).toHaveText("1 relatório");
  expect(await listedIds(page)).toEqual(oracle(F.RITA, "NOT was_held"));
});

// ---------------------------------------------------------------------------------------------------
// Busca com %, _ e \ (RN-14, risco 1).
// ---------------------------------------------------------------------------------------------------

test("RN-14: a busca com %, _ e \\ é texto, sem curinga e sem erro; os mesmos símbolos acham o tema que os tem", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  const cases: Array<[string, number]> = [
    ["%", 1], // o tema "Meta 100% _ a\b"
    ["_", 1],
    ["\\", 1],
    ["100%", 1],
    ["0% _", 1],
    ["_ a\\b", 1],
    ["1%0", 0], // curinga acharia "100"
    ["m_ta", 0], // curinga acharia "meta"
    ["a_b", 0],
    ["a\\\\b", 0],
    ["f%e", 0],
    ["a_fe", 0],
    ["%%", 0],
    ["\\%", 0],
    ["fe\\", 0],
    ["'; DROP TABLE cell_reports; --", 0],
  ];
  for (const [q, expected] of cases) {
    await openReports(page, `?q=${encodeURIComponent(q)}`);
    await expect(total(page), `q=${q}`).toHaveText(`${expected} ${expected === 1 ? "relatório" : "relatórios"}`);
    await expect(page.getByRole("alert"), `q=${q}: sem erro`).toHaveCount(0);
    if (expected === 1) expect(await listedIds(page)).toEqual([F.reportId(REPORT_WITH_WILDCARDS)]);
  }
  // Digitando no campo, com a espera de 300 ms.
  await openReports(page);
  await page.getByLabel("Buscar").fill("100%");
  await expect(total(page)).toHaveText("1 relatório");
  await page.getByLabel("Buscar").fill("1%0");
  await expect(total(page)).toHaveText("0 relatórios");
  expect(sql(env, "SELECT count(*) FROM public.cell_reports")).not.toBe("0");
});

// ---------------------------------------------------------------------------------------------------
// A consulta fora do escopo, excluída e de célula excluída (RN-16, UX-23).
// ---------------------------------------------------------------------------------------------------

test("UX-23: Diego, Ester e Pedro abrem relatório fora do escopo, excluído, de célula excluída e inexistente: o mesmo DOM, nenhum dado nas respostas", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const cases: Array<[F.Person, number[]]> = [
    [F.DIEGO, [1, 2, 6, 3, 5]],
    [F.ESTER, [1, 6, 10, 3]],
    [F.PEDRO, [8, 10, 3]],
  ];
  for (const [person, reports] of cases) {
    await switchTo(page, person);
    const network = F.recordResponses(page);
    const texts: string[] = [];
    for (const id of [...reports.map(F.reportId), F.NOBODY_ID]) {
      await page.goto(`/cell-reports?report=${id}`);
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { level: 2, name: "Relatório não encontrado" }), `${person.name} ${id}`).toBeVisible();
      texts.push(await dialog.innerText());
      await expect(dialog.getByRole("button", { name: /Editar|Excluir/ })).toHaveCount(0);
      await expect(dialog.getByRole("link", { name: /Ver (a )?célula|Ver todos/ })).toHaveCount(0);
    }
    expect(new Set(texts).size, `${person.name}: a mesma resposta nos casos`).toBe(1);
    await page.waitForLoadState("networkidle");
    const everything = network.bodies.join("\n");
    // O que é de relatório que a pessoa não vê não aparece em nenhuma resposta (a lista dela traz só o que ela vê).
    const visible = oracle(person, "true");
    for (const [n, secret] of [[1, "A fé que vence"], [6, "Tema C5"], [3, "Esperança"], [2, "Chuva forte no bairro"]] as const) {
      if (visible.includes(F.reportId(n))) continue;
      expect(everything, `${person.name}: ${secret}`).not.toContain(secret);
    }
    if (!visible.includes(F.reportId(1))) for (const name of ["Carla Dias", "Beatriz Souza"]) expect(everything, `${person.name}: ${name}`).not.toContain(name);
    if (!visible.includes(F.reportId(6))) for (const name of ["Gabriel Costa", "Jonas Prado"]) expect(everything, `${person.name}: ${name}`).not.toContain(name);
  }
});

test("UX-23: Rita e Lia em R3 (excluído) têm o mesmo Relatório não encontrado; Lia em R6 (célula excluída) vê o relatório sem Ver célula, Editar nem Excluir", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  await page.goto(`/cell-reports?report=${F.reportId(3)}`);
  await expect(page.getByRole("dialog").getByRole("heading", { level: 2, name: "Relatório não encontrado" })).toBeVisible();
  await switchTo(page, F.LIA);
  await page.goto(`/cell-reports?report=${F.reportId(3)}`);
  await expect(page.getByRole("dialog").getByRole("heading", { level: 2, name: "Relatório não encontrado" })).toBeVisible();
  await page.goto(`/cell-reports?report=${F.reportId(6)}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { level: 2, name: /^Relatório de / })).toBeVisible();
  await expect(dialog.getByText("Célula excluída").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Editar|Excluir/ })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: /^Ver (a )?célula/ })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: /Ver células excluídas/ })).toHaveCount(0);
});

test("RN-17: a consulta de R1 mostra os participantes pelo nome (Pedro vê 3); Caio, fora do Beatriz/Carla, recebe só os nomes que a view devolve", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.PEDRO);
  await page.goto(`/cell-reports?report=${F.reportId(1)}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Participantes (3)" })).toBeVisible();
  for (const name of ["André Souza", "Beatriz Souza", "Carla Dias"]) await expect(dialog).toContainText(name);
});

// ---------------------------------------------------------------------------------------------------
// Editar pela consulta, lançar, excluir e restaurar com a lista e a consulta atualizadas (UX-24).
// ---------------------------------------------------------------------------------------------------

test("UX-24: Rita edita R9 pela consulta (tema e oferta): a consulta, a lista, o total e, depois de recarregar, o banco mostram os valores novos", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await F.signIn(page, F.RITA);
  const w = weeks();
  await openReports(page, `?from=${w.thisStart}&to=${w.thisEnd}`);
  const open = page.locator(`[data-report-id="${F.reportId(9)}"]`).first();
  await open.click();
  const consult = page.getByRole("dialog", { name: /^Relatório de / });
  await expect(consult).toContainText("Tema C6");
  await consult.getByRole("button", { name: "Editar relatório" }).click();
  const form = page.getByRole("dialog", { name: "Editar relatório" });
  await form.getByLabel("Tema").fill("Tema C6 novo");
  const offering = form.getByLabel("Oferta");
  await offering.fill("");
  await offering.pressSequentially("12345");
  await expect(offering).toHaveValue("123,45");
  await form.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(form).toHaveCount(0);
  await expect(consult).toContainText("Tema C6 novo");
  await expect(consult).toContainText("R$ 123,45");
  await consult.getByRole("button", { name: "Fechar" }).first().click();
  const row = page.getByRole("row").filter({ hasText: "Tema C6 novo" });
  await expect(row).toContainText("123,45");
  await expect(total(page)).toHaveText("2 relatórios");
  expect(sql(env, `SELECT theme || '|' || offering FROM public.cell_reports WHERE id = ${lit(F.reportId(9))}`)).toBe("Tema C6 novo|123.45");
  // Pelo cartão do celular, depois de recarregar, o valor novo.
  await page.setViewportSize(PHONE);
  await page.reload();
  await expect(total(page)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Tema C6 novo" })).toContainText("123,45");
});

test("UX-24: editar pela consulta o que tira o relatório de um filtro (De/Até): a lista tira o relatório e a consulta continua com os valores novos", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await F.signIn(page, F.RITA);
  await openReports(page, "?held=yes&size=50");
  const before = await total(page).innerText();
  expect(before).toBe("7 relatórios");
  await page.locator(`[data-report-id="${F.reportId(5)}"]`).first().click();
  const consult = page.getByRole("dialog", { name: /^Relatório de / });
  await consult.getByRole("button", { name: "Editar relatório" }).click();
  const form = page.getByRole("dialog", { name: "Editar relatório" });
  await form.getByText("Não houve célula", { exact: true }).click();
  await form.getByLabel("Motivo").fill("Viagem do líder");
  await form.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(form).toHaveCount(0);
  await expect(consult).toContainText("Viagem do líder");
  await consult.getByRole("button", { name: "Fechar" }).first().click();
  // held=yes: R5 não é mais "Célula realizada" e sai da lista e do total.
  await expect(total(page)).toHaveText("6 relatórios");
  await expect(page.locator(`[data-report-id="${F.reportId(5)}"]`)).toHaveCount(0);
  sql(env, `BEGIN; SET LOCAL mci.cell_report_write = 'on';
    UPDATE public.cell_reports SET was_held = true, reason_not_held = NULL, theme = 'Oração', offering = 15 WHERE id = ${lit(F.reportId(5))}; COMMIT;`);
});

test("UX-24: Rita lança, exclui e restaura um relatório: a lista (por navegação, sem recarregar) mostra o total certo a cada passo", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  // A reunião de C2 (Diego) já aconteceu esta semana: domingo à 00:00.
  const day = sql(env, "SELECT (ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'])[extract(dow FROM public.sp_today())::int + 1]");
  sql(env, `UPDATE public.cells SET meeting_day = ${lit(day)}, meeting_time = '00:00' WHERE id = ${lit(F.cellId(2))};`);
  await F.signIn(page, F.RITA);
  await openReports(page, "?size=50");
  await expect(total(page)).toHaveText("8 relatórios");

  await page.getByRole("button", { name: "Novo relatório" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  const cellSelect = dialog.getByLabel(/^Célula/).first();
  await cellSelect.click();
  await cellSelect.fill("Diego");
  await page.getByRole("option", { name: /Diego Reis/ }).first().click();
  await dialog.getByLabel("Tema *").fill("Tema lançado pela QA");
  await dialog.getByLabel("Oferta *").fill("0");
  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(total(page)).toHaveText("9 relatórios");
  const created = sql(env, `SELECT id FROM public.cell_reports WHERE cell_id = ${lit(F.cellId(2))} AND deleted_at IS NULL`);
  expect(created).toMatch(/^[0-9a-f-]{36}$/);
  const first = (await listedIds(page))[0];
  expect(first, "o novo tem a data de hoje e vem no topo ou entre os desta semana").toBeTruthy();
  await expect(page.locator(`[data-report-id="${created}"]`)).toHaveCount(1);

  // Excluir pela linha.
  const row = page.getByRole("row").filter({ hasText: "Tema lançado pela QA" });
  await row.getByRole("button", { name: /^Excluir o relatório de .* da célula de Diego Reis$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir relatório" }).click();
  await expect(total(page)).toHaveText("8 relatórios");
  await expect(page.locator(`[data-report-id="${created}"]`)).toHaveCount(0);

  // Restaurar, na lista de excluídos, e voltar pelo menu (sem recarregar).
  await page.getByRole("link", { name: /Ver relatórios excluídos/ }).click();
  await page.getByRole("button", { name: /^Restaurar o relatório de .* da célula de Diego Reis$/ }).first().click();
  await expect(page.getByText(/Relatório restaurado/).first()).toBeVisible();
  await page.getByRole("button", { name: "Relatórios", exact: true }).click();
  await expect(total(page)).toHaveText("9 relatórios");
  await expect(page.locator(`[data-report-id="${created}"]`)).toHaveCount(1);
  // O mesmo para o link da consulta de um relatório que acabou de ser excluído por outra pessoa: o banco decide.
  sql(env, `UPDATE public.cell_reports SET deleted_at = now() WHERE id = ${lit(created)};`);
  await page.goto(`/cell-reports?report=${created}`);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Relatório não encontrado" })).toBeVisible();
  sql(env, `BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM public.cell_report_participants WHERE report_id = ${lit(created)}; DELETE FROM public.cell_reports WHERE id = ${lit(created)}; COMMIT;`);
});

test("DA-11: o voltar do aparelho com o formulário de edição aberto pela consulta fecha só o formulário (com a pergunta, se houver alteração) e a consulta continua", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  await openReports(page, `?cell=${F.cellId(1)}`);
  const open = page.locator(`[data-report-id="${F.reportId(4)}"]`).first();
  await open.click();
  const consult = page.getByRole("dialog", { name: /^Relatório de / });
  await consult.getByRole("button", { name: "Editar relatório" }).click();
  const form = page.getByRole("dialog", { name: "Editar relatório" });
  await expect(form).toBeVisible();
  const theme = form.getByLabel("Tema");
  await theme.fill("Tema digitado antes do voltar");
  await page.goBack();
  // Com alteração: a pergunta; a consulta continua no endereço.
  const discard = page.getByRole("alertdialog", { name: "Descartar as alterações?" });
  await expect(discard).toBeVisible();
  await expect(page).toHaveURL(/report=/);
  await discard.getByRole("button", { name: "Continuar editando" }).click();
  await expect(form.getByLabel("Tema")).toHaveValue("Tema digitado antes do voltar");
  await form.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(form).toHaveCount(0);
  await expect(consult).toContainText("Tema digitado antes do voltar");
  // A entrada da edição saiu ao salvar: o voltar fecha a consulta.
  await page.goBack();
  await expect(page).not.toHaveURL(/report=/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const pointerEvents = await page.evaluate(() => getComputedStyle(document.body).pointerEvents);
  expect(pointerEvents, "o corpo não fica com pointer-events: none").not.toBe("none");
  await expect(page.locator("body[data-scroll-locked]")).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Tema digitado antes do voltar" }).or(page.getByRole("listitem").filter({ hasText: "Tema digitado antes do voltar" }))).toBeVisible();
  // Sem alteração: abre, edita, volta (só o formulário fecha), volta de novo (a consulta fecha).
  await page.locator(`[data-report-id="${F.reportId(4)}"]`).first().click();
  await page.getByRole("dialog", { name: /^Relatório de / }).getByRole("button", { name: "Editar relatório" }).click();
  const second = page.getByRole("dialog", { name: "Editar relatório" });
  await expect(second.getByLabel("Tema")).toBeVisible();
  await page.goBack();
  await expect(second).toHaveCount(0);
  await expect(page).toHaveURL(/report=/);
  await expect(page.getByRole("dialog", { name: /^Relatório de / }).getByRole("button", { name: "Editar relatório" })).toBeFocused();
  await page.goBack();
  await expect(page).not.toHaveURL(/report=/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe("none");
  // A lista segue usável: um clique no cartão abre a consulta de novo.
  await page.locator(`[data-report-id="${F.reportId(4)}"]`).first().click();
  await expect(page.getByRole("dialog", { name: /^Relatório de / })).toBeVisible();
  sql(env, `BEGIN; SET LOCAL mci.cell_report_write = 'on'; UPDATE public.cell_reports SET theme = ${lit(WILDCARD_THEME)} WHERE id = ${lit(F.reportId(4))}; COMMIT;`);
});

// ---------------------------------------------------------------------------------------------------
// Axe nos dois temas, sem regressão nas outras telas.
// ---------------------------------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  test(`UX-29, UX-30: axe na lista, no painel de filtros e na consulta, tema ${scheme} (fora o contraste dos tokens)`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ colorScheme: scheme });
    await F.signIn(page, F.RITA);
    await openReports(page);
    const check = async (label: string) => {
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations.map((v) => `${label}: ${v.id}`)).toEqual([]);
    };
    await check("lista");
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await expect(page.getByRole("dialog", { name: "Filtros" })).toBeVisible();
    await check("filtros");
    await page.keyboard.press("Escape");
    await page.locator(`[data-report-id="${F.reportId(1)}"]`).first().click();
    await expect(page.getByRole("dialog", { name: /^Relatório de / })).toBeVisible();
    await check("consulta");
  });
}

test("Sem regressão: Membros, Células e Auditoria abrem com o total e sem erro para Rita; Células mantém os filtros e o link do detalhe", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await F.signIn(page, F.RITA);
  await page.goto("/members");
  await expect(page.getByRole("status").filter({ hasText: /^\d[\d.]* membros?$/ }).first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/cells");
  await F.waitForCells(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/events");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto(`/cells/${F.cellId(1)}`);
  await expect(page.getByRole("link", { name: /Ver todos os relatórios/ }).first()).toHaveAttribute("href", new RegExp(`/cell-reports\\?.*cell=${F.cellId(1)}`));
});
