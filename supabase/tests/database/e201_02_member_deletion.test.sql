-- E2.01 (PR 1): exclusão lógica de membros pela API.
-- Spec: docs/specs/e2-01-exclusao-logica.md (repositório apps-mci), "Regras de
-- negócio", "Critérios de aceite", "Formato dos erros" e "Verificações
-- obrigatórias (para o QA)".
--
-- Cobre, sempre pela API (usuário logado com SET ROLE authenticated):
--   - RN-01: a marcação guarda data e autor e não muda mais nada; PATCH ou
--     INSERT tentando marcar deleted_at dá 42501;
--   - RN-02: sem a permissão, cada RPC dá 42501 sem gravar nada (inclusive
--     anon); fora do escopo, not_found_or_deleted (DA-10); com delete_cell e
--     sem delete_cell_report, 42501;
--   - RN-03: próprio cadastro; função não coberta; administrador exclui outro;
--     "cobrir a função" sem assign_role (DT-12);
--   - RN-04: o caso de Gil com o JSON inteiro; a pré-checagem devolve o mesmo
--     objeto que a recusa (DT-11); 7 discípulos; singular; papel duplo na
--     mesma célula; discípulo e célula excluídos não bloqueiam; pastor; Nina;
--   - RN-05: cônjuge desfeito nos dois lados, sem volta na restauração;
--     ranking G12 e árvore de Ministérios com Otávio sozinho;
--   - RN-07: registro excluído não muda (PATCH com 0 linhas; excluir de novo
--     mantém data e autor);
--   - RN-10: Vera, Wagner e Xavier nos dois sentidos; célula masculina;
--     inativo não muda os totais (D2);
--   - RN-19: eventos de exclusão, de restauração e do cônjuge desfeito;
--   - RN-20: auditoria que falha desfaz a exclusão inteira (marcação, cônjuge,
--     acesso);
--   - RN-06: invariante no fim (nada aponta para um excluído).
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(123);

-- ---------------------------------------------------------------------------
-- Ids fixos: a (auth), b (roles), c (membros), d (células), e (relatórios).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2010200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b2010200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2010200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2010200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2010200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

-- Executa _sql como o usuário do Auth número _n (NULL = postgres, sem JWT),
-- num subbloco. Devolve {"state": "00000", "rows": n} ou o erro
-- {"state", "message", "detail" (jsonb quando é JSON), "hint"}.
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

-- Como try, mas como anon (sem JWT).
CREATE FUNCTION pg_temp.try_anon(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('state', '00000');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    RETURN jsonb_build_object('state', _state);
  END;
END $$;

-- Primeira coluna da primeira linha de _sql (texto), como o usuário _n.
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

-- "code" de um resultado de try: o code do app_error (22023 + HINT app_error),
-- ou o SQLSTATE ('00000' quando deu certo).
CREATE FUNCTION pg_temp.code(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _r ->> 'state' = '22023' AND _r ->> 'hint' = 'app_error'
              THEN _r -> 'detail' ->> 'code' ELSE _r ->> 'state' END
$$;

-- Estado da massa deste arquivo (para "nada muda").
CREATE FUNCTION pg_temp.snap() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(
    coalesce((SELECT string_agg(concat_ws('|', id, name, leader_id, spouse_id, role_id, is_active,
                                          deleted_at, deleted_by, total_disciples, total_cells), ';' ORDER BY id)
                FROM public.members WHERE id::text LIKE 'c2010200%'), '')
 || coalesce((SELECT string_agg(concat_ws('|', id, leader_id, timothy_id, host_id, is_active, deleted_at, deleted_by), ';' ORDER BY id)
                FROM public.cells WHERE id::text LIKE 'd2010200%'), '')
 || coalesce((SELECT string_agg(concat_ws('|', id, cell_id, date, deleted_at, deleted_by), ';' ORDER BY id)
                FROM public.cell_reports WHERE id::text LIKE 'e2010200%'), '')
 || coalesce((SELECT count(*)::text FROM public.cell_report_participants WHERE report_id::text LIKE 'e2010200%'), ''))
$$;

CREATE FUNCTION pg_temp.mem(_n int) RETURNS public.members LANGUAGE sql STABLE AS
$$ SELECT * FROM public.members WHERE id = pg_temp.m(_n) $$;

-- ---------------------------------------------------------------------------
-- Massa. Como postgres e com os triggers ligados: níveis, cônjuges e totais
-- vêm dos triggers reais.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, encrypted_password)
SELECT pg_temp.u(n), 'e201-02-' || n || '@teste.invalid', extensions.crypt('Senha#' || n, extensions.gen_salt('bf', 4))
  FROM generate_series(1, 9) n;
-- 1 Elisa (AD), 2 Lucas (LE), 3 Maria (MB), 4 Lia (LE do ministério), 5 Celso
-- (só delete_cell), 6 Adão (administrador sem todas as permissões), 7 Fábio
-- (AD), 8 Aurora (auditoria), 9 Rita (MB, casada, com sessão)

INSERT INTO public.roles (id, name) VALUES
  (pg_temp.role(1), 'E201-02 AD'), (pg_temp.role(2), 'E201-02 LE'), (pg_temp.role(3), 'E201-02 MB'),
  (pg_temp.role(4), 'E201-02 LE ministério'), (pg_temp.role(5), 'E201-02 só delete_cell'),
  (pg_temp.role(6), 'E201-02 AD parcial'), (pg_temp.role(8), 'E201-02 auditoria');
INSERT INTO public.role_permissions (role_id, permission)
SELECT pg_temp.role(1), p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(2), 'view_all_church'), (pg_temp.role(2), 'view_dashboard'), (pg_temp.role(2), 'create_member'),
  (pg_temp.role(2), 'edit_member'), (pg_temp.role(2), 'delete_member'), (pg_temp.role(2), 'create_cell'),
  (pg_temp.role(2), 'edit_cell'), (pg_temp.role(2), 'delete_cell'), (pg_temp.role(2), 'delete_cell_report'),
  (pg_temp.role(3), 'view_all_church'), (pg_temp.role(3), 'view_dashboard'),
  (pg_temp.role(4), 'view_own_ministry'), (pg_temp.role(4), 'view_dashboard'), (pg_temp.role(4), 'delete_member'),
  (pg_temp.role(4), 'delete_cell'), (pg_temp.role(4), 'delete_cell_report'),
  (pg_temp.role(5), 'view_all_church'), (pg_temp.role(5), 'delete_cell'),
  (pg_temp.role(6), 'manage_roles'), (pg_temp.role(6), 'view_all_church'), (pg_temp.role(6), 'delete_member'),
  (pg_temp.role(6), 'view_dashboard'),
  (pg_temp.role(8), 'view_audit_log'), (pg_temp.role(8), 'view_all_church');

-- Árvore (nível entre parênteses):
--   Paulo Pastor (0)
--   ├─ Vera (1) → Wagner (2) → Xavier (3); Wagner → Iara (inativa)     [RN-10]
--   ├─ Gina (1) → Gil → Hugo, Ivo, João, Léo (inativo)                  [RN-04]
--   │           → Carlos, Marcos, Neto, Lucas, Maria, Lia, Bruno, Celso,
--   │             Quintino, Aurora, Gustavo (→ 7), Gaspar (→ Dário),
--   │             Rita & Raul, Lauro
--   ├─ Otávio (1) & Paula (1), casados                                   [RN-05]
--   ├─ Elisa (1, AD), Fábio (1, AD), Adão (1, AD parcial)
--   └─ Dora (1) → Davi (outro ministério)                                [RN-02]
--   Nina: inativa, sem líder, casada com Neto                            [RN-04]
-- E2.04 (DT-23): todo cadastro novo tem um identificador real (RN-08).
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '5192012' || lpad(_n::text, 4, '0') $$;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(1), 'Paulo Pastor E201', 'M', true, NULL, false, true, pg_temp.mob(1));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(2),  'Vera Valente',   'F', pg_temp.m(1), true, true, NULL, NULL, pg_temp.mob(2)),
  (pg_temp.m(30), 'Gina Garcia',    'F', pg_temp.m(1), true, true, NULL, NULL, pg_temp.mob(30)),
  (pg_temp.m(13), 'Otávio Ortiz',   'M', pg_temp.m(1), true, true, NULL, NULL, pg_temp.mob(13)),
  (pg_temp.m(14), 'Paula Prado',    'F', pg_temp.m(1), true, true, NULL, NULL, pg_temp.mob(14)),
  (pg_temp.m(17), 'Elisa Esteves',  'F', pg_temp.m(1), true, true, pg_temp.u(1), pg_temp.role(1), pg_temp.mob(17)),
  (pg_temp.m(21), 'Fábio Freitas',  'M', pg_temp.m(1), true, true, pg_temp.u(7), pg_temp.role(1), pg_temp.mob(21)),
  (pg_temp.m(22), 'Adão Alves',     'M', pg_temp.m(1), true, true, pg_temp.u(6), pg_temp.role(6), pg_temp.mob(22)),
  (pg_temp.m(40), 'Dora Dias',      'F', pg_temp.m(1), true, true, NULL, NULL, pg_temp.mob(40));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(3),  'Wagner Wolff',     'M', pg_temp.m(2),  true, true,  NULL, NULL, pg_temp.mob(3)),
  (pg_temp.m(5),  'Gil Gomes',        'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(5)),
  (pg_temp.m(10), 'Carlos Castro',    'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(10)),
  (pg_temp.m(11), 'Marcos Moura',     'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(11)),
  (pg_temp.m(15), 'Neto Nobre',       'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(15)),
  (pg_temp.m(18), 'Lucas Lopes',      'M', pg_temp.m(30), true, true,  pg_temp.u(2), pg_temp.role(2), pg_temp.mob(18)),
  (pg_temp.m(19), 'Maria Melo',       'F', pg_temp.m(30), true, true,  pg_temp.u(3), pg_temp.role(3), pg_temp.mob(19)),
  (pg_temp.m(20), 'Lia Lacerda',      'F', pg_temp.m(30), true, true,  pg_temp.u(4), pg_temp.role(4), pg_temp.mob(20)),
  (pg_temp.m(23), 'Bruno Brito',      'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(23)),
  (pg_temp.m(24), 'Celso Cunha',      'M', pg_temp.m(30), true, true,  pg_temp.u(5), pg_temp.role(5), pg_temp.mob(24)),
  (pg_temp.m(25), 'Quintino Quadros', 'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(25)),
  (pg_temp.m(26), 'Aurora Assis',     'F', pg_temp.m(30), true, true,  pg_temp.u(8), pg_temp.role(8), pg_temp.mob(26)),
  (pg_temp.m(32), 'Gustavo Góis',     'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(32)),
  (pg_temp.m(33), 'Gaspar Gama',      'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(33)),
  (pg_temp.m(35), 'Rita Rocha',       'F', pg_temp.m(30), true, true,  pg_temp.u(9), pg_temp.role(3), pg_temp.mob(35)),
  (pg_temp.m(36), 'Raul Rocha',       'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(36)),
  (pg_temp.m(37), 'Lauro Leme',       'M', pg_temp.m(30), true, true,  NULL, NULL, pg_temp.mob(37)),
  (pg_temp.m(41), 'Davi Duarte',      'M', pg_temp.m(40), true, true,  NULL, NULL, pg_temp.mob(41));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(4),  'Xavier Xisto',   'M', pg_temp.m(3),  true, true, pg_temp.mob(4)),
  (pg_temp.m(31), 'Iara Inativa',   'F', pg_temp.m(3),  true, false, pg_temp.mob(31)),
  (pg_temp.m(6),  'Hugo Hart',      'M', pg_temp.m(5),  true, true, pg_temp.mob(6)),
  (pg_temp.m(7),  'Ivo Iglesias',   'M', pg_temp.m(5),  true, true, pg_temp.mob(7)),
  (pg_temp.m(8),  'João Jardim',    'M', pg_temp.m(5),  true, true, pg_temp.mob(8)),
  (pg_temp.m(9),  'Léo Lins',       'M', pg_temp.m(5),  true, false, pg_temp.mob(9)),
  (pg_temp.m(34), 'Dário Dutra',    'M', pg_temp.m(33), true, true, pg_temp.mob(34));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp)
SELECT pg_temp.m(50 + n), 'Gustavo Discípulo ' || n, 'M', pg_temp.m(32), true, true, pg_temp.mob(50 + n) FROM generate_series(1, 7) n;
INSERT INTO public.members (id, name, gender, is_active, has_leadership, spouse_id, mobile_whatsapp) VALUES
  (pg_temp.m(12), 'Nina Nunes', 'F', false, false, pg_temp.m(15), pg_temp.mob(12));
UPDATE public.members SET spouse_id = pg_temp.m(14) WHERE id = pg_temp.m(13);
UPDATE public.members SET spouse_id = pg_temp.m(36) WHERE id = pg_temp.m(35);

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active) VALUES
  (pg_temp.c(1), pg_temp.m(10), pg_temp.m(5), pg_temp.m(10), 'Evangelística', 'Quarta',  '20:00', true),
  (pg_temp.c(2), pg_temp.m(11), NULL,         pg_temp.m(5),  'Discipulado',   'Sexta',   '19:30', false),
  (pg_temp.c(3), pg_temp.m(15), NULL,         pg_temp.m(15), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(4), pg_temp.m(3),  NULL,         pg_temp.m(3),  'Evangelística', 'Terça',   '20:00', true);

-- Nina participou de 20 relatórios (semanas passadas, com replica: fora da semana atual).
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held)
SELECT pg_temp.r(k), pg_temp.c(3), public.week_start(public.sp_today()) - 7 * k + 1, '20:00', 'Tema ' || k, true
  FROM generate_series(1, 20) k;
INSERT INTO public.cell_report_participants (report_id, member_id)
SELECT pg_temp.r(k), pg_temp.m(12) FROM generate_series(1, 20) k;
SET LOCAL session_replication_role = origin;

-- Rita tem uma sessão aberta e um refresh token (RN-20).
INSERT INTO auth.sessions (id, user_id, created_at) VALUES ('f2010200-0000-0000-0000-000000000009', pg_temp.u(9), now());
INSERT INTO auth.refresh_tokens (token, user_id, session_id, revoked, created_at)
VALUES ('e201-02-rt-9', pg_temp.u(9)::text, 'f2010200-0000-0000-0000-000000000009', false, now());

-- ===========================================================================
-- 1. RN-02: sem a permissão, cada RPC dá 42501 e nada muda — 14
-- ===========================================================================
CREATE TEMP TABLE snap0 AS SELECT pg_temp.snap() AS s;

SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.%s(%L)', f, arg))), '42501',
          'RN-02: MB sem permissão → ' || f || ' dá 42501')
  FROM (VALUES ('check_member_deletion', pg_temp.m(23)::text), ('delete_member', pg_temp.m(23)::text),
               ('restore_member', pg_temp.m(23)::text), ('delete_cell', pg_temp.c(1)::text),
               ('restore_cell', pg_temp.c(1)::text), ('delete_cell_report', pg_temp.r(1)::text),
               ('restore_cell_report', pg_temp.r(1)::text)) AS t(f, arg);
SELECT is(pg_temp.code(pg_temp.try(3, $$SELECT * FROM public.find_deleted_member_matches('x@teste.invalid', NULL, NULL)$$)),
  '42501', 'RN-02: MB sem create_member → find_deleted_member_matches dá 42501');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])',
                                            pg_temp.r(1), pg_temp.m(23)))),
  '42501', 'RN-02: MB sem política de INSERT de participantes → set_cell_report_participants dá 42501');
SELECT is(pg_temp.try(3, format('SELECT public.delete_member(%L)', pg_temp.m(23))) ->> 'message',
  'Você não tem permissão para esta ação.', 'RN-02: texto do 42501 (Formato dos erros)');
SELECT is(pg_temp.try_anon(format('SELECT public.delete_member(%L)', pg_temp.m(23))) ->> 'state', '42501',
  'RN-02: anon não executa delete_member');
SELECT is(pg_temp.try_anon(format('SELECT public.check_member_deletion(%L)', pg_temp.m(23))) ->> 'state', '42501',
  'RN-02: anon não executa check_member_deletion');
SELECT is(pg_temp.code(pg_temp.try(5, format('SELECT public.delete_cell_report(%L)', pg_temp.r(1)))), '42501',
  'RN-02: com delete_cell e sem delete_cell_report, excluir relatório dá 42501');
SELECT is(pg_temp.snap(), (SELECT s FROM snap0), 'RN-02: nenhuma das recusas gravou nada');

-- ===========================================================================
-- 2. RN-02 e RN-01: quem tem a permissão exclui o que vê — 13
-- ===========================================================================
CREATE TEMP TABLE bruno0 AS SELECT * FROM public.members WHERE id = pg_temp.m(23);

SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(23)))), '00000',
  'RN-02: LE exclui Bruno, que ele vê e que não tem ligações');
SELECT is((pg_temp.mem(23)).deleted_at, now(), 'RN-01: data e hora da exclusão gravadas');
SELECT is((pg_temp.mem(23)).deleted_by, pg_temp.m(18), 'RN-01: autor gravado (o membro de quem excluiu, DT-01)');
SELECT is(
  to_jsonb(pg_temp.mem(23)) - ARRAY['deleted_at', 'deleted_by', 'updated_at'],
  (SELECT to_jsonb(b) - ARRAY['deleted_at', 'deleted_by', 'updated_at'] FROM bruno0 b),
  'RN-01: a exclusão não muda nenhum outro dado do registro');
SELECT is(pg_temp.val(2, format('SELECT count(*) FROM public.members_view WHERE id = %L', pg_temp.m(23))), '0',
  'RN-01/RN-08: Bruno some da members_view de quem excluiu');
SELECT is(pg_temp.val(2, format('SELECT count(*) FROM public.members WHERE id = %L', pg_temp.m(23))), '0',
  'RN-08: Bruno some também da tabela sob RLS');
SELECT is((SELECT count(*)::int FROM public.members WHERE id = pg_temp.m(23)), 1,
  'RN-01: o registro continua guardado no banco');

SELECT is(pg_temp.code(pg_temp.try(4, format('SELECT public.delete_member(%L)', pg_temp.m(41)))), 'not_found_or_deleted',
  'RN-02/DA-10: LE do ministério não exclui Davi, de outro ministério (vale como inexistente)');
SELECT is(pg_temp.try(4, format('SELECT public.delete_member(%L)', pg_temp.m(41))) ->> 'message',
  'Este cadastro não existe ou já foi excluído.', 'RN-02: mensagem de cadastro inexistente');
SELECT is((pg_temp.mem(41)).deleted_at, NULL, 'RN-02: Davi continua');
SELECT is(pg_temp.jv(4, format('SELECT public.check_member_deletion(%L)', pg_temp.m(41))),
  '{"can_delete": false, "code": "not_found_or_deleted", "entity": "member",
    "message": "Este cadastro não existe ou já foi excluído."}'::jsonb,
  'RN-02: a pré-checagem também trata Davi como inexistente');
SELECT is(pg_temp.code(pg_temp.try(4, format('SELECT public.delete_member(%L)', pg_temp.m(37)))), '00000',
  'RN-02: LE do ministério exclui Lauro, do próprio ministério');
SELECT is(pg_temp.try(2, 'SELECT public.delete_member(NULL)') -> 'detail',
  '{"code": "not_found_or_deleted", "entity": "member"}'::jsonb,
  'RN-02: id nulo → not_found_or_deleted com entity member (formato AQ-2)');

-- ===========================================================================
-- 3. RN-03: limites ao excluir um membro — 10
-- ===========================================================================
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(18)))), 'self_delete',
  'RN-03: LE não exclui o próprio cadastro');
SELECT is(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(18))) ->> 'message',
  'Você não pode excluir o seu próprio cadastro.', 'RN-03: texto do próprio cadastro');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(17)))), 'role_above',
  'RN-03: LE não exclui a administradora Elisa (função não coberta)');
SELECT is(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(17))) ->> 'message',
  'Você não tem permissão para excluir este membro.', 'RN-03: texto da função acima');
SELECT is((pg_temp.mem(17)).deleted_at, NULL, 'RN-03: Elisa continua');
SELECT is(pg_temp.code(pg_temp.try(6, format('SELECT public.delete_member(%L)', pg_temp.m(21)))), 'role_above',
  'RN-03: administrador cuja função não tem todas as permissões não exclui Fábio (Administrador)');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(19)))), '00000',
  'RN-03/DT-12: LE exclui Maria, cuja função ele cobre, sem ter assign_role');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(21)))), '00000',
  'RN-03: AD exclui o outro administrador, Fábio');
SELECT is((pg_temp.mem(21)).deleted_by, pg_temp.m(17), 'RN-03: Fábio excluído por Elisa');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(17)))), 'self_delete',
  'RN-03: AD continua sem poder excluir a si mesmo');

-- ===========================================================================
-- 4. RN-04: membro com ligações — 22
-- ===========================================================================
CREATE TEMP TABLE gil_expected AS SELECT jsonb_build_object(
  'can_delete', false,
  'code', 'member_has_links',
  'message', 'Não é possível excluir Gil Gomes. Antes, reatribua 4 discípulos e 2 células.',
  'member_id', pg_temp.m(5),
  'member_name', 'Gil Gomes',
  'disciples_total', 4,
  'disciples', jsonb_build_array(
    jsonb_build_object('id', pg_temp.m(6), 'name', 'Hugo Hart',    'is_active', true),
    jsonb_build_object('id', pg_temp.m(7), 'name', 'Ivo Iglesias', 'is_active', true),
    jsonb_build_object('id', pg_temp.m(8), 'name', 'João Jardim',  'is_active', true),
    jsonb_build_object('id', pg_temp.m(9), 'name', 'Léo Lins',     'is_active', false)),
  'cells_total', 2,
  'cells', jsonb_build_array(
    jsonb_build_object('id', pg_temp.c(1), 'roles', jsonb_build_array('timothy'), 'leader_name', 'Carlos Castro',
                       'meeting_day', 'Quarta', 'meeting_time', '20:00', 'is_active', true),
    jsonb_build_object('id', pg_temp.c(2), 'roles', jsonb_build_array('host'), 'leader_name', 'Marcos Moura',
                       'meeting_day', 'Sexta', 'meeting_time', '19:30', 'is_active', false))
) AS j;
CREATE TEMP TABLE snap1 AS SELECT pg_temp.snap() AS s;

SELECT is(pg_temp.jv(2, format('SELECT public.check_member_deletion(%L)', pg_temp.m(5))),
  (SELECT j FROM gil_expected),
  'RN-04: pré-checagem de Gil com o JSON inteiro (4 discípulos com Léo inativo; timóteo na de Carlos, anfitrião na de Marcos inativa)');
CREATE TEMP TABLE gil_err AS SELECT pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(5))) AS e;
SELECT is((SELECT e ->> 'state' FROM gil_err), '22023', 'RN-04: a recusa é 22023');
SELECT is((SELECT e ->> 'hint' FROM gil_err), 'app_error', 'RN-04: com HINT app_error');
SELECT is((SELECT e -> 'detail' FROM gil_err), (SELECT j - 'can_delete' - 'message' FROM gil_expected),
  'RN-04/DT-11: o DETAIL da recusa é o mesmo objeto da pré-checagem');
SELECT is((SELECT e ->> 'message' FROM gil_err), (SELECT j ->> 'message' FROM gil_expected),
  'RN-04: a mensagem de reserva é a mesma da pré-checagem');
SELECT is(pg_temp.snap(), (SELECT s FROM snap1), 'RN-04: a recusa não muda nada');

-- Reatribuições pela API (LE).
SELECT is(pg_temp.try(2, format('UPDATE public.members SET leader_id = %L WHERE id IN (%L, %L, %L, %L)',
                                pg_temp.m(10), pg_temp.m(6), pg_temp.m(7), pg_temp.m(8), pg_temp.m(9))) ->> 'rows',
  '4', 'RN-04: LE reatribui os 4 discípulos de Gil a Carlos');
SELECT is(pg_temp.try(2, format('UPDATE public.cells SET timothy_id = %L WHERE id = %L', pg_temp.m(15), pg_temp.c(1))) ->> 'rows',
  '1', 'RN-04: a célula de Carlos recebe outro timóteo');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_cell(%L)', pg_temp.c(2)))), '00000',
  'RN-04: a célula de Marcos é excluída');
SELECT is(pg_temp.jv(2, format('SELECT public.check_member_deletion(%L)', pg_temp.m(5))), '{"can_delete": true}'::jsonb,
  'RN-04: depois de reatribuir, a pré-checagem libera (célula excluída não impede)');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(5)))), '00000',
  'RN-04: depois de reatribuir, LE exclui Gil');

-- 7 discípulos: 5 nomes e o total.
CREATE TEMP TABLE gus AS SELECT pg_temp.jv(2, format('SELECT public.check_member_deletion(%L)', pg_temp.m(32))) AS j;
SELECT is((SELECT (j ->> 'disciples_total')::int FROM gus), 7, 'RN-04: Gustavo com 7 discípulos → disciples_total = 7');
SELECT is((SELECT jsonb_array_length(j -> 'disciples') FROM gus), 5, 'RN-04: a lista traz só 5 nomes ("e mais 2" na tela)');
SELECT is((SELECT array_agg(x ->> 'name' ORDER BY ord) FROM gus, jsonb_array_elements(j -> 'disciples') WITH ORDINALITY t(x, ord)),
  ARRAY['Gustavo Discípulo 1', 'Gustavo Discípulo 2', 'Gustavo Discípulo 3', 'Gustavo Discípulo 4', 'Gustavo Discípulo 5'],
  'RN-04: os 5 primeiros por nome');
SELECT is((SELECT j ->> 'message' FROM gus), 'Não é possível excluir Gustavo Góis. Antes, reatribua 7 discípulos.',
  'RN-04: mensagem de reserva sem células (plural)');

-- Singular e papel duplo na mesma célula.
SELECT is(pg_temp.jv(2, format('SELECT public.check_member_deletion(%L)', pg_temp.m(33))) ->> 'message',
  'Não é possível excluir Gaspar Gama. Antes, reatribua 1 discípulo.', 'RN-04: singular (1 discípulo)');
SELECT is(pg_temp.jv(2, format('SELECT public.check_member_deletion(%L)', pg_temp.m(10))) -> 'cells' -> 0 -> 'roles',
  '["leader", "host"]'::jsonb, 'RN-04: Carlos é líder e anfitrião da mesma célula → os dois papéis num item');
SELECT is(pg_temp.jv(2, format('SELECT public.check_member_deletion(%L)', pg_temp.m(10))) ->> 'message',
  'Não é possível excluir Carlos Castro. Antes, reatribua 4 discípulos e 1 célula.', 'RN-04: singular (1 célula)');

-- Discípulo excluído não bloqueia.
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(34)))), '00000',
  'RN-04: Dário, o único discípulo de Gaspar, é excluído');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(33)))), '00000',
  'RN-04: o discípulo já excluído não impede a exclusão de Gaspar');

-- Pastor com G12.
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(1)))), 'member_has_links',
  'RN-04: o pastor com discípulos G12 é recusado pela mesma regra (AD)');
SELECT is((pg_temp.jv(1, format('SELECT public.check_member_deletion(%L)', pg_temp.m(1))) ->> 'disciples_total')::int,
  (SELECT count(*)::int FROM public.members WHERE leader_id = pg_temp.m(1) AND deleted_at IS NULL),
  'RN-04: o total de discípulos do pastor são os diretos não excluídos (Fábio, excluído, fora)');

-- Nina: inativa, sem líder, casada, com 20 participações.
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(12)))), '00000',
  'RN-04: Nina (inativa, sem líder, casada, 20 participações) é excluída');
SELECT is((SELECT count(*)::int FROM public.cell_report_participants WHERE member_id = pg_temp.m(12)), 20,
  'RN-01/RN-13: as 20 participações de Nina continuam guardadas');

-- ===========================================================================
-- 5. RN-05: cônjuge — 9
-- ===========================================================================
SELECT is(pg_temp.val(1, format($$SELECT couple_key FROM public.dashboard_g12_ranking() WHERE couple_key LIKE '%%' || %L || '%%'$$, pg_temp.m(13))),
  least(pg_temp.m(13), pg_temp.m(14))::text || '|' || greatest(pg_temp.m(13), pg_temp.m(14))::text,
  'RN-05 (antes): Otávio e Paula são um casal no ranking G12');
SELECT is((pg_temp.mem(15)).spouse_id, NULL, 'RN-05: excluir Nina desfez o vínculo do lado de Neto');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(14)))), '00000',
  'RN-05: AD exclui Paula');
SELECT ok((pg_temp.mem(14)).spouse_id IS NULL AND (pg_temp.mem(13)).spouse_id IS NULL,
  'RN-05: os dois cadastros ficam sem cônjuge, na mesma operação');
SELECT is(pg_temp.val(1, format($$SELECT coalesce(spouse_name, '<sozinho>') FROM public.dashboard_g12_ranking() WHERE couple_key = %L$$, pg_temp.m(13)::text)),
  '<sozinho>', 'RN-05: Otávio aparece sozinho no ranking G12');
SELECT is(pg_temp.val(1, format($$SELECT coalesce(spouse_id::text, '<sozinho>') FROM public.ministry_tree_nodes(ARRAY[%L]::uuid[]) WHERE member_id = %L$$,
                               pg_temp.m(1), pg_temp.m(13))),
  '<sozinho>', 'RN-05: Otávio aparece sozinho na árvore de Ministérios');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(14)))), '00000',
  'RN-05: AD restaura Paula');
SELECT ok((pg_temp.mem(14)).spouse_id IS NULL AND (pg_temp.mem(13)).spouse_id IS NULL,
  'RN-05/RN-16 c: a restauração não refaz o vínculo');
SELECT is(pg_temp.val(1, format($$SELECT count(*) FROM public.dashboard_g12_ranking() WHERE couple_key IN (%L, %L)$$,
                               pg_temp.m(13)::text, pg_temp.m(14)::text)),
  '2', 'RN-05: depois da restauração, Otávio e Paula aparecem cada um sozinho no ranking');

-- ===========================================================================
-- 6. RN-07: registro excluído não é alterado — 9
-- ===========================================================================
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(25)))), '00000',
  'RN-07: AD exclui Quintino');
-- A primeira exclusão fica um dia para trás, para conferir que ela vale.
UPDATE public.members SET deleted_at = now() - interval '1 day' WHERE id = pg_temp.m(25);

SELECT is(pg_temp.try(1, format($$UPDATE public.members SET name = 'Quintino Editado' WHERE id = %L$$, pg_temp.m(25))) ->> 'rows',
  '0', 'RN-07: PATCH de AD num membro excluído volta com 0 linhas (DT-19)');
SELECT is(pg_temp.try(2, format($$UPDATE public.members SET notes = 'x' WHERE id = %L$$, pg_temp.m(25))) ->> 'rows',
  '0', 'RN-07: PATCH de LE num membro excluído volta com 0 linhas');
SELECT is(pg_temp.try(1, format($$UPDATE public.members SET role_id = %L WHERE id = %L$$, pg_temp.role(3), pg_temp.m(25))) ->> 'rows',
  '0', 'RN-07: a função de um excluído não é alterada (0 linhas)');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(25)))), 'not_found_or_deleted',
  'RN-07: excluir de novo dá not_found_or_deleted');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_member(%L)', pg_temp.m(25)))), 'not_found_or_deleted',
  'RN-07: excluir de novo por outra pessoa também');
SELECT is((pg_temp.mem(25)).deleted_at, now() - interval '1 day', 'RN-07: a data da exclusão continua a da primeira vez');
SELECT is((pg_temp.mem(25)).deleted_by, pg_temp.m(17), 'RN-07: o autor continua o da primeira vez');
SELECT is((pg_temp.mem(25)).name, 'Quintino Quadros', 'RN-07: nada do cadastro mudou');

-- ===========================================================================
-- 7. RN-01: a marcação é só pela RPC — 4
-- ===========================================================================
SELECT is(pg_temp.try(1, format('UPDATE public.members SET deleted_at = now() WHERE id = %L', pg_temp.m(36))) ->> 'state',
  '42501', 'RN-01: PATCH de AD tentando marcar deleted_at dá 42501');
SELECT is(pg_temp.try(1, format('UPDATE public.members SET deleted_at = now(), deleted_by = %L WHERE id = %L',
                                pg_temp.m(17), pg_temp.m(36))) ->> 'state',
  '42501', 'RN-01: PATCH marcando data e autor também dá 42501');
SELECT is(pg_temp.try(1, $$INSERT INTO public.members (name, gender, deleted_at) VALUES ('Já Excluído', 'M', now())$$) ->> 'state',
  '42501', 'RN-01: INSERT de um membro já excluído dá 42501');
SELECT is((pg_temp.mem(36)).deleted_at, NULL, 'RN-01: Raul continua não excluído');

-- ===========================================================================
-- 8. RN-10: totais — 16
-- ===========================================================================
SELECT is(ARRAY[(pg_temp.mem(2)).total_disciples, (pg_temp.mem(3)).total_disciples], ARRAY[2, 1],
  'RN-10 (antes): Vera soma 2 discípulos e Wagner 1 (Iara inativa fora, D2)');
CREATE TEMP TABLE paulo0 AS SELECT total_disciples, total_cells, male_cells FROM public.members WHERE id = pg_temp.m(1);

SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(4)))), '00000',
  'RN-10: AD exclui Xavier');
SELECT is(ARRAY[(pg_temp.mem(2)).total_disciples, (pg_temp.mem(3)).total_disciples], ARRAY[1, 0],
  'RN-10: Vera passa a 1 e Wagner a 0, na mesma operação');
SELECT is((pg_temp.mem(1)).total_disciples, (SELECT total_disciples - 1 FROM paulo0),
  'RN-10: o pastor (ancestral) também perde 1');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(4)))), '00000',
  'RN-10: AD restaura Xavier');
SELECT is(ARRAY[(pg_temp.mem(2)).total_disciples, (pg_temp.mem(3)).total_disciples], ARRAY[2, 1],
  'RN-10: Vera volta a 2 e Wagner a 1');
SELECT is((pg_temp.mem(4)).g12_level, 3, 'RN-16 a: o nível de Xavier é recalculado na restauração');

SELECT is(ARRAY[(pg_temp.mem(3)).total_cells, (pg_temp.mem(3)).male_cells, (pg_temp.mem(2)).total_cells, (pg_temp.mem(2)).male_cells],
  ARRAY[1, 1, 1, 1], 'RN-10 (antes): a célula de Wagner conta para Wagner e Vera (masculina)');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_cell(%L)', pg_temp.c(4)))), '00000',
  'RN-10: AD exclui a célula de Wagner');
SELECT is(ARRAY[(pg_temp.mem(3)).total_cells, (pg_temp.mem(3)).male_cells, (pg_temp.mem(2)).total_cells, (pg_temp.mem(2)).male_cells],
  ARRAY[0, 0, 0, 0], 'RN-10: total de células e células masculinas de Wagner e de Vera diminuem 1');
SELECT is((pg_temp.mem(1)).total_cells, (SELECT total_cells - 1 FROM paulo0), 'RN-10: a cadeia inteira do líder perde a célula (pastor)');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.restore_cell(%L)', pg_temp.c(4)))), '00000',
  'RN-10: AD restaura a célula');
SELECT is(ARRAY[(pg_temp.mem(3)).total_cells, (pg_temp.mem(3)).male_cells, (pg_temp.mem(2)).total_cells, (pg_temp.mem(2)).male_cells],
  ARRAY[1, 1, 1, 1], 'RN-10: restaurada a célula, os totais voltam');

CREATE TEMP TABLE tot_d2 AS SELECT id, total_disciples, total_cells, male_cells, female_cells
  FROM public.members WHERE id IN (pg_temp.m(1), pg_temp.m(2), pg_temp.m(3));
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(31)))), '00000',
  'RN-10: AD exclui Iara, inativa e sem ligações');
SELECT set_eq(
  format('SELECT id, total_disciples, total_cells, male_cells, female_cells FROM public.members WHERE id IN (%L, %L, %L)',
         pg_temp.m(1), pg_temp.m(2), pg_temp.m(3)),
  'SELECT * FROM tot_d2',
  'RN-10/D2: excluir um inativo não muda nenhum total');
SELECT is((pg_temp.mem(1)).total_disciples, (SELECT total_disciples FROM paulo0), 'RN-10: o pastor voltou ao total original');

-- ===========================================================================
-- 9. RN-19: auditoria — 13
-- ===========================================================================
SELECT is(
  (SELECT jsonb_build_object('actor', actor_user_id, 'label', entity_label, 'desc', description,
                             'fields', changed_fields, 'op', metadata ->> 'op', 'success', success)
     FROM public.events WHERE entity = 'member' AND entity_id = pg_temp.m(23) AND action = 'delete'),
  jsonb_build_object('actor', pg_temp.u(2), 'label', 'Bruno Brito', 'desc', 'Excluiu o membro Bruno Brito',
                     'fields', ARRAY['deleted_at'], 'op', 'soft_delete', 'success', true),
  'RN-19: exclusão de Bruno na Auditoria, com quem fez e o nome');
SELECT is((SELECT count(*)::int FROM public.events WHERE entity = 'member' AND entity_id = pg_temp.m(23) AND action = 'delete'), 1,
  'RN-19: um evento só para a exclusão');
SELECT is((SELECT occurred_at FROM public.events WHERE entity_id = pg_temp.m(23) AND action = 'delete'), now(),
  'RN-19: com o horário');
SELECT is(
  (SELECT jsonb_build_object('fields', changed_fields, 'spouse', metadata -> 'spouse_id')
     FROM public.events WHERE entity_id = pg_temp.m(14) AND action = 'delete'),
  jsonb_build_object('fields', ARRAY['deleted_at', 'spouse_id'],
                     'spouse', jsonb_build_object('from', pg_temp.m(13), 'to', NULL)),
  'RN-19: a exclusão de Paula registra o cônjuge de/para');
SELECT is(
  (SELECT jsonb_build_object('actor', actor_user_id, 'desc', description, 'reason', metadata ->> 'reason',
                             'spouse', metadata -> 'spouse_id', 'fields', changed_fields)
     FROM public.events WHERE entity_id = pg_temp.m(13) AND action = 'update' AND metadata ->> 'reason' = 'spouse_deleted'),
  jsonb_build_object('actor', pg_temp.u(1), 'desc', 'Vínculo de cônjuge desfeito pela exclusão de Paula Prado',
                     'reason', 'spouse_deleted', 'spouse', jsonb_build_object('from', pg_temp.m(14), 'to', NULL),
                     'fields', ARRAY['spouse_id']),
  'RN-19: a alteração do cônjuge de Otávio também é registrada (reason spouse_deleted)');
SELECT is((SELECT count(*)::int FROM public.events WHERE entity_id = pg_temp.m(15) AND metadata ->> 'reason' = 'spouse_deleted'), 1,
  'RN-19: o cônjuge desfeito de Neto (pela exclusão de Nina) também');
SELECT is(
  (SELECT jsonb_build_object('actor', actor_user_id, 'desc', description, 'op', metadata ->> 'op',
                             'without_leader', metadata ->> 'restored_without_leader',
                             'role_reset', metadata ->> 'role_reset_to_default')
     FROM public.events WHERE entity_id = pg_temp.m(4) AND action = 'restore'),
  jsonb_build_object('actor', pg_temp.u(1), 'desc', 'Restaurou o membro Xavier Xisto', 'op', 'restore',
                     'without_leader', 'false', 'role_reset', 'false'),
  'RN-19: restauração de Xavier na Auditoria (action restore)');
SELECT is((SELECT count(*)::int FROM public.events WHERE entity = 'cell' AND entity_id = pg_temp.c(4) AND action IN ('delete', 'restore')), 2,
  'RN-19: exclusão e restauração da célula de Wagner, um registro cada');
SELECT is((SELECT array_agg(action::text ORDER BY action::text) FROM public.events
            WHERE entity = 'cell' AND entity_id = pg_temp.c(4) AND action IN ('delete', 'restore')),
  ARRAY['delete', 'restore'], 'RN-19: os dois com a ação certa');
SELECT is((SELECT count(*)::int FROM public.events WHERE entity_id = pg_temp.m(25) AND action = 'delete'), 1,
  'RN-19/RN-07: a segunda tentativa de excluir Quintino não gera evento');
SELECT is(pg_temp.val(8, format($$SELECT string_agg(action::text, ',' ORDER BY action::text) FROM public.events WHERE entity_id = %L$$, pg_temp.m(23))),
  'create,delete', 'RN-09 a: quem audita vê os eventos de Bruno de antes e de depois da exclusão');
SELECT is(pg_temp.val(8, format($$SELECT string_agg(DISTINCT entity_label, ',') FROM public.events WHERE entity_id = %L$$, pg_temp.m(23))),
  'Bruno Brito', 'RN-09 a: com o nome dele');
SELECT is(pg_temp.val(3, format($$SELECT count(*) FROM public.events WHERE entity_id = %L$$, pg_temp.m(23))),
  '0', 'RN-19: quem não tem view_audit_log não vê os eventos');

-- ===========================================================================
-- 10. RN-20: a auditoria que falha desfaz a exclusão inteira — 9
-- ===========================================================================
CREATE TEMP TABLE rita_auth AS SELECT encrypted_password, banned_until FROM auth.users WHERE id = pg_temp.u(9);
ALTER TABLE public.events ADD CONSTRAINT e201_qa_audit_fails CHECK (action <> 'delete') NOT VALID;

SELECT is(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(35))) ->> 'state', '23514',
  'RN-20: com a auditoria falhando, a exclusão de Rita falha');
SELECT is((pg_temp.mem(35)).deleted_at, NULL, 'RN-20: Rita não fica excluída');
SELECT ok((pg_temp.mem(35)).spouse_id = pg_temp.m(36) AND (pg_temp.mem(36)).spouse_id = pg_temp.m(35),
  'RN-20: o vínculo de cônjuge continua nos dois lados');
SELECT is((SELECT encrypted_password FROM auth.users WHERE id = pg_temp.u(9)), (SELECT encrypted_password FROM rita_auth),
  'RN-20: a senha de Rita não foi tocada (não fica não excluída sem acesso)');
SELECT is((SELECT banned_until FROM auth.users WHERE id = pg_temp.u(9)), NULL, 'RN-20: a conta de Rita não foi banida');
SELECT is((SELECT count(*)::int FROM auth.sessions WHERE user_id = pg_temp.u(9)), 1, 'RN-20: a sessão de Rita continua');
SELECT is((SELECT count(*)::int FROM private.member_access_suspensions WHERE member_id = pg_temp.m(35)), 0,
  'RN-20: nenhuma suspensão guardada');

ALTER TABLE public.events DROP CONSTRAINT e201_qa_audit_fails;
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(35)))), '00000',
  'RN-20: com a auditoria de volta, a exclusão de Rita passa');
SELECT ok((SELECT encrypted_password = '' AND banned_until > now() + interval '99 years' FROM auth.users WHERE id = pg_temp.u(9))
          AND (SELECT count(*) FROM auth.sessions WHERE user_id = pg_temp.u(9)) = 0
          AND (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = pg_temp.u(9)::text) = 0,
  'RN-14/RN-20: e aí sim a conta é suspensa na mesma transação (senha vazia, banida, sem sessões nem refresh tokens)');

-- ===========================================================================
-- 11. RN-06: invariante depois de toda a sequência — 2
-- ===========================================================================
SELECT is_empty($$
  SELECT m.id FROM public.members m
    JOIN public.members x ON x.id IN (m.leader_id, m.spouse_id)
   WHERE m.deleted_at IS NULL AND x.deleted_at IS NOT NULL$$,
  'RN-06: nenhum membro não excluído tem líder ou cônjuge excluído');
SELECT is_empty($$
  SELECT c.id FROM public.cells c
    JOIN public.members x ON x.id IN (c.leader_id, c.timothy_id, c.host_id)
   WHERE c.deleted_at IS NULL AND x.deleted_at IS NOT NULL$$,
  'RN-06: nenhuma célula não excluída tem líder, timóteo ou anfitrião excluído');

SELECT * FROM finish();
ROLLBACK;
