import { execFileSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Apoio dos testes de comportamento da exclusão lógica (E2.01, PR 2):
// acesso ao banco local para criar e apagar a massa fictícia, contas de teste
// pela Admin API do Auth local, login e medidas de tela.
//
// Só roda contra um Supabase local (127.0.0.1 ou localhost). Variáveis:
//   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: as mesmas do `npm run dev`;
//   E2E_SERVICE_ROLE_KEY: chave service_role da stack local (Admin API do Auth);
//   E2E_PSQL: comando do psql como postgres na stack local, por exemplo
//     "docker exec -i supabase_db_<projeto> psql -U postgres";
//   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD: um usuário com a função Administrador.
// Sem elas, os testes são pulados.

export interface E2EEnv {
  apiUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
  psql: string[];
  admin: Credentials;
}

export interface Credentials {
  email: string;
  password: string;
}

/** As variáveis do ambiente; sem alguma delas (ou fora do Supabase local), o teste é pulado. */
export function e2eEnv(): E2EEnv {
  const apiUrl = process.env.VITE_SUPABASE_URL ?? "";
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  const serviceRoleKey = process.env.E2E_SERVICE_ROLE_KEY ?? "";
  const psql = (process.env.E2E_PSQL ?? "").split(" ").filter(Boolean);
  const email = process.env.E2E_ADMIN_EMAIL ?? "";
  const password = process.env.E2E_ADMIN_PASSWORD ?? "";
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl);
  test.skip(
    !local || !publishableKey || !serviceRoleKey || psql.length === 0 || !email || !password,
    "Defina VITE_SUPABASE_URL (local), VITE_SUPABASE_PUBLISHABLE_KEY, E2E_SERVICE_ROLE_KEY, E2E_PSQL, E2E_ADMIN_EMAIL e E2E_ADMIN_PASSWORD.",
  );
  return { apiUrl, publishableKey, serviceRoleKey, psql, admin: { email, password } };
}

/** Roda SQL como postgres na stack local e devolve a saída sem alinhamento (uma linha por registro). */
export function sql(env: E2EEnv, query: string): string {
  const [command, ...args] = env.psql;
  return execFileSync(command, [...args, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: query,
    encoding: "utf8",
  }).trim();
}

/** Escapa um texto para um literal SQL. */
export const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Cria uma conta confirmada no Auth local e devolve o id. Desde o E2.03 o Auth não guarda senha (a guarda
 * descarta a que o createUser grava): a senha de teste vai para o cofre (`private.write_password`, como o
 * postgres), que é de onde a `sign-in` a confere.
 */
export async function createAuthUser(env: E2EEnv, email: string, password: string): Promise<string> {
  const response = await fetch(`${env.apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body: unknown = await response.json();
  const id = typeof body === "object" && body !== null && "id" in body ? body.id : null;
  if (typeof id !== "string") throw new Error(`Não foi possível criar ${email}: ${JSON.stringify(body)}`);
  sql(env, `SELECT private.write_password(${lit(id)}::uuid, NULL, ${lit(password)}, NULL);`);
  return id;
}

export async function deleteAuthUser(env: E2EEnv, id: string): Promise<void> {
  await fetch(`${env.apiUrl}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
  });
}

/** Chama uma RPC como o usuário do Auth `authUserId`, numa transação (para preparar a massa pela API). */
export function rpcAs(env: E2EEnv, authUserId: string, call: string): void {
  sql(
    env,
    `BEGIN;
     SELECT set_config('request.jwt.claims', json_build_object('sub', ${lit(authUserId)}, 'role', 'authenticated')::text, true);
     SET LOCAL ROLE authenticated;
     SELECT ${call};
     COMMIT;`,
  );
}

export async function login(page: Page, { email, password }: Credentials) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
}

/** O token de acesso da sessão aberta na página (o supabase-js guarda a sessão no localStorage). */
export async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      if (!key.endsWith("-auth-token")) continue;
      const session: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (typeof session === "object" && session !== null && "access_token" in session) return String(session.access_token);
    }
    return "";
  });
  expect(token, "sessão no localStorage").not.toBe("");
  return token;
}

/** Chama uma RPC pela API, com a sessão da página. Devolve o status e o corpo. */
export async function callRpc(page: Page, env: E2EEnv, fn: string, args: object) {
  const token = await accessToken(page);
  const response = await page.request.post(`${env.apiUrl}/rest/v1/rpc/${fn}`, {
    headers: { apikey: env.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: args,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status(), body };
}

/** Lista com a busca na URL; espera a lista carregar. */
export async function openList(page: Page, path: string, search: string, extra = "") {
  await page.goto(`${path}?q=${encodeURIComponent(search)}${extra}`);
  await expect(page.getByText("Carregando...")).toHaveCount(0);
}

/** O toast com esse título (o item da lista de toasts; o Radix repete o texto num anúncio escondido). */
export const toast = (page: Page, title: string) => page.locator("li[role='status']").filter({ hasText: title });

/**
 * UX-01: cada botão tem ao menos 44×44 px e fica a pelo menos 8 px de qualquer
 * outro do mesmo grupo (afastado em ao menos um dos eixos).
 */
export async function expectTouchTargets(group: Locator, label: string) {
  const boxes = await group.locator("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const r = button.getBoundingClientRect();
      return { name: button.getAttribute("aria-label") ?? button.textContent ?? "", left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  expect(boxes.length, `${label}: botões do card`).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.right - box.left, `${label}: largura de "${box.name}"`).toBeGreaterThanOrEqual(43.5);
    expect(box.bottom - box.top, `${label}: altura de "${box.name}"`).toBeGreaterThanOrEqual(43.5);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const dx = Math.max(0, b.left - a.right, a.left - b.right);
      const dy = Math.max(0, b.top - a.bottom, a.top - b.bottom);
      expect(Math.max(dx, dy), `${label}: espaço entre "${a.name}" e "${b.name}"`).toBeGreaterThanOrEqual(7.5);
    }
  }
}

/** Simula a fonte do sistema em 200% (o Tailwind usa rem). */
export async function largeFont(page: Page) {
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
}

/**
 * UX-12: o diálogo rola por dentro, mantém margem lateral, alinha o texto à
 * esquerda, e os botões continuam alcançáveis; a página não rola de lado.
 */
export async function expectDialogFitsSmallScreen(page: Page, dialog: Locator, buttons: string[], label: string) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("sem viewport");
  const metrics = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const title = element.querySelector("h2");
    return {
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      left: rect.left,
      right: rect.right,
      titleAlign: title ? getComputedStyle(title.parentElement ?? title).textAlign : "",
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  expect(metrics.overflowY, `${label}: rola por dentro`).toBe("auto");
  expect(metrics.clientHeight, `${label}: cabe na altura da tela`).toBeLessThanOrEqual(viewport.height);
  expect(metrics.left, `${label}: margem esquerda`).toBeGreaterThanOrEqual(15.5);
  expect(viewport.width - metrics.right, `${label}: margem direita`).toBeGreaterThanOrEqual(15.5);
  expect(metrics.titleAlign, `${label}: texto à esquerda`).toMatch(/^(left|start)$/);
  expect(metrics.pageWidth, `${label}: sem rolagem lateral`).toBeLessThanOrEqual(viewport.width);
  for (const name of buttons) {
    const button = dialog.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box, `${label}: "${name}" na tela`).not.toBeNull();
    if (!box) continue;
    expect(box.y, `${label}: "${name}" visível (topo)`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${label}: "${name}" visível (base)`).toBeLessThanOrEqual(viewport.height);
    expect(box.x + box.width, `${label}: "${name}" não estoura a largura`).toBeLessThanOrEqual(viewport.width);
  }
  return metrics;
}

// ---------------------------------------------------------------------------
// Listas de excluídos e restauração (E2.01, PR 3).

/** O id do Auth de um e-mail da stack local (vazio se não houver). */
export const authIdOf = (env: E2EEnv, email: string) => sql(env, `SELECT coalesce((SELECT id::text FROM auth.users WHERE email = ${lit(email)}), '')`);

/** O nome do cadastro ligado à conta do administrador de teste. */
export const adminMemberName = (env: E2EEnv) =>
  sql(env, `SELECT m.name FROM public.members m JOIN auth.users u ON u.id = m.auth_user_id WHERE u.email = ${lit(env.admin.email)}`);

/**
 * Várias RPCs como o usuário do Auth `authUserId`, na ordem, numa transação só
 * (para preparar a massa pela API, com as mesmas regras e a mesma Auditoria).
 */
export function rpcsAs(env: E2EEnv, authUserId: string, calls: readonly string[]): void {
  sql(
    env,
    `BEGIN;
     SELECT set_config('request.jwt.claims', json_build_object('sub', ${lit(authUserId)}, 'role', 'authenticated')::text, true);
     SET LOCAL ROLE authenticated;
     ${calls.map((call) => `SELECT ${call};`).join("\n     ")}
     COMMIT;`,
  );
}

/** Abre uma lista de excluídos com a busca na URL e espera a lista (ou o aviso) carregar. */
export async function openDeleted(page: Page, path: string, search: string, extra = "") {
  await page.goto(`${path}?q=${encodeURIComponent(search)}${extra}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

/**
 * Tentativa de login pela função `sign-in` (E1.04): o status HTTP (200 entra; 401 recusa).
 * O login direto no Auth (`grant_type=password`) é recusado de propósito na stack local
 * (`[auth.email] enable_signup = false`, RN-14), então não serve mais para testar o acesso.
 */
export async function passwordGrant(env: E2EEnv, email: string, password: string): Promise<number> {
  const response = await fetch(`${env.apiUrl}/functions/v1/sign-in`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  await response.text();
  return response.status;
}

/** As requisições ao PostgREST (`/rest/v1/…`) feitas pela página, a partir de agora. */
export function trackRestRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/rest/v1/")) urls.push(decodeURIComponent(url));
  });
  return urls;
}

/**
 * UX-40: nenhum botão (ou link com cara de botão) visível no escopo estoura a
 * largura da tela nem o próprio contorno: o texto quebra linha. A página não
 * rola de lado.
 */
export async function expectNoButtonOverflow(page: Page, scope: Locator, label: string) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("sem viewport");
  const boxes = await scope.locator("button, a[href]").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
          left: rect.left,
          right: rect.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      }),
  );
  expect(boxes.length, `${label}: botões na tela`).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.left, `${label}: "${box.name}" começa dentro da tela`).toBeGreaterThanOrEqual(-0.5);
    expect(box.right, `${label}: "${box.name}" termina dentro da tela`).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.scrollWidth, `${label}: o texto de "${box.name}" cabe no botão`).toBeLessThanOrEqual(box.clientWidth + 1);
  }
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth, `${label}: sem rolagem lateral`).toBeLessThanOrEqual(viewport.width);
}
