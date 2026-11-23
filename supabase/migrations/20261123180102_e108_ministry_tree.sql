-- E1.08 (PR 4) — Árvore de ministérios calculada no banco.
-- Ver docs/specs/e1-08-paginacao-servidor.md no repositório apps-mci (RN-05 e RN-10).
--
-- ministry_tree_nodes(_parent_ids): os nós (casais) de um nível da árvore, já
-- com as contagens, numa chamada só. Abrir um nó é uma chamada com os ids do
-- casal; abrir a tela é uma chamada sem parâmetro (as raízes).
--
-- Regras (RN-10, MIN-01, MIN-03):
--   - só membros ativos, inclusive o cônjuge exibido;
--   - raízes: os pastores ativos visíveis;
--   - filhos: os membros ativos visíveis liderados por algum dos nós
--     informados, menos os próprios nós (uma esposa liderada pelo marido não
--     reaparece como filha do casal);
--   - cada nó é um casal que aparece uma vez só, com o homem primeiro;
--   - direct_disciples: os discípulos diretos ativos e visíveis do casal, que
--     são exatamente os candidatos da expansão desse casal.
--
-- A função é SECURITY INVOKER e lê só da members_view (PR 1), nunca da tabela:
-- herda o escopo de quem consulta (RN-05), a máscara e, no futuro, a exclusão
-- lógica (E2.01) e a flag de consolidado, sem repetir nenhuma dessas regras
-- aqui. Não há checagem de permissão própria: quem não vê ninguém recebe uma
-- lista vazia. O E2.15 (MIN-02, raízes pelo escopo do usuário) troca só o ramo
-- das raízes.
--
-- Em plpgsql, as colunas de RETURNS TABLE viram variáveis e colidiriam com os
-- nomes de coluna da view (g12_level, is_pastor, spouse_id...). Por isso toda
-- coluna é qualificada com o apelido da tabela.
--
-- Nada de tabela, coluna ou view nova. Só CREATE OR REPLACE FUNCTION e grants:
-- a migration pode rodar de novo sem erro. Os índices usados (members.leader_id
-- e a chave primária) já existem desde o PR 1.

-- ---------------------------------------------------------------------------
-- 1. ministry_tree_nodes
-- ---------------------------------------------------------------------------
-- _parent_ids:
--   - NULL: as raízes;
--   - os ids de um ou mais nós (o integrante principal e o cônjuge de cada
--     um): os filhos desses nós, todos juntos. Ids nulos ou repetidos são
--     ignorados; um array vazio devolve nenhuma linha;
--   - no máximo 100 ids (erro 22023), para a chamada continuar barata.
--
-- Nó:
--   - candidatos: os membros que aparecem no nível (raízes ou filhos);
--   - cônjuge: a linha da members_view com id = spouse_id do candidato, ativa e
--     fora dos nós informados. Se não houver (cônjuge invisível, inativo ou
--     inexistente), o nó fica sozinho e spouse_id e spouse_name saem nulos: o
--     id de quem não é visível não sai daqui. A reciprocidade do spouse_id não
--     é exigida (mesmo critério do dashboard_g12_ranking); o trigger
--     sync_spouse_relationship mantém o vínculo simétrico. Com um vínculo
--     assimétrico, um membro pode aparecer em dois nós do mesmo nível;
--   - chave do casal: "<menor id>|<maior id>", ou só o id sem cônjuge. Quando
--     os dois são candidatos, as duas linhas de partida geram a mesma chave e o
--     DISTINCT ON fica com uma;
--   - integrante principal (member_*, g12_level, is_pastor): o homem, quando
--     só um dos dois é homem; empatado, o que é candidato, quando só um dos
--     dois é; empatado de novo, o de menor (nome, id). A regra não depende da
--     linha de partida, então as duas linhas do mesmo casal concordam.
--
-- Contagens:
--   - direct_disciples: membros ativos e visíveis liderados pelo principal ou
--     pelo cônjuge do nó, menos os próprios integrantes. É o mesmo predicado dos
--     candidatos: se for maior que zero, expandir o nó com [member_id,
--     spouse_id] devolve ao menos um nó. Uma única leitura da members_view para
--     todos os nós do nível (sem N+1);
--   - total_disciples e total_cells: a soma dos totais guardados do principal e
--     do cônjuge (refresh_member_stats_v2), que são subárvores disjuntas. A
--     exceção é o casal em que um lidera o outro diretamente: a subárvore do
--     líder já contém o liderado e a subárvore dele, então valem só os totais
--     do líder, sem contar o liderado como discípulo do próprio casal.
--     Limite conhecido: um aninhamento indireto (o cônjuge abaixo de um
--     discípulo do outro) ainda soma em dobro; o caminho materializado do
--     E2.06 permite corrigir.
--
-- Ordem: nome do principal, depois member_id.
CREATE OR REPLACE FUNCTION public.ministry_tree_nodes(_parent_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  member_id uuid,
  member_name text,
  member_gender text,
  g12_level integer,
  is_pastor boolean,
  spouse_id uuid,
  spouse_name text,
  direct_disciples bigint,
  total_disciples integer,
  total_cells integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _roots boolean;
  _parents uuid[];
BEGIN
  IF cardinality(_parent_ids) > 100 THEN
    RAISE EXCEPTION 'No máximo 100 nós por chamada.' USING ERRCODE = '22023';
  END IF;

  _roots := _parent_ids IS NULL;
  -- Os nós informados, sem nulos nem repetidos (um NULL no array faria o
  -- "<> ALL" abaixo dar NULL e esconder todo mundo).
  _parents := ARRAY(
    SELECT DISTINCT pid FROM unnest(_parent_ids) AS u(pid) WHERE pid IS NOT NULL
  );

  IF NOT _roots AND cardinality(_parents) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    -- Raízes: os pastores. O E2.15 (MIN-02) troca só este ramo.
    SELECT mv.id, mv.name, mv.gender, mv.g12_level, mv.is_pastor, mv.leader_id,
           mv.spouse_id, mv.total_disciples, mv.total_cells
      FROM public.members_view mv
     WHERE _roots
       AND mv.is_active
       AND mv.is_pastor
    UNION ALL
    -- Filhos: liderados por algum nó informado, menos os próprios nós.
    SELECT mv.id, mv.name, mv.gender, mv.g12_level, mv.is_pastor, mv.leader_id,
           mv.spouse_id, mv.total_disciples, mv.total_cells
      FROM public.members_view mv
     WHERE NOT _roots
       AND mv.is_active
       AND mv.leader_id = ANY (_parents)
       AND mv.id <> ALL (_parents)
  ),
  spouses AS MATERIALIZED (
    -- Os cônjuges exibíveis dos candidatos (MIN-03). O "= ANY (ARRAY(...))",
    -- em vez de IN, vira um parâmetro e leva a busca para a chave primária.
    SELECT mv.id, mv.name, mv.gender, mv.g12_level, mv.is_pastor, mv.leader_id,
           mv.total_disciples, mv.total_cells
      FROM public.members_view mv
     WHERE mv.is_active
       AND mv.id = ANY (ARRAY(SELECT c.spouse_id FROM candidates c))
       AND mv.id <> ALL (_parents)
  ),
  people AS (
    SELECT c.id, c.name, c.gender, c.g12_level, c.is_pastor, c.leader_id,
           c.total_disciples, c.total_cells
      FROM candidates c
    UNION
    SELECT s.id, s.name, s.gender, s.g12_level, s.is_pastor, s.leader_id,
           s.total_disciples, s.total_cells
      FROM spouses s
  ),
  pairs AS (
    -- Uma linha por candidato, com o casal já ordenado.
    SELECT
      CASE
        WHEN s.id IS NULL THEN c.id::text
        ELSE least(c.id, s.id)::text || '|' || greatest(c.id, s.id)::text
      END AS couple_key,
      -- O cônjuge é o principal? O homem primeiro; empatado, o candidato;
      -- empatado de novo, o de menor (nome, id).
      CASE
        WHEN s.id IS NULL THEN false
        WHEN coalesce(s.gender = 'M', false) <> coalesce(c.gender = 'M', false)
          THEN coalesce(s.gender = 'M', false)
        WHEN NOT EXISTS (SELECT 1 FROM candidates c2 WHERE c2.id = s.id) THEN false
        ELSE (s.name, s.id) < (c.name, c.id)
      END AS spouse_first,
      c.id AS candidate_id,
      s.id AS partner_id
    FROM candidates c
    LEFT JOIN spouses s ON s.id = c.spouse_id AND s.id <> c.id
  ),
  nodes AS (
    SELECT DISTINCT ON (pr.couple_key)
      pr.couple_key,
      CASE WHEN pr.spouse_first THEN pr.partner_id ELSE pr.candidate_id END AS principal_id,
      CASE WHEN pr.spouse_first THEN pr.candidate_id ELSE pr.partner_id END AS partner_id
    FROM pairs pr
    ORDER BY pr.couple_key
  ),
  links AS (
    -- Os integrantes de cada nó, um por linha (os líderes dos discípulos diretos).
    SELECT n.couple_key, n.principal_id AS leader_id FROM nodes n
    UNION ALL
    SELECT n.couple_key, n.partner_id FROM nodes n WHERE n.partner_id IS NOT NULL
  ),
  disciples AS (
    -- Uma leitura só para todos os nós do nível. O "= ANY (ARRAY(...))"
    -- repete o join de propósito: leva a busca para o índice de leader_id, em
    -- vez de varrer a members_view inteira.
    SELECT l.couple_key, count(*) AS total
      FROM links l
      JOIN nodes n ON n.couple_key = l.couple_key
      JOIN public.members_view d ON d.leader_id = l.leader_id
     WHERE d.is_active
       AND d.leader_id = ANY (ARRAY(SELECT l2.leader_id FROM links l2))
       AND d.id <> n.principal_id
       AND d.id IS DISTINCT FROM n.partner_id
     GROUP BY l.couple_key
  )
  SELECT
    p.id,
    p.name,
    p.gender,
    p.g12_level,
    p.is_pastor,
    o.id,
    o.name,
    coalesce(dc.total, 0),
    CASE
      WHEN o.id IS NULL THEN coalesce(p.total_disciples, 0)
      -- Um lidera o outro: só o líder, sem contar o liderado como discípulo.
      WHEN o.leader_id = p.id THEN greatest(coalesce(p.total_disciples, 0) - 1, 0)
      WHEN p.leader_id = o.id THEN greatest(coalesce(o.total_disciples, 0) - 1, 0)
      ELSE coalesce(p.total_disciples, 0) + coalesce(o.total_disciples, 0)
    END,
    CASE
      WHEN o.id IS NULL THEN coalesce(p.total_cells, 0)
      WHEN o.leader_id = p.id THEN coalesce(p.total_cells, 0)
      WHEN p.leader_id = o.id THEN coalesce(o.total_cells, 0)
      ELSE coalesce(p.total_cells, 0) + coalesce(o.total_cells, 0)
    END
  FROM nodes n
  JOIN people p ON p.id = n.principal_id
  LEFT JOIN people o ON o.id = n.partner_id
  LEFT JOIN disciples dc ON dc.couple_key = n.couple_key
  ORDER BY p.name, p.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Grants
-- ---------------------------------------------------------------------------
-- O Supabase concede EXECUTE a anon por default privileges: o REVOKE explícito
-- deixa a função só para usuários logados.
REVOKE EXECUTE ON FUNCTION public.ministry_tree_nodes(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ministry_tree_nodes(uuid[]) TO authenticated;
