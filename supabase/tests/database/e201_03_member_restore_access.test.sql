-- E2.01 (PR 1): restauração de membros, acesso do excluído e cadastro com
-- dados de um excluído.
-- Spec: docs/specs/e2-01-exclusao-logica.md (repositório apps-mci), RN-14 a
-- RN-16, RN-18 a RN-20, DA-2 a DA-4, DA-6, DA-8, DA-9, DT-13.
--
-- Cobre, pela API (usuário logado com SET ROLE authenticated):
--   - RN-14 no banco: depois da exclusão, com o JWT de Ana, views, tabelas,
--     roles e role_permissions voltam vazias, as RPCs e o INSERT dão 42501, o
--     PATCH do próprio cadastro volta com 0 linhas, log_auth_event não grava
--     (DA-9) e as utilitárias respondem; auth.users fica com a senha vazia e
--     banida, sessões e refresh tokens somem (inclusive o órfão); a senha fica
--     guardada; na restauração o hash volta igual e o banimento anterior volta;
--   - RN-15: lista de excluídos com data, autor (também excluído depois, ou
--     sem autor), escopo e busca; sem manage_roles, vazia e 42501;
--     not_deleted; not_found (DA-4) para inexistente e fora do escopo;
--   - RN-16: volta com líder, participações e totais; sem líder (DA-3); dado
--     em uso (e-mail, celular, CPF normalizados; DA-6); função apagada volta
--     com a padrão (DA-2); sem conta continua sem função; restore_role_above;
--     inativo volta inativo; nível recalculado;
--   - RN-18: find_deleted_member_matches para administrador e para os demais
--     (nome nulo), e-mail da conta, celular, CPF, dois cadastros, limite de
--     10, escopo do administrador (DA-8); INSERT direto com o e-mail da conta
--     recusado (também como postgres, DT-27); celular e e-mail sem conta
--     aceitos;
--   - RN-19: evento restore com os detalhes;
--   - RN-20: auditoria que falha na restauração mantém o excluído suspenso.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(134);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2010300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b2010300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2010300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2010300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2010300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

CREATE FUNCTION pg_temp.try(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  _state text; _msg text; _detail text; _hint text; _rows bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END,
      true);
    IF _n IS NOT NULL THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
    EXECUTE _sql;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('state', '00000', 'rows', _rows);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                            _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('state', _state, 'message', _msg, 'hint', nullif(_hint, ''),
      'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ELSE to_jsonb(nullif(_detail, '')) END);
  END;
END $$;

CREATE FUNCTION pg_temp.val(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _out text; _state text; _msg text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END,
      true);
    IF _n IS NOT NULL THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT;
    RETURN 'ERR ' || _state || ': ' || _msg;
  END;
END $$;
CREATE FUNCTION pg_temp.jv(_n int, _sql text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN v LIKE 'ERR %' THEN jsonb_build_object('error', v) ELSE v::jsonb END
    FROM (SELECT pg_temp.val(_n, _sql) AS v) x
$$;
CREATE FUNCTION pg_temp.code(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _r ->> 'state' = '22023' AND _r ->> 'hint' = 'app_error'
              THEN _r -> 'detail' ->> 'code' ELSE _r ->> 'state' END
$$;
CREATE FUNCTION pg_temp.mem(_n int) RETURNS public.members LANGUAGE sql STABLE AS
$$ SELECT * FROM public.members WHERE id = pg_temp.m(_n) $$;
-- Linhas de find_deleted_member_matches como o usuário _n, num JSON ordenado.
CREATE FUNCTION pg_temp.matches(_n int, _email text, _mobile text, _cpf text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.jv(_n, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.deleted_at DESC NULLS LAST, f.member_id), '[]')
         FROM public.find_deleted_member_matches(%L, %L, %L) f$q$, _email, _mobile, _cpf))
$$;

-- ---------------------------------------------------------------------------
-- Massa (postgres, triggers ligados)
-- ---------------------------------------------------------------------------
-- Uma função padrão só, a deste arquivo (DA-2).
UPDATE public.roles SET is_default = false WHERE is_default;
INSERT INTO public.roles (id, name, is_default) VALUES (pg_temp.role(10), 'E201-03 Padrão', true);
INSERT INTO public.roles (id, name) VALUES
  (pg_temp.role(1), 'E201-03 AD'), (pg_temp.role(2), 'E201-03 LE'), (pg_temp.role(3), 'E201-03 AD parcial'),
  (pg_temp.role(4), 'E201-03 AD ministério'), (pg_temp.role(5), 'E201-03 Ana'), (pg_temp.role(6), 'E201-03 CM'),
  (pg_temp.role(11), 'E201-03 Líder (será apagada)');
INSERT INTO public.role_permissions (role_id, permission)
SELECT pg_temp.role(1), p FROM unnest(enum_range(NULL::public.permission_action)) p;
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(10), 'view_dashboard'),
  (pg_temp.role(2), 'view_members'), (pg_temp.role(2), 'create_member'), (pg_temp.role(2), 'delete_member'),
  (pg_temp.role(2), 'view_dashboard'),
  (pg_temp.role(3), 'manage_roles'), (pg_temp.role(3), 'view_members'), (pg_temp.role(3), 'create_member'),
  (pg_temp.role(3), 'delete_member'),
  (pg_temp.role(4), 'manage_roles'), (pg_temp.role(4), 'view_own_ministry'), (pg_temp.role(4), 'create_member'),
  (pg_temp.role(5), 'view_members'), (pg_temp.role(5), 'view_dashboard'), (pg_temp.role(5), 'delete_member'),
  (pg_temp.role(5), 'create_member'), (pg_temp.role(5), 'edit_own_data'), (pg_temp.role(5), 'view_all_reports'),
  (pg_temp.role(6), 'create_member'), (pg_temp.role(6), 'view_members'),
  (pg_temp.role(11), 'view_members');

INSERT INTO auth.users (id, email, encrypted_password, banned_until)
SELECT pg_temp.u(n), 'e201-03-' || n || '@teste.invalid', extensions.crypt('Senha#' || n, extensions.gen_salt('bf', 4)),
       CASE WHEN n = 9 THEN timestamptz '2030-01-01 00:00+00' END
  FROM generate_series(1, 9) n;
-- 1 Elisa (AD), 2 Lucas (LE), 3 Adão (AD parcial), 4 Mirela (AD do ministério
-- de Gina), 5 Ana (com sessões), 6 Cecília (CM), 7 Bruno, 8 Fábio (AD),
-- 9 Bia (conta já banida até 2030)

-- Paulo Pastor → Gina (G12) e Dora (G12, outro ministério).
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership) VALUES
  (pg_temp.m(1), 'Paulo Pastor E201-03', 'M', true, false);
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id) VALUES
  (pg_temp.m(2),  'Gina Garcia',   'F', pg_temp.m(1), true, NULL,         NULL),
  (pg_temp.m(3),  'Dora Dias',     'F', pg_temp.m(1), true, NULL,         NULL),
  (pg_temp.m(17), 'Elisa Esteves', 'F', pg_temp.m(1), true, pg_temp.u(1), pg_temp.role(1)),
  (pg_temp.m(19), 'Adão Alves',    'M', pg_temp.m(1), true, pg_temp.u(3), pg_temp.role(3)),
  (pg_temp.m(21), 'Fábio Freitas', 'M', pg_temp.m(1), true, pg_temp.u(8), pg_temp.role(1));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id,
                            email, mobile_whatsapp, cpf) VALUES
  (pg_temp.m(5),  'Gil Gomes',      'M', pg_temp.m(2), true, true,  NULL,         NULL,            NULL, NULL, NULL),
  (pg_temp.m(6),  'Hugo Hart',      'M', pg_temp.m(2), true, true,  NULL,         NULL,            NULL, NULL, NULL),
  (pg_temp.m(16), 'Ana Abreu',      'F', pg_temp.m(2), true, true,  pg_temp.u(5), pg_temp.role(5), 'e201-03-5@teste.invalid', NULL, NULL),
  (pg_temp.m(18), 'Lucas Lopes',    'M', pg_temp.m(2), true, true,  pg_temp.u(2), pg_temp.role(2), NULL, NULL, NULL),
  (pg_temp.m(20), 'Mirela Moraes',  'F', pg_temp.m(2), true, true,  pg_temp.u(4), pg_temp.role(4), NULL, NULL, NULL),
  (pg_temp.m(22), 'Cecília Couto',  'F', pg_temp.m(2), true, true,  pg_temp.u(6), pg_temp.role(6), NULL, NULL, NULL),
  (pg_temp.m(24), 'Inês Inativa',   'F', pg_temp.m(2), true, false, NULL,         NULL,            NULL, NULL, NULL),
  (pg_temp.m(25), 'Davi Duarte',    'M', pg_temp.m(3), true, true,  NULL,         NULL,            NULL, '(51) 96666-0000', NULL),
  (pg_temp.m(26), 'Zeno Zanella',   'M', pg_temp.m(2), true, true,  NULL,         NULL,            NULL, NULL, NULL),
  (pg_temp.m(27), 'Bia Bastos',     'F', pg_temp.m(2), true, true,  pg_temp.u(9), pg_temp.role(10), 'e201-03-9@teste.invalid', NULL, NULL),
  (pg_temp.m(28), 'Teo Tavares',    'M', pg_temp.m(2), true, true,  NULL,         NULL,            NULL, NULL, '390.533.447-05'),
  (pg_temp.m(30), 'Olga Otero',     'F', pg_temp.m(2), true, true,  NULL,         NULL,            'olga@e201-03.invalid', NULL, NULL),
  (pg_temp.m(42), 'Sara Souza',     'F', pg_temp.m(2), true, true,  NULL,         NULL,            NULL, NULL, NULL),
  (pg_temp.m(43), 'Edu Esteves',    'M', pg_temp.m(2), true, true,  NULL,         NULL,            'edu@e201-03.invalid', '(51) 95555-0000', '111.444.777-35');
-- Bruno: discípulo de Gil, com conta, função que será apagada e dados de contato.
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id,
                            email, mobile_whatsapp, cpf, notes) VALUES
  (pg_temp.m(23), 'Bruno Brito', 'M', pg_temp.m(5), true, true, pg_temp.u(7), pg_temp.role(11),
   'Bruno@E201-03.invalid ', '(51) 99999-0000', '529.982.247-25', 'Observação do Bruno');
-- 11 cadastros com o mesmo celular (limite de 10).
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp)
SELECT pg_temp.m(60 + n), 'Repetido ' || lpad(n::text, 2, '0'), 'M', pg_temp.m(2), true, '51 97777 0000'
  FROM generate_series(1, 11) n;

-- Bruno participou de 12 relatórios (semanas passadas).
INSERT INTO public.cells (id, leader_id, host_id, type, meeting_day, meeting_time) VALUES
  (pg_temp.c(1), pg_temp.m(6), pg_temp.m(6), 'Evangelística', 'Quarta', '20:00');
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held)
SELECT pg_temp.r(k), pg_temp.c(1), public.week_start(public.sp_today()) - 7 * k + 3, '20:00', 'Tema ' || k, true
  FROM generate_series(1, 12) k;
INSERT INTO public.cell_report_participants (report_id, member_id)
SELECT pg_temp.r(k), pg_temp.m(23) FROM generate_series(1, 12) k;
SET LOCAL session_replication_role = origin;

-- Ana: duas sessões com refresh tokens e um refresh token órfão (sem sessão).
INSERT INTO auth.sessions (id, user_id, created_at) VALUES
  ('f2010300-0000-0000-0000-000000000051', pg_temp.u(5), now()),
  ('f2010300-0000-0000-0000-000000000052', pg_temp.u(5), now());
INSERT INTO auth.refresh_tokens (token, user_id, session_id, revoked, created_at) VALUES
  ('e201-03-rt-51', pg_temp.u(5)::text, 'f2010300-0000-0000-0000-000000000051', false, now()),
  ('e201-03-rt-52', pg_temp.u(5)::text, 'f2010300-0000-0000-0000-000000000052', false, now()),
  ('e201-03-rt-53', pg_temp.u(5)::text, NULL, false, now());

CREATE TEMP TABLE ana_auth0 AS SELECT encrypted_password::text AS encrypted_password, banned_until FROM auth.users WHERE id = pg_temp.u(5);
CREATE TEMP TABLE bruno_auth0 AS SELECT encrypted_password::text AS encrypted_password FROM auth.users WHERE id = pg_temp.u(7);
CREATE TEMP TABLE bia_auth0 AS SELECT encrypted_password, banned_until FROM auth.users WHERE id = pg_temp.u(9);

-- ===========================================================================
-- 1. RN-14: acesso do membro excluído (no banco) — 34
-- ===========================================================================
SELECT ok(pg_temp.val(5, 'SELECT count(*) FROM public.members_view')::int > 0
          AND pg_temp.val(5, 'SELECT count(*) FROM public.roles')::int > 0,
  'RN-14 (antes): Ana lê a members_view e as funções');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(16)))), '00000',
  'RN-14: AD exclui Ana');

SELECT is((SELECT encrypted_password::text FROM auth.users WHERE id = pg_temp.u(5)), '',
  'RN-14/DT-13: a senha da conta fica vazia (login responde igual a conta inexistente)');
SELECT ok((SELECT banned_until BETWEEN now() + interval '99 years' AND now() + interval '101 years'
             FROM auth.users WHERE id = pg_temp.u(5)),
  'RN-14/DT-13: a conta fica banida por 100 anos (barra renovação e recuperação)');
SELECT is((SELECT count(*)::int FROM auth.sessions WHERE user_id = pg_temp.u(5)), 0, 'RN-14: as sessões de Ana somem');
SELECT is((SELECT count(*)::int FROM auth.refresh_tokens WHERE user_id = pg_temp.u(5)::text), 0,
  'RN-14: os refresh tokens somem, inclusive o órfão (sem sessão)');
SELECT is((SELECT count(*)::int FROM auth.users WHERE id = pg_temp.u(5)), 1, 'RN-14: a conta é bloqueada, e não apagada');
SELECT is((SELECT encrypted_password FROM private.member_access_suspensions WHERE member_id = pg_temp.m(16)),
  (SELECT encrypted_password FROM ana_auth0), 'RN-14: a senha (hash) fica guardada para a restauração');
SELECT is((SELECT auth_user_id FROM private.member_access_suspensions WHERE member_id = pg_temp.m(16)), pg_temp.u(5),
  'RN-14: a suspensão guarda a conta');

-- Com o token antigo de Ana: nada é lido.
SELECT is(pg_temp.val(5, format('SELECT count(*) FROM %s', v)), '0',
          'RN-14: com o JWT de Ana, ' || v || ' volta vazia')
  FROM unnest(ARRAY['public.members_view', 'public.cells_view', 'public.cell_reports_view',
                    'public.cell_report_participants_view', 'public.members_deleted_view',
                    'public.cells_deleted_view', 'public.cell_reports_deleted_view',
                    'public.roles', 'public.role_permissions', 'public.members', 'public.cells',
                    'public.cell_reports', 'public.cell_report_participants']) v;
-- Nada é gravado.
SELECT is(pg_temp.code(pg_temp.try(5, format('SELECT public.delete_member(%L)', pg_temp.m(26)))), '42501',
  'RN-14: com a sessão antiga, Ana não exclui outro membro (42501)');
SELECT is(pg_temp.code(pg_temp.try(5, format('SELECT public.check_member_deletion(%L)', pg_temp.m(26)))), '42501',
  'RN-14: nem faz a pré-checagem');
SELECT is(pg_temp.try(5, $$INSERT INTO public.members (name, gender) VALUES ('Cadastro da Ana', 'F')$$) ->> 'state', '42501',
  'RN-14: o INSERT de Ana dá 42501');
SELECT is(pg_temp.try(5, format($$UPDATE public.members SET notes = 'x' WHERE id = %L$$, pg_temp.m(16))) ->> 'rows', '0',
  'RN-14: o PATCH do próprio cadastro volta com 0 linhas');
SELECT is(pg_temp.code(pg_temp.try(5, 'SELECT * FROM public.dashboard_summary()')), '42501',
  'RN-14: o dashboard recusa Ana (sem permissão nenhuma, mesmo que a função tenha)');
SELECT is(pg_temp.val(5, 'SELECT public.viewer_member_id()'), NULL, 'RN-14: viewer_member_id() de Ana é nulo');
SELECT is(pg_temp.val(5, format('SELECT count(*) FROM public.member_names(ARRAY[%L]::uuid[])', pg_temp.m(26))), '0',
  'RN-14: member_names não devolve nada para Ana');
SELECT is(pg_temp.val(5, $$SELECT public.user_has_permission(auth.uid(), 'view_members')$$), 'false',
  'RN-14: user_has_permission é falso para Ana');
SELECT is(pg_temp.code(pg_temp.try(5, $$SELECT public.log_auth_event('logout', true, NULL, NULL)$$)), '00000',
  'DA-9: log_auth_event de Ana não dá erro');
SELECT is((SELECT count(*)::int FROM public.events WHERE actor_user_id = pg_temp.u(5) AND entity = 'auth'), 0,
  'DA-9: e não grava nada');
SELECT is(pg_temp.val(5, 'SELECT public.sp_today()'), public.sp_today()::text,
  'DA-9: as utilitárias sem dado de ninguém continuam respondendo (sp_today)');

-- RN-20 na restauração: se a auditoria falhar, Ana continua excluída e suspensa.
ALTER TABLE public.events ADD CONSTRAINT e201_qa_audit_fails_restore CHECK (action <> 'restore') NOT VALID;
SELECT is(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(16))) ->> 'state', '23514',
  'RN-20: com a auditoria falhando, a restauração de Ana falha');
SELECT ok((pg_temp.mem(16)).deleted_at IS NOT NULL
          AND (SELECT encrypted_password = '' AND banned_until IS NOT NULL FROM auth.users WHERE id = pg_temp.u(5))
          AND EXISTS (SELECT 1 FROM private.member_access_suspensions WHERE member_id = pg_temp.m(16)),
  'RN-20: Ana continua excluída e suspensa (nunca excluída com acesso)');
ALTER TABLE public.events DROP CONSTRAINT e201_qa_audit_fails_restore;

-- Restauração devolve o acesso com a mesma senha.
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(16)))), '00000',
  'RN-16 f: AD restaura Ana');
SELECT is((SELECT encrypted_password::text FROM auth.users WHERE id = pg_temp.u(5)), (SELECT encrypted_password FROM ana_auth0),
  'RN-16 f: o hash da senha volta igual ao original');
SELECT is((SELECT banned_until FROM auth.users WHERE id = pg_temp.u(5)), NULL, 'RN-16 f: o banimento sai');
SELECT is((SELECT count(*)::int FROM private.member_access_suspensions WHERE member_id = pg_temp.m(16)), 0,
  'RN-16 f: a suspensão guardada é apagada');
SELECT ok(pg_temp.val(5, 'SELECT count(*) FROM public.members_view')::int > 0
          AND pg_temp.val(5, 'SELECT count(*) FROM public.roles')::int > 0,
  'RN-16 f: Ana volta a ler (mesmas permissões)');

-- ===========================================================================
-- 2. RN-14/RN-16 f: banimento anterior e membro sem conta — 6
-- ===========================================================================
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(27)))), '00000',
  'RN-14: AD exclui Bia, cuja conta já estava banida até 2030');
SELECT is((SELECT previous_banned_until FROM private.member_access_suspensions WHERE member_id = pg_temp.m(27)),
  timestamptz '2030-01-01 00:00+00', 'RN-14: o banimento anterior fica guardado');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(27)))), '00000',
  'RN-16 f: AD restaura Bia');
SELECT is((SELECT row(encrypted_password, banned_until)::text FROM auth.users WHERE id = pg_temp.u(9)),
  (SELECT row(encrypted_password, banned_until)::text FROM bia_auth0),
  'RN-16 f: a conta volta exatamente como estava (mesma senha e o banimento anterior)');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(26)))), '00000',
  'RN-14: AD exclui Zeno, que não tem conta');
SELECT is((SELECT count(*)::int FROM private.member_access_suspensions WHERE member_id = pg_temp.m(26)), 0,
  'RN-14: sem conta, nada a suspender');

-- ===========================================================================
-- 3. RN-15: lista de excluídos e quem restaura — 24
-- ===========================================================================
-- Fábio exclui Sara; depois Elisa exclui Fábio; Davi é excluído pela service role.
SELECT is(pg_temp.code(pg_temp.try(8, format('SELECT public.delete_member(%L)', pg_temp.m(42)))), '00000',
  'RN-15: Fábio (AD) exclui Sara');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(21)))), '00000',
  'RN-15: Elisa exclui Fábio');
UPDATE public.members SET deleted_at = now() - interval '3 days' WHERE id = pg_temp.m(25);   -- "service role": sem autor
UPDATE public.members SET deleted_at = now() - interval '2 days' WHERE id = pg_temp.m(42);
UPDATE public.members SET deleted_at = now() - interval '1 day'  WHERE id = pg_temp.m(26);

SELECT is(pg_temp.val(1, format('SELECT deleted_by_name FROM public.members_deleted_view WHERE id = %L', pg_temp.m(26))),
  'Elisa Esteves', 'RN-15: a lista mostra quem excluiu');
SELECT is(pg_temp.val(1, format('SELECT deleted_at FROM public.members_deleted_view WHERE id = %L', pg_temp.m(26)))::timestamptz,
  now() - interval '1 day', 'RN-15: e a data e hora da exclusão');
SELECT is(pg_temp.val(1, format('SELECT deleted_by_name FROM public.members_deleted_view WHERE id = %L', pg_temp.m(42))),
  'Fábio Freitas', 'RN-15: o nome de quem excluiu aparece mesmo que ele tenha sido excluído depois');
SELECT is(pg_temp.val(1, format($$SELECT coalesce(deleted_by_name, '<sem autor>') FROM public.members_deleted_view WHERE id = %L$$, pg_temp.m(25))),
  '<sem autor>', 'RN-15: exclusão sem autor (service role ou legado) vem com o nome nulo ("Autor não registrado")');
SELECT is(pg_temp.val(1, format($$SELECT string_agg(name, ',' ORDER BY deleted_at DESC, id) FROM public.members_deleted_view
                                 WHERE id IN (%L, %L, %L, %L)$$, pg_temp.m(21), pg_temp.m(25), pg_temp.m(26), pg_temp.m(42))),
  'Fábio Freitas,Zeno Zanella,Sara Souza,Davi Duarte',
  'RN-15: ordem da exclusão mais recente para a mais antiga (deleted_at DESC, id)');
SELECT is(pg_temp.val(1, $$SELECT string_agg(name, ',') FROM public.members_deleted_view
                          WHERE search_text LIKE '%' || public.search_normalize('sara') || '%'$$),
  'Sara Souza', 'RN-15: a lista tem busca (mesmos campos da lista principal)');
SELECT is(pg_temp.val(1, format('SELECT email FROM public.members_deleted_view WHERE id = %L', pg_temp.m(25))), NULL,
  'RN-15: sem dado sensível cadastrado, o campo vem nulo');
SELECT is(pg_temp.val(1, format('SELECT mobile_whatsapp FROM public.members_deleted_view WHERE id = %L', pg_temp.m(25))),
  '(51) 96666-0000', 'RN-15: com view_sensitive_data, o celular aparece (mesma máscara da members_view)');
SELECT is(pg_temp.val(4, format('SELECT count(*) FROM public.members_deleted_view WHERE id = %L', pg_temp.m(42))), '1',
  'RN-15: o administrador do ministério de Gina vê Sara, do ministério dele');
SELECT is(pg_temp.val(4, format('SELECT count(*) FROM public.members_deleted_view WHERE id = %L', pg_temp.m(25))), '0',
  'RN-15: e não vê Davi, de outro ministério (vê os excluídos que veria se não estivessem excluídos)');
SELECT is(pg_temp.val(4, format('SELECT sensitive_visible FROM public.members_deleted_view WHERE id = %L', pg_temp.m(42))), 'false',
  'RN-15: sem view_sensitive_data, a lista mascara os dados sensíveis');
SELECT is(pg_temp.val(2, 'SELECT count(*) FROM public.members_deleted_view'), '0',
  'RN-15: LE (excluir, sem Gerenciar Funções) não vê a lista de excluídos');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(42)))), '42501',
  'RN-15: LE não restaura (42501)');
SELECT is((pg_temp.mem(42)).deleted_at IS NOT NULL, true, 'RN-15: Sara continua excluída');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(6)))), 'not_deleted',
  'RN-15: restaurar Hugo, que não está excluído, é recusado');
SELECT is(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(6))) ->> 'message',
  'Este cadastro não está excluído.', 'RN-15: texto de "não está excluído"');
SELECT is(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(6))) -> 'detail',
  '{"code": "not_deleted", "entity": "member"}'::jsonb, 'RN-15: detalhe com entity member');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', gen_random_uuid()))), 'not_found',
  'DA-4: restaurar um id inexistente dá not_found');
SELECT is(pg_temp.try(1, 'SELECT * FROM public.restore_member(NULL)') ->> 'message', 'Este cadastro não foi encontrado.',
  'DA-4: texto técnico de não encontrado');
SELECT is(pg_temp.code(pg_temp.try(4, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(25)))), 'not_found',
  'DA-10: o administrador do ministério não restaura Davi, fora do escopo (vale como inexistente)');
SELECT is(pg_temp.code(pg_temp.try(4, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(42)))), '00000',
  'RN-15: o administrador do ministério restaura Sara, do ministério dele');
SELECT ok((pg_temp.mem(42)).deleted_at IS NULL AND (pg_temp.mem(42)).deleted_by IS NULL,
  'RN-15: restaurada, Sara fica sem data e sem autor de exclusão');

-- ===========================================================================
-- 4. RN-16: restaurar um membro — 34
-- ===========================================================================
CREATE TEMP TABLE bruno0 AS SELECT * FROM public.members WHERE id = pg_temp.m(23);
CREATE TEMP TABLE tot0 AS SELECT id, total_disciples FROM public.members WHERE id IN (pg_temp.m(1), pg_temp.m(2), pg_temp.m(5));

-- (a) com o líder Gil não excluído: volta como estava.
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(23)))), '00000',
  'RN-16: AD exclui Bruno (12 participações, líder Gil)');
SELECT is((SELECT total_disciples FROM public.members WHERE id = pg_temp.m(5)), 0, 'RN-10: Gil fica com 0 discípulos');
SELECT is(pg_temp.jv(1, format('SELECT to_jsonb(r) FROM public.restore_member(%L) r', pg_temp.m(23))),
  '{"restored_without_leader": false, "previous_leader_name": null, "role_reset_to_default": false,
    "role_name": "E201-03 Líder (será apagada)"}'::jsonb,
  'RN-15/RN-16: AD restaura Bruno; volta com o líder e a mesma função');
SELECT is(
  to_jsonb(pg_temp.mem(23)) - ARRAY['updated_at'],
  (SELECT to_jsonb(b) - ARRAY['updated_at'] FROM bruno0 b),
  'RN-15/RN-16 a: Bruno volta com os mesmos dados (líder, função, situação, contato, totais)');
SELECT is((SELECT count(*)::int FROM public.cell_report_participants WHERE member_id = pg_temp.m(23)), 12,
  'RN-15: com as 12 participações');
SELECT set_eq(
  format('SELECT id, total_disciples FROM public.members WHERE id IN (%L, %L, %L)', pg_temp.m(1), pg_temp.m(2), pg_temp.m(5)),
  'SELECT id, total_disciples FROM tot0',
  'RN-15/RN-10: o total de discípulos de Gil e dos ancestrais volta (aumenta 1 na restauração)');

-- (e) dado em uso por outro cadastro.
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(23)))), '00000',
  'RN-16: AD exclui Bruno de novo');
SELECT is(pg_temp.code(pg_temp.try(6, format($$INSERT INTO public.members (id, name, gender, leader_id, mobile_whatsapp)
                                              VALUES (%L, 'Caio Campos', 'M', %L, '51999990000')$$, pg_temp.m(10), pg_temp.m(2)))),
  '00000', 'RN-18: CM cadastra Caio com o celular de Bruno (permitido: "Cadastrar mesmo assim")');
CREATE TEMP TABLE bruno_del AS SELECT * FROM public.members WHERE id = pg_temp.m(23);
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(23)))), 'restore_value_in_use',
  'RN-16 e: restaurar Bruno com o celular em uso por Caio é recusado');
SELECT is(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(23))) ->> 'message',
  'Não é possível restaurar: outro cadastro já usa este celular.', 'RN-16 e: a mensagem diz qual dado');
SELECT is(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(23))) -> 'detail' -> 'fields',
  '["mobile"]'::jsonb, 'RN-16 e: detalhe com o campo (celular comparado só pelos dígitos)');
SELECT is(to_jsonb(pg_temp.mem(23)), (SELECT to_jsonb(b) FROM bruno_del b), 'RN-16 e: nada muda');
SELECT is(pg_temp.try(1, format($$UPDATE public.members SET mobile_whatsapp = '51911112222' WHERE id = %L$$, pg_temp.m(10))) ->> 'rows',
  '1', 'RN-16 e: o celular de Caio é trocado');

-- DA-6: mais de um dado em uso.
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(43)))), '00000',
  'DA-6: AD exclui Edu');
INSERT INTO public.members (id, name, gender, leader_id, email, cpf) VALUES
  (pg_temp.m(44), 'Fred Fontes', 'M', pg_temp.m(2), ' EDU@e201-03.INVALID', '11144477735');
SELECT is(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(43))) -> 'detail' -> 'fields',
  '["email", "cpf"]'::jsonb, 'DA-6: e-mail e CPF em uso (normalizados) aparecem os dois no detalhe');
SELECT is(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(43))) ->> 'message',
  'Não é possível restaurar: outro cadastro já usa este e-mail.', 'DA-6: a mensagem cita o primeiro (e-mail)');
SELECT is(pg_temp.try(1, format($$UPDATE public.members SET email = NULL WHERE id = %L$$, pg_temp.m(44))) ->> 'rows',
  '1', 'DA-6: o e-mail de Fred é apagado');
SELECT is(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(43))) ->> 'message',
  'Não é possível restaurar: outro cadastro já usa este CPF.', 'RN-16 e: o CPF em uso também recusa');

-- (d) e (a): o líder foi excluído e a função foi apagada.
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(5)))), '00000',
  'RN-16 d: Gil, líder de Bruno, é excluído depois');
DELETE FROM public.roles WHERE id = pg_temp.role(11);
SELECT is(pg_temp.jv(1, format($$SELECT jsonb_build_object('leader_deleted', leader_deleted, 'leader_name', leader_name,
                                     'role_id', role_id, 'restore_role_name', restore_role_name,
                                     'role_reset_on_restore', role_reset_on_restore, 'has_account', has_account)
                                  FROM public.members_deleted_view WHERE id = %L$$, pg_temp.m(23))),
  '{"leader_deleted": true, "leader_name": "Gil Gomes", "role_id": null, "restore_role_name": "E201-03 Padrão",
    "role_reset_on_restore": true, "has_account": true}'::jsonb,
  'AQ-7/DA-2: a lista antecipa o líder excluído, a função padrão e a conta');
CREATE TEMP TABLE no_leader0 AS
  SELECT pg_temp.val(1, 'SELECT members_without_leader FROM public.dashboard_summary()')::int AS n;
SELECT is(pg_temp.jv(1, format('SELECT to_jsonb(r) FROM public.restore_member(%L) r', pg_temp.m(23))),
  '{"restored_without_leader": true, "previous_leader_name": "Gil Gomes", "role_reset_to_default": true,
    "role_name": "E201-03 Padrão"}'::jsonb,
  'RN-16 a/d: Bruno volta sem líder (Gil excluído) e com a função padrão; o retorno diz os dois');
SELECT is(ARRAY[(pg_temp.mem(23)).leader_id::text, (pg_temp.mem(23)).has_leadership::text, (pg_temp.mem(23)).g12_level::text],
  ARRAY[NULL, 'false', '0'], 'DA-3: sem líder, "Tem Liderança?" desligado e nível 0 recalculado');
SELECT is((pg_temp.mem(23)).role_id, pg_temp.role(10), 'DA-2: com a função padrão');
SELECT is(pg_temp.val(1, 'SELECT members_without_leader FROM public.dashboard_summary()')::int,
  (SELECT n + 1 FROM no_leader0), 'RN-16 d: até definir o líder, Bruno conta em "sem liderança"');
SELECT is(
  (SELECT count(*)::int FROM public.events
    WHERE entity = 'member' AND entity_id = pg_temp.m(23) AND action = 'restore' AND actor_user_id = pg_temp.u(1)
      AND description = 'Restaurou o membro Bruno Brito'
      AND metadata @> jsonb_build_object('op', 'restore', 'restored_without_leader', true,
                                         'previous_leader_id', pg_temp.m(5), 'role_reset_to_default', true)),
  1, 'RN-19: o evento restore traz sem líder, o líder anterior e a função padrão');

-- Sem conta: continua sem função (DA-2).
SELECT is(pg_temp.jv(1, format('SELECT to_jsonb(r) FROM public.restore_member(%L) r', pg_temp.m(26))),
  '{"restored_without_leader": false, "previous_leader_name": null, "role_reset_to_default": false, "role_name": null}'::jsonb,
  'DA-2: Zeno, sem conta e sem função, volta sem função');
SELECT ok((pg_temp.mem(26)).auth_user_id IS NULL, 'RN-16 f: quem não tinha conta continua sem conta');

-- (b) função acima de quem restaura.
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(21)))), 'restore_role_above',
  'RN-16 b: administrador cuja função não cobre a de Fábio (Administrador) não o restaura');
SELECT is(pg_temp.try(3, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(21))) ->> 'message',
  'Você não tem permissão para restaurar este membro.', 'RN-16 b: texto');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(21)))), '00000',
  'RN-16 b: AD restaura Fábio');

-- Inativo volta inativo.
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(24)))), '00000',
  'RN-16 a: AD exclui Inês, inativa');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(24)))), '00000',
  'RN-16 a: AD restaura Inês');
SELECT is((pg_temp.mem(24)).is_active, false, 'RN-16 a: ela volta inativa');

-- ===========================================================================
-- 5. RN-18: cadastro com dados de um excluído — 31
-- ===========================================================================
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(23)))), '00000',
  'RN-18: AD exclui Bruno (conta no e-mail Bruno@E201-03.invalid)');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(28)))), '00000',
  'RN-18: AD exclui Teo (CPF 390.533.447-05)');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(30)))), '00000',
  'RN-18: AD exclui Olga (e-mail, sem conta)');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(25)))), 'not_found_or_deleted',
  'RN-07: Davi já estava excluído');
UPDATE public.members SET deleted_at = now() - interval '10 minutes' WHERE id = pg_temp.m(28);
UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.m(17)
 WHERE id IN (SELECT pg_temp.m(60 + n) FROM generate_series(1, 11) n);

-- Administrador: nome, data e "Restaurar".
SELECT is(pg_temp.matches(1, ' BRUNO@e201-03.invalid', NULL, NULL),
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.m(23), 'name', 'Bruno Brito', 'deleted_at', now(),
                                       'matched_fields', jsonb_build_array('email'), 'is_account_email', true)),
  'RN-18: AD recebe o cadastro excluído com o e-mail da conta (nome, data, is_account_email)');
-- Quem não é administrador: sem nome nem id, que não saem do servidor.
SELECT is(pg_temp.matches(2, 'bruno@e201-03.invalid', NULL, NULL),
  '[{"member_id": null, "name": null, "deleted_at": null, "matched_fields": ["email"], "is_account_email": true}]'::jsonb,
  'RN-18: LE recebe o aviso do e-mail da conta sem id, nome nem data');
SELECT is(pg_temp.matches(6, NULL, '(51) 99999-0000', NULL),
  '[{"member_id": null, "name": null, "deleted_at": null, "matched_fields": ["mobile"], "is_account_email": false}]'::jsonb,
  'RN-18: CM recebe o aviso do celular, sem o nome');
SELECT is(pg_temp.matches(6, NULL, NULL, '39053344705'),
  '[{"member_id": null, "name": null, "deleted_at": null, "matched_fields": ["cpf"], "is_account_email": false}]'::jsonb,
  'RN-18: o mesmo para o CPF (só os dígitos)');
SELECT is(pg_temp.matches(1, 'bruno@e201-03.invalid', NULL, '390.533.447-05'),
  jsonb_build_array(
    jsonb_build_object('member_id', pg_temp.m(23), 'name', 'Bruno Brito', 'deleted_at', now(),
                       'matched_fields', jsonb_build_array('email'), 'is_account_email', true),
    jsonb_build_object('member_id', pg_temp.m(28), 'name', 'Teo Tavares', 'deleted_at', now() - interval '10 minutes',
                       'matched_fields', jsonb_build_array('cpf'), 'is_account_email', false)),
  'RN-18: e-mail de um excluído e CPF de outro → os dois cadastros, cada um com o seu dado');
SELECT is(pg_temp.matches(1, 'Bruno@E201-03.invalid', '51-99999-0000', '52998224725') -> 0 -> 'matched_fields',
  '["email", "mobile", "cpf"]'::jsonb, 'RN-18: os três dados do mesmo cadastro numa linha');
SELECT is(pg_temp.matches(4, NULL, '51966660000', NULL),
  '[{"member_id": null, "name": null, "deleted_at": null, "matched_fields": ["mobile"], "is_account_email": false}]'::jsonb,
  'DA-8: administrador do ministério recebe Davi (outro ministério) sem nome, como quem não é administrador');
SELECT is(jsonb_array_length(pg_temp.matches(1, NULL, '51977770000', NULL)), 10,
  'RN-18: no máximo 10 cadastros (11 excluídos com o mesmo celular)');
SELECT is(pg_temp.matches(1, 'olga@e201-03.invalid', NULL, NULL) -> 0 -> 'is_account_email', 'false'::jsonb,
  'RN-18: e-mail de um excluído sem conta não é o da conta');
SELECT is(pg_temp.matches(1, NULL, NULL, NULL), '[]'::jsonb, 'RN-18: sem dados, nenhuma linha');
SELECT is(pg_temp.matches(1, '  ', '', '--'), '[]'::jsonb, 'RN-18: dados vazios (só espaços ou sem dígito) não combinam');
SELECT is(pg_temp.matches(1, 'ninguem@e201-03.invalid', NULL, NULL), '[]'::jsonb, 'RN-18: dado sem excluído, nenhuma linha');
SELECT is(pg_temp.matches(1, NULL, '51911112222', NULL), '[]'::jsonb,
  'RN-18: só excluídos combinam (Caio não está excluído)');

-- INSERT direto (sem passar pela create-user-admin).
SELECT is(pg_temp.code(pg_temp.try(6, format($$INSERT INTO public.members (name, gender, leader_id, email)
                                              VALUES ('Novo Bruno', 'M', %L, ' bruno@E201-03.INVALID')$$, pg_temp.m(2)))),
  'deleted_account_email', 'RN-18: INSERT de CM com o e-mail da conta de um excluído é recusado pela API');
SELECT is(pg_temp.try(6, format($$INSERT INTO public.members (name, gender, leader_id, email)
                                  VALUES ('Novo Bruno', 'M', %L, 'bruno@e201-03.invalid')$$, pg_temp.m(2))) ->> 'message',
  'Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.',
  'RN-18: texto do e-mail da conta');
SELECT is(pg_temp.code(pg_temp.try(1, format($$INSERT INTO public.members (name, gender, leader_id, email)
                                              VALUES ('Novo Bruno', 'M', %L, 'bruno@e201-03.invalid')$$, pg_temp.m(2)))),
  'deleted_account_email', 'RN-18: também para o administrador');
SELECT is(pg_temp.code(pg_temp.try(NULL, $$INSERT INTO public.members (name, gender, email)
                                           VALUES ('Novo Bruno', 'M', 'bruno@e201-03.invalid')$$)),
  'deleted_account_email', 'RN-18/DT-27: também como postgres (service role)');
SELECT is(pg_temp.code(pg_temp.try(6, format($$INSERT INTO public.members (name, gender, leader_id, mobile_whatsapp, cpf)
                                              VALUES ('Outra Pessoa', 'F', %L, '51999990000', '52998224725')$$, pg_temp.m(2)))),
  '00000', 'RN-18: celular e CPF de um excluído não impedem o cadastro ("Cadastrar mesmo assim")');
SELECT is(pg_temp.code(pg_temp.try(6, format($$INSERT INTO public.members (name, gender, leader_id, email)
                                              VALUES ('Olga Nova', 'F', %L, 'OLGA@e201-03.invalid')$$, pg_temp.m(2)))),
  '00000', 'RN-18: e-mail de um excluído sem conta também não impede');
SELECT is(pg_temp.try(1, format($$UPDATE public.members SET email = 'bruno@e201-03.invalid' WHERE id = %L$$, pg_temp.m(18))) ->> 'rows',
  '1', 'RN-18: a regra vale ao salvar um membro novo; na edição vale a unicidade do E2.04');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(23)))), 'restore_value_in_use',
  'RN-16 e: com o e-mail de Bruno em outro cadastro, restaurá-lo é recusado');

-- Restaurar a partir do aviso (mesma RPC): depois de liberar o e-mail.
SELECT is(pg_temp.try(1, format($$UPDATE public.members SET email = NULL WHERE id = %L$$, pg_temp.m(18))) ->> 'rows', '1',
  'RN-18: o e-mail é liberado');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(23)))), 'restore_value_in_use',
  'RN-16 e: o celular de Bruno ainda está em uso pela "Outra Pessoa"');
UPDATE public.members SET mobile_whatsapp = NULL, cpf = NULL WHERE name = 'Outra Pessoa' AND leader_id = pg_temp.m(2);
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(23)))), '00000',
  'RN-18: "Restaurar Bruno" (restore_member) funciona depois de liberar os dados');
SELECT is(pg_temp.matches(1, 'bruno@e201-03.invalid', NULL, NULL), '[]'::jsonb,
  'RN-18: restaurado, Bruno deixa de aparecer como excluído');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(23)))), '00000',
  'RN-07: Bruno pode ser excluído de novo depois de restaurado');
SELECT is((SELECT encrypted_password FROM private.member_access_suspensions WHERE member_id = pg_temp.m(23)),
  (SELECT encrypted_password FROM bruno_auth0),
  'RN-14: excluído de novo, a senha guardada é o hash real (nunca o vazio da exclusão anterior)');

SELECT * FROM finish();
ROLLBACK;
