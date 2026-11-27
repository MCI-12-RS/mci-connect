import { expect, test } from "@playwright/test";
import { lit, openList, sql } from "./exclusao-support";
import { ANDRE, CellsWorld, GABRIEL, NAME, PEDRO, cellId, memberId, signIn } from "./celulas-support";

// E2.11 PR 3 (tarefa 10): a lista de Relatórios pelo retrato (T10, UX-34, RN-14 d). A massa é a do E2.08.

const world = new CellsWorld();

test.beforeAll(async () => world.setUp());
test.afterAll(async () => world.tearDown());
test.beforeEach(() => world.resetCells());

test("UX-34 e RN-14: a linha mostra o líder registrado e 'G12: {nome}'; depois de trocar o líder da célula, ela continua com ele e a busca ainda o acha", async ({ page }) => {
  sql(
    world.env,
    `BEGIN; SET LOCAL mci.cell_report_write = 'on';
     INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme, visitors, offering)
     VALUES (${lit(cellId(1))}, public.sp_today(), '00:00', true, '${NAME} tema do retrato', '{}', 0); COMMIT;`,
  );
  // Rita troca o líder de C1 depois do envio: o relatório continua de André (o retrato).
  sql(world.env, `UPDATE public.cells SET leader_id = ${lit(memberId(GABRIEL))} WHERE id = ${lit(cellId(1))};`);

  await signIn(page, PEDRO);
  await openList(page, "/cell-reports", `${NAME} André`);
  const row = page.getByRole("row").filter({ hasText: `${NAME} tema do retrato` });
  await expect(row).toContainText(ANDRE.name);
  await expect(row).toContainText(`G12: ${PEDRO.name}`);
  await expect(row).not.toContainText(GABRIEL.name);
  await expect(page.getByRole("button", { name: "Novo relatório", exact: true })).toBeVisible();
});
