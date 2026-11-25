-- E2.04 (PR 1, migration 1) — Funções de regra do cadastro de membro e
-- unicidade de e-mail, celular e CPF.
-- Ver docs/specs/e2-04-validacoes-membro.md no repositório apps-mci ("Funções
-- de regra (migration 1)", "Unicidade (migration 1)", "Seletor de líder com os
-- discípulos (AQ-4)", "Formato dos erros (AQ-1)", "Bloqueios e concorrência";
-- RN-02, RN-04, RN-05, RN-07 a RN-10, RN-13, RN-15; DA-3, DA-5, DA-6, DA-12,
-- DA-13; DT-03, DT-07, DT-09, DT-14, DT-16, DT-18, DT-20).
--
-- Neutra para o front: só acrescenta funções e os três índices únicos. Os
-- triggers que usam as funções, os CHECKs e a guarda das regras do tipo (a)
-- (private.member_rule_violations) chegam na migration 2.
--
-- As mensagens das guardas trazem só ids e nomes de campo ou de regra, nunca
-- e-mail, celular ou CPF: os logs do deploy são públicos.
--
-- Pode rodar de novo sem erro: CREATE OR REPLACE, CREATE UNIQUE INDEX IF NOT
-- EXISTS (com a conferência da definição), guardas em DO e grants.

-- ===========================================================================
-- 0. Pré-requisitos: E1.04 (mobile_match_key, is_valid_cpf), E2.01
--    (normalize_email, _del_raise, restore_member) e E2.02 (viewer_sees_member,
--    check_member_insert, viewer_covers_role). Falha cedo, sem mudar nada.
-- ===========================================================================
DO $$
BEGIN
  IF to_regprocedure('public.mobile_match_key(text)') IS NULL
     OR to_regprocedure('public.normalize_mobile(text)') IS NULL
     OR to_regprocedure('public.is_valid_cpf(text)') IS NULL
     OR to_regprocedure('public.is_placeholder_email(text)') IS NULL
     OR to_regprocedure('public.normalize_email(text)') IS NULL
     OR to_regprocedure('public.normalize_digits(text)') IS NULL
     OR to_regprocedure('public._del_raise(text, text, jsonb)') IS NULL
     OR to_regprocedure('public.restore_member(uuid)') IS NULL
     OR to_regprocedure('public.find_deleted_member_matches(text, text, text)') IS NULL
     OR to_regprocedure('public.viewer_has(public.permission_action)') IS NULL
     OR to_regprocedure('public.viewer_sees_member(uuid)') IS NULL
     OR to_regprocedure('public.viewer_covers_role(uuid)') IS NULL
     OR to_regprocedure('public.check_member_insert(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'E2.04 depende do PR 1 do E1.04, do PR 1 do E2.01 e do PR 1 do E2.02.';
  END IF;
END $$;

-- ===========================================================================
-- 1. Funções de regra (IMMUTABLE: aparecem em CHECKs e índices)
-- ===========================================================================

-- Domínios fictícios (D7, DT-18): a lista única. O E1.06 acrescenta o domínio
-- novo e troca o de geração.
CREATE OR REPLACE FUNCTION public.placeholder_email_domains()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT ARRAY['mci12fakemail.com'] $$;

-- O domínio de geração dos e-mails fictícios.
CREATE OR REPLACE FUNCTION public.placeholder_email_domain()
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT 'mci12fakemail.com' $$;

-- Reescrita do E1.04 com a mesma regra: o domínio é o que vem depois do último
-- "@" do e-mail normalizado. Só a lista passa a vir de placeholder_email_domains().
CREATE OR REPLACE FUNCTION public.is_placeholder_email(_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT coalesce(
           substring(public.normalize_email(_email) FROM '@([^@]*)$')
             = ANY (public.placeholder_email_domains()),
           false)
$$;

-- RN-04 sobre o e-mail já normalizado: sem espaços, um "@", algo antes, e
-- depois dele pelo menos um ponto, com algo antes e depois de cada ponto.
-- DA-3: até 254 caracteres.
CREATE OR REPLACE FUNCTION public.is_valid_email(_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT coalesce(length(_email) <= 254
                  AND _email ~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$', false)
$$;

-- RN-02: espaços das pontas fora; espaços seguidos (tabulação e quebra de
-- linha inclusive) viram um. Vazio vira NULL.
CREATE OR REPLACE FUNCTION public.normalize_person_name(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT nullif(btrim(regexp_replace(coalesce(_name, ''), '[[:space:]]+', ' ', 'g')), '')
$$;

-- RN-02, DA-12: pelo menos duas palavras com alguma letra de qualquer
-- alfabeto. "Ana B." sim; "Ana", "Ana 2" e "Ana ." não.
CREATE OR REPLACE FUNCTION public.is_valid_person_name(_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT (SELECT count(*)
            FROM regexp_split_to_table(public.normalize_person_name(_name), ' ') AS w
           WHERE w ~ '[[:alpha:]]') >= 2
$$;

-- RN-08: e-mail real válido, celular legível (RN-06) ou CPF válido (RN-07).
CREATE OR REPLACE FUNCTION public.member_has_login_identifier(_email text, _mobile text, _cpf text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT coalesce(public.is_valid_email(public.normalize_email(_email))
                  AND NOT public.is_placeholder_email(_email), false)
      OR public.normalize_mobile(_mobile) IS NOT NULL
      OR coalesce(public.is_valid_cpf(public.normalize_digits(_cpf)), false)
$$;

-- RN-15 com o "hoje" como parâmetro: o trigger passa sp_today(), e os testes
-- passam uma data fixa. Devolve NULL, 'birth_date_future' ou
-- 'birth_date_too_old' (DA-13: o calendário do Postgres, 29/02 → 28/02).
CREATE OR REPLACE FUNCTION public.birth_date_problem(_birth date, _today date)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN _birth IS NULL THEN NULL
              WHEN _birth > _today THEN 'birth_date_future'
              WHEN _birth <= (_today - interval '100 years')::date THEN 'birth_date_too_old'
         END
$$;

-- DA-1: e-mail técnico da conta de acesso. Nunca aparece, nunca muda, não
-- serve para entrar.
CREATE OR REPLACE FUNCTION public.member_account_email(_member_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT _member_id::text || '@' || public.placeholder_email_domain() $$;

-- CHECKs, índices e triggers INVOKER rodam com o papel de quem grava
-- (authenticated pela API e service_role): os dois precisam de EXECUTE. anon, não.
REVOKE ALL ON FUNCTION public.placeholder_email_domains() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.placeholder_email_domain() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_placeholder_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_valid_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_person_name(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_valid_person_name(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.member_has_login_identifier(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.birth_date_problem(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.placeholder_email_domains() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.placeholder_email_domain() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_placeholder_email(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_email(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_person_name(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_person_name(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_has_login_identifier(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.birth_date_problem(date, date) TO authenticated, service_role;

-- O e-mail da conta é gerado só pelo servidor (create-user-admin).
REVOKE ALL ON FUNCTION public.member_account_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_account_email(uuid) TO service_role;

-- Guarda da classificação de letras (DA-12, DT-20). Sem ela, a regra do nome
-- recusaria acentos.
DO $$
BEGIN
  IF NOT (    public.is_valid_person_name('Ção Éd')
          AND public.is_valid_person_name('Ana B.')
          AND NOT public.is_valid_person_name('Ana 2')
          AND NOT public.is_valid_person_name('Ana .')) THEN
    RAISE EXCEPTION 'E2.04: o banco não classifica letras acentuadas como letras. Voltar ao architect.';
  END IF;
END $$;

-- ===========================================================================
-- 2. Unicidade (RN-09, DT-03, DA-5, DEL-04)
-- ===========================================================================

-- Guarda: repetidos entre não excluídos, com as mesmas chaves dos índices.
-- A mensagem traz só os campos e os ids.
DO $$
DECLARE
  _dups jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('field', d.field, 'ids', d.ids) ORDER BY d.field, d.ids)
    INTO _dups
    FROM (
      SELECT 'email' AS field, array_agg(m.id ORDER BY m.id) AS ids
        FROM public.members m
       WHERE m.deleted_at IS NULL AND public.normalize_email(m.email) IS NOT NULL
       GROUP BY public.normalize_email(m.email)
      HAVING count(*) > 1
      UNION ALL
      SELECT 'mobile', array_agg(m.id ORDER BY m.id)
        FROM public.members m
       WHERE m.deleted_at IS NULL AND public.mobile_match_key(m.mobile_whatsapp) IS NOT NULL
       GROUP BY public.mobile_match_key(m.mobile_whatsapp)
      HAVING count(*) > 1
      UNION ALL
      SELECT 'cpf', array_agg(m.id ORDER BY m.id)
        FROM public.members m
       WHERE m.deleted_at IS NULL AND public.normalize_digits(m.cpf) IS NOT NULL
       GROUP BY public.normalize_digits(m.cpf)
      HAVING count(*) > 1
    ) d;
  IF _dups IS NOT NULL THEN
    RAISE EXCEPTION 'E2.04: dados repetidos entre cadastros não excluídos: %', _dups;
  END IF;
END $$;

-- O nome de cada índice contém email, mobile ou cpf: a restore_member e o
-- front traduzem o 23505 por ele. mobile_match_key devolve NULL para o celular
-- ilegível, que fica fora da unicidade (DA-5). Os índices de busca do E1.04
-- (members_login_*_idx, sem predicado) ficam: a sign-in e o aviso de excluído
-- procuram excluídos.
CREATE UNIQUE INDEX IF NOT EXISTS members_email_key
  ON public.members (public.normalize_email(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_mobile_key
  ON public.members (public.mobile_match_key(mobile_whatsapp)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_cpf_key
  ON public.members (public.normalize_digits(cpf)) WHERE deleted_at IS NULL;

-- IF NOT EXISTS não confere a definição: um índice antigo com o mesmo nome
-- passaria calado.
DO $$
DECLARE
  _expected constant text[][] := ARRAY[
    ARRAY['members_email_key', 'normalize_email(email)'],
    ARRAY['members_mobile_key', 'mobile_match_key(mobile_whatsapp)'],
    ARRAY['members_cpf_key', 'normalize_digits(cpf)']];
  _i int;
  _def text;
  _unique boolean;
BEGIN
  FOR _i IN 1 .. array_length(_expected, 1) LOOP
    SELECT pg_get_indexdef(i.indexrelid), i.indisunique
      INTO _def, _unique
      FROM pg_index i
     WHERE i.indexrelid = to_regclass('public.' || _expected[_i][1])
       AND i.indrelid = 'public.members'::regclass;
    IF _def IS NULL OR NOT _unique
       OR position(_expected[_i][2] IN _def) = 0
       OR position('WHERE (deleted_at IS NULL)' IN _def) = 0 THEN
      RAISE EXCEPTION 'E2.04: o índice % existe com outra definição.', _expected[_i][1];
    END IF;
  END LOOP;
END $$;

-- Helper da unicidade (DT-07), usado pela restore_member e, na migration 2,
-- pelo trigger de regras. Trava em ordem fixa e devolve os campos em uso por
-- OUTRO cadastro não excluído: subconjunto ordenado de {email, mobile, cpf}.
-- Um valor nulo não é conferido nem travado. As travas duram até o fim da
-- transação e vêm por último na ordem de aquisição (DT-09).
CREATE OR REPLACE FUNCTION public._member_values_in_use(
  _self uuid, _email text, _mobile text, _cpf text, _lock boolean DEFAULT true)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e text := public.normalize_email(_email);
  _m text := public.mobile_match_key(_mobile);
  _c text := public.normalize_digits(_cpf);
  _k text;
  _used text[] := '{}';
BEGIN
  IF _lock THEN
    FOR _k IN
      SELECT x
        FROM unnest(ARRAY['cpf:' || _c, 'email:' || _e, 'mobile:' || _m]) AS x
       WHERE x IS NOT NULL
       ORDER BY x COLLATE "C"
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('member-identifier:' || _k, 0));
    END LOOP;
  END IF;
  -- Comandos novos depois da trava: em READ COMMITTED, enxergam o que a outra
  -- transação gravou. Cada consulta usa o índice único parcial.
  IF _e IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.members o
        WHERE o.deleted_at IS NULL AND o.id IS DISTINCT FROM _self
          AND public.normalize_email(o.email) = _e) THEN
    _used := _used || 'email'::text;
  END IF;
  IF _m IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.members o
        WHERE o.deleted_at IS NULL AND o.id IS DISTINCT FROM _self
          AND public.mobile_match_key(o.mobile_whatsapp) = _m) THEN
    _used := _used || 'mobile'::text;
  END IF;
  IF _c IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.members o
        WHERE o.deleted_at IS NULL AND o.id IS DISTINCT FROM _self
          AND public.normalize_digits(o.cpf) = _c) THEN
    _used := _used || 'cpf'::text;
  END IF;
  RETURN _used;
END;
$$;

-- Interno: só postgres (dono) e service_role, como _del_raise.
REVOKE ALL ON FUNCTION public._member_values_in_use(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._member_values_in_use(uuid, text, text, text, boolean) TO service_role;

-- ===========================================================================
-- 3. Ajustes no E2.01 (DT-14): a chave do 9º dígito
-- ===========================================================================

-- restore_member: a definição do E2.02 (DT-27, DA-7), com o item (e) pelo
-- _member_values_in_use. A conferência (e) vem depois da trava do líder, para
-- seguir a ordem de aquisição (DT-09: linha, líder, identificadores); a ordem
-- das recusas não muda, porque (d) e (a) não recusam.
CREATE OR REPLACE FUNCTION public.restore_member(_member_id uuid)
RETURNS TABLE(restored_without_leader boolean, previous_leader_name text, role_reset_to_default boolean, role_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _m public.members%ROWTYPE;
  _leader record;
  _new_leader uuid;
  _new_has_leadership boolean;
  _new_role uuid;
  _without_leader boolean := false;
  _previous_leader_name text;
  _role_reset boolean := false;
  _fields text[];
  _constraint text;
BEGIN
  IF NOT public.viewer_has('manage_roles'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _member_id IS NULL THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  SELECT * INTO _m FROM public.members m WHERE m.id = _member_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  IF _m.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.members_view v WHERE v.id = _member_id) THEN
      PERFORM public._del_raise('not_deleted', 'Este cadastro não está excluído.', '{"entity": "member"}'::jsonb);
    END IF;
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members_deleted_view v WHERE v.id = _member_id) THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  -- (b) Quem restaura precisa cobrir a função dele (regra da RN-03). Voltar com
  -- a função padrão (função apagada) é livre, como no cadastro (E1.03).
  IF NOT public.viewer_covers_role(_m.role_id) THEN
    PERFORM public._del_raise('restore_role_above', 'Você não tem permissão para restaurar este membro.');
  END IF;
  -- (d) Líder guardado: travado com FOR KEY SHARE. Se ele foi excluído, o
  -- cadastro volta sem líder e com "Tem Liderança?" desligado (DA-3).
  _new_leader := _m.leader_id;
  _new_has_leadership := _m.has_leadership;
  IF _m.leader_id IS NOT NULL THEN
    SELECT l.id, l.name, l.deleted_at
      INTO _leader
      FROM public.members l
     WHERE l.id = _m.leader_id
     FOR KEY SHARE;
    IF NOT FOUND OR _leader.deleted_at IS NOT NULL THEN
      _new_leader := NULL;
      _new_has_leadership := false;
      _without_leader := true;
      _previous_leader_name := _leader.name;
    END IF;
  END IF;
  -- (a) Função apagada: quem tem conta e está sem função volta com a padrão (DA-2).
  _new_role := _m.role_id;
  IF _m.role_id IS NULL AND _m.auth_user_id IS NOT NULL THEN
    _new_role := public.default_role_id();
    _role_reset := _new_role IS NOT NULL;
  END IF;
  -- (e) Outro cadastro não excluído com o mesmo e-mail, celular (com a
  -- equivalência do 9º dígito) ou CPF, sob as travas por valor (DT-07). A
  -- mensagem cita o primeiro, na ordem e-mail, celular, CPF (DA-6 do E2.01).
  _fields := public._member_values_in_use(_member_id, _m.email, _m.mobile_whatsapp, _m.cpf, true);
  IF cardinality(_fields) > 0 THEN
    PERFORM public._del_raise('restore_value_in_use',
      'Não é possível restaurar: outro cadastro já usa este '
        || CASE _fields[1] WHEN 'email' THEN 'e-mail' WHEN 'mobile' THEN 'celular' ELSE 'CPF' END || '.',
      jsonb_build_object('fields', to_jsonb(_fields)));
  END IF;
  -- leader_id sempre no SET: recalcula o nível (compute_g12_level) e os totais.
  -- O cônjuge não volta (RN-05, RN-16 c): a exclusão já o deixou nulo.
  -- Reserva: um caminho sem as travas que grave o mesmo valor antes do commit
  -- esbarra nos índices members_{email,mobile,cpf}_key.
  BEGIN
    UPDATE public.members
       SET deleted_at = NULL,
           deleted_by = NULL,
           leader_id = _new_leader,
           has_leadership = _new_has_leadership,
           role_id = _new_role
     WHERE id = _member_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
    _fields := array_remove(ARRAY[
      CASE WHEN _constraint ILIKE '%email%' THEN 'email' END,
      CASE WHEN _constraint ILIKE '%mobile%' THEN 'mobile' END,
      CASE WHEN _constraint ILIKE '%cpf%' THEN 'cpf' END
    ], NULL);
    IF cardinality(_fields) = 0 THEN
      RAISE;
    END IF;
    PERFORM public._del_raise('restore_value_in_use',
      'Não é possível restaurar: outro cadastro já usa este '
        || CASE _fields[1] WHEN 'email' THEN 'e-mail' WHEN 'mobile' THEN 'celular' ELSE 'CPF' END || '.',
      jsonb_build_object('fields', to_jsonb(_fields)));
  END;
  -- DA-7 (RN-09 c, RN-10): o restaurado precisa continuar visível. Na prática,
  -- só falha para quem não vê a igreja toda quando o líder foi excluído.
  IF NOT public.viewer_sees_member(_member_id) THEN
    PERFORM public._del_raise('pastor_or_no_leadership_requires_church',
      'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.',
      '{"field": "leader_id"}'::jsonb);
  END IF;
  -- (f) A conta volta a funcionar, com a mesma senha.
  IF _m.auth_user_id IS NOT NULL THEN
    PERFORM public._del_resume_access(_member_id);
  END IF;
  restored_without_leader := _without_leader;
  previous_leader_name := _previous_leader_name;
  role_reset_to_default := _role_reset;
  role_name := (SELECT r.name FROM public.roles r WHERE r.id = _new_role);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_member(uuid) TO authenticated;

-- find_deleted_member_matches: a do E2.01, com o celular comparado pela chave
-- do 9º dígito dos dois lados (ponto 3 do PO). Um celular ilegível não procura
-- nada (DA-5), como no login.
CREATE OR REPLACE FUNCTION public.find_deleted_member_matches(_email text, _mobile text, _cpf text)
RETURNS TABLE (
  member_id uuid,
  name text,
  deleted_at timestamptz,
  matched_fields text[],
  is_account_email boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _e text := public.normalize_email(_email);
  _mo text := public.mobile_match_key(_mobile);
  _c text := public.normalize_digits(_cpf);
  _admin boolean;
BEGIN
  IF NOT public.viewer_has('create_member'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _e IS NULL AND _mo IS NULL AND _c IS NULL THEN
    RETURN;
  END IF;

  _admin := public.viewer_has('manage_roles'::public.permission_action);

  RETURN QUERY
  SELECT CASE WHEN x.visible THEN x.id END,
         CASE WHEN x.visible THEN x.name END,
         CASE WHEN x.visible THEN x.deleted_at END,
         x.fields,
         x.account_email
    FROM (
      SELECT m.id,
             m.name,
             m.deleted_at,
             array_remove(ARRAY[
               CASE WHEN _e  IS NOT NULL AND public.normalize_email(m.email) = _e THEN 'email' END,
               CASE WHEN _mo IS NOT NULL AND public.mobile_match_key(m.mobile_whatsapp) = _mo THEN 'mobile' END,
               CASE WHEN _c  IS NOT NULL AND public.normalize_digits(m.cpf) = _c THEN 'cpf' END
             ], NULL) AS fields,
             coalesce(_e IS NOT NULL AND public.normalize_email(m.email) = _e
                      AND m.auth_user_id IS NOT NULL, false) AS account_email,
             (_admin AND EXISTS (SELECT 1 FROM public.members_deleted_view v WHERE v.id = m.id)) AS visible
        FROM public.members m
       WHERE m.deleted_at IS NOT NULL
         AND (   (_e  IS NOT NULL AND public.normalize_email(m.email) = _e)
              OR (_mo IS NOT NULL AND public.mobile_match_key(m.mobile_whatsapp) = _mo)
              OR (_c  IS NOT NULL AND public.normalize_digits(m.cpf) = _c))
       ORDER BY m.deleted_at DESC, m.id
       LIMIT 10
    ) x
   ORDER BY x.deleted_at DESC, x.id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_deleted_member_matches(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_deleted_member_matches(text, text, text) TO authenticated;

-- ===========================================================================
-- 4. Seletor de líder com os discípulos (AQ-4, DT-16, RN-13)
-- ===========================================================================
-- Quais dos ids pedidos são discípulos (diretos ou indiretos, inclusive
-- inativos) de _member_id. Só responde sobre pessoas que quem chama vê: o
-- membro e cada candidato passam por viewer_sees_member. Sobe pela chave
-- primária a partir de cada candidato, com o caminho visitado (um ciclo
-- antigo não trava a consulta).
CREATE OR REPLACE FUNCTION public.member_descendants_among(_member_id uuid, _candidate_ids uuid[])
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.viewer_has('edit_member'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(_candidate_ids) > 100 THEN
    PERFORM public._del_raise('too_many_ids', 'No máximo 100 membros por consulta.');
  END IF;
  IF _member_id IS NULL OR coalesce(cardinality(_candidate_ids), 0) = 0
     OR NOT public.viewer_sees_member(_member_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH RECURSIVE up(origin, id, leader_id, path) AS (
    SELECT m.id, m.id, m.leader_id, ARRAY[m.id]
      FROM public.members m
     WHERE m.id = ANY (_candidate_ids)
       AND m.id <> _member_id
       AND public.viewer_sees_member(m.id)
    UNION ALL
    SELECT up.origin, l.id, l.leader_id, up.path || l.id
      FROM up
      JOIN public.members l ON l.id = up.leader_id
     WHERE up.id <> _member_id
       AND NOT l.id = ANY (up.path)
  )
  SELECT DISTINCT up.origin FROM up WHERE up.id = _member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.member_descendants_among(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_descendants_among(uuid, uuid[]) TO authenticated, service_role;

-- ===========================================================================
-- 5. Violações das regras do tipo (a) (RN-01, RN-18; risco 8)
-- ===========================================================================
-- Uma linha por violação. Roda como postgres (SQL Editor, guarda da migration 2
-- e reconciliação do E4.09). As condições espelham os CHECKs e os índices da
-- migration 2: os CHECKs valem também para os excluídos (DA-6); a unicidade
-- conta só os não excluídos (DEL-04). Devolve só regra e id.
CREATE OR REPLACE FUNCTION private.member_rule_violations()
RETURNS TABLE (rule text, member_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH RECURSIVE
  m AS (SELECT * FROM public.members),
  live AS (SELECT * FROM m WHERE m.deleted_at IS NULL),
  -- Ciclo: sobe a partir de cada cadastro com líder, com o caminho visitado,
  -- até a raiz, até voltar ao início (ciclo) ou até repetir alguém de fora.
  up(origin, cur, path) AS (
    SELECT x.id, x.leader_id, ARRAY[x.id]
      FROM m x
     WHERE x.leader_id IS NOT NULL AND x.leader_id <> x.id
    UNION ALL
    SELECT up.origin, l.leader_id, up.path || up.cur
      FROM up
      JOIN m l ON l.id = up.cur
     WHERE l.leader_id IS NOT NULL
       AND NOT up.cur = ANY (up.path)
  ),
  v(rule, member_id) AS (
    SELECT 'gender', x.id FROM m x
     WHERE x.gender IS NULL OR x.gender NOT IN ('M', 'F')
    UNION ALL
    SELECT 'email_format', x.id FROM m x
     WHERE x.email IS NOT NULL
       AND NOT coalesce(x.email = public.normalize_email(x.email) AND public.is_valid_email(x.email), false)
    UNION ALL
    SELECT 'email_placeholder', x.id FROM m x
     WHERE public.is_placeholder_email(x.email)
    UNION ALL
    SELECT 'cpf', x.id FROM m x
     WHERE x.cpf IS NOT NULL AND NOT coalesce(public.is_valid_cpf(x.cpf), false)
    UNION ALL
    SELECT 'email_in_use', d.id
      FROM (SELECT l.id, count(*) OVER (PARTITION BY public.normalize_email(l.email)) AS n
              FROM live l WHERE public.normalize_email(l.email) IS NOT NULL) d
     WHERE d.n > 1
    UNION ALL
    SELECT 'mobile_in_use', d.id
      FROM (SELECT l.id, count(*) OVER (PARTITION BY public.mobile_match_key(l.mobile_whatsapp)) AS n
              FROM live l WHERE public.mobile_match_key(l.mobile_whatsapp) IS NOT NULL) d
     WHERE d.n > 1
    UNION ALL
    SELECT 'cpf_in_use', d.id
      FROM (SELECT l.id, count(*) OVER (PARTITION BY public.normalize_digits(l.cpf)) AS n
              FROM live l WHERE public.normalize_digits(l.cpf) IS NOT NULL) d
     WHERE d.n > 1
    UNION ALL
    SELECT 'pastor_with_leader', x.id FROM m x
     WHERE x.is_pastor AND x.leader_id IS NOT NULL
    UNION ALL
    SELECT 'pastor_with_flag', x.id FROM m x
     WHERE x.is_pastor AND x.has_leadership
    UNION ALL
    SELECT 'flag_without_leader', x.id FROM m x
     WHERE NOT x.is_pastor AND x.has_leadership AND x.leader_id IS NULL
    UNION ALL
    SELECT 'leader_without_flag', x.id FROM m x
     WHERE NOT x.is_pastor AND NOT x.has_leadership AND x.leader_id IS NOT NULL
    UNION ALL
    SELECT 'leader_self', x.id FROM m x
     WHERE x.leader_id = x.id
    UNION ALL
    SELECT DISTINCT 'leader_cycle', up.origin FROM up
     WHERE up.cur = up.origin
    UNION ALL
    SELECT 'spouse_self', x.id FROM m x
     WHERE x.spouse_id = x.id
    UNION ALL
    SELECT 'baptism_date', x.id FROM m x
     WHERE NOT x.is_baptized AND x.baptism_date IS NOT NULL
  )
  SELECT v.rule, v.member_id FROM v ORDER BY v.rule, v.member_id
$$;

REVOKE ALL ON FUNCTION private.member_rule_violations() FROM PUBLIC, anon, authenticated, service_role;
