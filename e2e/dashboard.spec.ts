import { test, expect, type Page, type Response } from "@playwright/test";

// Dashboard calculado no banco (E1.08, PR 3: RN-02, RN-08 e RN-09).
//
// Faz login de verdade, então precisa de um banco com usuários de teste e do
// front apontando para ele (VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
// no ambiente do `npm run dev`). As credenciais vêm só do ambiente; sem elas,
// os testes são pulados:
//   E2E_DASHBOARD_EMAIL / E2E_DASHBOARD_PASSWORD: usuário com view_dashboard;
//   E2E_NO_DASHBOARD_EMAIL / E2E_NO_DASHBOARD_PASSWORD: usuário sem
//   view_dashboard e sem view_own_ministry_dashboard.

const DASHBOARD_RPCS = ["dashboard_cells_by_type", "dashboard_g12_ranking", "dashboard_summary"];

// O que o login e o AuthContext leem, além do dashboard.
const AUTH_PATHS = ["/rest/v1/members_view", "/rest/v1/role_permissions", "/rest/v1/roles", "/rest/v1/rpc/log_auth_event"];

const WEEK_CARDS: Record<string, string> = {
  "Relatórios Enviados": "reports_sent",
  "Células sem Relatório": "cells_pending",
  "Visitantes em Células": "visitors",
  "Células Não Realizadas": "cells_not_held",
};

const GENERAL_CARDS: Record<string, string> = {
  "Total de Membros": "members_total",
  "Membros Ativos": "members_active",
  "Membros Inativos": "members_inactive",
  Batizados: "members_baptized",
  "Não Batizados": "members_not_baptized",
  "Sem Liderança": "members_without_leader",
  "Sem Vínculo Celular": "members_without_cell_link",
};

interface CellsByTypeRow {
  cell_type: string;
  total: number;
}

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
  await page.getByLabel("Senha").fill(password);
  await page.locator('button[type="submit"]').click();
}

/** "2026-11-22" → "22/11". */
const dayMonth = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

/** O número exibido no card com esse título. */
function cardValue(page: Page, title: string) {
  return page
    .locator("div.rounded-lg", { has: page.getByRole("heading", { name: title, exact: true }) })
    .locator("div.text-3xl");
}

test.describe("Dashboard (RN-08, RN-09)", () => {
  test.setTimeout(60_000);

  test("Dado um usuário com view_dashboard, quando abre o dashboard, então faz só as três chamadas e mostra os números delas", async ({
    page,
  }) => {
    const user = credentials("E2E_DASHBOARD_EMAIL", "E2E_DASHBOARD_PASSWORD");

    const restCalls = recordRestCalls(page);
    const responses = Promise.all(DASHBOARD_RPCS.map((name) => page.waitForResponse(isRpc(name))));

    await login(page, user);
    await expect(page).toHaveURL(/\/$/);
    const [cellsByTypeResponse, rankingResponse, summaryResponse] = await responses;
    await page.waitForLoadState("networkidle");

    // Critério de pronto 8: só as três RPCs, uma vez cada; o resto é do login.
    const dashboardCalls = restCalls.filter((path) => !AUTH_PATHS.includes(path));
    expect(dashboardCalls.sort()).toEqual(DASHBOARD_RPCS.map((name) => `/rest/v1/rpc/${name}`));

    // Os números exibidos são os das RPCs, sem nenhuma conta no cliente.
    const summary: Record<string, number | string> = await summaryResponse.json();
    const cellsByType: CellsByTypeRow[] = await cellsByTypeResponse.json();
    const ranking: G12Row[] = await rankingResponse.json();

    const weekLabel = `Esta Semana (${dayMonth(String(summary.week_start))} - ${dayMonth(String(summary.week_end))})`;
    await expect(page.getByRole("heading", { name: weekLabel })).toBeVisible();

    for (const [title, field] of Object.entries({ ...WEEK_CARDS, ...GENERAL_CARDS })) {
      await expect(cardValue(page, title), title).toHaveText(String(summary[field]));
    }
    for (const row of cellsByType) {
      await expect(cardValue(page, `Células ${row.cell_type}`)).toHaveText(String(row.total));
    }

    if (ranking.length > 0) {
      const rows = page.getByRole("table").locator("tbody tr");
      await expect(rows).toHaveCount(ranking.length);
      const expected = ranking.map((row) => [
        row.spouse_name ? `${row.name} & ${row.spouse_name}` : row.name,
        String(row.male_cells),
        String(row.female_cells),
        String(row.total_cells),
      ]);
      const shown = await rows.evaluateAll((trs) =>
        trs.map((tr) => Array.from(tr.querySelectorAll("td"), (td) => td.textContent?.trim() ?? "")),
      );
      expect(shown).toEqual(expected);
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
    await expect(page.getByRole("heading", { name: "Esta Semana", exact: false })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});
