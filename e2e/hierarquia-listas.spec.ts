import { test, expect, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as H from "./hierarquia-support";

// Hierarquia e totais nas listas de Membros e de Células (E2.06, PR 2, T8): UX-01, UX-02, UX-03,
// UX-05, UX-06 e UX-08, e o axe da UX-07 e da UX-20, com a massa do spec (as 23 pessoas e as
// células C1 a C11). Rita (Administrador) vê tudo; André vê o ramo de Pedro, Beatriz e Débora.

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
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${H.PREFIX}%')
          + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${H.PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${H.PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%${H.ADMIN_EMAIL_SUFFIX}')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.beforeEach(() => H.resetThrottle(env));

const VIEWPORTS = { phone: { width: 360, height: 800 }, tablet: { width: 768, height: 1024 }, laptop: { width: 1024, height: 768 }, desktop: { width: 1280, height: 800 } };

async function openMembers(page: Page, width: number) {
  await page.setViewportSize({ width, height: width >= 1024 ? 800 : 800 });
  await page.goto("/members?size=50");
  await expect(page.getByText("Carregando...")).toHaveCount(0);
  await expect(page.getByText(H.SAMUEL.name).first()).toBeVisible();
}

async function openCells(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/cells?size=50");
  await expect(page.getByText("Carregando...")).toHaveCount(0);
  await expect(page.getByText(H.ANDRE.name).first()).toBeVisible();
}

/** O texto visível de um elemento: sem o que só o leitor de tela ouve. */
const seen = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  });

const LEVELS: Array<[H.Person, string]> = [
  [H.SAMUEL, "Pastor"],
  [H.MAGDA, "Pastora"],
  [H.PEDRO, "G12"],
  [H.LUCIA, "G12"],
  [H.ANDRE, "144"],
  [H.CAIO, "1.728"],
  [H.GABRIEL, "20.736"],
  [H.SONIA, "Nível 5"],
  [H.ESTER, "Sem liderança"],
];

test.describe("UX-01, UX-02, UX-03: a lista de Membros de Rita", () => {
  test("UX-01: o nível de cada pessoa, na tabela (1280) e nos cartões (360)", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openMembers(page, VIEWPORTS.desktop.width);
    for (const [person, label] of LEVELS) {
      // Foto, Nome, Celular e Nível: o nível é a 4ª coluna.
      const level = H.memberRow(page, person.name, true).locator("td:nth-child(4)");
      await expect(level, `${person.name} na tabela`).toContainText(label);
      expect(await seen(level), `${person.name}: só o rótulo`).toBe(label);
    }
    await openMembers(page, VIEWPORTS.phone.width);
    for (const [person, label] of LEVELS) {
      await expect(H.memberCard(page, person.name).getByText(new RegExp(`^(nível )?${label}$`)), `${person.name} no cartão`).toBeVisible();
    }
    // Nenhum "12" sozinho como nível.
    await expect(page.getByText("12", { exact: true })).toHaveCount(0);
  });

  test("UX-02: a Liderança na tabela e nos cartões", async ({ page }) => {
    await H.signIn(page, H.RITA);
    const expected: Array<[H.Person, string]> = [
      [H.SAMUEL, "—"],
      [H.PEDRO, "Samuel Colares"],
      [H.ANDRE, "Pedro Alves"],
      [H.CAIO, "Pedro Alves / André Souza"],
      [H.GABRIEL, "Pedro Alves / Fábio Lima"],
      [H.ESTER, "Sem liderança"],
      [H.LUCIA, "Ester Ramos"],
    ];
    await openMembers(page, VIEWPORTS.desktop.width);
    for (const [person, text] of expected) {
      expect(await seen(H.memberRow(page, person.name, true).locator("td:nth-child(5)")), `${person.name} na tabela`).toBe(text);
    }
    // Os totais aparecem sempre: Caio "0 discípulos · 0 células".
    expect(await H.memberRow(page, H.CAIO.name, true).locator('td:nth-child(6) span[aria-hidden="true"]').allInnerTexts()).toEqual(["0 discípulos", "0 células"]);

    await openMembers(page, VIEWPORTS.phone.width);
    for (const [person, text] of expected) {
      const card = H.memberCard(page, person.name);
      if (person === H.SAMUEL || person === H.ESTER) {
        await expect(card.getByText("Liderança:"), `${person.name}: sem a linha`).toHaveCount(0);
      } else {
        expect(await seen(card.locator("p", { hasText: "Liderança:" })), `${person.name} no cartão`).toBe(`Liderança: ${text}`);
      }
    }
    expect(await seen(H.memberCard(page, H.CAIO.name).locator("span.block"))).toBe("0 discípulos · 0 células");
    // Os nomes da liderança não são links.
    await expect(H.memberCard(page, H.CAIO.name).getByRole("link")).toHaveCount(0);
  });

  test("UX-02: na lista de André, Débora mostra 'Tânia Rocha / Beatriz Souza', sem link", async ({ browser }) => {
    const andre = await H.sessionOf(browser, H.ANDRE, VIEWPORTS.desktop);
    try {
      await andre.page.goto("/members?size=50");
      await expect(andre.page.getByText("Carregando...")).toHaveCount(0);
      const cell = H.memberRow(andre.page, H.DEBORA.name, true).locator("td:nth-child(5)");
      expect(await seen(cell)).toBe("Tânia Rocha / Beatriz Souza");
      await expect(cell.getByRole("link")).toHaveCount(0);
      // Tânia continua fora do alcance de André (RN-10).
      await expect(H.memberRow(andre.page, H.TANIA.name, true)).toHaveCount(0);
    } finally {
      await andre.close();
    }
  });

  test("UX-03: o cabeçalho da tabela, em 1024 e em 1280", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openMembers(page, VIEWPORTS.laptop.width);
    expect(await page.getByRole("columnheader").allTextContents()).toEqual(["Nome", "Nível", "Liderança", "Ministério", "Situação", "Ações"]);
    await openMembers(page, VIEWPORTS.desktop.width);
    expect(await page.getByRole("columnheader").allTextContents()).toEqual(["", "Nome", "Celular", "Nível", "Liderança", "Ministério", "Situação", "Ações"]);
    for (const old of ["Nível G12", "Líder", "Status"]) await expect(page.getByRole("columnheader", { name: old, exact: true })).toHaveCount(0);
  });

  test("UX-04: os totais por extenso, da pessoa (Diego 3 · 3, Olga 1 · 1) e sem 'disc.' nem 'cél.'", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openMembers(page, VIEWPORTS.laptop.width);
    expect(await H.memberRow(page, H.DIEGO.name, false).locator('td:nth-child(4) span[aria-hidden="true"]').allInnerTexts()).toEqual(["3 discípulos", "3 células"]);
    expect(await H.memberRow(page, H.OLGA.name, false).locator('td:nth-child(4) span[aria-hidden="true"]').allInnerTexts()).toEqual(["1 discípulo", "1 célula"]);
    expect(await page.locator("body").innerText()).not.toMatch(/disc\.|cél\./);
  });
});

test.describe("UX-05: cartões e tabela por largura, sem rolagem horizontal, com nomes de 40 caracteres", () => {
  const LONG = ["Maria Aparecida Fernanda de Souza Bragan", "Joaquim Henrique Albuquerque Cavalcanti"];
  const LONG_IDS = [90, 91, 92];

  test.beforeAll(() => {
    expect(LONG[0]).toHaveLength(40);
    const insert = (n: number, name: string, leader: number, mobile: string) =>
      sql(
        env,
        `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, mobile_whatsapp)
         VALUES (${lit(H.id(n))}, ${lit(name)}, 'F', false, true, ${lit(H.id(leader))}, ${lit(mobile)});`,
      );
    insert(LONG_IDS[0]!, LONG[0]!, 1, "51932069001");
    insert(LONG_IDS[1]!, LONG[1]!, LONG_IDS[0]!, "51932069002");
    insert(LONG_IDS[2]!, "Pessoa Final Teste", LONG_IDS[1]!, "51932069003");
  });
  test.afterAll(() => {
    for (const n of [...LONG_IDS].reverse()) sql(env, `DELETE FROM public.members WHERE id = ${lit(H.id(n))};`);
  });

  for (const [name, viewport, kind] of [
    ["360", VIEWPORTS.phone, "cartões"],
    ["768", VIEWPORTS.tablet, "cartões"],
    ["1024", VIEWPORTS.laptop, "tabela"],
    ["1280", VIEWPORTS.desktop, "tabela"],
  ] as const) {
    test(`Membros e Células a ${name} px: ${kind}, sem rolagem horizontal`, async ({ page }) => {
      await H.signIn(page, H.RITA);
      await openMembers(page, viewport.width);
      if (kind === "tabela") await expect(page.getByRole("table")).toBeVisible();
      else await expect(page.getByRole("table")).toHaveCount(0);
      await expect(page.getByText(LONG[1]!).first()).toBeVisible();
      await H.expectNoPageHScroll(page, `Membros ${name}`);
      // Células: cartões até 1279 px e tabela a partir de 1280 px (E2.09, P74).
      await openCells(page, viewport.width);
      if (viewport.width >= 1280) await expect(page.getByRole("table")).toBeVisible();
      else await expect(page.getByRole("table")).toHaveCount(0);
      await H.expectNoPageHScroll(page, `Células ${name}`);
    });
  }

  for (const [name, viewport, kind] of [
    ["1280", VIEWPORTS.desktop, "tabela"],
    ["360", VIEWPORTS.phone, "cartões"],
  ] as const) {
    test(`O primeiro render a ${name} px já é ${kind} (antes de a lista chegar)`, async ({ page }) => {
      await H.signIn(page, H.RITA);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      let release: () => void = () => {};
      const hold = new Promise<void>((resolve) => (release = resolve));
      // A lista vem da `members_list` desde o E2.07; enquanto ela não chega, os 5 `Skeleton` já têm o
      // formato das linhas da tabela ou dos cartões (UX-16 do E2.07).
      await page.route("**/rest/v1/rpc/members_list*", async (route) => {
        await hold;
        await route.continue();
      });
      await page.goto("/members?size=50");
      const skeletons = page.getByTestId("members-loading").locator(":scope > *");
      await expect(skeletons).toHaveCount(5);
      await expect(skeletons.first()).toHaveClass(kind === "tabela" ? /h-12/ : /h-28/);
      release();
      await expect(page.getByText(H.SAMUEL.name).first()).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(kind === "tabela" ? 1 : 0);
    });
  }

  test("A Liderança com dois nomes de 40 caracteres quebra linha e não estoura a tela (360 e 1024)", async ({ page }) => {
    await H.signIn(page, H.RITA);
    for (const viewport of [VIEWPORTS.phone, VIEWPORTS.laptop]) {
      await openMembers(page, viewport.width);
      const finalLine =
        viewport.width < 1024
          ? H.memberCard(page, "Pessoa Final Teste").locator("p", { hasText: "Liderança:" })
          : H.memberRow(page, "Pessoa Final Teste", false).locator("td:nth-child(3)");
      await expect(finalLine).toContainText(LONG[0]!);
      await expect(finalLine).toContainText(LONG[1]!);
      await H.expectNoPageHScroll(page, `Liderança longa a ${viewport.width}`);
      const box = await finalLine.boundingBox();
      expect(box!.x + box!.width, "dentro da tela").toBeLessThanOrEqual(viewport.width);
    }
  });
});

test.describe("UX-06: 320 px e zoom de 200%: sem corte e sem rolagem horizontal", () => {
  /** Os elementos do conteúdo que passam da borda direita da tela. */
  const beyondRightEdge = (page: Page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("main *"))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5 && getComputedStyle(el).position !== "fixed")
        .map((el) => `${el.tagName}.${String(el.getAttribute("class")).slice(0, 60)}`)
        .slice(0, 5),
    );

  // O zoom de 200% do navegador numa tela de 1280 px deixa 640 px de largura em CSS; a 320 px não há zoom.
  for (const [label, viewport, scale] of [
    ["320×640", { width: 320, height: 640 }, 1],
    ["zoom de 200% (640 px de largura em CSS, escala 2)", { width: 640, height: 400 }, 2],
  ] as const) {
    test(`Os cartões de Membros e de Células a ${label}: sem rolagem horizontal, nada além da borda, totais inteiros`, async ({ browser }) => {
      const context = await browser.newContext({ baseURL: E2E_BASE_URL, viewport, deviceScaleFactor: scale });
      const page = await context.newPage();
      try {
        await H.signIn(page, H.RITA);
        for (const path of ["/members?size=50", "/cells?size=50"]) {
          await page.goto(path);
          await expect(page.getByText("Carregando...")).toHaveCount(0);
          await expect(page.getByText(H.ANDRE.name).first()).toBeVisible();
          await H.expectNoPageHScroll(page, `${path} ${label}`);
          expect(await beyondRightEdge(page), `${path} ${label}: elementos além da borda`).toEqual([]);
        }
        await page.goto("/members?size=50");
        await expect(page.getByText(H.ANDRE.name).first()).toBeVisible();
        // Um total nunca se parte entre o número e a palavra.
        const broken = await page.locator("span.whitespace-nowrap").evaluateAll((els) =>
          els.filter((el) => /discípulo|célula/.test(el.textContent ?? "")).filter((el) => el.getClientRects().length > 1).length,
        );
        expect(broken, "totais partidos em duas linhas").toBe(0);
        // Os nomes e os rótulos do nível não são cortados: nenhum texto do cartão fica escondido por overflow.
        const clipped = await page.evaluate(() =>
          Array.from(document.querySelectorAll("div.space-y-3 p, div.space-y-3 span"))
            .filter((el) => !el.closest(".sr-only") && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible")
            .map((el) => el.textContent?.slice(0, 40)),
        );
        expect(clipped, "texto cortado nos cartões").toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("Informativo: a 320 px com a fonte do sistema a 200% (rem), os cartões continuam sem rolagem horizontal da página", async ({ page }, testInfo) => {
    await H.signIn(page, H.RITA);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/members?size=50");
    await expect(page.getByText(H.ANDRE.name).first()).toBeVisible();
    await H.zoom200(page);
    await H.expectNoPageHScroll(page, "Membros 320 px, fonte a 200%");
    const beyond = await beyondRightEdge(page);
    testInfo.annotations.push({ type: "além da borda (fonte a 200% em rem, pior que o zoom do navegador)", description: JSON.stringify(beyond) });
  });
});

test.describe("UX-08: o líder com o nível e o G12 de um nome só na lista de Células", () => {
  const extra = [
    { n: 21, leader: H.SAMUEL },
    { n: 22, leader: H.MAGDA },
    { n: 23, leader: H.ESTER },
  ];

  test.beforeAll(() => {
    for (const c of extra) {
      sql(env, `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active) VALUES (${lit(H.cellId(c.n))}, ${lit(H.memberId(c.leader))}, ${lit(H.memberId(c.leader))}, ${lit(H.memberId(c.leader))}, 'Evangelística', 'Quarta', '20:00', true);`);
    }
  });
  test.afterAll(() => {
    for (const c of extra) sql(env, `DELETE FROM public.cells WHERE id = ${lit(H.cellId(c.n))};`);
  });

  const EXPECTED: Array<[string, string, string]> = [
    ["André Souza", "André Souza (144)", "Pedro Alves"],
    ["Samuel Colares", "Samuel Colares (Pastor)", "Pastores"],
    ["Magda Colares", "Magda Colares (Pastora)", "Pastores"],
    ["Ester Ramos", "Ester Ramos (Sem liderança)", "—"],
    ["Lúcia Freitas", "Lúcia Freitas (G12)", "Lúcia Freitas"],
    ["Sônia Castro", "Sônia Castro (Nível 5)", "Tiago Rocha"],
  ];

  test("Na tabela (1280): líder com o nível e o G12 numa coluna, sempre um nome só", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openCells(page, VIEWPORTS.desktop.width);
    for (const [leader, text, g12] of EXPECTED) {
      const row = page.locator("tbody tr").filter({ has: page.locator("td:nth-child(1) span.break-words", { hasText: new RegExp(`^${leader}`) }) });
      await expect(row, leader).toHaveCount(1);
      expect(await seen(row.locator("td:nth-child(1) span.break-words")), `líder de ${leader}`).toBe(text);
      expect(await seen(row.locator("td:nth-child(2)")), `G12 de ${leader}`).toBe(g12);
    }
  });

  test("Nos cartões (360): o mesmo, com 'G12: …'", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openCells(page, VIEWPORTS.phone.width);
    for (const [leader, text, g12] of EXPECTED) {
      // E2.09 (UXD-4): o cartão é um item da lista, e o G12 abre o bloco das pessoas.
      const card = page.locator("main li").filter({ has: page.locator("p.text-sm span.break-words", { hasText: new RegExp(`^${leader}`) }) });
      await expect(card, leader).toHaveCount(1);
      expect(await seen(card.locator("span.break-words").first()), `líder de ${leader}`).toBe(text);
      expect(await seen(card.locator('[data-part="people"] > p').first()), `G12 de ${leader}`).toBe(`G12: ${g12}`);
    }
  });
});

test.describe("UX-07 e UX-20: axe nas listas, nos dois temas", () => {
  test("Membros e Células sem violação, a 360, 768, 1024 e 1280 px, claro e escuro; 'Sem liderança' com ícone e sem laranja fixo", async ({ page }, testInfo) => {
    // 16 varreduras do axe: com a ação "Redefinir senha" em cada linha (E2.03), passa perto dos 30 s padrão.
    test.slow();
    await H.signIn(page, H.RITA);
    const summaries: H.AxeSummary[] = [];
    for (const [screen, path] of [["Membros", "/members?size=50"], ["Células", "/cells?size=50"]] as const) {
      for (const width of [360, 768, 1024, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await expect(page.getByText("Carregando...")).toHaveCount(0);
        await expect(page.getByText(H.ANDRE.name).first()).toBeVisible();
        for (const theme of ["light", "dark"] as const) {
          await H.setTheme(page, theme);
          summaries.push(await H.axeScan(page, screen, theme));
        }
        await H.setTheme(page, "light");
      }
    }
    await testInfo.attach("axe-listas.json", { body: JSON.stringify(summaries, null, 2), contentType: "application/json" });
    const withViolations = summaries.filter((s) => s.violations.length > 0);
    expect(withViolations, JSON.stringify(withViolations, null, 1)).toEqual([]);
  });

  test("UX-07: o badge 'Sem liderança' tem ícone e texto, e nenhum bg-orange-500 está no DOM", async ({ page }) => {
    await H.signIn(page, H.RITA);
    await openMembers(page, VIEWPORTS.desktop.width);
    const badge = H.memberRow(page, H.ESTER.name, true).locator("td:nth-child(4)").getByText("Sem liderança", { exact: true });
    await expect(badge).toBeVisible();
    expect(await badge.locator("xpath=..").locator("svg").count(), "ícone do badge").toBeGreaterThan(0);
    expect(await page.locator('[class*="bg-orange-500"]').count()).toBe(0);
    // "Inativo" também tem ícone.
    const inactive = H.memberRow(page, H.FABIO.name, true).getByText("Inativo", { exact: true });
    await expect(inactive).toBeVisible();
    expect(await inactive.locator("xpath=..").locator("svg").count(), "ícone de Inativo").toBeGreaterThan(0);
  });
});
