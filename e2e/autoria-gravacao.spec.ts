import { test, expect, type Locator, type Page } from "@playwright/test";
import { adminMemberName, e2eEnv, lit, login, openList, sql, toast, type E2EEnv } from "./exclusao-support";

// E2.05 (PR 2, gravação nos formulários), na stack local, pela tela:
//   - RN-04 e UX-08: salvar sem mudança fecha com "Nenhuma alteração para salvar." e não grava; o celular
//     escrito de outro jeito também não; só o celular novo é uma alteração, com um evento só;
//   - RN-04 (d) e (e), UX-04 (dados): o relatório enviado com 8 participantes vai numa chamada só
//     (`save_cell_report`) e, lido na view, mostra só o envio; incluir um depois é uma alteração, com os
//     participantes dentro do evento;
//   - RN-14 e UX-09: com a Auditoria quebrada (um CHECK em events, criado e apagado pelo teste, como no
//     pgTAP), membro, célula e relatório não gravam nada, mostram a mensagem de conexão e mantêm os dados;
//     de volta, a nova tentativa grava uma vez só.
// Massa fictícia "Grav Autoria …", apagada no começo e no fim. Roda em série (`--workers=1`).

test.describe.configure({ mode: "serial" });
test.use({ timezoneId: "America/Sao_Paulo" });

const NAME = "Grav Autoria";
const PREFIX = "e2e205b2";
const BROKEN = "e2e205_broken";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;

const LEADER = { id: id(1, 1), name: `${NAME} Lider` };
const MEMBER = { id: id(1, 2), name: `${NAME} Membro`, mobile: "51977710002" };
const LEADER2 = { id: id(1, 3), name: `${NAME} Segundo` };
const PEOPLE = ["Ana", "Bia", "Caio", "Davi", "Eva", "Fabio", "Gil", "Hugo", "Ivo"].map((first, i) => ({
  id: id(2, i + 1),
  name: `${NAME} ${first}`,
}));
const CELL = id(3, 1);
const CELL2 = id(3, 2);

let env: E2EEnv;
let admin = "";

const count = (query: string) => Number(sql(env, query));

const unbreak = () => sql(env, `ALTER TABLE public.events DROP CONSTRAINT IF EXISTS ${BROKEN};`);
/** A Auditoria quebrada: nenhum evento novo entra (o mesmo jeito do pgTAP `e205_03`). */
const breakAudit = () => sql(env, `ALTER TABLE public.events ADD CONSTRAINT ${BROKEN} CHECK (false) NOT VALID;`);

function cleanup() {
  unbreak();
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_label LIKE '${NAME}%' OR description LIKE '%${NAME}%'
         OR entity_id IN (SELECT id FROM public.cell_reports WHERE cell_id IN (${lit(CELL)}, ${lit(CELL2)}))
         OR entity_id IN (${lit(CELL)}, ${lit(CELL2)});
     DELETE FROM public.cell_report_participants
      WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id IN (${lit(CELL)}, ${lit(CELL2)}));
     DELETE FROM public.cell_reports WHERE cell_id IN (${lit(CELL)}, ${lit(CELL2)});
     DELETE FROM public.cells WHERE id IN (${lit(CELL)}, ${lit(CELL2)});
     DELETE FROM public.members WHERE name LIKE '${NAME}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
     COMMIT;
     SELECT private.rebuild_member_hierarchy();`,
  );
}

/** A massa, gravada como postgres (autor "Sistema"), com as regras do E2.04 e do E2.08. */
function seed() {
  const adminId = sql(env, `SELECT m.id FROM public.members m JOIN auth.users u ON u.id = m.auth_user_id WHERE u.email = ${lit(env.admin.email)}`);
  const member = (p: { id: string; name: string }, mobile: string, leader: string) =>
    `(${lit(p.id)}, ${lit(p.name)}, 'M', false, true, ${lit(leader)}, true, ${lit(mobile)}, (SELECT id FROM public.roles WHERE is_default))`;
  const rows = [
    member(LEADER, "51977710001", adminId),
    member(MEMBER, MEMBER.mobile, adminId),
    member(LEADER2, "51977710003", adminId),
    ...PEOPLE.map((p, i) => member(p, `519777200${String(i + 1).padStart(2, "0")}`, LEADER.id)),
  ];
  // O dia da reunião é hoje (Brasília) à meia-noite: a data sugerida pelo formulário fica na semana atual.
  const today = `(ARRAY['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'])[extract(dow FROM public.sp_today())::int + 1]`;
  const cell = (cellId: string, leader: string, street: string) =>
    `(${lit(cellId)}, ${lit(leader)}, ${lit(leader)}, ${lit(leader)}, 'Evangelística', ${today}, '00:00', ${lit(street)}, '10', 'Centro', true)`;
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, role_id)
     VALUES ${rows.slice(0, 3).join(",\n")};
     INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp, role_id)
     VALUES ${rows.slice(3).join(",\n")};
     INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, street, number, neighborhood, is_active)
     VALUES ${cell(CELL, LEADER.id, "Rua Gravação")}, ${cell(CELL2, LEADER2.id, "Rua Segunda")};`,
  );
}

/** As RPCs que gravam relatório ou participantes; as outras RPCs (POST) são leituras. */
const WRITE_RPCS = new Set(["save_cell_report", "submit_cell_report", "set_cell_report_participants"]);

/** As chamadas de gravação da página, a partir de agora (método e caminho). */
function trackWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/rest/v1/") || request.method() === "GET" || request.method() === "HEAD") return;
    const rpc = /^\/rest\/v1\/rpc\/(.+)$/.exec(url.pathname)?.[1];
    if (rpc && !WRITE_RPCS.has(rpc)) return;
    writes.push(`${request.method()} ${url.pathname}`);
  });
  return writes;
}

async function openMemberEdit(page: Page, name: string) {
  await openList(page, "/members", name);
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Editar membro" });
  await expect(dialog).toBeVisible();
  // As opções de função chegam antes de o formulário poder salvar sem mudar a função.
  await expect(dialog.getByRole("combobox", { name: "Função *" })).toBeVisible();
  return dialog;
}

async function openCellEdit(page: Page, leader: string) {
  await openList(page, "/cells", leader);
  await page.getByRole("button", { name: `Editar a célula de ${leader}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Editar célula" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openNewReport(page: Page, leader: string) {
  await openList(page, "/cells", leader);
  await page.getByRole("button", { name: `Novo relatório da célula de ${leader}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo Relatório de Célula" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openReportEdit(page: Page, leader: string) {
  const date = sql(env, `SELECT to_char(public.sp_today(), 'DD/MM/YYYY')`);
  await openList(page, "/cell-reports", leader);
  await page.getByRole("button", { name: `Editar o relatório de ${date} da célula de ${leader}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Editar Relatório" });
  await expect(dialog).toBeVisible();
  // Salvar fica desabilitado até os participantes salvos carregarem.
  await expect(dialog.getByRole("button", { name: "Salvar", exact: true })).toBeEnabled();
  return dialog;
}

async function pickParticipants(page: Page, dialog: Locator, names: readonly string[]) {
  const input = dialog.getByLabel("Participantes (Membros)");
  await input.click();
  await input.fill(NAME);
  for (const name of names) await page.getByRole("option", { name, exact: true }).click();
  await page.keyboard.press("Escape");
}

/** A autoria do relatório lida na `cell_reports_view`, com a sessão do administrador (RN-04 d). */
async function reportAuthorship(page: Page, reportId: string) {
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      if (key.endsWith("-auth-token")) return String(JSON.parse(localStorage.getItem(key) ?? "{}").access_token ?? "");
    }
    return "";
  });
  const response = await page.request.get(
    `${env.apiUrl}/rest/v1/cell_reports_view?id=eq.${reportId}&select=created_by_kind,created_by_name,updated_at,updated_by_name`,
    { headers: { apikey: env.publishableKey, Authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  const rows: unknown = await response.json();
  expect(Array.isArray(rows) && rows.length === 1, "o relatório na view").toBe(true);
  return Array.isArray(rows) ? rows[0] : null;
}

const reportOf = (cellId: string) => sql(env, `SELECT coalesce((SELECT id::text FROM public.cell_reports WHERE cell_id = ${lit(cellId)} AND deleted_at IS NULL), '')`);

test.beforeAll(() => {
  env = e2eEnv();
  cleanup();
  seed();
  admin = adminMemberName(env);
});
test.afterAll(() => {
  if (env) cleanup();
});
test.afterEach(() => unbreak());

test("RN-04 e UX-08: membro sem mudança e com o celular escrito de outro jeito não grava; só o celular novo é uma alteração, com um evento", async ({ page }) => {
  await login(page, env.admin);
  const writes = trackWrites(page);

  // Sem mexer em nada.
  let dialog = await openMemberEdit(page, MEMBER.name);
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(toast(page, "Nenhuma alteração para salvar.")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);

  // O mesmo celular, escrito de outro jeito.
  dialog = await openMemberEdit(page, MEMBER.name);
  await dialog.getByLabel("Celular / WhatsApp").fill("(51) 97771-0002");
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(toast(page, "Nenhuma alteração para salvar.").last()).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(toast(page, "Membro atualizado com sucesso")).toHaveCount(0);
  expect(sql(env, `SELECT coalesce(updated_at::text, '<nulo>') FROM public.members WHERE id = ${lit(MEMBER.id)}`)).toBe("<nulo>");

  // Só o celular, novo.
  dialog = await openMemberEdit(page, MEMBER.name);
  await dialog.getByLabel("Celular / WhatsApp").fill("(51) 97771-0099");
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
  expect(writes.filter((w) => w.includes("/rest/v1/members"))).toEqual(["PATCH /rest/v1/members"]);
  expect(
    sql(env, `SELECT updated_by_kind || '|' || (SELECT name FROM public.members a WHERE a.id = m.updated_by) FROM public.members m WHERE id = ${lit(MEMBER.id)}`),
  ).toBe(`member|${admin}`);
  expect(
    sql(env, `SELECT action || '|' || array_to_string(changed_fields, ',') FROM public.events WHERE entity_id = ${lit(MEMBER.id)} AND action <> 'create'`),
  ).toBe("update|mobile_whatsapp");
});

test("RN-04 (d) e (e): o relatório com 8 participantes vai numa chamada e mostra só o envio; incluir um depois é uma alteração; sem mudança não grava", async ({ page }) => {
  await login(page, env.admin);
  const writes = trackWrites(page);

  let dialog = await openNewReport(page, LEADER.name);
  await dialog.getByLabel("Tema da Palavra").fill("Fé que move montanhas");
  await pickParticipants(page, dialog, PEOPLE.slice(0, 8).map((p) => p.name));
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(toast(page, "Relatório salvo com sucesso")).toBeVisible();

  // Uma chamada de gravação só, sem a chamada separada de participantes.
  expect(writes).toEqual(["POST /rest/v1/rpc/save_cell_report"]);
  const reportId = reportOf(CELL);
  expect(reportId).not.toBe("");
  // E2.11 (RN-11): o líder (também timóteo e anfitrião) entra como automático: 8 escolhidos + 1.
  expect(count(`SELECT count(*) FROM public.cell_report_participants WHERE report_id = ${lit(reportId)}`)).toBe(9);
  expect(await reportAuthorship(page, reportId)).toEqual({
    created_by_kind: "member",
    created_by_name: admin,
    updated_at: null,
    updated_by_name: null,
  });
  // Um evento só, o envio, com os 9 participantes dentro dele.
  expect(
    sql(env, `SELECT action || '|' || jsonb_array_length(changes -> 'participants' -> 'sent') FROM public.events WHERE entity_id = ${lit(reportId)}`),
  ).toBe("create|9");

  // Incluir um participante depois.
  writes.length = 0;
  dialog = await openReportEdit(page, LEADER.name);
  await pickParticipants(page, dialog, [PEOPLE[8].name]);
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(toast(page, "Relatório salvo com sucesso").last()).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual(["POST /rest/v1/rpc/save_cell_report"]);
  const after = await reportAuthorship(page, reportId);
  expect(after).toMatchObject({ created_by_name: admin, updated_by_name: admin });
  expect(after?.updated_at).not.toBeNull();
  expect(
    sql(
      env,
      `SELECT action || '|' || jsonb_array_length(changes -> 'participants' -> 'added') || '|' || jsonb_array_length(changes -> 'participants' -> 'removed')
         FROM public.events WHERE entity_id = ${lit(reportId)} AND action = 'update'`,
    ),
  ).toBe("update|1|0");

  // Sem mudança: nada vai ao servidor.
  writes.length = 0;
  dialog = await openReportEdit(page, LEADER.name);
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(toast(page, "Nenhuma alteração para salvar.")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);
  expect(count(`SELECT count(*) FROM public.events WHERE entity_id = ${lit(reportId)}`)).toBe(2);
});

test("RN-04 e UX-08: célula sem mudança, ou só com o campo vazio reescrito, fecha com o aviso e não faz nenhuma chamada de gravação", async ({ page }) => {
  await login(page, env.admin);
  const writes = trackWrites(page);
  const before = sql(env, `SELECT coalesce(updated_at::text, '<nulo>') FROM public.cells WHERE id = ${lit(CELL)}`);
  const events = count(`SELECT count(*) FROM public.events WHERE entity_id = ${lit(CELL)}`);

  const dialog = await openCellEdit(page, LEADER.name);
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(toast(page, "Nenhuma alteração para salvar.")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(toast(page, "Célula atualizada.")).toHaveCount(0);
  expect(writes).toEqual([]);

  // Digitar outro valor e voltar ao original também não conta.
  const again = await openCellEdit(page, LEADER.name);
  await again.getByLabel("Bairro").fill("Outro");
  await again.getByLabel("Bairro").fill("Centro");
  await again.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(toast(page, "Nenhuma alteração para salvar.").last()).toBeVisible();
  await expect(again).toBeHidden();
  expect(writes).toEqual([]);
  expect(sql(env, `SELECT coalesce(updated_at::text, '<nulo>') FROM public.cells WHERE id = ${lit(CELL)}`)).toBe(before);
  expect(count(`SELECT count(*) FROM public.events WHERE entity_id = ${lit(CELL)}`)).toBe(events);
});

test("RN-14 e UX-09: com a Auditoria quebrada, membro, célula e relatório não gravam, mostram a mensagem de conexão e mantêm os dados; de volta, gravam uma vez", async ({ page }) => {
  await login(page, env.admin);

  // Membro.
  const dialog = await openMemberEdit(page, MEMBER.name);
  breakAudit();
  await dialog.getByLabel("Observações").fill("Nota durante a falha");
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Não foi possível salvar o cadastro. Verifique a conexão e tente de novo." })).toBeVisible();
  await expect(dialog.getByLabel("Observações")).toHaveValue("Nota durante a falha");
  await expect(toast(page, "Membro atualizado com sucesso")).toHaveCount(0);
  expect(sql(env, `SELECT coalesce(notes, '<nulo>') FROM public.members WHERE id = ${lit(MEMBER.id)}`)).toBe("<nulo>");
  const memberEvents = count(`SELECT count(*) FROM public.events WHERE entity_id = ${lit(MEMBER.id)}`);
  unbreak();
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(toast(page, "Membro atualizado com sucesso")).toBeVisible();
  expect(sql(env, `SELECT notes FROM public.members WHERE id = ${lit(MEMBER.id)}`)).toBe("Nota durante a falha");
  expect(count(`SELECT count(*) FROM public.events WHERE entity_id = ${lit(MEMBER.id)}`)).toBe(memberEvents + 1);

  // Célula.
  const cellDialog = await openCellEdit(page, LEADER2.name);
  breakAudit();
  await cellDialog.getByLabel("Bairro").fill("Bairro da Falha");
  await cellDialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(cellDialog.getByRole("alert").filter({ hasText: "Não foi possível salvar a célula. Verifique a conexão e tente de novo." })).toBeVisible();
  await expect(cellDialog.getByLabel("Bairro")).toHaveValue("Bairro da Falha");
  expect(sql(env, `SELECT neighborhood FROM public.cells WHERE id = ${lit(CELL2)}`)).toBe("Centro");
  unbreak();
  await cellDialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(toast(page, "Célula atualizada.")).toBeVisible();
  expect(sql(env, `SELECT neighborhood FROM public.cells WHERE id = ${lit(CELL2)}`)).toBe("Bairro da Falha");
  expect(count(`SELECT count(*) FROM public.events WHERE entity_id = ${lit(CELL2)} AND action = 'update'`)).toBe(1);

  // Relatório (envio).
  const reportDialog = await openNewReport(page, LEADER2.name);
  breakAudit();
  await reportDialog.getByLabel("Tema da Palavra").fill("Tema durante a falha");
  await reportDialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    reportDialog.getByRole("alert").filter({ hasText: "Não foi possível salvar o relatório. Verifique a conexão e tente de novo." }),
  ).toBeVisible();
  await expect(reportDialog.getByLabel("Tema da Palavra")).toHaveValue("Tema durante a falha");
  await expect(reportDialog.getByRole("button", { name: "Salvar", exact: true })).toBeEnabled();
  expect(reportOf(CELL2)).toBe("");
  unbreak();
  await reportDialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(toast(page, "Relatório salvo com sucesso")).toBeVisible();
  const reportId = reportOf(CELL2);
  expect(count(`SELECT count(*) FROM public.cell_reports WHERE cell_id = ${lit(CELL2)}`)).toBe(1);
  expect(count(`SELECT count(*) FROM public.events WHERE entity_id = ${lit(reportId)}`)).toBe(1);
});
