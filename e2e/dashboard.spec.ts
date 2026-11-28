import { test, expect, type Page, type Response } from "@playwright/test";

// Dashboard calculado no banco (E1.08, PR 3: RN-02, RN-08 e RN-09; E2.14 PR 2: duas RPCs,
// os títulos da RN-16, os tipos vindos do resumo e os cards com zero escondidos, RN-14).
//
// Faz login de verdade, então precisa de um banco com usuários de teste e do
// front apontando para ele (VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
// no ambiente do `npm run dev`). As credenciais vêm só do ambiente; sem elas,
// os testes são pulados:
//   E2E_DASHBOARD_EMAIL / E2E_DASHBOARD_PASSWORD: usuário com view_dashboard;
//   E2E_NO_DASHBOARD_EMAIL / E2E_NO_DASHBOARD_PASSWORD: usuário sem
//   view_dashboard e sem view_own_ministry_dashboard.

const DASHBOARD_RPCS = ["dashboard_g12_ranking", "dashboard_summary"];

// O que o AuthContext lê depois do login, além do dashboard (o login em si é a função sign-in, que não passa pelo /rest/v1/; E1.04).
const AUTH_PATHS = ["/rest/v1/members_view", "/rest/v1/rpc/my_access"];

const WEEK_CARDS: Record<string, string> = {
  "Relatórios enviados": "reports_sent",
  "Células com relatório pendente": "cells_pending",
  "Visitantes em células": "visitors",
  "Células não realizadas": "cells_not_held",
  "Novos membros": "members_new",
  "Novas células": "cells_new",
};

const GENERAL_CARDS: Record<string, string> = {
  "Total de membros": "members_total",
  "Membros ativos": "members_active",
  "Membros inativos": "members_inactive",
  Batizados: "members_baptized",
  "Não batizados": "members_not_baptized",
  "Sem liderança": "members_without_leader",
  "Sem vínculo celular": "members_without_cell_link",
  "Células evangelísticas": "cells_evangelistic",
  "Células de discipulado": "cells_discipleship",
  Macrocélulas: "cells_macrocell",
};

/** RN-14: à vista mesmo com zero. */
const ALWAYS_VISIBLE = new Set(["reports_sent", "cells_pending", "visitors", "members_total", "members_active"]);

interface G12Row {
  name: string;
  spouse_name: string | null;
  male_cells: number;
  female_cells: number;
  total_cells: number;
}

/** Caminhos de /rest/v1/ pedidos pela página, na ordem. */
function recordRestCalls(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/rest/v1/")) paths.push(url.pathname);
  });
  return paths;
}

const isRpc = (name: string) => (response: Response) => new URL(response.url()).pathname === `/rest/v1/rpc/${name}`;

/** Credenciais do ambiente; sem elas, o teste é pulado. */
function credentials(emailVar: string, passwordVar: string) {
  const email = process.env[emailVar];
  const password = process.env[passwordVar];
  test.skip(!email || !password, `Defina ${emailVar} e ${passwordVar} para rodar este teste.`);
  return { email: email ?? "", password: password ?? "" };
}

async function login(page: Page, { email, password }: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
}

/** Um número como a tela exibe, com o separador de milhar do pt-BR: 1530 → "1.530". */
const shownCount = (value: number | string) => Number(value).toLocaleString("pt-BR");

/** "2026-11-22" → "22/11". */
const dayMonth = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

/** O card (o `li` da grade) com esse título. */
function card(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
}

test.describe("Dashboard (RN-08, RN-09)", () => {
  test.setTimeout(60_000);

  test("Dado um usuário com view_dashboard, quando abre o dashboard, então faz só as duas chamadas e mostra os números delas, sem os cards com zero", async ({
    page,
  }) => {
    const user = credentials("E2E_DASHBOARD_EMAIL", "E2E_DASHBOARD_PASSWORD");

    const restCalls = recordRestCalls(page);
    const responses = Promise.all(DASHBOARD_RPCS.map((name) => page.waitForResponse(isRpc(name))));

    await login(page, user);
    await expect(page).toHaveURL(/\/$/);
    const [rankingResponse, summaryResponse] = await responses;
    await page.waitForLoadState("networkidle");

    // Só as duas RPCs, uma vez cada; o resto é do login (a dos tipos saiu, AQ-3).
    const dashboardCalls = restCalls.filter((path) => !AUTH_PATHS.includes(path));
    expect(dashboardCalls.sort()).toEqual(DASHBOARD_RPCS.map((name) => `/rest/v1/rpc/${name}`));

    // Os números exibidos são os das RPCs, sem nenhuma conta no cliente.
    const summary: Record<string, number | string> = await summaryResponse.json();
    const ranking: G12Row[] = await rankingResponse.json();

    const weekLabel = `Esta semana, de ${dayMonth(String(summary.week_start))} a ${dayMonth(String(summary.week_end))}`;
    await expect(page.getByRole("heading", { level: 2, name: weekLabel })).toBeVisible();

    for (const [title, field] of Object.entries({ ...WEEK_CARDS, ...GENERAL_CARDS })) {
      const value = Number(summary[field]);
      if (ALWAYS_VISIBLE.has(field) || value > 0) {
        await expect(card(page, title).locator("span.text-3xl"), title).toHaveText(shownCount(value));
      } else {
        await expect(card(page, title), title).toHaveCount(0);
      }
    }

    // O gráfico só aparece com alguma parte maior que zero (RN-12).
    const chartVisible = ["reports_held", "cells_not_held", "cells_pending"].some((field) => Number(summary[field]) > 0);
    await expect(page.getByRole("heading", { level: 3, name: "Relatórios de células" })).toHaveCount(chartVisible ? 1 : 0);

    const withCouples = ranking.length > 0;
    await expect(page.getByRole("heading", { level: 2, name: "Células por G12" })).toHaveCount(withCouples ? 1 : 0);
    if (withCouples) {
      const rows = page.getByRole("table").locator("tbody tr");
      await expect(rows).toHaveCount(ranking.length);
      // O casal é o cabeçalho da linha (`th`); os números ficam nos `td`, sem as pílulas (T5).
      const shown = await rows.evaluateAll((trs) =>
        trs.map((tr) => Array.from(tr.querySelectorAll("td"), (cell) => cell.textContent?.trim() ?? "")),
      );
      expect(shown).toEqual(
        ranking.map((row) => [shownCount(row.male_cells), shownCount(row.female_cells), shownCount(row.total_cells)]),
      );
      for (const [index, row] of ranking.entries()) {
        await expect(rows.nth(index).locator("th")).toContainText(row.name);
      }
    }
  });

  test("Dado um usuário sem permissão de dashboard, quando abre o dashboard, então o banco recusa (42501) e a tela mostra o acesso negado", async ({
    page,
  }) => {
    const user = credentials("E2E_NO_DASHBOARD_EMAIL", "E2E_NO_DASHBOARD_PASSWORD");

    const summaryResponse = page.waitForResponse(isRpc("dashboard_summary"));

    await login(page, user);
    await expect(page).toHaveURL(/\/$/);

    const response = await summaryResponse;
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe("42501");

    await expect(page.getByText("Você não tem acesso ao dashboard.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Esta semana", exact: false })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});
