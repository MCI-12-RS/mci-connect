import { expect, test, type Locator, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, sql, toast, type E2EEnv } from "./exclusao-support";

// Tela de Funções (E2.02, PR 3, tarefa 11): UX-04, UX-05 (E2E), UX-06, UX-07 e
// RN-17, RN-19, RN-20 pela tela, com login de verdade pela `sign-in` (stack
// local). Cria a própria massa fictícia (ids e2e202b-…) e apaga tudo no fim,
// devolvendo a função Membro como padrão. Rodar com `--workers=1`.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e202b1";
const PASSWORD = "QaFuncoes#2026";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;
const ROLE_ALFA = id(2, 1); // em uso por Caio
const ROLE_BETA = id(2, 2); // livre, vira a padrão
const ROLE_GAMA = id(2, 3); // livre, é excluída
const RITA = { n: 1, name: "QA Funcoes Rita Souza", email: "rita.e202b1@teste.invalid" };
const CAIO = { n: 2, name: "QA Funcoes Caio Lima" };
const ALFA = "QA Funcao Alfa";
const BETA = "QA Funcao Beta";
const GAMA = "QA Funcao Gama";

let env: E2EEnv;
let ritaAuthId = "";

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR actor_label LIKE 'QA Funcoes%' OR entity_label LIKE 'QA Funcao%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%' OR name LIKE 'QA Funcao%';
     UPDATE public.roles SET is_default = (name = 'Membro' AND NOT is_system);
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

const defaultRoleNames = () => sql(env, "SELECT string_agg(name, ',') FROM public.roles WHERE is_default");
const permissionsOf = (name: string) =>
  sql(
    env,
    `SELECT coalesce(string_agg(rp.permission::text, ',' ORDER BY rp.permission::text), '')
       FROM public.roles r LEFT JOIN public.role_permissions rp ON rp.role_id = r.id WHERE r.name = ${lit(name)}`,
  );

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  const old = sql(env, `SELECT id FROM auth.users WHERE email = ${lit(RITA.email)}`);
  for (const userId of old.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
  ritaAuthId = await createAuthUser(env, RITA.email, PASSWORD);
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name, description) VALUES
       (${lit(ROLE_ALFA)}, ${lit(ALFA)}, 'Função em uso, para o teste.'),
       (${lit(ROLE_BETA)}, ${lit(BETA)}, NULL),
       (${lit(ROLE_GAMA)}, ${lit(GAMA)}, NULL);
     INSERT INTO public.role_permissions (role_id, permission) VALUES
       (${lit(ROLE_ALFA)}, 'view_dashboard'), (${lit(ROLE_ALFA)}, 'view_own_ministry'),
       (${lit(ROLE_BETA)}, 'view_dashboard'),
       (${lit(ROLE_GAMA)}, 'view_dashboard');
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, auth_user_id, role_id, email) VALUES
       (${lit(id(1, RITA.n))}, ${lit(RITA.name)}, 'F', false, true, ${lit(ritaAuthId)},
        (SELECT id FROM public.roles WHERE is_system AND name = 'Administrador'), ${lit(RITA.email)}),
       (${lit(id(1, CAIO.n))}, ${lit(CAIO.name)}, 'M', false, true, NULL, ${lit(ROLE_ALFA)}, 'caio.e202b1@teste.invalid');
     COMMIT;`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  if (ritaAuthId) await deleteAuthUser(env, ritaAuthId);
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE name LIKE 'QA Funcao%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e202b1@teste.invalid')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
  expect(defaultRoleNames(), "limpeza: a Membro volta a ser a padrão").toBe("Membro");
});

test.beforeEach(() => {
  sql(env, "DELETE FROM private.sign_in_throttle;");
});

async function openRoles(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(RITA.email);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("menu-loading")).toHaveCount(0);
  await page.goto("/roles");
  await expect(page.getByRole("heading", { name: "Funções", level: 1 })).toBeVisible();
  await expect(page.getByText(ALFA).first()).toBeVisible();
}

/** O card (celular) ou a linha (desktop) da função. */
const rowOf = (page: Page, name: string) => page.locator("li, tr").filter({ has: page.getByText(name, { exact: true }) }).first();

/** Só as escritas na API (tudo menos GET e a leitura `my_access`, que é POST), para provar que a gravação é uma chamada só. */
function trackWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/rest/v1/") && request.method() !== "GET" && !url.pathname.endsWith("/rpc/my_access")) writes.push(`${request.method()} ${url.pathname.split("/rest/v1/")[1]}`);
  });
  return writes;
}

/** Toca na permissão pelo rótulo: ele cobre a linha inteira (UX-03) e fica por cima do checkbox. */
const tap = (dialog: Locator, label: string) => dialog.locator("label", { hasText: new RegExp(`^${label}$`) }).click();

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("elemento sem caixa");
  return b;
}

test.describe("RN-17: a Administrador é só leitura", () => {
  for (const [label, size] of [
    ["desktop", { width: 1280, height: 800 }],
    ["celular", { width: 360, height: 800 }],
  ] as const) {
    test(`Dada a Administrador no ${label}, então não há Editar, Excluir nem ⋯, e a frase ocupa as permissões`, async ({ page }) => {
      await page.setViewportSize(size);
      await openRoles(page);
      const row = rowOf(page, "Administrador");
      await expect(row).toContainText("Todas as permissões, inclusive as novas. Esta função não pode ser alterada nem excluída.");
      await expect(row.getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Editar a função Administrador|Excluir a função Administrador|Ações da função Administrador/ })).toHaveCount(0);
      // Ela é a primeira da lista.
      await expect(page.locator("li, tbody tr").first()).toContainText("Administrador");
    });
  }
});

test.describe("UX-06: no celular, Editar e ⋯ têm 44x44 px e Excluir só vive no ⋯", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("medidas e ações", async ({ page }) => {
    await openRoles(page);
    const row = rowOf(page, ALFA);
    const edit = row.getByRole("button", { name: `Editar a função ${ALFA}` });
    const more = row.getByRole("button", { name: `Ações da função ${ALFA}` });
    const e = await box(edit);
    const m = await box(more);
    for (const b of [e, m]) {
      expect(Math.round(b.width)).toBeGreaterThanOrEqual(44);
      expect(Math.round(b.height)).toBeGreaterThanOrEqual(44);
    }
    const gap = Math.abs(m.x - (e.x + e.width));
    expect(Math.round(gap), "8 px entre os dois botões").toBeGreaterThanOrEqual(8);
    await expect(row.getByRole("button", { name: `Excluir a função ${ALFA}` })).toHaveCount(0);
    await more.click();
    await expect(page.getByRole("menuitem", { name: "Excluir função" })).toBeVisible();
    await page.keyboard.press("Escape");
    // Nenhum estouro horizontal.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("UX-04: o formulário em tela cheia no celular e em diálogo no desktop", () => {
  test("360x640: ocupa a tela, rodapé fixo com Salvar visível e sem rolagem interna na lista de permissões", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openRoles(page);
    await rowOf(page, BETA).getByRole("button", { name: `Editar a função ${BETA}` }).click();
    const dialog = page.getByRole("dialog", { name: "Editar função" });
    await expect(dialog).toBeVisible();
    const d = await box(dialog);
    expect(Math.round(d.x)).toBe(0);
    expect(Math.round(d.y)).toBe(0);
    expect(Math.round(d.width)).toBe(360);
    expect(Math.round(d.height)).toBe(640);

    const save = dialog.getByRole("button", { name: "Salvar função" });
    const s = await box(save);
    expect(s.y + s.height, "Salvar visível sem rolar").toBeLessThanOrEqual(640);
    expect(s.y).toBeGreaterThanOrEqual(0);

    // A rolagem é a do corpo do diálogo; nenhum fieldset de permissões rola por dentro.
    // O corpo do diálogo (filho direto, com overflow) rola; nada entre ele e as permissões rola.
    const innerScroll = await dialog.locator("fieldset").evaluateAll((fs) => {
      const scrolls = (el: Element) => {
        const oy = getComputedStyle(el).overflowY;
        return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight;
      };
      let count = 0;
      for (const f of fs) {
        const nodes = [f, ...Array.from(f.querySelectorAll("*"))];
        count += nodes.filter(scrolls).length;
        const body = f.closest('[role="dialog"] > div.overflow-y-auto');
        for (let el = f.parentElement; el && el !== body; el = el.parentElement) if (scrolls(el)) count++;
      }
      return count;
    });
    expect(innerScroll).toBe(0);

    // Cabeçalho e rodapé continuam no lugar depois de rolar o corpo.
    const title = dialog.getByText("Editar função", { exact: true });
    const titleBefore = await box(title);
    await dialog.locator("fieldset").last().scrollIntoViewIfNeeded();
    const titleAfter = await box(title);
    const saveAfter = await box(save);
    expect(Math.round(titleAfter.y)).toBe(Math.round(titleBefore.y));
    expect(Math.round(saveAfter.y)).toBe(Math.round(s.y));
    await expect(dialog.getByRole("button", { name: "Fechar" })).toBeVisible();
  });

  test("1280x800: diálogo centralizado, com no máximo 90% da altura", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openRoles(page);
    await rowOf(page, BETA).getByRole("button", { name: `Editar a função ${BETA}` }).click();
    const dialog = page.getByRole("dialog", { name: "Editar função" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(600); // fim da animação de entrada
    const d = await box(dialog);
    expect(d.height).toBeLessThanOrEqual(800 * 0.9 + 1);
    expect(Math.abs(d.x + d.width / 2 - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(d.y + d.height / 2 - 400)).toBeLessThanOrEqual(2);
    expect(d.width).toBeLessThan(1280);
  });
});

test.describe("UX-07 e RN-19: a função padrão", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("na padrão o interruptor fica travado, com o motivo escrito", async ({ page }) => {
    await openRoles(page);
    await rowOf(page, "Membro").getByRole("button", { name: "Editar a função Membro" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar função" });
    const toggle = dialog.getByRole("switch", { name: "Função padrão" });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(dialog).toContainText("Esta é a função padrão. Para trocar, marque outra função como padrão.");
  });

  test("ao ligar em outra, o aviso diz qual deixa de ser a padrão; ao salvar, a troca é uma chamada só e a anterior perde o badge", async ({ page }) => {
    await openRoles(page);
    const writes = trackWrites(page);
    await rowOf(page, BETA).getByRole("button", { name: `Editar a função ${BETA}` }).click();
    const dialog = page.getByRole("dialog", { name: "Editar função" });
    await expect(dialog.getByRole("note")).toHaveCount(0);
    await dialog.getByRole("switch", { name: "Função padrão" }).click();
    await expect(dialog.getByRole("note")).toContainText("A função Membro deixa de ser a padrão.");
    expect(defaultRoleNames(), "antes de salvar nada muda").toBe("Membro");

    await dialog.getByRole("button", { name: "Salvar função" }).click();
    await expect(toast(page, `Função atualizada. ${BETA} agora é a função padrão.`)).toBeVisible();
    await expect(dialog).toHaveCount(0);

    expect(writes, "uma única gravação, pela RPC").toEqual(["POST rpc/save_role"]);
    expect(defaultRoleNames()).toBe(BETA);
    // Exatamente um badge "Padrão", com ícone e texto, na Beta.
    const badges = page.getByText("Padrão", { exact: true });
    await expect(badges).toHaveCount(1);
    await expect(rowOf(page, BETA).getByText("Padrão", { exact: true })).toBeVisible();
    await expect(rowOf(page, BETA).locator("svg.lucide-star")).toHaveCount(1);
    await expect(rowOf(page, "Membro").getByText("Padrão", { exact: true })).toHaveCount(0);
  });

  test("a nova padrão fica travada e, para devolver, marca-se a Membro (a Beta perde o badge)", async ({ page }) => {
    await openRoles(page);
    await rowOf(page, BETA).getByRole("button", { name: `Editar a função ${BETA}` }).click();
    await expect(page.getByRole("dialog").getByRole("switch", { name: "Função padrão" })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

    await rowOf(page, "Membro").getByRole("button", { name: "Editar a função Membro" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar função" });
    await dialog.getByRole("switch", { name: "Função padrão" }).click();
    await expect(dialog.getByRole("note")).toContainText(`A função ${BETA} deixa de ser a padrão.`);
    await dialog.getByRole("button", { name: "Salvar função" }).click();
    await expect(toast(page, "Função atualizada. Membro agora é a função padrão.")).toBeVisible();
    expect(defaultRoleNames()).toBe("Membro");
    await expect(page.getByText("Padrão", { exact: true })).toHaveCount(1);
  });
});

test.describe("Risco 7: a gravação das permissões é atômica", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("se a chamada falha, a função não fica sem permissão; ao funcionar, troca as permissões numa chamada só", async ({ page }) => {
    await openRoles(page);
    const writes = trackWrites(page);
    expect(permissionsOf(ALFA)).toBe("view_dashboard,view_own_ministry");

    // 1) A rede cai no meio da gravação: o banco continua como estava.
    await rowOf(page, ALFA).getByRole("button", { name: `Editar a função ${ALFA}` }).click();
    const dialog = page.getByRole("dialog", { name: "Editar função" });
    await tap(dialog, "Visualizar Seu Ministério");
    await tap(dialog, "Visualizar Toda a Igreja");
    await page.route("**/rest/v1/rpc/save_role", (route) => route.abort("failed"));
    await dialog.getByRole("button", { name: "Salvar função" }).click();
    await expect(dialog).toContainText("Não foi possível salvar a função. Verifique a conexão e tente de novo.");
    await expect(dialog).toBeVisible();
    expect(permissionsOf(ALFA), "nada foi perdido").toBe("view_dashboard,view_own_ministry");
    await page.unroute("**/rest/v1/rpc/save_role");

    // 2) Tenta de novo: troca uma permissão por outra, numa chamada.
    writes.length = 0;
    await dialog.getByRole("button", { name: "Salvar função" }).click();
    await expect(toast(page, "Função atualizada.")).toBeVisible();
    expect(writes).toEqual(["POST rpc/save_role"]);
    expect(permissionsOf(ALFA)).toBe("view_all_church,view_dashboard");
  });

  test("ao reabrir, mostra exatamente as permissões gravadas", async ({ page }) => {
    await openRoles(page);
    await rowOf(page, ALFA).getByRole("button", { name: `Editar a função ${ALFA}` }).click();
    const dialog = page.getByRole("dialog", { name: "Editar função" });
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(2);
  });
});

test.describe("RN-20 e UX-05: excluir função", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("função em uso: abre direto o bloqueio, com a contagem, só 'Fechar', sem chamar o servidor", async ({ page }) => {
    await openRoles(page);
    const writes = trackWrites(page);
    await rowOf(page, ALFA).getByRole("button", { name: `Excluir a função ${ALFA}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Não é possível excluir a função ${ALFA}`);
    await expect(dialog).toContainText("Esta função é usada por 1 membro. Troque a função deles antes de excluí-la.");
    await expect(dialog.getByRole("button")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Fechar" })).toBeVisible();
    expect(writes).toEqual([]);
    await dialog.getByRole("button", { name: "Fechar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rowOf(page, ALFA)).toBeVisible();
  });

  test("função padrão: abre direto o bloqueio, sem confirmação", async ({ page }) => {
    await openRoles(page);
    const writes = trackWrites(page);
    await rowOf(page, "Membro").getByRole("button", { name: "Excluir a função Membro" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Esta é a função padrão. Escolha outra função padrão antes de excluí-la.");
    await expect(dialog.getByRole("button")).toHaveCount(1);
    expect(writes).toEqual([]);
  });

  test("sem uso: confirma, com o foco em Cancelar, e exclui; ao cancelar nada acontece", async ({ page }) => {
    await openRoles(page);
    const writes = trackWrites(page);
    await rowOf(page, GAMA).getByRole("button", { name: `Excluir a função ${GAMA}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Excluir a função ${GAMA}?`);
    await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([]);

    await rowOf(page, GAMA).getByRole("button", { name: `Excluir a função ${GAMA}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Excluir função" }).click();
    await expect(toast(page, "Função excluída.")).toBeVisible();
    await expect(page.getByText(GAMA)).toHaveCount(0);
    expect(writes).toEqual(["POST rpc/delete_role"]);
    expect(sql(env, `SELECT count(*) FROM public.roles WHERE id = ${lit(ROLE_GAMA)}`)).toBe("0");
  });

  test("corrida: alguém passa a usar a função depois de aberta a confirmação, e a recusa do servidor aparece no mesmo bloqueio", async ({ page }) => {
    await openRoles(page);
    await rowOf(page, BETA).getByRole("button", { name: `Excluir a função ${BETA}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Excluir a função ${BETA}?`);
    sql(env, `UPDATE public.members SET role_id = ${lit(ROLE_BETA)} WHERE id = ${lit(id(1, CAIO.n))};`);
    await dialog.getByRole("button", { name: "Excluir função" }).click();
    await expect(dialog).toContainText(`Não é possível excluir a função ${BETA}`);
    await expect(dialog).toContainText("Esta função é usada por 1 membro.");
    await expect(dialog.getByRole("button")).toHaveCount(1);
    sql(env, `UPDATE public.members SET role_id = ${lit(ROLE_ALFA)} WHERE id = ${lit(id(1, CAIO.n))};`);
  });
});

test.describe("Nova função e nome repetido", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("cria com permissões; repetir o nome mostra o erro embaixo do campo, com o formulário aberto", async ({ page }) => {
    await openRoles(page);
    await page.getByRole("button", { name: "Nova função" }).click();
    const dialog = page.getByRole("dialog", { name: "Nova função" });
    await dialog.getByLabel("Nome *").fill("QA Funcao Nova");
    await tap(dialog, "Visualizar Dashboard");
    await dialog.getByRole("button", { name: "Criar função" }).click();
    await expect(toast(page, "Função criada.")).toBeVisible();
    expect(permissionsOf("QA Funcao Nova")).toBe("view_dashboard");

    await page.getByRole("button", { name: "Nova função" }).click();
    const again = page.getByRole("dialog", { name: "Nova função" });
    await again.getByLabel("Nome *").fill("QA Funcao Nova");
    await again.getByRole("button", { name: "Criar função" }).click();
    await expect(again.getByLabel("Nome *")).toHaveAttribute("aria-invalid", "true");
    await expect(again).toBeVisible();
    await expect(again).not.toContainText("23505");
  });
});
