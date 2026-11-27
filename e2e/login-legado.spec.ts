import { expect, test, type Page } from "@playwright/test";
import { deleteAuthUser, e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";

// E3.03 (tarefa 6): o login com a senha do legado pela tela, contra a stack real (sign-in servida).
// Spec: docs/specs/e3-login-legado.md, Critérios de aceite (RN-02, RN-04, RN-05).
//   - Ana entra pelo celular com máscara com a senha do legado (acento) e depois sem máscara;
//   - Bruno entra pelo CPF com pontos e 123456, vai para a troca obrigatória, troca, e 123456 deixa de valer;
//   - Hugo, com 80 letras no legado, digita só as 72 primeiras: "Usuário ou senha inválidos".
// As credenciais são carregadas pela private.add_legacy_credential com o md5() da senha (o mesmo do
// pacote do legado, provado no pgTAP e3_02_md5_cases). Cria a própria massa (ids e2e30300-…) e apaga
// tudo no fim. Rodar com `--workers=1`.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e30300";
const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;
const PASTOR = { n: 1, name: "QA Legado Pastor Silva", email: "pastor.e2e303@teste.invalid" };
const ANA = { n: 2, name: "QA Legado Ana Souza", email: "ana.e2e303@teste.invalid", mobile: "(51) 93033-0002", password: "Graça2024!" };
const BRUNO = { n: 3, name: "QA Legado Bruno Brito", email: "bruno.e2e303@teste.invalid", cpf: "303.030.301-27", password: "123456" };
const HUGO = { n: 4, name: "QA Legado Hugo Hoffmann", email: "hugo.e2e303@teste.invalid", password: "h".repeat(80) };
const INVALID = "Usuário ou senha inválidos. Confira os dados e tente de novo.";

let env: E2EEnv;

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR actor_label LIKE 'QA Legado%';
     DELETE FROM private.legacy_credentials WHERE member_id::text LIKE '${PREFIX}%';
     UPDATE public.members SET leader_id = NULL, has_leadership = false WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

async function removeAccounts() {
  const ids = sql(env, `SELECT id FROM auth.users WHERE email LIKE '%.e2e303@teste.invalid'`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

/** A conta da carga (E4.08): existe no Auth, sem senha no cofre. */
async function createLoadedAccount(email: string): Promise<string> {
  const response = await fetch(`${env.apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const body: unknown = await response.json();
  const userId = typeof body === "object" && body !== null && "id" in body ? body.id : null;
  if (typeof userId !== "string") throw new Error(`Não foi possível criar ${email}`);
  return userId;
}

async function signIn(page: Page, identifier: string, password: string) {
  sql(env, "DELETE FROM private.sign_in_throttle;");
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(identifier);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
}

const credential = (n: number) =>
  sql(
    env,
    `SELECT coalesce((SELECT CASE WHEN legacy_hash IS NULL THEN 'discarded' WHEN used_at IS NULL THEN 'pending' ELSE 'used' END
                        FROM private.legacy_credentials WHERE member_id = ${lit(id(n))}), 'none')`,
  );

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  const pastorAuth = await createLoadedAccount(PASTOR.email);
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, auth_user_id, email)
     VALUES (${lit(id(PASTOR.n))}, ${lit(PASTOR.name)}, 'M', true, false, ${lit(pastorAuth)}, ${lit(PASTOR.email)});`,
  );
  const people = [
    { ...ANA, gender: "F", email: null as string | null, cpf: null as string | null, mobile: ANA.mobile, authEmail: ANA.email },
    { ...BRUNO, gender: "M", email: null, cpf: BRUNO.cpf.replace(/\D/g, ""), mobile: null, authEmail: BRUNO.email },
    { ...HUGO, gender: "M", email: HUGO.email, cpf: null, mobile: null, authEmail: HUGO.email },
  ];
  for (const who of people) {
    const authId = await createLoadedAccount(who.authEmail);
    sql(
      env,
      `INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, email, cpf, mobile_whatsapp)
       VALUES (${lit(id(who.n))}, ${lit(who.name)}, ${lit(who.gender)}, ${lit(id(PASTOR.n))}, true, ${lit(authId)},
               ${who.email ? lit(who.email) : "NULL"}, ${who.cpf ? lit(who.cpf) : "NULL"}, ${who.mobile ? lit(who.mobile) : "NULL"});
       SELECT private.add_legacy_credential(${lit(id(who.n))}, md5(${lit(who.password)}));`,
    );
  }
  expect(credential(ANA.n), "massa: Ana com credencial pendente").toBe("pending");
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e2e303@teste.invalid')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.describe("E3: login com a senha do legado", () => {
  test("RN-02, RN-04: Ana entra pelo celular com máscara e 'Graça2024!'; a credencial some e a mesma senha continua valendo sem máscara", async ({ browser, page }) => {
    await signIn(page, ANA.mobile, "Graca2024!");
    await expect(page.getByText(INVALID)).toBeVisible();
    expect(credential(ANA.n), "RN-02: sem o acento não confere; a credencial continua").toBe("pending");

    await signIn(page, ANA.mobile, ANA.password);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Crie uma nova senha" })).toHaveCount(0);
    expect(credential(ANA.n), "RN-04 b: a credencial some").toBe("discarded");
    expect(
      sql(env, `SELECT metadata ->> 'credential' FROM public.events WHERE action = 'login' AND entity_id = ${lit(id(ANA.n))} ORDER BY occurred_at DESC LIMIT 1`),
      "RN-13 a: o Login realizado tem a Senha do sistema antigo",
    ).toBe("legacy");

    const other = await browser.newPage();
    await signIn(other, ANA.mobile.replace(/\D/g, ""), ANA.password);
    await expect(other).toHaveURL(/\/$/);
    await other.close();
  });

  test("RN-04, RN-05: Bruno entra pelo CPF com pontos e 123456, vai para a troca obrigatória; depois de trocar, 123456 falha", async ({ browser, page }) => {
    await signIn(page, BRUNO.cpf, BRUNO.password);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole("heading", { name: "Crie uma nova senha" })).toBeVisible();
    expect(credential(BRUNO.n)).toBe("discarded");

    await page.getByLabel("Nova senha", { exact: true }).fill("Bruno#Nova2026");
    await page.getByLabel("Confirmar nova senha", { exact: true }).fill("Bruno#Nova2026");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page).toHaveURL(/\/$/);

    const other = await browser.newPage();
    await signIn(other, BRUNO.cpf.replace(/\D/g, ""), BRUNO.password);
    await expect(other.getByText(INVALID)).toBeVisible();
    await signIn(other, BRUNO.cpf.replace(/\D/g, ""), "Bruno#Nova2026");
    await expect(other).toHaveURL(/\/$/);
    await other.close();
  });

  test("RN-05: Hugo (80 letras no legado) digita só as 72 primeiras: 'Usuário ou senha inválidos'; a credencial continua", async ({ page }) => {
    await signIn(page, HUGO.email, HUGO.password.slice(0, 72));
    await expect(page.getByText(INVALID)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(credential(HUGO.n)).toBe("pending");
    expect(
      sql(env, `SELECT error_reason || '|' || (metadata ->> 'credential') FROM public.events WHERE action = 'login_failed' AND entity_id = ${lit(id(HUGO.n))} ORDER BY occurred_at DESC LIMIT 1`),
      "RN-13 c: Senha incorreta, com a Senha do sistema antigo",
    ).toBe("Senha incorreta|legacy");
  });
});
