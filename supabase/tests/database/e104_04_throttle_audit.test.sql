-- E1.04 (PR 1): contagem e bloqueio (RN-10 a RN-12), retenção (RN-11), Auditoria (RN-15),
-- P-LOG-12 e DT-19.
-- Spec: docs/specs/e1-04-sign-in.md, "Contagem e bloqueio", "Auditoria", DT-05, DT-06, DT-19, DA-1, DA-2, DA-7, DA-8, DA-12.
--
-- Cobre, mexendo nos horários das linhas de private.sign_in_throttle (sem esperar o relógio):
--   - RN-10: 4 falhas e a 5ª com outra forma do mesmo celular dá locked (15 min); a senha certa durante o
--     bloqueio dá locked com o tempo restante, sem estender; o e-mail de Ana segue livre; o bloqueio vencido
--     zera a contagem; o sucesso zera a identificação; identificação inexistente também bloqueia; janela de 15 min;
--     CPF e celular no mesmo número contam nas duas chaves (DA-7);
--   - RN-11: origem com 20 falhas; o sucesso não zera a origem; IPv6 por /64 e IPv4 mapeado; nada em claro na tabela;
--   - RN-12: 30 segundos viram "1 minuto"; vale o maior prazo entre identificação e origem;
--   - RN-15: um evento por falha (reason, tipo, máscara certos), um por bloqueio e nenhum pelas recusadas;
--     sign_in_record_login grava o autor e o cadastro; nada de senha, identificação completa ou origem; Lia não lê;
--     RN-15 g: com um CHECK em events, a RPC responde igual;
--   - P-LOG-12: sem a chave do Vault a RPC dá erro e nada é contado; origem inválida idem;
--   - DT-19: pg_sleep(5.2) + sign_in_attempt no mesmo comando dá 57014 e nada é contado nem registrado.
-- A trava da linha além do lock_timeout e as tentativas simultâneas ficam em
-- supabase/tests/concurrency/e104_concurrency.sh.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(129);

-- ---------------------------------------------------------------------------
-- Ids fixos: u = auth, m = membros, role = funções.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a1040300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c1040300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b1040300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

-- Origens: cada tentativa usa uma origem nova (198.18.x.y), para o limite por origem não
-- interferir, a menos que o teste passe a origem de propósito.
CREATE TEMP SEQUENCE origin_seq;
CREATE FUNCTION pg_temp.next_origin() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT '198.18.' || ((n / 250) % 250)::text || '.' || ((n % 250) + 1)::text FROM (SELECT nextval('origin_seq') AS n) s
$$;

-- Chama a RPC como service_role (o papel da Edge Function). Devolve o jsonb da RPC ou
-- {"error": "<SQLSTATE>", "message": ...}.
CREATE FUNCTION pg_temp.att(_identifier text, _password text, _origin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _msg text; _o text := coalesce(_origin, pg_temp.next_origin());
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    _out := public.sign_in_attempt(_identifier, _password, _o);
    EXECUTE 'RESET ROLE';
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('error', _state, 'message', _msg);
  END;
END $$;
-- Só o campo result (ou "ERR <SQLSTATE>").
CREATE FUNCTION pg_temp.res(_identifier text, _password text, _origin text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$ SELECT coalesce(r ->> 'result', 'ERR ' || (r ->> 'error')) FROM (SELECT pg_temp.att(_identifier, _password, _origin) AS r) x $$;

-- Zera o controle de tentativas (cada grupo de testes começa limpo).
CREATE FUNCTION pg_temp.reset_throttle() RETURNS void LANGUAGE sql AS $$ DELETE FROM private.sign_in_throttle $$;

-- Linha de controle de uma chave (kind: identifier | origin; _key: 'e:...', 'c:...', 'm:...', 'x:...', 'o:...').
CREATE FUNCTION pg_temp.row_of(_kind text, _key text) RETURNS private.sign_in_throttle LANGUAGE sql STABLE AS
$$ SELECT t FROM private.sign_in_throttle t WHERE t.kind = _kind AND t.key_hash = private.sign_in_key(_kind, _key) $$;
CREATE FUNCTION pg_temp.nfail(_kind text, _key text) RETURNS int LANGUAGE sql STABLE AS
$$ SELECT cardinality((pg_temp.row_of(_kind, _key)).failures) $$;

-- Eventos de autenticação novos desde a última chamada (e os marca como vistos).
CREATE TEMP TABLE seen_events (id uuid PRIMARY KEY);
CREATE FUNCTION pg_temp.take() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(e) - 'id' - 'occurred_at' - 'changed_fields' ORDER BY e.action, e.id), '[]')
    INTO _out
    FROM public.events e
   WHERE e.entity = 'auth' AND e.id NOT IN (SELECT id FROM seen_events);
  INSERT INTO seen_events SELECT id FROM public.events WHERE id NOT IN (SELECT id FROM seen_events);
  RETURN _out;
END $$;
-- O primeiro evento novo, ou NULL.
CREATE FUNCTION pg_temp.take1() RETURNS jsonb LANGUAGE sql AS $$ SELECT (pg_temp.take()) -> 0 $$;

-- Executa _sql como o usuário do Auth número _n (autenticado) e devolve o primeiro valor como texto.
CREATE FUNCTION pg_temp.val(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _out text; _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'RESET ROLE';
    RETURN 'ERR ' || _state;
  END;
END $$;

-- Tentativa + o evento de Auditoria que ela gerou (o primeiro, em ordem de ação), numa chamada só:
-- devolve "<result>|<reason>" (reason "-" quando não houve evento).
CREATE FUNCTION pg_temp.fr(_identifier text, _password text, _origin text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE _r jsonb; _e jsonb;
BEGIN
  _r := pg_temp.att(_identifier, _password, _origin);
  _e := pg_temp.take() -> 0;
  RETURN coalesce(_r ->> 'result', 'ERR ' || (_r ->> 'error')) || '|' || coalesce(_e #>> '{metadata,reason}', '-');
END $$;
-- Tentativa + o primeiro evento gerado (jsonb), descartando a resposta.
CREATE FUNCTION pg_temp.fev(_identifier text, _password text, _origin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.att(_identifier, _password, _origin);
  RETURN pg_temp.take() -> 0;
END $$;

-- ---------------------------------------------------------------------------
-- Massa (dados fictícios). Contas com bcrypt de custo 10, como em produção.
-- 1 Ana, 2 Bruno (e-mail fictício), 3 Carla (conta com e-mail antigo), 4 Hugo, 5 Gabi,
-- 6 Ivo, 7 Joana, 8 Davi, 9 Elisa, 10 Otávio, 11 Paula, 12 Rita (excluída), 13 Sílvia,
-- 14 Ulisses, 15 Léo, 16 Quintino (sem conta), 17 Nina (inativa), 18 Samuel (pastor),
-- 19 Lia (função sem permissões), 20 Marcos (senha " Fé 2024"), 21 Tiago (123456),
-- 22 Una (e-mail não confirmado), 23 Beto (banido), 24 Dora (conta apagada no Auth),
-- 25 Sônia (sem senha), 26 Wilma (hash que não é bcrypt), 27 Sol (SSO), 28 Pedro (senha de 72 bytes),
-- 29 Rosa (excluída e depois restaurada), 30 Adriana (todas as permissões), 31 conta sem cadastro,
-- 32 Aurora (view_audit_log).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, banned_until, deleted_at, is_sso_user)
SELECT pg_temp.u(n),
       CASE n WHEN 1 THEN 'ana.souza@exemplo.com' WHEN 3 THEN 'carla@antigo.com'
              WHEN 2 THEN 'bruno_k3j9x2@mci12fakemail.com' WHEN 31 THEN 'orfa@exemplo.com'
              ELSE 'e104-' || n || '@exemplo.com' END,
       CASE n WHEN 25 THEN ''
              WHEN 26 THEN '5f4dcc3b5aa765d61d8327deb882cf99'
              ELSE extensions.crypt(CASE n WHEN 20 THEN ' Fé 2024' WHEN 21 THEN '123456' WHEN 28 THEN repeat('x', 72)
                                           ELSE 'Senha#' || n END, extensions.gen_salt('bf', 10)) END,
       CASE n WHEN 22 THEN NULL ELSE now() END,
       CASE n WHEN 23 THEN now() + interval '10 years' END,
       CASE n WHEN 24 THEN now() END,
       n = 27
  FROM generate_series(1, 32) n WHERE n <> 16;

INSERT INTO public.roles (id, name) VALUES
  (pg_temp.role(1), 'E104 todas'), (pg_temp.role(2), 'E104 sem permissões'), (pg_temp.role(3), 'E104 auditoria');
INSERT INTO public.role_permissions (role_id, permission)
SELECT pg_temp.role(1), p FROM unnest(enum_range(NULL::public.permission_action)) p;
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(3), 'view_audit_log'), (pg_temp.role(3), 'view_members');

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, auth_user_id, email, cpf, mobile_whatsapp) VALUES
  (pg_temp.m(18), 'Samuel Pastor E104', 'M', true, NULL, false, true, pg_temp.u(18), 'e104-18@exemplo.com', NULL, NULL);
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, email, cpf, mobile_whatsapp)
SELECT pg_temp.m(v.n), v.name, v.gender, pg_temp.m(18), true, v.n <> 17,
       CASE WHEN v.n = 16 THEN NULL ELSE pg_temp.u(v.n) END,
       CASE v.n WHEN 19 THEN pg_temp.role(2) WHEN 30 THEN pg_temp.role(1) WHEN 32 THEN pg_temp.role(3) END,
       v.email, v.cpf, v.mobile
  FROM (VALUES
    (1,  'Ana Souza',        'F', 'ana.souza@exemplo.com',            '529.982.247-25', '(51) 98888-7777'),
    (2,  'Bruno Brito',      'M', 'bruno_k3j9x2@mci12fakemail.com',   NULL,             '(51) 97777-6666'),
    (3,  'Carla Campos',     'F', 'carla@novo.com',                   NULL,             NULL),
    (4,  'Hugo Hoffmann',    'M', 'e104-4@exemplo.com',               NULL,             '(55) 99999-1234'),
    (5,  'Gabi Gomes',       'F', 'e104-5@exemplo.com',               NULL,             '(51) 8877-6655'),
    (6,  'Ivo Imhof',        'M', 'e104-6@exemplo.com',               NULL,             '(51) 98888-5555'),
    (7,  'Joana Jardim',     'F', 'e104-7@exemplo.com',               NULL,             '(51) 8888-5555'),
    (8,  'Davi Dias',        'M', 'e104-8@exemplo.com',               '519.888.877-04', NULL),
    (9,  'Elisa Esteves',    'F', 'e104-9@exemplo.com',               NULL,             '(51) 98888-7704'),
    (10, 'Otávio Ortiz',     'M', 'e104-10@exemplo.com',              NULL,             '(51) 96666-5555'),
    (11, 'Paula Prado',      'F', 'e104-11@exemplo.com',              '111.444.777-35', '(51) 96666-5555'),
    (12, 'Rita Rocha',       'F', 'e104-12@exemplo.com',              '390.533.447-05', '(51) 95555-4444'),
    (13, 'Sílvia Silva',     'F', 'e104-13@exemplo.com',              NULL,             '(51) 95555-4444'),
    (14, 'Ulisses Uchoa',    'M', 'e104-14@exemplo.com',              '168.995.350-09', '16899535009'),
    (15, 'Léo Leal',         'M', 'e104-15@exemplo.com',              '012.345.678-90', NULL),
    (16, 'Quintino Quadros', 'M', NULL,                               NULL,             '(51) 94444-3333'),
    (17, 'Nina Nunes',       'F', 'e104-17@exemplo.com',              NULL,             NULL),
    (19, 'Lia Lacerda',      'F', 'e104-19@exemplo.com',              NULL,             NULL),
    (20, 'Marcos Moura',     'M', 'e104-20@exemplo.com',              NULL,             NULL),
    (21, 'Tiago Teixeira',   'M', 'e104-21@exemplo.com',              NULL,             NULL),
    (22, 'Una Uchôa',        'F', 'e104-22@exemplo.com',              NULL,             NULL),
    (23, 'Beto Banido',      'M', 'e104-23@exemplo.com',              NULL,             NULL),
    (24, 'Dora Dias',        'F', 'e104-24@exemplo.com',              NULL,             NULL),
    (25, 'Sônia Sem Senha',  'F', 'e104-25@exemplo.com',              NULL,             NULL),
    (26, 'Wilma Wolff',      'F', 'e104-26@exemplo.com',              NULL,             NULL),
    (27, 'Sol Sso',          'F', 'e104-27@exemplo.com',              NULL,             NULL),
    (28, 'Pedro Prado',      'M', 'e104-28@exemplo.com',              NULL,             NULL),
    (29, 'Rosa Ramos',       'F', 'e104-29@exemplo.com',              '746.971.314-01', '(51) 94545-4545'),
    (30, 'Adriana Admin',    'F', 'e104-30@exemplo.com',              NULL,             NULL),
    (32, 'Aurora Auditoria', 'F', 'e104-32@exemplo.com',              NULL,             NULL)
  ) AS v(n, name, gender, email, cpf, mobile);

-- Rita e Rosa são excluídas pela RPC real (E2.01): a conta fica suspensa.
SELECT pg_temp.val(30, format('SELECT public.delete_member(%L)', pg_temp.m(12)));
SELECT pg_temp.val(30, format('SELECT public.delete_member(%L)', pg_temp.m(29)));

-- Tudo o que a massa gravou na Auditoria já foi visto.
SELECT pg_temp.take();

-- Execução de SQL como service_role, devolvendo o SQLSTATE ('00000' quando deu certo).
CREATE FUNCTION pg_temp.sr(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    RETURN '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'RESET ROLE';
    RETURN _state;
  END;
END $$;
-- Fotografia da tabela de controle (para "nada foi contado").
CREATE FUNCTION pg_temp.throttle_snap() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT md5(coalesce(string_agg(concat_ws('|', kind, encode(key_hash, 'hex'), failures::text, blocked_until::text, expires_at::text), ';'
                                            ORDER BY kind, key_hash), '')) FROM private.sign_in_throttle $$;
-- O evento de um tipo dentro de uma lista de eventos (jsonb).
CREATE FUNCTION pg_temp.ev_of(_list jsonb, _action text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS
$$ SELECT e FROM jsonb_array_elements(_list) e WHERE e ->> 'action' = _action LIMIT 1 $$;

-- Origens fixas destes testes (o contador automático nunca chega a 198.18.250.x).
-- O1 sucesso não zera a origem; O2 bloqueio por origem; O3 identificação e origem bloqueadas; O4 e O5 prazos.

-- ===========================================================================
-- RN-10: limite por identificação
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT pg_temp.take();
SELECT is(pg_temp.res('(51) 98888-7777', 'errada-1'), 'invalid', 'RN-10: 1ª tentativa errada com o celular de Ana, mensagem única');
SELECT is(pg_temp.res('51988887777', 'errada-2'), 'invalid', 'RN-10: 2ª, outra forma do mesmo celular');
SELECT is(pg_temp.res('(51) 8888-7777', 'errada-3'), 'invalid', 'RN-10: 3ª, sem o 9º dígito');
SELECT is(pg_temp.res('5551988887777', 'errada-4'), 'invalid', 'RN-10: 4ª, com o 55');
SELECT is(pg_temp.nfail('identifier', 'm:5188887777'), 4, 'RN-10, DT-05: as quatro formas contam na mesma chave m:');
SELECT pg_temp.take();
CREATE TEMP TABLE lock5 AS SELECT pg_temp.att('+55 51 98888-7777', 'errada-5') AS j;
SELECT is((SELECT j ->> 'result' FROM lock5), 'locked', 'RN-10: a 5ª falha, com outra forma do celular, já responde bloqueio');
SELECT is((SELECT (j ->> 'retry_after_minutes')::int FROM lock5), 15, 'RN-12: "Aguarde 15 minutos"');
SELECT ok((SELECT (j ->> 'retry_after_seconds')::int BETWEEN 898 AND 900 FROM lock5), 'RN-10: retry_after_seconds é cerca de 900');
SELECT is((SELECT array_agg(k ORDER BY k) FROM lock5, jsonb_object_keys(j) k),
  ARRAY['result', 'retry_after_minutes', 'retry_after_seconds']::text[], 'Contrato: o bloqueio tem só result e os dois prazos');
CREATE TEMP TABLE ev5 AS SELECT pg_temp.take() AS j;
SELECT is((SELECT jsonb_array_length(j) FROM ev5), 2, 'RN-15 c: a 5ª falha gera dois eventos: a falha e o bloqueio');
SELECT is((SELECT pg_temp.ev_of(j, 'login_failed') #>> '{metadata,reason}' FROM ev5), 'wrong_password', 'RN-15 b: a falha que disparou o bloqueio é registrada');
SELECT is((SELECT pg_temp.ev_of(j, 'login_blocked') - 'entity_label' FROM ev5),
  jsonb_build_object('action', 'login_blocked', 'entity', 'auth', 'entity_id', pg_temp.m(1), 'actor_user_id', NULL, 'actor_label', NULL,
    'description', 'Login bloqueado por excesso de tentativas', 'success', false, 'error_reason', NULL,
    'metadata', jsonb_build_object('block_scope', 'identifier', 'block_minutes', 15, 'identifier_type', 'mobile', 'identifier_masked', '***7777')),
  'RN-15 c, DA-8: um evento de bloqueio por identificação, ligado a Ana, com tipo, máscara e 15 minutos');
SELECT is((SELECT pg_temp.ev_of(j, 'login_blocked') ->> 'entity_label' FROM ev5), 'Ana Souza', 'RN-15 c: com o nome do cadastro');
SELECT ok((SELECT blocked_until BETWEEN clock_timestamp() + interval '14 minutes' AND clock_timestamp() + interval '15 minutes'
             FROM private.sign_in_throttle WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'm:5188887777')),
  'RN-10: o bloqueio dura 15 minutos a partir da 5ª falha');
SELECT is(pg_temp.nfail('identifier', 'm:5188887777'), 0, 'RN-10: e as falhas voltam a zero');
SELECT ok((pg_temp.row_of('identifier', 'm:5188887777')).expires_at >= (pg_temp.row_of('identifier', 'm:5188887777')).blocked_until,
  'RN-11: expires_at cobre o bloqueio inteiro');

-- Durante o bloqueio: nada é conferido, contado, estendido nem registrado.
CREATE TEMP TABLE bu0 AS SELECT blocked_until AS v FROM private.sign_in_throttle
  WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'm:5188887777');
CREATE TEMP TABLE during AS SELECT i, pg_temp.att('(51) 98888-7777', CASE WHEN i % 2 = 0 THEN 'Senha#1' ELSE 'errada-x' END) AS j
  FROM generate_series(1, 10) i;
SELECT is((SELECT count(*)::int FROM during WHERE j ->> 'result' = 'locked'), 10,
  'RN-10: as 10 tentativas durante o bloqueio, com a senha certa ou errada, recebem a mensagem de bloqueio');
SELECT is(pg_temp.take(), '[]'::jsonb, 'RN-15 c: nenhuma das 10 tentativas recusadas gera evento');
SELECT is((SELECT blocked_until FROM private.sign_in_throttle WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'm:5188887777')),
  (SELECT v FROM bu0), 'RN-10: nem estendem o bloqueio');
SELECT is(pg_temp.nfail('identifier', 'm:5188887777'), 0, 'RN-10: nem somam falha');
SELECT is((SELECT banned_until IS NULL FROM auth.users WHERE id = pg_temp.u(1)), true, 'RN-12: o bloqueio não muda a conta');

-- RN-12: o tempo restante (mexendo no horário da linha, sem esperar o relógio).
UPDATE private.sign_in_throttle SET blocked_until = clock_timestamp() + interval '10 minutes', expires_at = clock_timestamp() + interval '10 minutes'
 WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'm:5188887777');
CREATE TEMP TABLE bu1 AS SELECT blocked_until AS v FROM private.sign_in_throttle
  WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'm:5188887777');
CREATE TEMP TABLE lock10 AS SELECT pg_temp.att('(51) 98888-7777', 'Senha#1') AS j;
SELECT is((SELECT j ->> 'result' FROM lock10), 'locked', 'RN-10: 5 minutos depois, a senha certa no celular continua bloqueada');
SELECT is((SELECT (j ->> 'retry_after_minutes')::int FROM lock10), 10, 'RN-10: "Aguarde 10 minutos"');
SELECT is((SELECT blocked_until FROM private.sign_in_throttle WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'm:5188887777')),
  (SELECT v FROM bu1), 'RN-10: o bloqueio continua terminando no mesmo horário');
SELECT is(pg_temp.res('ana.souza@exemplo.com', 'Senha#1'), 'ok', 'RN-10: o bloqueio é só da identificação: Ana entra com o e-mail');

-- RN-12: 30 segundos viram "1 minuto"; fim do bloqueio zera a contagem.
UPDATE private.sign_in_throttle SET blocked_until = clock_timestamp() + interval '30 seconds'
 WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'm:5188887777');
CREATE TEMP TABLE lock30 AS SELECT pg_temp.att('(51) 98888-7777', 'Senha#1') AS j;
SELECT is((SELECT (j ->> 'retry_after_minutes')::int FROM lock30), 1, 'RN-12: com 30 segundos restantes, "Aguarde 1 minuto"');
SELECT ok((SELECT (j ->> 'retry_after_seconds')::int BETWEEN 28 AND 30 FROM lock30), 'RN-12: retry_after_seconds reflete os 30 segundos');
UPDATE private.sign_in_throttle SET blocked_until = clock_timestamp() - interval '1 second'
 WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'm:5188887777');
SELECT is(pg_temp.res('(51) 98888-7777', 'errada-depois'), 'invalid', 'RN-12: com o bloqueio vencido, uma falha é só uma falha (mensagem única)');
SELECT is(pg_temp.nfail('identifier', 'm:5188887777'), 1, 'RN-12: a contagem recomeçou do zero');
SELECT is((pg_temp.row_of('identifier', 'm:5188887777')).blocked_until, NULL, 'RN-12: e o bloqueio vencido foi limpo');
SELECT is(pg_temp.res('(51) 98888-7777', 'Senha#1'), 'ok', 'RN-10: terminado o bloqueio, Ana entra com o celular');
SELECT is(pg_temp.nfail('identifier', 'm:5188887777'), 0, 'RN-10: o sucesso zera a contagem da identificação');

-- RN-10: identificação que não existe também bloqueia, sem revelar nada.
SELECT pg_temp.reset_throttle();
SELECT pg_temp.take();
SELECT is(pg_temp.res('51911112222', 'x1'), 'invalid', 'RN-10: identificação inexistente, 1ª');
SELECT is(pg_temp.res('51911112222', 'x2'), 'invalid', 'RN-10: 2ª');
SELECT is(pg_temp.res('(51) 91111-2222', 'x3'), 'invalid', 'RN-10: 3ª');
SELECT is(pg_temp.res('+55 51 91111-2222', 'x4'), 'invalid', 'RN-10: 4ª');
SELECT pg_temp.take();
CREATE TEMP TABLE lock_ghost AS SELECT pg_temp.att('51911112222', 'x5') AS j;
SELECT is((SELECT j - 'retry_after_seconds' FROM lock_ghost), '{"result": "locked", "retry_after_minutes": 15}'::jsonb,
  'RN-10: a 5ª recebe o bloqueio, igual ao de Ana');
CREATE TEMP TABLE ev_ghost AS SELECT pg_temp.take() AS j;
SELECT is((SELECT pg_temp.ev_of(j, 'login_blocked') -> 'entity_id' FROM ev_ghost), 'null'::jsonb,
  'DA-8: o bloqueio da identificação que não existe não fica ligado a nenhum cadastro');
SELECT is((SELECT pg_temp.ev_of(j, 'login_blocked') #>> '{metadata,identifier_masked}' FROM ev_ghost), '***2222', 'RN-15 c: com a máscara');

-- RN-10: o sucesso zera a identificação (as duas chaves de um número que é CPF e celular, DA-7).
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('529.982.247-25', 'e1'), 'invalid', 'RN-10: Ana, CPF, falha 1');
SELECT is(pg_temp.res('52998224725', 'e2'), 'invalid', 'RN-10: falha 2');
SELECT is(pg_temp.res('529 982 247 25', 'e3'), 'invalid', 'RN-10: falha 3');
SELECT is(pg_temp.res('529.982.247-25', 'e4'), 'invalid', 'RN-10: falha 4');
SELECT is(ARRAY[pg_temp.nfail('identifier', 'c:52998224725'), pg_temp.nfail('identifier', 'm:5298224725')], ARRAY[4, 4],
  'DA-7: um número que é CPF e celular conta nas duas chaves (c: e m:)');
SELECT is(pg_temp.res('529.982.247-25', 'Senha#1'), 'ok', 'RN-10: um login com sucesso depois de 4 falhas');
SELECT is(ARRAY[pg_temp.nfail('identifier', 'c:52998224725'), pg_temp.nfail('identifier', 'm:5298224725')], ARRAY[0, 0],
  'RN-10, DA-7: o sucesso zera as duas chaves');
SELECT is(pg_temp.res('529.982.247-25', 'e5'), 'invalid', 'RN-10: mais uma falha vira a primeira, sem bloqueio');
SELECT is(ARRAY[pg_temp.nfail('identifier', 'c:52998224725'), pg_temp.nfail('identifier', 'm:5298224725')], ARRAY[1, 1],
  'RN-10: e a contagem é 1');

-- RN-10: o bloqueio de uma das chaves vale para o número inteiro (DA-7).
SELECT pg_temp.reset_throttle();
INSERT INTO private.sign_in_throttle (kind, key_hash, failures, blocked_until, expires_at)
VALUES ('identifier', private.sign_in_key('identifier', 'c:52998224725'), '{}', clock_timestamp() + interval '7 minutes', clock_timestamp() + interval '7 minutes');
SELECT is(pg_temp.att('(51) 98888-7777', 'Senha#1') ->> 'result', 'ok',
  'DA-7: o celular de Ana (outro número) não é afetado pelo bloqueio do CPF dela');
SELECT is(pg_temp.att('529.982.247-25', 'Senha#1') ->> 'result', 'locked', 'DA-7: o CPF bloqueado bloqueia o número que também é celular');

-- RN-11: janela deslizante de 15 minutos.
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('janela@teste.invalid', 'x'), 'invalid', 'RN-10: cria a linha da identificação');
UPDATE private.sign_in_throttle SET failures = ARRAY[now() - interval '17 minutes', now() - interval '16 minutes',
  now() - interval '16 minutes 30 seconds', now() - interval '20 minutes']
 WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'e:janela@teste.invalid');
SELECT is(pg_temp.res('janela@teste.invalid', 'x'), 'invalid', 'RN-10: 4 falhas com mais de 15 minutos não somam: a próxima não bloqueia');
SELECT is(pg_temp.nfail('identifier', 'e:janela@teste.invalid'), 1, 'RN-10: as falhas fora da janela saíram da contagem');

-- ===========================================================================
-- RN-11: limite por origem
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT pg_temp.take();
SELECT is(pg_temp.res('origem-1@teste.invalid', 'x', '198.18.250.2'), 'invalid', 'RN-11: cria a linha da origem');
UPDATE private.sign_in_throttle SET failures = (SELECT array_agg(clock_timestamp() - interval '10 minutes' + (i || ' seconds')::interval) FROM generate_series(1, 19) i)
 WHERE kind = 'origin' AND key_hash = private.sign_in_key('origin', 'o:198.18.250.2');
SELECT is(pg_temp.nfail('origin', 'o:198.18.250.2'), 19, 'RN-11: 19 falhas da mesma origem, com identificações diferentes, em 10 minutos');
SELECT pg_temp.take();
CREATE TEMP TABLE lock_origin AS SELECT pg_temp.att('ana.souza@exemplo.com', 'errada-origem', '198.18.250.2') AS j;
SELECT is((SELECT j ->> 'result' FROM lock_origin), 'locked', 'RN-11: a 20ª falha recebe a mensagem de bloqueio');
SELECT is((SELECT (j ->> 'retry_after_minutes')::int FROM lock_origin), 15, 'RN-11: por 15 minutos');
CREATE TEMP TABLE ev_origin AS SELECT pg_temp.take() AS j;
SELECT is((SELECT jsonb_array_length(j) FROM ev_origin), 2, 'RN-15 c: a falha e um bloqueio (só o da origem; a identificação de Ana não chegou a 5)');
SELECT is((SELECT pg_temp.ev_of(j, 'login_blocked') -> 'metadata' FROM ev_origin), '{"block_scope": "origin", "block_minutes": 15}'::jsonb,
  'RN-15 c: o bloqueio por origem não traz identificação, tipo nem endereço');
SELECT is((SELECT pg_temp.ev_of(j, 'login_blocked') -> 'entity_id' FROM ev_origin), 'null'::jsonb, 'DA-8: o bloqueio por origem nunca fica ligado a um cadastro');
SELECT is((SELECT pg_temp.ev_of(j, 'login_blocked')::text LIKE '%198.18.%' FROM ev_origin), false, 'RN-15 d: a origem não vai para a Auditoria');
SELECT is(pg_temp.att('ana.souza@exemplo.com', 'Senha#1', '198.18.250.2') ->> 'result', 'locked',
  'RN-11: durante o bloqueio, Ana com a senha certa, vinda dessa origem, não entra');
SELECT is(pg_temp.att('e104-9@exemplo.com', 'Senha#9', '198.18.250.2') ->> 'result', 'locked', 'RN-11: nem qualquer outra identificação dessa origem');
SELECT is(pg_temp.take(), '[]'::jsonb, 'RN-11, RN-15 c: as recusadas não geram evento');
SELECT is(pg_temp.att('ana.souza@exemplo.com', 'Senha#1', '198.18.250.3') ->> 'result', 'ok', 'RN-11: Ana, ao mesmo tempo, de outra origem, entra');
SELECT is(pg_temp.nfail('origin', 'o:198.18.250.2'), 0, 'RN-11: a origem bloqueada não soma falha');

-- RN-11: o sucesso não zera a origem.
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('origem-2@teste.invalid', 'x', '198.18.250.1'), 'invalid', 'RN-11: cria a linha da origem');
UPDATE private.sign_in_throttle SET failures = (SELECT array_agg(clock_timestamp() - interval '10 minutes' + (i || ' seconds')::interval) FROM generate_series(1, 15) i)
 WHERE kind = 'origin' AND key_hash = private.sign_in_key('origin', 'o:198.18.250.1');
SELECT is(pg_temp.att('e104-5@exemplo.com', 'Senha#5', '198.18.250.1') ->> 'result', 'ok', 'RN-11: um login com sucesso depois de 15 falhas da origem');
SELECT is(pg_temp.nfail('origin', 'o:198.18.250.1'), 15, 'RN-11: o sucesso não zera a contagem da origem');
CREATE TEMP TABLE more5 AS SELECT i, pg_temp.res('mais-' || i || '@teste.invalid', 'x', '198.18.250.1') AS r FROM generate_series(1, 5) i;
SELECT is((SELECT array_agg(r ORDER BY i) FROM more5), ARRAY['invalid', 'invalid', 'invalid', 'invalid', 'locked']::text[],
  'RN-11: mais 5 falhas dentro dos 15 minutos bloqueiam a origem (15 + 5 = 20, na 5ª)');
SELECT is(pg_temp.res('e104-5@exemplo.com', 'Senha#5', '198.18.250.1'), 'locked', 'RN-11: e a origem fica bloqueada');

-- RN-12: identificação e origem bloqueadas: vale o maior prazo.
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('ana.souza@exemplo.com', 'x', '198.18.250.4'), 'invalid', 'RN-12: cria as linhas da identificação e da origem');
UPDATE private.sign_in_throttle SET blocked_until = clock_timestamp() + interval '4 minutes', expires_at = clock_timestamp() + interval '4 minutes'
 WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'e:ana.souza@exemplo.com');
UPDATE private.sign_in_throttle SET blocked_until = clock_timestamp() + interval '12 minutes', expires_at = clock_timestamp() + interval '12 minutes'
 WHERE kind = 'origin' AND key_hash = private.sign_in_key('origin', 'o:198.18.250.4');
SELECT is((pg_temp.att('ana.souza@exemplo.com', 'Senha#1', '198.18.250.4') ->> 'retry_after_minutes')::int, 12,
  'RN-12: identificação com 4 minutos e origem com 12: "Aguarde 12 minutos"');
UPDATE private.sign_in_throttle SET blocked_until = clock_timestamp() + interval '14 minutes', expires_at = clock_timestamp() + interval '14 minutes'
 WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'e:ana.souza@exemplo.com');
SELECT is((pg_temp.att('ana.souza@exemplo.com', 'Senha#1', '198.18.250.4') ->> 'retry_after_minutes')::int, 14,
  'RN-12: e o contrário: identificação com 14 e origem com 12 dão 14');

-- RN-11: IPv6 pelo /64 e IPv4 mapeado como o IPv4.
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('v6-a@teste.invalid', 'x', '2001:db8:abcd:12::1'), 'invalid', 'DA-2: falha vinda de um endereço IPv6');
SELECT is(pg_temp.res('v6-b@teste.invalid', 'x', '2001:db8:abcd:12:ffff:ffff:ffff:ffff'), 'invalid', 'DA-2: falha vinda de outro endereço do mesmo /64');
SELECT is(pg_temp.nfail('origin', 'o:2001:db8:abcd:12::/64'), 2, 'DA-2: as duas contam na mesma origem (o /64)');
SELECT is(pg_temp.res('v6-c@teste.invalid', 'x', '2001:db8:abcd:13::1'), 'invalid', 'DA-2: outro /64');
SELECT is(pg_temp.nfail('origin', 'o:2001:db8:abcd:13::/64'), 1, 'DA-2: é outra origem');
SELECT is(pg_temp.res('v4-a@teste.invalid', 'x', '::ffff:198.18.250.9'), 'invalid', 'DT-06: falha vinda de IPv4 mapeado');
SELECT is(pg_temp.res('v4-b@teste.invalid', 'x', '198.18.250.9'), 'invalid', 'DT-06: falha vinda do IPv4 puro');
SELECT is(pg_temp.nfail('origin', 'o:198.18.250.9'), 2, 'DT-06: contam como a mesma origem');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle WHERE kind = 'origin'), 3,
  'DT-06: o IPv4 mapeado não criou uma linha própria (3 origens: os dois /64 e o 198.18.250.9)');

-- P-LOG-12: origem inválida é erro do servidor e nada é contado.
SELECT pg_temp.reset_throttle();
SELECT pg_temp.take();
SELECT is(pg_temp.att('ana.souza@exemplo.com', 'errada', 'isto-nao-e-um-ip') ->> 'error', '22023', 'DA-1, P-LOG-12: origem inválida é erro (22023), não "senha errada"');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle), 0, 'P-LOG-12: nada foi contado');
SELECT is(pg_temp.take(), '[]'::jsonb, 'P-LOG-12: nem registrado');

-- RN-11: nada em claro na tabela de controle; expires_at.
SELECT pg_temp.reset_throttle();
SELECT pg_temp.res('ana.souza@exemplo.com', 'errada', '198.18.250.20');
SELECT pg_temp.res('52998224725', 'errada', '198.18.250.20');
SELECT pg_temp.res('(51) 98888-7777', 'errada', '198.18.250.20');
SELECT pg_temp.res('ana.souza', 'errada', '198.18.250.20');
SELECT cmp_ok((SELECT count(*)::int FROM private.sign_in_throttle), '>=', 6, 'RN-11: as tentativas geraram linhas (identificação e origem)');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle t
            WHERE t::text ILIKE ANY (ARRAY['%ana.souza%', '%exemplo.com%', '%52998224725%', '%98888%', '%198.18.%', '%errada%'])
               OR position(convert_to('ana.souza', 'UTF8') IN t.key_hash) > 0
               OR position(convert_to('198.18.250.20', 'UTF8') IN t.key_hash) > 0
               OR position(convert_to('52998224725', 'UTF8') IN t.key_hash) > 0), 0,
  'RN-11, RN-09: nenhuma linha contém e-mail, CPF, celular, IP ou senha (nem em hexadecimal)');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle WHERE octet_length(key_hash) <> 32), 0, 'RN-11: toda chave é um HMAC-SHA256 de 32 bytes');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle WHERE expires_at < clock_timestamp() + interval '14 minutes' OR expires_at > clock_timestamp() + interval '15 minutes 5 seconds'), 0,
  'RN-11: expires_at é a hora da falha mais 15 minutos');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle WHERE cardinality(failures) > 20), 0, 'RN-11: o CHECK limita as falhas guardadas');

-- ===========================================================================
-- RN-15: Auditoria
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT pg_temp.take();
-- (a) Login realizado, gravado pela sign_in_record_login depois de a sessão ser emitida.
SELECT is(pg_temp.att('529.982.247-25', 'Senha#1') ->> 'identifier_type', 'cpf', 'RN-15: Ana entra pelo CPF');
SELECT is(pg_temp.take(), '[]'::jsonb, 'RN-15 a, DA-12: a decisão de entrar não grava o login (só depois da sessão)');
SELECT is(pg_temp.sr(format($q$SELECT public.sign_in_record_login(%L, %L, 'cpf', '***4725')$q$, pg_temp.m(1), pg_temp.u(1))), '00000',
  'RN-15 a: sign_in_record_login roda como service_role');
CREATE TEMP TABLE ev_login AS SELECT pg_temp.take() AS j;
SELECT is((SELECT jsonb_array_length(j) FROM ev_login), 1, 'RN-15 a: um registro por login');
SELECT is((SELECT (j -> 0) - 'entity_label' - 'actor_label' FROM ev_login),
  jsonb_build_object('action', 'login', 'entity', 'auth', 'entity_id', pg_temp.m(1), 'actor_user_id', pg_temp.u(1),
    'description', 'Login realizado', 'success', true, 'error_reason', NULL,
    'metadata', jsonb_build_object('identifier_type', 'cpf', 'identifier_masked', '***4725')),
  'RN-15 a: "Login realizado", com Ana como autora, ligado ao cadastro, tipo CPF e máscara');
SELECT is((SELECT j -> 0 ->> 'entity_label' FROM ev_login), 'Ana Souza', 'RN-15 a: entity_label é o nome do cadastro');
SELECT is(pg_temp.sr(format($q$SELECT public.sign_in_record_login(%L, %L, 'email', 'x***@y.z')$q$, pg_temp.m(2), pg_temp.u(1))) <> '00000'
          OR jsonb_array_length(pg_temp.take()) = 0, true,
  'RN-15 a, DA-12: o cadastro precisa ser dessa conta: um par que não combina é recusado ou ignorado, sem registro');
SELECT is(pg_temp.take(), '[]'::jsonb, 'RN-15 a: e nada ficou gravado pelo par errado');

-- (b) Falha no login: um registro por falha, com o motivo.
SELECT is((pg_temp.fev('ana.souza@exemplo.com', 'errada') - 'actor_label'),
  jsonb_build_object('action', 'login_failed', 'entity', 'auth', 'entity_id', pg_temp.m(1), 'entity_label', 'Ana Souza', 'actor_user_id', NULL,
    'description', 'Falha no login', 'success', false, 'error_reason', 'Senha incorreta',
    'metadata', jsonb_build_object('reason', 'wrong_password', 'identifier_type', 'email', 'identifier_masked', 'a***@exemplo.com')),
  'RN-15 b: senha errada de Ana pelo e-mail: ligada a Ana, "Senha incorreta", e-mail mascarado');
SELECT is((pg_temp.fev('ninguem@exemplo.com', 'errada') - 'actor_label'),
  jsonb_build_object('action', 'login_failed', 'entity', 'auth', 'entity_id', NULL, 'entity_label', NULL, 'actor_user_id', NULL,
    'description', 'Falha no login', 'success', false, 'error_reason', 'Identificação não encontrada',
    'metadata', jsonb_build_object('reason', 'not_found', 'identifier_type', 'email', 'identifier_masked', 'n***@exemplo.com')),
  'RN-15 b: identificação que não existe: sem ligação com nenhum cadastro');
SELECT is((pg_temp.fev('ana.souza', 'errada') - 'actor_label'),
  jsonb_build_object('action', 'login_failed', 'entity', 'auth', 'entity_id', NULL, 'entity_label', NULL, 'actor_user_id', NULL,
    'description', 'Falha no login', 'success', false, 'error_reason', 'Identificação inválida',
    'metadata', jsonb_build_object('reason', 'invalid_identifier', 'identifier_masked', 'a***a')),
  'RN-15 b: identificação inválida pela API: sem tipo (a chave identifier_type não existe) e sem ligação');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fev('51988887704', 'x') #>> '{metadata,identifier_type}', 'cpf_or_mobile', 'RN-15: Davi e Elisa, o número procurado como os dois: "CPF ou celular"');
SELECT is(pg_temp.fev('51988887704', 'x') ->> 'error_reason', 'Identificação ambígua', 'RN-05, RN-15: o motivo "Identificação ambígua"');
SELECT is(pg_temp.fev('123.456.789-09', 'x') #>> '{metadata,identifier_type}', 'cpf_or_mobile',
  'RN-15: CPF válido que não está em nenhum cadastro, nem como celular: "CPF ou celular"');
SELECT is(pg_temp.fev('(51) 91111-3333', 'x') #>> '{metadata,identifier_type}', 'mobile', 'RN-15: celular que não é CPF válido: "Celular"');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fev('e104-12@exemplo.com', 'x') ->> 'error_reason', 'Cadastro excluído', 'RN-06, RN-15: "Cadastro excluído"');
SELECT is(pg_temp.fev('(51) 94444-3333', 'x') ->> 'error_reason', 'Sem conta de acesso', 'RN-06, RN-15: "Sem conta de acesso"');
SELECT is(pg_temp.fev('e104-23@exemplo.com', 'x') ->> 'error_reason', 'Conta de acesso indisponível', 'RN-06, RN-15: "Conta de acesso indisponível"');
SELECT is(pg_temp.fev('bruno_k3j9x2@mci12fakemail.com', 'x') #>> '{metadata,reason}', 'not_found', 'RN-01: o e-mail fictício dá "não encontrada"');

-- (d) Nada de senha, identificação completa nem origem na Auditoria.
SELECT is((SELECT count(*)::int FROM public.events e
            WHERE e.entity = 'auth'
              AND (e::text ILIKE ANY (ARRAY['%errada%', '%Senha#%', '%98888-7777%', '%5198888%', '%52998224725%', '%529.982.247%',
                                            '%ana.souza@exemplo.com%', '%198.18.%', '%2001:db8%', '%123.456.789%', '%12345678909%']))), 0,
  'RN-15 d, RN-09: nenhum evento de autenticação contém senha, identificação completa ou origem');

-- (f) Só quem tem view_audit_log lê.
SELECT is(pg_temp.val(19, $q$SELECT count(*) FROM public.events WHERE entity = 'auth'$q$), '0',
  'RN-15 f: Lia, sem view_audit_log, não vê nenhum evento de autenticação');
SELECT cmp_ok(CASE WHEN v ~ '^[0-9]+$' THEN v::int ELSE -1 END, '>', 0,
  'RN-15 f: Aurora, com view_audit_log, vê')
FROM (SELECT pg_temp.val(32, $q$SELECT count(*) FROM public.events WHERE entity = 'auth'$q$) AS v) x;

-- ===========================================================================
-- P-LOG-12 e RN-15 g: a Auditoria que falha não muda a resposta; Vault ausente é erro e nada conta
-- ===========================================================================
SELECT pg_temp.reset_throttle();
CREATE FUNCTION pg_temp.attempt_with_failing_audit() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r1 jsonb; _r2 jsonb; _n1 int; _blocked boolean; _events int;
BEGIN
  BEGIN
    ALTER TABLE public.events ADD CONSTRAINT e104_no_login_events CHECK (action NOT IN ('login_failed', 'login_blocked')) NOT VALID;
    _r1 := pg_temp.att('audit-falha@teste.invalid', 'x');
    _n1 := pg_temp.nfail('identifier', 'e:audit-falha@teste.invalid');
    UPDATE private.sign_in_throttle
       SET failures = ARRAY[now() - interval '3 minutes', now() - interval '2 minutes', now() - interval '1 minute', now() - interval '30 seconds']
     WHERE kind = 'identifier' AND key_hash = private.sign_in_key('identifier', 'e:audit-falha@teste.invalid');
    _r2 := pg_temp.att('audit-falha@teste.invalid', 'x');
    _blocked := (pg_temp.row_of('identifier', 'e:audit-falha@teste.invalid')).blocked_until IS NOT NULL;
    SELECT count(*) INTO _events FROM public.events WHERE entity = 'auth' AND action IN ('login_failed', 'login_blocked')
       AND id NOT IN (SELECT id FROM seen_events);
    RAISE EXCEPTION 'undo e104';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'undo e104' THEN RAISE; END IF;
  END;
  RETURN jsonb_build_object('r1', _r1, 'n1', _n1, 'r2', _r2, 'blocked', _blocked, 'events', _events);
END $$;
CREATE TEMP TABLE audit_fail AS SELECT pg_temp.attempt_with_failing_audit() AS j;
SELECT is((SELECT j -> 'r1' FROM audit_fail), '{"result": "invalid"}'::jsonb, 'RN-15 g, P-LOG-12: com a gravação da Auditoria falhando, a falha responde igual');
SELECT is((SELECT (j ->> 'n1')::int FROM audit_fail), 1, 'RN-15 g: e a falha foi contada');
SELECT is((SELECT j -> 'r2' ->> 'result' FROM audit_fail), 'locked', 'RN-15 g: o bloqueio também responde igual');
SELECT is((SELECT (j ->> 'blocked')::boolean FROM audit_fail), true, 'RN-15 g: e o bloqueio foi gravado na tabela de controle');
SELECT is((SELECT (j ->> 'events')::int FROM audit_fail), 0, 'RN-15 g: o CHECK de fato impediu os eventos (o teste não é vazio)');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conname = 'e104_no_login_events'), 0, 'RN-15 g: o CHECK do teste foi desfeito');

SELECT pg_temp.reset_throttle();
CREATE FUNCTION pg_temp.attempt_without_vault_key() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _id uuid; _r jsonb; _before text; _after text; _events int;
BEGIN
  _before := pg_temp.throttle_snap();
  BEGIN
    SELECT id INTO _id FROM vault.decrypted_secrets WHERE name = 'sign_in_throttle_key';
    PERFORM vault.update_secret(_id, new_name => 'sign_in_throttle_key_ausente');
    _r := pg_temp.att('ana.souza@exemplo.com', 'errada');
    _after := pg_temp.throttle_snap();
    SELECT count(*) INTO _events FROM public.events WHERE entity = 'auth' AND id NOT IN (SELECT id FROM seen_events);
    RAISE EXCEPTION 'undo e104';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'undo e104' THEN RAISE; END IF;
  END;
  RETURN jsonb_build_object('r', _r, 'same', _before = _after, 'events', _events);
END $$;
CREATE TEMP TABLE no_vault AS SELECT pg_temp.attempt_without_vault_key() AS j;
SELECT isnt((SELECT j -> 'r' ->> 'error' FROM no_vault), NULL, 'P-LOG-12: sem a chave do Vault, a RPC dá erro (não é "senha errada")');
SELECT is((SELECT j -> 'r' ->> 'result' FROM no_vault), NULL, 'P-LOG-12: e nenhuma decisão é devolvida');
SELECT is((SELECT (j ->> 'same')::boolean FROM no_vault), true, 'P-LOG-12: nada foi contado');
SELECT is((SELECT (j ->> 'events')::int FROM no_vault), 0, 'P-LOG-12: nem registrado');
SELECT is((SELECT count(*)::int FROM vault.decrypted_secrets WHERE name = 'sign_in_throttle_key'), 1, 'P-LOG-12: o teste devolveu a chave ao Vault');

-- DT-19: o teto de 5 s dentro da função. O pg_sleep e a RPC no mesmo comando.
SELECT pg_temp.reset_throttle();
SELECT pg_temp.take();
CREATE FUNCTION pg_temp.slow_attempt(_sleep float8) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    EXECUTE format($f$SELECT pg_sleep(%s), public.sign_in_attempt('ana.souza@exemplo.com', 'errada-lenta', '198.18.250.30')$f$, _sleep);
    EXECUTE 'RESET ROLE';
    RETURN '00000';
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'RESET ROLE';
    RETURN _state;
  END;
END $$;
CREATE TEMP TABLE snap_before AS SELECT pg_temp.throttle_snap() AS s;
SELECT is(pg_temp.slow_attempt(5.2), '57014', 'DT-19: pg_sleep(5.2) e a RPC no mesmo comando dão SQLSTATE 57014');
SELECT is(pg_temp.throttle_snap(), (SELECT s FROM snap_before), 'DT-19: nada foi contado');
SELECT is(pg_temp.take(), '[]'::jsonb, 'DT-19: nem registrado');
SELECT is(pg_temp.slow_attempt(0.1), '00000', 'DT-19 (controle): com 0,1 s de espera a mesma chamada passa');
SELECT is(pg_temp.nfail('identifier', 'e:ana.souza@exemplo.com'), 1, 'DT-19 (controle): e foi contada, então o teste acima não é vazio');

SELECT * FROM finish();

ROLLBACK;
