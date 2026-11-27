import { expect, test, type Page } from "@playwright/test";
import { lit, openList, sql, toast } from "./exclusao-support";
import {
  ANDRE,
  CAIO,
  CARLA,
  CellsWorld,
  FABIO,
  GABRIEL,
  NAME,
  PEDRO,
  cellId,
  memberId,
  newReportButton,
  sessionOf,
  signIn,
} from "./celulas-support";

// E2.11 PR 4 (tarefa 14): o formulário de relatório pela tela. A massa é a do E2.08 (C1: líder André,
// timóteo Caio, anfitriã Carla; G12 Pedro). Cada teste põe a reunião de C1 hoje à 00:00, para o lançamento
// não depender da hora em que roda (RN-06). Rodar com `--workers=1`.

const world = new CellsWorld();

test.beforeAll(async () => world.setUp());
test.afterAll(async () => world.tearDown());
test.beforeEach(() => {
  world.resetCells();
  world.meetingAlreadyHappened(1, 2, 3);
});

const q = (query: string) => sql(world.env, query);
const reportOf = (n: number) => q(`SELECT coalesce(id::text, '') FROM public.cell_reports WHERE cell_id = ${lit(cellId(n))} AND deleted_at IS NULL`);
const participantsOf = (reportId: string) =>
  q(`SELECT count(*) FROM public.cell_report_participants WHERE report_id = ${lit(reportId)}`);

/** As chamadas de gravação (POST e PATCH que não são leitura). */
function trackSubmits(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/rpc\/(submit_cell_report|save_cell_report)$/.test(path)) calls.push(path.split("/").pop() ?? "");
  });
  return calls;
}

test("UX-01, UX-03, UX-38 e UX-20: Carla, em 360×800 pelo Dashboard, recebe C1 já escolhida, em tela cheia, com o bloco, os automáticos e o rodapé à vista", async ({ browser }) => {
  const carla = await sessionOf(browser, CARLA, { width: 360, height: 800 });
  try {
    const { page } = carla;
    await page.getByRole("button", { name: "Novo relatório" }).click();
    const dialog = page.getByRole("dialog", { name: "Novo relatório" });
    await expect(dialog.getByLabel("Tema *")).toBeVisible();
    // O título recebe o foco ao abrir; nenhum campo (UXD-14, UX-40).
    await expect(dialog.getByRole("heading", { name: "Novo relatório" }).locator("span")).toBeFocused();

    const box = await dialog.boundingBox();
    expect(box && [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, 360, 800]);
    const send = dialog.getByRole("button", { name: "Enviar relatório" });
    const sendBox = await send.boundingBox();
    expect(sendBox && sendBox.y + sendBox.height).toBeLessThanOrEqual(800);
    expect(sendBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const block = dialog.getByRole("region", { name: "Dados da célula" });
    await expect(block).toContainText(`Líder${ANDRE.name}`);
    await expect(block).toContainText(`Timóteo${CAIO.name}`);
    await expect(block).toContainText(`Anfitrião${CARLA.name}`);
    await expect(block).toContainText(`G12${PEDRO.name}`);
    await expect(block).toContainText("TipoEvangelística");

    const participants = dialog.getByRole("group", { name: "Participantes" });
    await expect(participants.getByRole("listitem")).toHaveText([ANDRE.name, CAIO.name, CARLA.name]);
    await expect(participants.getByText("Participantes: 3")).toBeVisible();

    for (const name of ["Célula realizada", "Não houve célula"]) {
      const option = await dialog.locator("label").filter({ hasText: name }).boundingBox();
      expect(option?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    }
    const add = await dialog.getByRole("button", { name: "Adicionar visitante" }).boundingBox();
    expect(add?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  } finally {
    await carla.close();
  }
});

test("UX-25 e UX-19: enviar sem tema e sem oferta mostra os dois erros e o resumo, sem nenhuma chamada", async ({ page }) => {
  await signIn(page, CARLA);
  const calls = trackSubmits(page);
  await page.getByRole("button", { name: "Novo relatório" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  await dialog.getByLabel("Tema *").fill("   ");
  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(dialog.getByText("Informe o tema ministrado.")).toBeVisible();
  await expect(dialog.getByText("Informe a oferta. Se não houve oferta, informe R$ 0,00.")).toBeVisible();
  await expect(dialog.getByText("Confira os campos destacados (2).")).toBeVisible();
  await expect(dialog.getByLabel("Tema *")).toBeFocused();
  expect(calls).toEqual([]);
});

test("UX-20, UX-21, UX-23 e UX-24: Pedro escolhe Gabriel e Fábio (inativo), os visitantes e a oferta digitada pelos centavos; o servidor grava o que a tela mostra", async ({ page }) => {
  await signIn(page, PEDRO);
  const calls = trackSubmits(page);
  await openList(page, "/cells", NAME);
  await newReportButton(page, ANDRE).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  await dialog.getByLabel("Tema *").fill("A fé que vence");

  const select = dialog.getByLabel("Outros participantes");
  await select.click();
  await select.fill("Gabriel");
  await page.getByRole("option", { name: GABRIEL.name, exact: true }).click();
  await select.fill("Fábio");
  await page.getByRole("option", { name: `${FABIO.name} (inativo)` }).click();
  await select.fill("Caio");
  // O timóteo já entra automaticamente: desabilitado, com o motivo (P103).
  await expect(page.getByRole("option", { name: new RegExp(`^${CAIO.name}.*Já entra automaticamente\\.`) })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(dialog.getByText("Participantes: 5")).toBeVisible();
  await expect(dialog.getByRole("button", { name: `Retirar ${FABIO.name} (inativo)` })).toBeVisible();

  const visitors = dialog.getByRole("group", { name: "Visitantes" });
  await visitors.getByLabel("Nome do visitante 1").fill("  João   Silva ");
  await visitors.getByLabel("Nome do visitante 1").press("Enter");
  await expect(visitors.getByLabel("Nome do visitante 2")).toBeFocused();
  await visitors.getByLabel("Nome do visitante 2").press("Enter");
  await expect(visitors.getByLabel("Nome do visitante 3")).toHaveCount(0);
  await visitors.getByRole("button", { name: "Adicionar visitante" }).click();
  await visitors.getByLabel("Nome do visitante 3").fill("Maria");
  await visitors.getByRole("button", { name: "Adicionar visitante" }).click();
  await visitors.getByLabel("Nome do visitante 4").fill("Maria");
  await expect(visitors.getByText("Visitantes: 3")).toBeVisible();
  const remove = await visitors.getByRole("button", { name: "Retirar o visitante João Silva" }).boundingBox();
  expect(remove && [Math.round(remove.width), Math.round(remove.height)]).toEqual([36, 36]);

  const offering = dialog.getByLabel("Oferta *");
  await expect(offering).toHaveAttribute("inputmode", "numeric");
  await offering.pressSequentially("3750");
  await expect(offering).toHaveValue("37,50");

  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(toast(page, "Relatório enviado.")).toBeVisible();
  expect(calls).toEqual(["submit_cell_report"]);
  const id = reportOf(1);
  expect(participantsOf(id)).toBe("5");
  expect(q(`SELECT array_to_string(visitors, '|') || '#' || offering::text FROM public.cell_reports WHERE id = ${lit(id)}`)).toBe(
    "João Silva|Maria|Maria#37.50",
  );
});

test("UX-18 e RN-09: 'Não houve célula' mostra a reunião prevista e o Motivo, avisa o que não vai e grava sem participantes", async ({ page }) => {
  await signIn(page, CAIO);
  await openList(page, "/cells", NAME);
  await newReportButton(page, ANDRE).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  await dialog.getByLabel("Tema *").fill("Tema que não vai");
  await dialog.getByText("Não houve célula", { exact: true }).click();
  await expect(dialog.getByText(/^Ao enviar, o tema/)).toBeVisible();
  await expect(dialog.getByText(/^Reunião prevista: /)).toBeVisible();
  await expect(dialog.getByLabel("Tema *")).toHaveCount(0);
  await expect(dialog.getByRole("group", { name: "Participantes" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(dialog.getByText("Informe o motivo de não ter havido célula.")).toBeVisible();
  await dialog.getByLabel("Motivo *").fill("Feriado");
  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(toast(page, "Relatório enviado.")).toBeVisible();
  const id = reportOf(1);
  expect(q(`SELECT was_held::text || '|' || coalesce(theme, '<nulo>') || '|' || reason_not_held FROM public.cell_reports WHERE id = ${lit(id)}`)).toBe(
    "false|<nulo>|Feriado",
  );
  expect(participantsOf(id)).toBe("0");
});

test("UX-09 e UX-13: com o relatório da semana, Carla vê o aviso sem campos; Pedro vê 'Editar relatório', que troca o diálogo pela edição, e ao fechar o foco volta", async ({ browser }) => {
  q(`BEGIN; SET LOCAL mci.cell_report_write = 'on';
     INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme, visitors, offering)
     VALUES (${lit(cellId(1))}, public.sp_today(), '00:00', true, 'Tema da semana', '{}', 0); COMMIT;`);
  const carla = await sessionOf(browser, CARLA);
  const pedro = await sessionOf(browser, PEDRO);
  try {
    await carla.page.getByRole("button", { name: "Novo relatório" }).click();
    const dialog = carla.page.getByRole("dialog", { name: "Novo relatório" });
    const notice = dialog.getByRole("status").filter({ hasText: "O relatório para esta semana já foi enviado." });
    await expect(notice).toBeVisible();
    await expect(notice).toBeFocused();
    await expect(notice).toContainText("· Célula realizada.");
    await expect(notice.getByRole("button", { name: "Editar relatório" })).toHaveCount(0);
    await expect(dialog.getByLabel("Tema *")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Enviar relatório" })).toHaveCount(0);

    const page = pedro.page;
    await openList(page, "/cells", NAME);
    const opener = newReportButton(page, ANDRE);
    await opener.click();
    const form = page.getByRole("dialog", { name: "Novo relatório" });
    await form.getByRole("button", { name: "Editar relatório" }).click();
    const edit = page.getByRole("dialog", { name: "Editar relatório" });
    await expect(edit.getByLabel("Tema *")).toHaveValue("Tema da semana");
    await expect(edit.getByRole("heading", { name: "Editar relatório" }).locator("span")).toBeFocused();
    await expect(edit.getByText("Líder, timóteo, anfitrião e tipo registrados no envio.")).toBeVisible();
    await edit.getByRole("button", { name: "Cancelar" }).click();
    await expect(edit).toBeHidden();
    await expect(opener).toBeFocused();
  } finally {
    await carla.close();
    await pedro.close();
  }
});

test("UX-29 e P-REL-29: sem conexão, a mensagem fica no rodapé com os dados; de volta, o mesmo envio grava um relatório só", async ({ page }) => {
  await signIn(page, CARLA);
  await page.getByRole("button", { name: "Novo relatório" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  await dialog.getByLabel("Tema *").fill("Fé");
  await dialog.getByLabel("Oferta *").fill("0");
  await page.context().setOffline(true);
  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Não foi possível enviar o relatório. Verifique a conexão e tente de novo." })).toBeVisible();
  await expect(dialog.getByLabel("Tema *")).toHaveValue("Fé");
  await expect(dialog.getByRole("button", { name: "Enviar relatório" })).toBeFocused();
  await page.context().setOffline(false);
  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(toast(page, "Relatório enviado.")).toBeVisible();
  expect(q(`SELECT count(*) FROM public.cell_reports WHERE cell_id = ${lit(cellId(1))}`)).toBe("1");
});

test("UX-28 e AQ-4: com a primeira tentativa gravada e a resposta perdida, a segunda é o mesmo envio: 'Relatório enviado.' e um relatório só", async ({ page }) => {
  await signIn(page, CARLA);
  await page.getByRole("button", { name: "Novo relatório" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  await dialog.getByLabel("Tema *").fill("Fé");
  await dialog.getByLabel("Oferta *").fill("0");
  let first = true;
  await page.route("**/rest/v1/rpc/submit_cell_report", async (route) => {
    if (!first) return route.continue();
    first = false;
    await route.fetch();
    await route.abort("connectionreset");
  });
  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Não foi possível enviar o relatório." })).toBeVisible();
  expect(q(`SELECT count(*) FROM public.cell_reports WHERE cell_id = ${lit(cellId(1))}`)).toBe("1");
  await dialog.getByRole("button", { name: "Enviar relatório" }).click();
  await expect(toast(page, "Relatório enviado.")).toBeVisible();
  expect(q(`SELECT count(*) FROM public.cell_reports WHERE cell_id = ${lit(cellId(1))}`)).toBe("1");
});

test("UX-32 e UX-33: Pedro edita o relatório depois de Rita trocar o timóteo de C1: o bloco é o retrato; passar para 'Não houve célula' avisa o que sai e grava", async ({ page }) => {
  q(`BEGIN; SET LOCAL mci.cell_report_write = 'on';
     INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme, visitors, offering, observations)
     VALUES (${lit(cellId(1))}, public.sp_today(), '00:00', true, 'Tema registrado', ARRAY['João', 'Maria'], 50, 'Obs'); COMMIT;`);
  const id = reportOf(1);
  q(`BEGIN; SET LOCAL mci.cell_report_write = 'on';
     INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
       (${lit(id)}, ${lit(memberId(ANDRE))}), (${lit(id)}, ${lit(memberId(CAIO))}), (${lit(id)}, ${lit(memberId(CARLA))}), (${lit(id)}, ${lit(memberId(GABRIEL))}); COMMIT;`);
  q(`UPDATE public.cells SET timothy_id = ${lit(memberId(GABRIEL))}, type = 'Discipulado' WHERE id = ${lit(cellId(1))};`);

  await signIn(page, PEDRO);
  await openList(page, "/cell-reports", NAME);
  await page.getByRole("button", { name: new RegExp(`^Editar o relatório de .* da célula de ${ANDRE.name}$`) }).click();
  const dialog = page.getByRole("dialog", { name: "Editar relatório" });
  const block = dialog.getByRole("region", { name: "Dados da célula" });
  await expect(block).toContainText(`Timóteo${CAIO.name}`);
  await expect(block).toContainText("TipoEvangelística");
  await expect(block).toContainText("Líder, timóteo, anfitrião e tipo registrados no envio.");
  const participants = dialog.getByRole("group", { name: "Participantes" });
  await expect(participants.getByText("O líder, o timóteo e o anfitrião registrados no relatório não podem ser retirados dos participantes.")).toBeVisible();
  await expect(participants.getByRole("listitem")).toHaveText([ANDRE.name, CAIO.name, CARLA.name]);
  await expect(participants.getByText("Participantes: 4")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Salvar alterações" })).toBeVisible();

  await dialog.getByText("Não houve célula", { exact: true }).click();
  await expect(
    dialog.getByText("Ao salvar, saem do relatório: o tema, 4 participantes, 2 visitantes, a oferta (R$ 50,00) e as observações."),
  ).toBeVisible();
  await dialog.getByLabel("Motivo *").fill("Chuva forte");
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(toast(page, "Relatório atualizado.")).toBeVisible();
  expect(q(`SELECT was_held::text || '|' || coalesce(theme, '<nulo>') || '|' || reason_not_held FROM public.cell_reports WHERE id = ${lit(id)}`)).toBe(
    "false|<nulo>|Chuva forte",
  );
  expect(participantsOf(id)).toBe("0");
});
