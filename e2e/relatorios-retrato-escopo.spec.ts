import { expect, test } from "@playwright/test";
import { lit, openList, sql } from "./exclusao-support";
import { ANDRE, CAIO, CARLA, CellsWorld, FABIO, GABRIEL, NAME, cellId, memberId, signIn } from "./celulas-support";

// E2.11 PR 3 (tarefa 10, RN-14 b e d): o relatório continua visível para quem está no retrato, mesmo depois de
// a célula trocar de pessoas, e a linha continua com as pessoas registradas. A massa é a do E2.08.

const world = new CellsWorld();

test.beforeAll(async () => world.setUp());
test.afterAll(async () => world.tearDown());
test.beforeEach(() => world.resetCells());

test("RN-14 b e d: Caio (timóteo registrado) vê o relatório depois que a célula troca o timóteo e a anfitriã; a linha mostra o líder registrado", async ({ page }) => {
  sql(
    world.env,
    `BEGIN; SET LOCAL mci.cell_report_write = 'on';
     INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme, visitors, offering)
     VALUES (${lit(cellId(1))}, public.sp_today(), '00:00', true, '${NAME} tema do retrato escopo', '{}', 0); COMMIT;`,
  );
  // As pessoas da célula mudam: Fábio vira timóteo e Gabriel, anfitrião. Caio e Carla saem da célula.
  sql(
    world.env,
    `UPDATE public.cells SET timothy_id = ${lit(memberId(FABIO))}, host_id = ${lit(memberId(GABRIEL))} WHERE id = ${lit(cellId(1))};`,
  );
  const registered = sql(
    world.env,
    `SELECT snapshot_timothy_id || '/' || snapshot_host_id FROM public.cell_reports WHERE theme = '${NAME} tema do retrato escopo'`,
  );
  expect(registered).toBe(`${memberId(CAIO)}/${memberId(CARLA)}`);

  await signIn(page, CAIO);
  await openList(page, "/cell-reports", `${NAME} tema do retrato escopo`);
  const row = page.getByRole("row").filter({ hasText: `${NAME} tema do retrato escopo` });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(ANDRE.name);
});
