-- E2.04 (PR 2): o a0_normalize_member (vazio vira nulo, DT-24) e as correções de dados da
-- migration 2 (DA-8, DT-24), com a guarda (DT-21). Também a condição "cpf" de
-- private.member_rule_violations() com CPF com máscara (pendência do PR 1).
-- Spec: docs/specs/e2-04-validacoes-membro.md, "Dados existentes (migration 2)",
-- "a0_normalize_member", "Verificações obrigatórias" (Correções da migration 2), DA-8, DT-21, DT-24.
-- O bloco de correções é a cópia literal da seção 1 da migration 20261125220000 (linhas 77 a 155),
-- reexecutada com os triggers novos desligados e os CHECKs fora da transação, como a migration
-- faz (ela tira os triggers antes e põe os CHECKs depois). Se a migration mudar, copie de novo.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(42);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2040202-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2040202-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

CREATE FUNCTION pg_temp.scenario(_setup text, _role text, _n int, _call text, _after text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _state text; _msg text; _detail text; _hint text; _con text; _res jsonb; _aft text;
BEGIN
  BEGIN
    IF _setup IS NOT NULL THEN EXECUTE _setup; END IF;
    IF _role = 'authenticated' THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    END IF;
    IF _role <> 'postgres' THEN EXECUTE format('SET LOCAL ROLE %I', _role); END IF;
    BEGIN
      EXECUTE _call;
      IF _role <> 'postgres' THEN EXECUTE 'RESET ROLE'; END IF;
      _res := jsonb_build_object('ok', true);
    EXCEPTION WHEN OTHERS THEN
      IF _role <> 'postgres' THEN EXECUTE 'RESET ROLE'; END IF;
      GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _detail = PG_EXCEPTION_DETAIL,
                              _hint = PG_EXCEPTION_HINT, _con = CONSTRAINT_NAME;
      _res := jsonb_build_object('ok', false, 'state', _state, 'message', _msg, 'constraint', _con,
        'detail', _detail,
        'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%' THEN _detail::jsonb ->> 'code' ELSE _state END,
        'field', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ->> 'field' END,
        'fields', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb -> 'fields' END);
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF _after IS NOT NULL THEN EXECUTE _after INTO _aft; _res := _res || jsonb_build_object('after', _aft); END IF;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'XU001', DETAIL = _res::text;
  EXCEPTION WHEN SQLSTATE 'XU001' THEN
    GET STACKED DIAGNOSTICS _detail = PG_EXCEPTION_DETAIL;
    RETURN _detail::jsonb;
  END;
END $$;

-- INSERT e UPDATE a partir de um jsonb (só as colunas citadas; as omitidas ficam com o default).
CREATE FUNCTION pg_temp.ins(_j jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.members (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::public.members, %2$L)',
                (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(_j) k), _j) $$;
CREATE FUNCTION pg_temp.upd(_id uuid, _j jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('UPDATE public.members t SET %s FROM jsonb_populate_record(NULL::public.members, %L) r WHERE t.id = %L',
                (SELECT string_agg(format('%1$I = r.%1$I', k), ', ') FROM jsonb_object_keys(_j) k), _j, _id) $$;
-- Cadastro novo padrão: Lúcia Nova, M/F, líder Pedro. _j sobrescreve (chave com null remove o padrão).
CREATE FUNCTION pg_temp.newm(_j jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('name', 'Lúcia Nova', 'gender', 'F', 'mobile_whatsapp', '(51) 98888-1234',
                                              'leader_id', pg_temp.m(3)) || _j) $$;
-- "código|campo|mensagem" de um resultado, para comparar de uma vez.
CREATE FUNCTION pg_temp.sig(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN (_r ->> 'ok')::boolean THEN 'ok'
              ELSE (_r ->> 'code') || '|' || coalesce(_r ->> 'field', _r ->> 'fields', '') || '|' || (_r ->> 'message') END $$;

CREATE TEMP TABLE rs (k text PRIMARY KEY, r jsonb) ON COMMIT DROP;
-- Atalhos: a = Rita (Administrador), p = Pedro (Líder), c = Caio (Membro).
CREATE FUNCTION pg_temp.run(_k text, _role text, _n int, _call text, _after text DEFAULT NULL, _setup text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO rs VALUES (_k, pg_temp.scenario(_setup, _role, _n, _call, _after)) $$;

CREATE FUNCTION pg_temp.row_of(_id uuid, _col text) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT %I::text FROM public.members WHERE id = %L', _col, _id) $$;
CREATE FUNCTION pg_temp.corr() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  _report text;
BEGIN
  -- 1.1 Texto vazio ou só com espaços vira nulo em todo campo de texto
  --     opcional (DT-24). Vem antes dos demais: o CPF '' dava 'cpf' na guarda.
  UPDATE public.members m
     SET email           = CASE WHEN m.email           ~ '^[[:space:]]*$' THEN NULL ELSE m.email END,
         cpf             = CASE WHEN m.cpf             ~ '^[[:space:]]*$' THEN NULL ELSE m.cpf END,
         mobile_whatsapp = CASE WHEN m.mobile_whatsapp ~ '^[[:space:]]*$' THEN NULL ELSE m.mobile_whatsapp END,
         phone           = CASE WHEN m.phone           ~ '^[[:space:]]*$' THEN NULL ELSE m.phone END,
         instagram       = CASE WHEN m.instagram       ~ '^[[:space:]]*$' THEN NULL ELSE m.instagram END,
         avatar_url      = CASE WHEN m.avatar_url      ~ '^[[:space:]]*$' THEN NULL ELSE m.avatar_url END,
         notes           = CASE WHEN m.notes           ~ '^[[:space:]]*$' THEN NULL ELSE m.notes END,
         street          = CASE WHEN m.street          ~ '^[[:space:]]*$' THEN NULL ELSE m.street END,
         number          = CASE WHEN m.number          ~ '^[[:space:]]*$' THEN NULL ELSE m.number END,
         complement      = CASE WHEN m.complement      ~ '^[[:space:]]*$' THEN NULL ELSE m.complement END,
         neighborhood    = CASE WHEN m.neighborhood    ~ '^[[:space:]]*$' THEN NULL ELSE m.neighborhood END,
         city            = CASE WHEN m.city            ~ '^[[:space:]]*$' THEN NULL ELSE m.city END,
         state           = CASE WHEN m.state           ~ '^[[:space:]]*$' THEN NULL ELSE m.state END,
         zip_code        = CASE WHEN m.zip_code        ~ '^[[:space:]]*$' THEN NULL ELSE m.zip_code END
   WHERE m.email ~ '^[[:space:]]*$' OR m.cpf ~ '^[[:space:]]*$' OR m.mobile_whatsapp ~ '^[[:space:]]*$'
      OR m.phone ~ '^[[:space:]]*$' OR m.instagram ~ '^[[:space:]]*$' OR m.avatar_url ~ '^[[:space:]]*$'
      OR m.notes ~ '^[[:space:]]*$' OR m.street ~ '^[[:space:]]*$' OR m.number ~ '^[[:space:]]*$'
      OR m.complement ~ '^[[:space:]]*$' OR m.neighborhood ~ '^[[:space:]]*$' OR m.city ~ '^[[:space:]]*$'
      OR m.state ~ '^[[:space:]]*$' OR m.zip_code ~ '^[[:space:]]*$';

  -- 1.2 E-mail fictício vira nulo no cadastro (DA-7). A conta continua com ele.
  UPDATE public.members m SET email = NULL WHERE public.is_placeholder_email(m.email);

  -- 1.3 E-mail na forma normalizada (RN-04).
  UPDATE public.members m
     SET email = public.normalize_email(m.email)
   WHERE m.email IS NOT NULL
     AND public.normalize_email(m.email) IS NOT NULL
     AND m.email <> public.normalize_email(m.email);

  -- 1.4 CPF só com dígitos, apenas quando o resultado é um CPF válido. O
  --     inválido (com letras, inclusive) não é apagado: para na guarda.
  UPDATE public.members m
     SET cpf = public.normalize_digits(m.cpf)
   WHERE m.cpf IS NOT NULL
     AND m.cpf IS DISTINCT FROM public.normalize_digits(m.cpf)
     AND coalesce(public.is_valid_cpf(public.normalize_digits(m.cpf)), false);

  -- 1.5 Celular legível na forma lida (RN-06); o ilegível, só com dígitos
  --     (quando sobra algum).
  UPDATE public.members m
     SET mobile_whatsapp = coalesce(public.normalize_mobile(m.mobile_whatsapp),
                                    public.normalize_digits(m.mobile_whatsapp))
   WHERE m.mobile_whatsapp IS NOT NULL
     AND coalesce(public.normalize_mobile(m.mobile_whatsapp), public.normalize_digits(m.mobile_whatsapp)) IS NOT NULL
     AND m.mobile_whatsapp <> coalesce(public.normalize_mobile(m.mobile_whatsapp),
                                       public.normalize_digits(m.mobile_whatsapp));

  -- 1.6 Espaços do nome (RN-02). Um nome que ficaria vazio não é tocado.
  UPDATE public.members m
     SET name = public.normalize_person_name(m.name)
   WHERE public.normalize_person_name(m.name) IS NOT NULL
     AND m.name <> public.normalize_person_name(m.name);

  -- 1.7 "Tem Liderança?" coerente (RN-11): desligado no pastor sem líder;
  --     ligado em quem tem líder (já feito pelo E2.02; repetir não muda nada).
  UPDATE public.members m
     SET has_leadership = false
   WHERE m.is_pastor AND m.leader_id IS NULL AND m.has_leadership;
  UPDATE public.members m
     SET has_leadership = true
   WHERE m.leader_id IS NOT NULL AND NOT m.has_leadership;

  -- 1.8 Guarda: o que sobrou fora do tipo (a) pede decisão do usuário.
  SELECT string_agg(g.rule || ': ' || g.ids, '; ' ORDER BY g.rule)
    INTO _report
    FROM (SELECT v.rule, string_agg(v.member_id::text, ', ' ORDER BY v.member_id) AS ids
            FROM private.member_rule_violations() v
           GROUP BY v.rule) g;
  IF _report IS NOT NULL THEN
    RAISE EXCEPTION 'E2.04: cadastros fora das regras do tipo (a). Corrija e publique de novo. %', _report;
  END IF;
END $$;

CREATE FUNCTION pg_temp.run2(_k text, _role text, _call text, _after text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ SELECT pg_temp.run(_k, _role, NULL, _call, _after) $$;

-- ---------------------------------------------------------------------------
-- a0_normalize_member: o vazio e o só com espaços viram nulo, no INSERT e no UPDATE, também pela
-- service role e pelo postgres. Um pastor de partida (sem líder), para não depender de ninguém.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.blank_ins(_extra jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ins(jsonb_build_object('id', pg_temp.m(1), 'name', 'Ana Vazia', 'gender', 'F', 'is_pastor', true,
    'mobile_whatsapp', '51988880001', 'phone', '   ', 'instagram', '', 'avatar_url', ' ', 'notes', E' \t ',
    'street', '', 'number', ' ', 'complement', '  ', 'neighborhood', '', 'city', ' ', 'state', '  ', 'zip_code', '') || _extra) $$;

-- a0_: INSERT por papel. As colunas de texto opcionais voltam nulas.
SELECT pg_temp.run2('ins_' || r, r, pg_temp.blank_ins('{}'),
  $q$SELECT concat_ws('|', phone IS NULL, instagram IS NULL, avatar_url IS NULL, notes IS NULL, street IS NULL, number IS NULL, complement IS NULL, neighborhood IS NULL, city IS NULL, state IS NULL, zip_code IS NULL) FROM public.members WHERE name = 'Ana Vazia'$q$)
  FROM unnest(ARRAY['postgres', 'service_role']) r;
SELECT is(r ->> 'after', 't|t|t|t|t|t|t|t|t|t|t', 'DT-24: INSERT pela ' || replace(k, 'ins_', '') || ': telefone, Instagram, avatar, observações e endereço vazios viram nulo') FROM rs WHERE k LIKE 'ins\_%' ORDER BY k;
-- E-mail e CPF vazios, com o celular válido; e celular vazio com o e-mail válido.
SELECT pg_temp.run2('ins_ec', 'service_role', pg_temp.blank_ins('{"email": "  ", "cpf": ""}'),
  $q$SELECT concat_ws('|', email IS NULL, cpf IS NULL, mobile_whatsapp) FROM public.members WHERE name = 'Ana Vazia'$q$);
SELECT pg_temp.run2('ins_m', 'service_role', pg_temp.blank_ins('{"mobile_whatsapp": "  ", "email": "ana@exemplo.com", "cpf": " "}'),
  $q$SELECT concat_ws('|', mobile_whatsapp IS NULL, cpf IS NULL, email) FROM public.members WHERE name = 'Ana Vazia'$q$);
SELECT pg_temp.run2('ins_m_empty', 'postgres', pg_temp.blank_ins('{"mobile_whatsapp": "", "email": "ana@exemplo.com"}'),
  $q$SELECT (mobile_whatsapp IS NULL)::text FROM public.members WHERE name = 'Ana Vazia'$q$);
SELECT is(r ->> 'after', 't|t|51988880001', 'DT-24: e-mail "  " e CPF "" viram nulo (service role)') FROM rs WHERE k = 'ins_ec';
SELECT is(r ->> 'after', 't|t|ana@exemplo.com', 'DT-24: celular "  " e CPF " " viram nulo, o e-mail fica (service role)') FROM rs WHERE k = 'ins_m';
SELECT is(r ->> 'after', 'true', 'DT-24: celular "" vira nulo (postgres)') FROM rs WHERE k = 'ins_m_empty';

-- a0_: UPDATE por papel, sobre um cadastro com tudo preenchido.
INSERT INTO public.members (id, name, gender, is_pastor, mobile_whatsapp, email, cpf, phone, instagram, avatar_url, notes,
                            street, number, complement, neighborhood, city, state, zip_code)
VALUES (pg_temp.m(2), 'Beto Cheio', 'M', true, '51988880002', 'beto@exemplo.com', '11144477735', '5133330000', '@beto', 'http://x/a.png', 'obs',
        'Rua A', '10', 'ap 1', 'Centro', 'Santa Maria', 'RS', '97000000');
SELECT pg_temp.run2('upd_' || r, r,
  pg_temp.upd(pg_temp.m(2), '{"phone": "  ", "instagram": "", "avatar_url": " ", "notes": "   ", "street": "", "number": " ", "complement": "  ", "neighborhood": "", "city": " ", "state": "  ", "zip_code": ""}'),
  $q$SELECT concat_ws('|', phone IS NULL, instagram IS NULL, avatar_url IS NULL, notes IS NULL, street IS NULL, number IS NULL, complement IS NULL, neighborhood IS NULL, city IS NULL, state IS NULL, zip_code IS NULL) FROM public.members WHERE name = 'Beto Cheio'$q$)
  FROM unnest(ARRAY['postgres', 'service_role']) r;
SELECT is(r ->> 'after', 't|t|t|t|t|t|t|t|t|t|t', 'DT-24: UPDATE pela ' || replace(k, 'upd_', '') || ': os campos de texto opcionais vazios viram nulo') FROM rs WHERE k LIKE 'upd\_%' ORDER BY k;
-- Celular, e-mail e CPF vazios no UPDATE (um identificador sobra).
SELECT pg_temp.run2('upd_idents', 'service_role', pg_temp.upd(pg_temp.m(2), '{"mobile_whatsapp": "  ", "cpf": ""}'),
  $q$SELECT concat_ws('|', mobile_whatsapp IS NULL, cpf IS NULL, email) FROM public.members WHERE name = 'Beto Cheio'$q$);
SELECT pg_temp.run2('upd_email', 'service_role', pg_temp.upd(pg_temp.m(2), '{"email": "   "}'),
  $q$SELECT concat_ws('|', email IS NULL, mobile_whatsapp) FROM public.members WHERE name = 'Beto Cheio'$q$);
SELECT is(r ->> 'after', 't|t|beto@exemplo.com', 'DT-24: UPDATE: celular "  " e CPF "" viram nulo (service role)') FROM rs WHERE k = 'upd_idents';
SELECT is(r ->> 'after', 't|51988880002', 'DT-24: UPDATE: e-mail só com espaços vira nulo (service role)') FROM rs WHERE k = 'upd_email';
-- O conteúdo preenchido não é tocado (só o vazio vira nulo).
SELECT pg_temp.run2('keep', 'service_role', pg_temp.upd(pg_temp.m(2), '{"notes": "  texto com espaços  ", "city": " Santa Maria "}'),
  $q$SELECT concat_ws('|', notes, city) FROM public.members WHERE name = 'Beto Cheio'$q$);
SELECT is(r ->> 'after', '  texto com espaços  | Santa Maria ', 'DT-24: o conteúdo preenchido não é alterado') FROM rs WHERE k = 'keep';

-- ---------------------------------------------------------------------------
-- Correções da migration (DA-8, DT-24) e guarda (DT-21). A migration tira os triggers novos antes
-- das correções e os CHECKs ainda não existem: aqui os triggers saem e os CHECKs saem da transação.
-- ---------------------------------------------------------------------------
ALTER TABLE public.members DISABLE TRIGGER a0_normalize_member;
ALTER TABLE public.members DISABLE TRIGGER ad_enforce_member_rules;
DROP INDEX public.members_email_key;
DROP INDEX public.members_mobile_key;
DROP INDEX public.members_cpf_key;
ALTER TABLE public.members
  ALTER COLUMN gender DROP NOT NULL,
  DROP CONSTRAINT members_email_check,
  DROP CONSTRAINT members_email_not_placeholder_check,
  DROP CONSTRAINT members_cpf_check,
  DROP CONSTRAINT members_leadership_check,
  DROP CONSTRAINT members_leader_not_self_check,
  DROP CONSTRAINT members_spouse_not_self_check,
  DROP CONSTRAINT members_baptism_check;

-- Dado antigo (10 a 19: vazio e espaços; 20: CPF válido com máscara; 21: CPF com letras;
-- 22: e-mail fictício; 23: e-mail com caixa e espaços; 24: celular com máscara; 25: nome com
-- espaços; 26: pastor com a chave ligada; 27: líder sem a chave).
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, mobile_whatsapp, email, cpf, phone, instagram, avatar_url, notes, street, number, complement, neighborhood, city, state, zip_code) VALUES
  (pg_temp.m(10), 'Cpf Vazio', 'M', true, false, NULL, '51911110010', NULL, '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(11), 'Cpf Espacos', 'M', true, false, NULL, '51911110011', NULL, '   ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(12), 'Celular Vazio', 'M', true, false, NULL, '', 'cel@exemplo.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(13), 'Telefone Espacos', 'M', true, false, NULL, '51911110013', NULL, NULL, '  ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(14), 'Email Vazio', 'M', true, false, NULL, '51911110014', '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(15), 'Email Espacos', 'M', true, false, NULL, '51911110015', '  ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(16), 'Insta Obs', 'M', true, false, NULL, '51911110016', NULL, NULL, NULL, ' ', NULL, E'\t', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(17), 'Endereco Vazio', 'M', true, false, NULL, '51911110017', NULL, NULL, NULL, NULL, '  ', NULL, '', ' ', '  ', '', ' ', '  ', ''),
  (pg_temp.m(20), 'Cpf Mascara', 'M', true, false, NULL, '51911110020', NULL, '529.982.247-25', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(21), 'Cpf Letras', 'M', true, false, NULL, '51911110021', NULL, '5299822472a', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(22), 'Email Ficticio', 'M', true, false, NULL, '51911110022', 'x_ab12@mci12fakemail.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(23), 'Email Caixa', 'M', true, false, NULL, '51911110023', ' Caixa@Exemplo.COM ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(24), 'Celular Mascara', 'M', true, false, NULL, '+55 (51) 98888-0024', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(25), 'Nome   Espacos', 'M', true, false, NULL, '51911110025', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(26), 'Pastor Chave', 'M', true, true, NULL, '51911110026', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.m(27), 'Lider Sem Chave', 'M', false, false, pg_temp.m(10), '51911110027', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- Antes das correções: o vazio e a máscara aparecem como violação do CPF (pendência do PR 1).
CREATE FUNCTION pg_temp.of(_rule text) RETURNS int[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(array_agg((right(v.member_id::text, 12))::int ORDER BY v.member_id), '{}')
     FROM private.member_rule_violations() v WHERE v.rule = _rule AND v.member_id::text LIKE 'c2040202-%' $$;
SELECT is(pg_temp.of('cpf'), ARRAY[10, 11, 20, 21], 'antes: CPF vazio, só com espaços, válido com máscara e com letras são violação "cpf"');
SELECT is(pg_temp.of('email_format'), ARRAY[14, 15, 23], 'antes: e-mail vazio, só com espaços, com caixa e com espaços nas pontas são violação "email_format"');
SELECT is(pg_temp.of('email_placeholder'), ARRAY[22], 'antes: e-mail fictício é violação "email_placeholder"');
SELECT is(pg_temp.of('leader_without_flag'), ARRAY[27], 'antes: líder sem a chave é violação');
SELECT is(pg_temp.of('pastor_with_flag'), ARRAY[26], 'antes: pastor com a chave é violação');

-- A guarda: com o CPF com letras, a migration falha, com a regra e o id, sem dado pessoal, e as
-- correções são desfeitas junto.
SELECT throws_like($q$SELECT pg_temp.corr()$q$, 'E2.04: cadastros fora das regras do tipo (a). Corrija e publique de novo. cpf: ' || pg_temp.m(21)::text,
  'DT-21: a guarda falha só com a regra e o id (CPF com letras)');
SELECT is(pg_temp.scenario(NULL, 'postgres', NULL, 'SELECT pg_temp.corr()') ->> 'message',
  'E2.04: cadastros fora das regras do tipo (a). Corrija e publique de novo. cpf: ' || pg_temp.m(21)::text,
  'DT-21: a mensagem completa, sem e-mail, celular, CPF nem nome');
SELECT is(pg_temp.scenario(NULL, 'postgres', NULL, 'SELECT pg_temp.corr()') ->> 'message' ~ '5299822472|Letras|529|@', false,
  'DT-21: nenhum dado pessoal na mensagem');
SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(10)), '', 'a guarda desfaz tudo: o CPF vazio de 10 continua como estava');
SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(20)), '529.982.247-25', 'a guarda desfaz tudo: o CPF com máscara de 20 continua');
SELECT is((SELECT email FROM public.members WHERE id = pg_temp.m(22)), 'x_ab12@mci12fakemail.com', 'a guarda desfaz tudo: o e-mail fictício continua');

-- Corrige o que a guarda pediu e roda as correções.
UPDATE public.members SET cpf = '39053344705' WHERE id = pg_temp.m(21);
SELECT lives_ok($q$SELECT pg_temp.corr()$q$, 'DA-8: sem violação restante, as correções passam');

SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(10)), NULL, 'DT-24: CPF "" vira nulo');
SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(11)), NULL, 'DT-24: CPF só com espaços vira nulo');
SELECT is((SELECT mobile_whatsapp FROM public.members WHERE id = pg_temp.m(12)), NULL, 'DT-24: celular "" vira nulo');
SELECT is((SELECT phone FROM public.members WHERE id = pg_temp.m(13)), NULL, 'DT-24: telefone só com espaços vira nulo');
SELECT is((SELECT email FROM public.members WHERE id = pg_temp.m(14)), NULL, 'DT-24: e-mail "" vira nulo');
SELECT is((SELECT email FROM public.members WHERE id = pg_temp.m(15)), NULL, 'DT-24: e-mail só com espaços vira nulo');
SELECT is((SELECT concat_ws('|', instagram IS NULL, notes IS NULL) FROM public.members WHERE id = pg_temp.m(16)), 't|t', 'DT-24: Instagram e observações vazios viram nulo');
SELECT is((SELECT concat_ws('|', avatar_url IS NULL, street IS NULL, number IS NULL, complement IS NULL, neighborhood IS NULL, city IS NULL, state IS NULL, zip_code IS NULL)
             FROM public.members WHERE id = pg_temp.m(17)), 't|t|t|t|t|t|t|t', 'DT-24: avatar e todo o endereço vazios viram nulo');
SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(20)), '52998224725', 'DA-8: o CPF válido com máscara vira só dígitos');
SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(21)), '39053344705', 'o CPF já corrigido continua');
SELECT is((SELECT email FROM public.members WHERE id = pg_temp.m(22)), NULL, 'DA-7: o e-mail fictício vira nulo no cadastro');
SELECT is((SELECT email FROM public.members WHERE id = pg_temp.m(23)), 'caixa@exemplo.com', 'RN-04: o e-mail vai para a forma normalizada');
SELECT is((SELECT mobile_whatsapp FROM public.members WHERE id = pg_temp.m(24)), '51988880024', 'RN-06: o celular vai para a forma lida');
SELECT is((SELECT name FROM public.members WHERE id = pg_temp.m(25)), 'Nome Espacos', 'RN-02: os espaços do nome são normalizados');
SELECT is((SELECT has_leadership FROM public.members WHERE id = pg_temp.m(26)), false, 'RN-11: o pastor sem líder fica com a chave desligada');
SELECT is((SELECT has_leadership FROM public.members WHERE id = pg_temp.m(27)), true, 'RN-11: quem tem líder fica com a chave ligada');
SELECT is((SELECT count(*)::int FROM private.member_rule_violations() v WHERE v.member_id::text LIKE 'c2040202-%'), 0,
  'invariante: depois das correções, a função de violações não tem linhas da massa');
-- Repetir não muda nada nem falha.
SELECT lives_ok($q$SELECT pg_temp.corr()$q$, 'as correções rodam de novo sem erro');
SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(20)), '52998224725', 'repetir não muda o CPF já corrigido');

-- A conferência: o vazio não é mais violação e, com os triggers de volta, o a0_ grava nulo.
ALTER TABLE public.members ENABLE TRIGGER a0_normalize_member;
ALTER TABLE public.members ENABLE TRIGGER ad_enforce_member_rules;
SELECT pg_temp.run2('after_restore', 'service_role', pg_temp.upd(pg_temp.m(10), '{"phone": "  ", "cpf": "   "}'),
  $q$SELECT concat_ws('|', phone IS NULL, cpf IS NULL) FROM public.members WHERE name = 'Cpf Vazio'$q$);
SELECT is(r ->> 'after', 't|t', 'DT-24: com o a0_ de volta, o vazio continua virando nulo no UPDATE') FROM rs WHERE k = 'after_restore';

SELECT * FROM finish();

ROLLBACK;
