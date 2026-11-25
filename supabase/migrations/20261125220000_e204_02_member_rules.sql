-- E2.04 (PR 2, migration 2) — Regras do cadastro de membro no banco.
-- Ver docs/specs/e2-04-validacoes-membro.md no repositório apps-mci
-- ("Integridade do tipo (a) (migration 2)", "Dados existentes (migration 2)",
-- "Escrita", "Formato dos erros (AQ-1)", "Bloqueios e concorrência",
-- "Contratos"; RN-01 a RN-19; DA-2, DA-6, DA-7, DA-8, DA-11; DT-02, DT-04 a
-- DT-09, DT-12 a DT-15, DT-21, DT-23, DT-24).
--
-- 1. Correções sem perda nos dados existentes (DA-8, DT-24), depois a guarda
--    das violações do tipo (a) (DT-21), no mesmo bloco: se a guarda falha,
--    nada muda. A mensagem traz só nomes de regra e ids, nunca e-mail,
--    celular, CPF ou nome: os logs do deploy são públicos.
-- 2. NOT NULL em gender; has_leadership sem default (DT-06); os CHECKs
--    (DT-02, DA-6: valem também para os excluídos).
-- 3. Dois triggers novos em members (DT-04): a0_normalize_member (normaliza,
--    devolve o gravado ao que não mudou e deriva "Tem Liderança?"; nunca
--    recusa) e ad_enforce_member_rules (recusa com código e campo, com as
--    travas de unicidade e de ciclo; sem exceção de papel).
-- 4. Ajustes nos passos anteriores: enforce_member_scope (ac_),
--    enforce_member_links (ab_, sem a recusa deleted_account_email, que passa
--    para o ad_), sync_spouse_relationship (spouse_self em pt-BR) e
--    check_member_insert (id e has_leadership como vieram).
--    A regra 1 de enforce_member_write_rules (aa_: INSERT sem create_member →
--    42501, antes de tudo) já existe desde o E2.01 e não muda.
--
-- Pode rodar de novo sem erro: os triggers novos saem antes das correções e
-- voltam no fim; CREATE OR REPLACE; CHECKs em DO com guarda de
-- duplicate_object; ALTER COLUMN repetível.

-- ===========================================================================
-- 0. Pré-requisitos: a migration 1 do E2.04 e os triggers do E2.01 e do E2.02.
--    Falha cedo, sem mudar nada.
-- ===========================================================================
DO $$
BEGIN
  IF to_regprocedure('public.is_valid_person_name(text)') IS NULL
     OR to_regprocedure('public.normalize_person_name(text)') IS NULL
     OR to_regprocedure('public.is_valid_email(text)') IS NULL
     OR to_regprocedure('public.is_placeholder_email(text)') IS NULL
     OR to_regprocedure('public.member_has_login_identifier(text, text, text)') IS NULL
     OR to_regprocedure('public.birth_date_problem(date, date)') IS NULL
     OR to_regprocedure('public._member_values_in_use(uuid, text, text, text, boolean)') IS NULL
     OR to_regprocedure('private.member_rule_violations()') IS NULL
     OR to_regprocedure('public.normalize_mobile(text)') IS NULL
     OR to_regprocedure('public.normalize_digits(text)') IS NULL
     OR to_regprocedure('public.normalize_email(text)') IS NULL
     OR to_regprocedure('public.is_valid_cpf(text)') IS NULL
     OR to_regprocedure('public.sp_today()') IS NULL
     OR to_regprocedure('public._del_raise(text, text, jsonb)') IS NULL
     OR to_regprocedure('public.viewer_has(public.permission_action)') IS NULL
     OR to_regprocedure('public.viewer_sees_member(uuid)') IS NULL
     OR to_regprocedure('public.check_member_insert(jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass
                     AND t.tgname = 'aa_enforce_member_write_rules')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass
                     AND t.tgname = 'ab_enforce_member_links')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass
                     AND t.tgname = 'ac_enforce_member_scope') THEN
    RAISE EXCEPTION 'E2.04 (migration 2) depende da migration 1 do E2.04, do E2.01 e do E2.02.';
  END IF;
END $$;

-- Os triggers novos saem antes das correções: numa segunda execução, as
-- correções não passam pelas regras de escrita (elas existem justamente para
-- trazer os dados para dentro delas). Voltam na seção 4.
DROP TRIGGER IF EXISTS a0_normalize_member ON public.members;
DROP TRIGGER IF EXISTS ad_enforce_member_rules ON public.members;

-- ===========================================================================
-- 1. Dados existentes (DA-8, DT-24) e guarda (DT-21). Um bloco só: se a guarda
--    falha, as correções são desfeitas.
--    UPDATEs só nas linhas afetadas (menos ruído na Auditoria, que registra as
--    alterações sem autor, como na migration 1 do E2.02). Valem também para
--    os excluídos, porque os CHECKs valem para eles (DA-6). As chaves dos
--    índices únicos não mudam com nenhuma destas correções.
-- ===========================================================================
DO $$
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

-- ===========================================================================
-- 2. Integridade do tipo (a) (DT-02)
-- ===========================================================================
ALTER TABLE public.members ALTER COLUMN gender SET NOT NULL;          -- RN-03 (o CHECK M/F já existe)
ALTER TABLE public.members ALTER COLUMN has_leadership DROP DEFAULT;  -- DT-06: omitido = NULL, resolvido no a0_

-- Os CHECKs valem também para os excluídos (DA-6). Um CHECK que chama função
-- não é revalidado quando a função muda (risco 8): toda mudança de regra
-- confere os dados antes com private.member_rule_violations().
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.members ADD CONSTRAINT members_email_check          -- RN-04
      CHECK (email IS NULL OR coalesce(email = public.normalize_email(email) AND public.is_valid_email(email), false));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.members ADD CONSTRAINT members_email_not_placeholder_check  -- RN-05, DA-7
      CHECK (NOT public.is_placeholder_email(email));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.members ADD CONSTRAINT members_cpf_check            -- RN-07
      CHECK (cpf IS NULL OR coalesce(public.is_valid_cpf(cpf), false));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.members ADD CONSTRAINT members_leadership_check     -- RN-11
      CHECK (   (is_pastor AND leader_id IS NULL AND NOT has_leadership)
             OR (NOT is_pastor AND has_leadership = (leader_id IS NOT NULL)));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.members ADD CONSTRAINT members_leader_not_self_check  -- RN-13
      CHECK (leader_id <> id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.members ADD CONSTRAINT members_spouse_not_self_check  -- RN-14
      CHECK (spouse_id <> id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.members ADD CONSTRAINT members_baptism_check        -- RN-16
      CHECK (is_baptized OR baptism_date IS NULL);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ===========================================================================
-- 3. Funções dos triggers novos
-- ===========================================================================

-- a0_normalize_member (DT-04, DT-05, DT-06, DT-24). INVOKER: só lê NEW e OLD e
-- chama funções imutáveis. Vale para qualquer papel. Nunca recusa, então quem
-- não pode gravar não descobre nada por ele.
CREATE OR REPLACE FUNCTION public.normalize_member_input()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _ins constant boolean := TG_OP = 'INSERT';
BEGIN
  -- RN-17: "mudou" = diferente depois de lido pela regra. O que não mudou volta
  -- ao gravado, mesmo fora do formato. O que mudou é gravado já normalizado.
  IF _ins OR public.normalize_person_name(NEW.name) IS DISTINCT FROM public.normalize_person_name(OLD.name) THEN
    NEW.name := coalesce(public.normalize_person_name(NEW.name), '');   -- '' cai no name_invalid
  ELSE
    NEW.name := OLD.name;
  END IF;

  -- E-mail, celular e CPF: as funções de normalização devolvem nulo para o
  -- vazio e para o que só tem espaços (DT-24).
  IF _ins OR public.normalize_email(NEW.email) IS DISTINCT FROM public.normalize_email(OLD.email) THEN
    NEW.email := public.normalize_email(NEW.email);
  ELSE
    NEW.email := OLD.email;
  END IF;

  -- Celular: a forma lida (RN-06); o ilegível fica só com dígitos, para o ad_ recusar.
  IF _ins
     OR coalesce(public.normalize_mobile(NEW.mobile_whatsapp), public.normalize_digits(NEW.mobile_whatsapp))
        IS DISTINCT FROM coalesce(public.normalize_mobile(OLD.mobile_whatsapp), public.normalize_digits(OLD.mobile_whatsapp)) THEN
    NEW.mobile_whatsapp := coalesce(public.normalize_mobile(NEW.mobile_whatsapp), public.normalize_digits(NEW.mobile_whatsapp));
  ELSE
    NEW.mobile_whatsapp := OLD.mobile_whatsapp;
  END IF;

  IF _ins OR public.normalize_digits(NEW.cpf) IS DISTINCT FROM public.normalize_digits(OLD.cpf) THEN
    NEW.cpf := public.normalize_digits(NEW.cpf);
  ELSE
    NEW.cpf := OLD.cpf;
  END IF;

  -- Demais campos de texto opcionais (DT-24): só o vazio ou só com espaços
  -- vira nulo; o conteúdo preenchido não muda.
  IF NEW.phone        ~ '^[[:space:]]*$' THEN NEW.phone        := NULL; END IF;
  IF NEW.instagram    ~ '^[[:space:]]*$' THEN NEW.instagram    := NULL; END IF;
  IF NEW.avatar_url   ~ '^[[:space:]]*$' THEN NEW.avatar_url   := NULL; END IF;
  IF NEW.notes        ~ '^[[:space:]]*$' THEN NEW.notes        := NULL; END IF;
  IF NEW.street       ~ '^[[:space:]]*$' THEN NEW.street       := NULL; END IF;
  IF NEW.number       ~ '^[[:space:]]*$' THEN NEW.number       := NULL; END IF;
  IF NEW.complement   ~ '^[[:space:]]*$' THEN NEW.complement   := NULL; END IF;
  IF NEW.neighborhood ~ '^[[:space:]]*$' THEN NEW.neighborhood := NULL; END IF;
  IF NEW.city         ~ '^[[:space:]]*$' THEN NEW.city         := NULL; END IF;
  IF NEW.state        ~ '^[[:space:]]*$' THEN NEW.state        := NULL; END IF;
  IF NEW.zip_code     ~ '^[[:space:]]*$' THEN NEW.zip_code     := NULL; END IF;

  -- "Tem Liderança?" (RN-11, RN-12, DT-06). Omitido no cadastro: ligado, a não
  -- ser para o pastor. Nulo na edição: o gravado.
  IF NEW.has_leadership IS NULL THEN
    NEW.has_leadership := CASE WHEN _ins THEN NOT coalesce(NEW.is_pastor, false) ELSE OLD.has_leadership END;
  END IF;
  IF NEW.leader_id IS NOT NULL THEN
    NEW.has_leadership := true;                                          -- DA-11 do E2.02
  END IF;
  -- Virou pastor e o líder saiu na mesma gravação: a chave herdada desliga
  -- (RN-12, "ou ligar É Pastor(a)?"). Ligada de propósito num pastor (OLD
  -- desligada) continua e é recusada pelo ad_.
  IF NOT _ins AND NEW.is_pastor AND NEW.leader_id IS NULL AND NEW.has_leadership AND OLD.has_leadership THEN
    NEW.has_leadership := false;
  END IF;

  -- Batismo (RN-16): desligar apaga a data que não foi mexida na mesma gravação.
  IF NOT _ins AND OLD.is_baptized AND NOT NEW.is_baptized
     AND NEW.baptism_date IS NOT DISTINCT FROM OLD.baptism_date THEN
    NEW.baptism_date := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ad_enforce_member_rules (DT-04, DA-11). DEFINER: a subida da árvore e a
-- unicidade precisam enxergar cadastros fora do escopo de quem grava. Vale
-- para todos os papéis, inclusive postgres e service_role (RN-01); só a carga
-- em replica passa por fora. Confere na ordem da DA-11, e a primeira recusa
-- levanta o erro (formato app_error do E2.01, AQ-1).
CREATE OR REPLACE FUNCTION public.enforce_member_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ins constant boolean := TG_OP = 'INSERT';
  _restore boolean;
  _problem text;
  _email text;
  _mobile text;
  _cpf text;
  _fields text[];
BEGIN
  -- 0. Linha sendo excluída ou já excluída: só os CHECKs valem.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  _restore := NOT _ins AND OLD.deleted_at IS NOT NULL;

  -- 1. RN-02 nome
  IF (_ins OR NEW.name IS DISTINCT FROM OLD.name)
     AND NOT coalesce(public.is_valid_person_name(NEW.name), false) THEN
    PERFORM public._del_raise('name_invalid', 'Informe o nome e o sobrenome.',
      '{"field": "name"}'::jsonb);
  END IF;

  -- 2. RN-03 sexo
  IF NEW.gender IS NULL OR NEW.gender NOT IN ('M', 'F') THEN
    PERFORM public._del_raise('gender_required', 'Informe o sexo.', '{"field": "gender"}'::jsonb);
  END IF;

  -- 3. RN-15 nascimento, pelo "hoje" de Brasília
  IF _ins OR NEW.birth_date IS DISTINCT FROM OLD.birth_date THEN
    _problem := public.birth_date_problem(NEW.birth_date, public.sp_today());
    IF _problem = 'birth_date_future' THEN
      PERFORM public._del_raise('birth_date_future', 'A data de nascimento não pode ser futura.',
        '{"field": "birth_date"}'::jsonb);
    ELSIF _problem = 'birth_date_too_old' THEN
      PERFORM public._del_raise('birth_date_too_old',
        'Confira a data de nascimento: a pessoa teria 100 anos ou mais.',
        '{"field": "birth_date"}'::jsonb);
    END IF;
  END IF;

  -- 4. RN-06 celular
  IF NEW.mobile_whatsapp IS NOT NULL
     AND (_ins OR NEW.mobile_whatsapp IS DISTINCT FROM OLD.mobile_whatsapp)
     AND public.normalize_mobile(NEW.mobile_whatsapp) IS NULL THEN
    PERFORM public._del_raise('mobile_invalid', 'Celular inválido. Informe o DDD e o número.',
      '{"field": "mobile_whatsapp"}'::jsonb);
  END IF;

  -- 5. RN-05, RN-04 e-mail: fictício antes de formato
  IF NEW.email IS NOT NULL AND (_ins OR NEW.email IS DISTINCT FROM OLD.email) THEN
    IF public.is_placeholder_email(NEW.email) THEN
      PERFORM public._del_raise('email_placeholder',
        'Este e-mail não pode ser usado. Informe um e-mail real ou deixe o campo em branco.',
        '{"field": "email"}'::jsonb);
    ELSIF NOT coalesce(public.is_valid_email(NEW.email), false) THEN
      PERFORM public._del_raise('email_invalid', 'E-mail inválido. Confira o endereço digitado.',
        '{"field": "email"}'::jsonb);
    END IF;
  END IF;

  -- 6. RN-07 CPF
  IF NEW.cpf IS NOT NULL
     AND (_ins OR NEW.cpf IS DISTINCT FROM OLD.cpf)
     AND NOT coalesce(public.is_valid_cpf(NEW.cpf), false) THEN
    PERFORM public._del_raise('cpf_invalid',
      'CPF inválido. Se a pessoa não tem CPF, deixe o campo em branco.',
      '{"field": "cpf"}'::jsonb);
  END IF;

  -- 7. RN-08 identificador: no cadastro novo e quando a edição tira o último.
  IF NOT public.member_has_login_identifier(NEW.email, NEW.mobile_whatsapp, NEW.cpf)
     AND (_ins OR public.member_has_login_identifier(OLD.email, OLD.mobile_whatsapp, OLD.cpf)) THEN
    PERFORM public._del_raise('identifier_required',
      'Informe o e-mail, o celular ou o CPF. A pessoa usa um deles para entrar no sistema.',
      '{"field": "identification", "fields": ["mobile_whatsapp", "email", "cpf"]}'::jsonb);
  END IF;

  -- 8. RN-14 cônjuge
  IF NEW.spouse_id = NEW.id THEN
    PERFORM public._del_raise('spouse_self', 'Uma pessoa não pode ser cônjuge de si mesma.',
      '{"field": "spouse_id"}'::jsonb);
  END IF;

  -- 9 e 10. RN-11, RN-12 situação de liderança, quando pastor, líder ou chave mudam.
  IF _ins
     OR NEW.is_pastor IS DISTINCT FROM OLD.is_pastor
     OR NEW.leader_id IS DISTINCT FROM OLD.leader_id
     OR NEW.has_leadership IS DISTINCT FROM OLD.has_leadership THEN
    IF NEW.is_pastor AND (NEW.leader_id IS NOT NULL OR NEW.has_leadership) THEN
      PERFORM public._del_raise('pastor_with_leader',
        'Pastor(a) não tem líder. Tire o líder ou desmarque "É Pastor(a)?".',
        '{"field": "is_pastor"}'::jsonb);
    ELSIF NOT NEW.is_pastor AND NEW.has_leadership AND NEW.leader_id IS NULL THEN
      PERFORM public._del_raise('leader_required', 'Escolha o líder.',            -- DA-2
        '{"field": "leader_id"}'::jsonb);
    END IF;
  END IF;

  -- 11. RN-13 líder de si mesmo
  IF NEW.leader_id = NEW.id THEN
    PERFORM public._del_raise('leader_self', 'Uma pessoa não pode ser líder de si mesma.',
      '{"field": "leader_id"}'::jsonb);
  END IF;

  -- 12. RN-13 ciclo (DT-08): na edição em que o líder muda para alguém, sob a
  --     trava única da árvore. O cadastro novo ainda não tem discípulos, e a
  --     restauração devolve o mesmo líder ou nulo: nenhum dos dois pega a trava.
  IF NOT _ins AND NEW.leader_id IS NOT NULL AND NEW.leader_id IS DISTINCT FROM OLD.leader_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('members:leader-tree', 0));
    -- Comando novo depois da trava: enxerga a troca que a outra transação
    -- acabou de gravar. Passa por inativos e excluídos.
    IF EXISTS (
      WITH RECURSIVE up(id, leader_id, path) AS (
        SELECT m.id, m.leader_id, ARRAY[m.id]
          FROM public.members m
         WHERE m.id = NEW.leader_id
        UNION ALL
        SELECT l.id, l.leader_id, up.path || l.id
          FROM up
          JOIN public.members l ON l.id = up.leader_id
         WHERE NOT l.id = ANY (up.path)                  -- termina mesmo num ciclo antigo
      )
      SELECT 1 FROM up WHERE up.id = NEW.id
    ) THEN
      PERFORM public._del_raise('leader_cycle',
        'O líder escolhido é discípulo desta pessoa (direto ou indireto). Escolha outro líder.',
        '{"field": "leader_id"}'::jsonb);
    END IF;
  END IF;

  -- 13. RN-16 batismo (depois da derivação do a0_)
  IF NOT NEW.is_baptized AND NEW.baptism_date IS NOT NULL THEN
    PERFORM public._del_raise('baptism_date_without_baptism',
      'A data do batismo só pode ser informada para quem é batizado(a).',
      '{"field": "baptism_date"}'::jsonb);
  END IF;

  -- 14. RN-09, RN-10 dado em uso (DT-07): os que mudaram (todos no cadastro
  --     novo e na restauração), sob as travas por valor. Cita todos os campos,
  --     nada do outro cadastro. O índice único é a garantia.
  IF _ins OR _restore THEN
    _email := NEW.email;
    _mobile := NEW.mobile_whatsapp;
    _cpf := NEW.cpf;
  ELSE
    _email := CASE WHEN NEW.email IS DISTINCT FROM OLD.email THEN NEW.email END;
    _mobile := CASE WHEN NEW.mobile_whatsapp IS DISTINCT FROM OLD.mobile_whatsapp THEN NEW.mobile_whatsapp END;
    _cpf := CASE WHEN NEW.cpf IS DISTINCT FROM OLD.cpf THEN NEW.cpf END;
  END IF;
  IF _email IS NOT NULL OR _mobile IS NOT NULL OR _cpf IS NOT NULL THEN
    _fields := public._member_values_in_use(NEW.id, _email, _mobile, _cpf, true);
    IF cardinality(_fields) > 0 THEN
      PERFORM public._del_raise('value_in_use',
        CASE _fields[1]
          WHEN 'email' THEN 'Este e-mail já está sendo usado por outro cadastro.'
          WHEN 'mobile' THEN 'Este celular já está sendo usado por outro cadastro.'
          ELSE 'Este CPF já está sendo usado por outro cadastro.'
        END,
        jsonb_build_object('fields', to_jsonb(_fields)));
    END IF;
  END IF;

  -- 15. RN-18 do E2.01 (DT-14, DA-4): a conta de acesso do excluído continua
  --     com o e-mail, então um cadastro novo, ou uma troca de e-mail, com esse
  --     e-mail é recusado. Vem depois da unicidade (RN-10).
  IF NEW.email IS NOT NULL
     AND (_ins OR NEW.email IS DISTINCT FROM OLD.email)
     AND EXISTS (
       SELECT 1
         FROM public.members d
        WHERE d.deleted_at IS NOT NULL
          AND d.auth_user_id IS NOT NULL
          AND d.id <> NEW.id
          AND public.normalize_email(d.email) = public.normalize_email(NEW.email)
     ) THEN
    PERFORM public._del_raise('deleted_account_email',
      'Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.',
      '{"field": "email"}'::jsonb);
  END IF;

  RETURN NEW;
END;
$$;

-- Funções de trigger: ninguém as chama diretamente.
REVOKE ALL ON FUNCTION public.normalize_member_input() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_member_rules() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 4. Ajustes nos passos anteriores
-- ===========================================================================

-- ac_enforce_member_scope (E2.02, DT-13): na condição de cadastrar ou deixar
-- "sem liderança", entra AND NOT NEW.has_leadership. A chave ligada sem líder
-- não é "sem liderança": é leader_required, do ad_. Desligar a chave continua
-- dando a recusa da RN-10 do E2.02. O resto é a definição do E2.02.
CREATE OR REPLACE FUNCTION public.enforce_member_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _field text;
BEGIN
  IF NEW.leader_id IS NOT NULL AND NOT coalesce(NEW.has_leadership, false) THEN
    NEW.has_leadership := true;                                                   -- DA-11
  END IF;

  IF current_user IN ('postgres', 'service_role', 'supabase_admin') OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- RN-10: só quem vê a igreja toda marca ou desmarca pastor e sem liderança.
  -- Manter como está é aceito (P-PER-23).
  IF NOT public.viewer_has('view_all_church'::permission_action) THEN
    _field := CASE
      WHEN TG_OP = 'INSERT' AND NEW.is_pastor THEN 'is_pastor'
      WHEN TG_OP = 'UPDATE' AND NEW.is_pastor IS DISTINCT FROM OLD.is_pastor THEN 'is_pastor'
      WHEN TG_OP = 'UPDATE' AND OLD.is_pastor
           AND NEW.leader_id IS DISTINCT FROM OLD.leader_id THEN 'leader_id'          -- DA-2
      WHEN NEW.leader_id IS NULL AND NOT NEW.is_pastor AND NOT NEW.has_leadership  -- E2.04 (DT-13)
           AND (TG_OP = 'INSERT' OR OLD.leader_id IS NOT NULL) THEN 'leader_id'
      WHEN TG_OP = 'UPDATE' AND OLD.has_leadership AND NOT NEW.has_leadership THEN 'has_leadership'
    END;
    IF _field IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.',
        DETAIL = jsonb_build_object('code', 'pastor_or_no_leadership_requires_church', 'field', _field)::text;
    END IF;
  END IF;

  -- RN-09 (b): a pessoa escolhida precisa estar visível. Quem já estava fica.
  IF NEW.leader_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.leader_id IS DISTINCT FROM OLD.leader_id)
     AND NOT public.viewer_sees_member(NEW.leader_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Você só pode escolher pessoas que você vê.',
      DETAIL = jsonb_build_object('code', 'person_not_visible', 'field', 'leader_id',
                                  'member_id', NEW.leader_id)::text;
  END IF;
  IF NEW.spouse_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.spouse_id IS DISTINCT FROM OLD.spouse_id)
     AND NOT public.viewer_sees_member(NEW.spouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Você só pode escolher pessoas que você vê.',
      DETAIL = jsonb_build_object('code', 'person_not_visible', 'field', 'spouse_id',
                                  'member_id', NEW.spouse_id)::text;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_member_scope() FROM PUBLIC, anon, authenticated;

-- ab_enforce_member_links (E2.01, DT-14): sai a recusa deleted_account_email
-- do INSERT, que passa para o fim do ad_ (depois da unicidade, RN-10, e da
-- permissão do aa_, leitura técnica 1). O resto é a definição do E2.01.
CREATE OR REPLACE FUNCTION public.enforce_member_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _fields text[] := ARRAY[]::text[];
  _ids uuid[] := ARRAY[]::uuid[];
  _all boolean;
  _id uuid;
  _i int;
BEGIN
  -- Linha excluída (ou sendo excluída): nada a conferir.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Na criação e na restauração, confere todas as pessoas; na edição, só as
  -- que mudaram.
  IF TG_OP = 'INSERT' THEN
    _all := true;
  ELSE
    _all := OLD.deleted_at IS NOT NULL;
  END IF;

  IF NEW.leader_id IS NOT NULL THEN
    IF _all OR NEW.leader_id IS DISTINCT FROM OLD.leader_id THEN
      _fields := _fields || 'leader_id'::text;
      _ids := _ids || NEW.leader_id;
    END IF;
  END IF;
  IF NEW.spouse_id IS NOT NULL THEN
    IF _all OR NEW.spouse_id IS DISTINCT FROM OLD.spouse_id THEN
      _fields := _fields || 'spouse_id'::text;
      _ids := _ids || NEW.spouse_id;
    END IF;
  END IF;

  -- Trava em ordem de id com FOR KEY SHARE, que conflita com o FOR UPDATE de
  -- delete_member (RN-20); depois confere na ordem dos campos.
  FOR _id IN SELECT DISTINCT x FROM unnest(_ids) AS x ORDER BY x LOOP
    PERFORM 1 FROM public.members m WHERE m.id = _id FOR KEY SHARE;
  END LOOP;

  FOR _i IN 1 .. coalesce(array_length(_ids, 1), 0) LOOP
    IF EXISTS (SELECT 1 FROM public.members m WHERE m.id = _ids[_i] AND m.deleted_at IS NOT NULL) THEN
      PERFORM public._del_raise('deleted_member_chosen',
        'Este membro foi excluído e não pode ser escolhido.',
        jsonb_build_object('field', _fields[_i], 'member_id', _ids[_i]));
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_member_links() FROM PUBLIC, anon, authenticated;

-- sync_spouse_relationship (DT-15): a exceção em inglês vira spouse_self em
-- pt-BR. Pela ordem, o ad_ e o CHECK members_spouse_not_self_check recusam
-- antes; fica como última barreira. O resto é a definição atual.
CREATE OR REPLACE FUNCTION public.sync_spouse_relationship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Avoid recursion when the trigger updates other rows
  IF current_setting('app.sync_spouse_running', true) = 'on' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_spouse_running', 'on', true);

  -- If spouse changed (or on insert), sync both sides
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.spouse_id::text, '') = COALESCE(NEW.spouse_id::text, '') THEN
    PERFORM set_config('app.sync_spouse_running', 'off', true);
    RETURN NEW;
  END IF;

  -- Clear old partner if it pointed back to NEW.id
  IF TG_OP = 'UPDATE' AND OLD.spouse_id IS NOT NULL AND OLD.spouse_id IS DISTINCT FROM NEW.spouse_id THEN
    UPDATE public.members
      SET spouse_id = NULL
      WHERE id = OLD.spouse_id AND spouse_id = NEW.id;
  END IF;

  IF NEW.spouse_id IS NOT NULL THEN
    -- RN-14: ninguém é cônjuge de si mesmo.
    IF NEW.spouse_id = NEW.id THEN
      PERFORM set_config('app.sync_spouse_running', 'off', true);
      PERFORM public._del_raise('spouse_self', 'Uma pessoa não pode ser cônjuge de si mesma.',
        '{"field": "spouse_id"}'::jsonb);
    END IF;

    -- Clear any existing spouse of the new partner that points elsewhere
    UPDATE public.members
      SET spouse_id = NULL
      WHERE spouse_id = NEW.spouse_id AND id <> NEW.id;

    -- Set the reverse link
    UPDATE public.members
      SET spouse_id = NEW.id
      WHERE id = NEW.spouse_id AND (spouse_id IS DISTINCT FROM NEW.id);
  END IF;

  PERFORM set_config('app.sync_spouse_running', 'off', true);
  RETURN NEW;
END;
$$;

-- Função de trigger: ninguém a chama diretamente.
REVOKE ALL ON FUNCTION public.sync_spouse_relationship() FROM PUBLIC, anon, authenticated;

-- check_member_insert (E2.02, DT-12): o ensaio igual ao INSERT real. Passa a
-- gravar também o id (o attemptId da create-user-admin) e manda
-- has_leadership como veio, nulo se ausente (o a0_ resolve, DT-06). Sem id,
-- o ensaio usa um novo. Nada é gravado (o ensaio termina desfeito) e nenhum
-- evento de Auditoria fica.
CREATE OR REPLACE FUNCTION public.check_member_insert(_member jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _in jsonb := CASE WHEN jsonb_typeof(_member) = 'object' THEN _member ELSE '{}'::jsonb END;
  _r public.members;
BEGIN
  _r := jsonb_populate_record(NULL::public.members, _in);
  BEGIN
    INSERT INTO public.members (
      id, name, email, cpf, gender, birth_date, mobile_whatsapp, phone, notes,
      instagram, avatar_url, is_pastor, has_leadership, leader_id, spouse_id,
      is_baptized, baptism_date, is_active, street, number, complement,
      neighborhood, city, state, zip_code, role_id
    ) VALUES (
      coalesce(_r.id, gen_random_uuid()),
      _r.name, _r.email, _r.cpf, _r.gender, _r.birth_date, _r.mobile_whatsapp, _r.phone, _r.notes,
      _r.instagram, _r.avatar_url,
      CASE WHEN _in ? 'is_pastor' THEN _r.is_pastor ELSE false END,
      _r.has_leadership,
      _r.leader_id, _r.spouse_id,
      CASE WHEN _in ? 'is_baptized' THEN _r.is_baptized ELSE false END,
      _r.baptism_date,
      CASE WHEN _in ? 'is_active' THEN _r.is_active ELSE true END,
      _r.street, _r.number, _r.complement,
      _r.neighborhood, _r.city, _r.state, _r.zip_code, _r.role_id
    );
    RAISE EXCEPTION USING ERRCODE = 'MCIDR', MESSAGE = 'ensaio do cadastro';
  EXCEPTION WHEN SQLSTATE 'MCIDR' THEN
    RETURN;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.check_member_insert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_member_insert(jsonb) TO authenticated, service_role;

-- ===========================================================================
-- 5. Triggers novos. BEFORE disparam em ordem alfabética (DT-04):
--    a0_normalize_member < aa_enforce_member_write_rules < ab_enforce_member_links
--    < ac_enforce_member_scope < ad_enforce_member_rules < compute_member_g12_level
--    < update_members_updated_at. Os de totais não os disparam: as colunas
--    deles não estão nas listas.
-- ===========================================================================
CREATE TRIGGER a0_normalize_member
  BEFORE INSERT OR UPDATE OF name, email, mobile_whatsapp, cpf, is_pastor, has_leadership, leader_id,
                             is_baptized, baptism_date, phone, instagram, avatar_url, notes, street,
                             number, complement, neighborhood, city, state, zip_code
  ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.normalize_member_input();

CREATE TRIGGER ad_enforce_member_rules
  BEFORE INSERT OR UPDATE OF name, gender, birth_date, email, mobile_whatsapp, cpf, spouse_id, is_pastor,
                             has_leadership, leader_id, is_baptized, baptism_date, deleted_at
  ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_rules();
