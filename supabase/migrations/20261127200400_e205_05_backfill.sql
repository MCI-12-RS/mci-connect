-- E2.05 (PR 1, migration 5 de 6) — Auditoria: eventos e registros de antes deste passo. Ver
-- docs/specs/e2-05-auditoria-autor.md no repositório apps-mci ("Eventos e registros de antes
-- deste passo (migration 5)", "DDL de referência" (os CHECKs); RN-12, RN-13, RN-20; DA-2, DA-3;
-- DT-11, DT-20).
--
-- Conteúdo:
--   1. private.audit_v1_text / audit_v1_fields / audit_convert_v1_events(): a conversão dos
--      eventos antigos (DT-11). Em cada evento sem actor_kind:
--        - o original fica em metadata.v1 (action, entity, entity_label, description,
--          changed_fields), só quando algo muda;
--        - actor_kind: member com autor; none sem autor na entidade auth; system nos demais (DA-2);
--        - participantes viram alteração do relatório (entity cell_report, action update), com
--          changes.participants.added ou removed e o nome tirado da descrição de então;
--        - changes.fields montado do metadata de então ({campo: {from, to}}) e de changed_fields,
--          com os valores no tipo da lista e as referências com o nome de hoje (RN-20 c); um
--          campo fora da lista sai;
--        - descrições e registros no vocabulário novo, com a data dd/mm/aaaa (P-AUD-22). O que não
--          casar fica como está, e a contagem sai num NOTICE.
--   2. private.audit_backfill_authorship(): a autoria dos registros que já existem (RN-12,
--      DT-20), pelos eventos convertidos: o cadastro pelo primeiro create; a última alteração
--      pelo último update, delete ou restore (no relatório, sem os participantes do mesmo autor
--      até 60 s depois do envio, DA-3); a exclusão pelo deleted_by ou pelo último delete. Só
--      preenche o que ainda está vazio: o que o carimbo já marcou entre as migrations 3 e 5 fica.
--   3. As duas rodam aqui, sem triggers (session_replication_role = replica, só durante o
--      bloco), e depois entram os NOT NULL e os CHECKs de autoria e events.actor_kind NOT
--      NULL. created_by_kind ganha o padrão 'system' para as gravações sem trigger (replica). Rodar de novo não muda nada.

-- ===========================================================================
-- 1. Conversão dos eventos antigos (DT-11)
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.audit_v1_text(
  _entity public.event_entity, _action public.event_action, _label text, _description text,
  OUT entity public.event_entity, OUT action public.event_action, OUT label text, OUT description text,
  OUT participant_name text, OUT participant_added boolean, OUT matched boolean)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  _m text[];
  _date_re constant text := ' em ([0-9]{4})-([0-9]{2})-([0-9]{2})$';
BEGIN
  entity := _entity;  action := _action;  label := _label;  description := _description;  matched := false;

  IF _entity = 'member' THEN
    _m := regexp_match(_description, '^(Criou|Atualizou|Removeu) o membro (.*)$');
    IF _m IS NOT NULL THEN
      description := CASE _m[1] WHEN 'Criou' THEN 'Cadastrou' WHEN 'Atualizou' THEN 'Alterou' ELSE 'Excluiu' END
                     || ' o membro ' || _m[2];
      matched := true;
    ELSIF _description ~ '^(Excluiu|Restaurou) o membro ' OR _description ~ '^Vínculo de cônjuge desfeito pela exclusão de ' THEN
      matched := true;
    END IF;

  ELSIF _entity = 'cell' THEN
    _m := regexp_match(_description, '^(Criou|Atualizou|Removeu|Excluiu|Restaurou) a célula de (.*)$');
    IF _m IS NOT NULL THEN
      description := CASE _m[1] WHEN 'Criou' THEN 'Cadastrou' WHEN 'Atualizou' THEN 'Alterou'
                                WHEN 'Removeu' THEN 'Excluiu' ELSE _m[1] END
                     || ' a célula de ' || _m[2];
      matched := true;
    END IF;
    IF _label ~ '^célula de ' THEN
      label := 'C' || substr(_label, 2);
    END IF;

  ELSIF _entity = 'cell_report' THEN
    _m := regexp_match(_description,
            '^(Registrou|Atualizou|Removeu|Excluiu|Restaurou) o relatório da célula de (.*)' || _date_re);
    IF _m IS NOT NULL THEN
      description := CASE _m[1] WHEN 'Registrou' THEN 'Enviou' WHEN 'Atualizou' THEN 'Alterou'
                                WHEN 'Removeu' THEN 'Excluiu' ELSE _m[1] END
                     || ' o relatório de ' || _m[5] || '/' || _m[4] || '/' || _m[3] || ' da célula de ' || _m[2];
      matched := true;
    END IF;

  ELSIF _entity = 'cell_report_participant' THEN
    _m := regexp_match(_description, '^(Adicionou|Removeu) (.*) (ao|do) relatório da célula de (.*)' || _date_re);
    IF _m IS NOT NULL AND ((_m[1] = 'Adicionou') = (_m[3] = 'ao')) THEN
      entity := 'cell_report';
      action := 'update';
      participant_name := _m[2];
      participant_added := _m[1] = 'Adicionou';
      description := CASE WHEN participant_added THEN 'Incluiu ' || _m[2] || ' no' ELSE 'Retirou ' || _m[2] || ' do' END
                     || ' relatório de ' || _m[7] || '/' || _m[6] || '/' || _m[5] || ' da célula de ' || _m[4];
      matched := true;
    END IF;
  END IF;

  IF _entity IN ('cell_report', 'cell_report_participant') THEN
    _m := regexp_match(_label, '^relatório da célula de (.*)' || _date_re);
    IF _m IS NOT NULL THEN
      label := 'Relatório de ' || _m[4] || '/' || _m[3] || '/' || _m[2] || ' da célula de ' || _m[1];
    END IF;
  END IF;
END;
$$;

-- changes.fields de um evento antigo: os campos de changed_fields que estão na lista, na ordem
-- dela; os valores (só nos campos com valor) vêm do metadata de então ({campo: {from, to}}, em
-- texto), no tipo da lista; as referências com o nome de hoje (RN-20 c).
CREATE OR REPLACE FUNCTION private.audit_v1_fields(_entity public.event_entity, _changed text[], _metadata jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH f AS (
    SELECT af.field, af.show_values, af.value_type, af.position,
           _metadata #>> ARRAY[af.field, 'from'] AS v_from,
           _metadata #>> ARRAY[af.field, 'to'] AS v_to,
           (_metadata -> af.field) ? 'from' OR (_metadata -> af.field) ? 'to' AS has_values
      FROM private.audit_fields af
     WHERE af.entity = _entity
       AND af.field = ANY (coalesce(_changed, '{}'::text[])))
  SELECT coalesce(jsonb_agg(
           CASE
             WHEN NOT f.show_values OR NOT coalesce(f.has_values, false) THEN jsonb_build_object('field', f.field)
             WHEN f.value_type IN ('member', 'role', 'cell') THEN
               jsonb_build_object(
                 'field', f.field,
                 'from', CASE WHEN f.v_from ~* '^[0-9a-f-]{36}$' THEN private.audit_ref_name(f.value_type, f.v_from::uuid) END,
                 'to', CASE WHEN f.v_to ~* '^[0-9a-f-]{36}$' THEN private.audit_ref_name(f.value_type, f.v_to::uuid) END,
                 'from_id', to_jsonb(f.v_from),
                 'to_id', to_jsonb(f.v_to))
             WHEN f.value_type = 'boolean' THEN
               jsonb_build_object('field', f.field,
                 'from', CASE WHEN f.v_from IN ('true', 'false') THEN to_jsonb(f.v_from::boolean) END,
                 'to', CASE WHEN f.v_to IN ('true', 'false') THEN to_jsonb(f.v_to::boolean) END)
             WHEN f.value_type = 'number' THEN
               jsonb_build_object('field', f.field,
                 'from', CASE WHEN f.v_from ~ '^-?[0-9]+(\.[0-9]+)?$' THEN to_jsonb(f.v_from::numeric) END,
                 'to', CASE WHEN f.v_to ~ '^-?[0-9]+(\.[0-9]+)?$' THEN to_jsonb(f.v_to::numeric) END)
             ELSE jsonb_build_object('field', f.field, 'from', to_jsonb(f.v_from), 'to', to_jsonb(f.v_to))
           END
           ORDER BY f.position), '[]'::jsonb)
    FROM f
$$;

-- Converte todo evento sem actor_kind. Devolve quantos eventos de dados não casaram com nenhum
-- formato conhecido (ficam com a descrição de antes).
CREATE OR REPLACE FUNCTION private.audit_convert_v1_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _unmatched integer;
BEGIN
  WITH src AS (
    SELECT e.id, e.entity AS o_entity, e.action AS o_action, e.entity_label AS o_label,
           e.description AS o_description, e.changed_fields AS o_changed, e.metadata AS o_metadata,
           e.actor_user_id,
           e.entity IN ('member', 'cell', 'cell_report', 'cell_report_participant')
             AND e.action IN ('create', 'update', 'delete', 'restore') AS is_data
      FROM public.events e
     WHERE e.actor_kind IS NULL
  ), txt AS (
    SELECT s.*, t.entity AS n_entity, t.action AS n_action, t.label AS n_label, t.description AS n_description,
           t.participant_name, t.participant_added, t.matched
      FROM src s
     CROSS JOIN LATERAL private.audit_v1_text(s.o_entity, s.o_action, s.o_label, s.o_description) t
     WHERE s.is_data
    UNION ALL
    SELECT s.*, s.o_entity, s.o_action, s.o_label, s.o_description, NULL, NULL, true
      FROM src s
     WHERE NOT s.is_data
  ), conv AS (
    SELECT x.*,
           CASE
             WHEN NOT x.is_data THEN NULL
             WHEN x.participant_name IS NOT NULL THEN
               jsonb_build_object('fields', '[]'::jsonb, 'participants',
                 jsonb_build_object(
                   'added', CASE WHEN x.participant_added THEN jsonb_build_array(
                              jsonb_build_object('id', x.o_metadata -> 'member_id', 'name', x.participant_name)) ELSE '[]'::jsonb END,
                   'removed', CASE WHEN NOT x.participant_added THEN jsonb_build_array(
                              jsonb_build_object('id', x.o_metadata -> 'member_id', 'name', x.participant_name)) ELSE '[]'::jsonb END))
             WHEN x.o_entity = 'cell_report_participant' THEN jsonb_build_object('fields', '[]'::jsonb)
             ELSE jsonb_build_object('fields',
                    CASE WHEN x.o_action = 'create' THEN '[]'::jsonb
                         ELSE private.audit_v1_fields(x.o_entity, x.o_changed, x.o_metadata) END)
           END AS n_changes
      FROM txt x
  ), upd AS (
    UPDATE public.events e
       SET actor_kind = CASE WHEN c.actor_user_id IS NOT NULL THEN 'member'
                             WHEN c.o_entity = 'auth' THEN 'none'
                             ELSE 'system' END::public.event_actor_kind,
           entity = c.n_entity,
           action = c.n_action,
           entity_label = c.n_label,
           description = c.n_description,
           changes = c.n_changes,
           changed_fields = CASE WHEN c.n_changes IS NULL THEN e.changed_fields
                                 ELSE private.audit_field_keys(c.n_changes) END,
           metadata = CASE
                        WHEN c.is_data
                         AND (c.n_entity IS DISTINCT FROM c.o_entity OR c.n_action IS DISTINCT FROM c.o_action
                              OR c.n_label IS DISTINCT FROM c.o_label OR c.n_description IS DISTINCT FROM c.o_description
                              OR private.audit_field_keys(c.n_changes) IS DISTINCT FROM c.o_changed)
                        THEN coalesce(c.o_metadata, '{}'::jsonb) || jsonb_build_object('v1', jsonb_build_object(
                               'action', c.o_action, 'entity', c.o_entity, 'entity_label', c.o_label,
                               'description', c.o_description, 'changed_fields', to_jsonb(c.o_changed)))
                        ELSE c.o_metadata
                      END
      FROM conv c
     WHERE e.id = c.id
    RETURNING c.matched
  )
  SELECT count(*) FILTER (WHERE NOT u.matched)::int INTO _unmatched FROM upd u;
  RETURN _unmatched;
END;
$$;

-- ===========================================================================
-- 2. Autoria dos registros que já existem (RN-12, DT-20, DA-3)
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.audit_backfill_authorship()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _t record;
BEGIN
  FOR _t IN SELECT * FROM (VALUES ('members', 'member'), ('cells', 'cell'), ('cell_reports', 'cell_report')) v (tbl, entity) LOOP
    -- Uma gravação por linha (cadastro, última alteração e exclusão juntos), só nas que faltam:
    --   cadastro e última alteração: os registros de antes deste passo (created_by_kind nulo); a
    --   alteração que o carimbo já marcou entre as migrations 3 e 5 fica;
    --   exclusão: os excluídos ainda sem tipo de autor.
    EXECUTE format($q$
      WITH ev AS (
        SELECT e.entity_id, e.action, e.occurred_at, e.seq, e.actor_kind, e.actor_user_id, e.metadata
          FROM public.events e
         WHERE e.entity = %2$L::public.event_entity AND e.action IN ('create', 'update', 'delete', 'restore')
      ), acct AS (                                   -- a conta leva ao cadastro (qualquer um, excluído ou não)
        SELECT DISTINCT ON (m.auth_user_id) m.auth_user_id, m.id
          FROM public.members m
         WHERE m.auth_user_id IS NOT NULL
         ORDER BY m.auth_user_id, m.deleted_at NULLS FIRST, m.created_at NULLS LAST, m.id
      ), fc AS (                                     -- o primeiro cadastro
        SELECT DISTINCT ON (ev.entity_id) ev.entity_id, ev.occurred_at, ev.actor_kind, ev.actor_user_id
          FROM ev WHERE ev.action = 'create'
         ORDER BY ev.entity_id, ev.occurred_at, ev.seq
      ), le AS (                                     -- a última alteração, exclusão ou restauração (DA-3)
        SELECT DISTINCT ON (ev.entity_id) ev.entity_id, ev.occurred_at, ev.actor_kind, ev.actor_user_id
          FROM ev LEFT JOIN fc ON fc.entity_id = ev.entity_id
         WHERE ev.action IN ('update', 'delete', 'restore')
           AND NOT (    ev.metadata #>> '{v1,entity}' = 'cell_report_participant'
                    AND fc.entity_id IS NOT NULL
                    AND fc.actor_user_id IS NOT DISTINCT FROM ev.actor_user_id
                    AND ev.occurred_at >= fc.occurred_at
                    AND ev.occurred_at <= fc.occurred_at + interval '60 seconds')
         ORDER BY ev.entity_id, ev.occurred_at DESC, ev.seq DESC
      ), ld AS (                                     -- a última exclusão
        SELECT DISTINCT ON (ev.entity_id) ev.entity_id, ev.actor_kind, ev.actor_user_id
          FROM ev WHERE ev.action = 'delete'
         ORDER BY ev.entity_id, ev.occurred_at DESC, ev.seq DESC
      ), calc AS (
        SELECT t0.id,
               CASE WHEN fc.entity_id IS NULL THEN 'unknown'
                    WHEN fc.actor_kind = 'member' AND ca.id IS NOT NULL THEN 'member'
                    WHEN fc.actor_kind = 'member' THEN 'unknown'
                    ELSE 'system' END::public.author_kind AS c_kind,
               CASE WHEN fc.actor_kind = 'member' THEN ca.id END AS c_by,
               le.occurred_at AS u_at,
               CASE WHEN le.entity_id IS NULL THEN NULL
                    WHEN le.actor_kind = 'member' AND ua.id IS NOT NULL THEN 'member'
                    WHEN le.actor_kind = 'member' THEN 'unknown'
                    ELSE 'system' END::public.author_kind AS u_kind,
               CASE WHEN le.actor_kind = 'member' THEN ua.id END AS u_by,
               CASE WHEN t0.deleted_by IS NOT NULL THEN 'member'
                    WHEN ld.actor_kind = 'member' AND da.id IS NOT NULL THEN 'member'
                    WHEN ld.actor_kind = 'system' THEN 'system'
                    ELSE 'unknown' END::public.author_kind AS d_kind,
               coalesce(t0.deleted_by, CASE WHEN ld.actor_kind = 'member' THEN da.id END) AS d_by
          FROM public.%1$I t0
          LEFT JOIN fc ON fc.entity_id = t0.id
          LEFT JOIN acct ca ON ca.auth_user_id = fc.actor_user_id
          LEFT JOIN le ON le.entity_id = t0.id
          LEFT JOIN acct ua ON ua.auth_user_id = le.actor_user_id
          LEFT JOIN ld ON ld.entity_id = t0.id
          LEFT JOIN acct da ON da.auth_user_id = ld.actor_user_id
         WHERE t0.created_by_kind IS NULL
            OR (t0.deleted_at IS NOT NULL AND t0.deleted_by_kind IS NULL)
      )
      UPDATE public.%1$I t
         SET created_by_kind   = CASE WHEN t.created_by_kind IS NULL THEN c.c_kind ELSE t.created_by_kind END,
             created_by        = CASE WHEN t.created_by_kind IS NULL THEN c.c_by ELSE t.created_by END,
             created_by_legacy = CASE WHEN t.created_by_kind IS NULL THEN NULL ELSE t.created_by_legacy END,
             updated_at        = CASE WHEN t.created_by_kind IS NULL AND t.updated_by_kind IS NULL THEN c.u_at ELSE t.updated_at END,
             updated_by_kind   = CASE WHEN t.created_by_kind IS NULL AND t.updated_by_kind IS NULL THEN c.u_kind ELSE t.updated_by_kind END,
             updated_by        = CASE WHEN t.created_by_kind IS NULL AND t.updated_by_kind IS NULL THEN c.u_by ELSE t.updated_by END,
             updated_by_legacy = CASE WHEN t.created_by_kind IS NULL AND t.updated_by_kind IS NULL THEN NULL ELSE t.updated_by_legacy END,
             deleted_by_kind   = CASE WHEN t.deleted_at IS NOT NULL AND t.deleted_by_kind IS NULL THEN c.d_kind ELSE t.deleted_by_kind END,
             deleted_by        = CASE WHEN t.deleted_at IS NOT NULL AND t.deleted_by_kind IS NULL THEN c.d_by ELSE t.deleted_by END
        FROM calc c
       WHERE t.id = c.id
    $q$, _t.tbl, _t.entity);
  END LOOP;
END;
$$;

DO $$
DECLARE
  _f regprocedure;
BEGIN
  FOR _f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'private'::regnamespace
       AND p.proname IN ('audit_v1_text', 'audit_v1_fields', 'audit_convert_v1_events', 'audit_backfill_authorship')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', _f);
  END LOOP;
END;
$$;

-- ===========================================================================
-- 3. Conversão, preenchimento e regras (sem triggers)
-- ===========================================================================
-- SET, e não set_config(): no Supabase, o papel das migrations só pode mudar este parâmetro pelo
-- comando SET. Volta ao padrão logo depois do bloco; se o bloco falhar, a migration para inteira.
SET session_replication_role = replica;

DO $$
DECLARE
  _unmatched integer;
  _t text;
BEGIN
  IF current_setting('session_replication_role') <> 'replica' THEN
    RAISE EXCEPTION 'E2.05 migration 5: precisa rodar com session_replication_role = replica.';
  END IF;

  _unmatched := private.audit_convert_v1_events();
  IF _unmatched > 0 THEN
    RAISE NOTICE 'E2.05 migration 5: % evento(s) de dados de antes deste passo não casaram com nenhum formato conhecido e ficaram com a descrição de antes.', _unmatched;
  END IF;

  PERFORM private.audit_backfill_authorship();

  FOREACH _t IN ARRAY ARRAY['members', 'cells', 'cell_reports'] LOOP
    -- O padrão 'system' só vale onde nenhum trigger roda (replica: massas de teste, manutenção):
    -- linha gravada sem pessoa é "Sistema" (RN-09). Pela API, o carimbo sempre define o valor;
    -- a carga do legado (E4.06) grava as colunas pela legacy_authorship.
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by_kind SET DEFAULT ''system''', _t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by_kind SET NOT NULL', _t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', _t)::regclass
                                                 AND conname = _t || '_created_authorship_check') THEN
      EXECUTE format($c$ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (
            (created_by_kind = 'member') = (created_by IS NOT NULL)
        AND (created_by_kind = 'legacy') = (created_by_legacy IS NOT NULL)
        AND (created_at IS NOT NULL OR created_by_kind IN ('legacy', 'unknown')))$c$, _t, _t || '_created_authorship_check');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', _t)::regclass
                                                 AND conname = _t || '_updated_authorship_check') THEN
      EXECUTE format($c$ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (
            (updated_at IS NULL) = (updated_by_kind IS NULL)
        AND coalesce(updated_by_kind = 'member', false) = (updated_by IS NOT NULL)
        AND coalesce(updated_by_kind = 'legacy', false) = (updated_by_legacy IS NOT NULL))$c$, _t, _t || '_updated_authorship_check');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', _t)::regclass
                                                 AND conname = _t || '_deleted_authorship_check') THEN
      -- Sem exclusão, nada da exclusão. Com exclusão, o tipo decide o id e o nome do legado; o
      -- tipo nulo num excluído só aparece em gravação sem trigger (replica: massas de teste,
      -- manutenção) e é lido como o deleted_by, ou "autor não registrado" (DT-23).
      EXECUTE format($c$ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (
            (deleted_at IS NOT NULL OR (deleted_by_kind IS NULL AND deleted_by_legacy IS NULL))
        AND (deleted_by_kind IS NULL OR (deleted_by_kind = 'member') = (deleted_by IS NOT NULL))
        AND (deleted_by_kind IS NULL OR (deleted_by_kind = 'legacy') = (deleted_by_legacy IS NOT NULL))
        AND (deleted_by_legacy IS NULL OR deleted_by_kind = 'legacy'))$c$, _t, _t || '_deleted_authorship_check');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', _t)::regclass
                                                 AND conname = _t || '_legacy_names_check') THEN
      EXECUTE format($c$ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (
            nullif(btrim(created_by_legacy), '') IS NOT DISTINCT FROM created_by_legacy
        AND nullif(btrim(updated_by_legacy), '') IS NOT DISTINCT FROM updated_by_legacy
        AND nullif(btrim(deleted_by_legacy), '') IS NOT DISTINCT FROM deleted_by_legacy)$c$, _t, _t || '_legacy_names_check');
    END IF;
  END LOOP;

  ALTER TABLE public.events ALTER COLUMN actor_kind SET NOT NULL;
END;
$$;

SET session_replication_role = DEFAULT;
