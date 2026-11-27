-- E3 (PR 1, migration 1 de 2) — A credencial legada (E3.01). Ver
-- docs/specs/e3-login-legado.md no repositório apps-mci ("Modelo de dados e
-- migrations", "Funções"; DT-01, DT-02, DT-05; RN-01, RN-03, RN-07, RN-10).
--
-- A senha do legado é guardada só como bcrypt(md5(senha)), custo 10: nem a
-- senha nem o MD5 legível ficam no banco (RN-01). Na primeira entrada com a
-- senha certa, ela vira a senha do cofre e a credencial some (migration 2).
--
-- Conteúdo:
--   0. Guarda de pré-requisito (o cofre do E2.03). Falha cedo.
--   1. private.legacy_credentials (uma linha por membro que recebeu
--      credencial na carga; a linha fica, o hash some, DT-01).
--   2. private.discard_legacy_credential recriada (era vazia no E2.03): anula
--      o hash. A write_password já a chama, então a redefinição, a troca, a
--      senha inicial e a primeira entrada apagam a credencial (RN-03).
--   3. private.add_legacy_credential: a carga do E4.08 (como postgres).
--   4. private.legacy_credential_problems: a reconciliação (5.6).
--
-- Ordem das travas (DT-05; estende a do cabeçalho da e203_03_vault): limites
-- → membro (E2.01) → auth.users → cofre → credencial. A write_password trava o
-- cofre e depois chama a discard; a add_legacy_credential e a sign_in_attempt
-- (migration 2) travam o cofre antes de ler ou mudar a credencial.
--
-- Nada aqui sai pela API: schema private, RLS sem políticas e nenhum
-- privilégio, nem para service_role. A exclusão e a restauração do membro
-- (E2.01) não tocam a credencial (RN-10): a FK é NO ACTION, como as do DEL-.
--
-- Idempotente: IF NOT EXISTS e CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisito: o cofre e a write_password do E2.03.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('private.account_passwords') IS NULL
     OR to_regprocedure('private.write_password(uuid,uuid,text,uuid)') IS NULL
     OR to_regprocedure('private.discard_legacy_credential(uuid)') IS NULL
     OR to_regprocedure('private.set_must_change(uuid,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'e3_01_legacy_credentials depende do cofre do E2.03 (e203_03_vault).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. A tabela (DT-01, DT-02).
--    Pendente = legacy_hash IS NOT NULL AND used_at IS NULL.
--    Usada com hash = a senha legada acima de 72 bytes depois da primeira
--    entrada (DA-2): continua sendo a senha até a troca ou a redefinição.
--    Descartada = legacy_hash nulo (senha gravada no cofre, RN-03).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.legacy_credentials (
  member_id    uuid PRIMARY KEY REFERENCES public.members (id),   -- NO ACTION (DEL-)
  -- bcrypt($2a$, custo 10) do MD5 hexadecimal minúsculo da senha do legado.
  -- O custo fixo dá o mesmo tempo do cofre e do bcrypt fictício (DT-02).
  legacy_hash  text CHECK (legacy_hash ~ '^\$2a\$10\$[./A-Za-z0-9]{53}$'),
  loaded_at    timestamptz NOT NULL DEFAULT now(),
  used_at      timestamptz,
  discarded_at timestamptz,
  CONSTRAINT legacy_credentials_discard CHECK ((legacy_hash IS NULL) = (discarded_at IS NOT NULL))
);
ALTER TABLE private.legacy_credentials ENABLE ROW LEVEL SECURITY;   -- sem políticas
REVOKE ALL ON TABLE private.legacy_credentials FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.legacy_credentials IS
  'E3.01 (DT-01): a credencial legada, bcrypt(md5(senha)) custo 10, sem a senha nem o MD5. '
  'Uma linha por membro que recebeu credencial na carga (o total do card Primeiro acesso); '
  'legacy_hash nulo = descartada (senha gravada no cofre). Carga só por private.add_legacy_credential; '
  'descarte só por private.discard_legacy_credential (chamada pela write_password).';

-- ---------------------------------------------------------------------------
-- 2. Descarte (RN-03). Anula o hash que ainda existe (pendente ou usado com
--    hash, DA-2). A linha fica. Chamada pela write_password depois de travar
--    o cofre (a ordem cofre → credencial).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.discard_legacy_credential(_member_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  UPDATE private.legacy_credentials
     SET legacy_hash  = NULL,
         discarded_at = now()
   WHERE member_id = _member_id
     AND legacy_hash IS NOT NULL
$$;

-- ---------------------------------------------------------------------------
-- 3. Carga (E4.08, RN-01, RN-03, RN-16 a). Uma chamada por membro, como
--    postgres; pode rodar em lotes paralelos. Devolve:
--      not_eligible  membro inexistente, excluído ou sem conta (RN-01 a, b)
--      unusable_md5  fora de 32 hex minúsculos ou o MD5 do texto vazio (RN-01 c)
--      has_password  a conta já tem senha no cofre (RN-03, RN-16 a)
--      kept_used     a credencial já foi usada ou descartada: nunca recria
--      updated       a credencial pendente foi regravada
--      created       credencial nova
--    O MD5 nunca vai para mensagem de erro, RAISE ou log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.add_legacy_credential(_member_id uuid, _legacy_md5 text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  c_empty_md5 constant text := 'd41d8cd98f00b204e9800998ecf8427e';
  _auth      uuid;
  _vault_pw  text;
  _cred      private.legacy_credentials;
BEGIN
  -- Membro: não excluído e com conta. FOR KEY SHARE: conflita com o FOR UPDATE
  -- da delete_member (E2.01), e deleted_at é lido depois da trava.
  SELECT m.auth_user_id INTO _auth
    FROM public.members m
   WHERE m.id = _member_id
     AND m.deleted_at IS NULL
     FOR KEY SHARE;
  IF _auth IS NULL THEN
    RETURN 'not_eligible';
  END IF;

  IF _legacy_md5 IS NULL OR _legacy_md5 !~ '^[0-9a-f]{32}$' OR _legacy_md5 = c_empty_md5 THEN
    RETURN 'unusable_md5';
  END IF;

  -- Cofre antes da credencial (DT-05): quem acabou de gravar senha já tem o
  -- hash quando esta trava sai, e a carga não cria credencial para ele.
  INSERT INTO private.account_passwords (auth_user_id) VALUES (_auth)
  ON CONFLICT (auth_user_id) DO NOTHING;
  SELECT p.password_hash INTO _vault_pw
    FROM private.account_passwords p
   WHERE p.auth_user_id = _auth
     FOR UPDATE;
  IF _vault_pw IS NOT NULL THEN
    RETURN 'has_password';
  END IF;

  SELECT * INTO _cred
    FROM private.legacy_credentials c
   WHERE c.member_id = _member_id
     FOR UPDATE;
  IF FOUND THEN
    IF _cred.used_at IS NOT NULL OR _cred.legacy_hash IS NULL THEN
      RETURN 'kept_used';
    END IF;
    UPDATE private.legacy_credentials
       SET legacy_hash = extensions.crypt(_legacy_md5, extensions.gen_salt('bf', 10)),
           loaded_at   = now()
     WHERE member_id = _member_id;
    RETURN 'updated';
  END IF;

  INSERT INTO private.legacy_credentials (member_id, legacy_hash)
  VALUES (_member_id, extensions.crypt(_legacy_md5, extensions.gen_salt('bf', 10)));
  RETURN 'created';
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reconciliação (5.6). Precisa voltar vazia.
--      both_passwords     credencial com hash e senha no cofre (RN-03)
--      no_account         credencial com hash de membro sem conta (RN-01 b)
--      kept_without_mark  usada com hash (DA-2) sem a marca legacy_weak
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.legacy_credential_problems()
RETURNS TABLE (problem text, member_id uuid)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT x.problem, x.member_id
    FROM (
      SELECT CASE
               WHEN m.auth_user_id IS NULL THEN 'no_account'
               WHEN p.password_hash IS NOT NULL THEN 'both_passwords'
               WHEN c.used_at IS NOT NULL
                    AND NOT (coalesce(p.must_change, false) AND p.must_change_reason = 'legacy_weak')
                 THEN 'kept_without_mark'
             END AS problem,
             c.member_id
        FROM private.legacy_credentials c
        JOIN public.members m ON m.id = c.member_id
        LEFT JOIN private.account_passwords p ON p.auth_user_id = m.auth_user_id
       WHERE c.legacy_hash IS NOT NULL
    ) x
   WHERE x.problem IS NOT NULL
   ORDER BY x.problem, x.member_id
$$;

REVOKE ALL ON FUNCTION private.discard_legacy_credential(uuid)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.add_legacy_credential(uuid, text)      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.legacy_credential_problems()           FROM PUBLIC, anon, authenticated, service_role;
