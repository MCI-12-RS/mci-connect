-- E2.01 (PR 1): paridade do E1.08 com excluídos na massa, views de excluídos
-- com o mesmo escopo, dashboard e árvore sem excluídos.
-- Spec: docs/specs/e2-01-exclusao-logica.md (repositório apps-mci), RN-08,
-- RN-11, RN-14, RN-15, DT-04 a DT-06, risco 2, critério de pronto 3.
--
-- Cobre:
--   - paridade (risco 2, critério 3): para 9 personas (P1 view_members; P2
--     view_all_church; P3 view_own_ministry; P3 + view_own_reports; só
--     view_own_reports; só view_all_reports; P5 sem permissão de leitura;
--     usuário do Auth sem cadastro; pastor com view_own_ministry), os ids de
--     members_view, cells_view, cell_reports_view e
--     cell_report_participants_view são iguais aos das tabelas sob RLS, com
--     membros, células, relatórios e participantes excluídos na massa; e
--     nenhum excluído aparece;
--   - view_own_ministry com relatório de célula excluída (DT-05);
--   - views de excluídos com o mesmo escopo (RN-15, DT-06): para 6
--     administradores (manage_roles + cada escopo), os ids de cada view de
--     excluídos são exatamente os excluídos que a view principal mostraria se
--     eles não estivessem excluídos; sem manage_roles, vazias;
--   - o membro excluído não lê nada (RN-14);
--   - RN-08: os números do critério (98, 19, 89, 9 e as evangelísticas) para
--     quem vê o ministério e por diferença para quem vê a igreja toda; Sara fora
--     de "novos membros"; excluído não conta como inativo;
--   - dashboard, ranking e árvore de Ministérios sem excluídos, conferidos
--     contra as tabelas sob RLS;
--   - RN-06: invariante no fim.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Os números absolutos usam uma persona cujo escopo é só a massa deste
-- arquivo; as que veem a igreja toda são conferidas por paridade e diferença.
-- As listas de excluídos são comparadas só nos ids da massa: a base pode ter
-- excluídos de fora (a própria massa cria alguns, com ids f2010500…, para
-- provar isso), e o escopo deles não é deste arquivo.
-- Rodar com: supabase test db

BEGIN;

-- E2.11 PR 2 (DA-11): as massas gravam relatórios e participantes direto (inclusive de semanas
-- passadas); fora das RPCs, só com a marca de manutenção.
SET LOCAL mci.cell_report_write = 'on';

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(126);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2010500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b2010500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2010500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2010500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2010500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.ws(_weeks_ago int DEFAULT 0) RETURNS date LANGUAGE sql STABLE AS
$$ SELECT public.week_start(public.sp_today()) - 7 * _weeks_ago $$;

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
-- Chaves (texto) devolvidas por _sql (uma coluna), ordenadas, como o usuário _n.
CREATE FUNCTION pg_temp.ids(_n int, _sql text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v text;
BEGIN
  _v := pg_temp.val(_n, format('SELECT coalesce(array_agg(k ORDER BY k), ''{}'')::text FROM (%s) t(k)', _sql));
  IF _v LIKE 'ERR %' THEN RETURN ARRAY[_v]; END IF;
  RETURN _v::text[];
END $$;
CREATE FUNCTION pg_temp.code(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _r ->> 'state' = '22023' AND _r ->> 'hint' = 'app_error'
              THEN _r -> 'detail' ->> 'code' ELSE _r ->> 'state' END
$$;

-- Ids excluídos desta massa, por tabela.
CREATE FUNCTION pg_temp.deleted(_table text) RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE _out text[];
BEGIN
  EXECUTE format('SELECT coalesce(array_agg(id::text ORDER BY id::text), ''{}'') FROM public.%I
                   WHERE deleted_at IS NOT NULL AND id::text LIKE ''%s2010500%%''',
                 _table, CASE _table WHEN 'members' THEN 'c' WHEN 'cells' THEN 'd' ELSE 'e' END)
    INTO _out;
  RETURN _out;
END $$;

-- Verdade para as views de excluídos (RN-15): os excluídos que a view principal
-- _view mostraria ao usuário _n se não estivessem excluídos. Desmarca tudo
-- num subbloco (replica, sem triggers), consulta como _n e desfaz.
CREATE FUNCTION pg_temp.scope_if_undeleted(_n int, _view text, _table text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  _deleted text[] := pg_temp.deleted(_table);
  _out text[];
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL session_replication_role = replica';
    UPDATE public.members SET deleted_at = NULL, deleted_by = NULL, deleted_by_kind = NULL, deleted_by_legacy = NULL
     WHERE deleted_at IS NOT NULL AND id::text LIKE 'c2010500%';
    UPDATE public.cells SET deleted_at = NULL, deleted_by = NULL, deleted_by_kind = NULL, deleted_by_legacy = NULL
     WHERE deleted_at IS NOT NULL AND id::text LIKE 'd2010500%';
    UPDATE public.cell_reports SET deleted_at = NULL, deleted_by = NULL, deleted_by_kind = NULL, deleted_by_legacy = NULL
     WHERE deleted_at IS NOT NULL AND id::text LIKE 'e2010500%';
    EXECUTE 'SET LOCAL session_replication_role = origin';
    _out := pg_temp.ids(_n, format('SELECT id::text FROM %s WHERE id::text = ANY (%L::text[])', _view, _deleted));
    RAISE EXCEPTION 'e201_qa_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'e201_qa_rollback' THEN RAISE; END IF;
  END;
  RETURN _out;
END $$;

-- Paridade view × tabela sob RLS (4 tabelas) e nenhum excluído na view.
CREATE FUNCTION pg_temp.parity(_n int, _who text) RETURNS SETOF text LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEXT is(pg_temp.ids(_n, 'SELECT id::text FROM public.members_view'),
                 pg_temp.ids(_n, 'SELECT id::text FROM public.members'),
                 _who || ': members_view = members sob RLS, com excluídos na massa');
  RETURN NEXT is(pg_temp.ids(_n, 'SELECT id::text FROM public.cells_view'),
                 pg_temp.ids(_n, 'SELECT id::text FROM public.cells'),
                 _who || ': cells_view = cells sob RLS');
  RETURN NEXT is(pg_temp.ids(_n, 'SELECT id::text FROM public.cell_reports_view'),
                 pg_temp.ids(_n, 'SELECT id::text FROM public.cell_reports'),
                 _who || ': cell_reports_view = cell_reports sob RLS');
  RETURN NEXT is(pg_temp.ids(_n, 'SELECT report_id::text || '':'' || member_id::text FROM public.cell_report_participants_view'),
                 pg_temp.ids(_n, 'SELECT report_id::text || '':'' || member_id::text FROM public.cell_report_participants'),
                 _who || ': cell_report_participants_view = participantes sob RLS');
  RETURN NEXT is(
    pg_temp.ids(_n, format($q$SELECT id::text FROM public.members_view WHERE id::text = ANY (%L::text[])
                   UNION ALL SELECT id::text FROM public.cells_view WHERE id::text = ANY (%L::text[])
                   UNION ALL SELECT id::text FROM public.cell_reports_view WHERE id::text = ANY (%L::text[])
                   UNION ALL SELECT report_id::text FROM public.cell_report_participants_view WHERE report_id::text = ANY (%L::text[])$q$,
                   pg_temp.deleted('members'), pg_temp.deleted('cells'), pg_temp.deleted('cell_reports'),
                   pg_temp.deleted('cell_reports'))),
    '{}'::text[], _who || ': nenhum membro, célula ou relatório excluído (nem participante de relatório excluído) aparece');
END $$;

-- Views de excluídos com o mesmo escopo das principais (RN-15). Do lado da
-- view, só os ids da massa (excluídos ou não): um registro não excluído da
-- massa que aparecesse na lista ainda falha, e os excluídos de fora da massa
-- (outros testes, outra massa na mesma base) não entram na conta.
CREATE FUNCTION pg_temp.deleted_scope(_n int, _who text) RETURNS SETOF text LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEXT is(pg_temp.ids(_n, 'SELECT id::text FROM public.members_deleted_view WHERE id::text LIKE ''c2010500%'''),
                 pg_temp.scope_if_undeleted(_n, 'public.members_view', 'members'),
                 _who || ': members_deleted_view = excluídos que a members_view mostraria');
  RETURN NEXT is(pg_temp.ids(_n, 'SELECT id::text FROM public.cells_deleted_view WHERE id::text LIKE ''d2010500%'''),
                 pg_temp.scope_if_undeleted(_n, 'public.cells_view', 'cells'),
                 _who || ': cells_deleted_view = excluídas que a cells_view mostraria');
  RETURN NEXT is(pg_temp.ids(_n, 'SELECT id::text FROM public.cell_reports_deleted_view WHERE id::text LIKE ''e2010500%'''),
                 pg_temp.scope_if_undeleted(_n, 'public.cell_reports_view', 'cell_reports'),
                 _who || ': cell_reports_deleted_view = excluídos que a cell_reports_view mostraria');
END $$;

-- ---------------------------------------------------------------------------
-- Massa (postgres, triggers ligados; relatórios de semanas passadas com replica)
-- ---------------------------------------------------------------------------
INSERT INTO public.roles (id, name) VALUES
  (pg_temp.role(1),  'E201-05 P1 view_members'),      (pg_temp.role(2),  'E201-05 P2 view_all_church'),
  (pg_temp.role(3),  'E201-05 P3 view_own_ministry'), (pg_temp.role(4),  'E201-05 P4 view_own_reports'),
  (pg_temp.role(5),  'E201-05 P3b ministério + relatórios'), (pg_temp.role(6), 'E201-05 P4b view_all_reports'),
  (pg_temp.role(7),  'E201-05 P5 básico'),            (pg_temp.role(9),  'E201-05 pastor ministério'),
  (pg_temp.role(11), 'E201-05 AD P1'), (pg_temp.role(12), 'E201-05 AD P2'), (pg_temp.role(13), 'E201-05 AD P3'),
  (pg_temp.role(14), 'E201-05 AD P4b'), (pg_temp.role(15), 'E201-05 AD P5'), (pg_temp.role(16), 'E201-05 AD P4'),
  (pg_temp.role(20), 'E201-05 P3 do ministério V'), (pg_temp.role(30), 'E201-05 AD global');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(1), 'view_all_church'), (pg_temp.role(1), 'view_dashboard'),
  (pg_temp.role(2), 'view_all_church'), (pg_temp.role(2), 'view_dashboard'),
  (pg_temp.role(3), 'view_own_ministry'), (pg_temp.role(3), 'view_dashboard'),
  (pg_temp.role(4), 'view_own_reports'),
  (pg_temp.role(5), 'view_own_ministry'), (pg_temp.role(5), 'view_own_reports'),
  (pg_temp.role(6), 'view_all_reports'),
  (pg_temp.role(7), 'view_dashboard'),
  (pg_temp.role(9), 'view_own_ministry'),
  (pg_temp.role(11), 'manage_roles'), (pg_temp.role(11), 'view_all_church'),
  (pg_temp.role(12), 'manage_roles'), (pg_temp.role(12), 'view_all_church'),
  (pg_temp.role(13), 'manage_roles'), (pg_temp.role(13), 'view_own_ministry'),
  (pg_temp.role(14), 'manage_roles'), (pg_temp.role(14), 'view_all_reports'),
  (pg_temp.role(15), 'manage_roles'),
  (pg_temp.role(16), 'manage_roles'), (pg_temp.role(16), 'view_own_reports'),
  (pg_temp.role(20), 'view_own_ministry'), (pg_temp.role(20), 'view_dashboard');
INSERT INTO public.role_permissions (role_id, permission)
SELECT pg_temp.role(30), p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e201-05-' || n || '@teste.invalid'
  FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 20, 30]) n;
-- 8 = usuário do Auth sem cadastro de membro; 17 = Xênia (será excluída)

-- Árvore (como no E1.08):
--   Pastores Paulo (01, persona pastor) e Priscila (02, P1), casados.
--   Ministério A: André (03) & Ana (04). André → Antônio (06) → Arthur (08, P3),
--     Arnaldo (23, AD-P3), Aldo (16, excluído); André → Alberto (07, P4),
--     Débora (19, inativa, excluída), Xênia (27, excluída); Ana → Amanda (09,
--     P3b), João (14), Alice (26, AD-P4).
--   Ministério B: Bruno (05, P2) → Bento (10, P5) → Bia (13, inativa), Beto
--     (25, AD-P5); Bruno → Breno (11, P4b) → Bernardo (17, excluído); Bruno →
--     Hélio (15).
--   Xavier (12) e Xuxa (18, excluída): sem líder e sem ser pastor.
--   Diana (21, AD-P1), Dalton (22, AD-P2), Dênis (24, AD-P4b), Gabriel (30, AD
--     global): nível 1, abaixo de Paulo.
--   Ministério V: Vânia (100) → 99 membros (101 a 199; 190 a 199 inativos),
--     Vítor (101) é a P3 do ministério V.
-- E2.04 (DT-23): todo cadastro novo tem um identificador real (RN-08).
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '5192015' || lpad(_n::text, 4, '0') $$;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(1), 'Paulo Pastor E201-05',    'M', true, false, pg_temp.u(9), pg_temp.role(9), pg_temp.mob(1)),
  (pg_temp.m(2), 'Priscila Pastora E201-05', 'F', true, false, pg_temp.u(1), pg_temp.role(1), pg_temp.mob(2));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(3),   'André Gonçalves', 'M', pg_temp.m(1), true, true, NULL,          NULL, pg_temp.mob(3)),
  (pg_temp.m(4),   'Ana Gonçalves',   'F', pg_temp.m(2), true, true, NULL,          NULL, pg_temp.mob(4)),
  (pg_temp.m(5),   'Bruno Brandão',   'M', pg_temp.m(1), true, true, pg_temp.u(2),  pg_temp.role(2), pg_temp.mob(5)),
  (pg_temp.m(21),  'Diana Dutra',     'F', pg_temp.m(1), true, true, pg_temp.u(11), pg_temp.role(11), pg_temp.mob(21)),
  (pg_temp.m(22),  'Dalton Dias',     'M', pg_temp.m(1), true, true, pg_temp.u(12), pg_temp.role(12), pg_temp.mob(22)),
  (pg_temp.m(24),  'Dênis Duque',     'M', pg_temp.m(1), true, true, pg_temp.u(14), pg_temp.role(14), pg_temp.mob(24)),
  (pg_temp.m(30),  'Gabriel Guerra',  'M', pg_temp.m(1), true, true, pg_temp.u(30), pg_temp.role(30), pg_temp.mob(30)),
  (pg_temp.m(100), 'Vânia Vidal',     'F', pg_temp.m(1), true, true, NULL,          NULL, pg_temp.mob(100));
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(6),  'Antônio Araújo', 'M', pg_temp.m(3),  true, true,  NULL,          NULL, pg_temp.mob(6)),
  (pg_temp.m(7),  'Alberto Alves',  'M', pg_temp.m(3),  true, true,  pg_temp.u(4),  pg_temp.role(4), pg_temp.mob(7)),
  (pg_temp.m(19), 'Débora Dantas',  'F', pg_temp.m(3),  true, false, NULL,          NULL, pg_temp.mob(19)),
  (pg_temp.m(27), 'Xênia Xavier',   'F', pg_temp.m(3),  true, true,  pg_temp.u(17), pg_temp.role(1), pg_temp.mob(27)),
  (pg_temp.m(9),  'Amanda Azevedo', 'F', pg_temp.m(4),  true, true,  pg_temp.u(5),  pg_temp.role(5), pg_temp.mob(9)),
  (pg_temp.m(14), 'João da Silva',  'M', pg_temp.m(4),  true, true,  NULL,          NULL, pg_temp.mob(14)),
  (pg_temp.m(26), 'Alice Amaral',   'F', pg_temp.m(4),  true, true,  pg_temp.u(16), pg_temp.role(16), pg_temp.mob(26)),
  (pg_temp.m(10), 'Bento Barros',   'M', pg_temp.m(5),  true, true,  pg_temp.u(7),  pg_temp.role(7), pg_temp.mob(10)),
  (pg_temp.m(11), 'Breno Batista',  'M', pg_temp.m(5),  true, true,  pg_temp.u(6),  pg_temp.role(6), pg_temp.mob(11)),
  (pg_temp.m(15), 'Hélio Hospedeiro', 'M', pg_temp.m(5), true, true, NULL,          NULL, pg_temp.mob(15));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(8),  'Arthur Assis',    'M', pg_temp.m(6),  true, true,  pg_temp.u(3),  pg_temp.role(3), pg_temp.mob(8)),
  (pg_temp.m(23), 'Arnaldo Arruda',  'M', pg_temp.m(6),  true, true,  pg_temp.u(13), pg_temp.role(13), pg_temp.mob(23)),
  (pg_temp.m(16), 'Aldo Abreu',      'M', pg_temp.m(6),  true, true,  NULL,          NULL, pg_temp.mob(16)),
  (pg_temp.m(13), 'Bia Bastos',      'F', pg_temp.m(10), true, false, NULL,          NULL, pg_temp.mob(13)),
  (pg_temp.m(25), 'Beto Borges',     'M', pg_temp.m(10), true, true,  pg_temp.u(15), pg_temp.role(15), pg_temp.mob(25)),
  (pg_temp.m(17), 'Bernardo Bueno',  'M', pg_temp.m(11), true, true,  NULL,          NULL, pg_temp.mob(17));
INSERT INTO public.members (id, name, gender, has_leadership, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(12), 'Xavier Xisto', 'M', false, true, pg_temp.mob(12)),
  (pg_temp.m(18), 'Xuxa Xerxes',  'F', false, true, pg_temp.mob(18));
-- Ministério V: 100 membros (Vânia + 99), 90 ativos e 10 inativos.
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, mobile_whatsapp)
SELECT pg_temp.m(n), 'Membro V ' || n, CASE WHEN n % 2 = 0 THEN 'F' ELSE 'M' END, pg_temp.m(100), true,
       n < 190, CASE WHEN n = 101 THEN pg_temp.u(20) END, CASE WHEN n = 101 THEN pg_temp.role(20) END, pg_temp.mob(n)
  FROM generate_series(101, 199) n;

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  (pg_temp.c(1),  pg_temp.m(6), pg_temp.m(8), pg_temp.m(15), 'Evangelística', 'Segunda', '20:00'),
  (pg_temp.c(2),  pg_temp.m(10), pg_temp.m(11), pg_temp.m(7), 'Discipulado',   'Terça',   '19:30'),
  (pg_temp.c(3),  pg_temp.m(7), pg_temp.m(7), pg_temp.m(7), 'Evangelística', 'Quarta',  '20:00'),
  (pg_temp.c(4),  pg_temp.m(11), pg_temp.m(9), pg_temp.m(13), 'Macrocélula',   'Sábado',  '16:00'),
  (pg_temp.c(5),  pg_temp.m(12), pg_temp.m(12), pg_temp.m(12), 'Evangelística', 'Domingo', '18:00'),
  (pg_temp.c(6),  pg_temp.m(1), pg_temp.m(1), pg_temp.m(4), 'Discipulado',   'Sexta',   '20:00'),
  (pg_temp.c(7),  pg_temp.m(14), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Quarta',  '19:00'),
  (pg_temp.c(8),  pg_temp.m(25), pg_temp.m(25), pg_temp.m(25), 'Evangelística', 'Quinta',  '20:00'),
  (pg_temp.c(9),  pg_temp.m(15), pg_temp.m(15), pg_temp.m(7), 'Discipulado',   'Quinta',  '20:00'),
  (pg_temp.c(10), pg_temp.m(6), pg_temp.m(6), pg_temp.m(6), 'Discipulado',   'Domingo', '09:00');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
SELECT pg_temp.c(n), pg_temp.m(n + 1), pg_temp.m(n + 1), pg_temp.m(n + 1),
       CASE WHEN n < 112 THEN 'Evangelística' WHEN n < 117 THEN 'Discipulado' ELSE 'Macrocélula' END,
       'Quarta', '20:00'
  FROM generate_series(100, 119) n;

-- Relatórios desta semana (ministério V) com os triggers ligados.
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, visitors, was_held) VALUES
  (pg_temp.r(101), pg_temp.c(101), pg_temp.ws(), '20:00', 'V semana', ARRAY['Visitante 1', 'Visitante 2'], true),
  (pg_temp.r(102), pg_temp.c(102), pg_temp.ws(), '20:00', 'V semana excluído', ARRAY['Visitante 3'], true);
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held) VALUES
  (pg_temp.r(1),  pg_temp.c(1),  pg_temp.ws(1) + 1, '20:00', 'A1', true),
  (pg_temp.r(2),  pg_temp.c(1),  pg_temp.ws(2) + 1, '20:00', 'A1 excluído', true),
  (pg_temp.r(3),  pg_temp.c(2),  pg_temp.ws(1) + 2, '19:30', 'B2', true),
  (pg_temp.r(4),  pg_temp.c(2),  pg_temp.ws(2) + 2, '19:30', 'B2 excluído', true),
  (pg_temp.r(5),  pg_temp.c(7),  pg_temp.ws(1) + 3, '19:00', 'Célula excluída A', true),
  (pg_temp.r(6),  pg_temp.c(7),  pg_temp.ws(2) + 3, '19:00', 'Célula excluída A, relatório excluído', true),
  (pg_temp.r(7),  pg_temp.c(8),  pg_temp.ws(1) + 4, '20:00', 'Beto excluído', true),
  (pg_temp.r(8),  pg_temp.c(8),  pg_temp.ws(2) + 4, '20:00', 'Beto', true),
  (pg_temp.r(9),  pg_temp.c(4),  pg_temp.ws(1) + 6, '16:00', 'B4', true),
  (pg_temp.r(10), pg_temp.c(5),  pg_temp.ws(1),     '18:00', 'X5', true),
  (pg_temp.r(11), pg_temp.c(6),  pg_temp.ws(1) + 5, '20:00', 'P6', true),
  (pg_temp.r(12), pg_temp.c(3),  pg_temp.ws(1) + 3, '20:00', 'A3', true),
  (pg_temp.r(13), pg_temp.c(9),  pg_temp.ws(1) + 4, '20:00', 'Hélio, célula excluída', true),
  (pg_temp.r(14), pg_temp.c(10), pg_temp.ws(1),     '09:00', 'A10 excluído', true);
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
  (pg_temp.r(1), pg_temp.m(6)), (pg_temp.r(1), pg_temp.m(8)), (pg_temp.r(1), pg_temp.m(16)), (pg_temp.r(1), pg_temp.m(15)),
  (pg_temp.r(2), pg_temp.m(8)),
  (pg_temp.r(3), pg_temp.m(10)), (pg_temp.r(3), pg_temp.m(11)), (pg_temp.r(3), pg_temp.m(7)), (pg_temp.r(3), pg_temp.m(17)),
  (pg_temp.r(4), pg_temp.m(10)),
  (pg_temp.r(5), pg_temp.m(14)), (pg_temp.r(5), pg_temp.m(9)),
  (pg_temp.r(6), pg_temp.m(14)),
  (pg_temp.r(7), pg_temp.m(25)), (pg_temp.r(8), pg_temp.m(25)),
  (pg_temp.r(9), pg_temp.m(13)), (pg_temp.r(9), pg_temp.m(9)),
  (pg_temp.r(10), pg_temp.m(12)), (pg_temp.r(10), pg_temp.m(18)),
  (pg_temp.r(11), pg_temp.m(1)), (pg_temp.r(11), pg_temp.m(4)),
  (pg_temp.r(12), pg_temp.m(7)), (pg_temp.r(12), pg_temp.m(19)),
  (pg_temp.r(13), pg_temp.m(15)), (pg_temp.r(14), pg_temp.m(6));
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- Exclusões pela API (AD global): relatórios, células e depois membros.
CREATE TEMP TABLE del_log AS
SELECT x.what, pg_temp.code(pg_temp.try(30, x.sql)) AS code
  FROM (VALUES
    ('r2',  format('SELECT public.delete_cell_report(%L)', pg_temp.r(2))),
    ('r4',  format('SELECT public.delete_cell_report(%L)', pg_temp.r(4))),
    ('r6',  format('SELECT public.delete_cell_report(%L)', pg_temp.r(6))),
    ('r7',  format('SELECT public.delete_cell_report(%L)', pg_temp.r(7))),
    ('r14', format('SELECT public.delete_cell_report(%L)', pg_temp.r(14))),
    ('r102', format('SELECT public.delete_cell_report(%L)', pg_temp.r(102))),
    ('c7',  format('SELECT public.delete_cell(%L)', pg_temp.c(7))),
    ('c8',  format('SELECT public.delete_cell(%L)', pg_temp.c(8))),
    ('c9',  format('SELECT public.delete_cell(%L)', pg_temp.c(9))),
    ('m16', format('SELECT public.delete_member(%L)', pg_temp.m(16))),
    ('m17', format('SELECT public.delete_member(%L)', pg_temp.m(17))),
    ('m18', format('SELECT public.delete_member(%L)', pg_temp.m(18))),
    ('m19', format('SELECT public.delete_member(%L)', pg_temp.m(19))),
    ('m27', format('SELECT public.delete_member(%L)', pg_temp.m(27)))
  ) AS x(what, sql);

-- Excluídos de fora da massa (ids f2010500…), pela API e na mesma transação:
-- dois membros, duas células e um relatório excluídos, mais um relatório (não
-- excluído) de célula excluída. Simulam uma base que já tem excluídos; as
-- exclusões seguem a ordem do ORDER BY (relatório, células, membros).
INSERT INTO public.members (id, name, gender, has_leadership, is_active, mobile_whatsapp) VALUES
  ('f2010500-0000-0000-0000-000000000001', 'Alheio Excluído E201-05', 'M', false, true, pg_temp.mob(901)),
  ('f2010500-0000-0000-0000-000000000002', 'Alheia Líder E201-05',    'F', false, true, pg_temp.mob(902));
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  ('f2010500-0000-0000-0000-000000000011', 'f2010500-0000-0000-0000-000000000002', 'f2010500-0000-0000-0000-000000000002',
   'f2010500-0000-0000-0000-000000000002', 'Evangelística', 'Domingo', '00:00'),
  ('f2010500-0000-0000-0000-000000000012', 'f2010500-0000-0000-0000-000000000002', 'f2010500-0000-0000-0000-000000000002',
   'f2010500-0000-0000-0000-000000000002', 'Discipulado', 'Domingo', '00:00');
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held) VALUES
  ('f2010500-0000-0000-0000-000000000021', 'f2010500-0000-0000-0000-000000000011', pg_temp.ws(), '00:00', 'Alheio excluído', true),
  ('f2010500-0000-0000-0000-000000000022', 'f2010500-0000-0000-0000-000000000012', pg_temp.ws(), '00:00', 'Alheio de célula excluída', true);
INSERT INTO pg_temp.del_log
SELECT x.what, pg_temp.code(pg_temp.try(30, x.sql))
  FROM (VALUES
    (1, 'alheio r21', $q$SELECT public.delete_cell_report('f2010500-0000-0000-0000-000000000021')$q$),
    (2, 'alheio c11', $q$SELECT public.delete_cell('f2010500-0000-0000-0000-000000000011')$q$),
    (3, 'alheio c12', $q$SELECT public.delete_cell('f2010500-0000-0000-0000-000000000012')$q$),
    (4, 'alheio m1',  $q$SELECT public.delete_member('f2010500-0000-0000-0000-000000000001')$q$),
    (5, 'alheio m2',  $q$SELECT public.delete_member('f2010500-0000-0000-0000-000000000002')$q$)
  ) AS x(ord, what, sql) ORDER BY x.ord;

-- ===========================================================================
-- 0. Preparação conferida — 3
-- ===========================================================================
SELECT is((SELECT string_agg(what || '=' || code, ',' ORDER BY what) FROM del_log WHERE code <> '00000'), NULL,
  'massa: todas as exclusões da preparação foram aceitas pela API');
SELECT is(pg_temp.ids(11, $q$SELECT id::text FROM public.members_deleted_view WHERE id::text LIKE 'f2010500%'
                       UNION ALL SELECT id::text FROM public.cells_deleted_view WHERE id::text LIKE 'f2010500%'
                       UNION ALL SELECT id::text FROM public.cell_reports_deleted_view WHERE id::text LIKE 'f2010500%'$q$),
  ARRAY['f2010500-0000-0000-0000-000000000001', 'f2010500-0000-0000-0000-000000000002',
        'f2010500-0000-0000-0000-000000000011', 'f2010500-0000-0000-0000-000000000012',
        'f2010500-0000-0000-0000-000000000021'],
  'massa: os excluídos de fora da massa aparecem nas listas de excluídos do AD + view_members');
SELECT is(pg_temp.val(11, $q$SELECT count(*) FROM public.cell_reports_view WHERE id = 'f2010500-0000-0000-0000-000000000022' AND cell_deleted$q$), '1',
  'massa: e o relatório de fora da massa, de célula excluída, continua na cell_reports_view');

-- ===========================================================================
-- 1. Paridade do E1.08 com excluídos na massa (9 personas × 5) — 45
-- ===========================================================================
SELECT * FROM pg_temp.parity(1, 'P1 view_members');
SELECT * FROM pg_temp.parity(2, 'P2 view_all_church');
SELECT * FROM pg_temp.parity(3, 'P3 view_own_ministry');
SELECT * FROM pg_temp.parity(5, 'P3 view_own_ministry + view_own_reports');
SELECT * FROM pg_temp.parity(4, 'P4 só view_own_reports');
SELECT * FROM pg_temp.parity(6, 'P4 só view_all_reports');
SELECT * FROM pg_temp.parity(7, 'P5 sem permissão de leitura');
SELECT * FROM pg_temp.parity(8, 'usuário do Auth sem cadastro');
SELECT * FROM pg_temp.parity(9, 'pastor com view_own_ministry');

-- ===========================================================================
-- 2. view_own_ministry com relatório de célula excluída (DT-05) — 6
-- ===========================================================================
SELECT is(pg_temp.ids(3, format('SELECT id::text FROM public.cell_reports_view WHERE cell_id = %L', pg_temp.c(7))),
  ARRAY[pg_temp.r(5)::text], 'DT-05: P3 vê na view o relatório não excluído da célula excluída de João (o excluído, não)');
SELECT is(pg_temp.ids(3, format('SELECT id::text FROM public.cell_reports WHERE cell_id = %L', pg_temp.c(7))),
  ARRAY[pg_temp.r(5)::text], 'DT-05: e pela tabela sob RLS');
SELECT is(pg_temp.val(3, format('SELECT cell_deleted FROM public.cell_reports_view WHERE id = %L', pg_temp.r(5))), 'true',
  'RN-11: marcado com cell_deleted');
SELECT is(pg_temp.ids(3, format('SELECT member_id::text FROM public.cell_report_participants_view WHERE report_id = %L', pg_temp.r(5))),
  pg_temp.ids(3, format('SELECT member_id::text FROM public.cell_report_participants WHERE report_id = %L', pg_temp.r(5))),
  'DT-05: os participantes desse relatório batem com a tabela sob RLS');
SELECT is(pg_temp.val(3, format('SELECT count(*) FROM public.cells_view WHERE id = %L', pg_temp.c(7))), '0',
  'RN-08: a célula excluída em si não aparece para P3');
SELECT is(pg_temp.val(3, format($$SELECT member_name || '|' || member_deleted FROM public.cell_report_participants_view
                                 WHERE report_id = %L AND member_id = %L$$, pg_temp.r(1), pg_temp.m(16))),
  'Aldo Abreu|true', 'RN-09 b: P3 vê o participante excluído pelo nome, sem acesso ao cadastro');

-- ===========================================================================
-- 3. Views de excluídos com o mesmo escopo (6 administradores × 3) — 18
-- ===========================================================================
SELECT * FROM pg_temp.deleted_scope(11, 'AD + view_members');
SELECT * FROM pg_temp.deleted_scope(12, 'AD + view_all_church');
SELECT * FROM pg_temp.deleted_scope(13, 'AD + view_own_ministry');
SELECT * FROM pg_temp.deleted_scope(14, 'AD + view_all_reports');
SELECT * FROM pg_temp.deleted_scope(16, 'AD + view_own_reports');
SELECT * FROM pg_temp.deleted_scope(15, 'AD sem permissão de leitura (só as próprias células)');

-- ===========================================================================
-- 4. Conteúdo esperado das listas de excluídos — 9
-- ===========================================================================
SELECT is(pg_temp.ids(13, 'SELECT id::text FROM public.members_deleted_view'),
  (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(ARRAY[pg_temp.m(16), pg_temp.m(19), pg_temp.m(27)]) x),
  'RN-15: AD do ministério A vê Aldo, Débora e Xênia (não Bernardo, do B, nem Xuxa, sem líder)');
SELECT is(pg_temp.ids(13, 'SELECT id::text FROM public.cells_deleted_view'), ARRAY[pg_temp.c(7)::text, pg_temp.c(9)::text],
  'RN-15: e as células excluídas de João e de Hélio (anfitrião Alberto, do A), não a de Beto (só do B)');
SELECT is(pg_temp.ids(13, 'SELECT id::text FROM public.cell_reports_deleted_view'),
  (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(ARRAY[pg_temp.r(2), pg_temp.r(4), pg_temp.r(6), pg_temp.r(14)]) x),
  'RN-15: e os relatórios excluídos do ministério A (inclusive o da célula excluída e, desde o E2.02 (RN-04), o da célula 02, vista pelo anfitrião)');
SELECT is(pg_temp.ids(15, 'SELECT id::text FROM public.cells_deleted_view'), ARRAY[pg_temp.c(8)::text],
  'RN-15: AD sem leitura vê só a própria célula excluída (ramo do líder)');
SELECT is(pg_temp.ids(15, 'SELECT id::text FROM public.members_deleted_view'), '{}'::text[],
  'RN-15: e nenhum membro excluído (vê só o próprio cadastro)');
SELECT ok(cardinality(pg_temp.ids(11, $q$SELECT id::text FROM public.members_deleted_view WHERE id::text LIKE 'c2010500%'$q$)) = 5,
  'RN-15: AD + view_members vê os 5 membros excluídos da massa');
SELECT is(pg_temp.ids(3, 'SELECT id::text FROM public.members_deleted_view'), '{}'::text[],
  'RN-15: sem manage_roles (P3), members_deleted_view vazia');
SELECT is(pg_temp.ids(1, 'SELECT id::text FROM public.cells_deleted_view'), '{}'::text[],
  'RN-15: sem manage_roles (P1), cells_deleted_view vazia');
SELECT is(pg_temp.ids(6, 'SELECT id::text FROM public.cell_reports_deleted_view'), '{}'::text[],
  'RN-15: sem manage_roles (P4b), cell_reports_deleted_view vazia');

-- ===========================================================================
-- 5. O membro excluído não lê nada (RN-14, critério 3) — 8
-- ===========================================================================
SELECT is(pg_temp.val(17, format('SELECT count(*) FROM %s', v)), '0', 'RN-14: Xênia (excluída, com view_members) não lê ' || v)
  FROM unnest(ARRAY['public.members_view', 'public.cells_view', 'public.cell_reports_view',
                    'public.cell_report_participants_view', 'public.roles', 'public.role_permissions',
                    'public.members', 'public.cell_reports']) v;

-- ===========================================================================
-- 6. RN-08: os números do critério — 22
-- ===========================================================================
CREATE TEMP TABLE v0 AS SELECT
  pg_temp.val(20, 'SELECT count(*) FROM public.members_view')::int AS members,
  pg_temp.val(20, 'SELECT count(*) FROM public.cells_view')::int AS cells,
  pg_temp.val(20, 'SELECT members_active FROM public.dashboard_summary()')::int AS active,
  pg_temp.val(20, 'SELECT members_inactive FROM public.dashboard_summary()')::int AS inactive,
  pg_temp.val(20, $$SELECT total FROM public.dashboard_cells_by_type() WHERE cell_type = 'Evangelística'$$)::int AS evang;
CREATE TEMP TABLE p1_0 AS SELECT
  pg_temp.val(1, 'SELECT count(*) FROM public.members_view')::int AS members,
  pg_temp.val(1, 'SELECT count(*) FROM public.cells_view')::int AS cells,
  pg_temp.val(1, 'SELECT members_active FROM public.dashboard_summary()')::int AS active,
  pg_temp.val(1, 'SELECT members_inactive FROM public.dashboard_summary()')::int AS inactive,
  pg_temp.val(1, $$SELECT total FROM public.dashboard_cells_by_type() WHERE cell_type = 'Evangelística'$$)::int AS evang;

SELECT is((SELECT ARRAY[members, cells, active, inactive, evang] FROM v0), ARRAY[100, 20, 90, 10, 12],
  'RN-08 (antes): o ministério V tem 100 membros (90 ativos, 10 inativos) e 20 células (12 evangelísticas)');
SELECT is(pg_temp.code(pg_temp.try(30, format('SELECT public.delete_member(%L)', pg_temp.m(150)))), '00000',
  'RN-08: 1 membro ativo é excluído');
SELECT is(pg_temp.code(pg_temp.try(30, format('SELECT public.delete_member(%L)', pg_temp.m(195)))), '00000',
  'RN-08: 1 membro inativo é excluído');
SELECT is(pg_temp.code(pg_temp.try(30, format('SELECT public.delete_cell(%L)', pg_temp.c(100)))), '00000',
  'RN-08: 1 célula evangelística é excluída');
SELECT is(pg_temp.val(20, 'SELECT count(*) FROM public.members_view')::int, 98, 'RN-08: a lista de Membros mostra o total 98');
SELECT is(pg_temp.val(20, 'SELECT count(*) FROM public.cells_view')::int, 19, 'RN-08: a de Células, 19');
SELECT is(pg_temp.val(20, 'SELECT members_active FROM public.dashboard_summary()')::int, 89, 'RN-08: o card de membros ativos mostra 89');
SELECT is(pg_temp.val(20, 'SELECT members_inactive FROM public.dashboard_summary()')::int, 9,
  'RN-08: o de inativos mostra 9 (excluído não é inativo)');
SELECT is(pg_temp.val(20, 'SELECT members_total FROM public.dashboard_summary()')::int, 98, 'RN-08: o total de membros do dashboard, 98');
SELECT is(pg_temp.val(20, $$SELECT total FROM public.dashboard_cells_by_type() WHERE cell_type = 'Evangelística'$$)::int, 11,
  'RN-08: o de células evangelísticas diminui 1');
SELECT is(pg_temp.val(1, 'SELECT count(*) FROM public.members_view')::int, (SELECT members - 2 FROM p1_0),
  'RN-08: quem vê a igreja toda (P1) vê 2 membros a menos');
SELECT is(pg_temp.val(1, 'SELECT count(*) FROM public.cells_view')::int, (SELECT cells - 1 FROM p1_0), 'RN-08: P1, 1 célula a menos');
SELECT is(pg_temp.val(1, 'SELECT members_active FROM public.dashboard_summary()')::int, (SELECT active - 1 FROM p1_0),
  'RN-08: P1, ativos -1');
SELECT is(pg_temp.val(1, 'SELECT members_inactive FROM public.dashboard_summary()')::int, (SELECT inactive - 1 FROM p1_0),
  'RN-08: P1, inativos -1');
SELECT is(pg_temp.val(1, $$SELECT total FROM public.dashboard_cells_by_type() WHERE cell_type = 'Evangelística'$$)::int,
  (SELECT evang - 1 FROM p1_0), 'RN-08: P1, evangelísticas -1');
SELECT is(pg_temp.val(20, 'SELECT reports_sent FROM public.dashboard_summary()')::int, 1,
  'RN-08/RN-12: o relatório excluído da semana não conta em relatórios enviados');
SELECT is(pg_temp.val(20, 'SELECT visitors FROM public.dashboard_summary()')::int, 2, 'RN-08: nem os visitantes dele');

-- Sara: cadastrada nesta semana e depois excluída.
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp) VALUES
  (pg_temp.m(200), 'Sara Semana', 'F', pg_temp.m(100), true, pg_temp.mob(200));
CREATE TEMP TABLE new0 AS SELECT pg_temp.val(20, format('SELECT count(*) FROM public.members_view WHERE created_at >= %L',
                                                         (pg_temp.ws()::timestamp AT TIME ZONE 'America/Sao_Paulo')))::int AS n;
SELECT is(pg_temp.code(pg_temp.try(30, format('SELECT public.delete_member(%L)', pg_temp.m(200)))), '00000', 'RN-08: Sara é excluída');
SELECT is(pg_temp.val(20, format('SELECT count(*) FROM public.members_view WHERE created_at >= %L',
                                (pg_temp.ws()::timestamp AT TIME ZONE 'America/Sao_Paulo')))::int,
  (SELECT n - 1 FROM new0), 'RN-08: Sara não conta em "novos membros" da semana');
SELECT is(pg_temp.val(20, format('SELECT count(*) FROM public.members_view WHERE search_text LIKE %L',
                                '%' || public.search_normalize('Sara Semana') || '%')), '0',
  'RN-08: a busca por Sara em Membros não a encontra');
SELECT is(pg_temp.val(20, format('SELECT count(*) FROM public.member_names(ARRAY[%L, %L]::uuid[])', pg_temp.m(200), pg_temp.m(102))), '1',
  'RN-08: os seletores (member_names) não oferecem o excluído');

-- ===========================================================================
-- 7. Dashboard, ranking e árvore sem excluídos, contra as tabelas sob RLS — 16
-- ===========================================================================
SELECT is(pg_temp.val(n, 'SELECT members_total || ''/'' || members_active || ''/'' || members_inactive FROM public.dashboard_summary()'),
          pg_temp.val(n, 'SELECT count(*) || ''/'' || count(*) FILTER (WHERE is_active) || ''/'' || count(*) FILTER (WHERE NOT is_active) FROM public.members'),
          who || ': cards de membros = members sob RLS (sem excluídos)')
  FROM (VALUES (1, 'P1'), (3, 'P3'), (20, 'P3 do ministério V')) AS t(n, who);
SELECT is(pg_temp.val(n, 'SELECT members_without_leader FROM public.dashboard_summary()'),
          pg_temp.val(n, 'SELECT count(*) FROM public.members WHERE is_active AND NOT is_pastor AND leader_id IS NULL'),
          who || ': "sem liderança" = members sob RLS (Xuxa, excluída, fora)')
  FROM (VALUES (1, 'P1'), (3, 'P3')) AS t(n, who);
SELECT is(pg_temp.val(n, 'SELECT sum(total) FROM public.dashboard_cells_by_type()'),
          pg_temp.val(n, 'SELECT count(*) FROM public.cells'),
          who || ': células por tipo = cells sob RLS (sem excluídas)')
  FROM (VALUES (1, 'P1'), (3, 'P3'), (20, 'P3 do ministério V')) AS t(n, who);
SELECT is(pg_temp.val(n, format('SELECT reports_sent FROM public.dashboard_summary()')),
          pg_temp.val(n, format('SELECT count(*) FROM public.cell_reports WHERE date BETWEEN %L AND %L', pg_temp.ws(), pg_temp.ws() + 6)),
          who || ': relatórios da semana = cell_reports sob RLS (sem excluídos)')
  FROM (VALUES (1, 'P1'), (20, 'P3 do ministério V')) AS t(n, who);
SELECT is(pg_temp.ids(1, format($$SELECT k FROM public.dashboard_g12_ranking() r, unnest(string_to_array(r.couple_key, '|')) k
                                 WHERE k = ANY (%L::text[])$$, pg_temp.deleted('members'))),
  '{}'::text[], 'RN-08: nenhum excluído no ranking G12');
SELECT is(pg_temp.ids(1, format('SELECT member_id::text FROM public.ministry_tree_nodes(ARRAY[%L]::uuid[])', pg_temp.m(6))),
  pg_temp.ids(1, format('SELECT id::text FROM public.members WHERE leader_id = %L AND is_active', pg_temp.m(6))),
  'RN-08: a árvore de Ministérios abaixo de Antônio = ativos sob RLS (Aldo, excluído, fora)');
SELECT is(pg_temp.val(1, format('SELECT direct_disciples FROM public.ministry_tree_nodes(ARRAY[%L]::uuid[]) WHERE member_id = %L',
                               pg_temp.m(1), pg_temp.m(3))),
  pg_temp.val(1, format('SELECT count(*) FROM public.members WHERE leader_id IN (%L, %L) AND is_active', pg_temp.m(3), pg_temp.m(4))),
  'RN-08: o nó André & Ana conta só discípulos diretos não excluídos (Xênia fora)');
SELECT is(pg_temp.val(1, format('SELECT total_disciples FROM public.members_view WHERE id = %L', pg_temp.m(6))), '2',
  'RN-10: Antônio soma 2 discípulos (Arthur e Arnaldo; Aldo excluído fora)');

-- ===========================================================================
-- 8. RN-06: invariante no fim — 2
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
