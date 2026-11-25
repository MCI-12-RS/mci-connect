import { test, expect, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as H from "./hierarquia-support";

// Árvore de Ministérios (E2.06, PR 2, T11): UX-09, UX-10, UX-17 e os critérios da RN-09 com Rita, Pedro
// e Diego, e o axe (UX-20), com a massa do spec. Rita (Administrador) vê tudo.

let env: E2EEnv;

test.beforeAll(async () => {
  env = e2eEnv();
  await H.removeAccounts(env);
  H.cleanup(env);
  await H.seed(env);
});

test.afterAll(async () => {
  if (!env) return;
  await H.removeAccounts(env);
  H.cleanup(env);
});

test.beforeEach(() => H.resetThrottle(env));

const HIGHLIGHT = /(^|\s)ring-2(\s|$)/;
const SAMUEL_MAGDA = "Samuel Colares e Magda Colares";
const PEDRO_PAULA = "Pedro Alves e Paula Alves";
const TIAGO_TANIA = "Tiago Rocha e Tânia Rocha";
const DIEGO_OLGA = "Diego Reis e Olga Reis";

const nameOf = (page: Page, start: string) => H.treeNode(page, start).first().getAttribute("aria-label");

async function openTree(page: Page, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto("/ministries");
  await expect(page.getByRole("heading", { name: "Ministérios" })).toBeVisible();
  await expect(H.treeNode(page, SAMUEL_MAGDA)).toBeVisible();
}

test.describe("UX-09: a árvore de Rita", () => {
  test("Os nós mostram o nome do casal, o nível da posição e os totais da massa", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openTree(page);
    expect(await nameOf(page, SAMUEL_MAGDA)).toBe("Samuel Colares e Magda Colares, Pastores, 18 discípulos, 8 células");
    await H.expandNode(page, SAMUEL_MAGDA);
    expect(await nameOf(page, PEDRO_PAULA)).toBe("Pedro Alves e Paula Alves, G12, 4 discípulos, 4 células");
    expect(await nameOf(page, TIAGO_TANIA)).toBe("Tiago Rocha e Tânia Rocha, G12, 10 discípulos, 4 células");

    // André e Beatriz (ramos diferentes): sob Pedro e Paula e sob Tiago e Tânia, com os mesmos totais.
    await H.expandNode(page, PEDRO_PAULA);
    await H.expandNode(page, TIAGO_TANIA);
    const andre = H.treeNode(page, "André Souza e Beatriz Souza");
    await expect(andre).toHaveCount(2);
    for (const i of [0, 1]) {
      await expect(andre.nth(i)).toHaveAttribute("aria-label", "André Souza e Beatriz Souza, 144, 3 discípulos, 4 células");
    }
    expect(await nameOf(page, DIEGO_OLGA)).toBe("Diego Reis e Olga Reis, 144, 2 discípulos, 3 células");
    expect(await nameOf(page, "Hugo Prado e Vânia Prado")).toBe("Hugo Prado e Vânia Prado, 144, 1 discípulo, 0 células");
    // O texto visível, com o "·" entre os totais.
    await expect(H.treeNode(page, SAMUEL_MAGDA)).toContainText("18 discípulos");
    await expect(H.treeNode(page, SAMUEL_MAGDA)).toContainText("8 células");
    // Só o texto de ajuda fala em "discípulos diretos" (o que aparece ao abrir); os totais, nunca.
    const text = (await page.locator("main").innerText()).replace(/Toque ou clique num nome[^\n]*/, "");
    expect(text).not.toMatch(/disc\.|cél\.|discípulos diretos/);
  });

  test("A folha Rita, sob Tiago e Tânia, mostra '0 discípulos · 0 células'; Ester e Lúcia não estão na árvore", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openTree(page);
    await H.expandNode(page, SAMUEL_MAGDA);
    await H.expandNode(page, TIAGO_TANIA);
    const rita = page.locator("li", { has: page.getByText(H.RITA.name, { exact: true }) }).last();
    await expect(rita).toContainText("0 discípulos");
    await expect(rita).toContainText("0 células");
    await expect(rita.getByRole("button")).toHaveCount(0);
    await expect(page.getByText(H.ESTER.name)).toHaveCount(0);
    await expect(page.getByText(H.LUCIA.name)).toHaveCount(0);
  });

  test("O texto de ajuda avisa sobre os inativos; André e Beatriz abrem só Caio e Débora (Gabriel está sob Fábio, inativo)", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openTree(page);
    await expect(page.getByText(/Os totais somam todos os níveis abaixo de cada nome, inclusive os discípulos de pessoas inativas/)).toBeVisible();
    await H.expandNode(page, SAMUEL_MAGDA);
    await H.expandNode(page, PEDRO_PAULA);
    await H.expandNode(page, "André Souza e Beatriz Souza");
    const level = page.locator("li", { has: H.treeNode(page, "André Souza e Beatriz Souza") }).first();
    await expect(level.getByText(H.CAIO.name, { exact: true })).toBeVisible();
    await expect(level.getByText(H.DEBORA.name, { exact: true })).toBeVisible();
    await expect(page.getByText(H.GABRIEL.name)).toHaveCount(0);
    await expect(page.getByText(H.FABIO.name)).toHaveCount(0);
  });

  test("Com Magda inativa, a raiz é 'Samuel Colares', 'Pastor'", async ({ page }) => {
    sql(env, `UPDATE public.members SET is_active = false WHERE id = ${lit(H.memberId(H.MAGDA))};`);
    try {
      await H.signIn(page, H.RITA);
      await page.goto("/ministries");
      const root = H.treeNode(page, "Samuel Colares, ");
      await expect(root).toBeVisible();
      await expect(root).toHaveAttribute("aria-label", /^Samuel Colares, Pastor, \d+ discípulos?, \d+ células?$/);
      await expect(H.treeNode(page, SAMUEL_MAGDA)).toHaveCount(0);
    } finally {
      sql(env, `UPDATE public.members SET is_active = true WHERE id = ${lit(H.memberId(H.MAGDA))};`);
    }
  });

  test("Com Beatriz inativa, o nó é só André, com 2 discípulos e 3 células", async ({ page }) => {
    sql(env, `UPDATE public.members SET is_active = false WHERE id = ${lit(H.memberId(H.BEATRIZ))};`);
    try {
      await H.signIn(page, H.RITA);
      await openTree(page);
      await H.expandNode(page, SAMUEL_MAGDA);
      await H.expandNode(page, PEDRO_PAULA);
      await expect(H.treeNode(page, "André Souza, ")).toHaveAttribute("aria-label", "André Souza, 144, 2 discípulos, 3 células");
      await expect(page.getByText(H.BEATRIZ.name)).toHaveCount(0);
    } finally {
      sql(env, `UPDATE public.members SET is_active = true WHERE id = ${lit(H.memberId(H.BEATRIZ))};`);
    }
  });
});

test.describe("RN-09: a árvore de quem não vê o casal inteiro", () => {
  test("Pedro não vê Beatriz: o nó é só 'André Souza', com 2 discípulos e 3 células", async ({ browser }) => {
    const pedro = await H.sessionOf(browser, H.PEDRO, { width: 1280, height: 800 });
    try {
      await pedro.page.goto("/ministries");
      await H.expandNode(pedro.page, "Pedro Alves");
      await expect(H.treeNode(pedro.page, "André Souza, ")).toHaveAttribute("aria-label", "André Souza, 144, 2 discípulos, 3 células");
      await expect(pedro.page.getByText(H.BEATRIZ.name)).toHaveCount(0);
    } finally {
      await pedro.close();
    }
  });

  test("Diego vê Beatriz e não vê André: o nó é só 'Beatriz Souza', com 1 discípulo e 1 célula", async ({ browser }) => {
    const diego = await H.sessionOf(browser, H.DIEGO, { width: 1280, height: 800 });
    try {
      await diego.page.goto("/ministries");
      await H.expandNode(diego.page, "Tiago Rocha");
      await expect(H.treeNode(diego.page, "Beatriz Souza, ")).toHaveAttribute("aria-label", "Beatriz Souza, 144, 1 discípulo, 1 célula");
      await expect(diego.page.getByText(H.ANDRE.name)).toHaveCount(0);
    } finally {
      await diego.close();
    }
  });

  test("Quem não vê a igreja toda e está sem liderança tem a raiz 'Sem liderança', e não 'Nível null'", async ({ browser }) => {
    const ester = await H.sessionOf(browser, H.ESTER, { width: 1280, height: 800 });
    try {
      await ester.page.goto("/ministries");
      await expect(H.treeNode(ester.page, "Ester Ramos")).toBeVisible();
      await expect(H.treeNode(ester.page, "Ester Ramos")).toHaveAttribute("aria-label", "Ester Ramos, Sem liderança, 1 discípulo, 1 célula");
      await expect(ester.page.locator("body")).not.toContainText(/null|undefined|NaN/);
    } finally {
      await ester.close();
    }
  });
});

test.describe("UX-10: o cônjuge abaixo do outro aparece como referência", () => {
  async function openToLauro(page: Page) {
    await openTree(page);
    await H.expandNode(page, SAMUEL_MAGDA);
    await H.expandNode(page, TIAGO_TANIA);
    await H.expandNode(page, DIEGO_OLGA);
    await expect(H.treeNode(page, "Lauro Mendes")).toBeVisible();
    await expect(page.getByText(H.SONIA.name, { exact: true })).toBeVisible();
    await H.expandNode(page, "Lauro Mendes");
  }
  const reference = (page: Page) => page.locator("li", { hasText: "Aparece com o cônjuge, Diego Reis, mais acima." }).last();

  test("Abrir Diego e Olga mostra Lauro e Sônia ('Nível 5'); abrir Lauro mostra Olga como referência, e o casal não se repete", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openToLauro(page);
    await expect(page.getByText("Nível 5", { exact: true })).toBeVisible();
    const ref = reference(page);
    await expect(ref).toContainText(H.OLGA.name);
    await expect(ref).toContainText("20.736");
    await expect(ref).not.toContainText(/discípulo|célula/);
    // Só o "Ir para o casal" é botão: a referência não abre, e não tem seta de aria-expanded.
    await expect(ref.getByRole("button")).toHaveCount(1);
    await expect(ref.getByRole("button", { name: /Ir para Diego Reis e Olga Reis/ })).toHaveText("Ir para o casal");
    await expect(ref.locator("[aria-expanded]")).toHaveCount(0);
    // Nenhum nó "Diego e Olga" sob Lauro: um só em toda a árvore.
    await expect(H.treeNode(page, DIEGO_OLGA)).toHaveCount(1);
    // Lauro continua com 2 / 2 e Sônia é um discípulo do casal.
    expect(await nameOf(page, "Lauro Mendes")).toMatch(/^Lauro Mendes, .*, 2 discípulos, 2 células$/);
  });

  test("'Ir para o casal' rola até o nó, põe o foco nele e o destaca, sem abrir nem fechar nenhum nó", async ({ page }) => {
    await H.signIn(page, H.RITA);
    // Tela baixa: o nó do casal sai da vista, para a rolagem acontecer de verdade.
    await page.setViewportSize({ width: 1280, height: 420 });
    await openToLauro(page);
    const expandedBefore = await page.locator("[aria-expanded]").evaluateAll((els) => els.map((el) => `${el.getAttribute("aria-label")}=${el.getAttribute("aria-expanded")}`));
    const couple = H.treeNode(page, DIEGO_OLGA);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await reference(page).getByRole("button", { name: /Ir para Diego Reis e Olga Reis/ }).click();

    await expect(couple).toBeFocused();
    await expect(couple).toHaveClass(HIGHLIGHT);
    await expect(couple).toBeInViewport();
    const expandedAfter = await page.locator("[aria-expanded]").evaluateAll((els) => els.map((el) => `${el.getAttribute("aria-label")}=${el.getAttribute("aria-expanded")}`));
    expect(expandedAfter, "nenhum nó abriu nem fechou").toEqual(expandedBefore);
    await expect(reference(page)).toBeVisible();
    // O destaque some em 2 s.
    await expect(couple).not.toHaveClass(HIGHLIGHT, { timeout: 4000 });
  });

  test("Abrir Hugo e Vânia mostra Zélia, e Vânia não aparece como referência", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openTree(page);
    await H.expandNode(page, SAMUEL_MAGDA);
    await H.expandNode(page, TIAGO_TANIA);
    await H.expandNode(page, "Hugo Prado e Vânia Prado");
    await expect(page.getByText(H.ZELIA.name, { exact: true })).toBeVisible();
    await expect(page.getByText(/Aparece com o cônjuge, Hugo Prado/)).toHaveCount(0);
    await expect(page.getByText(H.VANIA.name)).toHaveCount(1); // só no nome do casal
  });
});

test.describe("UX-17 e UX-06: o celular e a tela estreita", () => {
  test("A 360×800, 'Ir para o casal' e o botão de cada nó têm ao menos 44 px de altura", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openTree(page, 360, 800);
    await H.expandNode(page, SAMUEL_MAGDA);
    await H.expandNode(page, TIAGO_TANIA);
    await H.expandNode(page, DIEGO_OLGA);
    await H.expandNode(page, "Lauro Mendes");
    const heights = await page.locator("main li button").evaluateAll((els) =>
      els.map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent ?? "", height: el.getBoundingClientRect().height })),
    );
    expect(heights.length).toBeGreaterThan(5);
    expect(heights.some((h) => h.name === "Ir para o casal" || /^Ir para /.test(h.name))).toBe(true);
    for (const h of heights) expect(h.height, `altura de "${h.name}"`).toBeGreaterThanOrEqual(43.5);
  });

  for (const [label, viewport, scale] of [
    ["320×640", { width: 320, height: 640 }, 1],
    ["zoom de 200% (640 px de largura em CSS, escala 2)", { width: 640, height: 400 }, 2],
  ] as const) {
    test(`Os nós até o 'Nível 5' a ${label} quebram linha, sem rolagem horizontal e sem cortar nome, rótulo nem total`, async ({ browser }) => {
      const context = await browser.newContext({ baseURL: E2E_BASE_URL, viewport, deviceScaleFactor: scale });
      const page = await context.newPage();
      try {
        await H.signIn(page, H.RITA);
        await openTree(page, viewport.width, viewport.height);
        await H.expandNode(page, SAMUEL_MAGDA);
        await H.expandNode(page, TIAGO_TANIA);
        await H.expandNode(page, DIEGO_OLGA);
        await H.expandNode(page, "Lauro Mendes");
        await expect(page.getByText("Nível 5", { exact: true })).toBeVisible();
        await H.expectNoPageHScroll(page, `Ministérios ${label}`);
        const beyond = await page.evaluate(() =>
          Array.from(document.querySelectorAll("main *"))
            .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5 && getComputedStyle(el).position !== "fixed")
            .map((el) => `${el.tagName}.${String(el.getAttribute("class")).slice(0, 60)}`)
            .slice(0, 5),
        );
        expect(beyond, "elementos além da borda").toEqual([]);
        const clipped = await page.evaluate(() =>
          Array.from(document.querySelectorAll("main li span"))
            .filter((el) => !el.closest(".sr-only") && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible")
            .map((el) => el.textContent?.slice(0, 40)),
        );
        expect(clipped, "texto cortado").toEqual([]);
        const broken = await page.locator("span.whitespace-nowrap").evaluateAll((els) =>
          els.filter((el) => /discípulo|célula/.test(el.textContent ?? "")).filter((el) => el.getClientRects().length > 1).length,
        );
        expect(broken, "totais partidos").toBe(0);
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("UX-20: axe na árvore, nos dois temas", () => {
  test("Ministérios a 360 e 1280 px, claro e escuro, com os nós abertos e a referência", async ({ page }) => {
    await H.signIn(page, H.RITA);
    const summaries: H.AxeSummary[] = [];
    for (const width of [360, 1280]) {
      await openTree(page, width, 800);
      await H.expandNode(page, SAMUEL_MAGDA);
      await H.expandNode(page, TIAGO_TANIA);
      await H.expandNode(page, DIEGO_OLGA);
      await H.expandNode(page, "Lauro Mendes");
      for (const theme of ["light", "dark"] as const) {
        await H.setTheme(page, theme);
        await page.mouse.move(0, 0); // sem o ponteiro sobre um nó (o fundo de hover é outra medida)
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(300);
        summaries.push(await H.axeScan(page, "Ministérios", theme));
      }
      await H.setTheme(page, "light");
    }
    const withViolations = summaries.filter((s) => s.violations.length > 0);
    expect(withViolations, JSON.stringify(withViolations, null, 1)).toEqual([]);
  });
});
