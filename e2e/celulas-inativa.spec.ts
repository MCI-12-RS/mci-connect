import { expect, test } from "@playwright/test";
import { openList, toast } from "./exclusao-support";
import {
  ANDRE,
  CAIO,
  CARLA,
  CellsWorld,
  NAME,
  PEDRO,
  editCellButton,
  newReportButton,
  pickPerson,
  sessionOf,
  signIn,
} from "./celulas-support";

// Célula inativa na lista, no relatório e no atalho do Dashboard (E2.08, PR 4,
// tarefa 12): UX-21, UX-22, UX-23 e os critérios da RN-11 (c) pela tela.
// Rodar com `--workers=1` (a `sign_in_throttle` é por origem).

const world = new CellsWorld();

test.beforeAll(async () => world.setUp());
test.afterAll(async () => world.tearDown());
test.beforeEach(() => world.resetCells());

const INACTIVE_TO_EDITOR = "Esta célula está inativa e não recebe relatórios. Para enviar um relatório, reative a célula.";
const INACTIVE_TO_MEMBER =
  "Esta célula está inativa e não recebe relatórios. Se ela voltou a se reunir, peça à sua liderança para reativá-la.";

test("UX-21: Pedro inativa C1 pela tela: 'Inativa' com ícone e sem 'Novo relatório', ações no mesmo lugar; reativada, volta", async ({ browser }) => {
  const pedro = await sessionOf(browser, PEDRO, { width: 1280, height: 800 });
  const carla = await sessionOf(browser, CARLA, { width: 360, height: 800 });
  try {
    const { page } = pedro;
    await openList(page, "/cells", NAME);
    await editCellButton(page, ANDRE).click();
    const dialog = page.getByRole("dialog", { name: /^Editar célula/ });
    await dialog.getByRole("switch", { name: "Célula ativa" }).click();
    await expect(dialog.getByText("Ao salvar, a célula fica inativa. Os relatórios que ela já tem continuam.")).toBeVisible();
    await dialog.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(toast(page, "Célula inativada.")).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(world.cellValue(1, "is_active")).toBe("false");

    // Sem recarregar a página: a linha de C1 com "Inativa" e sem "Novo relatório"; C2 continua com ele.
    const row = page.getByRole("row").filter({ has: editCellButton(page, ANDRE) });
    await expect(row.getByText("Inativa", { exact: true })).toBeVisible();
    await expect(row.locator("svg.lucide-circle-pause, svg.lucide-pause-circle")).toHaveCount(1);
    await expect(newReportButton(page, ANDRE)).toHaveCount(0);
    await expect(newReportButton(page, CAIO)).toBeVisible();
    // P65: "Editar" e "Excluir" na mesma posição horizontal nas duas linhas.
    const edit1 = await editCellButton(page, ANDRE).boundingBox();
    const edit2 = await editCellButton(page, CAIO).boundingBox();
    expect(Math.abs(edit1!.x - edit2!.x), "Editar alinhado").toBeLessThan(1);

    // Carla, no celular: o cartão de C1 com "Inativa" e sem "Novo relatório".
    await openList(carla.page, "/cells", NAME);
    await expect(carla.page.getByText("Inativa").first()).toBeVisible();
    await expect(newReportButton(carla.page, ANDRE)).toHaveCount(0);

    // Reativada, C1 volta a ter "Novo relatório".
    await editCellButton(page, ANDRE).click();
    await dialog.getByRole("switch", { name: "Célula ativa" }).click();
    await expect(dialog.getByText("Ao salvar, a célula volta aos totais e a receber relatórios a partir desta semana.")).toBeVisible();
    await dialog.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(toast(page, "Célula reativada.")).toBeVisible();
    await expect(newReportButton(page, ANDRE)).toBeVisible();
  } finally {
    await pedro.close();
    await carla.close();
  }
});

test("UX-22: depois de inativar C1, o seletor de célula do relatório não a oferece, sem recarregar a página", async ({ page }) => {
  await signIn(page, PEDRO);
  await openList(page, "/cell-reports", NAME);
  world.setCellActive(1, false);
  await page.getByRole("button", { name: "Novo relatório" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  const cell = dialog.getByLabel("Célula *");
  await cell.click();
  await cell.pressSequentially(NAME);
  await expect(page.getByRole("option", { name: new RegExp(`^${CAIO.name} · `) })).toBeVisible();
  await expect(page.getByRole("option", { name: new RegExp(`^${ANDRE.name} · `) })).toHaveCount(0);
});

test("UX-23 e RN-11 (c): aberto pela lista, Carla recebe a recusa no topo com a orientação, os dados ficam e 'Fechar' volta à lista atualizada", async ({ page }) => {
  world.meetingAlreadyHappened(1);
  await signIn(page, CARLA);
  await openList(page, "/cells", NAME);
  await newReportButton(page, ANDRE).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  await dialog.getByLabel("Tema *").fill("Fé que move montanhas");
  await dialog.getByLabel("Oferta *").fill("0");
  world.setCellActive(1, false);

  await dialog.getByRole("button", { name: "Enviar relatório" }).click();

  const alert = dialog.getByRole("alert").filter({ hasText: INACTIVE_TO_MEMBER });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(dialog.getByLabel("Tema *")).toHaveValue("Fé que move montanhas");
  await expect(page.locator("li[role='status']")).toHaveCount(0);
  expect(world.reportsOfCell(1)).toBe(0);

  // Com a célula fixa, o rodapé tem só "Fechar" (T7), que fecha e recarrega a lista.
  await expect(dialog.getByRole("button", { name: "Enviar relatório" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fechar" }).last().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Inativa").first()).toBeVisible();
  await expect(newReportButton(page, ANDRE)).toHaveCount(0);
});

test("UX-23: aberto por Relatórios, Pedro (com 'Editar Célula') recebe a orientação de reativar, e a célula fica desmarcada", async ({ page }) => {
  world.meetingAlreadyHappened(1);
  await signIn(page, PEDRO);
  await openList(page, "/cell-reports", NAME);
  await page.getByRole("button", { name: "Novo relatório" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo relatório" });
  await pickPerson(page, dialog.getByLabel("Célula *"), ANDRE.name, new RegExp(`^${ANDRE.name} · `));
  await dialog.getByLabel("Tema *").fill("Fé");
  await dialog.getByLabel("Oferta *").fill("0");
  world.setCellActive(1, false);

  await dialog.getByRole("button", { name: "Enviar relatório" }).click();

  await expect(dialog.getByRole("alert").filter({ hasText: INACTIVE_TO_EDITOR })).toBeVisible();
  // A célula fica desmarcada (T3 c): o seletor volta à dica, e o bloco some.
  await expect(dialog.getByText("Escolha a célula para preencher o relatório.")).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Dados da célula" })).toHaveCount(0);
  expect(world.reportsOfCell(1)).toBe(0);
});

test("RN-11 (c): o atalho 'Novo relatório' do Dashboard de Carla some com C1 inativa e volta com ela ativa", async ({ page }) => {
  await signIn(page, CARLA);
  await expect(page.getByRole("button", { name: "Novo relatório" })).toBeVisible();
  world.setCellActive(1, false);
  await page.reload();
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo relatório" })).toHaveCount(0);
  world.setCellActive(1, true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Novo relatório" })).toBeVisible();
});
