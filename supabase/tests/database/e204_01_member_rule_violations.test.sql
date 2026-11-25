-- E2.04 (PR 1): private.member_rule_violations() detecta cada regra do tipo (a) (RN-01, RN-18,
-- risco 8). A função ainda não é guarda (a guarda é da migration 2); aqui se prova que cada
-- regra é detectada, só pelos cadastros certos, e que o cadastro limpo não aparece.
-- Spec: docs/specs/e2-04-validacoes-membro.md, "Dados existentes (migration 2)" (tabela da
-- função), DA-6 (os CHECKs valem também para os excluídos; a unicidade, só para os não excluídos).
-- A função devolve só a regra e o id (nenhum dado pessoal).
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(20);

CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2041300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
-- Os ids que a função devolve para uma regra, em números da massa, ordenados.
CREATE FUNCTION pg_temp.of(_rule text) RETURNS int[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(array_agg((right(v.member_id::text, 12))::int ORDER BY v.member_id), '{}')
     FROM private.member_rule_violations() v
    WHERE v.rule = _rule AND v.member_id::text LIKE 'c2041300-%' $$;

-- Os índices únicos saem na transação: a massa precisa de repetidos.
DROP INDEX public.members_email_key;
DROP INDEX public.members_mobile_key;
DROP INDEX public.members_cpf_key;
-- E2.04 (PR 2): as violações do tipo (a) só existem antes da migration 2 (é sobre elas que a
-- função serve de guarda). O NOT NULL e os CHECKs dela também saem na transação.
ALTER TABLE public.members
  ALTER COLUMN gender DROP NOT NULL,
  DROP CONSTRAINT members_email_check,
  DROP CONSTRAINT members_email_not_placeholder_check,
  DROP CONSTRAINT members_cpf_check,
  DROP CONSTRAINT members_leadership_check,
  DROP CONSTRAINT members_leader_not_self_check,
  DROP CONSTRAINT members_spouse_not_self_check,
  DROP CONSTRAINT members_baptism_check;

-- Cadastros dentro das regras: Samuel (pastor), Pedro (com líder), Ester (sem liderança), Caio
-- (batizado com data) e Bruno (excluído, válido).
-- E2.04 (PR 2): pelas regras de escrita, Ester tem um identificador e "Tem Liderança?" desligado.
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, email, mobile_whatsapp, cpf, is_baptized, baptism_date) VALUES
  (pg_temp.m(1), 'Samuel Colares', 'M', true, NULL, NULL, 'samuel@exemplo.com', '51911110001', '52998224725', false, NULL),
  (pg_temp.m(2), 'Pedro Lima', 'M', false, NULL, pg_temp.m(1), 'pedro@exemplo.com', '51911110002', NULL, false, NULL),
  (pg_temp.m(3), 'Ester Prado', 'F', false, false, NULL, NULL, '51911110003', NULL, false, NULL),
  (pg_temp.m(4), 'Caio Souza', 'M', false, NULL, pg_temp.m(2), 'caio@exemplo.com', NULL, NULL, true, '2020-05-10');

-- A violação de cada regra, em cadastros próprios (inseridos sem os triggers: dado antigo).
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, spouse_id, email, mobile_whatsapp, cpf, is_baptized, baptism_date, deleted_at) VALUES
  -- gender (10, 11 excluído: os CHECKs valem para eles também)
  (pg_temp.m(10), 'Sem Sexo', NULL, false, false, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(11), 'Sem Sexo Excluído', NULL, false, false, NULL, NULL, NULL, NULL, NULL, false, NULL, now()),
  -- email_format (20 maiúsculas, 21 sem ponto, 22 espaço na ponta)
  (pg_temp.m(20), 'Email Maiusculo', 'M', false, false, NULL, NULL, 'Ana@Exemplo.com', NULL, NULL, false, NULL, NULL),
  (pg_temp.m(21), 'Email Sem Ponto', 'M', false, false, NULL, NULL, 'ana@exemplo', NULL, NULL, false, NULL, NULL),
  (pg_temp.m(22), 'Email Espaco', 'M', false, false, NULL, NULL, ' ana2@exemplo.com', NULL, NULL, false, NULL, NULL),
  -- email_placeholder (23)
  (pg_temp.m(23), 'Email Ficticio', 'M', false, false, NULL, NULL, 'x_ab12@mci12fakemail.com', NULL, NULL, false, NULL, NULL),
  -- cpf (30 todos iguais, 31 curto)
  (pg_temp.m(30), 'Cpf Iguais', 'M', false, false, NULL, NULL, NULL, NULL, '11111111111', false, NULL, NULL),
  (pg_temp.m(31), 'Cpf Curto', 'M', false, false, NULL, NULL, NULL, NULL, '123', false, NULL, NULL),
  -- repetidos entre não excluídos: e-mail (40, 41; o 42 excluído não conta), celular pelo 9º dígito (43, 44), CPF (45, 46)
  (pg_temp.m(40), 'Dup Email A', 'M', false, false, NULL, NULL, 'dup@exemplo.com', NULL, NULL, false, NULL, NULL),
  (pg_temp.m(41), 'Dup Email B', 'M', false, false, NULL, NULL, 'DUP@exemplo.com ', NULL, NULL, false, NULL, NULL),
  (pg_temp.m(42), 'Dup Email Excluido', 'M', false, false, NULL, NULL, 'dup@exemplo.com', NULL, NULL, false, NULL, now()),
  (pg_temp.m(43), 'Dup Celular A', 'M', false, false, NULL, NULL, NULL, '5188887777', NULL, false, NULL, NULL),
  (pg_temp.m(44), 'Dup Celular B', 'M', false, false, NULL, NULL, NULL, '(51) 98888-7777', NULL, false, NULL, NULL),
  (pg_temp.m(45), 'Dup Cpf A', 'M', false, false, NULL, NULL, NULL, NULL, '01234567890', false, NULL, NULL),
  (pg_temp.m(46), 'Dup Cpf B', 'M', false, false, NULL, NULL, NULL, NULL, '01234567890', false, NULL, NULL),
  -- celular ilegível repetido fica fora (47, 48)
  (pg_temp.m(47), 'Ilegivel A', 'M', false, false, NULL, NULL, NULL, '98887777', NULL, false, NULL, NULL),
  (pg_temp.m(48), 'Ilegivel B', 'M', false, false, NULL, NULL, NULL, '98887777', NULL, false, NULL, NULL),
  -- RN-11: pastor com líder (50), pastor com a chave (51), pastor com os dois (52), chave sem líder (53), líder sem chave (54)
  (pg_temp.m(50), 'Pastor Com Lider', 'M', true, false, pg_temp.m(1), NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(51), 'Pastor Com Chave', 'M', true, true, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(52), 'Pastor Com Os Dois', 'M', true, true, pg_temp.m(1), NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(53), 'Chave Sem Lider', 'M', false, true, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(54), 'Lider Sem Chave', 'M', false, false, pg_temp.m(1), NULL, NULL, NULL, NULL, false, NULL, NULL),
  -- RN-13: líder de si mesmo (60); ciclo 61 -> 62 -> 63 -> 61, com um discípulo fora do ciclo (64)
  (pg_temp.m(60), 'Lider De Si', 'M', false, true, pg_temp.m(60), NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(61), 'Ciclo Um', 'M', false, true, pg_temp.m(62), NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(62), 'Ciclo Dois', 'M', false, true, pg_temp.m(63), NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(63), 'Ciclo Tres', 'M', false, true, pg_temp.m(61), NULL, NULL, NULL, NULL, false, NULL, NULL),
  (pg_temp.m(64), 'Fora Do Ciclo', 'M', false, true, pg_temp.m(61), NULL, NULL, NULL, NULL, false, NULL, NULL),
  -- RN-14: cônjuge de si mesmo (70)
  (pg_temp.m(70), 'Conjuge De Si', 'F', false, false, NULL, pg_temp.m(70), NULL, NULL, NULL, false, NULL, NULL),
  -- RN-16: data do batismo sem "Batizado(a)?" (80)
  (pg_temp.m(80), 'Batismo Sem Marca', 'M', false, false, NULL, NULL, NULL, NULL, NULL, false, '2020-05-10', NULL);
SET LOCAL session_replication_role = origin;

SELECT is(pg_temp.of('gender'), ARRAY[10, 11], 'gender: nulo, e o excluído também (DA-6)');
SELECT is(pg_temp.of('email_format'), ARRAY[20, 21, 22, 41], 'email_format: maiúsculas, sem ponto, espaço na ponta (41 repete o 40 com caixa e espaço, e também está fora do formato)');
SELECT is(pg_temp.of('email_placeholder'), ARRAY[23], 'email_placeholder: e-mail no domínio fictício');
SELECT is(pg_temp.of('cpf'), ARRAY[30, 31], 'cpf: dígitos iguais e CPF curto');
SELECT is(pg_temp.of('email_in_use'), ARRAY[40, 41], 'email_in_use: sem diferenciar maiúsculas e espaços; o excluído não conta (DEL-04)');
SELECT is(pg_temp.of('mobile_in_use'), ARRAY[43, 44], 'mobile_in_use: pela chave do 9º dígito; o celular ilegível repetido fica fora (DA-5)');
SELECT is(pg_temp.of('cpf_in_use'), ARRAY[45, 46], 'cpf_in_use');
SELECT is(pg_temp.of('pastor_with_leader'), ARRAY[50, 52], 'pastor_with_leader: com a chave desligada e com a ligada');
SELECT is(pg_temp.of('pastor_with_flag'), ARRAY[51, 52], 'pastor_with_flag');
SELECT is(pg_temp.of('flag_without_leader'), ARRAY[53], 'flag_without_leader');
SELECT is(pg_temp.of('leader_without_flag'), ARRAY[54], 'leader_without_flag');
SELECT is(pg_temp.of('leader_self'), ARRAY[60], 'leader_self');
SELECT is(pg_temp.of('leader_cycle'), ARRAY[61, 62, 63], 'leader_cycle: só quem está no ciclo, e não o discípulo dele (64)');
SELECT is(pg_temp.of('spouse_self'), ARRAY[70], 'spouse_self');
SELECT is(pg_temp.of('baptism_date'), ARRAY[80], 'baptism_date: data do batismo sem "Batizado(a)?"');

-- Quem está dentro das regras não aparece em nenhuma linha.
SELECT is((SELECT count(*)::int FROM private.member_rule_violations() v WHERE v.member_id IN
            (pg_temp.m(1), pg_temp.m(2), pg_temp.m(3), pg_temp.m(4))), 0,
  'Samuel, Pedro, Ester e Caio (dentro das regras) não aparecem');
SELECT is((SELECT count(*)::int FROM private.member_rule_violations() v WHERE v.member_id IN (pg_temp.m(42), pg_temp.m(47), pg_temp.m(48))), 0,
  'DA-5 e DEL-04: o excluído com e-mail repetido e o celular ilegível repetido não são violação');
-- Só regra e id: a função não devolve dado pessoal.
SELECT is((SELECT array_agg(a ORDER BY a) FROM unnest((SELECT proargnames FROM pg_proc WHERE oid = 'private.member_rule_violations()'::regprocedure)) a),
  ARRAY['member_id', 'rule'], 'a função devolve só a regra e o id');
-- A mesma lista, ordenada pela própria função: regra e id crescentes.
SELECT is((SELECT array_agg(v.rule || v.member_id::text) FROM private.member_rule_violations() v),
  (SELECT array_agg(v.rule || v.member_id::text ORDER BY v.rule, v.member_id) FROM private.member_rule_violations() v),
  'a função já devolve ordenada por regra e id');

-- Corrigida a massa, a função volta sem linhas dos cadastros de teste (invariante).
SET LOCAL session_replication_role = replica;
DELETE FROM public.members WHERE id::text LIKE 'c2041300-%' AND id NOT IN (pg_temp.m(1), pg_temp.m(2), pg_temp.m(3), pg_temp.m(4));
SET LOCAL session_replication_role = origin;
SELECT is((SELECT count(*)::int FROM private.member_rule_violations() v WHERE v.member_id::text LIKE 'c2041300-%'), 0,
  'invariante: sem as violações, a função devolve vazio para os cadastros da massa');

SELECT * FROM finish();

ROLLBACK;
