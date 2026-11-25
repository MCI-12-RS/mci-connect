-- GERADO por supabase/tests/fixtures/generate-member-validation-cases.mjs a partir de
-- supabase/tests/fixtures/member-validation-cases.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-member-validation-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.04 (PR 1), AQ-2 / DT-17 / DT-18: as funções de regra sobre a tabela única de casos
-- (nome, e-mail, domínios fictícios, celular, CPF, nascimento com "hoje" fixo e identificador
-- de login). A tela roda o mesmo JSON no Vitest (PR 3).
-- Spec: docs/specs/e2-04-validacoes-membro.md, RN-02, RN-04, RN-05, RN-06, RN-07, RN-08,
-- RN-09, RN-15, DA-3, DA-5, DA-12, DA-13.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(191);

-- DT-18: a lista de domínios fictícios do banco é a do JSON, e o de geração está nela.
SELECT is(public.placeholder_email_domains(), ARRAY['mci12fakemail.com']::text[],
  'DT-18: placeholder_email_domains() é a lista do JSON');
SELECT ok(public.placeholder_email_domain() = 'mci12fakemail.com'
          AND public.placeholder_email_domain() = ANY (public.placeholder_email_domains()),
  'DT-18: o domínio de geração é o do JSON e está na lista');

-- RN-02, DA-12: nome.
CREATE TEMP TABLE name_cases (id text, input text, normalized text, valid boolean) ON COMMIT DROP;
INSERT INTO name_cases VALUES
  ('N01', '  Ana   Souza ', 'Ana Souza', true),
  ('N02', 'Ana B.', 'Ana B.', true),
  ('N03', 'Ana', 'Ana', false),
  ('N04', 'Ana 2', 'Ana 2', false),
  ('N05', 'Ana .', 'Ana .', false),
  ('N06', E'Ana\tSouza\n', 'Ana Souza', true),
  ('N07', E'Ana\n\t Souza', 'Ana Souza', true),
  ('N08', 'ÇÃO Éd', 'ÇÃO Éd', true),
  ('N09', 'Åsa Öberg', 'Åsa Öberg', true),
  ('N10', 'Борис Иванов', 'Борис Иванов', true),
  ('N11', '李 小龙', '李 小龙', true),
  ('N12', 'Maria-José d''Ávila', 'Maria-José d''Ávila', true),
  ('N13', '', NULL, false),
  ('N14', '   ', NULL, false),
  ('N15', NULL, NULL, false),
  ('N16', '1 2', '1 2', false),
  ('N17', '- -', '- -', false),
  ('N18', 'ana souza', 'ana souza', true),
  ('N19', ' José   da    Silva Neto ', 'José da Silva Neto', true),
  ('N20', 'Ana 2 Souza', 'Ana 2 Souza', true);
SELECT is(public.normalize_person_name(x.input), x.normalized,
  'RN-02 ' || x.id || ': normalize_person_name') FROM name_cases x ORDER BY x.id;
SELECT is(public.is_valid_person_name(x.input), x.valid,
  'RN-02 ' || x.id || ': is_valid_person_name') FROM name_cases x ORDER BY x.id;

-- RN-04, RN-05, DA-3: e-mail (normalize_email do E2.01, is_valid_email e is_placeholder_email).
CREATE TEMP TABLE email_cases (id text, input text, normalized text, valid boolean, placeholder boolean) ON COMMIT DROP;
INSERT INTO email_cases VALUES
  ('E01', 'ana@exemplo.com', 'ana@exemplo.com', true, false),
  ('E02', 'ana.souza@igreja.org.br', 'ana.souza@igreja.org.br', true, false),
  ('E03', '  ANA@Exemplo.COM ', 'ana@exemplo.com', true, false),
  ('E04', 'ana@exemplo', 'ana@exemplo', false, false),
  ('E05', 'ana@.com', 'ana@.com', false, false),
  ('E06', 'ana @exemplo.com', 'ana @exemplo.com', false, false),
  ('E07', 'ana@@exemplo.com', 'ana@@exemplo.com', false, false),
  ('E08', 'ana@exemplo..com', 'ana@exemplo..com', false, false),
  ('E09', '@exemplo.com', '@exemplo.com', false, false),
  ('E10', 'ana@exemplo.com.', 'ana@exemplo.com.', false, false),
  ('E11', 'ana.exemplo.com', 'ana.exemplo.com', false, false),
  ('E12', '', NULL, false, false),
  ('E13', NULL, NULL, false, false),
  ('E14', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@exemplo.com', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@exemplo.com', true, false),
  ('E15', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@exemplo.com', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@exemplo.com', false, false),
  ('E16', 'caio_a1b2c3@mci12fakemail.com', 'caio_a1b2c3@mci12fakemail.com', true, true),
  ('E17', ' CAIO@MCI12FAKEMAIL.COM ', 'caio@mci12fakemail.com', true, true),
  ('E18', 'caio@sub.mci12fakemail.com', 'caio@sub.mci12fakemail.com', true, false),
  ('E19', 'caio@mci12fakemail.com.br', 'caio@mci12fakemail.com.br', true, false),
  ('E20', 'mci12fakemail.com@exemplo.com', 'mci12fakemail.com@exemplo.com', true, false),
  ('E21', 'ana@exemplo.c', 'ana@exemplo.c', true, false),
  ('E22', 'a@b.co', 'a@b.co', true, false),
  ('E23', E'ana\t@exemplo.com', E'ana\t@exemplo.com', false, false);
SELECT is(public.normalize_email(x.input), x.normalized,
  'RN-04 ' || x.id || ': normalize_email') FROM email_cases x ORDER BY x.id;
SELECT is(public.is_valid_email(public.normalize_email(x.input)), x.valid,
  'RN-04 ' || x.id || ': is_valid_email') FROM email_cases x ORDER BY x.id;
SELECT is(public.is_placeholder_email(x.input), x.placeholder,
  'RN-05 ' || x.id || ': is_placeholder_email') FROM email_cases x ORDER BY x.id;

-- RN-06, RN-09, DA-5: celular (leitura do E1.04 e chave do 9º dígito).
CREATE TEMP TABLE mobile_cases (id text, input text, normalized text, match_key text) ON COMMIT DROP;
INSERT INTO mobile_cases VALUES
  ('M01', '(51) 98888-7777', '51988887777', '5188887777'),
  ('M02', '+55 (51) 98888-7777', '51988887777', '5188887777'),
  ('M03', '5551988887777', '51988887777', '5188887777'),
  ('M04', '051 98888-7777', '51988887777', '5188887777'),
  ('M05', '(51) 8888-7777', '5188887777', '5188887777'),
  ('M06', '55999991234', '55999991234', '5599991234'),
  ('M07', '+55 55 99999-1234', '55999991234', '5599991234'),
  ('M08', '(51) 3333-4444', '5133334444', '5133334444'),
  ('M09', '98887777', NULL, NULL),
  ('M10', '', NULL, NULL),
  ('M11', NULL, NULL, NULL),
  ('M12', 'abc', NULL, NULL),
  ('M13', '(51) 9888-777', NULL, NULL);
SELECT is(public.normalize_mobile(x.input), x.normalized,
  'RN-06 ' || x.id || ': normalize_mobile') FROM mobile_cases x ORDER BY x.id;
SELECT is(public.mobile_match_key(x.input), x.match_key,
  'RN-09 ' || x.id || ': mobile_match_key') FROM mobile_cases x ORDER BY x.id;

-- RN-07: CPF.
CREATE TEMP TABLE cpf_cases (id text, input text, digits text, valid boolean) ON COMMIT DROP;
INSERT INTO cpf_cases VALUES
  ('C01', '529.982.247-25', '52998224725', true),
  ('C02', '52998224725', '52998224725', true),
  ('C03', ' 529 982 247 25 ', '52998224725', true),
  ('C04', '529.982.247-26', '52998224726', false),
  ('C05', '111.111.111-11', '11111111111', false),
  ('C06', '012.345.678-90', '01234567890', true),
  ('C07', '000.000.001-91', '00000000191', true),
  ('C08', '123', '123', false),
  ('C09', '529.982.247-250', '529982247250', false),
  ('C10', '', NULL, false),
  ('C11', NULL, NULL, false),
  ('C12', 'abc', NULL, false),
  ('C13', '000.000.000-00', '00000000000', false);
SELECT is(public.normalize_digits(x.input), x.digits,
  'RN-07 ' || x.id || ': normalize_digits') FROM cpf_cases x ORDER BY x.id;
SELECT is(public.is_valid_cpf(public.normalize_digits(x.input)), x.valid,
  'RN-07 ' || x.id || ': is_valid_cpf') FROM cpf_cases x ORDER BY x.id;

-- RN-15, DA-13: nascimento com o "hoje" fixo de cada caso.
CREATE TEMP TABLE birth_cases (id text, today date, birth date, problem text) ON COMMIT DROP;
INSERT INTO birth_cases VALUES
  ('B01', '2026-11-23'::date, '1926-11-24'::date, NULL),
  ('B02', '2026-11-23'::date, '1926-11-23'::date, 'birth_date_too_old'),
  ('B03', '2026-11-23'::date, '2026-11-23'::date, NULL),
  ('B04', '2026-11-23'::date, '2026-11-24'::date, 'birth_date_future'),
  ('B05', '2026-11-23'::date, '1920-03-10'::date, 'birth_date_too_old'),
  ('B06', '2026-11-23'::date, '2000-02-29'::date, NULL),
  ('B07', '2026-11-23'::date, NULL::date, NULL),
  ('B08', '2100-02-28'::date, '2000-02-29'::date, NULL),
  ('B09', '2100-02-28'::date, '2000-02-28'::date, 'birth_date_too_old'),
  ('B10', '2100-03-01'::date, '2000-02-29'::date, 'birth_date_too_old'),
  ('B11', '2100-03-01'::date, '2000-03-02'::date, NULL),
  ('B12', '2024-02-29'::date, '1924-02-29'::date, 'birth_date_too_old'),
  ('B13', '2024-02-29'::date, '1924-03-01'::date, NULL),
  ('B14', '2026-01-01'::date, '2026-01-01'::date, NULL),
  ('B15', '2026-12-31'::date, '1926-12-31'::date, 'birth_date_too_old'),
  ('B16', '2026-12-31'::date, '1927-01-01'::date, NULL);
SELECT is(public.birth_date_problem(x.birth, x.today), x.problem,
  'RN-15 ' || x.id || ': birth_date_problem(' || coalesce(x.birth::text, 'NULL') || ', hoje ' || x.today || ')')
  FROM birth_cases x ORDER BY x.id;

-- RN-08: identificador de login.
CREATE TEMP TABLE identifier_cases (id text, email text, mobile text, cpf text, has_identifier boolean) ON COMMIT DROP;
INSERT INTO identifier_cases VALUES
  ('I01', 'ana@exemplo.com', NULL, NULL, true),
  ('I02', 'caio@mci12fakemail.com', NULL, NULL, false),
  ('I03', 'ana@exemplo', NULL, NULL, false),
  ('I04', NULL, '(51) 98888-7777', NULL, true),
  ('I05', NULL, '98887777', NULL, false),
  ('I06', NULL, NULL, '529.982.247-25', true),
  ('I07', NULL, NULL, '529.982.247-26', false),
  ('I08', NULL, NULL, NULL, false),
  ('I09', 'caio@mci12fakemail.com', NULL, '529.982.247-25', true),
  ('I10', 'ana@exemplo', '(51) 98888-7777', NULL, true),
  ('I11', '', '', '', false),
  ('I12', 'ana@exemplo.com', '98887777', '111.111.111-11', true);
SELECT is(public.member_has_login_identifier(x.email, x.mobile, x.cpf), x.has_identifier,
  'RN-08 ' || x.id || ': member_has_login_identifier') FROM identifier_cases x ORDER BY x.id;

SELECT * FROM finish();

ROLLBACK;
