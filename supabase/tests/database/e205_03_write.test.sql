-- E2.05 (PR 1) — Auditoria: escrita (autoria, eventos, funções e tudo ou nada).
-- Spec: docs/specs/e2-05-auditoria-autor.md ("Verificações obrigatórias": RN-01 a RN-06, RN-13 a
-- RN-15, RN-20; DA-1, DA-5, DA-7, DA-10, DA-12; DT-04 a DT-10, DT-24).
-- Cada SELECT do arquivo é um comando: um evento por gravação (comando) e registro (DT-24).
-- Rodar com: supabase test db
BEGIN;

-- E2.11 PR 2 (DA-11): as massas gravam relatórios e participantes direto (inclusive de semanas
-- passadas); fora das RPCs, só com a marca de manutenção.
SET LOCAL mci.cell_report_write = 'on';
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(81);

-- ---------------------------------------------------------------------------
-- Ids e chamadas pela API
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2050300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2050300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2050300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '519205' || lpad(_n::text, 5, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

-- Executa _sql como o usuário _n (role authenticated; _n nulo: sem sub; _role: outro papel).
-- Devolve o jsonb do SELECT, {"ok": true} para DML, ou {"error": SQLSTATE, "code": app_error}.
CREATE FUNCTION pg_temp.api(_n int, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _detail text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN json_build_object('role', _role)
           ELSE json_build_object('sub', pg_temp.u(_n), 'role', _role) END::text, true);
    EXECUTE format('SET LOCAL ROLE %I', _role);
    IF _sql ~* '^\s*(select|with)' THEN
      EXECUTE _sql INTO _out;
    ELSE
      EXECUTE _sql;
      _out := '{"ok": true}'::jsonb;
    END IF;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN coalesce(_out, 'null'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('error', _state, 'code', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ->> 'code' END);
  END;
END $$;

-- A autoria gravada de um registro.
CREATE FUNCTION pg_temp.auth_of(_table text, _id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', _table) INTO _r USING _id;
  RETURN jsonb_build_object(
    'created_by', _r ->> 'created_by', 'created_kind', _r ->> 'created_by_kind',
    'updated_by', _r ->> 'updated_by', 'updated_kind', _r ->> 'updated_by_kind',
    'has_updated_at', _r ->> 'updated_at' IS NOT NULL,
    'deleted_by', _r ->> 'deleted_by', 'deleted_kind', _r ->> 'deleted_by_kind');
END $$;
-- Os eventos de um registro gravados depois do marco _since (seq).
CREATE FUNCTION pg_temp.evs(_entity text, _id uuid, _since bigint DEFAULT 0) RETURNS SETOF public.events LANGUAGE sql AS
$$ SELECT * FROM public.events WHERE entity::text = _entity AND entity_id = _id AND seq > _since ORDER BY seq $$;
CREATE FUNCTION pg_temp.mark() RETURNS bigint LANGUAGE sql AS $$ SELECT coalesce(max(seq), 0) FROM public.events $$;
CREATE FUNCTION pg_temp.nev(_entity text, _id uuid, _since bigint) RETURNS int LANGUAGE sql AS
$$ SELECT count(*)::int FROM pg_temp.evs(_entity, _id, _since) $$;
CREATE FUNCTION pg_temp.last(_entity text, _id uuid) RETURNS public.events LANGUAGE sql AS
$$ SELECT * FROM public.events WHERE entity::text = _entity AND entity_id = _id ORDER BY seq DESC LIMIT 1 $$;

-- ---------------------------------------------------------------------------
-- Massa (gravada como postgres: autor "Sistema")
--  1 Samuel (pastor, Administrador)   2 Ana (Administrador)   3 Davi (Líder, G12)   4 Caio (Membro, de Davi)
--  5 Otávio (de Davi)   6 Paula (de Davi)   7 Nina (Membro, excluída)   8 Lia (de Davi)
--  12 Rita e 13 Hugo (casados, de Davi)   20 conta sem cadastro
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.u(n), 'e205-03-' || n || '@teste.invalid', now() FROM unnest(ARRAY[1, 2, 3, 4, 7, 20]) n;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp, auth_user_id, role_id)
VALUES (pg_temp.m(1), 'Samuel Pastor', 'M', true, false, pg_temp.mob(1), pg_temp.u(1), pg_temp.role('Administrador'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp, auth_user_id, role_id) VALUES
  (pg_temp.m(2), 'Ana Auditora', 'F', pg_temp.m(1), true, pg_temp.mob(2), pg_temp.u(2), pg_temp.role('Administrador')),
  (pg_temp.m(3), 'Davi Duarte', 'M', pg_temp.m(1), true, pg_temp.mob(3), pg_temp.u(3), pg_temp.role('Líder'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp, auth_user_id, role_id) VALUES
  (pg_temp.m(4), 'Caio Lima', 'M', pg_temp.m(3), true, pg_temp.mob(4), pg_temp.u(4), pg_temp.role('Membro')),
  (pg_temp.m(5), 'Otávio Reis', 'M', pg_temp.m(3), true, pg_temp.mob(5), NULL, NULL),
  (pg_temp.m(6), 'Paula Prado', 'F', pg_temp.m(3), true, pg_temp.mob(6), NULL, NULL),
  (pg_temp.m(7), 'Nina Nunes', 'F', pg_temp.m(3), true, pg_temp.mob(7), pg_temp.u(7), pg_temp.role('Membro')),
  (pg_temp.m(8), 'Lia Lima', 'F', pg_temp.m(3), true, pg_temp.mob(8), NULL, NULL),
  (pg_temp.m(12), 'Rita Rocha', 'F', pg_temp.m(3), true, pg_temp.mob(12), NULL, NULL),
  (pg_temp.m(13), 'Hugo Rocha', 'M', pg_temp.m(3), true, pg_temp.mob(13), NULL, NULL),
  (pg_temp.m(14), 'Gil Gomes', 'M', pg_temp.m(3), true, pg_temp.mob(14), NULL, NULL),
  (pg_temp.m(15), 'Iara Ivo', 'F', pg_temp.m(3), true, pg_temp.mob(15), NULL, NULL);
UPDATE public.members SET spouse_id = pg_temp.m(13) WHERE id = pg_temp.m(12);
UPDATE public.members SET deleted_at = now() WHERE id = pg_temp.m(7);
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time, neighborhood)
VALUES (pg_temp.c(1), pg_temp.m(3), pg_temp.m(5), pg_temp.m(6), 'Domingo', '00:00', 'Centro');

-- ===========================================================================
-- 1. RN-01 a RN-03, DA-1: quem é o autor e só o servidor define — 12
-- ===========================================================================
SELECT is(pg_temp.auth_of('members', pg_temp.m(1)),
  '{"created_by": null, "created_kind": "system", "updated_by": null, "updated_kind": null, "has_updated_at": false,
    "deleted_by": null, "deleted_kind": null}'::jsonb,
  'RN-02: gravado sem sessão (migration, SQL Editor): cadastro "Sistema", sem alteração');

SELECT is(pg_temp.api(2, format($$INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp,
                                     created_at, created_by, created_by_kind, created_by_legacy, updated_at, updated_by,
                                     updated_by_kind, deleted_by_kind)
                                  VALUES (%L, 'Beto Barros', 'M', %L, true, %L, '2020-01-01', %L, 'legacy', 'AdminUser',
                                          '2020-01-02', %L, 'system', 'system')$$,
                                  pg_temp.m(30), pg_temp.m(3), pg_temp.mob(30), pg_temp.m(1), pg_temp.m(1))),
  '{"ok": true}'::jsonb, 'RN-03: Ana cadastra com autor e datas forjados: aceito sem erro');
SELECT is(pg_temp.auth_of('members', pg_temp.m(30)),
  jsonb_build_object('created_by', pg_temp.m(2), 'created_kind', 'member', 'updated_by', NULL, 'updated_kind', NULL,
                     'has_updated_at', false, 'deleted_by', NULL, 'deleted_kind', NULL),
  'RN-02/RN-03: o cadastro é de Ana, e o forjado foi ignorado');
SELECT ok((SELECT created_at BETWEEN now() AND clock_timestamp() AND created_by_legacy IS NULL FROM public.members WHERE id = pg_temp.m(30)),
  'RN-03: a data do cadastro vem do relógio do servidor');
SELECT is((SELECT action::text || '|' || actor_kind::text || '|' || actor_label || '|' || description FROM pg_temp.last('member', pg_temp.m(30))),
  'create|member|Ana Auditora|Cadastrou o membro Beto Barros', 'RN-13 b/RN-20 e: um evento de cadastro, com Ana e "Cadastrou"');
SELECT ok((SELECT e.occurred_at = m.created_at FROM pg_temp.last('member', pg_temp.m(30)) e, public.members m WHERE m.id = pg_temp.m(30)),
  'RN-13 b: o evento tem o mesmo momento da autoria');

CREATE TEMP TABLE beto0 AS SELECT created_at, created_by FROM public.members WHERE id = pg_temp.m(30);
SELECT is(pg_temp.api(3, format($$UPDATE public.members SET notes = 'um', created_by = %L, created_at = '2019-01-01',
                                     updated_by = %L, updated_at = '2019-01-01', updated_by_kind = 'legacy' WHERE id = %L$$,
                                  pg_temp.m(1), pg_temp.m(1), pg_temp.m(30))) ->> 'ok', 'true',
  'RN-03: Davi altera, forjando o cadastro e a alteração');
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET notes = 'dois' WHERE id = %L$$, pg_temp.m(30))) ->> 'ok', 'true', 'Ana altera');
SELECT is(pg_temp.api(3, format($$UPDATE public.members SET notes = 'três' WHERE id = %L$$, pg_temp.m(30))) ->> 'ok', 'true', 'Davi altera de novo');
SELECT ok((SELECT m.created_at = b.created_at AND m.created_by = b.created_by AND m.updated_by = pg_temp.m(3)
                  AND m.updated_by_kind = 'member' AND m.updated_at BETWEEN now() AND clock_timestamp()
             FROM public.members m, beto0 b WHERE m.id = pg_temp.m(30)),
  'RN-03: o cadastro não muda depois de 3 alterações; a última é de Davi, no relógio do servidor');

CREATE FUNCTION pg_temp.actor_as(_claims jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  PERFORM set_config('request.jwt.claims', _claims::text, true);
  PERFORM private.current_actor();
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN _state;
END $$;
SELECT is(ARRAY[pg_temp.actor_as(jsonb_build_object('sub', pg_temp.u(20), 'role', 'authenticated')),
                pg_temp.actor_as(jsonb_build_object('sub', pg_temp.u(7), 'role', 'authenticated')),
                pg_temp.actor_as('{"role": "anon"}'::jsonb),
                pg_temp.actor_as(jsonb_build_object('sub', pg_temp.u(2), 'role', 'authenticated'))],
  ARRAY['42501', '42501', '42501', 'ok'],
  'DA-1: sessão sem cadastro, de cadastro excluído (Nina) e anônima recebem 42501; a de Ana passa');
SELECT is(pg_temp.api(NULL, format($$INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time)
                                     VALUES (%L, %L, %L, 'Terça', '20:00')$$, pg_temp.m(3), pg_temp.m(5), pg_temp.m(6))) ->> 'error',
  '42501', 'DA-1: sessão sem pessoa (authenticated sem sub) não grava (42501)');

-- ===========================================================================
-- 2. "Sistema" pela chave secreta e DA-12 — 4
-- ===========================================================================
SELECT is(pg_temp.api(NULL, format($$INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp)
                                     VALUES (%L, 'Sérgio Sistema', 'M', %L, true, %L)$$, pg_temp.m(31), pg_temp.m(3), pg_temp.mob(31)),
                      'service_role') ->> 'ok', 'true', 'RN-02: a chave secreta cadastra');
SELECT is((SELECT created_by_kind::text || '|' || coalesce(created_by::text, '-') FROM public.members WHERE id = pg_temp.m(31))
          || '|' || (SELECT actor_kind::text || '|' || coalesce(actor_label, '-') FROM pg_temp.last('member', pg_temp.m(31))),
  'system|-|system|-', 'RN-02: com a chave secreta, o autor é "Sistema" no cadastro e no evento');

CREATE TEMP TABLE m_dry AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$SELECT to_jsonb(public.check_member_insert(jsonb_build_object('id', %L::uuid, 'name', 'Ensaio Teste',
                                   'gender', 'F', 'leader_id', %L::uuid, 'mobile_whatsapp', %L, 'spouse_id', %L::uuid)))$$,
                                  pg_temp.m(32), pg_temp.m(3), pg_temp.mob(32), pg_temp.m(6))), '""'::jsonb,
  'o ensaio do cadastro (check_member_insert, E2.02) passa');
SELECT is((SELECT count(*)::int FROM public.events WHERE seq > (SELECT s FROM m_dry)), 0,
  'DA-12: o ensaio não deixa evento (nem do cônjuge escolhido)');

-- ===========================================================================
-- 3. RN-04: o que conta como alteração — 13
-- ===========================================================================
CREATE TEMP TABLE m4 AS SELECT pg_temp.mark() AS s, (SELECT updated_at FROM public.members WHERE id = pg_temp.m(5)) AS upd;
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET name = 'Otávio Reis', gender = 'M', notes = NULL WHERE id = %L$$, pg_temp.m(5))) ->> 'ok', 'true',
  'RN-04 b: Ana salva Otávio sem mudar nada');
SELECT is((SELECT updated_at FROM public.members WHERE id = pg_temp.m(5)) IS NOT DISTINCT FROM (SELECT upd FROM m4)
          AND pg_temp.nev('member', pg_temp.m(5), (SELECT s FROM m4)) = 0, true,
  'RN-04 b: salvar sem mudança não muda a autoria nem grava evento');
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET mobile_whatsapp = '(51) 92050-0005' WHERE id = %L$$, pg_temp.m(5))) ->> 'ok', 'true',
  'E2.04: Ana manda o mesmo celular escrito de outro jeito');
SELECT is((SELECT updated_at FROM public.members WHERE id = pg_temp.m(5)) IS NOT DISTINCT FROM (SELECT upd FROM m4)
          AND pg_temp.nev('member', pg_temp.m(5), (SELECT s FROM m4)) = 0, true,
  'RN-04: o celular na mesma forma, escrito de outro jeito, não muda nada (o valor final já normalizado)');

SELECT is(pg_temp.api(2, format($$UPDATE public.members SET mobile_whatsapp = %L WHERE id = %L$$, pg_temp.mob(55), pg_temp.m(5))) ->> 'ok', 'true',
  'Ana muda só o celular de Otávio');
SELECT is((SELECT jsonb_build_object('n', count(*), 'action', min(action::text), 'changes', min(changes::text)::jsonb,
                                     'fields', min(changed_fields::text))
             FROM pg_temp.evs('member', pg_temp.m(5), (SELECT s FROM m4))),
  '{"n": 1, "action": "update", "changes": {"fields": [{"field": "mobile_whatsapp"}]}, "fields": "{mobile_whatsapp}"}'::jsonb,
  'RN-04/RN-20 b: um evento só, com o campo e sem o valor');
SELECT ok((SELECT updated_by = pg_temp.m(2) AND updated_at = (SELECT occurred_at FROM pg_temp.last('member', pg_temp.m(5)))
             FROM public.members WHERE id = pg_temp.m(5)),
  'RN-13 b: a última alteração de Otávio é a do último evento dele (Ana, no mesmo momento)');

CREATE TEMP TABLE m5 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET name = 'Otávio Reis Neto', mobile_whatsapp = %L WHERE id = %L$$, pg_temp.mob(56), pg_temp.m(5))) ->> 'ok', 'true',
  'Ana muda nome e celular de Otávio numa gravação');
SELECT is((SELECT jsonb_agg(changes ORDER BY seq) FROM pg_temp.evs('member', pg_temp.m(5), (SELECT s FROM m5))),
  '[{"fields": [{"field": "name", "from": "Otávio Reis", "to": "Otávio Reis Neto"}, {"field": "mobile_whatsapp"}]}]'::jsonb,
  'RN-04 e/RN-20 b: nome e celular numa gravação dão um evento só; o nome com o antes e o depois');

-- Recálculos e conta: não carimbam (RN-04 c, RN-10 e).
CREATE TEMP TABLE m6 AS SELECT pg_temp.mark() AS s,
  (SELECT jsonb_object_agg(id, updated_at) FROM public.members WHERE id IN (pg_temp.m(1), pg_temp.m(3))) AS upd;
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET leader_id = %L WHERE id = %L$$, pg_temp.m(1), pg_temp.m(8))) ->> 'ok', 'true',
  'Ana troca o líder de Lia (Davi → Samuel): os totais de Davi e de Samuel mudam');
SELECT is((SELECT jsonb_object_agg(id, updated_at) FROM public.members WHERE id IN (pg_temp.m(1), pg_temp.m(3))), (SELECT upd FROM m6),
  'RN-04 c/RN-05: o recálculo dos totais e do nível dos de cima não carimba ninguém');
SELECT is((SELECT count(*)::int FROM public.events WHERE seq > (SELECT s FROM m6) AND entity_id <> pg_temp.m(8)), 0,
  'RN-05: e não grava evento para eles');
UPDATE public.members SET auth_user_id = NULL WHERE id = pg_temp.m(4);
UPDATE public.members SET auth_user_id = pg_temp.u(4) WHERE id = pg_temp.m(4);
SELECT is((SELECT updated_at IS NULL FROM public.members WHERE id = pg_temp.m(4)) AND pg_temp.nev('member', pg_temp.m(4), (SELECT s FROM m6)) = 0, true,
  'RN-04 c/RN-10 e: a conta de acesso (auth_user_id) não conta como alteração');

-- ===========================================================================
-- 4. RN-05: o cônjuge — 6
-- ===========================================================================
CREATE TEMP TABLE m7 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET spouse_id = %L WHERE id = %L$$, pg_temp.m(6), pg_temp.m(5))) ->> 'ok', 'true',
  'Ana casa Otávio com Paula');
SELECT is((SELECT jsonb_agg(jsonb_build_object('who', entity_label, 'by', actor_label, 'changes', changes) ORDER BY entity_label)
             FROM public.events WHERE seq > (SELECT s FROM m7)),
  '[{"who": "Otávio Reis Neto", "by": "Ana Auditora", "changes": {"fields": [{"field": "spouse_id", "from": null, "to": "Paula Prado", "from_id": null, "to_id": "c2050300-0000-0000-0000-000000000006"}]}},
    {"who": "Paula Prado", "by": "Ana Auditora", "changes": {"fields": [{"field": "spouse_id", "from": null, "to": "Otávio Reis Neto", "from_id": null, "to_id": "c2050300-0000-0000-0000-000000000005"}]}}]'::jsonb,
  'RN-05/RN-20 c: definir o cônjuge carimba os dois cadastros, cada um com o próprio evento e o nome de então');
CREATE TEMP TABLE m8 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET spouse_id = %L WHERE id = %L$$, pg_temp.m(8), pg_temp.m(5))) ->> 'ok', 'true',
  'Ana troca o cônjuge de Otávio para Lia');
SELECT is((SELECT array_agg(entity_label ORDER BY entity_label) FROM public.events WHERE seq > (SELECT s FROM m8)),
  ARRAY['Lia Lima', 'Otávio Reis Neto', 'Paula Prado'],
  'RN-05: trocar o cônjuge carimba os três cadastros, cada um com o próprio evento');
SELECT is((SELECT count(*)::int FROM public.members WHERE id IN (pg_temp.m(5), pg_temp.m(6), pg_temp.m(8)) AND updated_by = pg_temp.m(2)), 3,
  'RN-05: os três com Ana como autora da última alteração');
CREATE TEMP TABLE m9 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET spouse_id = NULL WHERE id = %L$$, pg_temp.m(5))) ->> 'ok', 'true',
  'Ana desfaz o cônjuge de Otávio');
SELECT is((SELECT array_agg(entity_label ORDER BY entity_label) FROM public.events WHERE seq > (SELECT s FROM m9)),
  ARRAY['Lia Lima', 'Otávio Reis Neto'], 'RN-05: desfazer carimba os dois, cada um com o próprio evento');

-- ===========================================================================
-- 5. RN-06 e DA-5: exclusão, restauração e o cônjuge desfeito pela exclusão — 11
-- ===========================================================================
CREATE TEMP TABLE m10 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(12))), '""'::jsonb, 'Ana exclui Rita (casada com Hugo)');
SELECT ok((SELECT deleted_at = updated_at AND deleted_by = pg_temp.m(2) AND deleted_by_kind = 'member' AND updated_by = pg_temp.m(2)
                  AND deleted_at = (SELECT occurred_at FROM pg_temp.last('member', pg_temp.m(12)))
             FROM public.members WHERE id = pg_temp.m(12)),
  'RN-06: a exclusão carimba, com deleted_at = updated_at = o momento do evento');
SELECT is((SELECT action::text || '|' || description || '|' || coalesce(changed_fields::text, '-') || '|' || (metadata ->> 'op')
             FROM pg_temp.last('member', pg_temp.m(12))),
  'delete|Excluiu o membro Rita Rocha|{spouse_id}|soft_delete', 'RN-06: o evento da exclusão, com o cônjuge desfeito nos campos');
SELECT is((SELECT jsonb_build_object('desc', description, 'by', actor_label, 'reason', metadata ->> 'reason', 'n', count(*) OVER ())
             FROM pg_temp.evs('member', pg_temp.m(13), (SELECT s FROM m10))),
  '{"desc": "Vínculo de cônjuge desfeito pela exclusão de Rita Rocha", "by": "Ana Auditora", "reason": "spouse_deleted", "n": 1}'::jsonb,
  'RN-05: a exclusão de Rita carimba Hugo, com o evento do E2.01');
SELECT ok((SELECT updated_by = pg_temp.m(2) FROM public.members WHERE id = pg_temp.m(13)), 'RN-05: Hugo fica com Ana como última alteração');
CREATE TEMP TABLE rita0 AS SELECT deleted_at, updated_at FROM public.members WHERE id = pg_temp.m(12);
UPDATE public.members SET deleted_at = now() - interval '1 day' WHERE id = pg_temp.m(12);
SELECT ok((SELECT m.deleted_at = r.deleted_at AND m.updated_at = r.updated_at FROM public.members m, rita0 r WHERE m.id = pg_temp.m(12)),
  'RN-06: excluir de novo (mesmo direto, como postgres) não muda nada');
SELECT is(pg_temp.api(2, format('SELECT to_jsonb(r) - ''role_name'' - ''previous_leader_name'' FROM public.restore_member(%L) r', pg_temp.m(12))),
  '{"restored_without_leader": false, "role_reset_to_default": false}'::jsonb, 'Ana restaura Rita');
SELECT ok((SELECT deleted_at IS NULL AND deleted_by IS NULL AND deleted_by_kind IS NULL AND updated_by = pg_temp.m(2)
                  AND updated_at = (SELECT occurred_at FROM pg_temp.last('member', pg_temp.m(12)))
             FROM public.members WHERE id = pg_temp.m(12)),
  'RN-06: depois de restaurado, a última alteração é a restauração; os dados da exclusão saem');
SELECT is((SELECT action::text || '|' || description FROM pg_temp.last('member', pg_temp.m(12))), 'restore|Restaurou o membro Rita Rocha',
  'RN-06: o evento da restauração');

-- DA-5: excluir uma função que um excluído tinha conta como alteração dele.
SELECT is(pg_temp.api(2, $$SELECT to_jsonb(public.save_role(NULL, 'Temporária E205', NULL, '{view_dashboard}', false, NULL))$$) ? 'error', false,
  'Ana cria a função Temporária E205');
UPDATE public.members SET role_id = pg_temp.role('Temporária E205') WHERE id = pg_temp.m(13);
SELECT is(pg_temp.api(2, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(13))), '""'::jsonb, 'Ana exclui Hugo, que tinha a Temporária');
CREATE TEMP TABLE m11 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format('SELECT to_jsonb(public.delete_role(%L))', pg_temp.role('Temporária E205'))), '""'::jsonb,
  'Ana exclui a função Temporária E205');
SELECT is((SELECT jsonb_build_object('by', actor_label, 'changes', changes) FROM pg_temp.evs('member', pg_temp.m(13), (SELECT s FROM m11))),
  jsonb_build_object('by', 'Ana Auditora', 'changes', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object(
    'field', 'role_id', 'from', 'Temporária E205', 'to', NULL, 'from_id', (SELECT entity_id FROM public.events WHERE entity = 'role' AND action = 'delete' AND seq > (SELECT s FROM m11)), 'to_id', NULL)))),
  'DA-5: a limpeza da função do excluído é alteração dele, com Ana como autora');

-- ===========================================================================
-- 6. Células e relatórios (RN-01, RN-04 d, RN-13 b, RN-20) — 13
-- ===========================================================================
CREATE TEMP TABLE m12 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$UPDATE public.cells SET meeting_time = '00:05', street = 'Rua Nova', is_active = true WHERE id = %L$$, pg_temp.c(1))) ->> 'ok', 'true',
  'Ana muda o horário e a rua da célula de Davi (e manda a situação igual)');
SELECT is((SELECT jsonb_build_object('label', entity_label, 'desc', description, 'changes', changes) FROM pg_temp.evs('cell', pg_temp.c(1), (SELECT s FROM m12))),
  '{"label": "Célula de Davi Duarte", "desc": "Alterou a célula de Davi Duarte",
    "changes": {"fields": [{"field": "meeting_time", "from": "00:00:00", "to": "00:05:00"}, {"field": "street"}]}}'::jsonb,
  'RN-13 c/RN-20: a rua da célula aparece (sem valor); o horário com o antes e o depois');
SELECT ok((SELECT updated_by = pg_temp.m(2) AND created_by_kind = 'system' FROM public.cells WHERE id = pg_temp.c(1)),
  'RN-01: a célula guarda quem alterou');

CREATE TEMP TABLE m13 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(3, format($$SELECT to_jsonb(r) - 'report_id' FROM public.save_cell_report(NULL,
                                   jsonb_build_object('cell_id', %L::uuid, 'date', public.sp_today(), 'time', '19:30', 'theme', 'Fé',
                                                      'offering', 50, 'visitors', ARRAY['Visitante Um'], 'id', gen_random_uuid()),
                                   ARRAY[%L, %L, %L, %L, %L, %L, %L, %L]::uuid[]) r$$,
                                  pg_temp.c(1), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), pg_temp.m(6), pg_temp.m(14), pg_temp.m(30),
                                  pg_temp.m(31), pg_temp.m(15))),
  '{"changed": true}'::jsonb, 'DT-09: Davi envia o relatório com 8 participantes numa chamada (save_cell_report)');
CREATE TEMP TABLE rep AS SELECT id FROM public.cell_reports WHERE cell_id = pg_temp.c(1) AND deleted_at IS NULL;
SELECT is((SELECT count(*)::int FROM public.events WHERE seq > (SELECT s FROM m13)), 1,
  'RN-04 d: o envio com 8 participantes dá um evento só');
SELECT is((SELECT jsonb_build_object('action', action, 'by', actor_label, 'n', jsonb_array_length(changes #> '{participants,sent}'),
                                     'fields', changes -> 'fields', 'desc', description ~ '^Enviou o relatório de \d{2}/\d{2}/\d{4} da célula de Davi Duarte$')
             FROM pg_temp.last('cell_report', (SELECT id FROM rep))),
  '{"action": "create", "by": "Davi Duarte", "n": 8, "fields": [], "desc": true}'::jsonb,
  'RN-04 d/RN-20 e: o envio traz os 8 participantes enviados, com "Enviou" e a data dd/mm/aaaa');
SELECT ok((SELECT updated_at IS NULL AND updated_by_kind IS NULL AND created_by = pg_temp.m(3) FROM public.cell_reports WHERE id = (SELECT id FROM rep)),
  'RN-04 d: logo depois de enviar, o relatório mostra só "Enviado por"');

CREATE TEMP TABLE m14 AS SELECT pg_temp.mark() AS s;
-- E2.11 PR 2: incluir depois do envio é edição, pela save_cell_report (o conjunto final).
SELECT is(pg_temp.api(3, format($$SELECT to_jsonb(r) - 'report_id' FROM public.save_cell_report(%L, '{}',
                                   ARRAY[%L, %L, %L, %L, %L, %L, %L, %L, %L]::uuid[]) r$$,
                                  (SELECT id FROM rep), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), pg_temp.m(6), pg_temp.m(14),
                                  pg_temp.m(30), pg_temp.m(31), pg_temp.m(15), pg_temp.m(12))),
  '{"changed": true}'::jsonb,
  'Davi inclui Rita depois, pela API');
SELECT is((SELECT jsonb_build_object('action', action, 'participants', changes -> 'participants', 'n', count(*) OVER ())
             FROM pg_temp.evs('cell_report', (SELECT id FROM rep), (SELECT s FROM m14))),
  jsonb_build_object('action', 'update', 'n', 1, 'participants', jsonb_build_object(
    'added', jsonb_build_array(jsonb_build_object('id', pg_temp.m(12), 'name', 'Rita Rocha')), 'removed', '[]'::jsonb)),
  'RN-04 d/RN-13 b: incluir um participante depois é alteração do relatório, num evento');
SELECT ok((SELECT updated_by = pg_temp.m(3) AND updated_at = (SELECT occurred_at FROM pg_temp.last('cell_report', (SELECT id FROM rep)))
             FROM public.cell_reports WHERE id = (SELECT id FROM rep)),
  'RN-04 d: e carimba o relatório (o momento do evento)');

CREATE TEMP TABLE m15 AS SELECT pg_temp.mark() AS s;
-- E2.11: o líder, o timóteo e o anfitrião registrados (Davi, Otávio e Paula) não saem (RN-11).
SELECT is(pg_temp.api(3, format($$SELECT to_jsonb(r) - 'report_id' FROM public.save_cell_report(%L, '{"offering": 80, "theme": "Fé"}',
                                   ARRAY[%L, %L, %L, %L]::uuid[]) r$$, (SELECT id FROM rep), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), pg_temp.m(6))),
  '{"changed": true}'::jsonb, 'Davi altera a oferta e deixa só 4 participantes (os registrados e Caio)');
SELECT is((SELECT jsonb_build_object('n', count(*) OVER (), 'fields', changes -> 'fields',
                                     'added', jsonb_array_length(changes #> '{participants,added}'),
                                     'removed', jsonb_array_length(changes #> '{participants,removed}'))
             FROM pg_temp.evs('cell_report', (SELECT id FROM rep), (SELECT s FROM m15))),
  '{"n": 1, "fields": [{"field": "offering", "from": 50.00, "to": 80}], "added": 0, "removed": 5}'::jsonb,
  'RN-13 b/RN-20: um evento com a oferta (número) e os 5 retirados');
SELECT is(pg_temp.api(3, format($$SELECT to_jsonb(r) - 'report_id' FROM public.save_cell_report(%L, '{"offering": 80.00}', ARRAY[%L, %L, %L, %L]::uuid[]) r$$,
                                  (SELECT id FROM rep), pg_temp.m(6), pg_temp.m(4), pg_temp.m(3), pg_temp.m(5))),
  '{"changed": false}'::jsonb, 'AQ-7/RN-04 b: salvar o relatório sem mudança devolve changed = false');

-- ===========================================================================
-- 7. RN-15: funções — 11
-- ===========================================================================
CREATE TEMP TABLE m16 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, $$SELECT to_jsonb(public.save_role(NULL, 'Secretaria E205', 'Atende', '{view_dashboard,view_all_church}', false, NULL))$$) ? 'error', false,
  'Ana cria a função Secretaria E205 com duas permissões');
CREATE TEMP TABLE sec AS SELECT pg_temp.role('Secretaria E205') AS id;
SELECT is((SELECT jsonb_build_object('n', count(*) OVER (), 'action', action, 'desc', description, 'changes', changes, 'by', actor_label)
             FROM public.events WHERE seq > (SELECT s FROM m16)),
  '{"n": 1, "action": "create", "desc": "Criou a função Secretaria E205", "by": "Ana Auditora",
    "changes": {"fields": [], "permissions": {"all": ["view_dashboard", "view_all_church"]}}}'::jsonb,
  'RN-15: criar é um evento só, com o nome e as permissões');
CREATE TEMP TABLE m17 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$SELECT to_jsonb(public.save_role(%L, 'Secretaria Geral E205', 'Atende bem', '{view_dashboard,view_sensitive_data}', false, NULL))$$,
                                  (SELECT id FROM sec))) ? 'error', false,
  'Ana renomeia, muda a descrição e troca uma permissão');
SELECT is((SELECT jsonb_build_object('n', count(*) OVER (), 'action', action, 'desc', description, 'changes', changes)
             FROM public.events WHERE seq > (SELECT s FROM m17)),
  '{"n": 1, "action": "update", "desc": "Alterou a função Secretaria Geral E205",
    "changes": {"fields": [{"field": "name", "from": "Secretaria E205", "to": "Secretaria Geral E205"}, {"field": "description"}],
                "permissions": {"added": ["view_sensitive_data"], "removed": ["view_all_church"]}}}'::jsonb,
  'RN-15/P-AUD-23: um evento com o nome antes e depois, a descrição só pelo nome e as permissões incluídas e retiradas');
CREATE TEMP TABLE m18 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$SELECT to_jsonb(public.save_role(%L, 'Secretaria Geral E205', 'Atende bem', '{view_dashboard,view_sensitive_data}', false, NULL))$$,
                                  (SELECT id FROM sec))) ? 'error', false, 'Ana salva a função sem mudança');
SELECT is((SELECT count(*)::int FROM public.events WHERE seq > (SELECT s FROM m18)), 0, 'RN-15: salvar sem mudança não gera evento');
CREATE TEMP TABLE m19 AS SELECT pg_temp.mark() AS s, (SELECT id FROM public.roles WHERE is_default) AS prev;
SELECT is(pg_temp.api(2, format($$SELECT to_jsonb(public.save_role(%L, 'Secretaria Geral E205', 'Atende bem', '{view_dashboard,view_sensitive_data}', true, NULL))$$,
                                  (SELECT id FROM sec))) ? 'error', false, 'Ana torna a Secretaria Geral E205 a função padrão');
SELECT is((SELECT jsonb_build_object('n', count(*) OVER (), 'id', entity_id, 'desc', description, 'default', changes -> 'default_role')
             FROM public.events WHERE seq > (SELECT s FROM m19)),
  jsonb_build_object('n', 1, 'id', (SELECT id FROM sec),
    'desc', 'Secretaria Geral E205 passou a ser a função padrão (antes: ' || (SELECT name FROM public.roles WHERE id = (SELECT prev FROM m19)) || ')',
    'default', jsonb_build_object('current', jsonb_build_object('id', (SELECT id FROM sec), 'name', 'Secretaria Geral E205'),
                                  'previous', jsonb_build_object('id', (SELECT prev FROM m19), 'name', (SELECT name FROM public.roles WHERE id = (SELECT prev FROM m19))))),
  'RN-15/DA-10: só a troca da padrão: um evento, na nova, com a atual e a anterior; a anterior sem evento');
SELECT is(pg_temp.api(2, format($$SELECT to_jsonb(public.save_role(%L, name, description, ARRAY(SELECT permission FROM public.role_permissions WHERE role_id = %L), true, NULL)) FROM public.roles WHERE id = %L$$,
                                  (SELECT prev FROM m19), (SELECT prev FROM m19), (SELECT prev FROM m19))) ? 'error', false,
  'Ana devolve a padrão à função de antes');
CREATE TEMP TABLE m20 AS SELECT pg_temp.mark() AS s, (SELECT jsonb_agg(permission::text ORDER BY permission) FROM public.role_permissions WHERE role_id = (SELECT id FROM sec)) AS perms;
SELECT is(pg_temp.api(2, format('SELECT to_jsonb(public.delete_role(%L))', (SELECT id FROM sec))), '""'::jsonb, 'Ana exclui a Secretaria Geral E205');
SELECT is((SELECT jsonb_build_object('n', count(*) OVER (), 'action', action, 'desc', description, 'all', changes #> '{permissions,all}')
             FROM public.events WHERE seq > (SELECT s FROM m20)),
  jsonb_build_object('n', 1, 'action', 'delete', 'desc', 'Excluiu a função Secretaria Geral E205', 'all', (SELECT perms FROM m20)),
  'RN-15: a exclusão, com o nome e as permissões que a função tinha (o evento continua depois que ela some)');

-- ===========================================================================
-- 8. RN-14: tudo ou nada (a Auditoria quebrada por um CHECK em events) — 10
-- ===========================================================================
CREATE FUNCTION pg_temp.snap() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(concat_ws('#',
    (SELECT string_agg(to_jsonb(m)::text, ';' ORDER BY m.id) FROM public.members m),
    (SELECT string_agg(to_jsonb(c)::text, ';' ORDER BY c.id) FROM public.cells c),
    (SELECT string_agg(to_jsonb(r)::text, ';' ORDER BY r.id) FROM public.cell_reports r),
    (SELECT string_agg(p.report_id::text || p.member_id::text, ';' ORDER BY p.report_id, p.member_id) FROM public.cell_report_participants p),
    (SELECT string_agg(to_jsonb(r)::text, ';' ORDER BY r.id) FROM public.roles r),
    (SELECT string_agg(rp.role_id || rp.permission::text, ';' ORDER BY rp.role_id, rp.permission) FROM public.role_permissions rp),
    (SELECT count(*)::text FROM public.events)))
$$;
SELECT is(pg_temp.api(2, $$SELECT to_jsonb(public.save_role(NULL, 'Vazia E205', NULL, '{view_dashboard}', false, NULL))$$) ? 'error', false,
  'Ana cria a função Vazia E205 (sem membros), para a exclusão com a Auditoria quebrada');
ALTER TABLE public.events ADD CONSTRAINT e205_qa_broken CHECK (false) NOT VALID;
CREATE TEMP TABLE broken AS SELECT pg_temp.snap() AS v;
CREATE TEMP TABLE rn14 (path text, sql text, who int);
INSERT INTO rn14 VALUES
  ('PATCH de membro', format($$UPDATE public.members SET notes = 'quebrado' WHERE id = %L$$, pg_temp.m(5)), 2),
  ('cadastro de membro', format($$INSERT INTO public.members (name, gender, leader_id, has_leadership, mobile_whatsapp) VALUES ('Quebra Teste', 'F', %L, true, %L)$$, pg_temp.m(3), pg_temp.mob(40)), 2),
  ('célula', format($$UPDATE public.cells SET neighborhood = 'Quebrado' WHERE id = %L$$, pg_temp.c(1)), 2),
  ('save_cell_report', format($$SELECT to_jsonb(r) FROM public.save_cell_report(%L, '{"theme": "Quebrado"}', ARRAY[%L, %L, %L, %L, %L]::uuid[]) r$$,
                              (SELECT id FROM rep), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), pg_temp.m(6), pg_temp.m(14)), 3),
  ('save_role', $$SELECT to_jsonb(public.save_role(NULL, 'Quebrada E205', NULL, '{view_dashboard}', false, NULL))$$, 2),
  ('delete_role', format('SELECT to_jsonb(public.delete_role(%L))', pg_temp.role('Vazia E205')), 2),
  ('delete_member', format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(31)), 2),
  ('restore_member', format('SELECT to_jsonb(r) FROM public.restore_member(%L) r', pg_temp.m(13)), 2);
SELECT is((SELECT array_agg(path || ' → ' || coalesce(pg_temp.api(who, sql) ->> 'error', 'gravou') ORDER BY path) FROM rn14
            WHERE pg_temp.api(who, sql) ->> 'error' IS DISTINCT FROM '23514'),
  NULL, 'RN-14: com a Auditoria quebrada, cada caminho recusa com o erro do evento (23514)');
SELECT is(pg_temp.snap(), (SELECT v FROM broken), 'RN-14: e nada muda (registro, autoria, participantes, funções, eventos)');
ALTER TABLE public.events DROP CONSTRAINT e205_qa_broken;
CREATE TEMP TABLE m21 AS SELECT pg_temp.mark() AS s;
SELECT is(pg_temp.api(2, format($$UPDATE public.members SET notes = 'de novo' WHERE id = %L$$, pg_temp.m(5))) ->> 'ok', 'true',
  'RN-14: com a Auditoria de volta, a nova tentativa grava');
SELECT is(pg_temp.nev('member', pg_temp.m(5), (SELECT s FROM m21)), 1, 'RN-14: uma vez só');

-- ===========================================================================
-- 9. RN-20: os textos gravados nunca têm data aaaa-mm-dd — 1
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.events WHERE entity <> 'auth' AND (description ~ '\d{4}-\d{2}-\d{2}' OR entity_label ~ '\d{4}-\d{2}-\d{2}')), 0,
  'RN-20 e: nenhuma descrição ou registro de evento com data aaaa-mm-dd');

-- Revisão do PR 1: entrada sem a célula ou em formato inválido volta como app_error, nunca como erro cru.
SELECT is(pg_temp.api(3, $$SELECT to_jsonb(r) FROM public.save_cell_report(NULL, '{}') r$$),
  '{"error": "22023", "code": "cell_required"}'::jsonb, 'save_cell_report sem a célula: app_error cell_required');
SELECT is(pg_temp.api(3, format($$SELECT to_jsonb(r) FROM public.save_cell_report(NULL, jsonb_build_object('cell_id', %L::uuid, 'date', 'não é data')) r$$, pg_temp.c(1))),
  '{"error": "22023", "code": "report_date_invalid"}'::jsonb, 'save_cell_report com data inválida: app_error report_date_invalid (E2.11)');

SELECT * FROM finish();
ROLLBACK;
