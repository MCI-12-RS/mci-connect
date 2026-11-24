-- E1.04 (PR 1, migration 2 de 2) — Banco da função de login `sign-in`.
-- Ver docs/specs/e1-04-sign-in.md no repositório apps-mci ("Solução técnica":
-- Modelo de dados, Busca pelo cadastro, Contagem e bloqueio, Tempo igual,
-- Auditoria e Contratos; RN-01 a RN-12, RN-15 e RN-17).
--
-- Conteúdo:
--   0. Guarda de pré-requisito (PR 1 do E2.01). Falha cedo, sem mudar nada.
--   1. Normalização (RN-02 a RN-04, DT-08): normalize_mobile, mobile_match_key,
--      is_valid_cpf e is_placeholder_email. Imutáveis; o E2.04 reaproveita.
--   2. Três índices de expressão em members para a busca (RN-01).
--   3. private.sign_in_throttle: controle de tentativas (DT-03). Nada em claro:
--      key_hash é HMAC-SHA256 com a chave do item 4.
--   4. Chave do HMAC no Vault, gerada no próprio banco (DT-04).
--   5. Funções internas (schema private, sem grants).
--   6. RPCs, só para service_role: sign_in_attempt, sign_in_record_login e
--      sign_in_discard_link.
--   7. pg_cron e o job de limpeza (RN-11: a origem some em até 24 h).
--
-- Algoritmo da sign_in_attempt (uma transação; qualquer erro desfaz tudo e a
-- função sign-in responde 500, sem contar nada — RN-08, P-LOG-12):
--   1. Campos vazios: devolve empty_fields sem tocar em nada.
--   2. Origem: precisa ser um inet válido (a função já validou o cabeçalho).
--   3. Chaves: uma ou duas de identificação (e:, c:, m:, x:) e uma de origem
--      (o:). Cada uma vira (kind, HMAC).
--   4. TRAVAS, sempre antes de conferir a senha: para cada chave, na ordem
--      (kind, key_hash), INSERT ... ON CONFLICT DO UPDATE, que cria a linha ou
--      trava a que existe. Como toda chamada trava na mesma ordem, não há
--      deadlock entre tentativas; a limpeza usa SKIP LOCKED e nunca espera.
--      Espera acima de 3 s (lock_timeout) vira erro do servidor.
--   5. Bloqueio vigente em qualquer linha: devolve locked com o maior prazo,
--      sem conferir senha, sem somar falha e sem registrar nada.
--   6. Busca em dois estágios (não excluídos decidem; excluídos só dão o
--      motivo), conta de acesso, ponto do E3.02 e EXATAMENTE UM bcrypt de
--      custo 10 (com o hash da conta ou com o sal fixo).
--   7. Sucesso: zera as linhas de identificação (a de origem não muda).
--      Falha: janela deslizante de 15 min; soma a falha em todas as linhas; a
--      que chegar ao limite (5 por identificação, 20 por origem) é bloqueada
--      por 15 min e volta a zero.
--   8. Auditoria da falha e dos bloqueios num sub-bloco: se falhar, a resposta
--      não muda (RN-15 g). O WARNING traz só o SQLSTATE.
--   9. Teto de tempo (DT-19): antes de cada RETURN de resultado, se o comando
--      já passou de 5 s, RAISE 57014 (tudo é desfeito). O auto_explain de
--      produção registra com os parâmetros (a senha) só o comando concluído em
--      10 s ou mais; comando com erro não é registrado.
--
-- A senha nunca é gravada nem registrada: só entra no crypt(). Nenhuma
-- mensagem de erro desta migration inclui a senha, a identificação ou a origem.
--
-- Idempotente: CREATE OR REPLACE, IF NOT EXISTS e guardas em DO.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisito: PR 1 do E2.01
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'members'
                    AND column_name = 'deleted_at')
     OR to_regnamespace('private') IS NULL
     OR to_regprocedure('public.normalize_email(text)') IS NULL
     OR to_regprocedure('public.normalize_digits(text)') IS NULL THEN
    RAISE EXCEPTION 'E1.04 depende do PR 1 do E2.01 (deleted_at, schema private, normalize_*).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Normalização (RN-02 a RN-04, DT-08)
-- ---------------------------------------------------------------------------
-- Celular: zeros à esquerda fora; o 55 do Brasil fora só com 12 ou 13 dígitos;
-- sobra 10 ou 11 dígitos (DDD e número), senão NULL (RN-03 a, b e c).
CREATE OR REPLACE FUNCTION public.normalize_mobile(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN length(n) IN (10, 11) THEN n END
    FROM (SELECT CASE WHEN length(z) IN (12, 13) AND left(z, 2) = '55' THEN substr(z, 3) ELSE z END AS n
            FROM (SELECT ltrim(coalesce(public.normalize_digits(_value), ''), '0') AS z) a) b
$$;

-- Chave do 9º dígito (RN-03 e): 11 dígitos com 9 depois do DDD equivalem aos
-- mesmos 10 dígitos sem o 9.
CREATE OR REPLACE FUNCTION public.mobile_match_key(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN length(m) = 11 AND substr(m, 3, 1) = '9' THEN left(m, 2) || substr(m, 4) ELSE m END
    FROM (SELECT public.normalize_mobile(_value) AS m) a
$$;

-- CPF (RN-04, P-LOG-16): recebe só dígitos. Exatamente 11 dígitos ASCII, nem
-- todos iguais e dígitos verificadores corretos. Qualquer outra coisa é false.
CREATE OR REPLACE FUNCTION public.is_valid_cpf(_digits text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  _sum integer;
  _dv  integer;
  i    integer;
BEGIN
  IF _digits IS NULL
     OR _digits !~ '^[0-9]{11}$'
     OR _digits = repeat(left(_digits, 1), 11) THEN
    RETURN false;
  END IF;

  _sum := 0;
  FOR i IN 1..9 LOOP
    _sum := _sum + substr(_digits, i, 1)::integer * (11 - i);
  END LOOP;
  _dv := (_sum * 10) % 11;
  IF _dv = 10 THEN _dv := 0; END IF;
  IF _dv <> substr(_digits, 10, 1)::integer THEN
    RETURN false;
  END IF;

  _sum := 0;
  FOR i IN 1..10 LOOP
    _sum := _sum + substr(_digits, i, 1)::integer * (12 - i);
  END LOOP;
  _dv := (_sum * 10) % 11;
  IF _dv = 10 THEN _dv := 0; END IF;
  RETURN _dv = substr(_digits, 11, 1)::integer;
END;
$$;

-- E-mail fictício (RN-01): o domínio do e-mail normalizado está na lista. Hoje
-- só 'mci12fakemail.com'; o E1.06 acrescenta o da D7.
CREATE OR REPLACE FUNCTION public.is_placeholder_email(_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT coalesce(
           substring(public.normalize_email(_email) FROM '@([^@]*)$')
             = ANY (ARRAY['mci12fakemail.com']),
           false)
$$;

-- Usadas em expressão de índice de members: quem grava na tabela (authenticated
-- pela API e service_role) precisa de EXECUTE. anon, não.
REVOKE EXECUTE ON FUNCTION public.normalize_mobile(text)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mobile_match_key(text)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_valid_cpf(text)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_placeholder_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_mobile(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mobile_match_key(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_cpf(text)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_placeholder_email(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Índices da busca (RN-01). Sem predicado: o segundo estágio procura
--    excluídos.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS members_login_email_idx
  ON public.members (public.normalize_email(email));
CREATE INDEX IF NOT EXISTS members_login_cpf_idx
  ON public.members (public.normalize_digits(cpf));
CREATE INDEX IF NOT EXISTS members_login_mobile_idx
  ON public.members (public.mobile_match_key(mobile_whatsapp));

-- ---------------------------------------------------------------------------
-- 3. Controle de tentativas (RN-10 a RN-12; DT-03, DT-04)
-- ---------------------------------------------------------------------------
-- Uma linha por chave com falhas recentes ou bloqueio. A chave é HMAC: nem a
-- identificação nem a origem ficam em claro. Fora da API: schema private, RLS
-- sem políticas e nenhum privilégio, nem para service_role. Só as funções
-- donas (postgres) usam.
CREATE TABLE IF NOT EXISTS private.sign_in_throttle (
  kind          text          NOT NULL CHECK (kind IN ('identifier', 'origin')),
  key_hash      bytea         NOT NULL,
  failures      timestamptz[] NOT NULL DEFAULT '{}',  -- falhas dos últimos 15 min
  blocked_until timestamptz,
  expires_at    timestamptz   NOT NULL,               -- quando a linha pode ser apagada
  PRIMARY KEY (kind, key_hash),
  -- Teto de tamanho, folgado: os limites de verdade ficam na sign_in_attempt
  -- (5 e 20), e mudar um deles não pode esbarrar aqui (risco 16).
  CONSTRAINT sign_in_throttle_failures_max CHECK (cardinality(failures) <= 100)
);
CREATE INDEX IF NOT EXISTS sign_in_throttle_expires_at_idx
  ON private.sign_in_throttle (expires_at);
ALTER TABLE private.sign_in_throttle ENABLE ROW LEVEL SECURITY;  -- sem políticas
REVOKE ALL ON TABLE private.sign_in_throttle FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.sign_in_throttle IS
  'E1.04: limite de tentativas de login (RN-10, RN-11). key_hash = HMAC-SHA256 da chave '
  '(identificação normalizada ou origem), com a chave do Vault sign_in_throttle_key. '
  'Limpa a cada 10 minutos pelo job e104-sign-in-purge.';

-- ---------------------------------------------------------------------------
-- 4. Chave do HMAC no Vault, gerada no próprio banco e nunca exposta (DT-04).
--    O postgres não lê nem grava vault.secrets direto: usa create_secret e a
--    view decrypted_secrets.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'sign_in_throttle_key') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'sign_in_throttle_key',
      'E1.04: HMAC das chaves do limite de tentativas de login'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Funções internas (private, SECURITY INVOKER, sem grants). Rodam dentro
--    das RPCs definer, com os privilégios do dono (postgres), ou pelo pg_cron.
-- ---------------------------------------------------------------------------

-- A identificação sem os espaços (e tabs e quebras de linha) das pontas.
CREATE OR REPLACE FUNCTION private.login_identifier_text(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$ SELECT regexp_replace(coalesce(_raw, ''), '^\s+|\s+$', '', 'g') $$;

-- Leitura da identificação (RN-02 a RN-04, DA-4). Gêmea do classifyIdentifier
-- da tela; as duas passam pela mesma tabela de casos (AQ-3).
--   format: empty | email | cpf | mobile | cpf_or_mobile | invalid
--   masked: sobre a forma normalizada (AQ-5, DT-12): e-mail "a***@dominio";
--           número "***" e os 4 últimos dígitos; inválida: o primeiro
--           caractere, "***" e o último (em minúsculas), sem revelar o tamanho.
CREATE OR REPLACE FUNCTION private.parse_login_identifier(
  _raw text,
  OUT format     text,
  OUT email      text,
  OUT cpf        text,
  OUT mobile     text,
  OUT mobile_key text,
  OUT masked     text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _t      text := private.login_identifier_text(_raw);
  _digits text;
BEGIN
  IF _t = '' THEN
    format := 'empty';
    RETURN;
  END IF;

  IF length(_t) > 254 THEN                     -- DA-4
    format := 'invalid';
    masked := left(lower(_t), 1) || '***' || right(lower(_t), 1);
    RETURN;
  END IF;

  IF strpos(_t, '@') > 0 THEN                  -- RN-02: com "@", só e-mail
    format := 'email';
    email  := public.normalize_email(_t);
    masked := left(email, 1) || '***@' || coalesce(substring(email FROM '@([^@]*)$'), '');
    RETURN;
  END IF;

  -- Sem "@": só os dígitos contam (RN-03, RN-04).
  _digits := public.normalize_digits(_t);
  IF length(_digits) = 11 AND public.is_valid_cpf(_digits) THEN
    cpf := _digits;
  END IF;
  mobile     := public.normalize_mobile(_t);
  mobile_key := public.mobile_match_key(_t);

  format := CASE
              WHEN cpf IS NOT NULL AND mobile IS NOT NULL THEN 'cpf_or_mobile'
              WHEN cpf IS NOT NULL THEN 'cpf'
              WHEN mobile IS NOT NULL THEN 'mobile'
              ELSE 'invalid'
            END;
  masked := CASE
              WHEN format = 'invalid' THEN left(lower(_t), 1) || '***' || right(lower(_t), 1)
              ELSE '***' || right(_digits, 4)
            END;
END;
$$;

-- HMAC-SHA256 de "<kind>:<valor>" com a chave do Vault. Sem a chave, erro:
-- a tentativa vira erro do servidor (P-LOG-12, risco 13).
CREATE OR REPLACE FUNCTION private.sign_in_key(_kind text, _value text)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _secret text;
BEGIN
  SELECT s.decrypted_secret INTO _secret
    FROM vault.decrypted_secrets s
   WHERE s.name = 'sign_in_throttle_key';
  IF _secret IS NULL OR _secret = '' THEN
    RAISE EXCEPTION 'sign_in_key: chave do limite de tentativas ausente no Vault.'
      USING ERRCODE = '55000';
  END IF;
  RETURN extensions.hmac(_kind || ':' || _value, _secret, 'sha256');
END;
$$;

-- Origem (DT-06, DA-2): IPv4 pelo endereço; IPv4 mapeado em IPv6
-- (::ffff:a.b.c.d) vira o IPv4; outro IPv6 conta pelo prefixo /64.
CREATE OR REPLACE FUNCTION private.sign_in_origin_key(_origin inet)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _a inet;
BEGIN
  IF _origin IS NULL THEN
    RETURN NULL;
  END IF;
  _a := host(_origin)::inet;                     -- sem a máscara que vier junto
  IF family(_a) = 4 THEN
    RETURN host(_a);
  END IF;
  IF _a <<= '::ffff:0.0.0.0/96'::inet THEN
    RETURN host('0.0.0.0'::inet + (_a - '::ffff:0.0.0.0'::inet));
  END IF;
  RETURN network(set_masklen(_a, 64))::text;
END;
$$;

-- Busca pelo cadastro em dois estágios (RN-01, RN-03 d/e, RN-05, DT-09):
--   1º só não excluídos: 1 cadastro → found; 2 ou mais → ambiguous;
--   2º (só se o 1º não achou nada) só excluídos: member_deleted, ligado ao
--      cadastro se for um só (DA-6); nada → not_found.
-- O e-mail fictício não é procurado (not_found). No celular, a correspondência
-- exata vale antes da do 9º dígito. O CPF e o celular do mesmo cadastro contam
-- como um.
-- identifier_type (RN-15 b, P-LOG-15), pelo estágio que decidiu: email; cpf ou
-- mobile quando o número só podia ser um deles ou só um caminho achou; senão
-- cpf_or_mobile.
-- Lê members sem trava (a exclusão concorrente é tratada pelo E2.01).
CREATE OR REPLACE FUNCTION private.sign_in_lookup(
  _format     text,
  _email      text,
  _cpf        text,
  _mobile     text,
  _mobile_key text,
  OUT outcome         text,
  OUT member_id       uuid,
  OUT member_name     text,
  OUT identifier_type text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _deleted   boolean;
  _by_email  uuid[];
  _by_cpf    uuid[];
  _by_mobile uuid[];
  _all       uuid[];
BEGIN
  IF _format IS NULL OR _format NOT IN ('email', 'cpf', 'mobile', 'cpf_or_mobile') THEN
    RAISE EXCEPTION 'sign_in_lookup: formato inesperado.' USING ERRCODE = '22023';
  END IF;

  FOREACH _deleted IN ARRAY ARRAY[false, true] LOOP
    _by_email  := '{}';
    _by_cpf    := '{}';
    _by_mobile := '{}';

    IF _format = 'email' AND _email IS NOT NULL AND NOT public.is_placeholder_email(_email) THEN
      SELECT coalesce(array_agg(m.id), '{}') INTO _by_email
        FROM public.members m
       WHERE public.normalize_email(m.email) = _email
         AND (m.deleted_at IS NOT NULL) = _deleted;
    END IF;

    IF _format IN ('cpf', 'cpf_or_mobile') AND _cpf IS NOT NULL THEN
      SELECT coalesce(array_agg(m.id), '{}') INTO _by_cpf
        FROM public.members m
       WHERE public.normalize_digits(m.cpf) = _cpf
         AND (m.deleted_at IS NOT NULL) = _deleted;
    END IF;

    IF _format IN ('mobile', 'cpf_or_mobile') AND _mobile_key IS NOT NULL THEN
      SELECT coalesce(array_agg(m.id), '{}') INTO _by_mobile
        FROM public.members m
       WHERE public.mobile_match_key(m.mobile_whatsapp) = _mobile_key
         AND public.normalize_mobile(m.mobile_whatsapp) = _mobile
         AND (m.deleted_at IS NOT NULL) = _deleted;
      IF cardinality(_by_mobile) = 0 THEN        -- RN-03 e: só sem nenhum exato
        SELECT coalesce(array_agg(m.id), '{}') INTO _by_mobile
          FROM public.members m
         WHERE public.mobile_match_key(m.mobile_whatsapp) = _mobile_key
           AND (m.deleted_at IS NOT NULL) = _deleted;
      END IF;
    END IF;

    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO _all
      FROM unnest(_by_email || _by_cpf || _by_mobile) AS x;

    EXIT WHEN cardinality(_all) > 0;
  END LOOP;

  identifier_type := CASE
    WHEN _format <> 'cpf_or_mobile' THEN _format
    WHEN cardinality(_by_cpf) > 0 AND cardinality(_by_mobile) = 0 THEN 'cpf'
    WHEN cardinality(_by_mobile) > 0 AND cardinality(_by_cpf) = 0 THEN 'mobile'
    ELSE 'cpf_or_mobile'
  END;

  IF cardinality(_all) = 0 THEN
    outcome := 'not_found';
  ELSIF NOT _deleted THEN
    IF cardinality(_all) = 1 THEN
      outcome   := 'found';
      member_id := _all[1];
    ELSE
      outcome := 'ambiguous';
    END IF;
  ELSE
    outcome := 'member_deleted';
    IF cardinality(_all) = 1 THEN
      member_id := _all[1];
    END IF;
  END IF;

  IF member_id IS NOT NULL THEN
    SELECT m.name INTO member_name FROM public.members m WHERE m.id = member_id;
  END IF;
END;
$$;

-- Ponto do E3.02 (RN-17 b, DT-14): conferência da credencial legada, antes da
-- conferência da conta. Neste passo devolve sempre NULL ("não se aplica").
-- Quando existir, o bcrypt do md5 SUBSTITUI o da conta (um bcrypt por
-- tentativa, RN-07).
CREATE OR REPLACE FUNCTION private.sign_in_check_legacy(_member_id uuid, _password text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT NULL::text $$;

-- Teto de tempo do comando (DT-19). Chamada antes de cada RETURN de resultado
-- da sign_in_attempt. Não se usa SET statement_timeout na função: o
-- temporizador é armado no início do comando, e o SET da função não o muda.
CREATE OR REPLACE FUNCTION private.sign_in_assert_duration(_max interval)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
BEGIN
  IF clock_timestamp() - statement_timestamp() > _max THEN
    RAISE EXCEPTION 'sign_in_attempt: tempo-limite excedido.' USING ERRCODE = '57014';
  END IF;
END;
$$;

-- Limpeza (RN-11): apaga as linhas vencidas sem esperar nem travar uma
-- tentativa em andamento (SKIP LOCKED). Devolve quantas apagou.
CREATE OR REPLACE FUNCTION private.sign_in_purge()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  DELETE FROM private.sign_in_throttle t
   USING (SELECT s.kind, s.key_hash
            FROM private.sign_in_throttle s
           WHERE s.expires_at < now()
             FOR UPDATE SKIP LOCKED) x
   WHERE t.kind = x.kind
     AND t.key_hash = x.key_hash;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION private.login_identifier_text(text)                      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.parse_login_identifier(text)                     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sign_in_key(text, text)                          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sign_in_origin_key(inet)                         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sign_in_lookup(text, text, text, text, text)     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sign_in_check_legacy(uuid, text)                 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sign_in_assert_duration(interval)                FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sign_in_purge()                                  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RPCs (public, SECURITY DEFINER, só service_role)
-- ---------------------------------------------------------------------------

-- A decisão inteira de um login, numa transação (DT-02, DT-03, DT-07). Ver o
-- algoritmo no cabeçalho. Retorno (jsonb):
--   {"result":"empty_fields"}
--   {"result":"locked","retry_after_seconds":int,"retry_after_minutes":int}
--   {"result":"invalid"}
--   {"result":"ok","member_id":uuid,"auth_user_id":uuid,"auth_email":text,
--    "identifier_type":text,"identifier_masked":text,"password_action":null}
CREATE OR REPLACE FUNCTION public.sign_in_attempt(_identifier text, _password text, _origin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  -- Limites (RN-10, RN-11, DT-07, DT-19). Mudar um deles é uma linha (risco 16).
  c_identifier_limit constant integer  := 5;
  c_origin_limit     constant integer  := 20;
  c_window           constant interval := interval '15 minutes';
  c_block            constant interval := interval '15 minutes';
  c_max_duration     constant interval := interval '5 seconds';
  -- Hash fictício com o custo de produção ($2a$, custo 10): o bcrypt das
  -- tentativas sem conta disponível (RN-07, tempo igual).
  c_dummy_hash       constant text     := '$2a$10$q5HyGs.zwdS5e.tU/XYZwO';
  -- Único formato de hash que o pgcrypto confere (o $2b$ cairia no DES).
  c_bcrypt_format    constant text     := '^\$2a\$[0-9]{2}\$[./A-Za-z0-9]{53}$';

  _p              record;
  _origin_inet    inet;
  _kinds          text[]  := '{}';
  _hashes         bytea[] := '{}';
  _k              record;
  _now            timestamptz;
  _blocked_until  timestamptz;
  _seconds        integer;
  _lookup         record;
  _reason         text;
  _linked_id      uuid;
  _linked_name    text;
  _identifier_type text;
  _auth_user_id   uuid;
  _acct_email     text;
  _acct_hash      text;
  _account_ok     boolean := false;
  _calc           text;
  _ok             boolean := false;
  _legacy         text;
  _blocked_identifier boolean := false;
  _blocked_origin     boolean := false;
  _block_minutes  integer := ceil(extract(epoch FROM c_block) / 60)::integer;
BEGIN
  -- 1. Campos vazios (RN-08): nada é tocado.
  SELECT * INTO _p FROM private.parse_login_identifier(_identifier);
  IF _p.format = 'empty' OR _password IS NULL OR _password = '' THEN
    PERFORM private.sign_in_assert_duration(c_max_duration);
    RETURN jsonb_build_object('result', 'empty_fields');
  END IF;

  -- 2. Origem (DT-06): a mensagem de erro não leva o valor.
  BEGIN
    _origin_inet := _origin::inet;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'sign_in_attempt: origem inválida.' USING ERRCODE = '22023';
  END;
  IF _origin_inet IS NULL THEN
    RAISE EXCEPTION 'sign_in_attempt: origem ausente.' USING ERRCODE = '22023';
  END IF;

  -- 3. Chaves (DT-05): e:, c:, m:, x: e o:.
  IF _p.format = 'email' THEN
    _kinds := array_append(_kinds, 'identifier');
    _hashes := array_append(_hashes, private.sign_in_key('identifier', 'e:' || _p.email));
  ELSIF _p.format = 'invalid' THEN
    _kinds := array_append(_kinds, 'identifier');
    _hashes := array_append(_hashes, private.sign_in_key('identifier', 'x:' || lower(private.login_identifier_text(_identifier))));
  ELSE
    IF _p.cpf IS NOT NULL THEN
      _kinds := array_append(_kinds, 'identifier');
      _hashes := array_append(_hashes, private.sign_in_key('identifier', 'c:' || _p.cpf));
    END IF;
    IF _p.mobile_key IS NOT NULL THEN
      _kinds := array_append(_kinds, 'identifier');
      _hashes := array_append(_hashes, private.sign_in_key('identifier', 'm:' || _p.mobile_key));
    END IF;
  END IF;
  _kinds := array_append(_kinds, 'origin');
  _hashes := array_append(_hashes, private.sign_in_key('origin', 'o:' || private.sign_in_origin_key(_origin_inet)));

  -- 4. Travas, na ordem (kind, key_hash), antes de qualquer conferência.
  FOR _k IN
    SELECT u.kind, u.key_hash
      FROM unnest(_kinds, _hashes) AS u(kind, key_hash)
     ORDER BY u.kind, u.key_hash
  LOOP
    INSERT INTO private.sign_in_throttle AS t (kind, key_hash, expires_at)
    VALUES (_k.kind, _k.key_hash, clock_timestamp() + c_window)
    ON CONFLICT (kind, key_hash) DO UPDATE SET kind = EXCLUDED.kind;
  END LOOP;

  _now := clock_timestamp();

  -- 5. Bloqueio vigente (RN-10 a RN-12): o maior prazo; nada é gravado.
  SELECT max(t.blocked_until) INTO _blocked_until
    FROM private.sign_in_throttle t
    JOIN unnest(_kinds, _hashes) AS u(kind, key_hash)
      ON t.kind = u.kind AND t.key_hash = u.key_hash
   WHERE t.blocked_until > _now;

  IF _blocked_until IS NOT NULL THEN
    _seconds := greatest(ceil(extract(epoch FROM _blocked_until - _now))::integer, 1);
    PERFORM private.sign_in_assert_duration(c_max_duration);
    RETURN jsonb_build_object(
      'result', 'locked',
      'retry_after_seconds', _seconds,
      'retry_after_minutes', greatest(ceil(_seconds / 60.0)::integer, 1)
    );
  END IF;

  -- 6. Busca, conta, ponto do E3.02 e um bcrypt.
  IF _p.format = 'invalid' THEN
    _reason := 'invalid_identifier';                       -- sem tipo, sem ligação
  ELSE
    SELECT * INTO _lookup
      FROM private.sign_in_lookup(_p.format, _p.email, _p.cpf, _p.mobile, _p.mobile_key);
    _identifier_type := _lookup.identifier_type;

    IF _lookup.outcome = 'not_found' THEN
      _reason := 'not_found';
    ELSIF _lookup.outcome = 'ambiguous' THEN
      _reason := 'ambiguous';
    ELSIF _lookup.outcome = 'member_deleted' THEN
      _reason := 'member_deleted';
      _linked_id := _lookup.member_id;                       -- nulo se mais de um (DA-6)
      _linked_name := _lookup.member_name;
    ELSE                                                     -- found
      _linked_id := _lookup.member_id;
      _linked_name := _lookup.member_name;

      _legacy := private.sign_in_check_legacy(_linked_id, _password);
      IF _legacy IS NOT NULL THEN
        RAISE EXCEPTION 'sign_in_attempt: credencial legada não suportada neste passo.'
          USING ERRCODE = '0A000';
      END IF;

      SELECT m.auth_user_id INTO _auth_user_id FROM public.members m WHERE m.id = _linked_id;
      IF _auth_user_id IS NULL THEN
        _reason := 'no_account';
      ELSE
        -- RN-06 b: existe, não apagada, não banida, confirmada, com e-mail,
        -- sem SSO nem anônima e com senha bcrypt (DA-9). Sem trava.
        SELECT u.email,
               u.encrypted_password,
               u.deleted_at IS NULL
                 AND (u.banned_until IS NULL OR u.banned_until <= _now)
                 AND u.email_confirmed_at IS NOT NULL
                 AND coalesce(u.email, '') <> ''
                 AND NOT coalesce(u.is_sso_user, false)
                 AND NOT coalesce(u.is_anonymous, false)
                 AND coalesce(u.encrypted_password ~ c_bcrypt_format, false)
          INTO _acct_email, _acct_hash, _account_ok
          FROM auth.users u
         WHERE u.id = _auth_user_id;
        _account_ok := coalesce(_account_ok, false);
        IF NOT _account_ok THEN
          _reason := 'account_unavailable';                  -- DA-9
        END IF;
      END IF;
    END IF;
  END IF;

  -- Exatamente um bcrypt, do mesmo custo, em toda tentativa não bloqueada.
  _calc := extensions.crypt(_password, CASE WHEN _account_ok THEN _acct_hash ELSE c_dummy_hash END);
  _ok := _account_ok
         AND _calc = _acct_hash
         AND octet_length(_password) <= 72;                  -- DA-5
  IF _account_ok AND NOT _ok THEN
    _reason := 'wrong_password';
  END IF;

  -- 7a. Sucesso: zera as linhas de identificação; a de origem não muda (RN-11).
  IF _ok THEN
    UPDATE private.sign_in_throttle t
       SET failures = '{}', blocked_until = NULL, expires_at = _now
      FROM unnest(_kinds, _hashes) AS u(kind, key_hash)
     WHERE t.kind = 'identifier'
       AND t.kind = u.kind
       AND t.key_hash = u.key_hash;

    PERFORM private.sign_in_assert_duration(c_max_duration);
    RETURN jsonb_build_object(
      'result', 'ok',
      'member_id', _linked_id,
      'auth_user_id', _auth_user_id,
      'auth_email', _acct_email,
      'identifier_type', _identifier_type,
      'identifier_masked', _p.masked,
      'password_action', NULL                                -- ponto do E3.02
    );
  END IF;

  -- 7b. Falha: janela deslizante, soma em todas as linhas e bloqueio no limite.
  WITH cur AS (
    SELECT t.kind, t.key_hash,
           array(SELECT f FROM unnest(t.failures) AS f WHERE f > _now - c_window ORDER BY f)
             || _now AS fails,
           CASE t.kind WHEN 'identifier' THEN c_identifier_limit ELSE c_origin_limit END AS lim
      FROM private.sign_in_throttle t
      JOIN unnest(_kinds, _hashes) AS u(kind, key_hash)
        ON t.kind = u.kind AND t.key_hash = u.key_hash
  ), upd AS (
    UPDATE private.sign_in_throttle t
       SET failures      = CASE WHEN cardinality(c.fails) >= c.lim THEN '{}' ELSE c.fails END,
           blocked_until = CASE WHEN cardinality(c.fails) >= c.lim THEN _now + c_block END,
           expires_at    = _now + CASE WHEN cardinality(c.fails) >= c.lim
                                       THEN greatest(c_window, c_block) ELSE c_window END
      FROM cur c
     WHERE t.kind = c.kind
       AND t.key_hash = c.key_hash
    RETURNING t.kind, t.blocked_until IS NOT NULL AS blocked
  )
  SELECT coalesce(bool_or(blocked) FILTER (WHERE kind = 'identifier'), false),
         coalesce(bool_or(blocked) FILTER (WHERE kind = 'origin'), false)
    INTO _blocked_identifier, _blocked_origin
    FROM upd;

  -- 8. Auditoria (RN-15 b, c; DA-8). A falha de gravação não muda a resposta.
  BEGIN
    PERFORM public._log_event(
      _action        => 'login_failed'::public.event_action,
      _entity        => 'auth'::public.event_entity,
      _entity_id     => _linked_id,
      _entity_label  => _linked_name,
      _description   => 'Falha no login',
      _changed_fields => NULL,
      _metadata      => jsonb_strip_nulls(jsonb_build_object(
                          'identifier_type',   _identifier_type,
                          'identifier_masked', _p.masked,
                          'reason',            _reason)),
      _success       => false,
      _error_reason  => CASE _reason
                          WHEN 'invalid_identifier'  THEN 'Identificação inválida'
                          WHEN 'not_found'           THEN 'Identificação não encontrada'
                          WHEN 'ambiguous'           THEN 'Identificação ambígua'
                          WHEN 'member_deleted'      THEN 'Cadastro excluído'
                          WHEN 'no_account'          THEN 'Sem conta de acesso'
                          WHEN 'account_unavailable' THEN 'Conta de acesso indisponível'
                          WHEN 'wrong_password'      THEN 'Senha incorreta'
                        END,
      _actor_user_id => NULL
    );

    IF _blocked_identifier THEN
      PERFORM public._log_event(
        _action        => 'login_blocked'::public.event_action,
        _entity        => 'auth'::public.event_entity,
        _entity_id     => _linked_id,
        _entity_label  => _linked_name,
        _description   => 'Login bloqueado por excesso de tentativas',
        _changed_fields => NULL,
        _metadata      => jsonb_strip_nulls(jsonb_build_object(
                            'block_scope',       'identifier',
                            'block_minutes',     _block_minutes,
                            'identifier_type',   _identifier_type,
                            'identifier_masked', _p.masked)),
        _success       => false,
        _error_reason  => NULL,
        _actor_user_id => NULL
      );
    END IF;

    IF _blocked_origin THEN                                  -- nunca ligado nem com a origem
      PERFORM public._log_event(
        _action        => 'login_blocked'::public.event_action,
        _entity        => 'auth'::public.event_entity,
        _entity_id     => NULL,
        _entity_label  => NULL,
        _description   => 'Login bloqueado por excesso de tentativas',
        _changed_fields => NULL,
        _metadata      => jsonb_build_object(
                            'block_scope',   'origin',
                            'block_minutes', _block_minutes),
        _success       => false,
        _error_reason  => NULL,
        _actor_user_id => NULL
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sign_in_attempt: falha ao registrar a auditoria (SQLSTATE %).', SQLSTATE;
  END;

  PERFORM private.sign_in_assert_duration(c_max_duration);
  IF _blocked_identifier OR _blocked_origin THEN
    RETURN jsonb_build_object(
      'result', 'locked',
      'retry_after_seconds', ceil(extract(epoch FROM c_block))::integer,
      'retry_after_minutes', _block_minutes
    );
  END IF;
  RETURN jsonb_build_object('result', 'invalid');
END;
$$;

-- "Login realizado" (RN-15 a, DA-12): chamada pela sign-in depois que a sessão
-- foi emitida. Confere que o cadastro (não excluído) é dessa conta.
CREATE OR REPLACE FUNCTION public.sign_in_record_login(
  _member_id uuid,
  _auth_user_id uuid,
  _identifier_type text,
  _identifier_masked text
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
BEGIN
  IF _identifier_type IS NULL OR _identifier_type NOT IN ('email', 'mobile', 'cpf', 'cpf_or_mobile') THEN
    RAISE EXCEPTION 'sign_in_record_login: tipo de identificação inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT m.name INTO _name
    FROM public.members m
   WHERE m.id = _member_id
     AND m.auth_user_id = _auth_user_id
     AND m.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sign_in_record_login: o cadastro não pertence a essa conta.' USING ERRCODE = '22023';
  END IF;

  PERFORM public._log_event(
    _action        => 'login'::public.event_action,
    _entity        => 'auth'::public.event_entity,
    _entity_id     => _member_id,
    _entity_label  => _name,
    _description   => 'Login realizado',
    _changed_fields => NULL,
    _metadata      => jsonb_strip_nulls(jsonb_build_object(
                        'identifier_type',   _identifier_type,
                        'identifier_masked', _identifier_masked)),
    _success       => true,
    _error_reason  => NULL,
    _actor_user_id => _auth_user_id
  );
END;
$$;

-- Descarta o código de uso único pendente da conta quando a emissão da sessão
-- falha (DA-13, DT-18, risco 9). O postgres só tem UPDATE em recovery_token de
-- auth.users (tarefa 1), por isso nada mais é tocado.
CREATE OR REPLACE FUNCTION public.sign_in_discard_link(_auth_user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM auth.one_time_tokens
   WHERE user_id = _auth_user_id
     AND token_type = 'recovery_token';

  UPDATE auth.users
     SET recovery_token = ''
   WHERE id = _auth_user_id
     AND recovery_token IS DISTINCT FROM '';
END;
$$;

REVOKE ALL ON FUNCTION public.sign_in_attempt(text, text, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sign_in_record_login(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sign_in_discard_link(uuid)                   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_in_attempt(text, text, text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.sign_in_record_login(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sign_in_discard_link(uuid)                   TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Limpeza a cada 10 minutos (RN-11; risco 13). cron.schedule com nome é
--    idempotente (atualiza o job de mesmo nome).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule('e104-sign-in-purge', '*/10 * * * *', 'SELECT private.sign_in_purge()');
