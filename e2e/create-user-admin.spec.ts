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
/** Excluído que nenhum teste libera (os que o usam são só recusas). */
const HUGO_MOBILE = "(51) 97777-0402";
const GIL_CPF = "111.444.777-35";
const FABIO_EMAIL = "fabio.qa5-api@teste.invalid";
const MAURO_CPF = "529.982.247-25";

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

/**
 * Corpo do pedido no contrato do E2.04: o e-mail real (se houver) vai em `memberData.email`; a conta de
 * acesso usa sempre o e-mail técnico gerado pelo servidor. Todo cadastro tem líder (RN-12): Lia.
 */
const request = (email: string | null, memberData: Record<string, unknown>, extra: object = {}) => ({
  password: "Senha#2026",
  memberData: { gender: "M", is_active: true, leader_id: member(90), ...(email ? { email } : {}), ...memberData },
  ...extra,
});

/** Contas no Auth com este e-mail (as da massa e as de teste da função, que têm o e-mail técnico). */
const accounts = (email: string) => Number(sql(env, `SELECT count(*) FROM auth.users WHERE email = ${lit(email)}`));
/** Total de contas no Auth: uma recusa não pode deixar conta nova. */
const totalAccounts = () => Number(sql(env, "SELECT count(*) FROM auth.users"));
/** A conta do cadastro com este nome (o id da conta é o do membro). */
const accountOfMember = (name: string) =>
  Number(sql(env, `SELECT count(*) FROM auth.users u JOIN public.members m ON m.id = u.id WHERE m.name = ${lit(name)}`));
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

/** Apaga as contas das tentativas de teste: o id da conta é o do cadastro (DT-01). */
async function removeCreatedAccounts() {
  const ids = sql(env, `SELECT id FROM public.members WHERE name LIKE '${NAME}%' AND auth_user_id = id`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

async function removeAccounts() {
  await removeCreatedAccounts();
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

  await removeAccounts();
  cleanup();
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
     ${permissions(1, ["view_all_church", "view_dashboard", "create_member", "view_own_ministry", "edit_own_data", "submit_own_cell_report", "delete_member"])}
     UNION ALL ${permissions(2, ["view_all_church", "view_dashboard", "create_member", "view_own_ministry", "edit_own_data", "submit_own_cell_report"])}
     UNION ALL ${permissions(3, ["view_dashboard", "view_all_church"])};
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, role_id, auth_user_id, email, mobile_whatsapp, cpf) VALUES
       (${lit(member(90))}, ${lit(who("Lia Lopes"))}, 'F', false, true, ${lit(role(1))}, ${lit(auth.le)}, ${lit(LE.email)}, NULL, NULL),
       (${lit(member(91))}, ${lit(who("Caio Mota"))}, 'M', false, true, ${lit(role(2))}, ${lit(auth.cm)}, ${lit(CM.email)}, NULL, NULL),
       (${lit(member(92))}, ${lit(who("Mauro Melo"))}, 'M', false, true, ${lit(role(3))}, ${lit(auth.mb)}, ${lit(MB.email)}, NULL, ${lit(MAURO_CPF)}),
       (${lit(member(1))}, ${lit(who("Bruno Almeida"))}, 'M', false, true, ${lit(role(3))}, ${lit(auth.bruno)}, ${lit(BRUNO.email)}, NULL, NULL),
       (${lit(member(2))}, ${lit(who("Dora Reis"))}, 'F', false, true, ${lit(role(3))}, NULL, NULL, ${lit(DORA_MOBILE)}, NULL),
       (${lit(member(3))}, ${lit(who("Gil Souza"))}, 'M', false, true, ${lit(role(3))}, NULL, NULL, NULL, ${lit(GIL_CPF)}),
       (${lit(member(4))}, ${lit(who("Fábio Reis"))}, 'M', false, true, ${lit(role(3))}, NULL, ${lit(FABIO_EMAIL)}, NULL, NULL),
       (${lit(member(5))}, ${lit(who("Hugo Lima"))}, 'M', false, true, ${lit(role(3))}, NULL, NULL, ${lit(HUGO_MOBILE)}, NULL);
     COMMIT;`,
  );
  rpcsAs(env, adminId, [1, 2, 3, 4, 5].map((n) => `public.delete_member(${lit(member(n))})`));
  sql(env, `UPDATE public.members SET deleted_at = '2026-11-10T15:00:00Z' WHERE id = ${lit(member(1))}`);
  tokens.ad = await tokenOf(env.admin);
  tokens.le = await tokenOf(LE);
  tokens.cm = await tokenOf(CM);
  tokens.mb = await tokenOf(MB);
});

test.afterAll(async () => {
  if (!env) return;
  // Contas e cadastros criados pelos testes (as contas primeiro: o id delas é o do cadastro).
  await removeAccounts();
  cleanup();
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
    const accountsBefore = totalAccounts();
    const reply = await createUser(tokens.cm, request(email, { name, mobile_whatsapp: DORA_MOBILE }));

    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe("deleted_matches");
    expect(typeof reply.body.error).toBe("string");
    const matches = matchesOf(reply);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ member_id: null, name: null, deleted_at: null, matched_fields: ["mobile"], is_account_email: false });
    expect(reply.text, "o nome do excluído não sai do servidor").not.toContain("Dora");
    expect(reply.text).not.toContain(member(2));
    expect(totalAccounts(), "nenhuma conta nova no Auth").toBe(accountsBefore);
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
    expect(membersNamed(name)).toBe(0);
  });

  test("Dado o celular de um excluído, quando o corpo traz confirmDeletedMatches: true, então cria a conta e o membro", async () => {
    const email = freshEmail("novo3");
    const name = who("Novo Celular Confirmado");
    const reply = await createUser(tokens.cm, request(email, { name, mobile_whatsapp: DORA_MOBILE }, { confirmDeletedMatches: true }));

    expect(reply.status).toBe(200);
    expect(accountOfMember(name), "a conta tem o id do cadastro").toBe(1);
    expect(membersNamed(name)).toBe(1);
    expect(sql(env, `SELECT count(*) FROM public.members WHERE id = ${lit(member(2))} AND deleted_at IS NOT NULL`), "o excluído continua excluído").toBe("1");
  });

  test("Dado o celular de um excluído, quando a confirmação não é booleana (texto, 1), então vale como não confirmada", async () => {
    for (const [index, confirm] of ["true", 1, "sim"].entries()) {
      const email = freshEmail(`novo4${index}`);
      const name = who(`Novo Texto ${index}`);
      const reply = await createUser(tokens.cm, request(email, { name, mobile_whatsapp: DORA_MOBILE }, { confirmDeletedMatches: confirm }));
      expect(reply.status, `confirmação ${JSON.stringify(confirm)}`).toBe(409);
      expect(membersNamed(name)).toBe(0);
    }
  });

  test("Dado o CPF de um excluído (digitado só com números), quando CM cadastra, então 409; com confirmação, cria", async () => {
    const email = freshEmail("novo5");
    const name = who("Novo Cpf");
    const refused = await createUser(tokens.cm, request(email, { name, cpf: GIL_CPF.replace(/\D/g, "") }));
    expect(refused.status).toBe(409);
    expect(matchesOf(refused)[0]).toMatchObject({ name: null, matched_fields: ["cpf"] });
    expect(membersNamed(name)).toBe(0);

    const created = await createUser(tokens.cm, request(email, { name, cpf: GIL_CPF.replace(/\D/g, "") }, { confirmDeletedMatches: true }));
    expect(created.status).toBe(200);
    expect(accountOfMember(name)).toBe(1);
  });

  test("Dado o e-mail de um excluído sem conta, quando AD cadastra, então é uma correspondência comum (409 deleted_matches) que a confirmação libera", async () => {
    const name = who("Novo Email Sem Conta");
    const refused = await createUser(tokens.ad, request(FABIO_EMAIL, { name }));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("deleted_matches");
    expect(matchesOf(refused)[0]).toMatchObject({ name: who("Fábio Reis"), matched_fields: ["email"], is_account_email: false });
    expect(membersNamed(name)).toBe(0);

    const created = await createUser(tokens.ad, request(FABIO_EMAIL, { name }, { confirmDeletedMatches: true }));
    expect(created.status).toBe(200);
    expect(accountOfMember(name), "a conta tem o e-mail técnico, não o e-mail real (DA-1)").toBe(1);
    expect(accounts(FABIO_EMAIL), "o e-mail real não vira conta").toBe(0);
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
        // E2.04: a recusa vem do ensaio (check_member_insert), e a função acrescenta as
        // correspondências como no E2.01 (RN-18, UX-31): nome e id só para quem vê o excluído.
        if (label === "CM") {
          expect(reply.text, "o nome do excluído não sai do servidor").not.toContain("Bruno");
          expect(reply.text).not.toContain(member(1));
          expect(matchesOf(reply).length).toBeGreaterThan(0);
          expect(matchesOf(reply).every((m) => m.name === null && m.member_id === null && m.deleted_at === null)).toBe(true);
          expect(matchesOf(reply).some((m) => m.is_account_email === true)).toBe(true);
        } else {
          expect(matchesOf(reply)[0]).toMatchObject({ member_id: member(1), name: who("Bruno Almeida"), is_account_email: true });
        }
        expect(reply.body.error).toBe("Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.");
      }
    }
  });

  test("Dado o e-mail da conta de um excluído e o celular de outro, quando LE confirma, então continua recusado", async () => {
    const name = who("Novo Email E Celular");
    const reply = await createUser(tokens.le, request(BRUNO.email, { name, mobile_whatsapp: HUGO_MOBILE }, { confirmDeletedMatches: true }));
    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe("deleted_account_email");
    expect(membersNamed(name)).toBe(0);
  });

  test("RN-05: dado um e-mail fictício vindo do formulário, então 400 email_placeholder, sem conta nem cadastro", async () => {
    const accountsBefore = totalAccounts();
    const name = who("Novo Fictício");
    const reply = await createUser(tokens.cm, request("novo.fake@mci12fakemail.com", { name }));
    expect(reply.status).toBe(400);
    expect(reply.body.code).toBe("email_placeholder");
    expect(reply.body.field).toBe("email");
    expect(reply.body.error).toBe("Este e-mail não pode ser usado. Informe um e-mail real ou deixe o campo em branco.");
    expect(membersNamed(name)).toBe(0);
    expect(totalAccounts()).toBe(accountsBefore);
  });

  test("Dado quem não tem create_member (MB) ou não está logado, então 403 e 401, sem correspondências", async () => {
    const forbidden = await createUser(tokens.mb, request("mb-tenta.qa5-api@teste.invalid", { name: who("Novo MB"), mobile_whatsapp: DORA_MOBILE }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.matches).toBeUndefined();
    expect(forbidden.text).not.toContain("Dora");
    const anonymous = await createUser(null, request("anon.qa5-api@teste.invalid", { name: who("Novo Anônimo"), mobile_whatsapp: DORA_MOBILE }));
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.matches).toBeUndefined();
    expect(membersNamed(who("Novo MB")) + membersNamed(who("Novo Anônimo"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E2.04 (PR 2): o contrato novo da função: tentativa repetida (idempotência), corrida do CPF, recusas
// das regras sem criar conta, ordem das recusas (RN-10), conta com id = membro e e-mail técnico, e o
// login pela `sign-in` com o celular (RN-05).
// ---------------------------------------------------------------------------
/** UUID v4 fixo para a tentativa (o formato que a função aceita). */
const attempt = (n: number) => `${PREFIX}-0005-4000-8000-${String(n).padStart(12, "0")}`;
const newAttemptId = () => crypto.randomUUID();

test.describe("E2.04 PR 2: contrato novo da create-user-admin", () => {
  test("DA-10, DT-11: a mesma tentativa duas vezes em sequência: um cadastro, uma conta e replayed: true na segunda", async () => {
    const name = who("Tentativa Sequencia");
    const id = newAttemptId();
    const payload = { ...request(null, { name, mobile_whatsapp: "(51) 98888-0701" }), attemptId: id };
    const first = await createUser(tokens.cm, payload);
    const second = await createUser(tokens.cm, payload);

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ member: { id }, replayed: false });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ member: { id }, replayed: true });
    expect(membersNamed(name), "um só cadastro").toBe(1);
    expect(accountOfMember(name), "uma só conta").toBe(1);
    expect(sql(env, `SELECT count(*) FROM auth.users WHERE id = ${lit(id)}`)).toBe("1");
  });

  test("DA-10, DT-11: a mesma tentativa duas vezes em paralelo: um cadastro, uma conta, uma resposta nova e uma replayed", async () => {
    const name = who("Tentativa Paralela");
    const id = newAttemptId();
    const payload = { ...request(null, { name, mobile_whatsapp: "(51) 98888-0702" }), attemptId: id };
    const [a, b] = await Promise.all([createUser(tokens.cm, payload), createUser(tokens.cm, payload)]);

    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([200, 200]);
    const replayed = [a.body.replayed, b.body.replayed].sort();
    expect(replayed, "uma criou e a outra devolveu o mesmo cadastro").toEqual([false, true]);
    expect(a.body.member).toEqual({ id });
    expect(b.body.member).toEqual({ id });
    expect(membersNamed(name)).toBe(1);
    expect(accountOfMember(name)).toBe(1);
  });

  test("RN-09, DT-07: dois cadastros com o mesmo CPF ao mesmo tempo: só um é gravado e só uma conta fica no Auth", async () => {
    const cpf = "390.533.447-05";
    const nameA = who("Corrida Cpf A");
    const nameB = who("Corrida Cpf B");
    const before = totalAccounts();
    const [a, b] = await Promise.all([
      createUser(tokens.cm, request(null, { name: nameA, cpf })),
      createUser(tokens.ad, request(null, { name: nameB, cpf: "39053344705" })),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses, JSON.stringify([a.body, b.body])).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe("value_in_use");
    expect(loser.body.fields).toEqual(["cpf"]);
    expect(loser.body.error).toBe("Este CPF já está sendo usado por outro cadastro.");
    expect(membersNamed(nameA) + membersNamed(nameB), "só um cadastro").toBe(1);
    expect(totalAccounts() - before, "só uma conta nova no Auth, sem órfã").toBe(1);
    expect(sql(env, `SELECT count(*) FROM public.members WHERE cpf = '39053344705' AND deleted_at IS NULL`)).toBe("1");
  });

  test("RN-10: e-mail e CPF em uso: 409 value_in_use com os dois campos, sem nome nem id do outro, e nenhuma conta", async () => {
    const name = who("Dois Campos");
    const before = totalAccounts();
    const reply = await createUser(tokens.cm, request(LE.email, { name, cpf: MAURO_CPF }));

    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe("value_in_use");
    expect(reply.body.fields).toEqual(["email", "cpf"]);
    expect(reply.body.error).toBe("Este e-mail já está sendo usado por outro cadastro.");
    expect(reply.text, "nada do outro cadastro").not.toMatch(/Lia|Mauro|e2e201f0/);
    expect(membersNamed(name)).toBe(0);
    expect(totalAccounts()).toBe(before);
  });

  test("RN-10: dado em uso e dado de excluído ao mesmo tempo: vale value_in_use, e deleted_matches só aparece depois que nada está em uso", async () => {
    const name = who("Uso E Excluido");
    const before = totalAccounts();
    const refused = await createUser(tokens.ad, request(LE.email, { name, mobile_whatsapp: HUGO_MOBILE }));
    expect(refused.status).toBe(409);
    expect(refused.body.code, "o dado em uso vem primeiro").toBe("value_in_use");
    expect(refused.body.matches).toBeUndefined();

    const afterFix = await createUser(tokens.ad, request(null, { name, mobile_whatsapp: HUGO_MOBILE }));
    expect(afterFix.status).toBe(409);
    expect(afterFix.body.code, "sem nada em uso, vem o aviso do excluído").toBe("deleted_matches");
    expect(membersNamed(name)).toBe(0);
    expect(totalAccounts()).toBe(before);
  });

  test("RN-02, RN-03, RN-07, RN-12: as recusas das regras chegam com código e campo, sem conta e sem cadastro", async () => {
    const before = totalAccounts();
    const cases: Array<[string, Record<string, unknown>, string, string]> = [
      ["Nome Um", { name: "Ana", mobile_whatsapp: "(51) 98888-0711" }, "name_invalid", "name"],
      ["Sem Sexo", { name: who("Sem Sexo"), gender: "", mobile_whatsapp: "(51) 98888-0712" }, "gender_required", "gender"],
      ["Cpf Ruim", { name: who("Cpf Ruim"), cpf: "111.111.111-11" }, "cpf_invalid", "cpf"],
      ["Celular Ruim", { name: who("Celular Ruim"), mobile_whatsapp: "98888-1234" }, "mobile_invalid", "mobile_whatsapp"],
      ["Sem Identificacao", { name: who("Sem Identificacao") }, "identifier_required", "identification"],
      ["Sem Lider", { name: who("Sem Lider"), mobile_whatsapp: "(51) 98888-0713", leader_id: null }, "leader_required", "leader_id"],
    ];
    for (const [label, data, code, field] of cases) {
      const reply = await createUser(tokens.ad, request(null, data));
      expect(reply.status, `${label}: ${reply.text}`).toBe(400);
      expect(reply.body.code, label).toBe(code);
      expect(reply.body.field, label).toBe(field);
      expect(typeof reply.body.error, label).toBe("string");
    }
    expect(membersNamed(who("Sem Sexo")) + membersNamed(who("Cpf Ruim")) + membersNamed(who("Celular Ruim")) + membersNamed(who("Sem Identificacao")) + membersNamed(who("Sem Lider"))).toBe(0);
    expect(totalAccounts(), "nenhuma conta criada em nenhuma recusa").toBe(before);
  });

  test("RN-01 (leitura técnica): sem create_member, 403 antes de qualquer regra, e nenhuma conta", async () => {
    const before = totalAccounts();
    const reply = await createUser(tokens.mb, request(null, { name: "Ana", gender: "", cpf: "000", mobile_whatsapp: "1" }));
    expect(reply.status).toBe(403);
    expect(reply.body.code).toBe("forbidden");
    expect(totalAccounts()).toBe(before);
  });

  test("DA-10: um attemptId que já é de um cadastro que quem chama não vê: 409 attempt_already_used; o que vê: replayed", async () => {
    // Um cadastro excluído com o id da tentativa (CM não o vê) e um ativo (CM o vê).
    sql(
      env,
      `BEGIN; SET LOCAL session_replication_role = replica;
       INSERT INTO public.members (id, name, gender, has_leadership, is_active, mobile_whatsapp, deleted_at) VALUES
         (${lit(attempt(1))}, ${lit(who("Tentativa Excluida"))}, 'M', false, true, '51988880721', now()),
         (${lit(attempt(2))}, ${lit(who("Tentativa Visivel"))}, 'M', false, true, '51988880722', NULL);
       COMMIT;`,
    );
    const hidden = await createUser(tokens.cm, { ...request(null, { name: who("Outro Nome"), mobile_whatsapp: "(51) 98888-0723" }), attemptId: attempt(1) });
    expect(hidden.status).toBe(409);
    expect(hidden.body.code).toBe("attempt_already_used");
    expect(hidden.body.error).toBe("Este cadastro já foi enviado. Confira na lista de Membros.");
    const seen = await createUser(tokens.cm, { ...request(null, { name: who("Outro Nome 2"), mobile_whatsapp: "(51) 98888-0724" }), attemptId: attempt(2) });
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual({ member: { id: attempt(2) }, replayed: true });
    expect(membersNamed(who("Outro Nome")) + membersNamed(who("Outro Nome 2"))).toBe(0);
  });

  test("DA-1, RN-05: o cadastro só com celular tem members.email nulo, a conta tem id = membro e o e-mail técnico, e o login pela sign-in com o celular funciona", async () => {
    const name = who("Só Celular");
    const mobile = "(51) 98888-0731";
    const reply = await createUser(tokens.cm, request(null, { name, mobile_whatsapp: mobile }));
    expect(reply.status).toBe(200);
    const id = String((reply.body.member as { id: string }).id);

    expect(sql(env, `SELECT coalesce(email, '<nulo>') FROM public.members WHERE id = ${lit(id)}`), "members.email nulo").toBe("<nulo>");
    expect(sql(env, `SELECT email FROM auth.users WHERE id = ${lit(id)}`), "e-mail técnico da conta").toBe(`${id}@mci12fakemail.com`);
    expect(sql(env, `SELECT count(*) FROM public.members WHERE id = ${lit(id)} AND auth_user_id = ${lit(id)}`), "auth_user_id = id").toBe("1");
    expect(sql(env, `SELECT mobile_whatsapp FROM public.members WHERE id = ${lit(id)}`)).toBe("51988880731");

    sql(env, "DELETE FROM private.sign_in_throttle;");
    const login = await fetch(`${env.apiUrl}/functions/v1/sign-in`, {
      method: "POST",
      headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: mobile, password: "Senha#2026" }),
    });
    const body: Record<string, unknown> = await login.json();
    expect(login.status, JSON.stringify(body)).toBe(200);
    expect(body.result).toBe("ok");
  });

  test("RN-04, RN-06, RN-07: o cadastro é gravado normalizado (e-mail, celular e CPF)", async () => {
    const name = who("Normalizado");
    const reply = await createUser(tokens.cm, request(" Normal.QA5@Teste.INVALID ", { name: `  ${name}  `, mobile_whatsapp: "+55 (51) 98888-0741", cpf: "012.345.678-90" }));
    expect(reply.status, reply.text).toBe(200);
    expect(sql(env, `SELECT concat_ws('|', name, email, mobile_whatsapp, cpf) FROM public.members WHERE id = ${lit((reply.body.member as { id: string }).id)}`))
      .toBe(`${name}|normal.qa5@teste.invalid|51988880741|01234567890`);
  });
});
