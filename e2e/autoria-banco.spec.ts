import { test, expect } from "@playwright/test";
import { authIdOf, e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";

// E2.05 (PR 1, banco): a autoria pelos caminhos que o pgTAP não alcança, na stack local, pela API.
//   - RN-02: o cadastro pela `create-user-admin` fica com quem chamou como autor (a função grava com a
//     sessão de quem chama), no registro e no evento;
//   - RN-03: PATCH pelo PostgREST com autor e datas forjados: aceito, e o forjado é ignorado;
//   - RN-14: com a Auditoria quebrada (um trigger em events que levanta um erro interno, criado e apagado
//     pelo teste), a `create-user-admin` recusa no ensaio, antes da conta, com a resposta da tabela do E2.04
//     para erro desconhecido do banco (400 "Não foi possível salvar o cadastro."; o spec previa 500), e não
//     cria a conta nem o cadastro; de volta, a nova tentativa (o mesmo attemptId) grava uma vez só. (O pgTAP quebra a Auditoria com um CHECK: aqui, um
//     CHECK viraria o 400 "valor inválido" da tabela de respostas do E2.04, que não é o caso a provar.)
// Precisa da `create-user-admin` servida (sem ela, os testes são pulados). Massa fictícia "E205 Api …",
// apagada no começo e no fim. Roda em série.

test.describe.configure({ mode: "serial" });

const NAME = "E205 Api";
const BROKEN = "e2e205_broken";
let env: E2EEnv;
let adminAuth = "";
let adminMember = "";
let token = "";

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${env.apiUrl}/functions/v1/sign-in`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  const body: unknown = await response.json();
  const session = typeof body === "object" && body !== null && "session" in body ? body.session : null;
  const access = typeof session === "object" && session !== null && "access_token" in session ? session.access_token : null;
  if (typeof access !== "string") throw new Error(`login falhou (${response.status})`);
  return access;
}

async function createUser(attemptId: string, name: string, mobile: string) {
  const response = await fetch(`${env.apiUrl}/functions/v1/create-user-admin`, {
    method: "POST",
    headers: { apikey: env.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      attemptId,
      password: "Autoria#2026x",
      memberData: { name, gender: "F", mobile_whatsapp: mobile, leader_id: adminMember, is_active: true },
    }),
  });
  return { status: response.status, text: await response.text() };
}

const count = (query: string) => Number(sql(env, query));

/** A Auditoria quebrada: todo evento novo falha com um erro interno (XX000). */
const breakAudit = () =>
  sql(
    env,
    `CREATE OR REPLACE FUNCTION public.${BROKEN}() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'auditoria fora do ar (teste)' USING ERRCODE = 'XX000'; END $$;
     CREATE TRIGGER ${BROKEN} BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.${BROKEN}();`,
  );
const unbreak = () =>
  sql(env, `DROP TRIGGER IF EXISTS ${BROKEN} ON public.events; DROP FUNCTION IF EXISTS public.${BROKEN}();`);

function cleanup() {
  unbreak();
  const ids = sql(env, `SELECT id FROM public.members WHERE name LIKE '${NAME}%'`).split("\n").filter(Boolean);
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_label LIKE '${NAME}%';
     DELETE FROM public.members WHERE name LIKE '${NAME}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
     ${ids.length ? `DELETE FROM private.account_passwords WHERE auth_user_id IN (${ids.map(lit).join(", ")});` : ""}
     ${ids.length ? `DELETE FROM auth.users WHERE id IN (${ids.map(lit).join(", ")});` : ""}
     COMMIT;
     SELECT private.rebuild_member_hierarchy();`,
  );
}

test.beforeAll(async () => {
  env = e2eEnv();
  const probe = await fetch(`${env.apiUrl}/functions/v1/create-user-admin`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => null);
  test.skip(!probe || probe.status !== 401, "Sirva a create-user-admin na stack local (supabase functions serve).");
  cleanup();
  adminAuth = authIdOf(env, env.admin.email);
  adminMember = sql(env, `SELECT id FROM public.members WHERE auth_user_id = ${lit(adminAuth)}`);
  token = await signIn(env.admin.email, env.admin.password);
});

test.afterAll(() => {
  if (env) cleanup();
});

test("RN-02: o cadastro pela create-user-admin é de quem chamou, no registro e no evento", async () => {
  const attempt = crypto.randomUUID();
  const reply = await createUser(attempt, `${NAME} Clara Autoria`, "(51) 92050-9901");
  expect(reply.status, reply.text).toBe(200);
  const row = sql(
    env,
    `SELECT created_by_kind || '|' || created_by || '|' || (updated_at IS NULL)::text
       FROM public.members WHERE id = ${lit(attempt)}`,
  );
  expect(row).toBe(`member|${adminMember}|true`);
  const event = sql(
    env,
    `SELECT action || '|' || actor_kind || '|' || actor_user_id || '|' || description
       FROM public.events WHERE entity = 'member' AND entity_id = ${lit(attempt)}`,
  );
  expect(event).toBe(`create|member|${adminAuth}|Cadastrou o membro ${NAME} Clara Autoria`);
});

test("RN-03: PATCH pelo PostgREST com autor e datas forjados é aceito, e o forjado é ignorado", async () => {
  const id = sql(env, `SELECT id FROM public.members WHERE name = '${NAME} Clara Autoria'`);
  const before = sql(env, `SELECT created_at::text || '|' || created_by FROM public.members WHERE id = ${lit(id)}`);
  const response = await fetch(`${env.apiUrl}/rest/v1/members?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: env.publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      notes: "alterada",
      created_at: "2020-01-01T00:00:00Z",
      created_by_kind: "legacy",
      created_by_legacy: "AdminUser",
      updated_at: "2020-01-02T00:00:00Z",
      updated_by_kind: "system",
    }),
  });
  expect(response.status).toBe(204);
  expect(sql(env, `SELECT created_at::text || '|' || created_by FROM public.members WHERE id = ${lit(id)}`)).toBe(before);
  expect(
    sql(
      env,
      `SELECT created_by_kind || '|' || updated_by_kind || '|' || updated_by || '|' || (updated_at > now() - interval '1 minute')::text
         FROM public.members WHERE id = ${lit(id)}`,
    ),
  ).toBe(`member|member|${adminMember}|true`);
});

test("RN-14: com a Auditoria quebrada, a create-user-admin recusa sem criar nada; a nova tentativa grava uma vez", async () => {
  const attempt = crypto.randomUUID();
  const name = `${NAME} Dora Quebra`;
  const accounts0 = count("SELECT count(*) FROM auth.users");
  breakAudit();
  try {
    const broken = await createUser(attempt, name, "(51) 92050-9902");
    expect(broken.status, broken.text).toBe(400);
    expect(JSON.parse(broken.text)).toEqual({ error: "Não foi possível salvar o cadastro." });
    expect(count("SELECT count(*) FROM auth.users")).toBe(accounts0);
    expect(count(`SELECT count(*) FROM public.members WHERE name = ${lit(name)}`)).toBe(0);
  } finally {
    unbreak();
  }
  const retry = await createUser(attempt, name, "(51) 92050-9902");
  expect(retry.status, retry.text).toBe(200);
  expect(count(`SELECT count(*) FROM public.members WHERE name = ${lit(name)}`)).toBe(1);
  expect(count(`SELECT count(*) FROM public.events WHERE entity = 'member' AND entity_id = ${lit(attempt)}`)).toBe(1);
  expect(count("SELECT count(*) FROM auth.users")).toBe(accounts0 + 1);
});
