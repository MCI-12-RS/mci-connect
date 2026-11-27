import { test, expect, type Page } from "@playwright/test";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// QA independente do detalhe da célula (E2.10, PR 5, tarefa 15): o que a spec do desenvolvedor
// (`celula-detalhe.spec.ts`) não cobre. Preview do cache da lista quando a pessoa perde o acesso
// entre a lista e o detalhe (RN-14, DA-4), setas com relatório anterior não realizado e oferta
// nula ou zero (RN-17, RN-18, RN-20), edição de relatório pelo detalhe (UX-20) e Rita na excluída.

let env: E2EEnv;
const PHONE = { width: 360, height: 800 };

const CELL_Y = F.cellId(10); // Caio lidera: relatórios com setas variadas
const CELL_Z = F.cellId(11); // Carla lidera: um relatório só
const CELL_W = F.cellId(12); // Beatriz lidera: excluída entre a lista e o detalhe
const CELL_V = F.cellId(13); // Jonas lidera: excluída depois de aberta uma vez
const rid = (n: number) => `${F.PREFIX}-0004-0000-0000-0000000001${String(n).padStart(2, "0")}`;

const insertCell = (cell: string, leader: F.Person, host: F.Person) =>
  sql(
    env,
    `INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
     VALUES (${lit(cell)}, ${lit(F.memberId(leader))}, ${lit(F.memberId(F.ANDRE))}, ${lit(F.memberId(host))}, 'Discipulado', 'Terça', '20:00');`,
  );

function addReport(n: number, cell: string, day: number, held: boolean, participants: number, visitors: string[], offering: number | null) {
  const people = F.PEOPLE.slice(0, participants).map((p) => F.memberId(p));
  sql(
    env,
    `BEGIN; SET LOCAL session_replication_role = replica;
     INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, reason_not_held, offering, visitors)
     VALUES (${lit(rid(n))}, ${lit(cell)}, public.week_start(public.sp_today()) + ${day}, '20:00', ${held},
             ${held ? lit(`Tema QA ${n}`) : "NULL"}, ${held ? "NULL" : lit("Sem reunião QA")}, ${offering === null ? "NULL" : offering},
             ARRAY[${visitors.map(lit).join(", ")}]::text[]);
     ${people.map((m) => `INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (${lit(rid(n))}, ${lit(m)});`).join("\n")}
     COMMIT;`,
  );
}

test.beforeAll(async () => {
  env = e2eEnv();
  await F.removeAccounts(env);
  F.cleanup(env);
  await F.seed(env);
  insertCell(CELL_Y, F.CAIO, F.CARLA);
  insertCell(CELL_Z, F.CARLA, F.CARLA);
  insertCell(CELL_W, F.BEATRIZ, F.CARLA);
  insertCell(CELL_V, F.JONAS, F.CARLA);
  // Y, da mais antiga à mais nova: realizada (3 e 0), não realizada, realizada com oferta zero (3 e 2),
  // realizada com oferta nula (2 e 2).
  addReport(1, CELL_Y, -25, true, 3, [], 10);
  addReport(2, CELL_Y, -18, false, 0, [], null);
  addReport(3, CELL_Y, -11, true, 3, ["Visitante A", "Visitante B"], 0);
  addReport(4, CELL_Y, -4, true, 2, ["Visitante A", "Visitante B"], null);
  addReport(5, CELL_Z, -4, true, 2, ["Visitante A"], 5);
});

test.afterAll(async () => {
  if (!env) return;
  await F.removeAccounts(env);
  F.cleanup(env);
});

test.beforeEach(() => F.resetThrottle(env));

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const reportsOf = (page: Page) => page.getByRole("region", { name: "Últimos relatórios" });
const deleteCell = (cell: string) => sql(env, `UPDATE public.cells SET deleted_at = now() WHERE id = ${lit(cell)};`);

test.describe("RN-14, DA-4: a pessoa perde o acesso entre a lista e o detalhe", () => {
  test("a linha do cache da lista não fica na tela quando a leitura diz não encontrada", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto("/cells");
    await F.waitForCells(page);
    const link = page.getByRole("link", { name: /^Célula de Beatriz Souza/ });
    await expect(link).toBeVisible();
    deleteCell(CELL_W);
    const network = F.recordResponses(page);
    await link.click();
    await expect(h1(page)).toHaveText("Célula não encontrada");
    await page.waitForLoadState("networkidle");
    const main = await page.getByRole("main").innerHTML();
    expect(main).not.toContain("Beatriz Souza");
    expect(main).not.toContain("Carla Dias");
    // A leitura do detalhe devolveu vazio; nenhuma resposta traz a célula.
    expect(network.bodies.join("\n")).not.toContain(CELL_W);
  });

  test("o detalhe já aberto e guardado no cache também some quando a célula deixa de existir", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto("/cells");
    await F.waitForCells(page);
    await page.getByRole("link", { name: /^Célula de Jonas Prado/ }).click();
    await expect(h1(page)).toHaveText("Célula de Jonas Prado");
    await page.goBack();
    await F.waitForCells(page);
    deleteCell(CELL_V);
    await page.goForward();
    await expect(h1(page)).toHaveText("Célula não encontrada");
    await page.waitForLoadState("networkidle");
    expect(await page.getByRole("main").innerHTML()).not.toContain("Jonas Prado");
  });

  test("Rita (Administradora) em C5 excluída: não encontrada, sem nada da célula na rede", async ({ page }) => {
    await F.signIn(page, F.RITA);
    const network = F.recordResponses(page);
    await page.goto(`/cells/${F.cellId(5)}`);
    await expect(h1(page)).toHaveText("Célula não encontrada");
    await page.waitForLoadState("networkidle");
    expect(network.bodies.join("\n")).not.toContain("Tema C5");
    // A leitura dos relatórios corre junto, mas volta vazia (DA-4): nada de C5 em nenhuma resposta.
    expect(network.bodies.join("\n")).not.toContain(F.cellId(5));
  });
});

test.describe("RN-17, RN-18, RN-20: setas e oferta", () => {
  test("a seta compara com o último relatório realizado, pulando o não realizado; oferta nula e zero", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto(`/cells/${CELL_Y}`);
    await expect(reportsOf(page).getByRole("article")).toHaveCount(3);
    const cards = await reportsOf(page).getByRole("article").all();
    const [newest, zero, notHeld] = cards;
    // o mais novo (2 e 2) contra o de oferta zero (3 e 2), pulando o não realizado
    await expect(newest).toContainText("2, menos que no relatório anterior");
    await expect(newest).toContainText("2, igual ao relatório anterior");
    await expect(newest).toContainText("Não informada");
    // o não realizado: motivo, sem participantes, sem seta
    await expect(notHeld).toContainText("Motivo: Sem reunião QA");
    await expect(notHeld).not.toContainText("Participantes");
    await expect(notHeld).not.toContainText("relatório anterior");
    // 3 e 2 contra o primeiro (3 e 0), que está fora dos três últimos mas conta para a seta
    await expect(zero).toContainText("3, igual ao relatório anterior");
    await expect(zero).toContainText("2, mais que no relatório anterior");
    await expect(zero).toContainText("R$ 0,00");
    await expect(reportsOf(page).getByText("As setas comparam com o relatório anterior de célula realizada.")).toBeVisible();
  });

  test("um único relatório realizado: só os números, sem seta e sem a frase das setas", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await page.goto(`/cells/${CELL_Z}`);
    await expect(reportsOf(page).getByRole("article")).toHaveCount(1);
    const only = reportsOf(page).getByRole("article");
    await expect(only).toContainText("Tema QA 5");
    await expect(only).not.toContainText("relatório anterior");
    await expect(reportsOf(page).getByText("As setas comparam com o relatório anterior de célula realizada.")).toHaveCount(0);
  });
});

test.describe("UX-20: editar um relatório pelo detalhe", () => {
  test("a lista de últimos relatórios mostra o novo tema e a oferta sem recarregar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await F.signIn(page, F.PEDRO);
    await page.goto(`/cells/${CELL_Z}`);
    await expect(reportsOf(page)).toContainText("Tema QA 5");
    await page.getByRole("button", { name: /^Editar o relatório de .* da célula de Carla Dias$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Editar relatório" });
    await dialog.getByLabel(/^Tema/).fill("Tema QA editado");
    await dialog.getByLabel(/^Oferta/).fill("77,00");
    await dialog.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(reportsOf(page)).toContainText("Tema QA editado");
    await expect(reportsOf(page)).toContainText("R$ 77,00");
    await expect(reportsOf(page)).not.toContainText("Tema QA 5");
  });
});
