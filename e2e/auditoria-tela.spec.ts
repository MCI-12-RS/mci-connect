import { test, expect, type Page } from "@playwright/test";
import { adminMemberName, callRpc, createAuthUser, deleteAuthUser, e2eEnv, lit, login, sql, type E2EEnv } from "./exclusao-support";

// E2.05 (PR 4, Auditoria nova), na stack local, pela tela:
//   - RN-18, UX-11, UX-13: 12 mil eventos paginados no servidor, com o total, a última página com o mais
//     antigo e a busca sem acento além dos 500 mais recentes;
//   - UX-12, UX-14: o estado na URL e o período pela data de Brasília (o dia do "Até" incluído);
//   - UX-15, UX-16, UX-17: filtros no celular, cards sem rolagem lateral, tabela com teclado;
//   - RN-19, UX-22, UX-24: o histórico de um registro, com a exclusão e a restauração;
//   - RN-15, UX-20: os eventos de função; RN-20, UX-19: o painel legível, com eventos reais;
//   - RN-17, UX-25: a nota de guarda; UX-26: sem "Visualizar Auditoria", a tela sem acesso.
// Massa fictícia "Aud Tela …" (membros, função e eventos), apagada no começo e no fim. Em série.

test.describe.configure({ mode: "serial" });
test.use({ timezoneId: "America/Sao_Paulo" });

const NAME = "Aud Tela";
const VOLUME = "Volume Aud Tela";
const PERIOD = "Periodo Aud Tela";
const ROLE_NAME = `${NAME} Função`;
const PREFIX = "e2e205d4";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;
const HIST = { id: id(1, 1), name: `${NAME} Igor`, mobile: "51977750001" };
const LEADER2 = { id: id(1, 2), name: `${NAME} Pedro`, mobile: "51977750002" };
const LEADER_USER = { email: "e2e205d4-lider@example.com", password: "AudTela2026x", name: `${NAME} Bruno`, mobile: "51977750003" };
const VOLUME_COUNT = 12000;

let env: E2EEnv;
let admin = "";
let leaderUserId = "";

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_label LIKE '%${NAME}%' OR description LIKE '%${NAME}%' OR entity_id IN (${lit(HIST.id)}, ${lit(LEADER2.id)});
     DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE name LIKE '${NAME}%');
     DELETE FROM public.roles WHERE name LIKE '${NAME}%';
     DELETE FROM public.members WHERE name LIKE '${NAME}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
     COMMIT;
     SELECT private.rebuild_member_hierarchy();`,
  );
}

async function seed() {
  const adminId = sql(env, `SELECT m.id FROM public.members m JOIN auth.users u ON u.id = m.auth_user_id WHERE u.email = ${lit(env.admin.email)}`);
  const member = (p: { id: string; name: string; mobile: string }) =>
    `(${lit(p.id)}, ${lit(p.name)}, 'M', false, true, ${lit(adminId)}, true, ${lit(p.mobile)}, (SELECT id FROM public.roles WHERE is_default))`;
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, role_id)
     VALUES ${member(HIST)}, ${member(LEADER2)};
     -- Uma alteração de verdade (o trigger grava o evento com os nomes): o líder e o celular.
     UPDATE public.members SET leader_id = ${lit(LEADER2.id)}, mobile_whatsapp = '51977750009' WHERE id = ${lit(HIST.id)};
     -- 12 mil eventos antigos, o mais antigo com "Otávio" (RN-18), como o postgres grava (só ele escreve em events).
     INSERT INTO public.events (occurred_at, actor_kind, actor_label, action, entity, entity_id, entity_label, description, success)
     SELECT timestamptz '2026-01-01 12:00:00+00' + make_interval(mins => n), 'system', NULL, 'update', 'member', NULL,
            CASE WHEN n = 1 THEN '${VOLUME} Otávio' ELSE '${VOLUME} ' || n END,
            'Alterou o membro ' || CASE WHEN n = 1 THEN '${VOLUME} Otávio' ELSE '${VOLUME} ' || n END, true
       FROM generate_series(1, ${VOLUME_COUNT}) AS n;
     -- O período: 15/11/2026 às 23:59 e 16/11/2026 às 00:01, em Brasília.
     INSERT INTO public.events (occurred_at, actor_kind, action, entity, entity_label, description, success)
     VALUES ('2026-11-16 02:59:00+00', 'system', 'update', 'member', '${PERIOD} Dentro', 'Alterou o membro ${PERIOD} Dentro', true),
            ('2026-11-16 03:01:00+00', 'system', 'update', 'member', '${PERIOD} Fora', 'Alterou o membro ${PERIOD} Fora', true);`,
  );
  leaderUserId = await createAuthUser(env, LEADER_USER.email, LEADER_USER.password);
  sql(
    env,
    `INSERT INTO public.members (id, auth_user_id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, email, role_id)
     VALUES (${lit(leaderUserId)}, ${lit(leaderUserId)}, ${lit(LEADER_USER.name)}, 'M', false, true, ${lit(adminId)}, true,
             ${lit(LEADER_USER.mobile)}, ${lit(LEADER_USER.email)}, (SELECT id FROM public.roles WHERE NOT is_system AND name = 'Líder'));`,
  );
}

const status = (page: Page) => page.locator("main").getByRole("status").first();
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test.beforeAll(async () => {
  env = e2eEnv();
  const stale = sql(env, `SELECT coalesce((SELECT id::text FROM auth.users WHERE email = ${lit(LEADER_USER.email)}), '')`);
  cleanup();
  if (stale) await deleteAuthUser(env, stale);
  await seed();
  admin = adminMemberName(env);
});
test.afterAll(async () => {
  if (!env) return;
  cleanup();
  if (leaderUserId) await deleteAuthUser(env, leaderUserId);
});

test("RN-18, UX-11 e UX-13: 12.000 eventos, a última página com o mais antigo e a busca sem acento além dos 500 mais recentes", async ({ page }) => {
  await login(page, env.admin);
  await page.goto(`/events?q=${encodeURIComponent(VOLUME)}`);
  await expect(status(page)).toHaveText("12.000 eventos");
  await expect(page.getByText("Página 1 de 480")).toBeVisible();
  await page.getByRole("button", { name: "Última página" }).click();
  await expect(page).toHaveURL(/page=480/);
  await expect(page.getByRole("row").last()).toContainText(`${VOLUME} Otávio`);

  await page.goto("/events");
  await page.getByRole("searchbox", { name: "Buscar" }).fill("otavio aud tela");
  await expect(page).toHaveURL(/q=otavio/);
  await expect(status(page)).toHaveText("1 evento");
  await expect(page.getByRole("button", { name: `Alterou o membro ${VOLUME} Otávio` })).toBeVisible();
});

test("UX-12 e UX-14: o estado na URL e o período de Brasília, com o dia do 'Até' incluído", async ({ page }) => {
  await login(page, env.admin);
  await page.goto(`/events?q=${encodeURIComponent(PERIOD)}&from=2026-11-15&to=2026-11-15&action=update&entity=member&status=success`);
  await expect(status(page)).toHaveText("1 evento");
  await expect(page.getByRole("row").filter({ hasText: `${PERIOD} Dentro` })).toContainText("15/11/2026 23:59");
  await expect(page.getByText(`${PERIOD} Fora`)).toHaveCount(0);
  await page.reload();
  await expect(status(page)).toHaveText("1 evento");
  await expect(page.getByRole("combobox", { name: "Ação" })).toHaveText("Alteração");
  await expect(page.getByRole("combobox", { name: "Entidade" })).toHaveText("Membro");
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveText("Sucesso");
  const period = page.getByRole("group", { name: "Período" });
  await expect(period.getByLabel("De")).toHaveValue("2026-11-15");

  // "Até" antes de "De": o erro, com o foco no campo, sem consultar.
  await period.getByLabel("Até").fill("2026-11-10");
  await expect(page.getByText("O fim do período precisa ser igual ou posterior ao início.")).toBeVisible();
  await expect(page).toHaveURL(/to=2026-11-15/);

  // Um valor inválido sai da URL; mudar o tamanho volta para a página 1.
  await page.goto(`/events?q=${encodeURIComponent(VOLUME)}&action=atualizar&page=3`);
  await expect(page).not.toHaveURL(/action=/);
  await page.getByRole("combobox", { name: "Itens por página" }).click();
  await page.getByRole("option", { name: "50" }).click();
  await expect(page).toHaveURL(/size=50/);
  await expect(page).not.toHaveURL(/page=/);
});

test("UX-15 e UX-16: no celular, 'Filtros' com o painel e os chips; cards de 44 px, sem rolagem lateral em 360 e 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, env.admin);
  await page.goto(`/events?q=${encodeURIComponent(NAME)}`);
  await expect(page.getByTestId("audit-event-cards")).toBeVisible();
  expect(await noHorizontalScroll(page), "360 px sem rolagem lateral").toBe(true);
  const firstCard = page.getByTestId("audit-event-cards").getByRole("button").first();
  expect((await firstCard.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("combobox", { name: "Ação" })).toHaveCount(0);

  const filters = page.getByRole("button", { name: "Filtros", exact: true });
  expect((await filters.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await filters.click();
  const sheet = page.getByRole("dialog", { name: "Filtros" });
  await sheet.getByRole("combobox", { name: "Entidade" }).click();
  await page.getByRole("option", { name: "Membro" }).click();
  await expect(page).not.toHaveURL(/entity=/);
  await sheet.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/entity=member/);
  await expect(page.getByRole("button", { name: "Filtros (1)" })).toBeFocused();
  const chip = page.getByRole("button", { name: "Remover filtro Entidade: Membro" });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).not.toHaveURL(/entity=/);
  await expect(page.getByRole("button", { name: "Filtros", exact: true })).toBeFocused();

  await page.setViewportSize({ width: 320, height: 640 });
  expect(await noHorizontalScroll(page), "320 px sem rolagem lateral").toBe(true);

  await firstCard.click();
  const panel = page.getByRole("dialog", { name: "Detalhes do evento" });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "o painel sem rolagem lateral").toBe(true);
  await page.keyboard.press("Escape");
  await expect(firstCard).toBeFocused();
});

test("UX-17, UX-19, RN-20 e UX-24: a tabela pelo teclado e o painel legível de um evento real, com o histórico", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, env.admin);
  await page.goto(`/events?q=${encodeURIComponent(HIST.name)}&action=update`);
  const table = page.getByTestId("audit-event-table");
  await expect(table.getByRole("columnheader")).toHaveText(["Data/Hora", "Autor", "Ação", "Entidade", "Descrição", "Status"]);
  expect(await noHorizontalScroll(page)).toBe(true);
  const row = table.getByRole("row").filter({ hasText: `Alterou o membro ${HIST.name}` });
  await expect(row).toContainText("Sistema");
  // Na ordem da lista de campos (P32): o celular vem antes do líder.
  await expect(row).toContainText("Celular/WhatsApp, Líder");

  const open = row.getByRole("button", { name: `Alterou o membro ${HIST.name}` });
  await open.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Detalhes do evento" });
  await expect(panel).toBeVisible();
  await expect(panel.locator("li").filter({ hasText: /^Líder:/ })).toContainText(`Líder: ${admin} → ${LEADER2.name}`);
  await expect(panel.locator("li").filter({ hasText: "Celular/WhatsApp" })).toHaveText("Celular/WhatsApp");
  const text = (await page.locator("body").innerText()) ?? "";
  for (const technical of ["leader_id", "mobile_whatsapp", "Metadados", "Atualização", "{"]) expect(text).not.toContain(technical);
  expect(text).not.toMatch(UUID_LIKE);

  await panel.getByRole("link", { name: "Ver histórico deste membro" }).click();
  await expect(page).toHaveURL(new RegExp(`/events\\?record_type=member&record_id=${HIST.id}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: `Histórico de ${HIST.name}` })).toBeVisible();
});

test("RN-19 e UX-22: o histórico de um membro com a exclusão e a restauração; só Ação e Período; o link direto e o recarregar", async ({ page }) => {
  await login(page, env.admin);
  expect((await callRpc(page, env, "delete_member", { _member_id: HIST.id })).status).toBeLessThan(300);
  expect((await callRpc(page, env, "restore_member", { _member_id: HIST.id })).status).toBeLessThan(300);

  await page.goto(`/events?record_type=member&record_id=${HIST.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Histórico de ${HIST.name}` })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver toda a Auditoria" })).toHaveAttribute("href", "/events");
  await expect(page.getByTestId("retention-note")).toBeVisible();
  await expect(status(page)).toHaveText("4 eventos");
  const rows = page.getByTestId("audit-event-table").getByRole("row");
  await expect(rows.nth(1)).toContainText("Restauração");
  await expect(rows.nth(2)).toContainText("Exclusão");
  await expect(rows.nth(3)).toContainText("Alteração");
  await expect(rows.nth(4)).toContainText("Criação");
  await expect(rows.nth(1)).toContainText(admin);
  await expect(page.getByRole("combobox", { name: "Entidade" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Ação" }).click();
  await expect(page.getByRole("option")).toHaveText(["Todas", "Criação", "Alteração", "Exclusão", "Restauração"]);
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `Histórico de ${HIST.name}` })).toBeVisible();
  await expect(status(page)).toHaveText("4 eventos");
});

test("RN-15 e UX-20: criar e alterar uma função aparecem na Auditoria, com as permissões pelos rótulos", async ({ page }) => {
  await login(page, env.admin);
  const created = await callRpc(page, env, "save_role", {
    _role_id: null,
    _name: ROLE_NAME,
    _description: null,
    _permissions: ["view_dashboard", "edit_member"],
    _is_default: false,
  });
  expect(created.status).toBe(200);
  const roleId = typeof created.body === "string" ? created.body : "";
  const updatedAt = sql(env, `SELECT updated_at::text FROM public.roles WHERE id = ${lit(roleId)}`);
  const changed = await callRpc(page, env, "save_role", {
    _role_id: roleId,
    _name: `${ROLE_NAME} Nova`,
    _description: null,
    _permissions: ["view_dashboard", "view_sensitive_data"],
    _is_default: false,
    _expected_updated_at: updatedAt,
  });
  expect(changed.status).toBe(200);

  await page.goto(`/events?entity=role&q=${encodeURIComponent(ROLE_NAME)}`);
  await expect(page.getByRole("row").filter({ hasText: `Criou a função ${ROLE_NAME}` })).toContainText("2 permissões");
  const update = page.getByRole("row").filter({ hasText: "Alterou a função" });
  await expect(update).toContainText("Nome · 1 permissão incluída · 1 permissão retirada");
  await update.getByRole("button").click();
  const panel = page.getByRole("dialog", { name: "Detalhes do evento" });
  await expect(panel.locator("li").filter({ hasText: /^Nome:/ })).toContainText(`Nome: ${ROLE_NAME} → ${ROLE_NAME} Nova`);
  await expect(panel).toContainText("Permissões incluídas");
  await expect(panel).toContainText("Ver Dados Sensíveis");
  await expect(panel).toContainText("Permissões retiradas");
  await expect(panel).toContainText("Editar Membro");
  await expect(panel).not.toContainText("view_sensitive_data");
  await expect(panel.getByRole("link")).toHaveCount(0);
});

test("RN-17, UX-25 e UX-26: a nota de guarda; sem 'Visualizar Auditoria', a tela sem acesso, sem nenhum evento e sem consultar", async ({ page }) => {
  await login(page, env.admin);
  await page.goto("/events");
  await expect(page.getByTestId("retention-note")).toHaveText(
    "Os eventos ficam guardados por 2 anos. Login e logout, por 1 ano. Falhas, recusas e bloqueios, por 90 dias.",
  );
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());

  await login(page, { email: LEADER_USER.email, password: LEADER_USER.password });
  const eventRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/events")) eventRequests.push(request.url());
  });
  await page.goto("/events?action=update&record_type=member");
  await expect(page).toHaveURL(/\/events/);
  await expect(page.getByRole("heading", { level: 1, name: "Auditoria" })).toBeVisible();
  await expect(page.getByText("Você não tem acesso a esta tela.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ir para o início" })).toBeVisible();
  await expect(page.getByTestId("audit-event-table")).toHaveCount(0);
  await expect(page.getByTestId("audit-event-cards")).toHaveCount(0);
  expect(eventRequests).toEqual([]);
});
