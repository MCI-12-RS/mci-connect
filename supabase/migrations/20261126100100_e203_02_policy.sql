-- E2.03 (PR 1, migration 2 de 4) — Política de senha (RN-13) e senha temporária
-- (RN-03). Ver docs/specs/e2-03-senha.md no repositório apps-mci ("Política de
-- senha", "Senha temporária", DA-4, DA-5, DA-6, DT-06 e DT-10).
--
-- Só funções puras e a lista de senhas comuns: nada muda de comportamento.
--
-- Conteúdo:
--   0. Guarda de pré-requisito (E1.04, E2.01 e E2.02). Falha cedo, sem mudar nada.
--   1. private.common_passwords e a carga da lista (RN-13 e).
--   2. private.fold_password      forma dobrada (DA-4)
--      private.is_simple_sequence sequência simples (RN-13 d, DA-5)
--      private.password_policy_violation  o ponto único da política no servidor
--      private.generate_temporary_password  a senha temporária (RN-03, DT-10)
--   3. public.check_password_policy  (só service_role; a create-user-admin usa)
--
-- Política (sobre a senha exatamente como foi digitada; devolve o código da
-- primeira regra violada, ou NULL):
--   (a) menos de 8 pontos de código ........................ password_too_short
--   (a) mais de 72 bytes em UTF-8 ............................ password_too_long
--   (c) todos os caracteres iguais, na forma dobrada .......... password_weak
--   (d) sequência simples, na forma dobrada ................... password_weak
--   (e) na lista de senhas comuns, na forma dobrada ........... password_weak
--   (f) palavra do contexto seguida só de não letras .......... password_weak
--   (g) CPF (11 dígitos), 8 últimos do celular, nascimento
--       ddmmaaaa (sem . - / e espaço) ou igual ao e-mail ...... password_personal_data
--   (h) "diferente da atual" e a confirmação ficam nas trocas (migration 4).
-- A gêmea da tela (src/lib/auth/password-policy.ts) tem as mesmas regras, menos
-- a (e). As duas passam pela tabela supabase/tests/fixtures/password-policy-cases.json.
--
-- Lista de senhas comuns (RN-13 e):
--   origem:   SecLists, Passwords/Common-Credentials/10k-most-common.txt
--             https://github.com/danielmiessler/SecLists
--             commit 913b327317496d062bcc7cace524aaad8a693be2 (2026-09-08)
--             sha256 do arquivo: 68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce
--   licença:  MIT (SecLists, Daniel Miessler e colaboradores)
--   filtro:   das 10.001 linhas, só as com 8 pontos de código ou mais e até 72
--             bytes (as menores já caem na regra a); sem repetidas.
--   contagem: 2.087 senhas. A carga guarda a forma dobrada (fold_password), sem
--             repetidas. Acrescentar outra lista é só uma migration com mais INSERTs.
--
-- Nenhuma função recebe EXECUTE de anon. As internas (private) não têm EXECUTE
-- para ninguém além do dono (postgres); rodam dentro das RPCs definer.
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE e ON CONFLICT DO NOTHING.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisitos: E1.04, E2.01 e E2.02. Falha cedo, sem mudar nada.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('private.sign_in_throttle') IS NULL
     OR to_regprocedure('public.sign_in_attempt(text,text,text)') IS NULL
     OR to_regprocedure('private.sign_in_key(text,text)') IS NULL
     OR to_regprocedure('private.sign_in_origin_key(inet)') IS NULL
     OR to_regclass('private.member_access_suspensions') IS NULL
     OR to_regprocedure('public._del_suspend_access(uuid,uuid)') IS NULL
     OR to_regprocedure('public.viewer_sees_member(uuid)') IS NULL
     OR to_regprocedure('public.viewer_covers_role(uuid)') IS NULL
     OR to_regprocedure('public.my_access()') IS NULL THEN
    RAISE EXCEPTION 'E2.03 depende do E1.04, do E2.01 e do E2.02 em produção.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Lista de senhas comuns (RN-13 e), na forma dobrada (DA-4). Só no banco
--    (AQ-6): fora da API, RLS sem políticas e nenhum privilégio, nem para
--    service_role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.common_passwords (
  password text PRIMARY KEY
);
ALTER TABLE private.common_passwords ENABLE ROW LEVEL SECURITY;   -- sem políticas
REVOKE ALL ON TABLE private.common_passwords FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.common_passwords IS
  'E2.03 (RN-13 e): senhas comuns, na forma dobrada de private.fold_password. '
  'Origem, licença, filtro e contagem no cabeçalho da migration e203_02_policy.';

-- ---------------------------------------------------------------------------
-- 2. Funções da política (private, sem grants)
-- ---------------------------------------------------------------------------

-- Forma dobrada (DA-4): as letras acentuadas do português (nas duas caixas)
-- viram a letra sem acento, as marcas combinantes (U+0300 a U+036F, a forma
-- decomposta) saem, e só as letras ASCII vão para minúsculas (COLLATE "C"),
-- sem depender do locale do banco.
CREATE OR REPLACE FUNCTION private.fold_password(_p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT lower(
           regexp_replace(
             translate(_p,
                       'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                       'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
             '[̀-ͯ]', '', 'g')
           COLLATE "C")
$$;

-- Sequência simples (RN-13 d, DA-5), sobre a forma dobrada: só dígitos, todos
-- no mesmo sentido (+1 ou -1), com volta no 9 (34567890, 90123456); ou só
-- letras a-z, todas no mesmo sentido, sem volta.
CREATE OR REPLACE FUNCTION private.is_simple_sequence(_f text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  _n    integer := char_length(_f);
  _step integer;
  _d    integer;
  i     integer;
BEGIN
  IF _f IS NULL OR _n < 2 THEN
    RETURN false;
  END IF;

  IF _f ~ '^[0-9]+$' THEN
    _step := (ascii(substr(_f, 2, 1)) - ascii(substr(_f, 1, 1)) + 10) % 10;
    IF _step NOT IN (1, 9) THEN                -- 9 = -1 com volta
      RETURN false;
    END IF;
    FOR i IN 2 .. _n - 1 LOOP
      _d := (ascii(substr(_f, i + 1, 1)) - ascii(substr(_f, i, 1)) + 10) % 10;
      IF _d <> _step THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  IF _f ~ '^[a-z]+$' THEN
    _step := ascii(substr(_f, 2, 1)) - ascii(substr(_f, 1, 1));
    IF _step NOT IN (1, -1) THEN
      RETURN false;
    END IF;
    FOR i IN 2 .. _n - 1 LOOP
      IF ascii(substr(_f, i + 1, 1)) - ascii(substr(_f, i, 1)) <> _step THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- O ponto único da política no servidor (RN-13 a até g). Devolve o código da
-- primeira regra violada, ou NULL. Os dados pessoais vêm do cadastro (ou do
-- formulário, na senha inicial); o dado que falta não é conferido (DA-6).
-- Nenhuma mensagem leva a senha.
CREATE OR REPLACE FUNCTION private.password_policy_violation(
  _password   text,
  _cpf        text,
  _mobile     text,
  _birth_date date,
  _email      text
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  _p      text := coalesce(_password, '');
  _f      text;
  _s      text;
  _cpf    text := regexp_replace(coalesce(_cpf, ''), '[^0-9]', '', 'g');
  _mobile text := regexp_replace(coalesce(_mobile, ''), '[^0-9]', '', 'g');
  _email  text := lower(btrim(coalesce(_email, '')) COLLATE "C");
BEGIN
  -- (a) tamanho
  IF char_length(_p) < 8 THEN
    RETURN 'password_too_short';
  END IF;
  IF octet_length(_p) > 72 THEN
    RETURN 'password_too_long';
  END IF;

  _f := private.fold_password(_p);

  -- (c) todos iguais
  IF _f ~ '^(.)\1*$' THEN
    RETURN 'password_weak';
  END IF;
  -- (d) sequência simples
  IF private.is_simple_sequence(_f) THEN
    RETURN 'password_weak';
  END IF;
  -- (e) senhas comuns
  IF EXISTS (SELECT 1 FROM private.common_passwords c WHERE c.password = _f) THEN
    RETURN 'password_weak';
  END IF;
  -- (f) palavras do contexto, sozinhas ou seguidas só de não letras
  IF _f ~ '^(senha|mudar|igreja|mci|mci12|mci12rs|g12|connect)[^a-z]*$' THEN
    RETURN 'password_weak';
  END IF;

  -- (g) dados pessoais, sem ".", "-", "/" e espaço
  _s := translate(_p, '.-/ ', '');
  IF (length(_cpf) = 11 AND strpos(_s, _cpf) > 0)
     OR (length(_mobile) >= 8 AND strpos(_s, right(_mobile, 8)) > 0)
     OR (_birth_date IS NOT NULL AND strpos(_s, to_char(_birth_date, 'DDMMYYYY')) > 0)
     OR (_email <> '' AND lower(btrim(_p) COLLATE "C") = _email) THEN
    RETURN 'password_personal_data';
  END IF;

  RETURN NULL;
END;
$$;

-- Senha temporária (RN-03, DT-10): 8 de 31 símbolos (sem 0, 1, i, l e o), do
-- gerador seguro do OpenSSL com rejeição (só bytes < 248 = 31 * 8, caractere =
-- byte % 31, sem viés). Sorteia de novo se a política recusar (ex.: 23456789);
-- depois de 10 sorteios, erro, e a redefinição inteira volta.
CREATE OR REPLACE FUNCTION private.generate_temporary_password(
  _cpf        text,
  _mobile     text,
  _birth_date date,
  _email      text
) RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  c_alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  _bytes bytea;
  _b     integer;
  _out   text;
  _try   integer;
  i      integer;
BEGIN
  FOR _try IN 1 .. 10 LOOP
    _out := '';
    WHILE char_length(_out) < 8 LOOP
      _bytes := extensions.gen_random_bytes(16);
      FOR i IN 0 .. 15 LOOP
        _b := get_byte(_bytes, i);
        IF _b < 248 THEN
          _out := _out || substr(c_alphabet, (_b % 31) + 1, 1);
          EXIT WHEN char_length(_out) = 8;
        END IF;
      END LOOP;
    END LOOP;

    IF private.password_policy_violation(_out, _cpf, _mobile, _birth_date, _email) IS NULL THEN
      RETURN _out;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'generate_temporary_password: nenhuma senha dentro da política em 10 sorteios.'
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION private.fold_password(text)                                  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_simple_sequence(text)                             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.password_policy_violation(text, text, text, date, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.generate_temporary_password(text, text, date, text)  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. Carga da lista (depois da fold_password, que ela usa).
-- ---------------------------------------------------------------------------
INSERT INTO private.common_passwords (password)
SELECT DISTINCT private.fold_password(v.p)
  FROM (VALUES
  ('password'), ('12345678'), ('baseball'), ('football'), ('jennifer'), ('superman'), ('trustno1'), ('michelle'),
  ('sunshine'), ('123456789'), ('starwars'), ('computer'), ('corvette'), ('princess'), ('iloveyou'), ('maverick'),
  ('samantha'), ('steelers'), ('whatever'), ('hardcore'), ('internet'), ('mercedes'), ('bigdaddy'), ('midnight'),
  ('11111111'), ('marlboro'), ('victoria'), ('butthead'), ('startrek'), ('liverpoo'), ('danielle'), ('redskins'),
  ('mountain'), ('shithead'), ('xxxxxxxx'), ('88888888'), ('nicholas'), ('metallic'), ('qwertyui'), ('dolphins'),
  ('cocacola'), ('rush2112'), ('jonathan'), ('scorpion'), ('asdfasdf'), ('godzilla'), ('williams'), ('lifehack'),
  ('platinum'), ('garfield'), ('69696969'), ('jordan23'), ('bullshit'), ('airborne'), ('elephant'), ('explorer'),
  ('christin'), ('december'), ('benjamin'), ('dickhead'), ('brooklyn'), ('redwings'), ('michigan'), ('87654321'),
  ('guinness'), ('einstein'), ('snowball'), ('alexande'), ('passw0rd'), ('lasvegas'), ('slipknot'), ('kimberly'),
  ('1q2w3e4r'), ('carolina'), ('colorado'), ('creative'), ('bollocks'), ('darkness'), ('asdfghjk'), ('poohbear'),
  ('nintendo'), ('november'), ('password1'), ('lacrosse'), ('paradise'), ('maryjane'), ('spitfire'), ('anderson'),
  ('cherokee'), ('drowssap'), ('marshall'), ('1qaz2wsx'), ('caroline'), ('franklin'), ('snickers'), ('courtney'),
  ('westside'), ('patricia'), ('semperfi'), ('freeuser'), ('babygirl'), ('champion'), ('softball'), ('security'),
  ('wildcats'), ('veronica'), ('abcd1234'), ('wolverin'), ('remember'), ('freepass'), ('pearljam'), ('mistress'),
  ('peekaboo'), ('budlight'), ('electric'), ('stargate'), ('brittany'), ('swimming'), ('scotland'), ('swordfis'),
  ('blink182'), ('virginia'), ('passport'), ('aaaaaaaa'), ('rolltide'), ('bulldogs'), ('liverpool'), ('chevelle'),
  ('mitchell'), ('spiderma'), ('patriots'), ('cardinal'), ('kawasaki'), ('ncc1701d'), ('airplane'), ('scarface'),
  ('elizabet'), ('wolfpack'), ('lawrence'), ('american'), ('stingray'), ('simpsons'), ('srinivas'), ('panthers'),
  ('pussycat'), ('loverboy'), ('tarheels'), ('wolfgang'), ('testtest'), ('michael1'), ('pakistan'), ('infinity'),
  ('letmein1'), ('hercules'), ('billybob'), ('pavilion'), ('changeme'), ('darkside'), ('zeppelin'), ('darkstar'),
  ('charlie1'), ('wrangler'), ('qwerty12'), ('bobafett'), ('business'), ('sterling'), ('babydoll'), ('cheyenne'),
  ('longhorn'), ('presario'), ('mustang1'), ('21122112'), ('q1w2e3r4'), ('12341234'), ('devildog'), ('bluebird'),
  ('metallica'), ('access14'), ('enterpri'), ('blizzard'), ('asdf1234'), ('harrison'), ('thailand'), ('1234567890'),
  ('cadillac'), ('hellfire'), ('lonewolf'), ('12121212'), ('fireball'), ('precious'), ('engineer'), ('basketba'),
  ('valentin'), ('wetpussy'), ('morpheus'), ('hotstuff'), ('fuck_inside'), ('goldberg'), ('wrinkle1'), ('consumer'),
  ('serenity'), ('99999999'), ('bigboobs'), ('chocolat'), ('christia'), ('birthday'), ('stephani'), ('1234qwer'),
  ('98765432'), ('77777777'), ('highland'), ('seminole'), ('airforce'), ('hamilton'), ('buckeyes'), ('abcdefgh'),
  ('goldfish'), ('deftones'), ('icecream'), ('pleasure'), ('juventus'), ('ncc1701e'), ('51505150'), ('cavalier'),
  ('aardvark'), ('babylon5'), ('savannah'), ('yankees1'), ('fredfred'), ('concrete'), ('shamrock'), ('atlantis'),
  ('wordpass'), ('predator'), ('marathon'), ('montreal'), ('kathleen'), ('jessica1'), ('diamonds'), ('stallion'),
  ('letmein2'), ('clitoris'), ('sundance'), ('renegade'), ('hollywoo'), ('hello123'), ('sweetpea'), ('stocking'),
  ('campbell'), ('christop'), ('rockstar'), ('geronimo'), ('chandler'), ('lovelove'), ('greenday'), ('987654321'),
  ('creampie'), ('trombone'), ('55555555'), ('mongoose'), ('tottenha'), ('butterfl'), ('clifford'), ('fuckyou2'),
  ('infantry'), ('skywalke'), ('raistlin'), ('vanhalen'), ('sherlock'), ('dietcoke'), ('ultimate'), ('superfly'),
  ('freedom1'), ('drpepper'), ('lesbians'), ('musicman'), ('warcraft'), ('microsoft'), ('morrison'), ('isabelle'),
  ('thuglife'), ('stonecol'), ('logitech'), ('florence'), ('1passwor'), ('bluemoon'), ('22222222'), ('stardust'),
  ('margaret'), ('66666666'), ('66668888'), ('charlott'), ('waterloo'), ('11223344'), ('standard'), ('alexandr'),
  ('hannibal'), ('frontier'), ('welcome1'), ('spanking'), ('japanese'), ('kristina'), ('deepthroat'), ('bonehead'),
  ('showtime'), ('squirrel'), ('mustangs'), ('septembe'), ('leonardo'), ('makaveli'), ('vacation'), ('passwor1'),
  ('columbia'), ('napoleon'), ('motorola'), ('william1'), ('matthew1'), ('robinson'), ('penguins'), ('8j4ye3uz'),
  ('californ'), ('qwertyuiop'), ('portland'), ('asdfghjkl'), ('overlord'), ('stranger'), ('socrates'), ('spiderman'),
  ('13131313'), ('national'), ('intrepid'), ('megadeth'), ('bigballs'), ('chargers'), ('discover'), ('isabella'),
  ('megapass'), ('grateful'), ('mushroom'), ('cristina'), ('hongkong'), ('basketball'), ('satan666'), ('kingkong'),
  ('penelope'), ('thompson'), ('anything'), ('knickers'), ('playtime'), ('lightnin'), ('slapshot'), ('titleist'),
  ('werewolf'), ('fernando'), ('blackcat'), ('tacobell'), ('kittycat'), ('thunder1'), ('thankyou'), ('scoobydo'),
  ('coltrane'), ('lonestar'), ('heather1'), ('beefcake'), ('zzzzzzzz'), ('personal'), ('anthony1'), ('fuckface'),
  ('lowrider'), ('punkrock'), ('dodgeram'), ('dingdong'), ('qqqqqqqq'), ('johnjohn'), ('asshole1'), ('crusader'),
  ('syracuse'), ('meridian'), ('turkey50'), ('keyboard'), ('ilovesex'), ('blackman'), ('richmond'), ('sandiego'),
  ('cooldude'), ('mariners'), ('caliente'), ('fletcher'), ('porsche9'), ('kangaroo'), ('springer'), ('goodtime'),
  ('chelsea1'), ('freckles'), ('nebraska'), ('webmaster'), ('blueeyes'), ('director'), ('monopoly'), ('blackjac'),
  ('southern'), ('peterpan'), ('fuckyou1'), ('a1b2c3d4'), ('sentinel'), ('richard1'), ('1234abcd'), ('guardian'),
  ('candyman'), ('mandingo'), ('munchkin'), ('billyboy'), ('rootbeer'), ('assassin'), ('frederic'), ('giovanni'),
  ('scarlett'), ('achilles'), ('warriors'), ('plymouth'), ('cameltoe'), ('fuckfuck'), ('sithlord'), ('backdoor'),
  ('chevrole'), ('lorraine'), ('cosworth'), ('eternity'), ('verbatim'), ('chocolate'), ('deadhead'), ('pineappl'),
  ('rosemary'), ('porkchop'), ('blackdog'), ('alexander'), ('valhalla'), ('santiago'), ('portugal'), ('1qazxsw2'),
  ('stripper'), ('sebastia'), ('hurrican'), ('1x2zkg8w'), ('atlantic'), ('hyperion'), ('44444444'), ('skittles'),
  ('hastings'), ('gangbang'), ('sailboat'), ('immortal'), ('maryland'), ('columbus'), ('beautiful'), ('swordfish'),
  ('ncc1701a'), ('spartans'), ('threesom'), ('dilligaf'), ('pinkfloy'), ('catalina'), ('formula1'), ('scooter1'),
  ('colombia'), ('lancelot'), ('angelica'), ('rockhard'), ('poontang'), ('starship'), ('starbuck'), ('catherin'),
  ('kentucky'), ('33333333'), ('12344321'), ('sapphire'), ('raiders1'), ('excalibu'), ('imperial'), ('phillips'),
  ('golfball'), ('front242'), ('macdaddy'), ('qwer1234'), ('cowboys1'), ('dannyboy'), ('martinez'), ('aquarius'),
  ('pppppppp'), ('clarence'), ('eatpussy'), ('beatrice'), ('phillies'), ('research'), ('gggggggg'), ('doughboy'),
  ('lollipop'), ('qazwsxed'), ('crazybab'), ('brothers'), ('butthole'), ('rightnow'), ('greatone'), ('gateway1'),
  ('wildfire'), ('jackson1'), ('0.0.0.000'), ('snuggles'), ('phoenix1'), ('technics'), ('gesperrt'), ('brucelee'),
  ('woofwoof'), ('theodore'), ('richards'), ('punisher'), ('username'), ('bunghole'), ('elizabeth'), ('lifetime'),
  ('masterbate'), ('diamond1'), ('abnormal'), ('davidson'), ('starfish'), ('penetration'), ('michaela'), ('caligula'),
  ('railroad'), ('bradford'), ('military'), ('bearbear'), ('patrick1'), ('christine'), ('swinging'), ('labrador'),
  ('justdoit'), ('meatball'), ('saturday'), ('defender'), ('piercing'), ('microsof'), ('mechanic'), ('robotech'),
  ('universe'), ('newpass6'), ('hellyeah'), ('zaq12wsx'), ('spectrum'), ('jjjjjjjj'), ('oklahoma'), ('mmmmmmmm'),
  ('blueblue'), ('wolverine'), ('sniffing'), ('keystone'), ('bbbbbbbb'), ('handsome'), ('tttttttt'), ('ssssssss'),
  ('somethin'), ('melissa1'), ('marcius2'), ('godsmack'), ('rangers1'), ('deeznuts'), ('kingston'), ('yosemite'),
  ('tommyboy'), ('masterbating'), ('marianne'), ('happyday'), ('manchest'), ('unbelievable'), ('aberdeen'), ('nathalie'),
  ('intercourse'), ('supersta'), ('bcfields'), ('hardrock'), ('children'), ('commando'), ('sinclair'), ('squerting'),
  ('jeanette'), ('meathead'), ('gandalf1'), ('magnolia'), ('kenworth'), ('redalert'), ('homemade'), ('webmaste'),
  ('insertion'), ('temptress'), ('gretchen'), ('celebrity'), ('ragnarok'), ('trinidad'), ('kingfish'), ('blackhaw'),
  ('thursday'), ('meatloaf'), ('interacial'), ('streaming'), ('pertinant'), ('pool6123'), ('animated'), ('gordon24'),
  ('fantasies'), ('touching'), ('homepage'), ('ejaculation'), ('whocares'), ('jamesbon'), ('amsterda'), ('february'),
  ('luckydog'), ('businessbabe'), ('brandon1'), ('experience'), ('software'), ('thirteen'), ('rasputin'), ('greenbay'),
  ('pa55word'), ('contortionist'), ('sneakers'), ('sonyfuck'), ('test1234'), ('roadkill'), ('cheerleaers'), ('madeline'),
  ('christian'), ('brighton'), ('housewifes'), ('emmanuel'), ('bigmoney'), ('seductive'), ('sexygirl'), ('canadian'),
  ('gangbanged'), ('crawford'), ('hotpussy'), ('implants'), ('intruder'), ('andyod22'), ('barcelon'), ('chainsaw'),
  ('chickens'), ('downtown'), ('magicman'), ('clevelan'), ('designer'), ('budweise'), ('experienced'), ('pitchers'),
  ('passwords'), ('jeremiah'), ('alliance'), ('halflife'), ('saratoga'), ('positive'), ('transexual'), ('close-up'),
  ('sunnyday'), ('starfire'), ('pictuers'), ('testing1'), ('tiberius'), ('lisalisa'), ('golfgolf'), ('flounder'),
  ('majestic'), ('trailers'), ('mikemike'), ('whitesox'), ('angelina'), ('goodluck'), ('charlton'), ('fingerig'),
  ('gallaries'), ('lockerroom'), ('treasure'), ('absolutely'), ('homepage-'), ('beerbeer'), ('testerer'), ('fordf150'),
  ('pa55w0rd'), ('kamikaze'), ('japanees'), ('masterbaiting'), ('callaway'), ('panasoni'), ('housewife'), ('18436572'),
  ('sullivan'), ('terrapin'), ('masturbation'), ('hardcock'), ('freeporn'), ('pornographic'), ('traveler'), ('moneyman'),
  ('shopping'), ('thumbnils'), ('amateurs'), ('apollo13'), ('goldwing'), ('doghouse'), ('pounding'), ('truelove'),
  ('underdog'), ('wrestlin'), ('sherwood'), ('johannes'), ('balloons'), ('happy123'), ('flamingo'), ('paintbal'),
  ('llllllll'), ('twilight'), ('christie'), ('bullseye'), ('knickerless'), ('binladen'), ('peterson'), ('thanatos'),
  ('albatros'), ('getsdown'), ('nwo4life'), ('underwear'), ('dddddddd'), ('deeznutz'), ('enterprise'), ('misfit99'),
  ('solution'), ('meredith'), ('barefoot'), ('50spanks'), ('scandinavian'), ('original'), ('shannon1'), ('techniques'),
  ('chemical'), ('salvador'), ('manchester'), ('buckshot'), ('thegreat'), ('goldstar'), ('triangle'), ('kristine'),
  ('snowboar'), ('penetrating'), ('roadking'), ('rockford'), ('chicago1'), ('ferrari1'), ('galeries'), ('godfathe'),
  ('gargoyle'), ('gangster'), ('pussyman'), ('pooppoop'), ('newcastl'), ('mortgage'), ('snoopdog'), ('assholes'),
  ('property'), ('broadway'), ('butterfly'), ('earthlink'), ('westwood'), ('blackbir'), ('slippery'), ('pianoman'),
  ('tomorrow'), ('roadrunn'), ('attitude'), ('seahawks'), ('tunafish'), ('cinnamon'), ('northern'), ('23232323'),
  ('zerocool'), ('limewire'), ('films+pic+galeries'), ('francois'), ('fuckthis'), ('girfriend'), ('uncencored'), ('chrisbln'),
  ('netscape'), ('hhhhhhhh'), ('knockers'), ('tazmania'), ('pharmacy'), ('arsenal1'), ('anaconda'), ('australi'),
  ('gotohell'), ('bulldog1'), ('monalisa'), ('whiteout'), ('james007'), ('bitchass'), ('southpar'), ('lionking'),
  ('megatron'), ('hawaiian'), ('gymnastic'), ('panther1'), ('wp2003wp'), ('passwort'), ('friendly'), ('oooooooo'),
  ('bullfrog'), ('holyshit'), ('jasmine1'), ('sergeant'), ('babyblue'), ('pass1234'), ('poseidon'), ('confused'),
  ('hollywood'), ('insertions'), ('juliette'), ('hayabusa'), ('hawkeyes'), ('geoffrey'), ('chuckles'), ('hounddog'),
  ('philippe'), ('thunderb'), ('marino13'), ('handyman'), ('cerberus'), ('gamecock'), ('magician'), ('preacher'),
  ('chrysler'), ('contains'), ('hedgehog'), ('hoosiers'), ('dutchess'), ('wareagle'), ('ihateyou'), ('sunflowe'),
  ('senators'), ('terminal'), ('laurence'), ('maradona'), ('america1'), ('chicken1'), ('passpass'), ('r2d2c3po'),
  ('myxworld'), ('missouri'), ('wishbone'), ('infiniti'), ('wonderboy'), ('stanford'), ('smeghead'), ('titanium'),
  ('charlene'), ('fishing1'), ('fullmoon'), ('absolute'), ('seinfeld'), ('pingpong'), ('matthews'), ('recovery'),
  ('babyface'), ('gladiato'), ('paranoid'), ('packers1'), ('longjohn'), ('clarinet'), ('mortimer'), ('modelsne'),
  ('vladimir'), ('together'), ('avalanch'), ('55bgates'), ('cccccccc'), ('paradigm'), ('operator'), ('valencia'),
  ('cocksuck'), ('creature'), ('borussia'), ('browning'), ('heritage'), ('millions'), ('starcraf'), ('spaceman'),
  ('chester1'), ('rrrrrrrr'), ('sandwich'), ('magazine'), ('buttfuck'), ('yeahbaby'), ('11235813'), ('bangbang'),
  ('charles1'), ('ffffffff'), ('doberman'), ('overkill'), ('claymore'), ('brewster'), ('electron'), ('eastside'),
  ('minimoni'), ('wildbill'), ('wildcard'), ('yyyyyyyy'), ('sweetnes'), ('skywalker'), ('alphabet'), ('babybaby'),
  ('graphics'), ('florida1'), ('flexible'), ('fuckinside'), ('ursitesux'), ('christma'), ('wwwwwwww'), ('just4fun'),
  ('rebecca1'), ('adrienne'), ('19691969'), ('silverad'), ('rhiannon'), ('10101010'), ('ashleigh'), ('qwerasdf'),
  ('presiden'), ('newyork1'), ('brigitte'), ('buddyboy'), ('heineken'), ('millwall'), ('beautifu'), ('sinister'),
  ('smashing'), ('teddybea'), ('ticklish'), ('lipstick'), ('reynolds'), ('applepie'), ('digital1'), ('dinosaur'),
  ('icehouse'), ('insanity'), ('bluefish'), ('strength'), ('sentnece'), ('temppass'), ('medicine'), ('hahahaha'),
  ('casanova'), ('fountain'), ('dolphin1'), ('porsche1'), ('vampires'), ('highheel'), ('kkkkkkkk'), ('illinois'),
  ('21212121'), ('stonecold'), ('testpass'), ('jiggaman'), ('federico'), ('scorpio1'), ('rt6ytere'), ('madison1'),
  ('coolness'), ('christina'), ('coldbeer'), ('brittney'), ('washingt'), ('stephanie'), ('shepherd'), ('tiffany1'),
  ('mephisto'), ('dragonba'), ('nygiants'), ('password2'), ('corleone'), ('kittykat'), ('vikings1'), ('splinter'),
  ('pipeline'), ('meowmeow'), ('chestnut'), ('longdong'), ('quant4307s'), ('eastwood'), ('moonligh'), ('illusion'),
  ('jayhawks'), ('swingers'), ('stefanie'), ('jefferso'), ('michael2'), ('fastball'), ('scrabble'), ('dirtbike'),
  ('customer'), ('nemrac58'), ('bobdylan'), ('hopeless'), ('kcj9wx5n'), ('killbill'), ('volkswag'), ('windmill'),
  ('iloveyou1'), ('starligh'), ('soulmate'), ('mcdonald'), ('rochelle'), ('oblivion'), ('valkyrie'), ('concorde'),
  ('costello'), ('delaware'), ('nocturne'), ('herewego'), ('earnhard'), ('eeeeeeee'), ('mobydick'), ('reddevil'),
  ('reckless'), ('radiohea'), ('coolcool'), ('classics'), ('choochoo'), ('wireless'), ('bigblock'), ('summer99'),
  ('sexysexy'), ('platypus'), ('telephon'), ('12qwaszx'), ('fishhead'), ('paramedi'), ('lonesome'), ('katherin'),
  ('moonbeam'), ('monster1'), ('monkeybo'), ('windsurf'), ('31415926'), ('sebastian'), ('smoothie'), ('snowflak'),
  ('playstat'), ('playboy1'), ('roadster'), ('hardware'), ('captain1'), ('undertak'), ('uuuuuuuu'), ('criminal'),
  ('1a2b3c4d'), ('thedoors'), ('annabell'), ('catwoman'), ('faithful'), ('farscape'), ('genesis1'), ('pumpkins'),
  ('training'), ('islander'), ('jamesbond'), ('19841984'), ('shitface'), ('maxwell1'), ('armstron'), ('alejandr'),
  ('augustus'), ('care1839'), ('fantasia'), ('freefall'), ('sandrine'), ('qwerqwer'), ('crystal1'), ('nineinch'),
  ('broncos1'), ('winston1'), ('warrior1'), ('iiiiiiii'), ('iloveyou2'), ('straight'), ('specialk'), ('tinkerbe'),
  ('jellybea'), ('cbr900rr'), ('gabriell'), ('gertrude'), ('glennwei'), ('sausages'), ('vanguard'), ('trinitro'),
  ('eldorado'), ('whiskers'), ('wildwood'), ('istheman'), ('interest'), ('25802580'), ('woodland'), ('strawber'),
  ('amsterdam'), ('catherine'), ('football1'), ('vancouve'), ('vauxhall'), ('acidburn'), ('myspace1'), ('buttercu'),
  ('minemine'), ('bigpoppa'), ('blackout'), ('blowfish'), ('talisman'), ('sundevil'), ('shanghai'), ('spencer1'),
  ('slowhand'), ('jonathon'), ('michaels'), ('resident'), ('redbaron'), ('andromed'), ('harddick'), ('5wr2i7h8'),
  ('charlotte'), ('fredrick'), ('francesc'), ('ferguson'), ('fairlane'), ('dogpound'), ('pornporn'), ('clippers'),
  ('daylight'), ('nnnnnnnn'), ('budapest'), ('whistler'), ('whatwhat'), ('wanderer'), ('idontkno'), ('thisisit'),
  ('robotics'), ('gonzalez'), ('drummer1'), ('private1'), ('cornwall'), ('christopher'), ('corvet07'), ('iverson3'),
  ('bluesman'), ('terminat'), ('johnson1'), ('bastards'), ('fuckoff1'), ('doomsday'), ('pornking'), ('bookworm'),
  ('highbury'), ('mischief'), ('ministry'), ('bigbooty'), ('yogibear'), ('september'), ('lkjhgfds'), ('123123123'),
  ('carpedie'), ('foxylady'), ('gatorade'), ('valdepen'), ('deadpool'), ('hotmail1'), ('kordell1'), ('vvvvvvvv'),
  ('jackson5'), ('bergkamp'), ('zanzibar'), ('services'), ('sheridan'), ('checkers'), ('luv2epus'), ('rainbow6'),
  ('qwerty123'), ('commande'), ('nightwin'), ('hotmail0'), ('enternow'), ('viewsoni'), ('berkeley'), ('woodstoc'),
  ('starstar'), ('patience'), ('hawaii50'), ('gorgeous'), ('challeng'), ('callisto'), ('firewall'), ('firefire'),
  ('passmast'), ('transfer'), ('clarissa'), ('moonshin'), ('jakejake'), ('bluejays'), ('southpark'), ('tomahawk'),
  ('leedsutd'), ('jermaine'), ('jeepster'), ('josephin'), ('matthias'), ('marriage'), ('antelope'), ('cabernet'),
  ('cheshire'), ('california'), ('fuckhead'), ('dominion'), ('trucking'), ('nostromo'), ('honolulu'), ('dynamite'),
  ('mollydog'), ('windows1'), ('washburn'), ('vincent1'), ('irishman'), ('bearcats'), ('sylveste'), ('marijuan'),
  ('reddwarf'), ('12312312'), ('hardball'), ('goldfing'), ('chambers'), ('fandango'), ('festival'), ('scrapper'),
  ('cromwell'), ('entrance'), ('klondike'), ('mohammed'), ('insomnia'), ('24682468'), ('24242424'), ('billbill'),
  ('blessing'), ('solitude'), ('pimpdadd'), ('johndeer'), ('babylove'), ('barbados'), ('carpente'), ('fishbone'),
  ('fireblad'), ('scissors'), ('screamer'), ('obsidian'), ('progress'), ('tottenham'), ('comanche'), ('monsters'),
  ('veronika'), ('20202020'), ('blueball'), ('yankees2'), ('wrestler'), ('sealteam'), ('sidekick'), ('smackdow'),
  ('sporting'), ('remingto'), ('arkansas'), ('andersen'), ('barcelona'), ('baltimor'), ('fortress'), ('fishfish'),
  ('firefigh'), ('rsalinas'), ('dontknow'), ('universa'), ('heinrich'), ('enforcer'), ('katherine'), ('waterboy'),
  ('23skidoo'), ('zildjian'), ('stoppedby'), ('sexybabe'), ('speakers'), ('polopolo'), ('perfect1'), ('thrasher'),
  ('lakeside'), ('masamune'), ('cherries'), ('chipmunk'), ('cezer121'), ('carnival'), ('fearless'), ('funstuff'),
  ('salasana'), ('pantera1'), ('qwert123'), ('creation'), ('nascar24'), ('estrella'), ('erection'), ('ericsson'),
  ('internal'), ('1michael'), ('19781978'), ('25252525'), ('sheepdog'), ('snowbird'), ('toriamos'), ('tennesse'),
  ('mazdarx7'), ('revolver'), ('babycake'), ('hallowee'), ('cannabis'), ('dolemite'), ('dodgers1'), ('painting'),
  ('coventry'), ('christmas'), ('cocksucker'), ('hotgirls'), ('eggplant'), ('mustang6'), ('monkey12'), ('wapapapa'),
  ('volleyba'), ('birthday4'), ('stephen1'), ('suburban'), ('soccer10'), ('something'), ('starcraft'), ('soccer12'),
  ('plastics'), ('penthous'), ('peterbil'), ('lakewood'), ('reginald'), ('goodgirl'), ('gotyoass'), ('capricor'),
  ('getmoney'), ('godfather'), ('gilligan'), ('dudedude'), ('pasadena'), ('opendoor'), ('magellan'), ('printing'),
  ('pressure'), ('killkill'), ('whiteboy'), ('voyager1'), ('jackjack'), ('success1'), ('spongebo'), ('phialpha'),
  ('password9'), ('tickling'), ('lexingky'), ('redheads'), ('apple123'), ('backbone'), ('aviation'), ('green123'),
  ('carlitos'), ('cartman1'), ('camaross'), ('favorite6'), ('ginscoot'), ('sabrina1'), ('devil666'), ('doughnut'),
  ('paintball'), ('rainbow1'), ('umbrella'), ('abc12345'), ('complete'), ('deerhunt'), ('darklord'), ('holidays'),
  ('hetfield'), ('hillbill'), ('hugetits'), ('evolutio'), ('whiplash'), ('wg8e3wjf'), ('istanbul'), ('bluebell'),
  ('wrestling'), ('superior'), ('suckdick'), ('stephane'), ('playball'), ('marcello'), ('marjorie'), ('rockwell'),
  ('baritone'), ('gladiator'), ('cricket1'), ('clemente'), ('exchange'), ('kisskiss'), ('kristian'), ('montecar'),
  ('mississi'), ('washington'), ('20012001'), ('bigdick1'), ('penguin1'), ('pathfind'), ('testibil'), ('lightning'),
  ('lighting'), ('republic'), ('anthony7'), ('goldeney'), ('cameron1'), ('freefree'), ('screwyou'), ('passthie'),
  ('postov1000'), ('puppydog'), ('a1234567'), ('cleopatr'), ('contract'), ('buffalo1'), ('bordeaux'), ('sunlight'),
  ('sprinter'), ('peaches1'), ('pinetree'), ('theforce'), ('jupiter1'), ('mckenzie'), ('annmarie'), ('austin31'),
  ('78945612'), ('calimero'), ('chevrolet'), ('favorite'), ('fellatio'), ('f00tball'), ('francine'), ('gateway2'),
  ('gamecube'), ('giovanna'), ('scheisse'), ('offshore'), ('macaroni'), ('pringles'), ('trouble1'), ('coolhand'),
  ('colonial'), ('darthvad'), ('cygnusx1'), ('natalie1'), ('eighteen'), ('elcamino'), ('blueberr'), ('yamahar1'),
  ('stafford'), ('snowboard'), ('speedway'), ('playboy2'), ('toonarmy'), ('mariposa'), ('baberuth'), ('gonzales'),
  ('chiquita'), ('charisma'), ('capslock'), ('cashmone'), ('gizmodo1'), ('dragonfl'), ('rachelle'), ('tropical'),
  ('crescent'), ('nathanie'), ('espresso'), ('kikimora'), ('20002000'), ('birthday1'), ('beatles1'), ('bigdicks'),
  ('beethove'), ('blacklab'), ('woodwork'), ('survivor'), ('pinnacle'), ('lemonade'), ('lalakers'), ('lebowski'),
  ('lalalala'), ('mercury1'), ('rocknrol'), ('riversid'), ('11112222'), ('alleycat'), ('ambrosia'), ('australia'),
  ('hattrick'), ('cassandr'), ('charlie123'), ('fighting'), ('gabriela'), ('outoutout'), ('pussy123'), ('randolph'),
  ('coldplay'), ('novifarm'), ('notredam'), ('honeybee'), ('wednesda'), ('waterfal'), ('billabon'), ('zachary1'),
  ('01234567'), ('superstar'), ('stiletto'), ('sigmachi'), ('somerset'), ('smithers'), ('playmate'), ('pinkfloyd'),
  ('laetitia'), ('revoluti'), ('archange'), ('handball'), ('chewbacc'), ('fullback'), ('dominiqu'), ('mandrake'),
  ('vagabond'), ('csfbr5yy'), ('deadspin'), ('ncc74656'), ('houston1'), ('hurricane'), ('horseman'), ('virginie'),
  ('idontknow'), ('151nxjmt'), ('bendover'), ('surprise'), ('supernov'), ('phantom1'), ('playoffs'), ('johngalt'),
  ('maserati'), ('riffraff'), ('architec'), ('cambridg'), ('foreplay'), ('sanity72'), ('salesman'), ('dreaming'),
  ('palmtree'), ('luckyone'), ('treefrog'), ('usmarine'), ('darkange'), ('cyclones'), ('bubba123'), ('building'),
  ('eclipse1'), ('kayleigh'), ('mustang2'), ('bigtruck'), ('yeahyeah'), ('stickman'), ('skipper1'), ('singapor'),
  ('southpaw'), ('slamdunk'), ('therock1'), ('tiger123'), ('mccarthy'), ('13576479'), ('greywolf'), ('candyass'),
  ('catfight'), ('frankie1'), ('qazwsxedc'), ('pregnant'), ('death666'), ('negative'), ('hooligan'), ('everlast'),
  ('mulligan'), ('motocros'), ('waterman'), ('inspiron'), ('bigblack'), ('zaq1xsw2'), ('yy5rbfsc'), ('takehana'),
  ('skydiver'), ('special1'), ('slimshad'), ('sopranos'), ('patches1'), ('thething'), ('mash4077'), ('matchbox'),
  ('14789632'), ('amethyst'), ('baseball1'), ('greenman'), ('goofball'), ('castillo'), ('capitals'), ('favorite2'),
  ('forsaken'), ('feelgood'), ('gfxqx686'), ('dilbert1'), ('dukeduke'), ('downhill'), ('longhair'), ('lockdown'),
  ('mamacita'), ('rainyday'), ('pumpkin1'), ('prospect'), ('rainbows'), ('trinity1'), ('trooper1'), ('citation'),
  ('bukowski'), ('bubbles1'), ('humphrey'), ('kcchiefs'), ('morticia'), ('montrose'), ('154ugeiu'), ('year2005'),
  ('wonderfu'), ('tampabay'), ('slapnuts'), ('spartan1'), ('sprocket'), ('sometime'), ('stanley1'), ('thinking'),
  ('lavalamp'), ('laserjet'), ('jediknig'), ('mazda626'), ('alexandra'), ('hairball'), ('graduate'), ('cartoons'),
  ('cashflow'), ('outsider'), ('mallrats'), ('primetime21'), ('valleywa'), ('abcdefg1'), ('natedogg'), ('nineball'),
  ('normandy'), ('nicetits'), ('buddy123'), ('highlife'), ('earthlin'), ('eatmenow'), ('kirkland'), ('money123'),
  ('warhamme'), ('instinct'), ('jackass1'), ('20spanks'), ('blackjack'), ('085tzzqi'), ('383pdjvl'), ('sparhawk'),
  ('pavement'), ('johnston'), ('material'), ('melanie1'), ('redlight'), ('aolsucks'), ('alexalex'), ('b929ezzh'),
  ('goodyear'), ('griffith'), ('863abgsg'), ('carebear'), ('checkmat'), ('forgetit'), ('rushmore'), ('question'),
  ('ptfe3xxp'), ('prophecy'), ('aircraft'), ('access99'), ('cocktail'), ('civilwar'), ('cleveland'), ('claudia1'),
  ('dapzu455'), ('daisydog'), ('eldiablo'), ('kingrich'), ('mudvayne'), ('vipergts'), ('italiano'), ('innocent'),
  ('yqlgr667'), ('zxcvbnm1'), ('suckcock'), ('stephens'), ('380zliki'), ('sexylady'), ('sixtynin'), ('sleeping'),
  ('sparkles'), ('letsdoit'), ('landmark'), ('marauder'), ('register'), ('basebal1'), ('azertyui'), ('hawkwind'),
  ('capetown'), ('flathead'), ('fisherma'), ('flipmode'), ('gabriel1'), ('dreamcas'), ('dirtydog'), ('dickdick'),
  ('destiny1'), ('trumpet1'), ('aaaaaaa1'), ('conquest'), ('creepers'), ('constant'), ('cornhole'), ('nirvana1'),
  ('elisabet'), ('musician'), ('milamber'), ('isacs155'), ('1million'), ('1letmein'), ('stonewal'), ('sexsexsex'),
  ('sonysony'), ('smirnoff'), ('pentagon'), ('paulpaul'), ('lighthou'), ('letmein22'), ('letmesee'), ('merchant'),
  ('redstorm'), ('14141414'), ('allison1'), ('basement'), ('hartford'), ('hardwood'), ('fatluvr69'), ('fidelity'),
  ('feathers'), ('gogators'), ('general1'), ('dragon69'), ('dragonball'), ('papillon'), ('optimist'), ('longshot'),
  ('undertow'), ('copenhag'), ('delldell'), ('culinary'), ('ibilltes'), ('hihje863'), ('envelope'), ('express1'),
  ('mustang5'), ('wellingt'), ('waterski'), ('infinite'), ('iloveyou!'), ('063dyjuy'), ('survival'), ('stockton'),
  ('softtail'), ('slimed123'), ('pizzaman'), ('pathetic'), ('tigercat'), ('jennings'), ('rootedit'), ('riverrat'),
  ('atreides'), ('happines'), ('chadwick'), ('ffvdj474'), ('foreskin'), ('gameover'), ('scoobydoo'), ('saxophon'),
  ('macintos'), ('lollypop'), ('qwertzui'), ('adelaide'), ('acapulco'), ('cybersex'), ('davecole'), ('davedave'),
  ('nineteen'), ('highlander'), ('kristin1'), ('knuckles'), ('katarina'), ('montana1'), ('wingchun'), ('watching'),
  ('illmatic'), ('bigpenis'), ('blue1234'), ('xxxxxxx1'), ('svetlana'), ('368ejhih'), ('playstation'), ('pescator'),
  ('jo9k2jw2'), ('jupiter2'), ('jurassic'), ('marines1'), ('14725836'), ('12345679'), ('alessand'), ('angelika'),
  ('alpha123'), ('barefeet'), ('badabing'), ('gsxr1000'), ('gregory1'), ('766rglqy'), ('69camaro'), ('calendar'),
  ('fishcake'), ('giuseppe'), ('gnasher23'), ('fuzzball'), ('save13tx'), ('russell1'), ('dripping'), ('dragon12'),
  ('dragster'), ('mainland'), ('poophead'), ('porn4life'), ('producer'), ('rapunzel'), ('velocity'), ('vanessa1'),
  ('trueblue'), ('vampire1'), ('navyseal'), ('nightowl'), ('nonenone'), ('nightmar'), ('bulletin'), ('hillside'),
  ('hzze929b'), ('hellohel'), ('edgewise'), ('embalmer'), ('excalibur'), ('mounta1n'), ('muffdive'), ('vivitron'),
  ('winfield'), ('wednesday'), ('17171717'), ('17011701'), ('tangerin'), ('stewart1'), ('summer69'), ('sweetness'),
  ('surveyor'), ('stirling'), ('ssptx452'), ('thriller'), ('master12'), ('anastasi'), ('almighty'), ('argentin'),
  ('flanders'), ('flyers88'), ('firehawk'), ('flashman'), ('godspeed'), ('giveitup'), ('funtimes'), ('frenchie'),
  ('disaster'), ('lovelife'), ('qcmfd454'), ('undertaker'), ('911turbo'), ('cristian'), ('daughter'), ('notebook'),
  ('borabora'), ('brisbane'), ('mohammad'), ('bettyboo'), ('blackice'), ('yvtte545'), ('tailgate'), ('shitshit'),
  ('sooners1'), ('smartass'), ('pennywis'), ('thetruth'), ('reindeer'), ('allstate'), ('greatest'), ('caldwell'),
  ('fussball'), ('geneviev'), ('samadams'), ('dipstick'), ('losangel'), ('loverman'), ('pussy4me'), ('university'),
  ('troubles'), ('churchil'), ('crazyman'), ('cutiepie'), ('bullwink'), ('bulldawg'), ('horsemen'), ('escalade'),
  ('minnesot'), ('moonlight'), ('mwq6qlzo'), ('verygood'), ('bellagio'), ('sickness'), ('skeeter1'), ('phaedrus'),
  ('thumper1'), ('tmjxn151'), ('thematri'), ('letmeinn'), ('jeffjeff'), ('johnmish'), ('11001001'), ('allnight'),
  ('amatuers'), ('attorney'), ('happyman'), ('graywolf'), ('474jdvff'), ('551scasi'), ('fishtank'), ('freewill'),
  ('glendale'), ('frogfrog'), ('gerhardt'), ('scirocco'), ('devilman'), ('pallmall'), ('lunchbox'), ('manhatta'),
  ('mandarin'), ('pxx3eftp'), ('president'), ('chris123'), ('daedalus'), ('natasha1'), ('nancy123'), ('nevermin'),
  ('newcastle'), ('edmonton'), ('monterey'), ('violator'), ('wildstar'), ('winter99'), ('iqzzt580'), ('19741974'),
  ('1q2w3e4r5t'), ('bigbucks'), ('blackcoc'), ('yesterda'), ('skinhead'), ('shadow12'), ('snapshot'), ('soccer11'),
  ('pleasant'), ('pimpdaddy'), ('lionhear'), ('littlema'), ('lincoln1'), ('laughing'), ('redshift'), ('12locked'),
  ('arizona1'), ('alfarome'), ('hawthorn'), ('goodfell'), ('554uzpad'), ('flipflop'), ('garrison'), ('rustydog'),
  ('sandberg'), ('samsung1'), ('dreamer1'), ('detectiv'), ('dominick'), ('paladin1'), ('papabear'), ('panasonic'),
  ('nyyankee'), ('pussyeat'), ('princeto'), ('climbing'), ('dad2ownu'), ('daredevi'), ('necklace'), ('huskers1'),
  ('hornyman'), ('england1'), ('motherfucker'), ('ilovegod'), ('201jedlz'), ('wrinkle5'), ('zoomzoom'), ('09876543'),
  ('starlite'), ('peternorth'), ('jeepjeep'), ('joystick'), ('junkmail'), ('jojojojo'), ('rockrock'), ('rasta220'),
  ('andyandy'), ('auckland'), ('gooseman'), ('happydog'), ('charlie2'), ('cardinals'), ('fortune12'), ('generals'),
  ('division'), ('ozlq6qwm'), ('macgyver'), ('mallorca'), ('prelude1'), ('trousers'), ('aerosmit'), ('clueless'),
  ('delpiero'), ('nounours'), ('buckaroo'), ('honeydew'), ('hooters1'), ('hugohugo'), ('evangeli')
  ) AS v(p)
 WHERE char_length(v.p) >= 8
   AND octet_length(v.p) <= 72
ON CONFLICT (password) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. check_password_policy: a política sem gravar nada (RN-07, AQ-8). Chamada
--    pela create-user-admin antes de criar a conta. Definer porque a lista
--    não tem privilégio nem para service_role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_password_policy(
  _password   text,
  _cpf        text,
  _mobile     text,
  _birth_date date,
  _email      text
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.password_policy_violation(_password, _cpf, _mobile, _birth_date, _email)
$$;

REVOKE ALL ON FUNCTION public.check_password_policy(text, text, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_password_policy(text, text, text, date, text) TO service_role;
