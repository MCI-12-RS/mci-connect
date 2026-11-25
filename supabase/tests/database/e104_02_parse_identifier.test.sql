-- GERADO por supabase/tests/fixtures/generate-login-identifier-cases.mjs a partir de
-- supabase/tests/fixtures/login-identifier-cases.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-login-identifier-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E1.04 (PR 1), AQ-3: private.parse_login_identifier sobre a tabela única de casos
-- (formato, formas normalizadas e máscara). A tela roda o classifyIdentifier sobre o mesmo JSON.
-- Spec: docs/specs/e1-04-sign-in.md, "Busca pelo cadastro" (passo 1), RN-02 a RN-04, DA-4, AQ-5.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(72);

CREATE TEMP TABLE login_cases (
  id text, input text, format text, email text, cpf text, mobile text, mobile_key text,
  check_mask boolean, masked text
) ON COMMIT DROP;

INSERT INTO login_cases VALUES
  ('vazio', '', 'empty', NULL, NULL, NULL, NULL, false, NULL),
  ('so-espacos', '   ', 'empty', NULL, NULL, NULL, NULL, false, NULL),
  ('email-simples', 'ana.souza@exemplo.com', 'email', 'ana.souza@exemplo.com', NULL, NULL, NULL, true, 'a***@exemplo.com'),
  ('email-espacos-maiusculas', '  Ana.Souza@EXEMPLO.com ', 'email', 'ana.souza@exemplo.com', NULL, NULL, NULL, true, 'a***@exemplo.com'),
  ('email-dominio-diferente', 'ana.souza@exemplo.com.br', 'email', 'ana.souza@exemplo.com.br', NULL, NULL, NULL, true, 'a***@exemplo.com.br'),
  ('email-incompleto', 'ana@', 'email', 'ana@', NULL, NULL, NULL, false, NULL),
  ('email-digitos-antes-do-arroba', '51988887777@exemplo.com', 'email', '51988887777@exemplo.com', NULL, NULL, NULL, true, '5***@exemplo.com'),
  ('email-254-caracteres', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.com', 'email', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.com', NULL, NULL, NULL, true, 'a***@x.com'),
  ('email-255-caracteres', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.com', 'invalid', NULL, NULL, NULL, NULL, true, '***'),
  ('celular-mascara', '(51) 98888-7777', 'mobile', NULL, NULL, '51988887777', '5188887777', true, '***7777'),
  ('celular-com-mais-55', '+55 (51) 98888-7777', 'mobile', NULL, NULL, '51988887777', '5188887777', true, '***7777'),
  ('celular-55-colado', '5551988887777', 'mobile', NULL, NULL, '51988887777', '5188887777', true, '***7777'),
  ('celular-zero-a-esquerda', '051 98888-7777', 'mobile', NULL, NULL, '51988887777', '5188887777', true, '***7777'),
  ('celular-sem-nono-digito', '(51) 8888-7777', 'mobile', NULL, NULL, '5188887777', '5188887777', true, '***7777'),
  ('celular-55-ddd-santa-maria', '55999991234', 'mobile', NULL, NULL, '55999991234', '5599991234', true, '***1234'),
  ('celular-55-ddd-com-codigo-pais', '+55 55 99999-1234', 'mobile', NULL, NULL, '55999991234', '5599991234', true, '***1234'),
  ('celular-12-digitos-com-55', '551988887777', 'mobile', NULL, NULL, '1988887777', '1988887777', true, '***7777'),
  ('celular-dois-zeros', '0051988887777', 'mobile', NULL, NULL, '51988887777', '5188887777', true, '***7777'),
  ('celular-10-digitos-com-55-ddd', '(55) 9999-1234', 'mobile', NULL, NULL, '5599991234', '5599991234', true, '***1234'),
  ('celular-gabi-antigo', '(51) 8877-6655', 'mobile', NULL, NULL, '5188776655', '5188776655', true, '***6655'),
  ('celular-gabi-novo', '(51) 98877-6655', 'mobile', NULL, NULL, '51988776655', '5188776655', true, '***6655'),
  ('cpf-ou-celular-ana-mascara', '529.982.247-25', 'cpf_or_mobile', NULL, '52998224725', '52998224725', '5298224725', true, '***4725'),
  ('cpf-ou-celular-ana-digitos', '52998224725', 'cpf_or_mobile', NULL, '52998224725', '52998224725', '5298224725', true, '***4725'),
  ('cpf-ou-celular-ana-espacos', '529 982 247 25', 'cpf_or_mobile', NULL, '52998224725', '52998224725', '5298224725', true, '***4725'),
  ('cpf-ou-celular-zero-a-esquerda', '012.345.678-90', 'cpf_or_mobile', NULL, '01234567890', '1234567890', '1234567890', true, '***7890'),
  ('cpf-ou-celular-valido-sem-cadastro', '123.456.789-09', 'cpf_or_mobile', NULL, '12345678909', '12345678909', '12345678909', true, '***8909'),
  ('cpf-ou-celular-davi-elisa', '51988887704', 'cpf_or_mobile', NULL, '51988887704', '51988887704', '5188887704', true, '***7704'),
  ('celular-cpf-digito-errado', '529.982.247-26', 'mobile', NULL, NULL, '52998224726', '5298224726', true, '***4726'),
  ('celular-cpf-todos-iguais', '111.111.111-11', 'mobile', NULL, NULL, '11111111111', '11111111111', true, '***1111'),
  ('cpf-so-cpf', '000.000.001-91', 'cpf', NULL, '00000000191', NULL, NULL, true, '***0191'),
  ('invalida-sem-ddd', '9888-7777', 'invalid', NULL, NULL, NULL, NULL, true, '***'),
  ('invalida-sem-ddd-9-digitos', '98888-7777', 'invalid', NULL, NULL, NULL, NULL, true, '***'),
  ('invalida-texto', 'ana.souza', 'invalid', NULL, NULL, NULL, NULL, true, '***'),
  ('invalida-12-digitos-sem-55', '123456789012', 'invalid', NULL, NULL, NULL, NULL, true, '***'),
  ('invalida-longa-sem-arroba', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'invalid', NULL, NULL, NULL, NULL, true, '***'),
  ('invalida-senha-colada', 'Senha#Forte1', 'invalid', NULL, NULL, NULL, NULL, true, '***');

-- Formato e formas normalizadas: uma asserção por caso.
SELECT is(
  (SELECT jsonb_build_object('format', p.format, 'email', p.email, 'cpf', p.cpf, 'mobile', p.mobile, 'mobile_key', p.mobile_key)
     FROM private.parse_login_identifier(c.input) p),
  jsonb_build_object('format', c.format, 'email', c.email, 'cpf', c.cpf, 'mobile', c.mobile, 'mobile_key', c.mobile_key),
  'AQ-3 ' || c.id || ': formato e formas normalizadas de [' || left(c.input, 40) || ']'
) FROM login_cases c ORDER BY c.id;

-- Máscara da Auditoria (AQ-5): só nos casos que a trazem.
SELECT is(
  CASE WHEN c.check_mask THEN (SELECT p.masked FROM private.parse_login_identifier(c.input) p) ELSE NULL END,
  CASE WHEN c.check_mask THEN c.masked ELSE NULL END,
  'AQ-5 ' || c.id || ': máscara de [' || left(c.input, 40) || ']'
) FROM login_cases c ORDER BY c.id;

SELECT * FROM finish();

ROLLBACK;
