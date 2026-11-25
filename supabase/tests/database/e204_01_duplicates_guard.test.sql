-- E2.04 (PR 1): guarda de repetidos da migration 1 (RN-09, RN-18; critério de pronto 2 da
-- tarefa 2). Spec: docs/specs/e2-04-validacoes-membro.md, "Unicidade (migration 1)" e
-- "Verificações obrigatórias" (a guarda falha com a lista de ids, sem mudar nada e sem dado
-- pessoal na mensagem).
--
-- O bloco DO abaixo é a cópia, sem mudança, da guarda da migration
-- 20261125210000_e204_01_rule_functions.sql (um teste do Vitest, em
-- src/test/member-validation-cases-sync.test.ts, falha se as duas divergirem). Ele roda sobre uma
-- massa com repetidos, depois de remover os índices únicos dentro da transação.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(22);

CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2041000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

CREATE TEMP TABLE guard_sql (txt text) ON COMMIT DROP;
INSERT INTO guard_sql VALUES ($guard$
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
$guard$);

-- Roda a guarda e devolve a mensagem do erro, ou 'OK' se ela passa.
CREATE FUNCTION pg_temp.run_guard() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE (SELECT txt FROM guard_sql);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- Os índices únicos já existem (migration aplicada): saem nesta transação para a massa com
-- repetidos poder existir, como num banco de antes da migration.
DROP INDEX public.members_email_key;
DROP INDEX public.members_mobile_key;
DROP INDEX public.members_cpf_key;

-- Dois cadastros com o mesmo celular, pela chave do 9º dígito; os outros dados são distintos.
-- O terceiro e o quarto não contam: um é excluído e o outro tem celular ilegível repetido.
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, email, cpf, mobile_whatsapp, deleted_at) VALUES
  (pg_temp.m(1), 'Ana Alfa',  'F', 'alfa@exemplo.com',  '529.982.247-25', '5188887777',  NULL),
  (pg_temp.m(2), 'Beto Beta', 'M', 'beta@exemplo.com',  NULL,             '51988887777', NULL),
  (pg_temp.m(3), 'Caio Gama', 'M', 'gama@exemplo.com',  NULL,             '5188880001', NULL),
  (pg_temp.m(4), 'Davi Delta','M', 'gama@exemplo.com',  NULL,             '5188880002', now()),
  (pg_temp.m(5), 'Eva Eta',   'F', NULL,                NULL,             '98887777',   NULL),
  (pg_temp.m(6), 'Fabi Zeta', 'F', NULL,                NULL,             '98887777',   NULL);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE msg (k text PRIMARY KEY, v text) ON COMMIT DROP;

-- Cenário 1: só o celular repetido (5188887777 e 51988887777).
INSERT INTO msg VALUES ('mobile', pg_temp.run_guard());
SELECT ok(v LIKE 'E2.04: dados repetidos entre cadastros não excluídos:%', 'RN-09: a guarda recusa o celular equivalente pelo 9º dígito')
  FROM msg WHERE k = 'mobile';
SELECT ok(v LIKE '%' || pg_temp.m(1)::text || '%', 'a mensagem traz o id do primeiro cadastro') FROM msg WHERE k = 'mobile';
SELECT ok(v LIKE '%' || pg_temp.m(2)::text || '%', 'a mensagem traz o id do segundo cadastro') FROM msg WHERE k = 'mobile';
SELECT ok(v LIKE '%"field": "mobile"%', 'a mensagem diz o campo: mobile') FROM msg WHERE k = 'mobile';
SELECT ok(v NOT LIKE '%"field": "email"%', 'e-mail: sem repetido, não é citado') FROM msg WHERE k = 'mobile';
SELECT ok(v NOT LIKE '%"field": "cpf"%', 'CPF: sem repetido, não é citado') FROM msg WHERE k = 'mobile';
SELECT is((SELECT count(*)::int FROM regexp_matches((SELECT v FROM msg WHERE k = 'mobile'), 'c2041000-0000-0000-0000-[0-9]{12}', 'g')), 2,
  'só os dois ids repetidos aparecem (o excluído e o celular ilegível não contam)');
SELECT ok(v NOT LIKE '%' || pg_temp.m(3)::text || '%', 'quem tem o e-mail de um excluído não é citado') FROM msg WHERE k = 'mobile';
SELECT ok(v NOT LIKE '%' || pg_temp.m(5)::text || '%', 'DA-5: o celular ilegível repetido fica fora') FROM msg WHERE k = 'mobile';

-- Sem dado pessoal na mensagem (os logs do deploy são públicos).
SELECT ok(v NOT LIKE '%8888%', 'a mensagem não traz dígitos do celular') FROM msg WHERE k = 'mobile';
SELECT ok(v NOT LIKE '%@%', 'a mensagem não traz e-mail') FROM msg WHERE k = 'mobile';
SELECT ok(lower(v) NOT LIKE '%ana%', 'a mensagem não traz o nome') FROM msg WHERE k = 'mobile';

-- Cenário 2: e-mail e CPF também repetidos (caixa e máscara diferentes).
UPDATE public.members SET email = 'ALFA@Exemplo.com ', cpf = '52998224725' WHERE id = pg_temp.m(2);
CREATE TEMP TABLE before_all ON COMMIT DROP AS
  SELECT count(*) AS n, md5(string_agg(m::text, '|' ORDER BY m.id)) AS h FROM public.members m;
INSERT INTO msg VALUES ('all', pg_temp.run_guard());
SELECT ok(v LIKE '%"field": "email"%', 'e-mail repetido sem diferenciar maiúsculas e espaços') FROM msg WHERE k = 'all';
SELECT ok(v LIKE '%"field": "mobile"%', 'celular repetido continua na lista') FROM msg WHERE k = 'all';
SELECT ok(v LIKE '%"field": "cpf"%', 'CPF repetido pelos 11 dígitos') FROM msg WHERE k = 'all';
SELECT ok(v NOT LIKE '%529%', 'a mensagem não traz dígitos do CPF') FROM msg WHERE k = 'all';
SELECT ok(lower(v) NOT LIKE '%exemplo%', 'a mensagem não traz parte do e-mail') FROM msg WHERE k = 'all';
SELECT is((SELECT count(*)::int FROM regexp_matches((SELECT v FROM msg WHERE k = 'all'), 'c2041000-0000-0000-0000-[0-9]{12}', 'g')), 6,
  'três campos repetidos, cada um com os dois ids');

-- A guarda não grava nada.
SELECT is((SELECT count(*) FROM public.members), (SELECT n FROM before_all), 'a guarda não muda a contagem de cadastros');
SELECT is((SELECT md5(string_agg(m::text, '|' ORDER BY m.id)) FROM public.members m), (SELECT h FROM before_all),
  'a guarda não muda nenhum cadastro');
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname IN ('members_email_key', 'members_mobile_key', 'members_cpf_key')), 0,
  'a guarda não cria índice (a criação vem depois dela, na migration)');

-- Cenário 3: sem repetidos entre os não excluídos, a guarda passa.
UPDATE public.members SET email = 'beta@exemplo.com', cpf = NULL, mobile_whatsapp = '5188887778' WHERE id = pg_temp.m(2);
SELECT is(pg_temp.run_guard(), 'OK', 'sem repetidos entre os não excluídos, a guarda passa');

SELECT * FROM finish();

ROLLBACK;
