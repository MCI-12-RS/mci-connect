-- E3.03 (tarefa 6): os critérios de aceite do login com a senha do legado, pela sign_in_attempt
-- (como service_role, o papel da sign-in) e pelas RPCs reais (exclusão, restauração, redefinição,
-- troca obrigatória e o card).
-- Spec: docs/specs/e3-login-legado.md, "Critérios de aceite" (massa Ana a Hugo; RN-18 fica para o
-- E4.08), "Conferência na sign_in_attempt" e DT-05, DT-06, DT-09, DA-2, DA-4.
--
-- Massa (dados fictícios; senhas só de exemplo). Credenciais carregadas pela add_legacy_credential
-- com o md5() da senha (o mesmo do pacote do legado, provado em e3_02_md5_cases):
--   1 Samuel (pastor, Administrador, senha no cofre: quem exclui, restaura, redefine e vê o card)
--   2 Leo (Líder, G12)          3 Ana (só celular, "Graça2024!")      4 Bruno (só CPF, "123456")
--   5 Carla (e-mail e celular, " mesa azul ")   6 Davi (MD5 vazio: sem senha utilizável)
--   7 Edu (excluído, sem conta)  8 Fábio e 9 Gabi (casal, cada um com a sua)  10 Hugo (80 letras)
--   11 Ivo (inativo)  12 Paulo (pastor)  13 Sônia (sem liderança)  14 Marta (Membro, sem o card)
--
-- Autocontido: termina com ROLLBACK. Cada tentativa usa uma origem nova; o controle é zerado entre os
-- grupos, salvo onde o limite é o que se testa.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(86);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a3030000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c3030000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.s(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('5e530000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

CREATE TEMP SEQUENCE origin_seq;
CREATE FUNCTION pg_temp.next_origin() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT '198.18.' || ((n / 250) % 250)::text || '.' || ((n % 250) + 1)::text FROM (SELECT nextval('origin_seq') AS n) s
$$;

-- Como authenticated, com a sessão _n (o portão confere a sessão e a marca).
CREATE FUNCTION pg_temp.api(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _detail text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated', 'session_id', pg_temp.s(_n))::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('error', _state, 'code', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ->> 'code' END);
  END;
END $$;
-- Como service_role (a sign-in, a change-own-password).
CREATE FUNCTION pg_temp.svc(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('error', _state);
  END;
END $$;
CREATE FUNCTION pg_temp.att(_identifier text, _password text, _origin text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.svc(format('SELECT public.sign_in_attempt(%L, %L, %L)', _identifier, _password,
                              coalesce(_origin, pg_temp.next_origin()))) $$;
CREATE FUNCTION pg_temp.res(_identifier text, _password text, _origin text DEFAULT NULL) RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(r ->> 'result', 'ERR ' || (r ->> 'error')) FROM (SELECT pg_temp.att(_identifier, _password, _origin) r) x $$;

CREATE TEMP TABLE seen_events (id uuid PRIMARY KEY);
CREATE FUNCTION pg_temp.see_all() RETURNS void LANGUAGE sql AS
$$ INSERT INTO seen_events SELECT id FROM public.events ON CONFLICT DO NOTHING $$;
-- Eventos de autenticação novos (e marca como vistos): ação, motivo, credencial e texto do motivo.
CREATE FUNCTION pg_temp.take() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'action', e.action, 'reason', e.metadata ->> 'reason', 'credential', e.metadata ->> 'credential',
           'error_reason', e.error_reason, 'member', e.entity_id = ANY (ARRAY(SELECT pg_temp.m(g) FROM generate_series(1, 14) g))))
           ORDER BY e.action::text, e.id), '[]')
    INTO _out FROM public.events e
   WHERE e.entity = 'auth' AND e.id NOT IN (SELECT id FROM seen_events);
  PERFORM pg_temp.see_all();
  RETURN _out;
END $$;
-- Tentativa + "<result>|<reason>|<credential>" do evento de falha (ou "-").
CREATE FUNCTION pg_temp.fr(_identifier text, _password text, _origin text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _r jsonb; _e jsonb;
BEGIN
  PERFORM pg_temp.see_all();
  _r := pg_temp.att(_identifier, _password, _origin);
  _e := pg_temp.take() -> 0;
  RETURN coalesce(_r ->> 'result', 'ERR ' || (_r ->> 'error')) || '|' || coalesce(_e ->> 'reason', '-') || '|' || coalesce(_e ->> 'credential', '-');
END $$;

-- Estado da credencial: pending | used (com hash) | discarded | none.
CREATE FUNCTION pg_temp.cred(_n int) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT CASE WHEN c.legacy_hash IS NULL THEN 'discarded'
                               WHEN c.used_at IS NULL THEN 'pending' ELSE 'used' END
                     FROM private.legacy_credentials c WHERE c.member_id = pg_temp.m(_n)), 'none')
$$;
CREATE FUNCTION pg_temp.vault(_n int) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT concat_ws('|', CASE WHEN p.password_hash IS NULL THEN 'no_hash' ELSE 'hash' END, p.must_change_reason)
                     FROM private.account_passwords p WHERE p.auth_user_id = pg_temp.u(_n)), 'no_row')
$$;
CREATE FUNCTION pg_temp.card(_n int DEFAULT 1) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.api(_n, 'SELECT to_jsonb(t) FROM public.dashboard_first_access() t') $$;
-- O "Login realizado" que a sign-in grava depois da sessão (DA-4).
CREATE FUNCTION pg_temp.record(_r jsonb) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.svc(format('SELECT jsonb_build_object(''ok'', true) FROM public.sign_in_record_login(%L, %L, %L, %L, %L)',
                              _r ->> 'member_id', _r ->> 'auth_user_id', _r ->> 'identifier_type', _r ->> 'identifier_masked',
                              _r ->> 'credential')) $$;
CREATE FUNCTION pg_temp.change(_n int, _new text, _req int) RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(r ->> 'code', r ->> 'result', 'ERR ' || (r ->> 'error'))
     FROM (SELECT pg_temp.svc(format('SELECT public.change_own_password(%L, %L, ''forced'', NULL, %L, %L, %L, %L)',
                                     pg_temp.u(_n), pg_temp.s(_n), _new, _new, pg_temp.next_origin(),
                                     ('7e300000-0000-0000-0000-' || lpad(_req::text, 12, '0'))::uuid)) r) x $$;

-- ---------------------------------------------------------------------------
-- Massa.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.u(n), 'e303-' || n || '@teste.invalid', now() FROM generate_series(1, 14) n WHERE n <> 7;
INSERT INTO auth.sessions (id, user_id)
SELECT pg_temp.s(n), pg_temp.u(n) FROM generate_series(1, 14) n WHERE n <> 7;
SELECT private.write_password(pg_temp.u(1), pg_temp.m(1), 'Pastor@Samuel2024', NULL);

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(1),  'Samuel Pastor', 'M', true, NULL, false, true, '51930300001', pg_temp.role('Administrador')),
  (pg_temp.m(12), 'Paulo Pastor',  'M', true, NULL, false, true, '51930300012', pg_temp.role('Membro'));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(13), 'Sônia Semlider', 'F', false, NULL, false, true, '51930300013', pg_temp.role('Membro'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(2), 'Leo Lider', 'M', pg_temp.m(1), true, true, '51930300002', pg_temp.role('Líder'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, role_id, auth_user_id, email, cpf, mobile_whatsapp) VALUES
  (pg_temp.m(3),  'Ana Souza',     'F', pg_temp.m(2), true, true,  pg_temp.role('Membro'), pg_temp.u(3),  NULL, NULL, '(51) 98123-4567'),
  (pg_temp.m(4),  'Bruno Brito',   'M', pg_temp.m(2), true, true,  pg_temp.role('Membro'), pg_temp.u(4),  NULL, '52998224725', NULL),
  (pg_temp.m(5),  'Carla Campos',  'F', pg_temp.m(2), true, true,  pg_temp.role('Membro'), pg_temp.u(5),  'carla.e303@exemplo.com', NULL, '51930300005'),
  (pg_temp.m(6),  'Davi Dias',     'M', pg_temp.m(2), true, true,  pg_temp.role('Membro'), pg_temp.u(6),  'davi.e303@exemplo.com', NULL, NULL),
  (pg_temp.m(7),  'Edu Excluido',  'M', pg_temp.m(2), true, true,  pg_temp.role('Membro'), NULL,          'edu.e303@exemplo.com', NULL, NULL),
  (pg_temp.m(8),  'Fábio Faria',   'M', pg_temp.m(2), true, true,  pg_temp.role('Membro'), pg_temp.u(8),  'fabio.e303@exemplo.com', NULL, NULL),
  (pg_temp.m(9),  'Gabi Faria',    'F', pg_temp.m(2), true, true,  pg_temp.role('Membro'), pg_temp.u(9),  'gabi.e303@exemplo.com', NULL, NULL),
  (pg_temp.m(10), 'Hugo Hoffmann', 'M', pg_temp.m(2), true, true,  pg_temp.role('Membro'), pg_temp.u(10), 'hugo.e303@exemplo.com', NULL, NULL),
  (pg_temp.m(11), 'Ivo Inativo',   'M', pg_temp.m(2), true, false, pg_temp.role('Membro'), pg_temp.u(11), 'ivo.e303@exemplo.com', NULL, NULL),
  (pg_temp.m(14), 'Marta Membro',  'F', pg_temp.m(2), true, true,  pg_temp.role('Membro'), pg_temp.u(14), 'marta.e303@exemplo.com', NULL, NULL);
UPDATE public.members SET spouse_id = pg_temp.m(9) WHERE id = pg_temp.m(8);
UPDATE public.members SET auth_user_id = pg_temp.u(1) WHERE id = pg_temp.m(1);
UPDATE public.members SET auth_user_id = pg_temp.u(2) WHERE id = pg_temp.m(2);
UPDATE public.members SET auth_user_id = pg_temp.u(12) WHERE id = pg_temp.m(12);
UPDATE public.members SET auth_user_id = pg_temp.u(13) WHERE id = pg_temp.m(13);
SELECT private.write_password(pg_temp.u(2), pg_temp.m(2), 'Lider@Leo2024', NULL);
SELECT private.write_password(pg_temp.u(14), pg_temp.m(14), 'Membro@Marta2024', NULL);

-- Edu, excluído no legado, chega excluído e sem conta (RN-09).
SELECT pg_temp.api(1, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(7)));

-- A carga (E4.08): o md5 da senha do legado de cada um.
CREATE TEMP TABLE e303_load AS
SELECT n, private.add_legacy_credential(pg_temp.m(n), md5(pw)) AS outcome
  FROM (VALUES (3, 'Graça2024!'), (4, '123456'), (5, ' mesa azul '), (6, ''), (7, 'Edu@2024x'),
               (8, 'Fabio#Forte1'), (9, 'Gabi#Forte2'), (10, repeat('h', 80)), (11, 'Ivo#Forte11'),
               (12, 'Paulo#Forte12'), (13, 'Sonia#Forte13')) v(n, pw);
SELECT pg_temp.see_all();

SELECT is((SELECT jsonb_object_agg(n, outcome) FROM e303_load),
  '{"3": "created", "4": "created", "5": "created", "6": "unusable_md5", "7": "not_eligible", "8": "created",
    "9": "created", "10": "created", "11": "created", "12": "created", "13": "created"}'::jsonb,
  'RN-01: carga cria a credencial de quem tem conta e senha utilizável; Davi (MD5 vazio) e Edu (excluído, sem conta) ficam sem');
SELECT is(pg_temp.vault(3), 'no_hash', 'RN-01, DT-05: a carga cria a linha do cofre sem hash e sem marca');
SELECT is((SELECT count(*)::int FROM private.legacy_credentials c JOIN public.members m ON m.id = c.member_id
            WHERE c.legacy_hash !~ '^\$2a\$10\$' OR c.legacy_hash ~ '[0-9a-f]{32}'), 0,
  'RN-01: a credencial guarda só bcrypt custo 10, nunca o MD5 legível');
SELECT is(pg_temp.card(), '{"pending": 9, "total": 9}'::jsonb, 'RN-14 b: o card do Administrador: 9 pendentes de 9');
SELECT is(pg_temp.card(2) ->> 'error', '42501', 'RN-14 a: o Líder (sem view_all_church) recebe 42501, nem pela API');
SELECT is(pg_temp.card(14) ->> 'error', '42501', 'RN-14 a: o Membro também');

-- ===========================================================================
-- RN-06: Ana, 5 senhas erradas em 15 min: a 5ª já é bloqueio; a credencial continua e nem a certa entra.
-- ===========================================================================
DELETE FROM private.sign_in_throttle;
SELECT is(pg_temp.res('(51) 98123-4567', 'errada' || g), 'invalid', 'RN-06: Ana, senha errada ' || g || ' de 5')
  FROM generate_series(1, 4) g;
SELECT is(pg_temp.res('(51) 98123-4567', 'errada5'), 'locked', 'RN-06: a 5ª senha errada já é bloqueio');
SELECT is(pg_temp.res('(51) 98123-4567', 'Graça2024!'), 'locked', 'RN-06: durante o bloqueio nem a certa entra');
SELECT is(pg_temp.cred(3), 'pending', 'RN-06: a credencial continua');
SELECT is((SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements_text(
            (SELECT jsonb_agg(DISTINCT e.metadata ->> 'credential') FROM public.events e
              WHERE e.entity_id = pg_temp.m(3) AND e.action = 'login_failed')) x), '["legacy"]'::jsonb,
  'RN-13 c: as falhas conferidas pela credencial levam a informação "Senha do sistema antigo"');
DELETE FROM private.sign_in_throttle;
SELECT pg_temp.see_all();

-- ===========================================================================
-- RN-10: Ana excluída no novo antes do primeiro acesso; restaurada, entra com a senha antiga.
-- ===========================================================================
SELECT is(pg_temp.api(1, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(3))) ? 'error', false,
  'RN-10: Samuel exclui Ana pela RPC (E2.01)');
SELECT is(pg_temp.fr('(51) 98123-4567', 'Graça2024!'), 'invalid|member_deleted|-', 'RN-10: excluída, "Cadastro excluído"');
SELECT is(pg_temp.cred(3), 'pending', 'RN-10: a exclusão não apaga a credencial');
SELECT is(pg_temp.card(), '{"pending": 8, "total": 8}'::jsonb, 'RN-14 d: excluída, sai dos dois números');
SELECT is(pg_temp.api(1, format('SELECT to_jsonb(public.restore_member(%L))', pg_temp.m(3))) ? 'error', false,
  'RN-10: Samuel restaura Ana');
SELECT is(pg_temp.card(), '{"pending": 9, "total": 9}'::jsonb, 'RN-14 d: restaurada, volta aos dois números');
SELECT is(private.add_legacy_credential(pg_temp.m(3), md5('Graça2024!')), 'updated', 'RN-03: carga refeita regrava a pendente');

-- ===========================================================================
-- RN-02, RN-04: Ana, acento e só celular.
-- ===========================================================================
SELECT pg_temp.see_all();
SELECT is(pg_temp.fr('(51) 98123-4567', 'Graca2024!'), 'invalid|wrong_password|legacy', 'RN-02: sem o acento, "Senha incorreta" (credencial legada)');
SELECT is(pg_temp.fr('(51) 98123-4567', 'Grac' || chr(807) || 'a2024!'), 'invalid|wrong_password|legacy', 'RN-02: o "ç" decomposto não confere');
SELECT is(pg_temp.cred(3), 'pending', 'RN-02: a credencial continua');
DELETE FROM private.sign_in_throttle;
CREATE TEMP TABLE r_ana AS SELECT pg_temp.att('(51) 98123-4567', 'Graça2024!') AS r;
SELECT is((SELECT r ->> 'result' FROM r_ana), 'ok', 'RN-04: Ana entra pelo celular com máscara e "Graça2024!"');
SELECT is((SELECT r ->> 'credential' FROM r_ana), 'legacy', 'DA-4: pela credencial legada');
SELECT is((SELECT r ->> 'must_change_password' FROM r_ana), 'false', 'RN-05: senha dentro da política, sem troca');
SELECT is(pg_temp.cred(3), 'discarded', 'RN-04 b: a credencial some');
SELECT is(pg_temp.vault(3), 'hash', 'RN-04 a: a senha vai para o cofre, sem marca');
SELECT is(pg_temp.record((SELECT r FROM r_ana)), '{"ok": true}'::jsonb, 'RN-13 a: sign_in_record_login aceita _credential = legacy');
SELECT is(pg_temp.take(), '[{"action": "login", "credential": "legacy", "member": true}]'::jsonb,
  'RN-13 a: um "Login realizado" com "Senha do sistema antigo"; nenhuma troca exigida');
SELECT is((SELECT r FROM (SELECT pg_temp.att('51981234567', 'Graça2024!') r) x) ->> 'credential', 'account',
  'RN-04, RN-11: sem máscara, a mesma senha continua valendo, agora pela conta');
SELECT is(pg_temp.card(), '{"pending": 8, "total": 9}'::jsonb, 'RN-14: um pendente a menos, o mesmo total');

-- ===========================================================================
-- RN-04, RN-05: Bruno, só CPF, 123456 fora da política.
-- ===========================================================================
SELECT pg_temp.see_all();
CREATE TEMP TABLE r_bruno AS SELECT pg_temp.att('529.982.247-25', '123456') AS r;
SELECT is((SELECT r ->> 'result' || '|' || (r ->> 'credential') || '|' || (r ->> 'must_change_password') FROM r_bruno), 'ok|legacy|true',
  'RN-04, RN-05: Bruno entra pelo CPF com pontos e vai para a troca obrigatória');
SELECT pg_temp.record((SELECT r FROM r_bruno));
SELECT is(pg_temp.take(), '[{"action": "login", "credential": "legacy", "member": true},
                            {"action": "password_change_required", "reason": "legacy_weak", "member": true}]'::jsonb,
  'RN-13 a, b: "Login realizado" (senha do sistema antigo) e "Troca de senha exigida", motivo legacy_weak');
SELECT is(pg_temp.vault(4), 'hash|legacy_weak', 'RN-05: a senha foi gravada e a marca é legacy_weak');
SELECT is(pg_temp.api(4, 'SELECT to_jsonb(count(*)) FROM public.members_view') ->> 'code', 'password_change_required',
  'RN-05: nada além da troca responde pela API (portão do E2.03)');
SELECT is((SELECT r ->> 'must_change_password' FROM (SELECT pg_temp.att('52998224725', '123456') r) x), 'true',
  'RN-05: sai sem trocar e entra de novo (CPF sem pontos): volta à troca');
SELECT is(pg_temp.take(), '[]'::jsonb, 'RN-05: sem novo "Troca de senha exigida"');
SELECT is(pg_temp.change(4, '123456', 1), 'password_too_short', 'RN-05, RN-10 do E2.03: trocar para 123456 é recusado (a política vem antes)');
SELECT is(pg_temp.change(4, 'Bruno#Nova2025', 2), 'ok', 'RN-11: troca para uma senha válida');
SELECT is(pg_temp.fr('52998224725', '123456'), 'invalid|wrong_password|-', 'RN-11: depois da troca, 123456 falha (pela conta)');
SELECT is(pg_temp.card(), '{"pending": 7, "total": 9}'::jsonb, 'RN-14: depois de Ana e Bruno, dois pendentes a menos e o mesmo total');

-- ===========================================================================
-- RN-02: Carla, espaços nas pontas. RN-03: carga refeita não recria.
-- ===========================================================================
SELECT is(pg_temp.fr('carla.e303@exemplo.com', 'mesa azul'), 'invalid|wrong_password|legacy', 'RN-02: sem os espaços, falha');
SELECT is(pg_temp.res('51930300005', ' mesa azul '), 'ok', 'RN-02: com os espaços, entra (pelo celular)');
SELECT is(private.add_legacy_credential(pg_temp.m(5), md5(' mesa azul ')), 'has_password',
  'RN-03: carga refeita para quem já entrou: has_password, nada criado');
SELECT is(pg_temp.cred(5), 'discarded', 'RN-03: Carla continua sem credencial');
SELECT is((SELECT pg_temp.att('carla.e303@exemplo.com', ' mesa azul ') ->> 'credential'), 'account',
  'RN-03: e " mesa azul " continua valendo, pela conta');

-- ===========================================================================
-- RN-05 (acima de 72 bytes): Hugo, 80 letras. RN-14 d: excluído e restaurado.
-- ===========================================================================
SELECT is(pg_temp.api(1, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(10))) ? 'error', false, 'RN-14 d: Samuel exclui Hugo');
SELECT is(pg_temp.card(), '{"pending": 5, "total": 8}'::jsonb, 'RN-14 d: Hugo excluído com credencial pendente: os dois números caem 1');
SELECT pg_temp.api(1, format('SELECT to_jsonb(public.restore_member(%L))', pg_temp.m(10)));
SELECT is(pg_temp.card(), '{"pending": 6, "total": 9}'::jsonb, 'RN-14 d: restaurado, voltam');
SELECT pg_temp.see_all();
SELECT is(pg_temp.fr('hugo.e303@exemplo.com', repeat('h', 72)), 'invalid|wrong_password|legacy', 'RN-05, DT-04: só as 72 primeiras: "Senha incorreta"');
SELECT is((SELECT r ->> 'result' || '|' || (r ->> 'credential') || '|' || (r ->> 'must_change_password')
             FROM (SELECT pg_temp.att('hugo.e303@exemplo.com', repeat('h', 80)) r) x), 'ok|legacy|true',
  'RN-05: com as 80 letras entra e vai para a troca');
SELECT is(pg_temp.cred(10) || '|' || pg_temp.vault(10), 'used|no_hash|legacy_weak', 'DA-2: o cofre não guarda; a credencial fica, usada, com a marca');
SELECT is((SELECT jsonb_agg(x ->> 'action') FROM jsonb_array_elements(pg_temp.take()) x), '["password_change_required"]'::jsonb,
  'RN-13 b: "Troca de senha exigida" na primeira entrada');
SELECT is((SELECT r ->> 'result' || '|' || (r ->> 'credential') || '|' || (r ->> 'must_change_password')
             FROM (SELECT pg_temp.att('hugo.e303@exemplo.com', repeat('h', 80)) r) x), 'ok|legacy|true',
  'RN-05, DA-2: sai sem trocar e entra de novo com as 80: volta à troca');
SELECT is(pg_temp.take(), '[]'::jsonb, 'RN-05: sem novo "Troca de senha exigida"');
SELECT is(pg_temp.fr('hugo.e303@exemplo.com', repeat('h', 72)), 'invalid|wrong_password|legacy', 'RN-05: as 72 primeiras também falham depois da primeira entrada');
SELECT is(pg_temp.card() ->> 'pending', '5', 'DA-2: para o card, Hugo já fez o primeiro acesso');
SELECT is(private.add_legacy_credential(pg_temp.m(10), md5(repeat('h', 80))), 'kept_used', 'RN-03: carga refeita não regrava a credencial usada');
SELECT is((SELECT count(*)::int FROM private.legacy_credential_problems()), 0, 'Reconciliação: a usada com hash e com a marca não é problema');
-- A exclusão encerrou as sessões de Hugo (E2.01); a entrada da sign-in abriria uma nova.
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(10), pg_temp.u(10)) ON CONFLICT DO NOTHING;
SELECT is(pg_temp.change(10, 'Hugo#Nova2025', 3), 'ok', 'DT-04: a troca obrigatória funciona com o cofre sem hash');
SELECT is(pg_temp.cred(10), 'discarded', 'RN-03: a troca apaga a credencial');
SELECT is(pg_temp.fr('hugo.e303@exemplo.com', repeat('h', 80)), 'invalid|wrong_password|-', 'RN-11: depois da troca, as 80 letras falham');
SELECT is(pg_temp.res('hugo.e303@exemplo.com', 'Hugo#Nova2025'), 'ok', 'RN-11: e a nova entra');

-- ===========================================================================
-- RN-08: Davi sem senha utilizável. RN-09: Edu.
-- ===========================================================================
DELETE FROM private.sign_in_throttle;
SELECT pg_temp.see_all();
SELECT is(pg_temp.att('davi.e303@exemplo.com', '123456'), '{"result": "invalid"}'::jsonb, 'RN-08: Davi com 123456: a mensagem única');
SELECT is((SELECT e FROM jsonb_array_elements(pg_temp.take()) e), '{"action": "login_failed", "reason": "no_password", "error_reason": "Sem senha definida", "member": true}'::jsonb,
  'RN-08, RN-13 d: "Sem senha definida", ligado ao cadastro, sem credencial');
SELECT is((SELECT cardinality(t.failures) FROM private.sign_in_throttle t
            WHERE t.kind = 'identifier' AND t.key_hash = private.sign_in_key('identifier', 'e:davi.e303@exemplo.com')), 1,
  'RN-08: a tentativa conta no limite');
SELECT is(pg_temp.card(), '{"pending": 5, "total": 9}'::jsonb, 'RN-14 e: a entrada de Davi não muda nenhum dos dois');
CREATE TEMP TABLE r_davi AS SELECT pg_temp.api(1, format('SELECT public.reset_member_password(%L)', pg_temp.m(6))) AS r;
SELECT is((SELECT r ->> 'result' FROM r_davi), 'ok', 'RN-08: Samuel redefine a senha de Davi');
SELECT is(pg_temp.res('davi.e303@exemplo.com', (SELECT r ->> 'password' FROM r_davi)), 'ok', 'RN-08: Davi entra com a temporária');
SELECT is(pg_temp.fr('edu.e303@exemplo.com', 'Edu@2024x'), 'invalid|member_deleted|-', 'RN-09: Edu: "Cadastro excluído"');

-- ===========================================================================
-- Casal e RN-03, RN-12 (redefinição): Fábio e Gabi.
-- ===========================================================================
SELECT is(pg_temp.fr('fabio.e303@exemplo.com', 'Gabi#Forte2'), 'invalid|wrong_password|legacy', 'Casal: Fábio com a senha de Gabi não entra');
SELECT is(pg_temp.res('fabio.e303@exemplo.com', 'Fabio#Forte1'), 'ok', 'Casal: Fábio entra com a dele');
SELECT is(pg_temp.cred(9), 'pending', 'Casal: a credencial de Gabi continua');
SELECT is(pg_temp.fr('gabi.e303@exemplo.com', 'Fabio#Forte1'), 'invalid|wrong_password|legacy', 'Casal: só a senha de Gabi entra na conta dela');
CREATE TEMP TABLE r_gabi AS SELECT pg_temp.api(1, format('SELECT public.reset_member_password(%L)', pg_temp.m(9))) AS r;
SELECT is(pg_temp.cred(9), 'discarded', 'RN-03: a redefinição apaga a credencial');
SELECT is(pg_temp.fr('gabi.e303@exemplo.com', 'Gabi#Forte2'), 'invalid|wrong_password|-', 'RN-03, RN-12: depois da redefinição, a senha antiga falha');
SELECT is(pg_temp.res('gabi.e303@exemplo.com', (SELECT r ->> 'password' FROM r_gabi)), 'ok', 'RN-12: a temporária entra');
SELECT is(pg_temp.card(), '{"pending": 3, "total": 9}'::jsonb, 'RN-14 e: a redefinição tira dos pendentes como o primeiro acesso');

-- ===========================================================================
-- Inativo, pastor e sem liderança entram como os demais (RN-06 do E1.04).
-- ===========================================================================
SELECT is(pg_temp.res('ivo.e303@exemplo.com', 'Ivo#Forte11'), 'ok', 'Inativo: Ivo entra');
SELECT is(pg_temp.res('51930300012', 'Paulo#Forte12'), 'ok', 'Pastor: Paulo entra');
SELECT is(pg_temp.res('51930300013', 'Sonia#Forte13'), 'ok', 'Sem liderança: Sônia entra');
SELECT is(pg_temp.card(), '{"pending": 0, "total": 9}'::jsonb, 'RN-14 f: o último pendente saiu: pending 0 (o card some na tela)');

-- ===========================================================================
-- RN-13: nada de senha, MD5 ou hash na Auditoria.
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.events e
            WHERE e.entity = 'auth'
              AND (e::text ILIKE ANY (ARRAY['%Graça2024%', '%Graca2024%', '%123456%', '%mesa azul%', '%Forte%', '%hhhhhhhh%',
                                            '%$2a$%', '%' || md5('Graça2024!') || '%', '%' || md5('123456') || '%', '%Nova2025%',
                                            '%98123-4567%', '%52998224725%', '%198.18.%']))), 0,
  'RN-13: nenhum evento traz senha, MD5, hash, identificação completa ou origem');
SELECT is((SELECT count(*)::int FROM private.legacy_credential_problems()), 0, 'Reconciliação: legacy_credential_problems() vazia no fim');

SELECT * FROM finish();

ROLLBACK;
