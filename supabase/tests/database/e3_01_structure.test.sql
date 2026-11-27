-- E3.01 (tarefa 2): a credencial legada. Estrutura, grants, RLS, a carga (add_legacy_credential),
-- o descarte por toda gravação de senha (write_password → discard_legacy_credential), a
-- reconciliação (legacy_credential_problems) e o contrato do card (dashboard_first_access).
-- Spec: docs/specs/e3-login-legado.md, "Modelo de dados e migrations", "Funções", DT-01, DT-02,
-- DT-05, DT-08, DT-09; RN-01, RN-03, RN-07, RN-10, RN-14.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(45);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a3010000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c3010000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.sqlstate(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;
CREATE FUNCTION pg_temp.as_role(_role text, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text := '00000';
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    _state := SQLSTATE;
    EXECUTE 'RESET ROLE';
  END;
  RETURN _state;
END $$;
CREATE FUNCTION pg_temp.cred(_n int) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT CASE WHEN c.legacy_hash IS NULL THEN 'discarded'
                               WHEN c.used_at IS NULL THEN 'pending' ELSE 'used' END
                     FROM private.legacy_credentials c WHERE c.member_id = pg_temp.m(_n)), 'none')
$$;
CREATE FUNCTION pg_temp.hash_of(_n int) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT legacy_hash FROM private.legacy_credentials WHERE member_id = pg_temp.m(_n) $$;

-- ===========================================================================
-- Estrutura e privilégios (DT-01, DT-02, RN-01)
-- ===========================================================================
SELECT has_table('private', 'legacy_credentials', 'DT-01: private.legacy_credentials existe');
SELECT columns_are('private', 'legacy_credentials', ARRAY['member_id', 'legacy_hash', 'loaded_at', 'used_at', 'discarded_at'],
  'RN-01: só o hash e as datas; nenhuma coluna de senha ou de MD5');
SELECT col_is_pk('private', 'legacy_credentials', 'member_id', 'Uma credencial por membro');
SELECT is((SELECT confdeltype::text FROM pg_constraint WHERE conrelid = 'private.legacy_credentials'::regclass AND contype = 'f'), 'a',
  'DEL-: a FK para members é NO ACTION (nada é apagado em cascata)');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'private.legacy_credentials'::regclass), true, 'RLS ligado');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private' AND tablename = 'legacy_credentials'), 0, 'Sem políticas');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                  unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
            WHERE has_table_privilege(r, 'private.legacy_credentials', p)), 0,
  'Nenhum privilégio para anon, authenticated ou service_role');
SELECT is((SELECT count(*)::int FROM pg_proc p, unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE p.oid IN ('private.add_legacy_credential(uuid, text)'::regprocedure,
                            'private.discard_legacy_credential(uuid)'::regprocedure,
                            'private.legacy_credential_problems()'::regprocedure)
              AND has_function_privilege(r, p.oid, 'EXECUTE')), 0,
  'As três funções internas sem EXECUTE para a API');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE prosecdef
            AND oid IN ('private.add_legacy_credential(uuid, text)'::regprocedure,
                        'private.discard_legacy_credential(uuid)'::regprocedure,
                        'private.legacy_credential_problems()'::regprocedure)), 0,
  'As três funções internas são SECURITY INVOKER (rodam como o dono ou como quem as chama de dentro de uma definer)');

-- Card (DT-09).
SELECT ok((SELECT prosecdef AND 'search_path=public' = ANY (proconfig) AND provolatile = 's'
             FROM pg_proc WHERE oid = 'public.dashboard_first_access()'::regprocedure),
  'DT-09: dashboard_first_access é SECURITY DEFINER, STABLE, search_path = public');
SELECT is(ARRAY[has_function_privilege('anon', 'public.dashboard_first_access()', 'EXECUTE'),
                has_function_privilege('authenticated', 'public.dashboard_first_access()', 'EXECUTE'),
                has_function_privilege('service_role', 'public.dashboard_first_access()', 'EXECUTE')],
  ARRAY[false, true, false], 'DT-09: EXECUTE só para authenticated');
SELECT ok((SELECT prosrc LIKE '%viewer_has(''view_all_church''%' FROM pg_proc WHERE oid = 'public.dashboard_first_access()'::regprocedure),
  'DT-09: confere view_all_church pela viewer_has (que passa pelo portão)');

-- ===========================================================================
-- Massa: pastor; 1..9 com conta; 10 sem conta; 11 excluído.
-- ===========================================================================
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.u(n), 'e301-' || n || '@teste.invalid', now() FROM generate_series(1, 11) n WHERE n <> 10;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, email)
VALUES (pg_temp.m(0), 'Pastor Estrutura', 'M', true, NULL, false, true, 'e301-0@exemplo.com');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, email)
SELECT pg_temp.m(n), 'Pessoa Estrutura', 'F', pg_temp.m(0), true, true,
       CASE WHEN n = 10 THEN NULL ELSE pg_temp.u(n) END, 'e301-' || n || '@exemplo.com'
  FROM generate_series(1, 11) n;
UPDATE public.members SET deleted_at = now() WHERE id = pg_temp.m(11);

-- CHECKs.
SELECT is(pg_temp.sqlstate(format($q$INSERT INTO private.legacy_credentials (member_id, legacy_hash) VALUES (%L, %L)$q$,
            pg_temp.m(9), extensions.crypt(md5('x'), extensions.gen_salt('bf', 12)))), '23514',
  'DT-02: só custo 10 (o mesmo tempo do cofre e do bcrypt fictício)');
SELECT is(pg_temp.sqlstate(format($q$INSERT INTO private.legacy_credentials (member_id, legacy_hash) VALUES (%L, %L)$q$,
            pg_temp.m(9), md5('x'))), '23514', 'RN-01: o MD5 legível não cabe na coluna');
SELECT is(pg_temp.sqlstate(format($q$INSERT INTO private.legacy_credentials (member_id, legacy_hash, discarded_at) VALUES (%L, NULL, NULL)$q$,
            pg_temp.m(9))), '23514', 'DT-01: hash nulo exige discarded_at');

-- ===========================================================================
-- Carga (RN-01, RN-03)
-- ===========================================================================
SELECT is(private.add_legacy_credential(gen_random_uuid(), md5('Senha#1')), 'not_eligible', 'RN-01: membro inexistente');
SELECT is(private.add_legacy_credential(pg_temp.m(10), md5('Senha#1')), 'not_eligible', 'RN-01 b: membro sem conta');
SELECT is(private.add_legacy_credential(pg_temp.m(11), md5('Senha#1')), 'not_eligible', 'RN-01 a: membro excluído');
SELECT is(ARRAY[private.add_legacy_credential(pg_temp.m(1), NULL),
                private.add_legacy_credential(pg_temp.m(1), upper(md5('Senha#1'))),
                private.add_legacy_credential(pg_temp.m(1), left(md5('Senha#1'), 31)),
                private.add_legacy_credential(pg_temp.m(1), md5('Senha#1') || '0'),
                private.add_legacy_credential(pg_temp.m(1), 'g' || right(md5('Senha#1'), 31)),
                private.add_legacy_credential(pg_temp.m(1), 'd41d8cd98f00b204e9800998ecf8427e')],
  ARRAY['unusable_md5', 'unusable_md5', 'unusable_md5', 'unusable_md5', 'unusable_md5', 'unusable_md5'],
  'RN-01 c: só 32 hexadecimais minúsculos, diferente do MD5 do texto vazio');
SELECT is(pg_temp.cred(1), 'none', 'RN-01 c: nada é criado com MD5 inutilizável');
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE auth_user_id = pg_temp.u(1)), 0,
  'RN-01: recusa antes de criar a linha do cofre');

SELECT is(private.add_legacy_credential(pg_temp.m(1), md5('Senha#1')), 'created', 'RN-01: credencial criada');
SELECT is((SELECT extensions.crypt(md5('Senha#1'), legacy_hash) = legacy_hash FROM private.legacy_credentials WHERE member_id = pg_temp.m(1)), true,
  'RN-01: o hash é bcrypt(md5(senha))');
SELECT is((SELECT concat_ws('|', password_hash IS NULL, must_change) FROM private.account_passwords WHERE auth_user_id = pg_temp.u(1)), 't|f',
  'DT-05: a carga cria a linha do cofre sem hash e sem marca');
CREATE TEMP TABLE h1 AS SELECT pg_temp.hash_of(1) AS h;
SELECT is(private.add_legacy_credential(pg_temp.m(1), md5('Outra#1')), 'updated', 'RN-03: carga refeita regrava a pendente');
SELECT isnt(pg_temp.hash_of(1), (SELECT h FROM h1), 'RN-03: com o hash novo');

-- Quem já tem senha no cofre (RN-03, RN-16 a).
SELECT private.write_password(pg_temp.u(2), pg_temp.m(2), 'Ja#Tenho2024', NULL);
SELECT is(private.add_legacy_credential(pg_temp.m(2), md5('Senha#2')), 'has_password', 'RN-16 a: conta com senha no novo fica com ela');
SELECT is(pg_temp.cred(2), 'none', 'RN-03: nenhuma credencial criada');

-- Usada com hash (DA-2) e descartada: nunca recria.
SELECT private.add_legacy_credential(pg_temp.m(3), md5('Senha#3'));
UPDATE private.legacy_credentials SET used_at = now() WHERE member_id = pg_temp.m(3);
SELECT is(private.add_legacy_credential(pg_temp.m(3), md5('Senha#3')), 'kept_used', 'RN-03: a usada não é regravada');
SELECT private.add_legacy_credential(pg_temp.m(4), md5('Senha#4'));
UPDATE private.legacy_credentials SET legacy_hash = NULL, discarded_at = now() WHERE member_id = pg_temp.m(4);
SELECT is(private.add_legacy_credential(pg_temp.m(4), md5('Senha#4')), 'kept_used', 'RN-03: a descartada não é recriada');

-- ===========================================================================
-- Descarte (RN-03): toda gravação de senha passa pela write_password.
-- ===========================================================================
SELECT private.add_legacy_credential(pg_temp.m(n), md5('Senha#' || n)) FROM generate_series(5, 7) n;
SELECT private.write_password(pg_temp.u(5), pg_temp.m(5), 'Nova#Senha55', NULL);
SELECT is(pg_temp.cred(5), 'discarded', 'RN-03: write_password (redefinição, troca, primeira entrada) apaga a credencial');
SELECT is((SELECT discarded_at IS NOT NULL AND used_at IS NULL FROM private.legacy_credentials WHERE member_id = pg_temp.m(5)), true,
  'DT-01: a linha fica, com discarded_at; used_at só na primeira entrada');
SELECT is(pg_temp.as_role('service_role', format($q$SELECT public.set_initial_password(%L, %L, '', NULL, NULL, NULL, NULL)$q$,
            pg_temp.u(6), pg_temp.m(6))), '00000', 'set_initial_password roda (service_role)');
SELECT is(pg_temp.cred(6), 'discarded', 'RN-03: a senha inicial também apaga');
SELECT private.discard_legacy_credential(pg_temp.m(7));
SELECT private.discard_legacy_credential(pg_temp.m(7));
SELECT is(pg_temp.cred(7), 'discarded', 'discard_legacy_credential é idempotente');
SELECT is((SELECT count(*)::int FROM private.legacy_credentials WHERE member_id = pg_temp.m(7)), 1, 'RN-07: a linha nunca é apagada');

-- RN-10: exclusão lógica não toca a credencial.
SELECT private.add_legacy_credential(pg_temp.m(8), md5('Senha#8'));
UPDATE public.members SET deleted_at = now() WHERE id = pg_temp.m(8);
SELECT is(pg_temp.cred(8), 'pending', 'RN-10: o membro excluído mantém a credencial pendente');
UPDATE public.members SET deleted_at = NULL WHERE id = pg_temp.m(8);

-- ===========================================================================
-- Reconciliação (5.6)
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM private.legacy_credential_problems()), 1, 'Reconciliação: só o caso usado sem marca (3)');
SELECT is((SELECT array_agg(problem || ':' || right(member_id::text, 2) ORDER BY problem) FROM private.legacy_credential_problems()),
  ARRAY['kept_without_mark:03'], 'Reconciliação: kept_without_mark do 3');
UPDATE private.account_passwords SET password_hash = extensions.crypt('X#outra1234', extensions.gen_salt('bf', 10))
 WHERE auth_user_id = pg_temp.u(1);
SELECT private.add_legacy_credential(pg_temp.m(9), md5('Senha#9'));
UPDATE public.members SET auth_user_id = NULL WHERE id = pg_temp.m(9);
SELECT is((SELECT array_agg(problem || ':' || right(member_id::text, 2) ORDER BY problem) FROM private.legacy_credential_problems()),
  ARRAY['both_passwords:01', 'kept_without_mark:03', 'no_account:09'], 'Reconciliação: both_passwords, kept_without_mark e no_account');
SELECT private.set_must_change(pg_temp.u(3), 'legacy_weak', NULL);
SELECT is((SELECT count(*)::int FROM private.legacy_credential_problems() WHERE problem = 'kept_without_mark'), 0,
  'Reconciliação: usada com hash e com a marca legacy_weak não é problema (DA-2)');

-- ===========================================================================
-- Card (DT-09): 42501 sem view_all_church; números só dos não excluídos.
-- ===========================================================================
SELECT is(pg_temp.as_role('authenticated', 'SELECT * FROM public.dashboard_first_access()'), '42501',
  'RN-14 a: sem cadastro (sem permissão), 42501');
SELECT is(pg_temp.as_role('anon', 'SELECT * FROM public.dashboard_first_access()'), '42501', 'RN-14 a: anon não executa');
SELECT is(pg_temp.as_role('service_role', 'SELECT * FROM public.dashboard_first_access()'), '42501', 'DT-09: service_role não executa');
SELECT is(pg_temp.sqlstate('SELECT * FROM private.legacy_credentials'), '00000', 'Sanidade: o dono lê a tabela');

SELECT * FROM finish();

ROLLBACK;
