-- E2.06 (PR 1, migration 2) — Leitura pela tabela de hierarquia.
-- Ver docs/specs/e2-06-hierarquia-totais.md no repositório apps-mci
-- ("Leitura (migration 2)", "Árvore de Ministérios", "Contratos"; RN-04,
-- RN-09, RN-10, RN-11; DA-3 a DA-5; DT-11 a DT-13).
--
-- 1. members_view: o nível e os totais vêm de private.member_hierarchy (nível
--    nulo para quem está sem liderança); no fim, g12_id e g12_name (nome de
--    referência do G12, sem filtro de escopo, AQ-1). O WHERE não muda.
-- 2. cells_view: o nível do líder e o G12 vêm da tabela nova, no lugar da
--    subida recursiva da DT-25 do E2.02. Nenhuma coluna nova.
--    As duas continuam security definer com security_barrier, donas postgres,
--    só com SELECT para authenticated; colunas existentes iguais e na mesma
--    ordem (risco 5 do E1.08). As junções com private.member_hierarchy usam o
--    privilégio da dona da view.
-- 3. ministry_tree_nodes: retorno novo (DROP e CREATE), SECURITY DEFINER para
--    ler a cadeia; quem aparece continua decidido pela members_view de quem
--    consulta (auth.uid()), e a cadeia só é lida para ids que vieram dela e
--    não sai na resposta (DT-13, risco 7). EXECUTE só para authenticated.
--
-- Pode rodar de novo sem erro: CREATE OR REPLACE VIEW, DROP FUNCTION IF EXISTS
-- antes do CREATE, grants idempotentes.

DO $$
BEGIN
  IF to_regclass('private.member_hierarchy') IS NULL
     OR to_regprocedure('public.viewer_tree_roots()') IS NULL THEN
    RAISE EXCEPTION 'E2.06 (migration 2) depende da migration 1 do E2.06 e do PR 1 do E2.02.';
  END IF;
END $$;

-- ===========================================================================
-- 1. members_view (a do E2.02, migration 5, com a tabela nova)
-- ===========================================================================
CREATE OR REPLACE VIEW public.members_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  m.id,
  m.name,
  m.gender,
  m.birth_date,
  m.instagram,
  m.avatar_url,
  m.notes,
  m.neighborhood,
  m.city,
  m.state,
  m.is_pastor,
  m.has_leadership,
  m.leader_id,
  l.name AS leader_name,
  m.spouse_id,
  m.is_baptized,
  m.baptism_date,
  m.is_active,
  hr.g12_level,
  coalesce(hr.total_disciples, 0) AS total_disciples,
  coalesce(hr.total_cells, 0) AS total_cells,
  coalesce(hr.male_cells, 0) AS male_cells,
  coalesce(hr.female_cells, 0) AS female_cells,
  CASE WHEN s.role_visible THEN m.role_id END AS role_id,
  m.auth_user_id,
  m.created_at,
  m.updated_at,
  s.sensitive_visible,
  CASE WHEN s.sensitive_visible THEN m.email END AS email,
  CASE WHEN s.sensitive_visible THEN m.cpf END AS cpf,
  CASE WHEN s.sensitive_visible THEN m.mobile_whatsapp END AS mobile_whatsapp,
  CASE WHEN s.sensitive_visible THEN m.phone END AS phone,
  CASE WHEN s.sensitive_visible THEN m.street END AS street,
  CASE WHEN s.sensitive_visible THEN m.number END AS number,
  CASE WHEN s.sensitive_visible THEN m.complement END AS complement,
  CASE WHEN s.sensitive_visible THEN m.zip_code END AS zip_code,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.leader_id = m.id AND c.deleted_at IS NULL) AS is_cell_leader,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.timothy_id = m.id AND c.deleted_at IS NULL) AS is_cell_timothy,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.host_id = m.id AND c.deleted_at IS NULL) AS is_cell_host,
  m.id IN (
    SELECT p.member_id
      FROM public.cell_report_participants p
      JOIN public.cell_reports r ON r.id = p.report_id
     WHERE r.date >= public.sp_today() - 30
       AND r.deleted_at IS NULL
  ) AS attended_last_30_days,
  public.search_normalize(concat_ws(' ',
    m.name,
    CASE WHEN s.sensitive_visible THEN m.email END,
    CASE WHEN s.sensitive_visible THEN m.cpf END,
    CASE WHEN s.sensitive_visible THEN regexp_replace(m.cpf, '\D', '', 'g') END
  )) AS search_text,
  sp.name AS spouse_name,
  -- E2.06, no fim (AQ-1, RN-10): o G12 da pessoa, como nome de referência.
  hr.g12_id,
  g12.name AS g12_name
FROM public.members m
LEFT JOIN public.members l ON l.id = m.leader_id
LEFT JOIN public.members sp ON sp.id = m.spouse_id
LEFT JOIN private.member_hierarchy hr ON hr.member_id = m.id
LEFT JOIN public.members g12 ON g12.id = hr.g12_id
CROSS JOIN LATERAL (
  SELECT coalesce(m.auth_user_id = (SELECT auth.uid()), false)
      OR (SELECT public.viewer_has('view_sensitive_data'::public.permission_action)) AS sensitive_visible,
         m.id = (SELECT public.viewer_member_id())
      OR (SELECT public.viewer_has('assign_role'::public.permission_action))
      OR (SELECT public.viewer_has('manage_roles'::public.permission_action)) AS role_visible
) s
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND m.id IN (SELECT public.viewer_ministry_member_ids()) )
  OR m.id = (SELECT public.viewer_member_id())
)
AND m.deleted_at IS NULL;   -- espelhado em "Members view policy"
-- Consolidação: o filtro ou a coluna do consolidado entra aqui.

ALTER VIEW public.members_view OWNER TO postgres;
REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;

-- ===========================================================================
-- 2. cells_view (a do E2.02, migration 3, com a tabela nova; DT-12)
-- ===========================================================================
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
  lhr.g12_level AS leader_g12_level,
  t.name AS timothy_name,
  h.name AS host_name,
  lhr.g12_id AS g12_leader_id,
  g12.name AS g12_leader_name,
  (SELECT max(r.date) FROM public.cell_reports r WHERE r.cell_id = c.id AND r.deleted_at IS NULL) AS last_report_date,
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name, ll.name, tl.name, hl.name, c.street, c.neighborhood
  )) AS search_text,
  (    (SELECT public.viewer_has('edit_cell'::public.permission_action))
    OR (SELECT public.viewer_has('submit_any_visible_report'::public.permission_action))
    OR (     (SELECT public.viewer_has('submit_own_cell_report'::public.permission_action))
         AND coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false))
  ) AS can_submit_report,
  coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false) AS is_mine,
  coalesce(l.is_pastor, false) AS leader_is_pastor
FROM public.cells c
LEFT JOIN public.members l ON l.id = c.leader_id
LEFT JOIN public.members t ON t.id = c.timothy_id
LEFT JOIN public.members h ON h.id = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
LEFT JOIN private.member_hierarchy lhr ON lhr.member_id = c.leader_id
LEFT JOIN public.members g12 ON g12.id = lhr.g12_id
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND (   c.leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR c.leader_id = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
  OR c.host_id = (SELECT public.viewer_member_id())
)
AND c.deleted_at IS NULL;   -- espelhado em "Cells view policy"

ALTER VIEW public.cells_view OWNER TO postgres;
REVOKE ALL ON public.cells_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cells_view TO authenticated;

-- ===========================================================================
-- 3. ministry_tree_nodes (RN-09, AQ-3, AQ-4)
--
-- Candidatos (como no E1.08): ativos e visíveis. Nas raízes, as raízes da
-- árvore de quem consulta (com "Visualizar Toda a Igreja", os pastores; sem
-- ela, viewer_tree_roots(), DA-6 do E2.02); senão, os liderados por um dos
-- _parent_ids, fora deles. Até 100 ids, senão 22023.
-- Cônjuge exibível S de um candidato C: ativo, visível e fora de _parent_ids.
-- "S na árvore" (DA-3): S é uma das raízes ou tem uma delas na cadeia.
--
--   | C e S                                         | Resultado                                  |
--   |-----------------------------------------------|--------------------------------------------|
--   | sem S                                         | nó só com C, totais dele                   |
--   | S acima de C, S não é candidato, chamada de   | referência de C (kind = 'spouse_above'),   |
--   | filhos e S na árvore                          | sem totais, direct_disciples = 0           |
--   | S acima de C e fora da árvore (ou nas raízes) | nó só com C, totais dele (DA-4)            |
--   | um acima do outro (S candidato, ou C acima)   | casal; discípulos do de cima − 1, células  |
--   |                                               | do de cima                                 |
--   | ramos diferentes                              | casal; a soma dos dois                     |
--
-- Principal do casal: o homem; empatado, o candidato; depois o menor
-- (nome, id). Nível da posição (UXD-7, DA-5): o de quem é discípulo de um dos
-- _parent_ids (os dois: o principal); nas raízes, o do principal.
-- direct_disciples: o cálculo do E1.08 (a referência conta como discípula
-- direta do líder dela).
-- ===========================================================================
DROP FUNCTION IF EXISTS public.ministry_tree_nodes(uuid[]);

CREATE FUNCTION public.ministry_tree_nodes(_parent_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  member_id uuid,
  member_name text,
  member_gender text,
  g12_level integer,          -- o nível da POSIÇÃO (UXD-7)
  is_pastor boolean,          -- do principal
  spouse_id uuid,
  spouse_name text,
  direct_disciples bigint,    -- decide se o nó abre (E1.08); 0 na referência
  total_disciples integer,    -- RN-09; nulo na referência
  total_cells integer,        -- RN-09; nulo na referência
  kind text,                  -- 'node' | 'spouse_above'
  level_member_id uuid,       -- quem dá o nível da posição
  level_gender text,
  level_is_pastor boolean,
  spouse_is_pastor boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _roots boolean;
  _parents uuid[];
  _church boolean;
  _scope_roots uuid[];
  _tree_roots uuid[];
BEGIN
  IF cardinality(_parent_ids) > 100 THEN
    RAISE EXCEPTION 'No máximo 100 nós por chamada.' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  _roots := _parent_ids IS NULL;
  -- Os nós informados, sem nulos nem repetidos (um NULL no array faria o
  -- "<> ALL" abaixo dar NULL e esconder todo mundo).
  _parents := ARRAY(
    SELECT DISTINCT u.pid FROM unnest(_parent_ids) AS u(pid) WHERE u.pid IS NOT NULL
  );
  IF NOT _roots AND cardinality(_parents) = 0 THEN
    RETURN;
  END IF;
  -- Raízes da árvore de quem consulta: ativas e visíveis.
  _church := public.viewer_has('view_all_church'::public.permission_action);
  _scope_roots := CASE WHEN _church THEN '{}'::uuid[] ELSE public.viewer_tree_roots() END;
  _tree_roots := ARRAY(
    SELECT mv.id
      FROM public.members_view mv
     WHERE mv.is_active
       AND CASE WHEN _church THEN mv.is_pastor ELSE mv.id = ANY (_scope_roots) END
  );

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT mv.id, mv.name, mv.gender, mv.is_pastor, mv.leader_id, mv.spouse_id
      FROM public.members_view mv
     WHERE _roots
       AND mv.is_active
       AND mv.id = ANY (_tree_roots)
    UNION ALL
    SELECT mv.id, mv.name, mv.gender, mv.is_pastor, mv.leader_id, mv.spouse_id
      FROM public.members_view mv
     WHERE NOT _roots
       AND mv.is_active
       AND mv.leader_id = ANY (_parents)
       AND mv.id <> ALL (_parents)
  ),
  spouses AS MATERIALIZED (
    -- O "= ANY (ARRAY(...))", em vez de IN, leva a busca para a chave primária.
    SELECT mv.id, mv.name, mv.gender, mv.is_pastor, mv.leader_id
      FROM public.members_view mv
     WHERE mv.is_active
       AND mv.id = ANY (ARRAY(SELECT c.spouse_id FROM candidates c))
       AND mv.id <> ALL (_parents)
  ),
  people AS MATERIALIZED (
    -- Só ids que vieram da members_view; a cadeia não sai na resposta.
    SELECT p.id, p.name, p.gender, p.is_pastor, p.leader_id,
           coalesce(hr.ancestor_ids, '{}'::uuid[]) AS ancestor_ids,
           hr.g12_level AS lvl,
           coalesce(hr.total_disciples, 0) AS td,
           coalesce(hr.total_cells, 0) AS tc
      FROM (SELECT c.id, c.name, c.gender, c.is_pastor, c.leader_id FROM candidates c
            UNION
            SELECT s.id, s.name, s.gender, s.is_pastor, s.leader_id FROM spouses s) p
      LEFT JOIN private.member_hierarchy hr ON hr.member_id = p.id
  ),
  pairs AS (
    SELECT c.id AS cid,
           s.id AS sid,
           CASE
             WHEN s.id IS NULL THEN 'none'
             WHEN s.id = ANY (pc.ancestor_ids) THEN 'spouse_above'
             WHEN c.id = ANY (ps.ancestor_ids) THEN 'candidate_above'
             ELSE 'branches'
           END AS rel,
           s.id IS NOT NULL AND EXISTS (SELECT 1 FROM candidates c2 WHERE c2.id = s.id) AS s_candidate,
           s.id IS NOT NULL AND (s.id = ANY (_tree_roots) OR ps.ancestor_ids && _tree_roots) AS s_in_tree,
           -- O cônjuge é o principal? O homem primeiro; empatado, o candidato;
           -- empatado de novo, o de menor (nome, id).
           CASE
             WHEN s.id IS NULL THEN false
             WHEN coalesce(s.gender = 'M', false) <> coalesce(c.gender = 'M', false)
               THEN coalesce(s.gender = 'M', false)
             WHEN NOT EXISTS (SELECT 1 FROM candidates c2 WHERE c2.id = s.id) THEN false
             ELSE (s.name, s.id) < (c.name, c.id)
           END AS spouse_first
      FROM candidates c
      LEFT JOIN spouses s ON s.id = c.spouse_id AND s.id <> c.id
      JOIN people pc ON pc.id = c.id
      LEFT JOIN people ps ON ps.id = s.id
  ),
  shaped AS (
    SELECT pr.*,
           CASE
             WHEN pr.rel = 'none' THEN 'alone'
             WHEN pr.rel = 'spouse_above' AND NOT pr.s_candidate THEN
               CASE WHEN NOT _roots AND pr.s_in_tree THEN 'reference' ELSE 'alone' END
             ELSE 'couple'
           END AS shape
      FROM pairs pr
  ),
  nodes AS (
    -- Um nó por casal (ou pessoa); o casal aparece uma vez.
    SELECT DISTINCT ON (x.couple_key)
           x.couple_key, x.principal_id, x.partner_id, x.upper_id
      FROM (
        SELECT CASE WHEN sh.shape = 'couple'
                    THEN least(sh.cid, sh.sid)::text || '|' || greatest(sh.cid, sh.sid)::text
                    ELSE sh.cid::text END AS couple_key,
               CASE WHEN sh.shape = 'couple' AND sh.spouse_first THEN sh.sid ELSE sh.cid END AS principal_id,
               CASE WHEN sh.shape <> 'couple' THEN NULL
                    WHEN sh.spouse_first THEN sh.cid ELSE sh.sid END AS partner_id,
               -- Quem está acima do outro: os totais do casal são os dele (DT-13).
               CASE WHEN sh.shape <> 'couple' THEN NULL
                    WHEN sh.rel = 'spouse_above' THEN sh.sid
                    WHEN sh.rel = 'candidate_above' THEN sh.cid END AS upper_id
          FROM shaped sh
         WHERE sh.shape <> 'reference'
      ) x
     ORDER BY x.couple_key
  ),
  links AS (
    -- Os integrantes de cada nó, um por linha (os líderes dos discípulos
    -- diretos), com o principal e o cônjuge do nó ao lado para a exclusão.
    SELECT n.couple_key, n.principal_id, n.partner_id, n.principal_id AS leader_id
      FROM nodes n
    UNION ALL
    SELECT n.couple_key, n.principal_id, n.partner_id, n.partner_id
      FROM nodes n
     WHERE n.partner_id IS NOT NULL
  ),
  disciples AS MATERIALIZED (
    -- Contagem, etapa 1: os discípulos diretos ativos e visíveis de todos os
    -- integrantes do nível, numa leitura só.
    SELECT d.id, d.leader_id
      FROM public.members_view d
     WHERE d.is_active
       AND d.leader_id = ANY (ARRAY(SELECT l.leader_id FROM links l))
  ),
  node_counts AS MATERIALIZED (
    -- Contagem, etapa 2: cada discípulo vai para o nó do seu líder, menos os
    -- integrantes do próprio nó. O FULL JOIN é de propósito (E1.08): só por
    -- hash ou merge, nunca por laço aninhado.
    SELECT l.couple_key, l.principal_id, l.partner_id,
           count(d.id) FILTER (
             WHERE d.id <> l.principal_id AND d.id IS DISTINCT FROM l.partner_id
           ) AS total
      FROM links l
      FULL JOIN disciples d ON d.leader_id = l.leader_id
     GROUP BY l.couple_key, l.principal_id, l.partner_id
  ),
  out_rows AS (
    SELECT p.id AS r_member_id,
           p.name AS r_member_name,
           p.gender AS r_member_gender,
           lv.lvl AS r_level,
           p.is_pastor AS r_is_pastor,
           o.id AS r_spouse_id,
           o.name AS r_spouse_name,
           nc.total AS r_direct,
           CASE
             WHEN o.id IS NULL THEN p.td
             WHEN n.upper_id IS NOT NULL THEN greatest(u.td - 1, 0)
             ELSE p.td + o.td
           END AS r_total_disciples,
           CASE
             WHEN o.id IS NULL THEN p.tc
             WHEN n.upper_id IS NOT NULL THEN u.tc
             ELSE p.tc + o.tc
           END AS r_total_cells,
           'node'::text AS r_kind,
           lv.id AS r_level_member_id,
           lv.gender AS r_level_gender,
           lv.is_pastor AS r_level_is_pastor,
           o.is_pastor AS r_spouse_is_pastor
      FROM node_counts nc
      JOIN nodes n ON n.couple_key = nc.couple_key
      JOIN people p ON p.id = n.principal_id
      LEFT JOIN people o ON o.id = n.partner_id
      LEFT JOIN people u ON u.id = n.upper_id
      CROSS JOIN LATERAL (
        SELECT CASE
                 WHEN _roots OR o.id IS NULL OR p.leader_id = ANY (_parents) THEN p.id
                 ELSE o.id
               END AS level_id
      ) li
      JOIN people lv ON lv.id = li.level_id
    UNION ALL
    -- Referência: o cônjuge de baixo, embaixo do próprio líder (P-HIE-16).
    SELECT c.id, c.name, c.gender, c.lvl, c.is_pastor,
           s.id, s.name,
           0::bigint, NULL::integer, NULL::integer,
           'spouse_above'::text,
           c.id, c.gender, c.is_pastor, s.is_pastor
      FROM shaped sh
      JOIN people c ON c.id = sh.cid
      JOIN people s ON s.id = sh.sid
     WHERE sh.shape = 'reference'
  )
  SELECT r.r_member_id, r.r_member_name, r.r_member_gender, r.r_level, r.r_is_pastor,
         r.r_spouse_id, r.r_spouse_name, r.r_direct, r.r_total_disciples, r.r_total_cells,
         r.r_kind, r.r_level_member_id, r.r_level_gender, r.r_level_is_pastor, r.r_spouse_is_pastor
    FROM out_rows r
   ORDER BY r.r_member_name, r.r_member_id;
END;
$$;

ALTER FUNCTION public.ministry_tree_nodes(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ministry_tree_nodes(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ministry_tree_nodes(uuid[]) TO authenticated;
