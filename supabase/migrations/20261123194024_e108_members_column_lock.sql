-- E1.08 (PR 5) — Trava da máscara: leitura de members por coluna.
-- Ver docs/specs/e1-08-paginacao-servidor.md no repositório apps-mci (RN-11,
-- tarefa 10, risco 4).
--
-- Desde os PRs 1 a 4, o front lê membros só pelas views (members_view e as
-- views de células e relatórios) e pelas RPCs; na tabela members ele só
-- escreve (update e delete por id). Esta migration trava a máscara de dados
-- sensíveis (RN-11) também no nível da tabela, como endurecimento: authenticated
-- passa a ter SELECT só nas colunas não sensíveis, e a members_view fica como o
-- único caminho de leitura desses dados. anon não lê nenhuma coluna.
--
-- Colunas sensíveis (sem SELECT para ninguém além do dono da tabela e da
-- service_role): email, cpf, mobile_whatsapp, phone, street, number,
-- complement e zip_code. A mesma lista está na members_view, na regra 6 de
-- enforce_member_write_rules e em src/lib/members/fields.ts.
--
-- Regra para as próximas migrations (falha fechada):
--   - coluna nova em members NÃO é legível por authenticated até receber
--     GRANT SELECT (coluna) ON public.members TO authenticated, na própria
--     migration que a cria, se não for sensível;
--   - coluna sensível nunca recebe esse GRANT; ela sai só pela members_view,
--     com a máscara;
--   - no front, nada de select('*') em members (nem RETURNING com colunas
--     sensíveis, como .select() depois de update/insert): leia pela
--     members_view.
--
-- O que não muda:
--   - INSERT, UPDATE e DELETE continuam no nível da tabela, com o RLS de
--     sempre. UPDATE e DELETE com WHERE id = ... só precisam de SELECT em id;
--   - service_role e postgres (dono das views e das funções SECURITY DEFINER)
--     continuam lendo a tabela inteira: as views, os triggers e as funções do
--     RLS não são afetados;
--   - o RLS de members continua igual.
--
-- Pode rodar de novo sem erro: o REVOKE de tabela também remove os grants de
-- coluna, e os GRANTs seguintes recriam exatamente o mesmo estado.

-- ---------------------------------------------------------------------------
-- 1. Sem SELECT de tabela
-- ---------------------------------------------------------------------------
REVOKE SELECT ON TABLE public.members FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. SELECT por coluna, só nas não sensíveis (lista explícita)
-- ---------------------------------------------------------------------------
GRANT SELECT (id, name, gender, birth_date, instagram, avatar_url, notes,
              neighborhood, city, state,
              is_pastor, has_leadership, leader_id, spouse_id,
              is_baptized, baptism_date, is_active, g12_level,
              total_disciples, total_cells, male_cells, female_cells,
              role_id, auth_user_id, created_at, updated_at)
  ON public.members TO authenticated;

-- Exclusão lógica (E2.01): se as colunas já existirem quando esta migration
-- rodar, elas também são legíveis. Se não existirem, a migration do E2.01 faz o
-- GRANT ao criá-las (DT-22 de docs/specs/e2-01-exclusao-logica.md).
DO $$
DECLARE
  _column text;
BEGIN
  FOREACH _column IN ARRAY ARRAY['deleted_at', 'deleted_by'] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'public.members'::regclass
        AND attname = _column
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      EXECUTE format('GRANT SELECT (%I) ON public.members TO authenticated', _column);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Pós-condição: aborta a migration se a trava não ficou como esperado
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _role text;
  _column text;
BEGIN
  FOREACH _role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    IF has_table_privilege(_role, 'public.members', 'SELECT') THEN
      RAISE EXCEPTION 'E1.08 PR 5: % ainda tem SELECT de tabela em public.members.', _role;
    END IF;

    FOREACH _column IN ARRAY ARRAY['email', 'cpf', 'mobile_whatsapp', 'phone',
                                   'street', 'number', 'complement', 'zip_code'] LOOP
      IF has_column_privilege(_role, 'public.members', _column, 'SELECT') THEN
        RAISE EXCEPTION 'E1.08 PR 5: % ainda tem SELECT na coluna sensível members.%.', _role, _column;
      END IF;
    END LOOP;
  END LOOP;

  -- UPDATE e DELETE por id (MemberForm e Members) dependem disto.
  IF NOT has_column_privilege('authenticated', 'public.members', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'E1.08 PR 5: authenticated ficou sem SELECT em members.id.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Documentação no próprio banco
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.members IS
  'Cadastro de membros. Leitura pelo front: members_view (escopo e máscara de dados sensíveis). '
  'authenticated tem SELECT só por coluna: toda coluna nova não sensível precisa de '
  'GRANT SELECT (coluna) na migration que a cria; as sensíveis (email, cpf, mobile_whatsapp, '
  'phone, street, number, complement, zip_code) nunca recebem. Ver E1.08, PR 5.';
