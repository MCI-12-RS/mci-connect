-- E1.08 (PR 3): dashboard_summary, dashboard_cells_by_type e dashboard_g12_ranking.
-- Spec: docs/specs/e1-08-paginacao-servidor.md (repositório apps-mci).
--
-- Cobre:
--   - RN-08 (dashboard no banco, semana de domingo a sábado no horário de
--     Brasília), com _at fixo:
--       (a) células de segunda a sexta entram em "Células sem relatório"
--           no prazo (desde o E2.09: horário + 1 hora, só nas semanas que
--           contam, e o relatório de uma semana posterior não tira a célula);
--       (b) o ranking G12 conta cada célula da subárvore uma vez só;
--       (c) "Sem vínculo celular" com a janela de 30 dias, em qualquer célula;
--       (d) um relatório da semana, visível ou não, tira a célula das pendentes;
--   - RN-09 (acesso): sem view_dashboard e sem view_own_ministry_dashboard, 42501;
--   - RN-05 (escopo inalterado): por persona, cada número bate com a contagem
--     feita nas tabelas sob o RLS atual, com a mesma pessoa logada;
--   - RN-02 (nada é cortado): totais acima de 1000;
--   - grants e propriedades das funções.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Os números absolutos usam personas cujo escopo é só a massa deste arquivo;
-- as personas que veem a igreja toda são conferidas por paridade e por
-- diferença (antes e depois de inserir), para o teste passar também num banco
-- que já tenha dados.
-- Rodar com: npx supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(209);

-- ---------------------------------------------------------------------------
-- Ids fixos da massa: a(uth), b (roles), c (membros), d (células), e (relatórios).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a1083000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b1083000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c1083000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d1083000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e1083000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

CREATE FUNCTION pg_temp.ms(VARIADIC _n int[]) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(array_agg(pg_temp.m(x)), '{}') FROM unnest(_n) x $$;

-- Chave de casal do ranking: "<menor id>|<maior id>".
CREATE FUNCTION pg_temp.couple(_a int, _b int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT least(pg_temp.m(_a), pg_temp.m(_b))::text || '|' || greatest(pg_temp.m(_a), pg_temp.m(_b))::text $$;

-- Entra como o usuário do Auth número _n (a role é trocada fora, com SET LOCAL ROLE).
CREATE FUNCTION pg_temp.login(_n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
$$;

-- "Células sem relatório" de quem está logado, num instante de Brasília.
CREATE FUNCTION pg_temp.pending(_at timestamptz) RETURNS bigint LANGUAGE sql AS
$$ SELECT cells_pending FROM public.dashboard_summary(_at) $$;

-- Células ativas lideradas por alguém das subárvores dos membros informados
-- (contagem independente, direto nas tabelas, como postgres).
CREATE FUNCTION pg_temp.subtree_active_cells(VARIADIC _roots uuid[]) RETURNS bigint LANGUAGE sql AS $$
  WITH RECURSIVE tree AS (
    SELECT m.id FROM public.members m WHERE m.id = ANY(_roots)
    UNION
    SELECT c.id FROM public.members c JOIN tree t ON c.leader_id = t.id
  )
  SELECT count(*) FROM public.cells c WHERE c.is_active AND c.leader_id IN (SELECT id FROM tree)
$$;

-- ---------------------------------------------------------------------------
-- Massa. Membros e relatórios com os triggers desligados (níveis e cônjuges
-- explícitos; datas fora da semana atual). As células entram com os triggers
-- ligados, para que male_cells e female_cells venham do trigger real de
-- estatísticas (refresh_member_stats_v2), e não de valores escritos à mão.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e108pr3-' || n || '@teste.local' FROM generate_series(1, 10) n;
-- 1 P1, 2 P2, 3 P3, 4 P4, 5 P5, 6 só view_own_ministry_dashboard,
-- 7 view_members sem dashboard, 8 sem cadastro de membro, 9 membro sem função,
-- 10 P3 com view_own_ministry_dashboard

INSERT INTO public.roles (id, name, is_system) VALUES
  (pg_temp.role(1),  'Teste E108 PR3 P1 sistema',              false),
  (pg_temp.role(2),  'Teste E108 PR3 P2 igreja toda',          false),
  (pg_temp.role(3),  'Teste E108 PR3 P3 ministério',           false),
  (pg_temp.role(4),  'Teste E108 PR3 P4 relatórios',           false),
  (pg_temp.role(5),  'Teste E108 PR3 P5 básico',               false),
  (pg_temp.role(6),  'Teste E108 PR3 só dashboard ministério', false),
  (pg_temp.role(7),  'Teste E108 PR3 membros sem dashboard',   false),
  (pg_temp.role(10), 'Teste E108 PR3 P3 dashboard ministério', false);
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(1),  'view_all_church'),
  (pg_temp.role(1),  'view_dashboard'),
  (pg_temp.role(2),  'view_all_church'),
  (pg_temp.role(2),  'view_dashboard'),
  (pg_temp.role(3),  'view_own_ministry'),
  (pg_temp.role(3),  'view_dashboard'),
  (pg_temp.role(4),  'view_all_reports'),
  (pg_temp.role(4),  'view_dashboard'),
  (pg_temp.role(5),  'view_dashboard'),
  (pg_temp.role(6),  'view_dashboard'),
  (pg_temp.role(7),  'view_all_church'),
  (pg_temp.role(10), 'view_own_ministry'),
  (pg_temp.role(10), 'view_dashboard');

-- Árvore (nível entre parênteses):
--   Pastores Paulo (01) e Priscila (02), casados.
--   Ministério A (casal André 03 & Ana 04): Arthur, Tito, Paulo Trinta, Pedro e
--     Igor (inativo) abaixo de André; Lia, Hana, Iara e Nina abaixo de Ana.
--   Ministério B: Bruno (14, sem cônjuge) → Breno (15).
--   Ranking: Rui & Rita (16, 17) → Renan (18) → Raquel (20); Rita → Rosa (19).
--     Eduardo & Lea (21, 22) → Rafael (23). Carla (24, nível 1) casada com
--     Davi (25, nível 3, abaixo de Fábio 26 → Gil 27). Eva (28) sem cônjuge.
--     Hugo (29) com a cônjuge Helena (30) inativa. Carlos & Clara (31, 32).
--     Júlia & Joana (33, 34), duas mulheres de nível 1.
INSERT INTO public.members
  (id, name, gender, is_pastor, leader_id, has_leadership, spouse_id, is_active, is_baptized, auth_user_id, role_id)
VALUES
  (pg_temp.m(1),  'Paulo Pastor',        'M', true, NULL, false,          pg_temp.m(2),  true,  true,  NULL,          NULL),
  (pg_temp.m(2),  'Priscila Pastora',    'F', true, NULL, false,          pg_temp.m(1),  true,  true,  pg_temp.u(1),  pg_temp.role(1)),
  (pg_temp.m(3),  'André Alencar',       'M', false, pg_temp.m(1), true,  pg_temp.m(4),  true,  true,  NULL,          NULL),
  (pg_temp.m(4),  'Ana Alencar',         'F', false, pg_temp.m(2), true,  pg_temp.m(3),  true,  true,  NULL,          NULL),
  (pg_temp.m(5),  'Arthur Assis',        'M', false, pg_temp.m(3), true,  NULL,          true,  true,  pg_temp.u(3),  pg_temp.role(3)),
  (pg_temp.m(6),  'Lia Lima',            'F', false, pg_temp.m(4), true,  NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(7),  'Tito Teixeira',       'M', false, pg_temp.m(3), true,  NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(8),  'Hana Hora',           'F', false, pg_temp.m(4), true,  NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(9),  'Paulo Trinta',        'M', false, pg_temp.m(3), true,  NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(10), 'Pedro Trinta e Um',   'M', false, pg_temp.m(3), true,  NULL,          true,  false, NULL,          NULL),
  (pg_temp.m(11), 'Iara Ivo',            'F', false, pg_temp.m(4), true,  NULL,          true,  false, NULL,          NULL),
  (pg_temp.m(12), 'Nina Nunes',          'F', false, pg_temp.m(4), true,  NULL,          true,  false, pg_temp.u(10), pg_temp.role(10)),
  (pg_temp.m(13), 'Igor Inácio',         'M', false, pg_temp.m(3), true,  NULL,          false, true,  NULL,          NULL),
  (pg_temp.m(14), 'Bruno Barros',        'M', false, pg_temp.m(1), true,  NULL,          true,  true,  pg_temp.u(2),  pg_temp.role(2)),
  (pg_temp.m(15), 'Breno Batista',       'M', false, pg_temp.m(14), true, NULL,          true,  true,  pg_temp.u(4),  pg_temp.role(4)),
  (pg_temp.m(16), 'Rui Ramos',           'M', false, pg_temp.m(1), true,  pg_temp.m(17), true,  true,  NULL,          NULL),
  (pg_temp.m(17), 'Rita Ramos',          'F', false, pg_temp.m(2), true,  pg_temp.m(16), true,  true,  NULL,          NULL),
  (pg_temp.m(18), 'Renan Rocha',         'M', false, pg_temp.m(16), true, NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(19), 'Rosa Reis',           'F', false, pg_temp.m(17), true, NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(20), 'Raquel Rios',         'F', false, pg_temp.m(18), true, NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(21), 'Eduardo Esteves',     'M', false, pg_temp.m(1), true,  pg_temp.m(22), true,  true,  pg_temp.u(7),  pg_temp.role(7)),
  (pg_temp.m(22), 'Lea Esteves',         'F', false, pg_temp.m(2), true,  pg_temp.m(21), true,  true,  NULL,          NULL),
  (pg_temp.m(23), 'Rafael Rangel',       'M', false, pg_temp.m(21), true, NULL,          true,  true,  pg_temp.u(9),  NULL),
  (pg_temp.m(24), 'Carla Costa',         'F', false, pg_temp.m(2), true,  pg_temp.m(25), true,  true,  NULL,          NULL),
  (pg_temp.m(25), 'Davi Costa',          'M', false, pg_temp.m(27), true, pg_temp.m(24), true,  true,  NULL,          NULL),
  (pg_temp.m(26), 'Fábio Freitas',       'M', false, pg_temp.m(1), true,  NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(27), 'Gil Gomes',           'M', false, pg_temp.m(26), true, NULL,          true,  true,  pg_temp.u(6),  pg_temp.role(6)),
  (pg_temp.m(28), 'Eva Elias',           'F', false, pg_temp.m(2), true,  NULL,          true,  true,  NULL,          NULL),
  (pg_temp.m(29), 'Hugo Horta',          'M', false, pg_temp.m(1), true,  pg_temp.m(30), true,  true,  NULL,          NULL),
  (pg_temp.m(30), 'Helena Horta',        'F', false, pg_temp.m(2), true,  pg_temp.m(29), false, true,  NULL,          NULL),
  (pg_temp.m(31), 'Carlos Cunha',        'M', false, pg_temp.m(1), true,  pg_temp.m(32), true,  true,  pg_temp.u(5),  pg_temp.role(5)),
  (pg_temp.m(32), 'Clara Cunha',         'F', false, pg_temp.m(2), true,  pg_temp.m(31), true,  true,  NULL,          NULL),
  (pg_temp.m(33), 'Júlia Jardim',        'F', false, pg_temp.m(2), true,  pg_temp.m(34), true,  true,  NULL,          NULL),
  (pg_temp.m(34), 'Joana Jardim',        'F', false, pg_temp.m(2), true,  pg_temp.m(33), true,  true,  NULL,          NULL);

SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- Semana de referência W: domingo 2026-03-01 a sábado 2026-03-07.
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active) VALUES
  -- Ministério A: casos de "Células sem relatório" em W.
  (pg_temp.c(1),  pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Domingo', '18:00', true),
  (pg_temp.c(2),  pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(3),  pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Discipulado',   'Terça',   '20:00', true),
  (pg_temp.c(4),  pg_temp.m(6), pg_temp.m(6),         pg_temp.m(6), 'Discipulado',   'Quarta',  '20:00', true),
  (pg_temp.c(5),  pg_temp.m(5), pg_temp.m(7),  pg_temp.m(5), 'Macrocélula',   'Quinta',  '20:00', true),
  (pg_temp.c(6),  pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Sexta',   '20:00', true),
  (pg_temp.c(7),  pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Sábado',  '16:00', true),
  -- 08: quinta 23:59 (o prazo cai na sexta, 00:59); 09 e 15: o último relatório é de uma
  -- semana seguinte a W, que não conta para W (E2.09, risco 13 do E1.08); 10: inativa.
  (pg_temp.c(8),  pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Quinta',  '23:59', true),
  (pg_temp.c(9),  pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Quinta',  '20:00', true),
  (pg_temp.c(10), pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Discipulado',   'Segunda', '20:00', true),
  -- 11: relatório visível em W; 12: relatório em W invisível para P3 (P3 vê a
  -- célula só pela anfitriã Hana); 13: último relatório na semana anterior;
  -- 14: relatório de "não houve célula" em W.
  (pg_temp.c(11), pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(12), pg_temp.m(15), pg_temp.m(15), pg_temp.m(8), 'Discipulado',   'Terça',   '20:00', true),
  (pg_temp.c(13), pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Quarta',  '19:00', true),
  (pg_temp.c(14), pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Evangelística', 'Segunda', '19:00', true),
  (pg_temp.c(15), pg_temp.m(5), pg_temp.m(5),         pg_temp.m(5), 'Macrocélula',   'Sexta',   '20:00', true),
  -- Ministério B (invisível para P3).
  (pg_temp.c(16), pg_temp.m(15), pg_temp.m(15),         pg_temp.m(15), 'Evangelística', 'Quarta',  '20:00', true),
  -- Ranking: Rui 1 + Renan 2 (masculinas), Raquel 1 + Rosa 3 (femininas),
  -- mais uma célula inativa da Rosa, que não conta. Toda célula tem as três pessoas
  -- (RN-02 do E2.08): quem não tem timóteo ou anfitrião próprio repete o líder.
  (pg_temp.c(17), pg_temp.m(16), pg_temp.m(16),         pg_temp.m(16), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(18), pg_temp.m(18), pg_temp.m(18),         pg_temp.m(18), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(19), pg_temp.m(18), pg_temp.m(18),         pg_temp.m(18), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(20), pg_temp.m(19), pg_temp.m(19),         pg_temp.m(19), 'Discipulado',   'Segunda', '20:00', true),
  (pg_temp.c(21), pg_temp.m(19), pg_temp.m(19),         pg_temp.m(19), 'Discipulado',   'Segunda', '20:00', true),
  (pg_temp.c(22), pg_temp.m(19), pg_temp.m(19),         pg_temp.m(19), 'Discipulado',   'Segunda', '20:00', true),
  (pg_temp.c(23), pg_temp.m(19), pg_temp.m(19),         pg_temp.m(19), 'Discipulado',   'Segunda', '20:00', true),
  (pg_temp.c(24), pg_temp.m(20), pg_temp.m(20),         pg_temp.m(20), 'Discipulado',   'Segunda', '20:00', true),
  -- Eduardo & Lea: 2 células do discípulo Rafael.
  (pg_temp.c(25), pg_temp.m(23), pg_temp.m(23),         pg_temp.m(23), 'Evangelística', 'Terça',   '20:00', true),
  (pg_temp.c(26), pg_temp.m(23), pg_temp.m(23),         pg_temp.m(23), 'Evangelística', 'Terça',   '20:00', true),
  -- Carla 1; Davi 2 (contam para Fábio, não para Carla).
  (pg_temp.c(27), pg_temp.m(24), pg_temp.m(24),         pg_temp.m(24), 'Discipulado',   'Terça',   '20:00', true),
  (pg_temp.c(28), pg_temp.m(25), pg_temp.m(25),         pg_temp.m(25), 'Evangelística', 'Terça',   '20:00', true),
  (pg_temp.c(29), pg_temp.m(25), pg_temp.m(25),         pg_temp.m(25), 'Evangelística', 'Terça',   '20:00', true),
  -- Eva 2; Hugo 1; Helena (inativa) 1; Carlos 1; Clara 1.
  (pg_temp.c(30), pg_temp.m(28), pg_temp.m(28),         pg_temp.m(28), 'Discipulado',   'Quarta',  '20:00', true),
  (pg_temp.c(31), pg_temp.m(28), pg_temp.m(28),         pg_temp.m(28), 'Discipulado',   'Quarta',  '20:00', true),
  (pg_temp.c(32), pg_temp.m(29), pg_temp.m(29),         pg_temp.m(29), 'Evangelística', 'Quarta',  '20:00', true),
  (pg_temp.c(33), pg_temp.m(30), pg_temp.m(30),         pg_temp.m(30), 'Discipulado',   'Quarta',  '20:00', true),
  (pg_temp.c(34), pg_temp.m(31), pg_temp.m(31),         pg_temp.m(31), 'Evangelística', 'Quinta',  '20:00', true),
  (pg_temp.c(35), pg_temp.m(32), pg_temp.m(32),         pg_temp.m(32), 'Discipulado',   'Quinta',  '20:00', true);

-- E2.08 (RN-11): a célula nova sempre começa ativa; as inativas são inativadas depois.
UPDATE public.cells SET is_active = false WHERE id IN (pg_temp.c(10), pg_temp.c(23));
-- E2.09 (RN-06): a célula inserida agora só conta a partir de agora. As ativas da massa
-- contam "desde sempre", para a semana W (março de 2026) contar.
UPDATE private.cell_active_periods p SET periods = '{(,)}'
  FROM public.cells c
 WHERE c.id = p.cell_id AND c.is_active
   AND c.id IN (SELECT pg_temp.c(n) FROM generate_series(1, 35) n);

SET LOCAL session_replication_role = replica;

-- (E2.06: os totais saíram de members e são NOT NULL em private.member_hierarchy; o caso
-- "male_cells nulo" do ranking não existe mais, e o coalesce da RPC fica só como proteção.)

-- Relatórios. 01 a 05 em datas fixas, sem participantes; 06 a 08 relativos a
-- hoje (vínculo celular, MEM-14), em células que nunca contam como pendentes.
-- 06 e 07 ficam em células diferentes (10 e 09): hoje − 30 e hoje − 31 caem na
-- mesma semana na maioria dos dias, e o índice único da semana (E2.01,
-- cell_reports_cell_week_key) vale mesmo com session_replication_role = replica.
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, observations, visitors, was_held) VALUES
  (pg_temp.r(1), pg_temp.c(11), '2026-03-02', '20:00', 'Fé',        NULL,    ARRAY['Visitante Um', 'Visitante Dois'], true),
  (pg_temp.r(2), pg_temp.c(12), '2026-03-03', '20:00', 'Amor',      NULL,    ARRAY['X Um', 'X Dois', 'X Três'],       true),
  (pg_temp.r(3), pg_temp.c(14), '2026-03-02', '19:00', NULL,        'Chuva', NULL,                                    false),
  (pg_temp.r(4), pg_temp.c(13), '2026-02-28', '19:00', 'Antes',     NULL,    ARRAY['Visitante Antes'],                true),
  (pg_temp.r(5), pg_temp.c(11), '2026-03-08', '20:00', 'Depois',    NULL,    ARRAY['Visitante Depois'],               true),
  (pg_temp.r(6), pg_temp.c(10), public.sp_today() - 30, '20:00', 'Trinta',    NULL, '{}', true),
  (pg_temp.r(7), pg_temp.c(9),  public.sp_today() - 31, '20:00', 'Trinta e um', NULL, '{}', true),
  (pg_temp.r(8), pg_temp.c(16), public.sp_today() - 1,  '20:00', 'Ontem',     NULL, '{}', true),
  -- E2.09 (risco 13 do E1.08): o relatório de uma semana seguinte não tira a célula 15 das pendentes de W.
  (pg_temp.r(9), pg_temp.c(15), '2026-03-16', '20:00', 'Depois de W', NULL, '{}', true);

INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
  (pg_temp.r(6), pg_temp.m(9)),   -- Paulo Trinta: há 30 dias (conta)
  (pg_temp.r(7), pg_temp.m(10)),  -- Pedro: há 31 dias (não conta)
  (pg_temp.r(8), pg_temp.m(11));  -- Iara: célula do ministério B, invisível para P3 (conta)

SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- ---------------------------------------------------------------------------
-- Conjuntos calculados como postgres, sem escopo, para a paridade (RN-05):
--   - membros com vínculo celular (MEM-14): líder, timóteo ou anfitrião de
--     qualquer célula, ou participante de relatório nos últimos 30 dias;
--   - último relatório de cada célula, visível ou não (RN-08 d).
-- Desde o E2.01 (RN-08, RN-12), célula excluída não dá vínculo, e relatório
-- excluído não conta como participação nem como último relatório. A massa
-- deste arquivo não tem excluídos, mas a base pode ter.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE linked_members AS
SELECT leader_id AS member_id FROM public.cells WHERE leader_id IS NOT NULL AND deleted_at IS NULL
UNION SELECT timothy_id FROM public.cells WHERE timothy_id IS NOT NULL AND deleted_at IS NULL
UNION SELECT host_id FROM public.cells WHERE host_id IS NOT NULL AND deleted_at IS NULL
UNION SELECT p.member_id
        FROM public.cell_report_participants p
        JOIN public.cell_reports r ON r.id = p.report_id
       WHERE r.date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 30
         AND r.deleted_at IS NULL;

CREATE TEMP TABLE cell_last_report AS
SELECT cell_id, max(date) AS last_date FROM public.cell_reports WHERE deleted_at IS NULL GROUP BY cell_id;

GRANT SELECT ON pg_temp.linked_members, pg_temp.cell_last_report TO authenticated;

-- RN-05: os números de dashboard_summary(_at) = as mesmas contagens nas tabelas
-- sob o RLS atual, para quem está logado agora. A semana e o dia são
-- calculados aqui de novo, sem as funções da migration. Desde o E2.09, as
-- pendentes são as "Pendente" de cells_report_situation(_at) (RN-08 de lá).
CREATE FUNCTION pg_temp.summary_parity(_who text, _at timestamptz) RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  _local timestamp := _at AT TIME ZONE 'America/Sao_Paulo';
  _ws date := _local::date - extract(dow FROM _local::date)::int;
  _we date := _ws + 6;
  s record;
BEGIN
  SELECT * INTO s FROM public.dashboard_summary(_at);

  RETURN NEXT is(ARRAY[s.week_start, s.week_end], ARRAY[_ws, _we],
    _who || ': semana de domingo a sábado no horário de Brasília');

  RETURN NEXT is(
    ARRAY[s.members_total, s.members_active, s.members_inactive, s.members_baptized,
          s.members_not_baptized, s.members_without_leader, s.members_without_cell_link],
    (SELECT ARRAY[
              count(*),
              count(*) FILTER (WHERE m.is_active),
              count(*) FILTER (WHERE NOT m.is_active),
              count(*) FILTER (WHERE m.is_baptized),
              count(*) FILTER (WHERE NOT m.is_baptized),
              count(*) FILTER (WHERE m.is_active AND NOT m.is_pastor AND m.leader_id IS NULL),
              count(*) FILTER (WHERE m.is_active AND NOT m.is_pastor
                                 AND m.id NOT IN (SELECT l.member_id FROM pg_temp.linked_members l))]
       FROM public.members m),
    _who || ': cards de membros = contagens em members sob RLS (RN-05)');

  RETURN NEXT is(
    ARRAY[s.reports_sent, s.visitors, s.cells_not_held],
    (SELECT ARRAY[count(*), coalesce(sum(cardinality(r.visitors)), 0), count(*) FILTER (WHERE NOT r.was_held)]
       FROM public.cell_reports r
      WHERE r.date BETWEEN _ws AND _we),
    _who || ': relatórios, visitantes e não realizadas = cell_reports da semana sob RLS (RN-05)');

  -- E2.09 (RN-08): o card é a contagem de "Pendente" da mesma função da lista, no mesmo momento.
  RETURN NEXT is(
    s.cells_pending,
    (SELECT count(*) FROM public.cells_report_situation(_at) x
      WHERE x.report_status = 'pending'::public.cell_report_status),
    _who || ': células com relatório pendente = "Pendente" de cells_report_situation(_at) (RN-08 do E2.09)');
END $$;

-- RN-05: tipos de célula e ranking G12 = contagens nas tabelas sob RLS.
CREATE FUNCTION pg_temp.lists_parity(_who text) RETURNS SETOF text LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEXT set_eq(
    'SELECT cell_type, total FROM public.dashboard_cells_by_type()',
    'SELECT type, count(*) FROM public.cells GROUP BY type',
    _who || ': células por tipo = cells sob RLS, ativas e inativas (RN-05)');

  RETURN NEXT set_eq(
    $q$ SELECT k::uuid
          FROM public.dashboard_g12_ranking() g, unnest(string_to_array(g.couple_key, '|')) k
         WHERE k::uuid IN (SELECT id FROM public.members_view WHERE g12_level = 1 AND is_active) $q$,
    'SELECT id FROM public.members_view WHERE g12_level = 1 AND is_active',
    _who || ': ranking traz cada G12 ativo e visível em members sob RLS (RN-05)');

  RETURN NEXT is_empty(
    $q$ SELECT k
          FROM public.dashboard_g12_ranking() g, unnest(string_to_array(g.couple_key, '|')) k
         WHERE k::uuid NOT IN (SELECT id FROM public.members WHERE is_active) $q$,
    _who || ': nenhuma chave do ranking expõe um membro invisível ou inativo (RN-05)');

  RETURN NEXT is(
    (SELECT coalesce(sum(total_cells), 0)::numeric FROM public.dashboard_g12_ranking()),
    (SELECT coalesce(sum(coalesce(male_cells, 0) + coalesce(female_cells, 0)), 0)::numeric
       FROM public.members_view WHERE g12_level = 1 AND is_active),
    _who || ': total do ranking = soma das células dos G12 ativos e visíveis, sem dupla contagem (RN-05)');
END $$;

-- Datas de W em Brasília.
--   dom 2026-03-01 · seg 02 · ter 03 · qua 04 · qui 05 · sex 06 · sáb 07 · dom 08

-- ===========================================================================
-- 1. Grants, propriedades e contrato das funções — 30 verificações
-- ===========================================================================
SELECT ok(NOT has_function_privilege('anon', 'public.dashboard_summary(timestamptz)', 'EXECUTE'),
  'dashboard_summary: anon sem EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.dashboard_cells_by_type()', 'EXECUTE'),
  'dashboard_cells_by_type: anon sem EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public.dashboard_g12_ranking()', 'EXECUTE'),
  'dashboard_g12_ranking: anon sem EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'public._dashboard_assert_access()', 'EXECUTE'),
  '_dashboard_assert_access: anon sem EXECUTE');

SELECT ok(has_function_privilege('authenticated', 'public.dashboard_summary(timestamptz)', 'EXECUTE'),
  'dashboard_summary: authenticated com EXECUTE');
SELECT ok(has_function_privilege('authenticated', 'public.dashboard_cells_by_type()', 'EXECUTE'),
  'dashboard_cells_by_type: authenticated com EXECUTE');
SELECT ok(has_function_privilege('authenticated', 'public.dashboard_g12_ranking()', 'EXECUTE'),
  'dashboard_g12_ranking: authenticated com EXECUTE');
SELECT ok(has_function_privilege('authenticated', 'public._dashboard_assert_access()', 'EXECUTE'),
  '_dashboard_assert_access: authenticated com EXECUTE (chamada pelas RPCs SECURITY INVOKER)');

SELECT is_empty($$ SELECT 1 FROM pg_proc, aclexplode(proacl) a
                    WHERE oid = 'public.dashboard_summary(timestamptz)'::regprocedure AND a.grantee = 0 $$,
  'dashboard_summary: nada concedido a PUBLIC');
SELECT is_empty($$ SELECT 1 FROM pg_proc, aclexplode(proacl) a
                    WHERE oid = 'public.dashboard_cells_by_type()'::regprocedure AND a.grantee = 0 $$,
  'dashboard_cells_by_type: nada concedido a PUBLIC');
SELECT is_empty($$ SELECT 1 FROM pg_proc, aclexplode(proacl) a
                    WHERE oid = 'public.dashboard_g12_ranking()'::regprocedure AND a.grantee = 0 $$,
  'dashboard_g12_ranking: nada concedido a PUBLIC');
SELECT is_empty($$ SELECT 1 FROM pg_proc, aclexplode(proacl) a
                    WHERE oid = 'public._dashboard_assert_access()'::regprocedure AND a.grantee = 0 $$,
  '_dashboard_assert_access: nada concedido a PUBLIC');

SELECT results_eq(
  $$ SELECT proname::text COLLATE "default", prosecdef, provolatile::text COLLATE "default",
            proconfig::text COLLATE "default"
       FROM pg_proc
      WHERE oid IN ('public.dashboard_summary(timestamptz)'::regprocedure,
                    'public.dashboard_cells_by_type()'::regprocedure,
                    'public.dashboard_g12_ranking()'::regprocedure,
                    'public._dashboard_assert_access()'::regprocedure)
      ORDER BY proname $$,
  $$ VALUES ('_dashboard_assert_access', false, 's', '{search_path=public}'),
            ('dashboard_cells_by_type',  false, 's', '{search_path=public}'),
            ('dashboard_g12_ranking',    false, 's', '{search_path=public}'),
            ('dashboard_summary',        false, 's', '{search_path=public}') $$,
  'as quatro funções: SECURITY INVOKER (prosecdef = false), STABLE e search_path=public');

SELECT is(pg_get_function_result('public.dashboard_summary(timestamptz)'::regprocedure),
  'TABLE(week_start date, week_end date, reports_sent bigint, cells_pending bigint, visitors bigint, '
  || 'cells_not_held bigint, members_total bigint, members_active bigint, members_inactive bigint, '
  || 'members_baptized bigint, members_not_baptized bigint, members_without_leader bigint, '
  || 'members_without_cell_link bigint)',
  'dashboard_summary: colunas na ordem do contrato do spec');
SELECT is(pg_get_function_result('public.dashboard_cells_by_type()'::regprocedure),
  'TABLE(cell_type text, total bigint)',
  'dashboard_cells_by_type: colunas do contrato');
SELECT is(pg_get_function_result('public.dashboard_g12_ranking()'::regprocedure),
  'TABLE(couple_key text, name text, spouse_name text, male_cells bigint, female_cells bigint, total_cells bigint)',
  'dashboard_g12_ranking: colunas do contrato');
SELECT is(pg_get_function_arguments('public.dashboard_summary(timestamptz)'::regprocedure),
  '_at timestamp with time zone DEFAULT now()',
  'dashboard_summary: _at opcional, com now() como padrão');

-- RN-05: as RPCs leem só das views (herdam o escopo e a máscara), nunca das tabelas.
SELECT ok(prosrc !~ 'public\.(members|cells|cell_reports|cell_report_participants)\y',
  'dashboard_summary: não lê as tabelas diretamente, só as views')
  FROM pg_proc WHERE oid = 'public.dashboard_summary(timestamptz)'::regprocedure;
SELECT ok(prosrc !~ 'public\.(members|cells|cell_reports|cell_report_participants)\y',
  'dashboard_cells_by_type: não lê as tabelas diretamente, só as views')
  FROM pg_proc WHERE oid = 'public.dashboard_cells_by_type()'::regprocedure;
SELECT ok(prosrc !~ 'public\.(members|cells|cell_reports|cell_report_participants)\y',
  'dashboard_g12_ranking: não lê as tabelas diretamente, só as views')
  FROM pg_proc WHERE oid = 'public.dashboard_g12_ranking()'::regprocedure;
SELECT ok(prosrc ~ 'public\._dashboard_assert_access\(\)',
  'dashboard_summary: começa pela checagem de acesso (RN-09)')
  FROM pg_proc WHERE oid = 'public.dashboard_summary(timestamptz)'::regprocedure;
SELECT ok(prosrc ~ 'public\._dashboard_assert_access\(\)',
  'dashboard_cells_by_type: começa pela checagem de acesso (RN-09)')
  FROM pg_proc WHERE oid = 'public.dashboard_cells_by_type()'::regprocedure;
SELECT ok(prosrc ~ 'public\._dashboard_assert_access\(\)',
  'dashboard_g12_ranking: começa pela checagem de acesso (RN-09)')
  FROM pg_proc WHERE oid = 'public.dashboard_g12_ranking()'::regprocedure;

-- Comportamento: anon não executa nenhuma das quatro.
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT * FROM public.dashboard_summary()', '42501', NULL,
  'anon: dashboard_summary é negado');
SELECT throws_ok('SELECT * FROM public.dashboard_cells_by_type()', '42501', NULL,
  'anon: dashboard_cells_by_type é negado');
SELECT throws_ok('SELECT * FROM public.dashboard_g12_ranking()', '42501', NULL,
  'anon: dashboard_g12_ranking é negado');
SELECT throws_ok('SELECT public._dashboard_assert_access()', '42501', NULL,
  'anon: _dashboard_assert_access é negado');
RESET ROLE;

-- A massa ficou como planejado (o trigger de estatísticas calculou as células).
SELECT results_eq(
  format($$ SELECT m.name, h.male_cells, h.female_cells FROM public.members m
              JOIN private.member_hierarchy h ON h.member_id = m.id
             WHERE m.id = ANY(%L::uuid[]) ORDER BY m.name $$,
         pg_temp.ms(3, 4, 16, 17, 18, 19)),
  $$ VALUES ('Ana Alencar'::text, 0, 1), ('André Alencar'::text, 12, 0), ('Renan Rocha'::text, 2, 1),
            ('Rita Ramos'::text, 0, 3), ('Rosa Reis'::text, 0, 3), ('Rui Ramos'::text, 3, 1) $$,
  'massa: male_cells e female_cells calculados pelo trigger de estatísticas (acumulam a subárvore)');
SELECT is(pg_temp.subtree_active_cells(pg_temp.m(16), pg_temp.m(17)), 7::bigint,
  'massa: a subárvore de Rui & Rita tem 7 células ativas (3 de homens, 4 de mulheres)');
SELECT is((SELECT count(*)::int FROM public.cells WHERE id::text LIKE 'd1083000%'), 35,
  'massa: 35 células');

-- ===========================================================================
-- 2. RN-08: semana e "Células sem relatório" com _at fixo (P3, ministério A)
-- ===========================================================================
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;

-- Virada de semana: sábado 23:59 → domingo 00:00 (Brasília) — 8 verificações
SELECT results_eq(
  $$ SELECT week_start, week_end, reports_sent, visitors, cells_not_held, cells_pending
       FROM public.dashboard_summary('2026-03-07 23:59:00-03') $$,
  $$ VALUES ('2026-03-01'::date, '2026-03-07'::date, 3::bigint, 5::bigint, 1::bigint, 11::bigint) $$,
  'RN-08/P3: sábado 23:59 ainda é a semana 01/03–07/03: 3 relatórios visíveis, 5 visitantes, 1 não realizada, 11 pendentes');
SELECT results_eq(
  $$ SELECT week_start, week_end, reports_sent, visitors, cells_not_held, cells_pending
       FROM public.dashboard_summary('2026-03-07 23:59:59-03') $$,
  $$ VALUES ('2026-03-01'::date, '2026-03-07'::date, 3::bigint, 5::bigint, 1::bigint, 11::bigint) $$,
  'RN-08/P3: sábado 23:59:59 ainda é a mesma semana');
SELECT results_eq(
  $$ SELECT week_start, week_end, reports_sent, visitors, cells_not_held, cells_pending
       FROM public.dashboard_summary('2026-03-08 00:00:00-03') $$,
  $$ VALUES ('2026-03-08'::date, '2026-03-14'::date, 1::bigint, 1::bigint, 0::bigint, 0::bigint) $$,
  'RN-08/P3: domingo 00:00 muda de semana: só o relatório de domingo 08/03 conta e as pendentes zeram');
SELECT results_eq(
  $$ SELECT week_start, week_end, reports_sent, visitors, cells_not_held
       FROM public.dashboard_summary('2026-02-28 23:59:00-03') $$,
  $$ VALUES ('2026-02-22'::date, '2026-02-28'::date, 1::bigint, 1::bigint, 0::bigint) $$,
  'RN-08/P3: o sábado anterior (28/02) conta o relatório dele, na semana 22/02–28/02');
SELECT is((SELECT week_start FROM public.dashboard_summary('2026-03-08 02:59:59+00')), '2026-03-01'::date,
  'RN-08: 02:59:59 UTC de domingo ainda é sábado em Brasília (semana 01/03)');
SELECT is((SELECT week_start FROM public.dashboard_summary('2026-03-08 03:00:00+00')), '2026-03-08'::date,
  'RN-08: 03:00 UTC de domingo é domingo 00:00 em Brasília (semana 08/03)');

-- O fuso da sessão não muda nada.
SET LOCAL timezone = 'Asia/Tokyo';
SELECT results_eq(
  $$ SELECT week_start, cells_pending FROM public.dashboard_summary('2026-03-07 23:59:00-03') $$,
  $$ VALUES ('2026-03-01'::date, 11::bigint) $$,
  'RN-08: com a sessão em Asia/Tokyo, o mesmo instante dá a mesma semana e as mesmas pendentes');
SET LOCAL timezone = 'UTC';
SELECT results_eq(
  $$ SELECT week_start, week_end FROM public.dashboard_summary() $$,
  $$ SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date
             - extract(dow FROM (now() AT TIME ZONE 'America/Sao_Paulo')::date)::int),
            ((now() AT TIME ZONE 'America/Sao_Paulo')::date
             - extract(dow FROM (now() AT TIME ZONE 'America/Sao_Paulo')::date)::int + 6) $$,
  'RN-08: sem _at, a semana é a de hoje em Brasília (sessão em UTC)');
RESET timezone;

-- Linha do tempo de W (P3). Desde o E2.09 (RN-02), cada célula entra no prazo: 1 hora
-- depois do horário da reunião, e não no horário — 21 verificações
SELECT is(pg_temp.pending('2026-03-01 18:59:59-03'), 0::bigint, 'RN-08/P3: domingo 18:59:59: nenhuma pendente');
SELECT is(pg_temp.pending('2026-03-01 19:00:00-03'), 1::bigint, 'RN-08/P3: domingo 19:00: a célula de domingo 18:00 entra');
SELECT is(pg_temp.pending('2026-03-02 20:59:00-03'), 1::bigint,
  'RN-08/P3: segunda 20:59: a célula de segunda 20:00 ainda não conta (a de segunda 19:00 tem relatório "não houve")');
SELECT is(pg_temp.pending('2026-03-02 21:00:00-03'), 2::bigint,
  'RN-08a/P3: segunda 21:00: a célula de segunda entra (a inativa e a com relatório não)');
SELECT is(pg_temp.pending('2026-03-03 20:59:00-03'), 2::bigint, 'RN-08/P3: terça 20:59: a de terça ainda não conta');
SELECT is(pg_temp.pending('2026-03-03 21:00:00-03'), 3::bigint,
  'RN-08a/P3: terça 21:00: a célula de terça entra (a de terça com relatório da semana não, RN-08d)');
SELECT is(pg_temp.pending('2026-03-04 19:59:00-03'), 3::bigint, 'RN-08/P3: quarta 19:59: nada novo');
SELECT is(pg_temp.pending('2026-03-04 20:00:00-03'), 4::bigint,
  'RN-08/P3: quarta 20:00: entra a célula de quarta 19:00, cujo último relatório é da semana anterior');
SELECT is(pg_temp.pending('2026-03-04 20:59:00-03'), 4::bigint, 'RN-08/P3: quarta 20:59: a de quarta 20:00 ainda não conta');
SELECT is(pg_temp.pending('2026-03-04 21:00:00-03'), 5::bigint, 'RN-08a/P3: quarta 21:00: a célula de quarta entra');
SELECT is(pg_temp.pending('2026-03-05 20:59:00-03'), 5::bigint, 'RN-08/P3: quinta 20:59: as de quinta ainda não contam');
SELECT is(pg_temp.pending('2026-03-05 21:00:00-03'), 7::bigint,
  'RN-08a/P3: quinta 21:00: as duas células de quinta 20:00 entram (a 9 tem relatório numa semana seguinte: risco 13)');
SELECT is(pg_temp.pending('2026-03-05 23:59:59-03'), 7::bigint,
  'RN-08/P3: quinta 23:59:59: a célula de quinta 23:59 ainda não conta (o prazo cai na sexta)');
SELECT is(pg_temp.pending('2026-03-06 00:58:59-03'), 7::bigint,
  'RN-02/P3: sexta 00:58:59: a célula de quinta 23:59 ainda não conta');
SELECT is(pg_temp.pending('2026-03-06 00:59:00-03'), 8::bigint,
  'RN-02/P3: sexta 00:59: a célula de quinta 23:59 entra (prazo no dia seguinte)');
SELECT is(pg_temp.pending('2026-03-06 20:59:00-03'), 8::bigint, 'RN-08/P3: sexta 20:59: as de sexta ainda não contam');
SELECT is(pg_temp.pending('2026-03-06 21:00:00-03'), 10::bigint,
  'RN-08a/P3: sexta 21:00: as duas células de sexta entram (a 15 tem relatório numa semana seguinte: risco 13)');
SELECT is(pg_temp.pending('2026-03-07 16:59:00-03'), 10::bigint, 'RN-08/P3: sábado 16:59: a de sábado ainda não conta');
SELECT is(pg_temp.pending('2026-03-07 17:00:00-03'), 11::bigint,
  'RN-08/P3: sábado 17:00: a de sábado entra; a inativa e as com relatório na semana ficam fora');

-- O mesmo instante em UTC (segunda 20:59 e 21:00 em Brasília).
SELECT is(pg_temp.pending('2026-03-02 23:59:00+00'), 1::bigint,
  'RN-08/P3: 23:59 UTC de segunda = 20:59 em Brasília: ainda não conta');
SELECT is(pg_temp.pending('2026-03-03 00:00:00+00'), 2::bigint,
  'RN-08/P3: 00:00 UTC de terça = 21:00 de segunda em Brasília: conta');

-- E2.09 (risco 13 do E1.08): o relatório de uma semana posterior não tira a célula das pendentes
-- da semana consultada; o da própria semana tira — 3 verificações
SELECT is((SELECT report_status FROM public.cells_report_situation('2026-03-07 23:59-03') WHERE cell_id = pg_temp.c(15)),
  'pending'::public.cell_report_status, 'risco 13: a célula 15 (relatório em 16/03) está "Pendente" em W');
SELECT is((SELECT report_status FROM public.cells_report_situation('2026-03-07 23:59-03') WHERE cell_id = pg_temp.c(11)),
  'sent_held'::public.cell_report_status, 'risco 13: a célula 11 (relatórios em W e em 08/03) está "Enviado" em W');
SELECT is((SELECT report_status FROM public.cells_report_situation('2026-03-17 12:00-03') WHERE cell_id = pg_temp.c(15)),
  'sent_held'::public.cell_report_status, 'risco 13: na semana do relatório (16/03), a célula 15 está "Enviado"');

-- RN-08d: a célula 12 é visível para P3 (pela anfitriã) e, desde o E2.02 (RN-04), o relatório dela também.
-- O relatório de uma célula do ministério B (16) continua invisível.
SELECT isnt_empty(format('SELECT 1 FROM public.cell_reports WHERE cell_id = %L', pg_temp.c(12)),
  'RN-08d/P3: o relatório da célula 12 é visível para P3 sob RLS (anfitriã no escopo, RN-04)');
SELECT is_empty(format('SELECT 1 FROM public.cell_reports WHERE cell_id = %L', pg_temp.c(16)),
  'RN-08d/P3: o relatório da célula 16 (ministério B) é invisível para P3 sob RLS');
SELECT isnt_empty(format('SELECT 1 FROM public.cells WHERE id = %L', pg_temp.c(12)),
  'RN-08d/P3: a célula 12 é visível para P3 sob RLS');

-- Cards da semana só com relatórios visíveis e da semana.
SELECT is((SELECT reports_sent FROM public.dashboard_summary('2026-03-04 12:00-03')), 3::bigint,
  'RN-08/P3: relatórios enviados em W = 3 (os da semana anterior e da seguinte ficam fora; o da célula 12 conta, RN-04)');
SELECT is((SELECT visitors FROM public.dashboard_summary('2026-03-04 12:00-03')), 5::bigint,
  'RN-08/P3: visitantes em W = 5 (2 + os 3 do relatório da célula 12; visitantes nulos valem 0)');
SELECT is((SELECT cells_not_held FROM public.dashboard_summary('2026-03-04 12:00-03')), 1::bigint,
  'RN-08/P3: células não realizadas em W = 1');
RESET ROLE;

-- Como P2 (igreja toda), o relatório invisível para P3 entra — 1 verificação
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT cmp_ok(
  (SELECT reports_sent FROM public.dashboard_summary('2026-03-04 12:00-03')), '>=', 3::bigint,
  'RN-08/P2: quem vê o relatório da célula 12 conta 3 ou mais em W');
RESET ROLE;

-- ===========================================================================
-- 3. RN-08: cards de membros e "Sem vínculo celular" (P3) — 6 verificações
-- ===========================================================================
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$ SELECT members_total, members_active, members_inactive, members_baptized, members_not_baptized
       FROM public.dashboard_summary('2026-03-04 12:00-03') $$,
  $$ VALUES (11::bigint, 10::bigint, 1::bigint, 8::bigint, 3::bigint) $$,
  'RN-08/P3: 11 membros visíveis, 10 ativos, 1 inativo; batizados 8 e não batizados 3, contando o inativo');
SELECT is((SELECT members_without_leader FROM public.dashboard_summary()), 0::bigint,
  'RN-08/P3: todos os membros visíveis têm líder');
SELECT is((SELECT members_without_cell_link FROM public.dashboard_summary()), 4::bigint,
  'RN-08c/P3: sem vínculo celular = 4 (André, Ana, Pedro com participação há 31 dias, Nina)');
SELECT is((SELECT members_without_cell_link FROM public.dashboard_summary('2020-01-01 12:00-03')), 4::bigint,
  'RN-08c/P3: o vínculo usa hoje (sp_today), não o _at');
SELECT set_eq(
  $$ SELECT id FROM public.members_view
      WHERE is_active AND NOT is_pastor
        AND NOT (is_cell_leader OR is_cell_timothy OR is_cell_host OR attended_last_30_days) $$,
  pg_temp.ms(3, 4, 10, 12),
  'RN-08c/P3: contam como vínculo líder (Arthur, Lia), timóteo (Tito), anfitriã (Hana), participação há 30 dias (Paulo) e numa célula invisível (Iara); Igor inativo fica fora');
SELECT is_empty(format('SELECT 1 FROM public.cell_reports WHERE id = %L', pg_temp.r(8)),
  'RN-08c/P3: o relatório em que Iara participou é invisível para P3');
RESET ROLE;

-- ===========================================================================
-- 4. dashboard_cells_by_type (P3) — 2 verificações
-- ===========================================================================
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  'SELECT cell_type, total FROM public.dashboard_cells_by_type()',
  $$ VALUES ('Discipulado'::text, 4::bigint), ('Evangelística'::text, 9::bigint), ('Macrocélula'::text, 2::bigint) $$,
  'dashboard_cells_by_type/P3: 15 células visíveis por tipo, em ordem de tipo, inclusive a inativa e a vista pela anfitriã');
SELECT is((SELECT sum(total) FROM public.dashboard_cells_by_type()), (SELECT count(*) FROM public.cells_view)::numeric,
  'dashboard_cells_by_type/P3: a soma é o total de células visíveis (ativas e inativas)');
RESET ROLE;

-- ===========================================================================
-- 5. RN-08b: ranking G12
-- ===========================================================================

-- P1 vê tudo: as linhas da massa, na ordem do ranking — 9 verificações
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$ SELECT name, spouse_name, male_cells, female_cells, total_cells
       FROM public.dashboard_g12_ranking() WITH ORDINALITY g
      WHERE couple_key LIKE 'c1083000%'
      ORDER BY ordinality $$,
  $$ VALUES
       ('André Alencar'::text,   'Ana Alencar'::text,  12::bigint, 1::bigint, 13::bigint),
       ('Rui Ramos'::text,       'Rita Ramos'::text,    3::bigint, 4::bigint,  7::bigint),
       ('Bruno Barros'::text,    NULL::text,            2::bigint, 0::bigint,  2::bigint),
       ('Carlos Cunha'::text,    'Clara Cunha'::text,   1::bigint, 1::bigint,  2::bigint),
       ('Eduardo Esteves'::text, 'Lea Esteves'::text,   2::bigint, 0::bigint,  2::bigint),
       ('Eva Elias'::text,       NULL::text,            0::bigint, 2::bigint,  2::bigint),
       ('Fábio Freitas'::text,   NULL::text,            2::bigint, 0::bigint,  2::bigint),
       ('Davi Costa'::text,      'Carla Costa'::text,   0::bigint, 1::bigint,  1::bigint),
       ('Hugo Horta'::text,      NULL::text,            1::bigint, 0::bigint,  1::bigint),
       ('Júlia Jardim'::text,    'Joana Jardim'::text,  0::bigint, 0::bigint,  0::bigint) $$,
  'RN-08b/P1: um casal por linha, homem primeiro, do maior total para o menor e por nome; casais com 0 células aparecem');
SELECT results_eq(
  format('SELECT couple_key, male_cells, female_cells, total_cells FROM public.dashboard_g12_ranking() WHERE couple_key = %L',
         pg_temp.couple(16, 17)),
  format($$ VALUES (%L::text, 3::bigint, 4::bigint, 7::bigint) $$, pg_temp.couple(16, 17)),
  'RN-08b/P1: casal G12 com 3 células masculinas e 4 femininas na subárvore → 3, 4 e 7');
SELECT is(
  (SELECT total_cells FROM public.dashboard_g12_ranking() WHERE couple_key = pg_temp.couple(16, 17)),
  pg_temp.subtree_active_cells(pg_temp.m(16), pg_temp.m(17)),
  'RN-08b/P1: cada célula conta uma vez: total do casal = células ativas da subárvore (a inativa da Rosa fica fora)');
SELECT is(
  (SELECT total_cells FROM public.dashboard_g12_ranking() WHERE couple_key = pg_temp.couple(3, 4)),
  pg_temp.subtree_active_cells(pg_temp.m(3), pg_temp.m(4)),
  'RN-08b/P1: o mesmo para André & Ana (13 células ativas)');
SELECT results_eq(
  format('SELECT couple_key, name, spouse_name FROM public.dashboard_g12_ranking() WHERE couple_key = %L', pg_temp.couple(21, 22)),
  format($$ VALUES (%L::text, 'Eduardo Esteves'::text, 'Lea Esteves'::text) $$, pg_temp.couple(21, 22)),
  'RN-08b (cenário do Vitest removido 1): as 2 células do discípulo Rafael contam uma vez para Eduardo & Lea; pastores e o discípulo não viram linha');
SELECT is_empty(
  format($$ SELECT 1 FROM public.dashboard_g12_ranking() g, unnest(string_to_array(g.couple_key, '|')) k
             WHERE k::uuid = ANY(%L::uuid[]) $$, pg_temp.ms(1, 2, 23, 27, 30)),
  'RN-08b/P1: pastores, discípulos (Rafael, Gil) e a cônjuge inativa (Helena) não aparecem em nenhuma chave');
SELECT results_eq(
  format('SELECT couple_key, name, spouse_name, male_cells, female_cells FROM public.dashboard_g12_ranking() WHERE couple_key LIKE %L',
         '%' || pg_temp.m(24)::text || '%'),
  format($$ VALUES (%L::text, 'Davi Costa'::text, 'Carla Costa'::text, 0::bigint, 1::bigint) $$, pg_temp.couple(24, 25)),
  'RN-08b (cenário do Vitest removido 3): cônjuge de outro nível só dá o nome (as 2 células do Davi contam para Fábio), homem primeiro');
SELECT results_eq(
  format('SELECT couple_key, spouse_name FROM public.dashboard_g12_ranking() WHERE couple_key LIKE %L',
         '%' || pg_temp.m(29)::text || '%'),
  format($$ VALUES (%L::text, NULL::text) $$, pg_temp.m(29)),
  'RN-08b/P1: G12 com cônjuge inativa fica sozinho na linha, sem expor o id dela na chave');
SELECT results_eq(
  format('SELECT couple_key, name, spouse_name FROM public.dashboard_g12_ranking() WHERE couple_key = %L', pg_temp.couple(33, 34)),
  format($$ VALUES (%L::text, 'Júlia Jardim'::text, 'Joana Jardim'::text) $$, pg_temp.couple(33, 34)),
  'RN-08b/P1: casal de nível 1 sem homem: o de menor id primeiro, uma linha só');
RESET ROLE;

-- P3 vê só o próprio casal G12 — 1 verificação
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  'SELECT couple_key, name, spouse_name, male_cells, female_cells, total_cells FROM public.dashboard_g12_ranking()',
  format($$ VALUES (%L::text, 'André Alencar'::text, 'Ana Alencar'::text, 12::bigint, 1::bigint, 13::bigint) $$,
         pg_temp.couple(3, 4)),
  'RN-08b/P3: só o casal G12 do ministério, com as células da subárvore dos dois (cenário do Vitest removido 2)');
RESET ROLE;

-- P5 (Carlos, G12 que só vê o próprio cadastro): cônjuge invisível — 1 verificação
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  'SELECT couple_key, name, spouse_name, male_cells, female_cells, total_cells FROM public.dashboard_g12_ranking()',
  format($$ VALUES (%L::text, 'Carlos Cunha'::text, NULL::text, 1::bigint, 0::bigint, 1::bigint) $$, pg_temp.m(31)),
  'RN-08b/P5: cônjuge invisível: o G12 fica sozinho, sem o nome nem o id da cônjuge, só com as próprias células');
RESET ROLE;

-- ===========================================================================
-- 6. RN-09: acesso — 14 verificações
-- ===========================================================================

-- view_members sem view_dashboard (Eduardo): vê membros, mas não o dashboard.
SELECT pg_temp.login(7);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT * FROM public.dashboard_summary()', '42501',
  'Você não tem permissão para ver o dashboard.', 'RN-09: sem permissão de dashboard, dashboard_summary → 42501');
SELECT throws_ok('SELECT * FROM public.dashboard_cells_by_type()', '42501',
  'Você não tem permissão para ver o dashboard.', 'RN-09: sem permissão de dashboard, dashboard_cells_by_type → 42501');
SELECT throws_ok('SELECT * FROM public.dashboard_g12_ranking()', '42501',
  'Você não tem permissão para ver o dashboard.', 'RN-09: sem permissão de dashboard, dashboard_g12_ranking → 42501');
SELECT throws_ok($$ SELECT * FROM public.dashboard_summary('2026-03-04 12:00-03') $$, '42501',
  'Você não tem permissão para ver o dashboard.', 'RN-09: o _at não contorna a checagem');
RESET ROLE;

-- Usuário do Auth sem cadastro de membro.
SELECT pg_temp.login(8);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT * FROM public.dashboard_summary()', '42501', NULL,
  'RN-09: sem cadastro de membro, dashboard_summary → 42501');
SELECT throws_ok('SELECT * FROM public.dashboard_cells_by_type()', '42501', NULL,
  'RN-09: sem cadastro de membro, dashboard_cells_by_type → 42501');
SELECT throws_ok('SELECT * FROM public.dashboard_g12_ranking()', '42501', NULL,
  'RN-09: sem cadastro de membro, dashboard_g12_ranking → 42501');
RESET ROLE;

-- Membro sem função (Rafael).
SELECT pg_temp.login(9);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT * FROM public.dashboard_summary()', '42501', NULL,
  'RN-09: membro sem função, dashboard_summary → 42501');
SELECT throws_ok('SELECT * FROM public.dashboard_cells_by_type()', '42501', NULL,
  'RN-09: membro sem função, dashboard_cells_by_type → 42501');
SELECT throws_ok('SELECT * FROM public.dashboard_g12_ranking()', '42501', NULL,
  'RN-09: membro sem função, dashboard_g12_ranking → 42501');
RESET ROLE;

-- Só view_own_ministry_dashboard (Gil, sem permissão de ver membros).
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT lives_ok('SELECT * FROM public.dashboard_summary()',
  'RN-09: só com view_own_ministry_dashboard, dashboard_summary responde');
SELECT is((SELECT members_total FROM public.dashboard_summary()), 1::bigint,
  'RN-09: só com view_own_ministry_dashboard, os números seguem o escopo dele (só o próprio cadastro)');
SELECT lives_ok('SELECT * FROM public.dashboard_cells_by_type()',
  'RN-09: só com view_own_ministry_dashboard, dashboard_cells_by_type responde');
SELECT is_empty('SELECT * FROM public.dashboard_g12_ranking()',
  'RN-09: só com view_own_ministry_dashboard, dashboard_g12_ranking responde (vazio: não vê nenhum G12)');
RESET ROLE;

-- ===========================================================================
-- 7. RN-05: paridade por persona — 12 verificações por persona (84)
-- ===========================================================================
-- P1 sistema (view_members)
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('P1', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.summary_parity('P1 hoje', now());
SELECT * FROM pg_temp.lists_parity('P1');
RESET ROLE;

-- P2 igreja toda (view_all_church)
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('P2', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.summary_parity('P2 hoje', now());
SELECT * FROM pg_temp.lists_parity('P2');
RESET ROLE;

-- P3 ministério (view_own_ministry + view_dashboard)
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('P3', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.summary_parity('P3 hoje', now());
SELECT * FROM pg_temp.lists_parity('P3');
RESET ROLE;

-- P3 com view_own_ministry_dashboard (Nina, ministério A)
SELECT pg_temp.login(10);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('P3 dashboard do ministério', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.summary_parity('P3 dashboard do ministério hoje', now());
SELECT * FROM pg_temp.lists_parity('P3 dashboard do ministério');
RESET ROLE;

-- P4 relatórios (view_all_reports, sem ver membros)
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('P4', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.summary_parity('P4 hoje', now());
SELECT * FROM pg_temp.lists_parity('P4');
RESET ROLE;

-- P5 básico (só view_dashboard)
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('P5', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.summary_parity('P5 hoje', now());
SELECT * FROM pg_temp.lists_parity('P5');
RESET ROLE;

-- Só view_own_ministry_dashboard (Gil)
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('Só dashboard do ministério', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.summary_parity('Só dashboard do ministério hoje', now());
SELECT * FROM pg_temp.lists_parity('Só dashboard do ministério');
RESET ROLE;

-- ===========================================================================
-- 8. P1 por diferença: sem liderança (pastor fora) e RN-02 acima de 1000
-- ===========================================================================
CREATE TEMP TABLE p1_before (
  week_start date, week_end date, reports_sent bigint, cells_pending bigint, visitors bigint,
  cells_not_held bigint, members_total bigint, members_active bigint, members_inactive bigint,
  members_baptized bigint, members_not_baptized bigint, members_without_leader bigint,
  members_without_cell_link bigint);
CREATE TEMP TABLE p1_after (LIKE pg_temp.p1_before);
CREATE TEMP TABLE p1_types_before (total numeric);
GRANT SELECT, INSERT ON pg_temp.p1_before, pg_temp.p1_after, pg_temp.p1_types_before TO authenticated;

SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.p1_before SELECT * FROM public.dashboard_summary('2026-03-04 12:00-03');
INSERT INTO pg_temp.p1_types_before SELECT coalesce(sum(total), 0) FROM public.dashboard_cells_by_type();
RESET ROLE;

-- Sem líder: um pastor ativo, um não pastor ativo e um não pastor inativo.
-- Mais 1.100 membros, 1.100 células e 1.100 relatórios em W (RN-02).
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, is_baptized) VALUES
  (pg_temp.m(40), 'Pastor Sem Líder',     'M', true, NULL, false, true,  true),
  (pg_temp.m(41), 'Membro Sem Líder',     'F', false, NULL, false, true,  false),
  (pg_temp.m(42), 'Inativo Sem Líder',    'M', false, NULL, false, false, false);
-- As células de volume são de segunda 20:00: na quarta ao meio-dia já estariam
-- pendentes, se não fosse o relatório de quarta.
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, is_baptized)
SELECT pg_temp.m(1000 + n), 'Volume ' || n, 'F', pg_temp.m(19), true, true, true FROM generate_series(1, 1100) n;
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active)
SELECT pg_temp.c(1000 + n), pg_temp.m(1000 + n), pg_temp.m(1000 + n), pg_temp.m(1000 + n),
       'Evangelística', 'Segunda', '20:00', true FROM generate_series(1, 1100) n;
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, visitors, was_held)
SELECT pg_temp.r(1000 + n), pg_temp.c(1000 + n), '2026-03-04', '20:00', 'Volume', ARRAY['V'], true
  FROM generate_series(1, 1100) n;
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();
-- E2.09 (DA-5): células inseridas em replica ganham o histórico pelo backfill (contam a partir de agora).
SELECT private.backfill_cell_active_periods();

-- Os conjuntos da paridade, recalculados com o volume.
TRUNCATE pg_temp.linked_members, pg_temp.cell_last_report;
INSERT INTO pg_temp.linked_members
SELECT leader_id FROM public.cells WHERE leader_id IS NOT NULL AND deleted_at IS NULL
UNION SELECT timothy_id FROM public.cells WHERE timothy_id IS NOT NULL AND deleted_at IS NULL
UNION SELECT host_id FROM public.cells WHERE host_id IS NOT NULL AND deleted_at IS NULL
UNION SELECT p.member_id
        FROM public.cell_report_participants p
        JOIN public.cell_reports r ON r.id = p.report_id
       WHERE r.date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 30
         AND r.deleted_at IS NULL;
INSERT INTO pg_temp.cell_last_report
SELECT cell_id, max(date) FROM public.cell_reports WHERE deleted_at IS NULL GROUP BY cell_id;

SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.p1_after SELECT * FROM public.dashboard_summary('2026-03-04 12:00-03');

-- 7 verificações
SELECT is((SELECT a.members_without_leader - b.members_without_leader FROM pg_temp.p1_after a, pg_temp.p1_before b),
  1::bigint, 'RN-08/P1: sem liderança +1: só o não pastor ativo (pastor e inativo ficam fora)');
SELECT is((SELECT a.members_without_cell_link - b.members_without_cell_link FROM pg_temp.p1_after a, pg_temp.p1_before b),
  1::bigint, 'RN-08c/P1: sem vínculo celular +1: o pastor fica fora; os 1.100 líderes novos têm vínculo');
SELECT is(
  (SELECT ARRAY[a.members_total - b.members_total, a.members_active - b.members_active,
                a.members_inactive - b.members_inactive, a.members_baptized - b.members_baptized,
                a.members_not_baptized - b.members_not_baptized]
     FROM pg_temp.p1_after a, pg_temp.p1_before b),
  ARRAY[1103, 1102, 1, 1101, 2]::bigint[],
  'RN-02/P1: membros +1.103 (ativos +1.102, inativos +1, batizados +1.101, não batizados +2), sem corte em 1000');
SELECT is(
  (SELECT ARRAY[a.reports_sent - b.reports_sent, a.visitors - b.visitors, a.cells_pending - b.cells_pending]
     FROM pg_temp.p1_after a, pg_temp.p1_before b),
  ARRAY[1100, 1100, 0]::bigint[],
  'RN-02/P1: relatórios da semana +1.100 e visitantes +1.100; as 1.100 células com relatório não ficam pendentes');
SELECT is((SELECT coalesce(sum(total), 0) FROM public.dashboard_cells_by_type()) - (SELECT total FROM pg_temp.p1_types_before),
  1100::numeric, 'RN-02/P1: células por tipo +1.100');
SELECT is((SELECT sum(total) FROM public.dashboard_cells_by_type()), (SELECT count(*) FROM public.cells)::numeric,
  'RN-02/P1: a soma das células por tipo é o total de células, acima de 1000');
SELECT cmp_ok((SELECT members_total FROM public.dashboard_summary()), '>', 1000::bigint,
  'RN-02/P1: o total de membros passa de 1000');
RESET ROLE;

-- A paridade continua valendo com o volume (P1 e P3) — 16 verificações
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('P1 com volume', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.lists_parity('P1 com volume');
RESET ROLE;

SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.summary_parity('P3 com volume', '2026-03-07 23:59-03');
SELECT * FROM pg_temp.lists_parity('P3 com volume');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
