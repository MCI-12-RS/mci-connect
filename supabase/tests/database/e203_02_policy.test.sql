-- GERADO por supabase/tests/fixtures/generate-password-policy-cases.mjs a partir de
-- supabase/tests/fixtures/password-policy-cases.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-password-policy-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.03 (PR 1, tarefa 5): a política de senha (RN-13), a senha inicial (RN-07) e as trocas (RN-10 a RN-13)
-- sobre a tabela única de casos, inclusive os server_only (a lista de senhas comuns, só do banco).
--   policy e login: private.password_policy_violation e public.check_password_policy (service_role);
--   initial:        public.set_initial_password (conta nova, sem senha);
--   change_*:       public.change_own_password (voluntária com a senha atual certa; obrigatória com a marca).
-- Cada caso de initial e de change_* roda num subbloco que é desfeito (a massa não acumula).
-- Spec: docs/specs/e2-03-senha.md, RN-07, RN-10, RN-11, RN-13, DA-4 a DA-7, UX-08.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(119);

CREATE TEMP TABLE policy_cases (
  id text, context text, password text, cpf text, mobile text, birth_date date, email text,
  current_password text, confirmation text, expected text, field text, server_only boolean
) ON COMMIT DROP;

INSERT INTO policy_cases VALUES
  ('rn13-7-caracteres', 'change_voluntary', 'Abc1234', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'Abc1234', 'password_too_short', 'new_password', false),
  ('rn13-frase-73-bytes', 'change_voluntary', 'A fé move montanhas e a paz acalma o coração no meio da tempestade!!!x', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'A fé move montanhas e a paz acalma o coração no meio da tempestade!!!x', 'password_too_long', 'new_password', false),
  ('rn13-facil-1', 'change_voluntary', '11111111', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', '11111111', 'password_weak', 'new_password', false),
  ('rn13-facil-2', 'change_voluntary', '12345678', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', '12345678', 'password_weak', 'new_password', false),
  ('rn13-facil-3', 'change_voluntary', '87654321', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', '87654321', 'password_weak', 'new_password', false),
  ('rn13-facil-4', 'change_voluntary', 'abcdefgh', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'abcdefgh', 'password_weak', 'new_password', false),
  ('rn13-facil-5', 'change_voluntary', 'Senha123', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'Senha123', 'password_weak', 'new_password', false),
  ('rn13-facil-6', 'change_voluntary', 'igreja@2024', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'igreja@2024', 'password_weak', 'new_password', false),
  ('rn13-facil-7', 'change_voluntary', 'MCI12rs2025', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'MCI12rs2025', 'password_weak', 'new_password', false),
  ('rn13-comum-password1', 'change_voluntary', 'password1', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'password1', 'password_weak', 'new_password', true),
  ('rn13-pessoal-1', 'change_voluntary', '52998224725', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', '52998224725', 'password_personal_data', 'new_password', false),
  ('rn13-pessoal-2', 'change_voluntary', 'cpf529.982.247-25', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'cpf529.982.247-25', 'password_personal_data', 'new_password', false),
  ('rn13-pessoal-3', 'change_voluntary', 'zap98888-7777', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'zap98888-7777', 'password_personal_data', 'new_password', false),
  ('rn13-pessoal-4', 'change_voluntary', 'caio15/03/1990', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'caio15/03/1990', 'password_personal_data', 'new_password', false),
  ('rn13-pessoal-5', 'change_voluntary', 'CAIO.LIMA@exemplo.com', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'CAIO.LIMA@exemplo.com', 'password_personal_data', 'new_password', false),
  ('rn13-igual-atual', 'change_voluntary', 'Caminho2024', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'Caminho2024', 'password_same_as_current', 'new_password', false),
  ('rn13-aceita-abacate7', 'change_voluntary', 'Abacate7', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'Abacate7', NULL, NULL, false),
  ('rn13-aceita-espaco-acento', 'change_voluntary', ' Fé 2024', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', ' Fé 2024', NULL, NULL, false),
  ('rn13-aceita-frase', 'change_voluntary', 'luz do mundo', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'luz do mundo', NULL, NULL, false),
  ('rn13-beatriz-so-numeros', 'change_voluntary', '47391826', NULL, NULL, NULL::date, 'beatriz.alves@exemplo.com', 'Senha!Antiga9', '47391826', NULL, NULL, false),
  ('rn13-login-fraca-marca', 'login', '12345678', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', NULL, false),
  ('ux08-atual-vazia', 'change_voluntary', 'Abacate7', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', '', 'Abacate7', 'empty_fields', 'current_password', false),
  ('ux08-nova-vazia', 'change_voluntary', '', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', '', 'empty_fields', 'new_password', false),
  ('ux08-confirmacao-vazia', 'change_voluntary', 'Abacate7', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', '', 'empty_fields', 'confirmation', false),
  ('ux08-confirmacao-diferente', 'change_voluntary', 'Abacate7', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'Abacate8', 'password_mismatch', 'confirmation', false),
  ('da7-politica-antes-da-confirmacao', 'change_voluntary', 'Abc1234', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'Xyz9876', 'password_too_short', 'new_password', false),
  ('da7-igual-atual-antes-da-confirmacao', 'change_voluntary', 'Caminho2024', '529.982.247-25', '(51) 98888-7777', '1990-03-15'::date, 'caio.lima@exemplo.com', 'Caminho2024', 'outra', 'password_same_as_current', 'new_password', false),
  ('rn10-obrigatoria-igual-atual', 'change_forced', 'k7m2x9pa', NULL, NULL, NULL::date, NULL, 'k7m2x9pa', 'k7m2x9pa', 'password_same_as_current', 'new_password', false),
  ('rn10-obrigatoria-aceita', 'change_forced', 'Abacate7', NULL, NULL, NULL::date, NULL, 'k7m2x9pa', 'Abacate7', NULL, NULL, false),
  ('rn07-vazia', 'initial', '', '529.982.247-25', NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('rn07-123456', 'initial', '123456', '529.982.247-25', NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('rn07-abc12', 'initial', 'abc12', '529.982.247-25', NULL, NULL::date, NULL, NULL, NULL, 'password_too_short', 'password', false),
  ('rn07-oliveira', 'initial', 'Oliveira#7', '529.982.247-25', NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('rn07-cpf-do-formulario', 'initial', 'mat52998224725', '529.982.247-25', NULL, NULL::date, NULL, NULL, NULL, 'password_personal_data', 'password', false),
  ('rn07-1234567', 'initial', '1234567', '529.982.247-25', NULL, NULL::date, NULL, NULL, NULL, 'password_too_short', 'password', false),
  ('rn07-123456-com-espaco', 'initial', ' 123456', '529.982.247-25', NULL, NULL::date, NULL, NULL, NULL, 'password_too_short', 'password', false),
  ('borda-7-pontos', 'policy', 'Lua9So2', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_too_short', 'new_password', false),
  ('borda-8-pontos', 'policy', 'Lua9Sol2', NULL, NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('borda-72-bytes', 'policy', 'A fé move montanhas e a paz acalma o coração no meio da tempestade!!!', NULL, NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('borda-73-bytes', 'policy', 'A fé move montanhas e a paz acalma o coração no meio da tempestade!!!x', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_too_long', 'new_password', false),
  ('borda-emoji-7-pontos', 'policy', '🙂🎉🙂🎉🙂🎉🙂', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_too_short', 'new_password', false),
  ('borda-emoji-8-pontos', 'policy', '🙂abc1234', NULL, NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('borda-emoji-72-bytes', 'policy', '🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉', NULL, NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('borda-emoji-76-bytes', 'policy', '🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂🎉🙂', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_too_long', 'new_password', false),
  ('borda-emoji-repetido', 'policy', '🙂🙂🙂🙂🙂🙂🙂🙂', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('borda-8-espacos', 'policy', '        ', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('borda-repeticao-maiusculas', 'policy', 'AaAaAaAa', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('borda-repeticao-acentos', 'policy', 'aáàâãäAÁ', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('da5-volta-crescente', 'policy', '34567890', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('da5-volta-crescente-2', 'policy', '90123456', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('da5-volta-decrescente', 'policy', '21098765', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('da5-letras-decrescente', 'policy', 'zyxwvuts', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('da5-letras-maiusculas', 'policy', 'ABCDEFGH', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('da5-letras-sem-volta', 'policy', 'xyzabcde', NULL, NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('da5-vai-e-volta-nao-e-sequencia', 'policy', '45454545', NULL, NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('rn13f-acento-composto', 'policy', 'Ígreja2024', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('rn13f-acento-decomposto', 'policy', 'Ígreja2024', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('rn13f-so-simbolos', 'policy', 'SENHA!!!', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('rn13f-seguida-de-letras', 'policy', 'senhaforte', NULL, NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('rn13f-connect', 'policy', 'Connect#1', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('rn13f-mci12', 'policy', 'mci12_2026', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('rn13f-g12', 'policy', 'G12-12-12', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('rn13f-mudar', 'policy', 'Mudar123', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', false),
  ('rn13e-maiusculas', 'policy', 'PASSWORD1', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', true),
  ('rn13e-iloveyou', 'policy', 'iloveyou', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', true),
  ('rn13e-trustno1', 'policy', 'Trustno1', NULL, NULL, NULL::date, NULL, NULL, NULL, 'password_weak', 'new_password', true),
  ('da6-cpf-10-digitos', 'policy', 'x5299822472y', '5299822472', NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('da6-celular-7-digitos', 'policy', 'zap9888777', NULL, '9888-777', NULL::date, NULL, NULL, NULL, NULL, NULL, false),
  ('da6-celular-8-ultimos', 'policy', 'tel:88887777!', NULL, '+55 51 98888-7777', NULL::date, NULL, NULL, NULL, 'password_personal_data', 'new_password', false),
  ('da6-nascimento-outro-formato', 'policy', 'caio19900315', NULL, NULL, '1990-03-15'::date, NULL, NULL, NULL, NULL, NULL, false),
  ('da6-nascimento-com-barras', 'policy', 'nasci 15/03/1990', NULL, NULL, '1990-03-15'::date, NULL, NULL, NULL, 'password_personal_data', 'new_password', false),
  ('da6-email-com-espaco', 'policy', 'caio.lima@exemplo.com', NULL, NULL, NULL::date, '  Caio.Lima@Exemplo.com ', NULL, NULL, 'password_personal_data', 'new_password', false),
  ('da6-email-contido-nao-e-igual', 'policy', 'caio.lima@exemplo.com!', NULL, NULL, NULL::date, 'caio.lima@exemplo.com', NULL, NULL, NULL, NULL, false),
  ('da6-email-ficticio', 'policy', 'caio_ab12cd@mci12fakemail.com', NULL, NULL, NULL::date, 'caio_ab12cd@mci12fakemail.com', NULL, NULL, 'password_personal_data', 'new_password', false),
  ('da6-sem-dados', 'policy', '52998224725', NULL, NULL, NULL::date, NULL, NULL, NULL, NULL, NULL, false);

-- Chamada como service_role (o papel da Edge Function).
CREATE FUNCTION pg_temp.as_service(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _msg text; _detail text; _hint text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('error', _state, 'message', _msg, 'hint', nullif(_hint, ''),
                              'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb END);
  END;
END $$;

-- Senha inicial de um caso: o código de erro (app_error) ou 'ok:<senha gravada>:<motivo da marca>'.
CREATE FUNCTION pg_temp.run_initial(_c policy_cases) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _uid uuid := gen_random_uuid(); _r jsonb; _out text;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (_uid, 'e203-ini-' || replace(_uid::text, '-', '') || '@teste.invalid', now());
    _r := pg_temp.as_service(format('SELECT to_jsonb(public.set_initial_password(%L, %L, %L, %L, %L, %L::date, %L))',
                                    _uid, gen_random_uuid(), _c.password, _c.cpf, _c.mobile, _c.birth_date, _c.email));
    IF _r ? 'error' THEN
      _out := CASE WHEN _r ->> 'hint' = 'app_error' THEN _r -> 'detail' ->> 'code' ELSE 'ERR ' || (_r ->> 'error') END
              || '|vault=' || (SELECT count(*) FROM private.account_passwords WHERE auth_user_id = _uid);
    ELSE
      SELECT 'ok|' || (CASE WHEN extensions.crypt('123456', p.password_hash) = p.password_hash THEN '123456'
                            WHEN extensions.crypt(_c.password, p.password_hash) = p.password_hash THEN 'digitada' ELSE 'outra' END)
             || '|' || coalesce(p.must_change_reason, '-') || '|' || coalesce(p.temp_expires_at::text, 'sem validade')
        INTO _out FROM private.account_passwords p WHERE p.auth_user_id = _uid;
    END IF;
    RAISE EXCEPTION '%', _out USING ERRCODE = 'E2030';
  EXCEPTION WHEN SQLSTATE 'E2030' THEN
    GET STACKED DIAGNOSTICS _out = MESSAGE_TEXT;
  END;
  RETURN _out;
END $$;

-- Troca de um caso: result|code|field (a senha atual certa vai para o cofre; a obrigatória leva a marca).
CREATE FUNCTION pg_temp.run_change(_c policy_cases) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  _uid uuid := gen_random_uuid(); _mid uuid := gen_random_uuid(); _sid uuid := gen_random_uuid();
  _cur text := CASE WHEN coalesce(_c.current_password, '') = '' THEN 'Caminho2024' ELSE _c.current_password END;
  _r jsonb; _out text;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (_uid, 'e203-chg-' || replace(_uid::text, '-', '') || '@teste.invalid', now());
    INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, is_active, auth_user_id, cpf, mobile_whatsapp, birth_date, email)
    VALUES (_mid, 'Caso ' || _c.id, 'M', true, false, true, _uid, _c.cpf,
            CASE WHEN _c.cpf IS NULL AND _c.email IS NULL THEN '51900000000' ELSE _c.mobile END,
            _c.birth_date, _c.email);
    INSERT INTO auth.sessions (id, user_id) VALUES (_sid, _uid);
    PERFORM private.write_password(_uid, _mid, _cur, NULL);
    IF _c.context = 'change_forced' THEN
      PERFORM private.set_must_change(_uid, 'reset', now() + interval '7 days');
    END IF;
    _r := pg_temp.as_service(format('SELECT public.change_own_password(%L, %L, %L, %L, %L, %L, %L, %L)',
            _uid, _sid, CASE _c.context WHEN 'change_forced' THEN 'forced' ELSE 'voluntary' END,
            CASE _c.context WHEN 'change_forced' THEN NULL ELSE _c.current_password END,
            _c.password, _c.confirmation, '203.0.113.7', gen_random_uuid()));
    _out := coalesce(_r ->> 'result', 'ERR ' || (_r ->> 'error') || ' ' || (_r ->> 'message'))
            || '|' || coalesce(_r ->> 'code', '-') || '|' || coalesce(_r ->> 'field', '-');
    RAISE EXCEPTION '%', _out USING ERRCODE = 'E2030';
  EXCEPTION WHEN SQLSTATE 'E2030' THEN
    GET STACKED DIAGNOSTICS _out = MESSAGE_TEXT;
  END;
  RETURN _out;
END $$;

-- ---------------------------------------------------------------------------
-- policy e login: o ponto único da política, e a função que a Edge Function chama.
-- ---------------------------------------------------------------------------
SELECT is(private.password_policy_violation(c.password, c.cpf, c.mobile, c.birth_date, c.email), c.expected,
  'RN-13 ' || c.id || ': private.password_policy_violation' || CASE WHEN c.server_only THEN ' (server_only)' ELSE '' END)
FROM policy_cases c WHERE c.context IN ('policy', 'login') ORDER BY c.id;

SELECT is(pg_temp.as_service(format('SELECT to_jsonb(public.check_password_policy(%L, %L, %L, %L::date, %L))',
                                    c.password, c.cpf, c.mobile, c.birth_date, c.email)) #>> '{}', c.expected,
  'RN-13 ' || c.id || ': public.check_password_policy como service_role')
FROM policy_cases c WHERE c.context IN ('policy', 'login') ORDER BY c.id;

-- ---------------------------------------------------------------------------
-- initial (RN-07): vazia ou exatamente 123456 grava 123456 sem a política; o resto passa pela política.
-- A marca é "initial", sem validade. Recusada: nada no cofre.
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.run_initial(c),
  CASE WHEN c.expected IS NOT NULL THEN c.expected || '|vault=0'
       ELSE 'ok|' || CASE WHEN c.password IN ('', '123456') THEN '123456' ELSE 'digitada' END || '|initial|sem validade' END,
  'RN-07 ' || c.id || ': set_initial_password')
FROM policy_cases c WHERE c.context = 'initial' ORDER BY c.id;

-- ---------------------------------------------------------------------------
-- change_voluntary e change_forced (RN-10 a RN-13, DA-7): vazios, política, "igual à atual", confirmação.
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.run_change(c),
  CASE WHEN c.expected IS NULL THEN 'ok|-|-'
       WHEN c.expected = 'empty_fields' THEN 'empty_fields|-|-'
       ELSE 'invalid|' || c.expected || '|' || c.field END,
  'RN-13 ' || c.id || ': change_own_password (' || c.context || ')')
FROM policy_cases c WHERE c.context IN ('change_voluntary', 'change_forced') ORDER BY c.id;

-- ---------------------------------------------------------------------------
-- Conferência de sincronia da própria tabela (o Vitest confere o SQL gerado).
-- ---------------------------------------------------------------------------
SELECT ok((SELECT count(*) FROM policy_cases WHERE server_only) >= 1, 'a tabela traz casos server_only (a lista de senhas comuns)');
SELECT ok((SELECT count(DISTINCT context) FROM policy_cases) = 5, 'a tabela cobre os cinco contextos');
SELECT is((SELECT count(*)::int FROM private.common_passwords), (SELECT count(*)::int FROM private.common_passwords WHERE password = private.fold_password(password)),
  'a lista de senhas comuns está na forma dobrada (minúscula, sem acento)');
SELECT ok((SELECT count(*) FROM private.common_passwords) >= 1000, 'a lista de senhas comuns tem pelo menos 1.000 entradas');

SELECT * FROM finish();

ROLLBACK;
