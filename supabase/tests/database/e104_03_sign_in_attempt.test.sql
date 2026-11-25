-- E1.04 (PR 1): a busca pelo cadastro e a decisão da sign_in_attempt, pela API (RN-01 a RN-09, RN-13, RN-17).
-- Spec: docs/specs/e1-04-sign-in.md, "Critérios de aceite" (massa de pessoas), "Busca pelo cadastro",
-- "Contrato" da RPC e DA-3, DA-5, DA-9.
--
-- Cobre, sempre como service_role (o papel da Edge Function), com contas de bcrypt custo 10:
--   - RN-01 e RN-02: e-mail, celular e CPF de Ana; e-mail fictício de Bruno; e-mail novo e antigo de Carla;
--   - RN-03 e RN-04: formas do celular (55, zeros, 9º dígito, exato primeiro) e do CPF (zero à esquerda, dígito errado);
--   - RN-05: Davi e Elisa, Otávio e Paula, Rita e Sílvia, Ulisses (ambiguidade);
--   - RN-06: Nina, Samuel, Lia, Quintino, Rita e Rosa (excluídas e restaurada), conta sem cadastro, contas indisponíveis;
--   - RN-07: a mesma resposta {"result":"invalid"} nos casos (a) a (g), sem dado do cadastro;
--   - RN-08: campos vazios não contam nem registram; RN-09: senha como digitada, DA-5 (72 bytes);
--   - RN-13 (falha só com "result"), RN-17 (123456 entra; ponto do E3.02 devolve NULL);
--   - o motivo (metadata.reason) de cada falha, pela Auditoria.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK. Cada tentativa usa uma
-- origem nova, e o controle é zerado entre os grupos, para o limite não interferir (ele é testado em e104_04).
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(105);

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
SELECT pg_temp.role(1), p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(3), 'view_audit_log'), (pg_temp.role(3), 'view_all_church');

-- A massa tem celulares equivalentes entre não excluídos (Ivo e Joana, Otávio e
-- Paula, Rita e Sílvia), como os dados anteriores ao E2.04, para provar a
-- correspondência exata e a ambiguidade da sign-in. O índice único do E2.04
-- (RN-09) sai só nesta transação, que termina em ROLLBACK.
DROP INDEX IF EXISTS public.members_mobile_key;

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, auth_user_id, email, cpf, mobile_whatsapp) VALUES
  (pg_temp.m(18), 'Samuel Pastor E104', 'M', true, NULL, false, true, pg_temp.u(18), 'e104-18@exemplo.com', NULL, NULL);
-- E2.04 (DT-23): o cadastro não guarda mais o e-mail fictício (DA-7); a conta
-- de Bruno continua com ele. Joana, Paula e Sílvia repetem o celular de outro
-- cadastro, o que as regras do E2.04 recusam: entram em replica, como dado
-- antigo (os CHECKs e os outros índices valem; os triggers, não).
CREATE TEMP TABLE e104_massa AS SELECT * FROM (VALUES
    (1,  'Ana Souza',        'F', 'ana.souza@exemplo.com',            '529.982.247-25', '(51) 98888-7777'),
    (2,  'Bruno Brito',      'M', NULL,                               NULL,             '(51) 97777-6666'),
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
CREATE FUNCTION pg_temp.load_massa(_replica boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, email, cpf, mobile_whatsapp)
  SELECT pg_temp.m(v.n), v.name, v.gender, pg_temp.m(18), true, v.n <> 17,
         CASE WHEN v.n = 16 THEN NULL ELSE pg_temp.u(v.n) END,
         CASE v.n WHEN 19 THEN pg_temp.role(2) WHEN 30 THEN pg_temp.role(1) WHEN 32 THEN pg_temp.role(3) END,
         v.email, public.normalize_digits(v.cpf), v.mobile   -- CPF gravado só com dígitos (CHECK)
    FROM e104_massa v
   WHERE (v.n IN (7, 11, 13)) = _replica;
$$;
SELECT pg_temp.load_massa(false);
SET LOCAL session_replication_role = replica;
SELECT pg_temp.load_massa(true);
SET LOCAL session_replication_role = origin;

-- Rita e Rosa são excluídas pela RPC real (E2.01): a conta fica suspensa.
SELECT pg_temp.val(30, format('SELECT public.delete_member(%L)', pg_temp.m(12)));
SELECT pg_temp.val(30, format('SELECT public.delete_member(%L)', pg_temp.m(29)));

-- Tudo o que a massa gravou na Auditoria já foi visto.
SELECT pg_temp.take();

-- Guarda: a massa não pode colidir com cadastros que já existam no banco local.
SELECT is((SELECT count(*)::int FROM public.members
            WHERE id::text NOT LIKE 'c1040300%'
              AND (public.normalize_digits(cpf) IN ('52998224725', '51988887704', '39053344705', '16899535009', '01234567890', '11144477735', '74697131401')
                OR public.mobile_match_key(mobile_whatsapp) IN ('5188887777', '5599991234', '5188776655', '5188885555', '5188887704', '5166665555', '5155554444', '1689953509', '5177776666', '5144443333', '5145454545')
                OR public.normalize_email(email) IN ('ana.souza@exemplo.com', 'carla@novo.com', 'carla@antigo.com'))), 0,
  'Massa: nenhum cadastro real do banco local usa as identificações da massa (senão o teste mede ambiguidade)');
SELECT is((pg_temp.take()), '[]'::jsonb, 'Massa: nenhum evento de autenticação antes das tentativas');
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.members WHERE id = pg_temp.m(12)), 'Massa: Rita foi excluída pela RPC delete_member');
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.members WHERE id = pg_temp.m(29)), 'Massa: Rosa foi excluída pela RPC delete_member');

-- ===========================================================================
-- RN-01: identificações aceitas
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.att('ana.souza@exemplo.com', 'Senha#1'),
  jsonb_build_object('result', 'ok', 'member_id', pg_temp.m(1), 'auth_user_id', pg_temp.u(1), 'auth_email', 'ana.souza@exemplo.com',
                     'identifier_type', 'email', 'identifier_masked', 'a***@exemplo.com', 'password_action', NULL),
  'RN-01: Ana entra com o e-mail (resposta completa do contrato, password_action nulo)');
SELECT is(pg_temp.att('(51) 98888-7777', 'Senha#1'),
  jsonb_build_object('result', 'ok', 'member_id', pg_temp.m(1), 'auth_user_id', pg_temp.u(1), 'auth_email', 'ana.souza@exemplo.com',
                     'identifier_type', 'mobile', 'identifier_masked', '***7777', 'password_action', NULL),
  'RN-01, RN-15: Ana entra com o celular, tipo Celular, máscara ***7777');
SELECT is(pg_temp.att('529.982.247-25', 'Senha#1'),
  jsonb_build_object('result', 'ok', 'member_id', pg_temp.m(1), 'auth_user_id', pg_temp.u(1), 'auth_email', 'ana.souza@exemplo.com',
                     'identifier_type', 'cpf', 'identifier_masked', '***4725', 'password_action', NULL),
  'RN-01, RN-15: Ana entra com o CPF; só o CPF dela encontra, então o tipo é CPF');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.att('ana.souza@exemplo.com', 'Senha#1')) k),
  ARRAY['auth_email', 'auth_user_id', 'identifier_masked', 'identifier_type', 'member_id', 'password_action', 'result']::text[],
  'Contrato: a resposta de sucesso tem exatamente estas sete chaves');

SELECT is(pg_temp.fr('bruno_k3j9x2@mci12fakemail.com', 'Senha#2'), 'invalid|not_found',
  'RN-01: o e-mail fictício de Bruno, com a senha certa, é "não encontrada"');
SELECT is(pg_temp.fr('BRUNO_K3J9X2@MCI12FAKEMAIL.COM', 'Senha#2'), 'invalid|not_found',
  'RN-01: o e-mail fictício não serve nem em maiúsculas');
SELECT is(pg_temp.res('(51) 97777-6666', 'Senha#2'), 'ok', 'RN-01: Bruno entra com o celular');
SELECT is(pg_temp.att('(51) 97777-6666', 'Senha#2') ->> 'member_id', pg_temp.m(2)::text, 'RN-01: e é a conta dele');

SELECT is(pg_temp.att('carla@novo.com', 'Senha#3') ->> 'result', 'ok',
  'RN-01: Carla entra com o e-mail novo do cadastro');
SELECT is(pg_temp.att('carla@novo.com', 'Senha#3') ->> 'auth_email', 'carla@antigo.com',
  'RN-01, RN-17: a identificação leva ao cadastro e a sessão é da conta (e-mail antigo no Auth)');
SELECT is(pg_temp.fr('carla@antigo.com', 'Senha#3'), 'invalid|not_found',
  'RN-01: o e-mail antigo que só ficou na conta não serve');

-- ===========================================================================
-- RN-02: e-mail
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('  Ana.Souza@EXEMPLO.com ', 'Senha#1'), 'ok', 'RN-02: espaços nas pontas e maiúsculas são ignorados');
SELECT is(pg_temp.fr('ana.souza@exemplo.com.br', 'Senha#1'), 'invalid|not_found', 'RN-02: fora isso, o e-mail precisa ser igual');
SELECT is(pg_temp.fr('ana.souza@exemplo', 'Senha#1'), 'invalid|not_found', 'RN-02: um pedaço do e-mail não serve');
SELECT is(pg_temp.fr('51988887777@exemplo.com', 'Senha#1'), 'invalid|not_found', 'RN-02: com "@" é só e-mail, nunca celular');

-- ===========================================================================
-- RN-03: celular
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('51988887777', 'Senha#1'), 'ok', 'RN-03: Ana, só dígitos');
SELECT is(pg_temp.res('+55 (51) 98888-7777', 'Senha#1'), 'ok', 'RN-03: Ana, com +55');
SELECT is(pg_temp.res('5551988887777', 'Senha#1'), 'ok', 'RN-03: Ana, 55 colado (13 dígitos)');
SELECT is(pg_temp.res('051 98888-7777', 'Senha#1'), 'ok', 'RN-03: Ana, zero à esquerda');
SELECT is(pg_temp.res('(51) 8888-7777', 'Senha#1'), 'ok', 'RN-03 e: Ana, sem o 9º dígito');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.att('55999991234', 'Senha#4') ->> 'member_id', pg_temp.m(4)::text, 'RN-03 b: Hugo, o 55 de 11 dígitos é o DDD');
SELECT is(pg_temp.att('+55 55 99999-1234', 'Senha#4') ->> 'member_id', pg_temp.m(4)::text, 'RN-03 b: Hugo, +55 55 99999-1234');
SELECT is(pg_temp.att('(51) 98877-6655', 'Senha#5') ->> 'member_id', pg_temp.m(5)::text,
  'RN-03 e: Gabi (celular antigo de 10 dígitos no cadastro) entra com a forma de 11 dígitos');
SELECT is(pg_temp.att('(51) 98888-5555', 'Senha#6') ->> 'member_id', pg_temp.m(6)::text,
  'RN-03 d: Ivo entra com o celular dele (correspondência exata primeiro)');
SELECT is(pg_temp.att('5188885555', 'Senha#7') ->> 'member_id', pg_temp.m(7)::text,
  'RN-03 d: Joana entra com o dela; sem ambiguidade com o Ivo');
SELECT is(pg_temp.fr('(51) 98888-5555', 'Senha#7'), 'invalid|wrong_password',
  'RN-03 d: a senha da Joana no celular do Ivo é senha errada (não "ambígua")');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fr('9888-7777', 'Senha#1'), 'invalid|invalid_identifier',
  'RN-03, RN-08: celular sem DDD pela API é identificação inválida, mensagem única');
SELECT is(pg_temp.nfail('identifier', 'x:9888-7777'), 1,
  'RN-03, RN-08: e a tentativa conta para o limite (chave x: do texto)');

-- ===========================================================================
-- RN-04: CPF
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('52998224725', 'Senha#1'), 'ok', 'RN-04: Ana, CPF só com dígitos');
SELECT is(pg_temp.res('529 982 247 25', 'Senha#1'), 'ok', 'RN-04: Ana, CPF com espaços');
SELECT is(pg_temp.att('01234567890', 'Senha#15') ->> 'member_id', pg_temp.m(15)::text, 'RN-04: Léo, o zero à esquerda é mantido no CPF');
SELECT is(pg_temp.att('012.345.678-90', 'Senha#15') ->> 'identifier_type', 'cpf',
  'RN-15: o número de Léo só levou ao CPF (o celular dele não existe), tipo CPF');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fr('529.982.247-26', 'Senha#1'), 'invalid|not_found', 'RN-04: dígito verificador errado, mensagem única');
SELECT is(pg_temp.nfail('identifier', 'c:52998224726'), NULL, 'RN-04: e não foi procurado como CPF (nenhuma chave c:)');
SELECT is(pg_temp.nfail('identifier', 'm:5298224726'), 1, 'RN-04: só como celular (chave m:)');
SELECT is(pg_temp.fr('111.111.111-11', 'Senha#1'), 'invalid|not_found', 'RN-04, P-LOG-16: 11 dígitos iguais, mensagem única');
SELECT is(pg_temp.nfail('identifier', 'c:11111111111'), NULL, 'RN-04, P-LOG-16: nunca é procurado como CPF');

-- ===========================================================================
-- RN-05: ambiguidade
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fr('51988887704', 'Senha#8'), 'invalid|ambiguous', 'RN-05: CPF de Davi e celular de Elisa, com a senha do Davi');
SELECT is(pg_temp.fr('51988887704', 'Senha#9'), 'invalid|ambiguous', 'RN-05: e com a senha da Elisa (não se tenta descobrir pela senha)');
SELECT is(pg_temp.att('51988887704', 'Senha#8'), '{"result": "invalid"}'::jsonb, 'RN-05: resposta única, sem dado do cadastro');
SELECT is(pg_temp.take1() #>> '{metadata,identifier_type}', 'cpf_or_mobile', 'RN-05, RN-15: tipo "CPF ou celular"');
SELECT is(pg_temp.att('e104-8@exemplo.com', 'Senha#8') ->> 'result', 'ok', 'RN-05: Davi entra com o e-mail dele');
SELECT is(pg_temp.att('e104-9@exemplo.com', 'Senha#9') ->> 'result', 'ok', 'RN-05: Elisa entra com o e-mail dela');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fr('(51) 96666-5555', 'Senha#11'), 'invalid|ambiguous', 'RN-05: Paula e Otávio, o mesmo celular');
SELECT is(pg_temp.fr('(51) 96666-5555', 'Senha#10'), 'invalid|ambiguous', 'RN-05: Otávio no mesmo celular também');
SELECT is(pg_temp.att('e104-11@exemplo.com', 'Senha#11') ->> 'member_id', pg_temp.m(11)::text, 'RN-05: Paula entra com o e-mail');
SELECT is(pg_temp.att('111.444.777-35', 'Senha#11') ->> 'member_id', pg_temp.m(11)::text, 'RN-05: Paula entra com o CPF');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.att('(51) 95555-4444', 'Senha#13') ->> 'member_id', pg_temp.m(13)::text,
  'RN-05: Sílvia entra; a Rita excluída com o mesmo celular não conta');
SELECT is(pg_temp.att('168.995.350-09', 'Senha#14') ->> 'member_id', pg_temp.m(14)::text,
  'RN-05: Ulisses (CPF também no campo de celular) entra: os dois caminhos levam ao mesmo cadastro');
SELECT is(pg_temp.att('168.995.350-09', 'Senha#14') ->> 'identifier_type', 'cpf_or_mobile',
  'RN-15: Ulisses, tipo "CPF ou celular"');

-- ===========================================================================
-- RN-06: quem entra
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('e104-17@exemplo.com', 'Senha#17'), 'ok', 'RN-06: Nina, inativa, entra');
SELECT is(pg_temp.res('e104-18@exemplo.com', 'Senha#18'), 'ok', 'RN-06: o pastor Samuel, sem líder, entra');
SELECT is(pg_temp.res('e104-19@exemplo.com', 'Senha#19'), 'ok', 'RN-06: Lia, em função sem nenhuma permissão, entra');
SELECT is(pg_temp.fr('(51) 94444-3333', 'Senha#16'), 'invalid|no_account', 'RN-06: Quintino, sem conta de acesso');
SELECT is(pg_temp.att('(51) 94444-3333', 'x'), '{"result": "invalid"}'::jsonb, 'RN-07 e: e a resposta é a única');
SELECT is(pg_temp.fev('(51) 94444-3333', 'x') ->> 'entity_id', pg_temp.m(16)::text, 'RN-15: a falha de Quintino fica ligada ao cadastro dele');
SELECT is(pg_temp.fr('orfa@exemplo.com', 'Senha#31'), 'invalid|not_found', 'RN-06: conta de acesso sem cadastro de membro');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fr('e104-12@exemplo.com', 'Senha#12'), 'invalid|member_deleted', 'RN-06: Rita excluída, pelo e-mail');
SELECT is(pg_temp.fr('390.533.447-05', 'Senha#12'), 'invalid|member_deleted', 'RN-06: Rita excluída, pelo CPF');
SELECT is(pg_temp.fev('e104-12@exemplo.com', 'Senha#12') ->> 'entity_id', pg_temp.m(12)::text,
  'RN-15: com um só cadastro excluído, a falha fica ligada a ele');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fr('e104-29@exemplo.com', 'Senha#29'), 'invalid|member_deleted', 'RN-06: Rosa excluída, pelo e-mail');
SELECT is(pg_temp.fr('(51) 94545-4545', 'Senha#29'), 'invalid|member_deleted', 'RN-06: Rosa excluída, pelo celular');
SELECT is(pg_temp.fr('746.971.314-01', 'Senha#29'), 'invalid|member_deleted', 'RN-06: Rosa excluída, pelo CPF');
SELECT pg_temp.reset_throttle();
SELECT is(coalesce(pg_temp.val(30, format('SELECT (public.restore_member(%L)).role_name', pg_temp.m(29))), '') NOT LIKE 'ERR%', true,
  'RN-06: Adriana restaura Rosa pela RPC restore_member (E2.01)');
SELECT is(pg_temp.att('e104-29@exemplo.com', 'Senha#29') ->> 'member_id', pg_temp.m(29)::text,
  'RN-06: restaurada, Rosa entra com a mesma senha de antes');
SELECT is(pg_temp.att('(51) 94545-4545', 'Senha#29') ->> 'result', 'ok', 'RN-06: e pelo celular');

-- Contas indisponíveis, mesmo com a senha certa (RN-06 b, RN-07 f, DA-9).
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.fr('e104-22@exemplo.com', 'Senha#22'), 'invalid|account_unavailable', 'RN-07 f: e-mail não confirmado');
SELECT is(pg_temp.fr('e104-23@exemplo.com', 'Senha#23'), 'invalid|account_unavailable', 'RN-07 f: conta banida');
SELECT is(pg_temp.fr('e104-24@exemplo.com', 'Senha#24'), 'invalid|account_unavailable', 'RN-07 f: conta apagada no Auth (deleted_at)');
SELECT is(pg_temp.fr('e104-25@exemplo.com', 'Senha#25'), 'invalid|account_unavailable', 'DA-9: conta sem senha');
SELECT is(pg_temp.fr('e104-26@exemplo.com', 'password'), 'invalid|account_unavailable', 'DA-9: hash que não é bcrypt (MD5 em hexadecimal)');
SELECT is(pg_temp.fr('e104-27@exemplo.com', 'Senha#27'), 'invalid|account_unavailable', 'RN-06 b: conta de SSO');
SELECT is(pg_temp.att('e104-22@exemplo.com', 'Senha#22'), '{"result": "invalid"}'::jsonb, 'RN-07 f: resposta única da conta indisponível');

-- ===========================================================================
-- RN-07: resposta única nos casos (a) a (g)
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.att('ana.souza', 'Senha#1'), '{"result": "invalid"}'::jsonb, 'RN-07 a: identificação que não é e-mail, celular nem CPF');
SELECT is(pg_temp.att('ninguem@exemplo.com', 'Senha#1'), '{"result": "invalid"}'::jsonb, 'RN-07 b: não encontrada');
SELECT is(pg_temp.att('51988887704', 'Senha#8'), '{"result": "invalid"}'::jsonb, 'RN-07 c: ambígua');
SELECT is(pg_temp.att('e104-12@exemplo.com', 'Senha#12'), '{"result": "invalid"}'::jsonb, 'RN-07 d: cadastro excluído');
SELECT is(pg_temp.att('(51) 94444-3333', 'Senha#16'), '{"result": "invalid"}'::jsonb, 'RN-07 e: sem conta de acesso');
SELECT is(pg_temp.att('e104-23@exemplo.com', 'Senha#23'), '{"result": "invalid"}'::jsonb, 'RN-07 f: conta indisponível');
SELECT is(pg_temp.att('ana.souza@exemplo.com', 'errada'), '{"result": "invalid"}'::jsonb, 'RN-07 g: senha errada');
SELECT is((SELECT count(*)::int FROM jsonb_object_keys(pg_temp.att('ana.souza@exemplo.com', 'errada'))), 1,
  'RN-13: a falha não traz e-mail, nome, celular, CPF nem identificador: só "result"');

-- ===========================================================================
-- RN-08: campos vazios não contam nem registram
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT pg_temp.take();
SELECT is(pg_temp.att('   ', 'Senha#1'), '{"result": "empty_fields"}'::jsonb, 'RN-08: identificação só com espaços é vazia');
SELECT is(pg_temp.att('', 'Senha#1'), '{"result": "empty_fields"}'::jsonb, 'RN-08: identificação vazia');
SELECT is(pg_temp.att('ana.souza@exemplo.com', ''), '{"result": "empty_fields"}'::jsonb, 'RN-08: senha vazia');
SELECT is(pg_temp.att(NULL, 'Senha#1'), '{"result": "empty_fields"}'::jsonb, 'DA-3: identificação NULL (campo que não é texto) é vazia');
SELECT is(pg_temp.att('ana.souza@exemplo.com', NULL), '{"result": "empty_fields"}'::jsonb, 'DA-3: senha NULL é vazia');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle), 0, 'RN-08: os campos vazios não contam (nenhuma linha de controle)');
SELECT is(pg_temp.take(), '[]'::jsonb, 'RN-08: e nada é registrado na Auditoria');
SELECT is(pg_temp.fr('ana.souza@exemplo.com', '   '), 'invalid|wrong_password', 'RN-08, RN-09: senha só com espaços não é vazia: é enviada e conferida');
SELECT is(pg_temp.fr('ana@', 'Senha#1'), 'invalid|not_found', 'RN-08: "ana@" tem "@": é enviada e não encontrada');

-- ===========================================================================
-- RN-09: a senha é usada como foi digitada; DA-5: senha acima de 72 bytes
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('e104-20@exemplo.com', ' Fé 2024'), 'ok', 'RN-09: Marcos entra com " Fé 2024" (espaço no início e acento)');
SELECT is(pg_temp.fr('e104-20@exemplo.com', 'Fé 2024'), 'invalid|wrong_password', 'RN-09: sem o espaço, é senha errada');
SELECT is(pg_temp.fr('e104-20@exemplo.com', ' fé 2024'), 'invalid|wrong_password', 'RN-09: maiúsculas importam');
SELECT is(pg_temp.fr('e104-20@exemplo.com', ' Fe 2024'), 'invalid|wrong_password', 'RN-09: acentos importam');
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('e104-28@exemplo.com', repeat('x', 72)), 'ok', 'DA-5: a senha de exatamente 72 bytes entra');
SELECT is(pg_temp.fr('e104-28@exemplo.com', repeat('x', 72) || 'qualquer-sufixo'), 'invalid|wrong_password',
  'DA-5: senha acima de 72 bytes é recusada (o bcrypt só olha os 72 primeiros)');

-- ===========================================================================
-- RN-17: senhas atuais e o ponto do E3.02
-- ===========================================================================
SELECT pg_temp.reset_throttle();
SELECT is(pg_temp.res('e104-21@exemplo.com', '123456'), 'ok', 'RN-17: Tiago entra com a senha inicial 123456 (D11), sem regra de força');
SELECT is(private.sign_in_check_legacy(pg_temp.m(21), '123456'), NULL, 'RN-17 b: o ponto do E3.02 existe e não faz nada (NULL)');
SELECT is(private.sign_in_check_legacy(pg_temp.m(1), 'qualquer'), NULL, 'RN-17 b: nem para outro membro');
SELECT is(pg_temp.att('e104-21@exemplo.com', '123456') -> 'password_action', 'null'::jsonb, 'RN-17 d: password_action é null neste passo');

-- ===========================================================================
-- RN-13: a função só devolve dados de quem entrou; nada foi gravado em auth.users
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM auth.users WHERE id = pg_temp.u(1) AND last_sign_in_at IS NOT NULL), 0,
  'RN-13: a RPC não emite sessão (quem emite é a Edge Function)');

SELECT * FROM finish();

ROLLBACK;
