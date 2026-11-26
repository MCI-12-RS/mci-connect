import { test, expect, type Page } from "@playwright/test";
import {
  callRpc,
  createAuthUser,
  deleteAuthUser,
  e2eEnv,
  expectDialogFitsSmallScreen,
  expectTouchTargets,
  largeFont,
  lit,
  login,
  openList,
  rpcAs,
  sql,
  toast,
  type E2EEnv,
} from "./exclusao-support";

// Exclusão lógica de membros (E2.01, PR 2): RN-02, RN-03, RN-04 e os
// critérios UX-01, UX-05, UX-07, UX-10 e UX-12, com as personas AD
// (Administrador), LE (exclui, sem "Gerenciar Funções", sem editar) e MB (sem
// permissão de excluir). Ver e2e/exclusao-support.ts para as variáveis.
//
// Cria a própria massa fictícia ("QA E2E Mem …", ids e2e201a0-…) e as contas
// de LE e MB, e apaga tudo no fim (também no começo, se uma execução anterior
// parou no meio). Os testes rodam em série, na ordem do arquivo.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e201a0";
const NAME = "QA E2E Mem";
const PASSWORD = "QaE2eMem#2026";
const id = (kind: number, n: number) => `${PREFIX}-${String(kind).padStart(4, "0")}-0000-0000-${String(n).padStart(12, "0")}`;
const member = (n: number) => id(1, n);
/** Celular único por cadastro da massa: todo cadastro novo precisa de um identificador (E2.04, RN-08). */
const mobileOf = (n: number) => `5193203${String(n).padStart(4, "0")}`;
const cell = (n: number) => id(2, n);
const report = (n: number) => id(3, n);
const role = (n: number) => id(4, n);

const LE = { email: "le.e2e-mem@teste.invalid", password: PASSWORD };
const MB = { email: "mb.e2e-mem@teste.invalid", password: PASSWORD };
const GIL = `${NAME} Gil Souza`;

let env: E2EEnv;
const authIds: { le?: string; mb?: string } = {};

function cleanup() {
  const actors = [authIds.le, authIds.mb].filter(Boolean).map((v) => lit(String(v)));
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_id::text LIKE '${PREFIX}%'
         OR entity_id IN (SELECT r.id FROM public.cell_reports r WHERE r.cell_id::text LIKE '${PREFIX}%')
         OR metadata ->> 'member_id' LIKE '${PREFIX}%'
         ${actors.length ? `OR actor_user_id IN (${actors.join(", ")})` : ""};
     DELETE FROM public.cell_report_participants
      WHERE member_id::text LIKE '${PREFIX}%'
         OR report_id IN (SELECT r.id FROM public.cell_reports r WHERE r.id::text LIKE '${PREFIX}%' OR r.cell_id::text LIKE '${PREFIX}%');
     DELETE FROM public.cell_reports WHERE id::text LIKE '${PREFIX}%' OR cell_id::text LIKE '${PREFIX}%';
     DELETE FROM public.cells WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     COMMIT;`,
  );
}

async function removeAccounts() {
  const ids = sql(env, `SELECT id FROM auth.users WHERE email IN (${lit(LE.email)}, ${lit(MB.email)})`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  authIds.le = await createAuthUser(env, LE.email, LE.password);
  authIds.mb = await createAuthUser(env, MB.email, MB.password);
  const pages = Array.from({ length: 11 }, (_, i) => `(${lit(member(21 + i))}, ${lit(`${NAME} Pag ${String(i + 1).padStart(2, "0")}`)}, 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(21 + i))})`);
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES
       (${lit(role(1))}, '${NAME} LE'), (${lit(role(2))}, '${NAME} MB'), (${lit(role(3))}, '${NAME} Membro');
     INSERT INTO public.role_permissions (role_id, permission)
     SELECT ${lit(role(1))}::uuid, p::public.permission_action FROM unnest(ARRAY['view_all_church', 'view_all_reports',
            'view_dashboard', 'edit_own_data', 'delete_member', 'delete_cell', 'delete_cell_report']) p
     UNION ALL
     SELECT ${lit(role(2))}::uuid, p::public.permission_action FROM unnest(ARRAY['view_all_church', 'view_all_reports',
            'view_dashboard', 'edit_own_data']) p
     UNION ALL SELECT ${lit(role(3))}::uuid, 'view_dashboard'::public.permission_action;
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, auth_user_id, role_id, email) VALUES
       (${lit(member(90))}, '${NAME} Lia Lopes', 'F', false, true, ${lit(authIds.le)}, ${lit(role(1))}, ${lit(LE.email)}),
       (${lit(member(91))}, '${NAME} Mauro Melo', 'M', false, true, ${lit(authIds.mb)}, ${lit(role(2))}, ${lit(MB.email)});
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id, mobile_whatsapp) VALUES
       (${lit(member(1))}, ${lit(GIL)}, 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(1))}),
       (${lit(member(6))}, '${NAME} Carlos Lima', 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(6))}),
       (${lit(member(7))}, '${NAME} Marcos Dias', 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(7))}),
       (${lit(member(8))}, '${NAME} Bruno Almeida', 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(8))}),
       (${lit(member(9))}, '${NAME} Nina Prado', 'F', false, true, ${lit(role(3))}, ${lit(mobileOf(9))}),
       (${lit(member(10))}, '${NAME} Otto Vaz', 'M', false, true, ${lit(role(3))}, ${lit(mobileOf(10))}),
       ${pages.join(",\n       ")};
     INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, role_id, mobile_whatsapp) VALUES
       (${lit(member(2))}, '${NAME} Hugo Lima', 'M', ${lit(member(1))}, true, true, ${lit(role(3))}, ${lit(mobileOf(2))}),
       (${lit(member(3))}, '${NAME} Ivo Reis', 'M', ${lit(member(1))}, true, true, ${lit(role(3))}, ${lit(mobileOf(3))}),
       (${lit(member(4))}, '${NAME} João Alves', 'M', ${lit(member(1))}, true, true, ${lit(role(3))}, ${lit(mobileOf(4))}),
       (${lit(member(5))}, '${NAME} Léo Martins', 'M', ${lit(member(1))}, true, false, ${lit(role(3))}, ${lit(mobileOf(5))});
     INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active, street, number) VALUES
       (${lit(cell(1))}, ${lit(member(6))}, ${lit(member(1))}, ${lit(member(6))}, 'Evangelística', 'Quarta', '20:00', true, 'Rua das Flores', '120'),
       (${lit(cell(2))}, ${lit(member(7))}, ${lit(member(7))}, ${lit(member(1))}, 'Discipulado', 'Sexta', '19:30', true, 'Rua do Sol', '45');
     UPDATE public.cells SET is_active = false WHERE id = ${lit(cell(2))};
     SET LOCAL session_replication_role = replica;
     INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held) VALUES
       (${lit(report(1))}, ${lit(cell(1))}, public.week_start(public.sp_today()) - 4, '20:00', '${NAME} tema', true);
     COMMIT;`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cells WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.cell_reports WHERE cell_id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email IN (${lit(LE.email)}, ${lit(MB.email)}))`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

const deletedAt = (memberId: string) => sql(env, `SELECT coalesce(deleted_at::text, '') FROM public.members WHERE id = ${lit(memberId)}`);

async function openDeletion(page: Page, name: string) {
  await openList(page, "/members", name);
  await page.getByRole("button", { name: `Excluir ${name}`, exact: true }).click();
  return page.getByRole("alertdialog");
}

test("RN-02 (MB): sem permissão de excluir, Membros, Células e Relatórios não mostram 'Excluir', e a API recusa com 42501 sem mudar nada", async ({
  page,
}) => {
  await login(page, MB);

  await openList(page, "/members", NAME);
  await expect(page.getByText(`${NAME} Bruno Almeida`)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Excluir/ })).toHaveCount(0);

  await openList(page, "/cells", NAME);
  await expect(page.getByText(`${NAME} Carlos Lima`).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Excluir/ })).toHaveCount(0);

  await openList(page, "/cell-reports", NAME);
  await expect(page.getByText(`${NAME} Carlos Lima`).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Excluir/ })).toHaveCount(0);

  await page.setViewportSize({ width: 360, height: 800 });
  await openList(page, "/members", NAME);
  await expect(page.getByText(`${NAME} Bruno Almeida`)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ações de/ })).toHaveCount(0);

  for (const [fn, args] of [
    ["delete_member", { _member_id: member(8) }],
    ["delete_cell", { _cell_id: cell(1) }],
    ["delete_cell_report", { _report_id: report(1) }],
  ] as const) {
    const { status, body } = await callRpc(page, env, fn, args);
    expect(status, fn).toBe(403);
    expect(body, fn).toMatchObject({ code: "42501", message: "Você não tem permissão para esta ação." });
  }
  expect(
    sql(
      env,
      `SELECT (SELECT count(*) FROM public.members WHERE id = ${lit(member(8))} AND deleted_at IS NULL)
            + (SELECT count(*) FROM public.cells WHERE id = ${lit(cell(1))} AND deleted_at IS NULL)
            + (SELECT count(*) FROM public.cell_reports WHERE id = ${lit(report(1))} AND deleted_at IS NULL)`,
    ),
  ).toBe("3");
});

test("RN-02 (LE) e UX-07: LE exclui Bruno, que não tem ligações; o aviso de inativar fica sem o botão; 'Cadastro excluído.' sem 'Desfazer', e a lista recarrega sem ele", async ({
  page,
}) => {
  const bruno = `${NAME} Bruno Almeida`;
  await login(page, LE);
  const dialog = await openDeletion(page, bruno);

  await expect(dialog.getByRole("heading", { name: `Excluir ${bruno}?` })).toBeVisible();
  await expect(dialog.getByText("Se a pessoa só deixou de frequentar, prefira marcá-la como inativa.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Marcar como inativo" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Excluir cadastro" }).click();

  await expect(toast(page, "Cadastro excluído.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Nenhum membro encontrado")).toBeVisible();
  expect(
    sql(env, `SELECT deleted_at IS NOT NULL AND deleted_by = ${lit(member(90))} FROM public.members WHERE id = ${lit(member(8))}`),
  ).toBe("t");
});

test("RN-03 (LE): sem 'Excluir' na própria linha; excluir a administradora é recusado com 'Você não tem permissão para excluir este membro.'", async ({
  page,
}) => {
  await login(page, LE);
  await openList(page, "/members", `${NAME} Lia`);
  await expect(page.getByRole("row", { name: new RegExp(`${NAME} Lia Lopes`) })).toBeVisible();
  await expect(page.getByRole("button", { name: `Excluir ${NAME} Lia Lopes` })).toHaveCount(0);

  const adminName = sql(env, `SELECT m.name FROM public.members m JOIN auth.users u ON u.id = m.auth_user_id WHERE u.email = ${lit(env.admin.email)}`);
  const dialog = await openDeletion(page, adminName);
  await expect(dialog.getByRole("heading", { name: `Não é possível excluir ${adminName}` })).toBeVisible();
  await expect(dialog).toContainText("Você não tem permissão para excluir este membro.");
  await expect(dialog.getByRole("button")).toHaveText(["Fechar"]);
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(dialog).toBeHidden();
  expect(sql(env, `SELECT count(*) FROM public.members m JOIN auth.users u ON u.id = m.auth_user_id WHERE u.email = ${lit(env.admin.email)} AND m.deleted_at IS NULL`)).toBe("1");
});

test("UX-10 (LE): sem edit_member e edit_cell, os itens do bloqueio de Gil são texto, sem botão", async ({ page }) => {
  await login(page, LE);
  const dialog = await openDeletion(page, GIL);
  await expect(dialog.getByRole("heading", { name: `Não é possível excluir ${GIL}` })).toBeVisible();
  await expect(dialog.getByText(`${NAME} Hugo Lima`)).toBeVisible();
  await expect(dialog.getByText(`Timóteo na célula de ${NAME} Carlos Lima, quarta, 20:00`)).toBeVisible();
  await expect(dialog.getByRole("button")).toHaveText(["Fechar"]);
});

test("RN-04 e UX-10 (AD): o bloqueio de Gil lista os 4 discípulos (Léo inativo) e as 2 células com papel, dia e hora; os itens abrem o cadastro e a célula; reatribuído Hugo, a nova verificação mostra só o que falta", async ({
  page,
}) => {
  await login(page, env.admin);
  let dialog = await openDeletion(page, GIL);

  await expect(dialog.getByRole("heading", { name: `Não é possível excluir ${GIL}` })).toBeVisible();
  await expect(dialog).toContainText("Antes, reatribua:");
  await expect(dialog.getByRole("heading", { name: "4 discípulos" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "2 células" })).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveText([
    `${NAME} Hugo Lima`,
    `${NAME} Ivo Reis`,
    `${NAME} João Alves`,
    `${NAME} Léo Martins (inativo)`,
    `Timóteo na célula de ${NAME} Carlos Lima, quarta, 20:00`,
    `Anfitrião na célula de ${NAME} Marcos Dias, sexta, 19:30 (inativa)`,
  ]);
  await expect(dialog).toContainText("Discípulos e células inativos também contam.");
  await expect(dialog.getByRole("button", { name: /^Excluir/ })).toHaveCount(0);

  // UX-10: a célula abre o formulário da célula.
  await dialog.getByRole("button", { name: `Timóteo na célula de ${NAME} Carlos Lima, quarta, 20:00` }).click();
  const cellForm = page.getByRole("dialog", { name: "Editar Célula" });
  await expect(cellForm).toBeVisible();
  await expect(cellForm.getByText(`${NAME} Carlos Lima`).first()).toBeVisible();
  await cellForm.getByRole("button", { name: "Cancelar" }).click();
  await expect(cellForm).toBeHidden();

  // UX-10: o discípulo abre o cadastro dele; F2: reatribuir o líder de Hugo.
  await page.getByRole("button", { name: `Excluir ${GIL}`, exact: true }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: `Abrir o cadastro de ${NAME} Hugo Lima` }).click();
  const memberForm = page.getByRole("dialog", { name: "Editar Membro" });
  await expect(memberForm.getByLabel("Nome *")).toHaveValue(`${NAME} Hugo Lima`);
  const leader = memberForm.getByLabel("Líder *", { exact: true });
  await leader.click();
  await leader.pressSequentially(`${NAME} Carlos`);
  await page.getByRole("option", { name: `${NAME} Carlos Lima` }).click();
  await memberForm.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
  await expect(memberForm).toBeHidden();
  expect(sql(env, `SELECT leader_id FROM public.members WHERE id = ${lit(member(2))}`)).toBe(member(6));

  await page.getByRole("button", { name: `Excluir ${GIL}`, exact: true }).click();
  dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "3 discípulos" })).toBeVisible();
  await expect(dialog).not.toContainText(`${NAME} Hugo Lima`);
  await dialog.getByRole("button", { name: "Fechar" }).click();
  expect(deletedAt(member(1))).toBe("");
});

test("UX-12 (360×640, fonte 200%): a confirmação e o bloqueio de membro rolam por dentro, com margem, texto à esquerda e botões alcançáveis", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await login(page, env.admin);

  await openList(page, "/members", `${NAME} Otto`);
  await largeFont(page);
  await page.getByRole("button", { name: `Ações de ${NAME} Otto Vaz` }).click();
  await page.getByRole("menuitem", { name: "Excluir cadastro" }).click();
  let dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Excluir cadastro" })).toBeEnabled();
  const confirm = await expectDialogFitsSmallScreen(page, dialog, ["Marcar como inativo", "Cancelar", "Excluir cadastro"], "confirmação de membro");
  expect(confirm.scrollHeight, "a confirmação de membro precisa rolar com a fonte em 200%").toBeGreaterThan(confirm.clientHeight);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();

  await openList(page, "/members", GIL);
  await largeFont(page);
  await page.getByRole("button", { name: `Ações de ${GIL}` }).click();
  await page.getByRole("menuitem", { name: "Excluir cadastro" }).click();
  dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: `Não é possível excluir ${GIL}` })).toBeVisible();
  const blocked = await expectDialogFitsSmallScreen(page, dialog, ["Fechar"], "bloqueio de membro");
  expect(blocked.scrollHeight, "o bloqueio precisa rolar com a fonte em 200%").toBeGreaterThan(blocked.clientHeight);
  expect(deletedAt(member(10))).toBe("");
});

test("UX-01 (360×800): em Membros, 'Excluir' fica só no '⋯' do card, e 'Editar' e '⋯' têm 44×44 px, a 8 px um do outro", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, env.admin);
  await openList(page, "/members", NAME);

  const menus = page.getByRole("button", { name: new RegExp(`^Ações de ${NAME}`) });
  await expect(menus.first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Excluir/ })).toHaveCount(0);
  const count = await menus.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) {
    const group = menus.nth(i).locator("xpath=..");
    await expect(group.getByRole("button", { name: /^Editar / })).toBeVisible();
    await expectTouchTargets(group, `card ${i + 1}`);
  }
  await menus.first().click();
  await expect(page.getByRole("menuitem", { name: "Excluir cadastro" })).toBeVisible();
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(hScroll).toBeLessThanOrEqual(360);
});

test("Acessibilidade (WCAG 2.4.3, AD): ao fechar a confirmação, o foco volta ao '⋯' no celular e ao ícone 'Excluir' no desktop; o cadastro aberto pelo bloqueio fica com o foco e o devolve ao ícone", async ({
  page,
}) => {
  await login(page, env.admin);

  // Celular, pelo toque: "Cancelar" devolve o foco ao "⋯" do card.
  await page.setViewportSize({ width: 360, height: 800 });
  await openList(page, "/members", `${NAME} Otto`);
  const menu = page.getByRole("button", { name: `Ações de ${NAME} Otto Vaz` });
  await menu.click();
  await page.getByRole("menuitem", { name: "Excluir cadastro" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();

  // Celular, pelo teclado: Enter no "⋯", Enter no item e Esc na confirmação.
  await menu.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Excluir cadastro" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  // O Esc vai na confirmação já carregada (depois do "Verificando…"). Pressionado
  // no mesmo instante em que o diálogo monta, antes da renderização em que o
  // Radix o registra como a camada do topo, o Esc é ignorado; nenhuma pessoa
  // tecla tão rápido, mas o teste teclava e falhava às vezes (QA, E2.01 PR 3).
  await expect(dialog.getByRole("button", { name: "Excluir cadastro" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();

  // Desktop: do bloqueio de Gil, o cadastro de Ivo abre com o foco e, ao fechar, o devolve ao ícone da linha.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openList(page, "/members", GIL);
  const trash = page.getByRole("button", { name: `Excluir ${GIL}`, exact: true });
  await trash.click();
  await dialog.getByRole("button", { name: `Abrir o cadastro de ${NAME} Ivo Reis` }).click();
  const memberForm = page.getByRole("dialog", { name: "Editar Membro" });
  await expect(memberForm.getByLabel("Nome *")).toHaveValue(`${NAME} Ivo Reis`);
  await expect.poll(() => memberForm.evaluate((form) => form.contains(document.activeElement))).toBe(true);
  await memberForm.getByRole("button", { name: "Cancelar" }).click();
  await expect(memberForm).toBeHidden();
  await expect(trash).toBeFocused();
  expect(deletedAt(member(1))).toBe("");
});

test("UX-05 (AD): 'Marcar como inativo' grava só a situação de Nina, fecha com 'Cadastro marcado como inativo.' e não exclui; inativa, a confirmação não traz mais o aviso", async ({
  page,
}) => {
  const nina = `${NAME} Nina Prado`;
  await login(page, env.admin);
  let dialog = await openDeletion(page, nina);
  await expect(dialog.getByText("Se a pessoa só deixou de frequentar, prefira marcá-la como inativa.")).toBeVisible();
  await dialog.getByRole("button", { name: "Marcar como inativo" }).click();

  await expect(toast(page, "Cadastro marcado como inativo.")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: new RegExp(nina) })).toContainText("Inativo");
  expect(sql(env, `SELECT is_active::text || '|' || (deleted_at IS NULL)::text FROM public.members WHERE id = ${lit(member(9))}`)).toBe("false|true");

  await page.getByRole("button", { name: `Excluir ${nina}`, exact: true }).click();
  dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Excluir cadastro" })).toBeEnabled();
  await expect(dialog.getByText(/prefira marcá-la como inativa/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Marcar como inativo" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
});

test("UX-07 (AD): excluir o único cadastro da última página leva à página anterior, que passa a ser a última, e o total cai 1", async ({ page }) => {
  await login(page, env.admin);
  await openList(page, "/members", `${NAME} Pag`, "&size=10&page=2");
  const last = `${NAME} Pag 11`;
  await expect(page.getByRole("row", { name: new RegExp(last) })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2); // cabeçalho + 1 linha
  await expect(page.getByText("11 membros")).toBeVisible();

  await page.getByRole("button", { name: `Excluir ${last}`, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Excluir cadastro" }).click();

  await expect(toast(page, "Cadastro excluído.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByRole("row")).toHaveCount(11); // cabeçalho + 10 linhas
  await expect(page.getByText("10 membros")).toBeVisible();
  await expect(page.getByText(last)).toHaveCount(0);
  expect(deletedAt(member(31))).not.toBe("");

  // RN-03: a própria linha do administrador não tem "Excluir".
  const adminName = sql(env, `SELECT m.name FROM public.members m JOIN auth.users u ON u.id = m.auth_user_id WHERE u.email = ${lit(env.admin.email)}`);
  await openList(page, "/members", adminName);
  await expect(page.getByRole("row", { name: new RegExp(adminName) })).toBeVisible();
  await expect(page.getByRole("button", { name: `Excluir ${adminName}` })).toHaveCount(0);
});

test("RN-04 (LE): depois de reatribuir os discípulos, trocar o timóteo da célula de Carlos e excluir a célula de Marcos, a exclusão de Gil é aceita", async ({
  page,
}) => {
  const adminId = sql(env, `SELECT id FROM auth.users WHERE email = ${lit(env.admin.email)}`);
  sql(
    env,
    `UPDATE public.members SET leader_id = ${lit(member(6))} WHERE id IN (${[3, 4, 5].map((n) => lit(member(n))).join(", ")});
     UPDATE public.cells SET timothy_id = ${lit(member(6))} WHERE id = ${lit(cell(1))};`,
  );
  rpcAs(env, adminId, `public.delete_cell(${lit(cell(2))})`);

  await login(page, LE);
  const dialog = await openDeletion(page, GIL);
  await expect(dialog.getByRole("heading", { name: `Excluir ${GIL}?` })).toBeVisible();
  await dialog.getByRole("button", { name: "Excluir cadastro" }).click();
  await expect(toast(page, "Cadastro excluído.")).toBeVisible();
  expect(deletedAt(member(1))).not.toBe("");
});
