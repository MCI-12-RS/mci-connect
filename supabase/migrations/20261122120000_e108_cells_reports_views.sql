-- E1.08 (PR 2) — Leitura de células, relatórios e participantes no servidor.
-- Ver docs/specs/e1-08-paginacao-servidor.md no repositório apps-mci.
--
-- 1. cells_view: a leitura de células do front. Mesmo escopo da política de
--    SELECT de cells, nomes do líder, do timóteo e do anfitrião, o G12 da
--    célula, a data do último relatório e a coluna de busca.
-- 2. cell_reports_view: a leitura de relatórios. Mesmo escopo efetivo da
--    política de SELECT de cell_reports, com os dados da célula, as contagens
--    de visitantes e de participantes e a coluna de busca.
-- 3. cell_report_participants_view: os participantes de cada relatório, com o
--    nome, no escopo do relatório.
-- 4. Índices para as listas e para as colunas calculadas.
--
-- Nenhuma função nova: as views usam viewer_has, viewer_member_id,
-- viewer_ministry_member_ids, get_ministry_root, search_normalize,
-- weekday_index e week_start, todas com EXECUTE só para authenticated.
--
-- Como na members_view (PR 1), as views rodam com os privilégios do dono
-- (postgres) e não passam pelo RLS das tabelas: o WHERE de cada uma repete a
-- política de SELECT da tabela. O alerta "security_definer_view" do Supabase é
-- esperado; trocar para security_invoker faria as views encolherem ou
-- divergirem das políticas. As subconsultas sem correlação, (SELECT ...),
-- viram InitPlan (permissões avaliadas uma vez por consulta), e o
-- security_barrier impede que filtros enviados pelo cliente rodem antes do
-- filtro de escopo.
--
-- Colunas calculadas caras (g12_leader_id, g12_leader_name, last_report_date e
-- participants_count) são subconsultas escalares na lista do SELECT, e não
-- LATERAL: o planejador as descarta quando a consulta não as usa (por exemplo,
-- no count das listas).
--
-- O CREATE OR REPLACE VIEW só acrescenta colunas no fim. Mudar o tipo ou a
-- ordem de uma coluna exige DROP e CREATE, e a cell_report_participants_view
-- depende da cell_reports_view.

-- ---------------------------------------------------------------------------
-- 1. cells_view
-- ---------------------------------------------------------------------------
-- WHERE: espelho da política "Cells view policy".
--   - is_in_same_ministry(auth.uid(), x) vira x IN viewer_ministry_member_ids();
--   - can_manage_own_cell(auth.uid(), id) vira "líder ou timóteo é quem
--     consulta" (members.auth_user_id é único).
-- Nomes de referência (RN-06): líder, timóteo, anfitrião e G12 aparecem pelo
-- nome mesmo fora do escopo de quem consulta.
CREATE OR REPLACE VIEW public.cells_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  c.id,
  c.leader_id,
  c.timothy_id,
  c.host_id,
  c.type,
  c.meeting_day,
  c.meeting_time,
  c.street,
  c.number,
  c.complement,
  c.neighborhood,
  c.city,
  c.state,
  c.zip_code,
  c.is_active,
  c.created_at,
  c.updated_at,
  public.weekday_index(c.meeting_day) AS meeting_weekday,
  l.name AS leader_name,
  l.gender AS leader_gender,
  l.g12_level AS leader_g12_level,
  t.name AS timothy_name,
  h.name AS host_name,
  -- G12 da célula: o ancestral de nível 1 do líder. Nulo para líder pastor
  -- (a tela mostra "Pastores" quando leader_g12_level = 0) ou sem G12.
  -- E2.06: trocar pelo caminho de liderança materializado, sem mudar o contrato.
  (SELECT public.get_ministry_root(c.leader_id)) AS g12_leader_id,
  (SELECT g.name
     FROM public.members g
    WHERE g.id = public.get_ministry_root(c.leader_id)) AS g12_leader_name,
  -- Último relatório da célula, visível ou não para quem consulta (base do
  -- E2.09, CEL-05). E2.01: ignorar os relatórios excluídos.
  (SELECT max(r.date)
     FROM public.cell_reports r
    WHERE r.cell_id = c.id) AS last_report_date,
  -- E2.09: a coluna report_status entra no fim da lista, depois de search_text,
  -- calculada a partir de last_report_date, meeting_weekday e meeting_time,
  -- com sp_now().
  -- Busca (RN-04): nomes do líder, do timóteo, do anfitrião e do líder de cada
  -- um dos três, mais rua e bairro.
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name,
    ll.name, tl.name, hl.name,
    c.street, c.neighborhood
  )) AS search_text
FROM public.cells c
LEFT JOIN public.members l  ON l.id  = c.leader_id
LEFT JOIN public.members t  ON t.id  = c.timothy_id
LEFT JOIN public.members h  ON h.id  = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (SELECT public.viewer_has('view_members'::public.permission_action))
  OR (
       (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND (
            c.leader_id  IN (SELECT public.viewer_ministry_member_ids())
         OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
         OR c.host_id    IN (SELECT public.viewer_ministry_member_ids())
       )
     )
  OR c.leader_id  = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
);
-- E2.01: AND c.deleted_at IS NULL (fora dos parênteses do escopo).

-- Só leitura, e só para usuários logados. Uma escrita pela view rodaria como o
-- dono, passando por cima do RLS.
REVOKE ALL ON public.cells_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cells_view TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. cell_reports_view
-- ---------------------------------------------------------------------------
-- WHERE: espelho do comportamento EFETIVO da política "Cell reports view
-- policy". Os ramos dela que consultam cells num EXISTS passam pelo RLS de
-- cells, e com isso:
--   - view_own_reports não acrescenta nada além da própria célula (que já
--     entra pelo ramo de líder ou timóteo); a correção fica para o E2.02
--     (AUT-03);
--   - view_own_ministry vale para o líder e o timóteo da célula, não para o
--     anfitrião.
-- O join é com a tabela cells, e não com a cells_view: o relatório de uma
-- célula excluída continua no histórico (DEL-07).
CREATE OR REPLACE VIEW public.cell_reports_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  r.id,
  r.cell_id,
  r.date,
  r.time,
  r.theme,
  r.observations,
  r.visitors,
  r.offering,
  r.was_held,
  r.reason_not_held,
  r.created_at,
  r.updated_at,
  public.week_start(r.date) AS week_start,
  coalesce(cardinality(r.visitors), 0) AS visitors_count,
  (SELECT count(*)
     FROM public.cell_report_participants p
    WHERE p.report_id = r.id) AS participants_count,
  -- Dados atuais da célula.
  -- E2.11/E4.02: exibir o snapshot do relatório (REL-09) em vez dos dados
  -- atuais da célula.
  c.type AS cell_type,
  c.is_active AS cell_is_active,
  c.leader_id AS cell_leader_id,
  cl.name AS cell_leader_name,
  c.timothy_id AS cell_timothy_id,
  c.host_id AS cell_host_id,
  c.street AS cell_street,
  c.number AS cell_number,
  c.complement AS cell_complement,
  c.neighborhood AS cell_neighborhood,
  c.meeting_day AS cell_meeting_day,
  c.meeting_time AS cell_meeting_time,
  -- Busca (RN-04): nome do líder da célula e tema.
  public.search_normalize(concat_ws(' ', cl.name, r.theme)) AS search_text
FROM public.cell_reports r
JOIN public.cells c ON c.id = r.cell_id
LEFT JOIN public.members cl ON cl.id = c.leader_id
WHERE (
     (SELECT public.viewer_has('view_all_reports'::public.permission_action))
  OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (SELECT public.viewer_has('view_members'::public.permission_action))
  OR c.leader_id  = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
  OR (
       (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND (
            c.leader_id  IN (SELECT public.viewer_ministry_member_ids())
         OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
       )
     )
);
-- E2.01: AND r.deleted_at IS NULL (fora dos parênteses do escopo).

REVOKE ALL ON public.cell_reports_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_view TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. cell_report_participants_view
-- ---------------------------------------------------------------------------
-- O escopo vem da cell_reports_view: a política "Participants view policy",
-- no efeito, libera os participantes dos relatórios que quem consulta vê.
-- O nome vem da tabela members (só o nome, RN-06), mesmo que o participante
-- esteja fora do escopo. E2.01: membros excluídos continuam aparecendo aqui,
-- porque é histórico.
CREATE OR REPLACE VIEW public.cell_report_participants_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  p.report_id,
  p.member_id,
  m.name AS member_name
FROM public.cell_report_participants p
JOIN public.cell_reports_view r ON r.id = p.report_id
LEFT JOIN public.members m ON m.id = p.member_id;

REVOKE ALL ON public.cell_report_participants_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_report_participants_view TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Índices
-- ---------------------------------------------------------------------------
-- cells(leader_id|timothy_id|host_id) e cell_reports(date DESC, id) já vêm do
-- PR 1. (report_id, member_id) é a PK de cell_report_participants e atende o
-- participants_count e a leitura por relatório. E2.01 troca por índices
-- parciais WHERE deleted_at IS NULL onde couber.
-- last_report_date e os relatórios de uma célula:
CREATE INDEX IF NOT EXISTS cell_reports_cell_id_date_idx
  ON public.cell_reports (cell_id, date DESC);
-- Participações de um membro (vínculo celular da members_view):
CREATE INDEX IF NOT EXISTS cell_report_participants_member_id_idx
  ON public.cell_report_participants (member_id);
