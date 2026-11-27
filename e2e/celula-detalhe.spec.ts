import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// O detalhe da célula (E2.10, PR 5; T8 a T14, P80 a P83; RN-14 a RN-20; UX-15 a UX-24, UX-26 a
// UX-29), com a massa do spec: C1 de André com R1, R2, R4 e R5 (R3 excluído), C4 inativa, C5 excluída,
// C6 sem endereço e C8 sem relatório. Os números de R1, R4 e R5 (8 e 2, 6 e 0, 5 e 1) entram aqui.
// As gravações (UX-20) ficam no fim, em série, porque mudam a massa.

let env: E2EEnv;

const PHONE = { width: 360, height: 800 };
const DESKTOP = { width: 1280, height: 800 };
const C1 = F.cellId(1);
/** A célula que o teste de exclusão cria e exclui. */
const EXTRA = F.cellId(9);

/** Os participantes de cada relatório (os primeiros da massa) e os visitantes. */
const NUMBERS: Array<{ report: number; participants: number; visitors: string[] }> = [
  { report: 1, participants: 8, visitors: ["Visitante Um", "Visitante Dois"] },
  { report: 4, participants: 6, visitors: [] },
  { report: 5, participants: 5, visitors: ["Visitante Um"] },
];

function addNumbers() {
  const people = F.PEOPLE.map((person) => F.memberId(person));
  const statements = NUMBERS.flatMap(({ report, participants, visitors }) => [
    `UPDATE public.cell_reports SET visitors = ARRAY[${visitors.map(lit).join(", ")}]::text[] WHERE id = ${lit(F.reportId(report))};`,
    ...people
      .slice(0, participants)
      .map((member) => `INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (${lit(F.reportId(report))}, ${lit(member)});`),
  ]);
  sql(env, `BEGIN; SET LOCAL session_replication_role = replica; ${statements.join("\n")} COMMIT;`);
}

/** "dd/mm/aaaa" do dia `offset` a partir do domingo desta semana (as datas da massa são relativas a ele). */
const dayOf = (offset: number) => sql(env, `SELECT to_char(public.week_start(public.sp_today()) + ${offset}, 'DD/MM/YYYY')`);

test.beforeAll(async () => {
  env = e2eEnv();
  await F.removeAccounts(env);
  F.cleanup(env);
  await F.seed(env);
  addNumbers();
});

test.afterAll(async () => {
  if (!env) return;
  await F.removeAccounts(env);
  F.cleanup(env);
});

test.beforeEach(() => F.resetThrottle(env));

const openDetail = async (page: Page, cell: string) => {
  await page.goto(`/cells/${cell}`);
};
const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const region = (page: Page, name: string) => page.getByRole("region", { name });
/** O complemento do título, como se vê ("Quarta · 20:00 · Evangelística"), sem o que só o leitor de tela ouve. */
const meetingSeen = (page: Page) =>
  page.getByTestId("cell-detail-meeting").evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
    return clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
  });

test.describe("acesso e navegação", () => {
  test("UX-15: em 360 px, tocar no cartão abre o detalhe; o link tem o nome com o nível", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto("/cells");
    await F.waitForCells(page);
    const link = page.getByRole("link", { name: /^Célula de André Souza ?, nível 144$/ });
    await expect(link).toHaveAttribute("href", `/cells/${C1}`);
    // Toca no cartão longe do nome e das ações (sobre o endereço, coberto pelo link esticado).
    const card = page.locator("li", { has: link });
    await card.scrollIntoViewIfNeeded();
    const address = (await card.getByText("Rua das Flores, 100", { exact: false }).boundingBox())!;
    await page.mouse.click(address.x + address.width / 2, address.y + address.height / 2);
    await expect(page).toHaveURL(new RegExp(`/cells/${C1}$`));
    await expect(h1(page)).toHaveText("Célula de André Souza");
    await expect(h1(page)).toBeFocused();
  });

  test("UX-15: em 360 px, as ações do cartão não navegam", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto("/cells");
    await F.waitForCells(page);
    await page.getByRole("button", { name: "Editar a célula de André Souza" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/cells$/);
  });

  test("UX-15: em 1280 px, o nome do líder é o link e a linha também abre", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.PEDRO);
    await page.goto("/cells");
    await F.waitForCells(page);
    const row = page.getByRole("row", { name: /André Souza/ });
    await row.getByText("Rua das Flores, 100").click();
    await expect(page).toHaveURL(new RegExp(`/cells/${C1}$`));
  });

  test("UX-16: recarregar mantém o detalhe; o menu marca Células; /cells/deleted continua; /cells/xyz sem requisição", async ({ page }) => {
    await F.signIn(page, F.RITA);
    await openDetail(page, C1);
    await expect(h1(page)).toHaveText("Célula de André Souza");
    await page.reload();
    await expect(h1(page)).toHaveText("Célula de André Souza");
    await expect(page.getByRole("button", { name: "Células", exact: true })).toHaveAttribute("aria-current", "page");
    await page.goto("/cells/deleted");
    await expect(h1(page)).toHaveText(/excluídas/i);
    const urls: string[] = [];
    page.on("request", (request) => {
      if (/\/rest\/v1\/(cells_view|rpc\/cell_recent_reports)/.test(request.url())) urls.push(request.url());
    });
    await page.goto("/cells/xyz");
    await expect(h1(page)).toHaveText("Célula não encontrada");
    await page.waitForLoadState("networkidle");
    expect(urls).toEqual([]);
  });

  test("UX-17: Voltar para Células devolve a lista com o filtro e o foco na célula; o voltar do navegador também", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto("/cells?type=evangelistic&size=10");
    await F.waitForCells(page);
    const listUrl = page.url();
    await page.getByRole("link", { name: /^Célula de André Souza ?, nível 144$/ }).click();
    await expect(h1(page)).toHaveText("Célula de André Souza");
    await page.getByRole("link", { name: "Voltar para Células" }).click();
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByRole("link", { name: /^Célula de André Souza ?, nível 144$/ })).toBeFocused();
    // O voltar do navegador.
    await page.getByRole("link", { name: /^Célula de André Souza ?, nível 144$/ }).click();
    await expect(h1(page)).toHaveText("Célula de André Souza");
    await page.goBack();
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByRole("link", { name: /^Célula de André Souza ?, nível 144$/ })).toBeFocused();
  });

  test("UX-17: aberto por link, Voltar para Células leva a /cells", async ({ page }) => {
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    await expect(h1(page)).toHaveText("Célula de André Souza");
    await page.getByRole("link", { name: "Voltar para Células" }).click();
    await expect(page).toHaveURL(/\/cells$/);
  });

  test("UX-24: Diego em C1, C5, num id que não existe e em 'xyz' vê o mesmo DOM, sem nada da célula na rede", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.DIEGO);
    const network = F.recordResponses(page);
    const doms: string[] = [];
    for (const target of [C1, F.cellId(5), F.NOBODY_ID, "xyz"]) {
      await openDetail(page, target);
      await expect(h1(page)).toHaveText("Célula não encontrada");
      await expect(page.getByText("Ela não existe, foi excluída ou não está disponível para você.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Voltar para Células" }).or(page.getByRole("link", { name: "Voltar para Células" }))).toBeVisible();
      await page.waitForLoadState("networkidle");
      doms.push(await page.getByRole("main").innerHTML());
    }
    expect(new Set(doms).size).toBe(1);
    const bodies = network.bodies.join("\n");
    for (const forbidden of ["André Souza", "Rua das Flores", "Jonas Prado", F.memberId(F.ANDRE)]) {
      expect(bodies).not.toContain(forbidden);
      expect(doms[0]).not.toContain(forbidden);
    }
  });

  test("UX-24: Lia (só relatórios) em C1: não encontrada, com Ir para o início", async ({ page }) => {
    await F.signIn(page, F.LIA);
    const network = F.recordResponses(page);
    await openDetail(page, C1);
    await expect(h1(page)).toHaveText("Célula não encontrada");
    await expect(page.getByRole("link", { name: "Ir para o início" })).toHaveAttribute("href", "/");
    await page.waitForLoadState("networkidle");
    expect(network.bodies.join("\n")).not.toContain("Rua das Flores");
  });
});

test.describe("conteúdo", () => {
  test("UX-18: Rita em C1 vê título, complemento, situação, pessoas, endereço, situação do relatório e autoria", async ({ page }) => {
    await F.signIn(page, F.RITA);
    await openDetail(page, C1);
    await expect(h1(page)).toHaveText("Célula de André Souza");
    expect(await meetingSeen(page)).toBe("Quarta · 20:00 · Evangelística");
    await expect(page.getByRole("main").getByText("Ativa", { exact: true })).toBeVisible();
    const people = region(page, "Pessoas da célula");
    await expect(people.getByRole("definition")).toHaveText(["André Souza (144), nível 144", "Caio Lima", "Carla Dias", "Pedro Alves"]);
    await expect(people.getByRole("link")).toHaveCount(0);
    await expect(region(page, "Endereço da célula")).toContainText("CEP 90010-000");
    await expect(region(page, "Situação do relatório")).toBeVisible();
    await expect(page.getByTestId("record-authorship")).toBeVisible();
  });

  test("UX-18: Pedro em C4 vê a pessoa inativa, o badge Inativa e a frase sem situação do relatório", async ({ page }) => {
    await F.signIn(page, F.PEDRO);
    await openDetail(page, F.cellId(4));
    await expect(h1(page)).toHaveText("Célula de Gabriel Costa");
    const people = region(page, "Pessoas da célula");
    await expect(people.getByRole("definition").nth(0)).toHaveText("Gabriel Costa (20.736), nível 20.736");
    await expect(people.getByRole("definition").nth(1)).toHaveText("Jonas Prado");
    await expect(people.getByRole("definition").nth(2)).toHaveText("Fábio Lima (inativo)");
    await expect(page.getByRole("main").getByText("Inativa", { exact: true })).toBeVisible();
    await expect(region(page, "Situação do relatório")).toContainText("Célula inativa: sem situação do relatório.");
  });

  test("UX-18: Diego em C7 vê o pastor e o G12 Pastores", async ({ page }) => {
    await F.signIn(page, F.DIEGO);
    await openDetail(page, F.cellId(7));
    const people = region(page, "Pessoas da célula");
    await expect(people.getByRole("definition").nth(0)).toHaveText(/^Samuel Colares \(Pastor\)/);
    await expect(people.getByRole("definition").nth(3)).toHaveText("Pastores");
  });

  test("UX-18: Ester em C8 vê Sem liderança e o G12 '—'", async ({ page }) => {
    await F.signIn(page, F.ESTER);
    await openDetail(page, F.cellId(8));
    const people = region(page, "Pessoas da célula");
    await expect(people.getByRole("definition").nth(0)).toHaveText(/^Ester Ramos \(Sem liderança\)/);
    await expect(people.getByRole("definition").nth(3)).toHaveText("—nenhum");
  });

  test("UX-18: Rita em C6 vê Sem endereço", async ({ page }) => {
    await F.signIn(page, F.RITA);
    await openDetail(page, F.cellId(6));
    await expect(region(page, "Endereço da célula")).toContainText("Sem endereço");
  });

  test("UX-21: Pedro em C1 (360 px): R1, R2 e R4 em cartões, com as setas e os textos do Negócio", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    const reports = region(page, "Últimos relatórios");
    await expect(reports.getByRole("heading", { level: 3 })).toHaveText([
      `Quarta, ${dayOf(-4)} às 20:00`,
      `Quarta, ${dayOf(-11)} às 20:00`,
      `Quarta, ${dayOf(-25)} às 20:00`,
    ]);
    await expect(reports.getByText("As setas comparam com o relatório anterior de célula realizada.")).toBeVisible();
    const [r1, r2, r4] = await reports.getByRole("article").all();
    await expect(r1).toContainText("Tema: A fé que vence");
    await expect(r1).toContainText("8, mais que no relatório anterior");
    await expect(r1).toContainText("2, mais que no relatório anterior");
    await expect(r1).toContainText("R$ 50,00");
    await expect(r2).toContainText("Motivo: Chuva forte no bairro");
    await expect(r2).not.toContainText("Participantes");
    await expect(r4).toContainText("Tema: Perdão");
    await expect(r4).toContainText("6, mais que no relatório anterior");
    await expect(r4).toContainText("0, menos que no relatório anterior");
    await expect(r4).toContainText("R$ 20,00");
    await expect(reports).not.toContainText("Esperança");
    await expect(page.getByRole("main")).not.toContainText("Visitante Um");
    // UX-26: as ações de cada relatório têm 44×44 px.
    const edit = r1.getByRole("button", { name: /^Editar o relatório de/ });
    const box = (await edit.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test("UX-21: em 1280 px, a tabela com os números à direita", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    const table = region(page, "Últimos relatórios").getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(4);
    await expect(table.getByRole("row").nth(2)).toContainText("não se aplica");
  });

  test("UX-22: Ver todos os relatórios abre Relatórios com o filtro Célula", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    const all = page.getByRole("link", { name: "Ver todos os relatórios da célula de André Souza" });
    expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await all.click();
    await expect(page).toHaveURL(new RegExp(`/cell-reports\\?cell=${C1}$`));
    await expect(page.getByRole("button", { name: "Remover filtro Célula de André Souza · Quarta · 20:00" })).toBeVisible();
  });

  test("UX-22: Ester em C8: Nenhum relatório para mostrar., sem Ver todos e sem Evolução", async ({ page }) => {
    await F.signIn(page, F.ESTER);
    await openDetail(page, F.cellId(8));
    await expect(region(page, "Últimos relatórios")).toContainText("Nenhum relatório para mostrar.");
    await expect(page.getByRole("link", { name: /Ver todos os relatórios/ })).toHaveCount(0);
    await expect(region(page, "Evolução")).toHaveCount(0);
  });

  test("UX-23: a evolução de C1 em ordem cronológica, com Não houve célula, na tabela e no gráfico", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    const evolution = region(page, "Evolução");
    const figure = evolution.locator("figure[role=img]");
    await expect(figure).toHaveAttribute(
      "aria-label",
      `Gráfico de linhas com participantes e visitantes de 4 relatórios, de ${dayOf(-32)} a ${dayOf(-4)}. Os números estão na aba Tabela.`,
    );
    await expect(evolution.locator(".recharts-surface")).toBeVisible();
    await expect(evolution.getByText("Não houve célula")).toBeVisible();
    await evolution.getByRole("tab", { name: "Tabela" }).click();
    await expect(evolution.getByRole("table").getByRole("row")).toHaveText([
      /Data\s*Participantes\s*Visitantes/,
      new RegExp(`${dayOf(-32)}\\s*5\\s*1`),
      new RegExp(`${dayOf(-25)}\\s*6\\s*0`),
      new RegExp(`${dayOf(-11)}\\s*Não houve célula`),
      new RegExp(`${dayOf(-4)}\\s*8\\s*2`),
    ]);
  });
});

test.describe("ações e acessibilidade", () => {
  test("UX-19: Pedro em 360 px vê o rodapé fixo e Editar célula com o ⋯; em 1280 px, as três no cabeçalho", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    const footer = page.getByTestId("cell-detail-footer");
    const newReport = footer.getByRole("button", { name: "Novo relatório" });
    await expect(newReport).toBeVisible();
    expect((await newReport.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("button", { name: "Editar célula" })).toBeVisible();
    await page.getByRole("button", { name: "Ações da célula de André Souza" }).click();
    await expect(page.getByRole("menuitem", { name: "Excluir célula" })).toBeVisible();
    await page.keyboard.press("Escape");
    // O rodapé fica à vista no fim da rolagem, sem cobrir o fim do conteúdo.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(newReport).toBeInViewport();
    // Uma ação de cada vez para o leitor de tela.
    await expect(page.getByRole("button", { name: "Novo relatório" })).toHaveCount(1);

    await page.setViewportSize(DESKTOP);
    await expect(footer).toBeHidden();
    const header = page.getByRole("main").locator("div.md\\:flex").first();
    await expect(header.getByRole("button")).toHaveText(["Novo relatório", "Editar célula", "Excluir célula"]);
    await expect(page.getByRole("button", { name: "Ações da célula de André Souza" })).toBeHidden();
  });

  test("UX-19: em C4 (inativa) não há Novo relatório nem rodapé", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openDetail(page, F.cellId(4));
    await expect(h1(page)).toHaveText("Célula de Gabriel Costa");
    await expect(page.getByTestId("cell-detail-footer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo relatório" })).toHaveCount(0);
  });

  test("UX-26, UX-27: em 320 px nada rola na horizontal; toques de 44 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    await expect(region(page, "Evolução")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const name of ["Voltar para Células", "Editar célula", "Ações da célula de André Souza"]) {
      const target = page.getByRole("link", { name }).or(page.getByRole("button", { name }));
      expect((await target.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("UX-28, UX-29: axe no detalhe, nos temas claro e escuro (fora o contraste dos tokens)", async ({ page }) => {
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    await expect(region(page, "Evolução").locator(".recharts-surface")).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
      // O contraste dos tokens globais é um problema conhecido (CLAUDE.md, "Problemas conhecidos").
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    }
  });
});

test.describe("depois de gravar (UX-20); cada teste devolve a massa como estava", () => {
  test("Pedro muda o horário de C1 para 20:30: o complemento muda sem recarregar, e o foco volta a Editar célula", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    const edit = page.getByRole("button", { name: "Editar célula" });
    try {
      await edit.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Horário *", { exact: true }).fill("2030");
      await dialog.getByRole("button", { name: "Salvar alterações" }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => meetingSeen(page)).toBe("Quarta · 20:30 · Evangelística");
      await expect(edit).toBeFocused();
    } finally {
      sql(env, `UPDATE public.cells SET meeting_time = '20:00' WHERE id = ${lit(C1)};`);
    }
  });

  test("Pedro exclui R1: os últimos passam a R2, R4 e R5, com o foco em Últimos relatórios", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openDetail(page, C1);
    const reports = region(page, "Últimos relatórios");
    try {
      await reports.getByRole("button", { name: `Ações do relatório de ${dayOf(-4)} da célula de André Souza` }).click();
      await page.getByRole("menuitem", { name: "Excluir relatório" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Excluir relatório" }).click();
      await expect(reports.getByRole("heading", { level: 3 })).toHaveText([
        `Quarta, ${dayOf(-11)} às 20:00`,
        `Quarta, ${dayOf(-25)} às 20:00`,
        `Quarta, ${dayOf(-32)} às 20:00`,
      ]);
      await expect(page.getByRole("heading", { level: 2, name: "Últimos relatórios" })).toBeFocused();
    } finally {
      sql(
        env,
        `BEGIN; SET LOCAL session_replication_role = replica;
         UPDATE public.cell_reports SET deleted_at = NULL, deleted_by = NULL, deleted_by_kind = NULL, deleted_by_legacy = NULL WHERE id = ${lit(F.reportId(1))}; COMMIT;`,
      );
    }
  });

  test("Pedro exclui uma célula pelo detalhe: volta à lista sem ela, com o foco no título Células", async ({ page }) => {
    // Uma célula só deste teste (a massa das outras fica igual): Caio lidera, no ministério de Pedro.
    sql(
      env,
      `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
       VALUES (${lit(EXTRA)}, ${lit(F.memberId(F.CAIO))}, ${lit(F.memberId(F.ANDRE))}, ${lit(F.memberId(F.CARLA))}, 'Discipulado', 'Terça', '20:00');`,
    );
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto("/cells");
    await F.waitForCells(page);
    await page.getByRole("link", { name: /^Célula de Caio Lima/ }).click();
    await expect(h1(page)).toHaveText("Célula de Caio Lima");
    // A lista nunca mostra a célula excluída: nenhuma resposta da lista depois da exclusão a traz.
    const listBodies: string[] = [];
    let deleted = false;
    page.on("response", (response) => {
      if (deleted && /rpc\/cells_list(\?|$)/.test(response.url())) void response.text().then((body) => listBodies.push(body));
    });
    await page.getByRole("button", { name: "Ações da célula de Caio Lima" }).click();
    await page.getByRole("menuitem", { name: "Excluir célula" }).click();
    deleted = true;
    await page.getByRole("alertdialog").getByRole("button", { name: "Excluir célula" }).click();
    await expect(page).toHaveURL(/\/cells$/);
    await F.waitForCells(page);
    await expect(page.getByRole("link", { name: /^Célula de Caio Lima/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Células" })).toBeFocused();
    await expect(page.getByText("Célula excluída.").first()).toBeVisible();
    expect(listBodies.join("\n")).not.toContain(EXTRA);
  });
});
