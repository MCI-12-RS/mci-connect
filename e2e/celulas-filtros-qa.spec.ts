import { test, expect, type Page, type Route } from "@playwright/test";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// QA independente do E2.10 (PRs 2 a 4): o que os testes do desenvolvedor não cobrem.
// - UX-13: `report_status=pending` com a hora controlada (células montadas em relação a agora) e o
//   oráculo escrito aqui, sem as funções do E2.09;
// - UX-11: as datas pela tela (digitação, saída do campo, "Aplicar filtros", chips);
// - UX-04: o atraso de 300 ms com o relógio do navegador simulado, e a lista em `aria-busy`;
// - corrida entre respostas de filtros;
// - critérios 7 e 8 (Diego em Relatórios, Pedro com G12 Tânia): nada no DOM inteiro nem nas respostas, e
//   a URL limpa com `replace`.

let env: E2EEnv;

const PHONE = { width: 360, height: 800 };
const DESKTOP = { width: 1280, height: 800 };
const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filtros/ });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Filtros" });
const total = (page: Page) => page.getByRole("status").filter({ hasText: /^\d[\d.]* células?$/ }).first();

// As células extras, montadas em relação a "agora" (Brasília). Líderes que nenhuma célula da massa usa.
const EXTRA = {
  overdue: { n: 31, leader: F.TIAGO, timothy: F.CARLA, host: F.TIAGO, minutesAgo: 61 }, // passou 1 h: Pendente
  grace: { n: 32, leader: F.CARLA, timothy: F.TIAGO, host: F.CARLA, minutesAgo: 50 }, // dentro da hora: Ainda não ocorreu
} as const;

const WEEKDAYS_SQL = "(ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'])";

/** `null` quando o instante de referência cairia na semana anterior (domingo logo depois de 00:00). */
function addExtraCells(): boolean {
  const ok = sql(
    env,
    `SELECT public.week_start((public.sp_local(now()) - interval '70 minutes')::date) = public.week_start(public.sp_today())`,
  );
  if (ok !== "t") return false;
  for (const extra of Object.values(EXTRA)) {
    const at = `(public.sp_local(now()) - interval '${extra.minutesAgo} minutes')`;
    sql(
      env,
      `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active)
       VALUES (${lit(F.cellId(extra.n))}, ${lit(F.memberId(extra.leader))}, ${lit(F.memberId(extra.timothy))}, ${lit(F.memberId(extra.host))},
               'Evangelística', ${WEEKDAYS_SQL}[extract(dow FROM ${at})::int + 1], to_char(${at}, 'HH24:MI')::time, true);
       BEGIN; SET LOCAL session_replication_role = replica;
       UPDATE private.cell_active_periods SET periods = '{(,)}' WHERE cell_id = ${lit(F.cellId(extra.n))};
       COMMIT;`,
    );
  }
  return true;
}

/** O oráculo da Pendente, sem as funções do E2.09: ativa, sem relatório não excluído na semana e reunião + 1 h já passou. */
function pendingLeaders(): string[] {
  const out = sql(
    env,
    `SELECT string_agg(m.name, '|' ORDER BY m.name) FROM public.cells c JOIN public.members m ON m.id = c.leader_id
     WHERE c.id::text LIKE '${F.PREFIX}%' AND c.is_active AND c.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.cell_reports r WHERE r.cell_id = c.id AND r.deleted_at IS NULL
                         AND r.date BETWEEN public.week_start(public.sp_today()) AND public.week_start(public.sp_today()) + 6)
       AND public.week_start(public.sp_today())
           + (CASE c.meeting_day WHEN 'Domingo' THEN 0 WHEN 'Segunda' THEN 1 WHEN 'Terça' THEN 2 WHEN 'Quarta' THEN 3
                                 WHEN 'Quinta' THEN 4 WHEN 'Sexta' THEN 5 ELSE 6 END)
           + c.meeting_time + interval '1 hour' <= public.sp_local(now())`,
  );
  return out ? out.split("|") : [];
}

const ALL_LEADERS = new Set([...F.CELLS.map((c) => c.leader.name), F.TIAGO.name, F.CARLA.name]);
async function leaders(page: Page): Promise<string[]> {
  const names = await page.getByRole("main").locator("li p a > span.font-semibold").allTextContents();
  return names.map((n) => n.replace(/\s*\(.*$/, "").replace(/,.*$/, "").trim()).filter((n) => ALL_LEADERS.has(n));
}

let extraCells = false;

test.beforeAll(async () => {
  env = e2eEnv();
  await F.removeAccounts(env);
  F.cleanup(env);
  await F.seed(env);
  extraCells = addExtraCells();
});

test.afterAll(async () => {
  if (!env) return;
  await F.removeAccounts(env);
  F.cleanup(env);
});

test.beforeEach(() => F.resetThrottle(env));

async function openCells(page: Page, query = "") {
  await page.goto(`/cells${query}`);
  await F.waitForCells(page);
}

test.describe("UX-13: Pendente com a hora controlada", () => {
  test("célula de 61 min atrás é Pendente; a de 50 min não (dentro da hora de tolerância); a lista bate com o oráculo", async ({ page }) => {
    test.skip(!extraCells, "domingo logo depois da meia-noite: a referência cairia na semana passada");
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page, "?report_status=pending");
    await expect(page.getByRole("button", { name: "Remover filtro Situação do relatório: Pendente" })).toBeVisible();
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros (1 ativos)");
    const shown = (await leaders(page)).sort();
    const expected = pendingLeaders().sort();
    expect(expected).toContain(F.TIAGO.name);
    expect(expected).not.toContain(F.CARLA.name);
    expect(shown).toEqual(expected);
    // O total é o da lista de Rita (que vê a igreja toda): no mínimo as da massa.
    await expect(total(page)).toHaveText(/^\d+ células?$/);

    // A que está dentro da hora de tolerância aparece em "Ainda não ocorreu", nunca em Pendente.
    await openCells(page, "?report_status=not_yet");
    const notYet = await leaders(page);
    expect(notYet).toContain(F.CARLA.name);
    expect(notYet).not.toContain(F.TIAGO.name);
  });

  test("lançar o relatório tira a célula de Pendente (a situação é a do momento da consulta)", async ({ page }) => {
    test.skip(!extraCells, "domingo logo depois da meia-noite");
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page, "?report_status=pending");
    expect(await leaders(page)).toContain(F.TIAGO.name);
    sql(
      env,
      `BEGIN; SET LOCAL session_replication_role = replica;
       INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, offering)
       VALUES (${lit(F.reportId(31))}, ${lit(F.cellId(EXTRA.overdue.n))}, public.sp_today(), '00:00', true, 'QA', 0);
       COMMIT;`,
    );
    try {
      await openCells(page, "?report_status=pending");
      expect(await leaders(page)).not.toContain(F.TIAGO.name);
      await openCells(page, "?report_status=sent");
      expect(await leaders(page)).toContain(F.TIAGO.name);
    } finally {
      sql(env, `BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM public.cell_reports WHERE id = ${lit(F.reportId(31))}; COMMIT;`);
    }
  });
});

test.describe("UX-11: datas de cadastro pela tela", () => {
  test("painel: sem mensagem durante a digitação; 31/02 dá 'Data inválida' ao sair; invertidas não contam como filtro; chips com dd/mm/aaaa", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.RITA);
    await page.evaluate(() => localStorage.setItem("filters-panel-open:cells", "1"));
    await openCells(page);
    const from = page.getByLabel("Cadastrada a partir de");
    const to = page.getByLabel("Cadastrada até");
    await expect(from).not.toHaveAttribute("max");
    await expect(to).not.toHaveAttribute("max");
    // A dica está ligada aos dois campos.
    const hintA = await from.getAttribute("aria-describedby");
    const hintB = await to.getAttribute("aria-describedby");
    expect(hintA).toBeTruthy();
    expect(hintA).toBe(hintB);

    // Digitando 31/02/2026: nenhuma mensagem enquanto o foco está no campo, e a lista não é refeita.
    await from.click();
    await page.keyboard.type("02312026");
    await expect(page.getByText("Data inválida. Use o formato dd/mm/aaaa.")).toHaveCount(0);
    await to.focus();
    await expect(page.getByText("Data inválida. Use o formato dd/mm/aaaa.")).toBeVisible();
    await expect(from).toHaveAttribute("aria-invalid", "true");
    await expect(page).not.toHaveURL(/from=/);
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros");

    // Corrigir tira a mensagem.
    await from.fill("2026-11-22");
    await expect(page.getByText("Data inválida. Use o formato dd/mm/aaaa.")).toHaveCount(0);
    await to.fill("2026-11-28");
    await F.waitForCells(page);
    await expect(page).toHaveURL(/from=2026-11-22/);
    await expect(page).toHaveURL(/to=2026-11-28/);
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros (1 ativos)");

    // Invertidas: a mensagem aparece, o filtro de data não é aplicado e não conta.
    await from.fill("2026-11-29");
    await expect(page.getByText("A data inicial precisa ser igual ou anterior à data final.")).toBeVisible();
    await expect(to).toHaveAttribute("aria-invalid", "true");
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros");
    await expect(page.getByRole("button", { name: /^Remover filtro Cadastrada/ })).toHaveCount(0);

    // Fechado o painel, com as duas datas boas, os chips dizem dd/mm/aaaa.
    await from.fill("2026-11-22");
    await F.waitForCells(page);
    await filtersButton(page).click();
    await expect(page.getByRole("button", { name: "Remover filtro Cadastrada a partir de 22/11/2026" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remover filtro Cadastrada até 28/11/2026" })).toBeVisible();
  });

  test("Sheet: 'Aplicar filtros' com datas inválidas ou invertidas não aplica, não fecha e leva o foco ao campo", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page);
    await filtersButton(page).click();
    const from = sheet(page).getByLabel("Cadastrada a partir de");
    const to = sheet(page).getByLabel("Cadastrada até");
    await from.fill("2026-11-25");
    await to.fill("2026-11-20");
    await sheet(page).getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByText("A data inicial precisa ser igual ou anterior à data final.")).toBeVisible();
    await expect(page).not.toHaveURL(/from=|to=/);
    await expect(to).toBeFocused();

    // Data impossível digitada: "Aplicar" também recusa, com a mensagem de formato e o foco no campo.
    await to.fill("");
    await from.fill("");
    await from.click();
    await page.keyboard.type("02312026");
    await sheet(page).getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByText("Data inválida. Use o formato dd/mm/aaaa.")).toBeVisible();
    await expect(from).toBeFocused();
    await expect(page).not.toHaveURL(/from=/);

    // As duas boas aplicam, contam como 1 filtro e viram dois chips.
    await from.fill("2026-11-22");
    await to.fill("2026-11-28");
    await sheet(page).getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros (1 ativos)");
    await expect(page.getByRole("button", { name: "Remover filtro Cadastrada a partir de 22/11/2026" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remover filtro Cadastrada até 28/11/2026" })).toBeVisible();
  });
});

test.describe("UX-04: o painel com o relógio do navegador simulado", () => {
  test("a Rua só vale 300 ms depois da última tecla; a lista fica em aria-busy e volta para a página 1", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.RITA);
    await page.evaluate(() => localStorage.setItem("filters-panel-open:cells", "1"));
    await page.clock.install();
    await openCells(page, "?page=2");
    await page.clock.pauseAt(new Date(Date.now() + 10_000));

    // Segura a resposta da lista para ver o estado "carregando".
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let listRequests = 0;
    await page.route(/\/rpc\/cells_list(_count)?(\?|$)/, async (route: Route) => {
      listRequests++;
      await gate;
      await route.continue();
    });

    const street = page.getByLabel("Rua", { exact: true });
    await street.click();
    await page.keyboard.type("flo");
    await page.clock.runFor(299);
    await expect(page).not.toHaveURL(/street=/);
    expect(listRequests).toBe(0);
    // Mais uma tecla zera o prazo.
    await page.keyboard.type("r");
    await page.clock.runFor(299);
    await expect(page).not.toHaveURL(/street=/);
    await page.clock.runFor(1);
    await expect(page).toHaveURL(/street=flor/);
    await expect(page).not.toHaveURL(/page=/);
    await expect.poll(() => listRequests).toBeGreaterThan(0);
    const list = page.locator("tbody[aria-busy='true']");
    await expect(list).toBeVisible();
    await expect(list.locator("tr").first()).toHaveClass(/opacity-60/);
    release();
    // O React Query agenda a notificação por timer: com o relógio parado, ele precisa voltar a andar.
    await page.clock.resume();
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
    // Uma só chamada de página e uma de total para a digitação toda.
    expect(listRequests).toBe(2);
  });

  test("as seleções e as datas do painel valem na hora, sem esperar o prazo", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.RITA);
    await page.evaluate(() => localStorage.setItem("filters-panel-open:cells", "1"));
    await page.clock.install();
    await openCells(page);
    await page.clock.pauseAt(new Date(Date.now() + 10_000));
    await page.getByRole("button", { name: /^Tipo/ }).click();
    await page.getByRole("checkbox", { name: "Macrocélula" }).click();
    await expect(page).toHaveURL(/type=macrocell/);
    await page.keyboard.press("Escape");
    await page.getByLabel("Cadastrada até").fill("2026-11-28");
    await expect(page).toHaveURL(/to=2026-11-28/);
  });

  test("o painel de Células lembra o estado sem mexer no de Membros", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.RITA);
    await page.evaluate(() => {
      localStorage.setItem("filters-panel-open:cells", "1");
      localStorage.removeItem("filters-panel-open:members");
    });
    await page.goto("/members");
    await expect(page.getByRole("button", { name: /^Filtros/ })).toHaveAttribute("aria-expanded", "false");
    await openCells(page);
    await expect(filtersButton(page)).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("corrida entre respostas", () => {
  test("a resposta lenta de um filtro velho não sobrescreve a do filtro novo", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.RITA);
    await page.evaluate(() => localStorage.setItem("filters-panel-open:cells", "1"));
    await openCells(page);
    const bodyOf = (route: Route) => {
      try {
        return (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    let slowServed = false;
    let slowFinished = false;
    await page.route(/\/rpc\/cells_list(_count)?(\?|$)/, async (route) => {
      const types = bodyOf(route)._types;
      if (Array.isArray(types) && types.length === 1 && types[0] === "Discipulado") {
        slowServed = true;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        slowFinished = true;
      }
      await route.continue();
    });
    // A: só Discipulado (lenta). B: tira Discipulado e marca Macrocélula (rápida).
    await page.getByRole("button", { name: /^Tipo/ }).click();
    await page.getByRole("checkbox", { name: "Discipulado" }).click();
    await expect.poll(() => slowServed).toBe(true);
    await page.getByRole("checkbox", { name: "Discipulado" }).click();
    await page.getByRole("checkbox", { name: "Macrocélula" }).click();
    await expect(page).toHaveURL(/type=macrocell$/);
    const expectedMacro = sql(
      env,
      `SELECT string_agg(m.name, '|' ORDER BY m.name) FROM public.cells c JOIN public.members m ON m.id = c.leader_id
       WHERE c.type = 'Macrocélula' AND c.deleted_at IS NULL AND c.id::text LIKE '${F.PREFIX}%'`,
    );
    expect(expectedMacro).toBe(F.SAMUEL.name);
    await expect.poll(() => slowFinished, { timeout: 10_000 }).toBe(true);
    await page.waitForTimeout(500);
    await F.waitForCells(page);
    // Nenhuma célula Discipulado (C3 Débora, C6 Paula) sobrou na tela; a de Macrocélula está.
    const rows = (await page.getByRole("main").getByRole("row").allInnerTexts()).join("\n");
    expect(rows).toContain(F.SAMUEL.name);
    expect(rows).not.toContain(F.DEBORA.name);
    expect(rows).not.toContain(F.PAULA.name);
    const totalMacro = Number(sql(env, `SELECT count(*) FROM public.cells WHERE type = 'Macrocélula' AND deleted_at IS NULL`));
    await expect(total(page)).toHaveText(`${totalMacro} ${totalMacro === 1 ? "célula" : "células"}`);
  });
});

test.describe("critérios 7 e 8: nada de quem a pessoa não vê, no DOM inteiro e nas respostas", () => {
  test("Diego com o link de C1 em Relatórios: nem nome nem id de André em lugar nenhum; 'cell' inválido sai com replace", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.DIEGO);
    const network = F.recordResponses(page);
    await page.goto("/cell-reports");
    await expect(page.getByRole("main")).toBeVisible();
    await page.goto(`/cell-reports?cell=${F.cellId(1)}`);
    await expect(page.getByRole("button", { name: "Remover filtro Célula indisponível" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(network.urls.some((url) => url.includes("cell_identity"))).toBe(true);
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const text = await page.evaluate(() => document.body.innerText);
    const bodies = network.bodies.join("\n");
    for (const haystack of [html, text, bodies]) {
      expect(haystack).not.toContain("André");
      expect(haystack).not.toContain(F.memberId(F.ANDRE));
    }
    // A célula não vaza nem pelo tema nem pelo endereço dela.
    expect(bodies).not.toContain("Rua das Flores");
    expect(bodies).not.toContain("A fé que vence");

    // 'cell' inválido: sai da URL com replace (voltar não passa por ele).
    await page.goto("/cell-reports?size=50");
    await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/cell-reports?cell=xyz&size=50&page=1");
    await expect(page).toHaveURL(/\/cell-reports\?size=50(&page=1)?$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/cell-reports\?size=50$/);
    await expect(page).not.toHaveURL(/xyz/);
  });

  test("Pedro com G12 Tânia: o DOM inteiro (com o Sheet e o seletor abertos) e as respostas não têm Tânia nem o id dela", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    const network = F.recordResponses(page);
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await openCells(page, `?g12=${F.memberId(F.TANIA)}`);
    await filtersButton(page).click();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByText("Pessoa indisponível").first().waitFor();
    // Abre o seletor do G12 para as opções entrarem no DOM.
    const g12 = sheet(page).getByLabel("G12", { exact: true });
    await g12.click();
    await page.waitForLoadState("networkidle");
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const text = await page.evaluate(() => document.body.innerText);
    const bodies = network.bodies.join("\n");
    for (const haystack of [html, text, bodies]) {
      expect(haystack).not.toContain("Tânia");
      expect(haystack).not.toContain("Tania");
      expect(haystack).not.toContain(F.memberId(F.TANIA));
    }
    expect(requested.some((url) => url.includes("member_names"))).toBe(false);
    // Nenhuma chamada lê `members` ou `cells` direto da tabela.
    expect(requested.some((url) => /\/rest\/v1\/(members|cells)(\?|$)/.test(url))).toBe(false);
  });

  test("g12 inválido na URL de Células sai com replace e não cria entrada no histórico", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page);
    await page.goto("/cells?g12=xyz&type=abc&day=sat");
    await expect(page).toHaveURL(/\/cells\?day=sat$/);
    await F.waitForCells(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/cells$/);
  });
});

test.describe("histórico e URL (UX-12, RN-12)", () => {
  test("mudar filtro, chip e 'Limpar filtros' não criam entrada no histórico: voltar sai de Células", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await expect(page).toHaveURL(/\/$/);
    await openCells(page);
    await filtersButton(page).click();
    await sheet(page).getByText("Discipulado", { exact: true }).click();
    await sheet(page).getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(page).toHaveURL(/type=discipleship/);
    await page.getByRole("button", { name: "Remover filtro Tipo: Discipulado" }).click();
    await expect(page).toHaveURL(/\/cells$/);
    await page.goto("/cells?type=evangelistic&q=flores");
    await F.waitForCells(page);
    await page.getByRole("button", { name: "Limpar filtros" }).first().click();
    await expect(page).toHaveURL(/\/cells$/);
    // Uma entrada por `goto` e nenhuma pelos filtros: dois "voltar" saem de Células (primeiro `/cells`, depois o início).
    await page.goBack();
    await expect(page).toHaveURL(/\/cells$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test("'cell' em maiúsculas e repetido em Relatórios: mesmo chip, sem erro", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto(`/cell-reports?cell=${F.cellId(1).toUpperCase()}`);
    await expect(page.getByRole("button", { name: /^Remover filtro Célula/ })).toHaveCount(1);
    await page.goto(`/cell-reports?cell=${F.cellId(1)}&cell=${F.NOBODY_ID}`);
    await expect(page.getByRole("button", { name: /^Remover filtro Célula/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Remover filtro Célula de André Souza · Quarta · 20:00" })).toBeVisible();
  });
});
