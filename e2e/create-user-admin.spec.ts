import { test, expect } from "@playwright/test";
import {
  authIdOf,
  createAuthUser,
  deleteAuthUser,
  e2eEnv,
  lit,
  rpcsAs,
  sql,
  type Credentials,
  type E2EEnv,
} from "./exclusao-support";

// Cadastro com dados de um membro excluído, pela API (E2.01, PR 5, RN-18,
// DT-18): a Edge Function `create-user-admin` responde 409 antes de criar a
// conta no Auth, e "Cadastrar mesmo assim" é `confirmDeletedMatches: true`.
//
// Precisa da função servida na stack local (`supabase functions serve` com a
// `create-user-admin`, acessível em <VITE_SUPABASE_URL>/functions/v1/…); sem
// ela, os testes são pulados. As demais variáveis são as de
// e2e/exclusao-support.ts.
//
// Massa fictícia "QA5 Api …" (ids e2e201f0-…) e contas de teste, apagadas no
// fim (e no começo, se uma execução anterior parou no meio). Roda em série.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e201f0";
const NAME = "QA5 Api";
const PASSWORD = "Qa5Api#2026";
const id = (kind: number, n: number) => `${PREFIX}-${String(kind).padStart(4, "0")}-0000-0000-${String(n).padStart(12, "0")}`;
const member = (n: number) => id(1, n);
const role = (n: number) => id(4, n);
const who = (name: string) => `${NAME} ${name}`;

const LE = { email: "le.qa5-api@teste.invalid", password: PASSWORD };
const CM = { email: "cm.qa5-api@teste.invalid", password: PASSWORD };
const MB = { email: "mb.qa5-api@teste.invalid", password: PASSWORD };
const BRUNO = { email: "bruno.qa5-api@teste.invalid", password: PASSWORD };
const ACCOUNTS = [LE, CM, MB, BRUNO];

const DORA_MOBILE = "(51) 97777-0401";
const GIL_CPF = "111.444.777-35";
const FABIO_EMAIL = "fabio.qa5-api@teste.invalid";

let env: E2EEnv;
let adminId = "";
const tokens: { ad: string; le: string; cm: string; mb: string } = { ad: "", le: "", cm: "", mb: "" };
/** E-mails das contas criadas pelos testes (apagadas no fim). */
const createdEmails: string[] = [];

async function tokenOf({ email, password }: Credentials): Promise<string> {
  // Pela função `sign-in` (E1.04): o login direto no Auth fica desligado (RN-14).
  const response = await fetch(`${env.apiUrl}/functions/v1/sign-in`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  const body: unknown = await response.json();
  const session = typeof body === "object" && body !== null && "session" in body ? body.session : null;
  const token =
    typeof session === "object" && session !== null && "access_token" in session ? session.access_token : null;
  if (typeof token !== "string") throw new Error(`login de ${email} falhou (${response.status})`);
  return token;
}

interface Reply {
  status: number;
  /** O texto cru da resposta (para conferir o que NÃO sai do servidor). */
  text: string;
  body: Record<string, unknown>;
}

/** A Edge Function, com o token de quem chama. */
async function createUser(token: string | null, payload: object): Promise<Reply> {
  const response = await fetch(`${env.apiUrl}/functions/v1/create-user-admin`, {
    method: "POST",
    headers: {
      apikey: env.publishableKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) body = Object.fromEntries(Object.entries(parsed));
  } catch {
    // corpo que não é JSON: fica vazio
  }
  return { status: response.status, text, body };
}

const request = (email: string, memberData: Record<string, unknown>, extra: object = {}) => ({
  email,
  password: "Senha#2026",
  memberData: { gender: "M", is_active: true, ...memberData },
  ...extra,
});

const accounts = (email: string) => Number(sql(env, `SELECT count(*) FROM auth.users WHERE email = ${lit(email)}`));
const membersNamed = (name: string) => Number(sql(env, `SELECT count(*) FROM public.members WHERE name = ${lit(name)}`));
const matchesOf = (reply: Reply): Array<Record<string, unknown>> =>
  Array.isArray(reply.body.matches) ? reply.body.matches.filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null) : [];

function cleanup() {
  const actors = ACCOUNTS.map((a) => lit(a.email)).join(", ");
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events
      WHERE entity_id::text LIKE '${PREFIX}%'
         OR entity_label LIKE '${NAME}%'
         OR metadata ->> 'member_id' LIKE '${PREFIX}%'
         OR actor_user_id IN (SELECT id FROM auth.users WHERE email IN (${actors}));
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%';
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     COMMIT;`,
  );
}

async function removeAccounts() {
  for (const email of [...ACCOUNTS.map((a) => a.email), ...createdEmails]) {
    const userId = authIdOf(env, email);
    if (userId) await deleteAuthUser(env, userId);
  }
}

const permissions = (roleNumber: number, list: readonly string[]) =>
  `SELECT ${lit(role(roleNumber))}::uuid, p::public.permission_action FROM unnest(ARRAY[${list.map(lit).join(", ")}]) p`;

test.beforeAll(async () => {
  env = e2eEnv();
  // A função precisa estar servida: sem ela, os testes não têm o que provar.
  const probe = await fetch(`${env.apiUrl}/functions/v1/create-user-admin`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => null);
  test.skip(!probe || probe.status !== 401, "Sirva a create-user-admin na stack local (supabase functions serve).");

  cleanup();
  await removeAccounts();
  adminId = authIdOf(env, env.admin.email);
  const auth = {
    le: await createAuthUser(env, LE.email, LE.password),
    cm: await createAuthUser(env, CM.email, CM.password),
    mb: await createAuthUser(env, MB.email, MB.password),
    bruno: await createAuthUser(env, BRUNO.email, BRUNO.password),
  };
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES
       (${lit(role(1))}, '${NAME} LE'), (${lit(role(2))}, '${NAME} CM'), (${lit(role(3))}, '${NAME} MB');
     INSERT INTO public.role_permissions (role_id, permission)
     ${permissions(1, ["view_members", "view_all_church", "view_dashboard", "create_member", "delete_member"])}
     UNION ALL ${permissions(2, ["view_members", "view_all_church", "view_dashboard", "create_member"])}
     UNION ALL ${permissions(3, ["view_dashboard", "view_members", "view_all_church"])};
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id, auth_user_id, email, mobile_whatsapp, cpf) VALUES
       (${lit(member(90))}, ${lit(who("Lia Lopes"))}, 'F', false, true, ${lit(role(1))}, ${lit(auth.le)}, ${lit(LE.email)}, NULL, NULL),
       (${lit(member(91))}, ${lit(who("Caio Mota"))}, 'M', false, true, ${lit(role(2))}, ${lit(auth.cm)}, ${lit(CM.email)}, NULL, NULL),
       (${lit(member(92))}, ${lit(who("Mauro Melo"))}, 'M', false, true, ${lit(role(3))}, ${lit(auth.mb)}, ${lit(MB.email)}, NULL, NULL),
       (${lit(member(1))}, ${lit(who("Bruno Almeida"))}, 'M', false, true, ${lit(role(3))}, ${lit(auth.bruno)}, ${lit(BRUNO.email)}, NULL, NULL),
       (${lit(member(2))}, ${lit(who("Dora Reis"))}, 'F', false, true, ${lit(role(3))}, NULL, NULL, ${lit(DORA_MOBILE)}, NULL),
       (${lit(member(3))}, ${lit(who("Gil Souza"))}, 'M', false, true, ${lit(role(3))}, NULL, NULL, NULL, ${lit(GIL_CPF)}),
       (${lit(member(4))}, ${lit(who("Fábio Reis"))}, 'M', false, true, ${lit(role(3))}, NULL, ${lit(FABIO_EMAIL)}, NULL, NULL);
     COMMIT;`,
  );
  rpcsAs(env, adminId, [1, 2, 3, 4].map((n) => `public.delete_member(${lit(member(n))})`));
  sql(env, `UPDATE public.members SET deleted_at = '2026-11-10T15:00:00Z' WHERE id = ${lit(member(1))}`);
  tokens.ad = await tokenOf(env.admin);
  tokens.le = await tokenOf(LE);
  tokens.cm = await tokenOf(CM);
  tokens.mb = await tokenOf(MB);
});

test.afterAll(async () => {
  if (!env) return;
  // Contas e cadastros criados pelos testes.
  for (const email of createdEmails) {
    const userId = authIdOf(env, email);
    if (userId) await deleteAuthUser(env, userId);
  }
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE '${NAME}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email IN (${[...ACCOUNTS.map((a) => a.email), ...createdEmails].map(lit).join(", ")}))`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

/** Um e-mail novo, que será apagado no fim. */
const freshEmail = (tag: string) => {
  const email = `${tag}.qa5-api@teste.invalid`;
  createdEmails.push(email);
  return email;
};

test.describe("RN-18 / critério de pronto 8: 409 antes de criar a conta, e a confirmação", () => {
  test("Dado um excluído com o celular, quando CM cadastra sem confirmar, então 409 deleted_matches, sem nome nem id, e nenhuma conta nem membro é criado", async () => {
    const email = freshEmail("novo1");
    const name = who("Novo Celular CM");
    const reply = await createUser(tokens.cm, request(email, { name, mobile_whatsapp: DORA_MOBILE }));

    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe("deleted_matches");
    expect(typeof reply.body.error).toBe("string");
    const matches = matchesOf(reply);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ member_id: null, name: null, deleted_at: null, matched_fields: ["mobile"], is_account_email: false });
    expect(reply.text, "o nome do excluído não sai do servidor").not.toContain("Dora");
    expect(reply.text).not.toContain(member(2));
    expect(accounts(email), "nenhuma conta no Auth").toBe(0);
    expect(membersNamed(name), "nenhum membro").toBe(0);
  });

  test("Dado o mesmo cadastro, quando AD o envia sem confirmar, então 409 com nome, id e data do excluído (e nada é criado)", async () => {
    const email = freshEmail("novo2");
    const name = who("Novo Celular AD");
    const reply = await createUser(tokens.ad, request(email, { name, mobile_whatsapp: DORA_MOBILE }));

    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe("deleted_matches");
    expect(matchesOf(reply)).toEqual([
      expect.objectContaining({ member_id: member(2), name: who("Dora Reis"), matched_fields: ["mobile"], is_account_email: false }),
    ]);
    expect(typeof matchesOf(reply)[0].deleted_at).toBe("string");
    expect(accounts(email)).toBe(0);
    expect(membersNamed(name)).toBe(0);
  });

  test("Dado o celular de um excluído, quando o corpo traz confirmDeletedMatches: true, então cria a conta e o membro", async () => {
    const email = freshEmail("novo3");
    const name = who("Novo Celular Confirmado");
    const reply = await createUser(tokens.cm, request(email, { name, mobile_whatsapp: DORA_MOBILE }, { confirmDeletedMatches: true }));

    expect(reply.status).toBe(200);
    expect(accounts(email)).toBe(1);
    expect(membersNamed(name)).toBe(1);
    expect(sql(env, `SELECT count(*) FROM public.members WHERE id = ${lit(member(2))} AND deleted_at IS NOT NULL`), "o excluído continua excluído").toBe("1");
  });

  test("Dado o celular de um excluído, quando a confirmação não é booleana (texto, 1), então vale como não confirmada", async () => {
    for (const [index, confirm] of ["true", 1, "sim"].entries()) {
      const email = freshEmail(`novo4${index}`);
      const name = who(`Novo Texto ${index}`);
      const reply = await createUser(tokens.cm, request(email, { name, mobile_whatsapp: DORA_MOBILE }, { confirmDeletedMatches: confirm }));
      expect(reply.status, `confirmação ${JSON.stringify(confirm)}`).toBe(409);
      expect(accounts(email)).toBe(0);
      expect(membersNamed(name)).toBe(0);
    }
  });

  test("Dado o CPF de um excluído (digitado só com números), quando CM cadastra, então 409; com confirmação, cria", async () => {
    const email = freshEmail("novo5");
    const name = who("Novo Cpf");
    const refused = await createUser(tokens.cm, request(email, { name, cpf: GIL_CPF.replace(/\D/g, "") }));
    expect(refused.status).toBe(409);
    expect(matchesOf(refused)[0]).toMatchObject({ name: null, matched_fields: ["cpf"] });
    expect(accounts(email)).toBe(0);

    const created = await createUser(tokens.cm, request(email, { name, cpf: GIL_CPF.replace(/\D/g, "") }, { confirmDeletedMatches: true }));
    expect(created.status).toBe(200);
    expect(accounts(email)).toBe(1);
  });

  test("Dado o e-mail de um excluído sem conta, quando AD cadastra, então é uma correspondência comum (409 deleted_matches) que a confirmação libera", async () => {
    const name = who("Novo Email Sem Conta");
    const refused = await createUser(tokens.ad, request(FABIO_EMAIL, { name }));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("deleted_matches");
    expect(matchesOf(refused)[0]).toMatchObject({ name: who("Fábio Reis"), matched_fields: ["email"], is_account_email: false });
    expect(accounts(FABIO_EMAIL)).toBe(0);

    createdEmails.push(FABIO_EMAIL);
    const created = await createUser(tokens.ad, request(FABIO_EMAIL, { name }, { confirmDeletedMatches: true }));
    expect(created.status).toBe(200);
    expect(accounts(FABIO_EMAIL)).toBe(1);
  });

  test("Dado o e-mail da conta de um excluído, quando AD ou CM cadastram, então 409 deleted_account_email, com ou sem confirmação, e nenhuma conta nova", async () => {
    const before = accounts(BRUNO.email);
    expect(before, "a conta do excluído continua existindo (RN-14)").toBe(1);
    for (const [label, token] of [["AD", tokens.ad], ["CM", tokens.cm]] as const) {
      for (const confirm of [undefined, true]) {
        const name = who(`Novo Email Conta ${label} ${String(confirm)}`);
        const reply = await createUser(token, request(BRUNO.email.toUpperCase(), { name }, confirm === undefined ? {} : { confirmDeletedMatches: confirm }));
        expect(reply.status, `${label} confirm=${String(confirm)}`).toBe(409);
        expect(reply.body.code).toBe("deleted_account_email");
        expect(reply.body.field).toBe("email");
        expect(membersNamed(name)).toBe(0);
        expect(accounts(BRUNO.email), "nenhuma conta nova").toBe(before);
        if (label === "CM") {
          expect(reply.text, "o nome do excluído não sai do servidor").not.toContain("Bruno");
          expect(reply.text).not.toContain(member(1));
          expect(matchesOf(reply).every((m) => m.name === null && m.member_id === null && m.deleted_at === null)).toBe(true);
        } else {
          expect(matchesOf(reply)[0]).toMatchObject({ member_id: member(1), name: who("Bruno Almeida"), is_account_email: true });
        }
      }
    }
  });

  test("Dado o e-mail da conta de um excluído e o celular de outro, quando LE confirma, então continua recusado", async () => {
    const name = who("Novo Email E Celular");
    const reply = await createUser(tokens.le, request(BRUNO.email, { name, mobile_whatsapp: DORA_MOBILE }, { confirmDeletedMatches: true }));
    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe("deleted_account_email");
    expect(membersNamed(name)).toBe(0);
  });

  test("Dado um e-mail fictício do formulário e nenhum dado de excluído, então cria sem aviso", async () => {
    const email = freshEmail("fake").replace("@teste.invalid", "@mci12fakemail.com");
    createdEmails[createdEmails.length - 1] = email;
    const reply = await createUser(tokens.cm, request(email, { name: who("Novo Fictício") }));
    expect(reply.status).toBe(200);
    expect(accounts(email)).toBe(1);
  });

  test("Dado quem não tem create_member (MB) ou não está logado, então 403 e 401, sem correspondências", async () => {
    const forbidden = await createUser(tokens.mb, request("mb-tenta.qa5-api@teste.invalid", { name: who("Novo MB"), mobile_whatsapp: DORA_MOBILE }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.matches).toBeUndefined();
    expect(forbidden.text).not.toContain("Dora");
    const anonymous = await createUser(null, request("anon.qa5-api@teste.invalid", { name: who("Novo Anônimo"), mobile_whatsapp: DORA_MOBILE }));
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.matches).toBeUndefined();
    expect(accounts("mb-tenta.qa5-api@teste.invalid") + accounts("anon.qa5-api@teste.invalid")).toBe(0);
  });
});
