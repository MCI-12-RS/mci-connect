-- E2.09 (PR 1): a regra pura da situação do relatório, por tabela, sem dados.
-- Spec: docs/specs/e2-09-situacao-relatorio.md (repositório apps-mci), "A regra (migration 2)",
-- "Verificações obrigatórias (para o QA)" (e209_02); RN-01, RN-02, RN-04 a RN-07, RN-10; DA-1, DA-3, DA-5, DA-6.
--
-- Cada linha da tabela de casos traz o momento em Brasília, o dia (weekday_index), o horário, as
-- semanas com relatório, o was_held da semana, o histórico de períodos ativos e o resultado esperado.
-- A tabela roda três vezes: com a sessão em UTC, em America/Sao_Paulo e em Asia/Tokyo. Os
-- históricos são escritos com o deslocamento explícito (-03), então o fuso da sessão não muda nada.
--
-- Convenções do spec: "hoje" é terça, 24/11/2026; a semana atual vai de 22/11 a 28/11; a semana
-- passada, de 15/11 a 21/11. Massa: C1 quarta 20:00; C2 quarta 20:00; C3 sexta 23:30; C4 sábado
-- 23:30; C5 segunda 19:30 (relatório "não houve" nesta semana); C6 quinta 20:00 (cadastrada em
-- 01/11 às 10:00, sem relatório); C7 terça 20:00 (inativa desde 01/09); C8 quarta 19:00 (excluída em
-- 10/11 quando ativa, último relatório em 04/11); C9 quarta 19:30 (último relatório em 04/11);
-- C10 quarta 20:00 (cadastrada na quinta, 26/11, às 10:00).
-- Autocontido, termina com ROLLBACK. Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(19);

-- Período "desde X" e "de X até Y", em hora de Brasília (-03 explícito).
CREATE FUNCTION pg_temp.since(_from text) RETURNS tstzmultirange LANGUAGE sql IMMUTABLE AS
$$ SELECT tstzmultirange(tstzrange((_from || '-03')::timestamptz, NULL)) $$;
CREATE FUNCTION pg_temp.span(_from text, _to text) RETURNS tstzmultirange LANGUAGE sql IMMUTABLE AS
$$ SELECT tstzmultirange(tstzrange(CASE WHEN _from IS NULL THEN NULL ELSE (_from || '-03')::timestamptz END,
                                   (_to || '-03')::timestamptz)) $$;

-- Semanas (domingos): W0 = 22/11, W1 = 15/11, W2 = 08/11, W3 = 01/11, W4 = 25/10, W5 = 18/10.
CREATE TEMP TABLE cases (
  label      text PRIMARY KEY,
  at_local   timestamp NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  weekday    integer,
  mtime      time,
  weeks      date[] NOT NULL DEFAULT '{}',
  held       boolean,
  periods    tstzmultirange,
  exp_status public.cell_report_status,
  exp_weeks  smallint
);

INSERT INTO cases (label, at_local, is_active, weekday, mtime, weeks, held, periods, exp_status, exp_weeks) VALUES
  -- RN-04 (quinta, 26/11, 10:00, lista de Rita)
  ('RN-04 C1 quinta 10:00',  '2026-11-26 10:00', true, 3, '20:00', '{2026-11-15,2026-11-08,2026-11-01,2026-10-25,2026-10-18}', NULL, '{(,)}', 'pending', 0),
  ('RN-04 C2 quinta 10:00',  '2026-11-26 10:00', true, 3, '20:00', '{2026-11-15}', NULL, '{(,)}', 'pending', 0),
  ('RN-04 C3 quinta 10:00',  '2026-11-26 10:00', true, 5, '23:30', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-04 C4 quinta 10:00',  '2026-11-26 10:00', true, 6, '23:30', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-04 C5 quinta 10:00',  '2026-11-26 10:00', true, 1, '19:30', '{2026-11-22}', false, '{(,)}', 'sent_not_held', 0),
  ('RN-04 C6 quinta 10:00',  '2026-11-26 10:00', true, 4, '20:00', '{}', NULL, pg_temp.since('2026-11-01 10:00'), 'not_yet', 3),
  ('RN-04 C9 quinta 10:00',  '2026-11-26 10:00', true, 3, '19:30', '{2026-11-01}', NULL, '{(,)}', 'pending', 2),
  ('RN-01 C7 inativa',       '2026-11-26 10:00', false, 2, '20:00', '{}', NULL, pg_temp.span(NULL, '2026-09-01 00:00'), NULL, NULL),
  -- RN-09 (terça, 24/11, 10:00, lista de Pedro)
  ('RN-09 C1 terça 10:00',   '2026-11-24 10:00', true, 3, '20:00', '{2026-11-15,2026-11-08}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-09 C3 terça 10:00',   '2026-11-24 10:00', true, 5, '23:30', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-09 C6 terça 10:00',   '2026-11-24 10:00', true, 4, '20:00', '{}', NULL, pg_temp.since('2026-11-01 10:00'), 'not_yet', 3),
  ('RN-09 C9 terça 10:00',   '2026-11-24 10:00', true, 3, '19:30', '{2026-11-01}', NULL, '{(,)}', 'not_yet', 2),
  -- RN-02: prazo exato (horário + 1 hora) e viradas de dia e de semana
  ('RN-02 C1 quarta 20:59:59', '2026-11-25 20:59:59', true, 3, '20:00', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-02 C1 quarta 21:00',    '2026-11-25 21:00:00', true, 3, '20:00', '{2026-11-15}', NULL, '{(,)}', 'pending', 0),
  ('RN-02 C9 quarta 20:29',    '2026-11-25 20:29', true, 3, '19:30', '{2026-11-01}', NULL, '{(,)}', 'not_yet', 2),
  ('RN-02 C9 quarta 20:30',    '2026-11-25 20:30', true, 3, '19:30', '{2026-11-01}', NULL, '{(,)}', 'pending', 2),
  ('RN-02 C3 sexta 23:59',     '2026-11-27 23:59', true, 5, '23:30', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-02 C3 sábado 00:29',    '2026-11-28 00:29', true, 5, '23:30', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-02 C3 sábado 00:30',    '2026-11-28 00:30', true, 5, '23:30', '{2026-11-15}', NULL, '{(,)}', 'pending', 0),
  ('RN-02 C4 sábado 23:59:59', '2026-11-28 23:59:59', true, 6, '23:30', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-02 C4 domingo 00:00',   '2026-11-29 00:00', true, 6, '23:30', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 1),
  ('RN-02 C1 sábado 23:59:59', '2026-11-28 23:59:59', true, 3, '20:00', '{2026-11-15}', NULL, '{(,)}', 'pending', 0),
  ('RN-02 C1 domingo 00:00',   '2026-11-29 00:00', true, 3, '20:00', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 1),
  ('RN-02 C6 mudada para terça', '2026-11-26 10:00', true, 2, '20:00', '{}', NULL, pg_temp.since('2026-11-01 10:00'), 'pending', 3),
  ('RN-02 C1 mudada para sábado 19:00', '2026-11-26 10:00', true, 6, '19:00', '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  -- Risco 13 do E1.08: um relatório de uma semana posterior não conta (a leitura nem o traz)
  ('RN-02 risco 13 sexta 20/11', '2026-11-20 10:00', true, 3, '20:00', '{2026-11-22,2026-11-08}', NULL, '{(,)}', 'pending', 0),
  -- RN-05: 1, 2, 3 e "4 ou mais"; zero com relatório nesta semana
  ('RN-05 último em 11/11 (W2)', '2026-11-24 10:00', true, 3, '20:00', '{2026-11-08}', NULL, '{(,)}', 'not_yet', 1),
  ('RN-05 último em 04/11 (W3)', '2026-11-24 10:00', true, 3, '20:00', '{2026-11-01}', NULL, '{(,)}', 'not_yet', 2),
  ('RN-05 último em 28/10 (W4)', '2026-11-24 10:00', true, 3, '20:00', '{2026-10-25}', NULL, '{(,)}', 'not_yet', 3),
  ('RN-05 último em 21/10 (W5)', '2026-11-24 10:00', true, 3, '20:00', '{}', NULL, '{(,)}', 'not_yet', 4),
  ('RN-05 7 semanas sem relatório', '2026-11-24 10:00', true, 3, '20:00', '{}', NULL, pg_temp.since('2026-10-01 00:00'), 'not_yet', 4),
  ('RN-05 enviado zera',       '2026-11-24 10:00', true, 3, '20:00', '{2026-11-22}', true, '{(,)}', 'sent_held', 0),
  ('RN-05 C9 domingo 29/11',   '2026-11-29 10:00', true, 3, '19:30', '{2026-11-01}', NULL, '{(,)}', 'not_yet', 3),
  ('RN-05 C9 domingo 06/12',   '2026-12-06 10:00', true, 3, '19:30', '{2026-11-01}', NULL, '{(,)}', 'not_yet', 4),
  ('RN-05 C6 cadastrada sexta 06/11', '2026-11-24 10:00', true, 4, '20:00', '{}', NULL, pg_temp.since('2026-11-06 10:00'), 'not_yet', 2),
  ('RN-05 C1 relatório de 18/11 excluído', '2026-11-24 10:00', true, 3, '20:00', '{2026-11-08,2026-11-01}', NULL, '{(,)}', 'not_yet', 1),
  -- RN-06: célula nova, reativada, restaurada; DA-1 e DA-3
  ('RN-06 C10 quinta 10:00',   '2026-11-26 10:00', true, 3, '20:00', '{}', NULL, pg_temp.since('2026-11-26 10:00'), 'next_week', 0),
  ('RN-06 C10 domingo 29/11',  '2026-11-29 00:00', true, 3, '20:00', '{}', NULL, pg_temp.since('2026-11-26 10:00'), 'not_yet', 0),
  ('RN-06 C10 quinta 03/12',   '2026-12-03 10:00', true, 3, '20:00', '{}', NULL, pg_temp.since('2026-11-26 10:00'), 'pending', 0),
  ('RN-06 C10 com relatório de 25/11', '2026-11-26 10:30', true, 3, '20:00', '{2026-11-22}', true, pg_temp.since('2026-11-26 10:00'), 'sent_held', 0),
  ('RN-06 cadastrada segunda 23/11', '2026-11-25 21:00', true, 3, '20:00', '{}', NULL, pg_temp.since('2026-11-23 09:00'), 'pending', 0),
  ('RN-06 cadastrada 20:30',   '2026-11-25 21:00', true, 3, '20:00', '{}', NULL, pg_temp.since('2026-11-25 20:30'), 'pending', 0),
  ('DA-3 cadastrada 21:00 em ponto', '2026-11-25 21:00', true, 3, '20:00', '{}', NULL, pg_temp.since('2026-11-25 21:00'), 'pending', 0),
  ('RN-06 cadastrada 21:01',   '2026-11-25 21:05', true, 3, '20:00', '{}', NULL, pg_temp.since('2026-11-25 21:01'), 'next_week', 0),
  ('RN-06 C7 reativada terça 10:00', '2026-11-24 21:00', true, 2, '20:00', '{}', NULL,
     pg_temp.span(NULL, '2026-09-01 00:00') + pg_temp.since('2026-11-24 10:00'), 'pending', 0),
  ('RN-06 C7 reativada quarta 10:00', '2026-11-25 10:00', true, 2, '20:00', '{}', NULL,
     pg_temp.span(NULL, '2026-09-01 00:00') + pg_temp.since('2026-11-25 10:00'), 'next_week', 0),
  ('RN-06 C7 reativada quarta, domingo', '2026-11-29 10:00', true, 2, '20:00', '{}', NULL,
     pg_temp.span(NULL, '2026-09-01 00:00') + pg_temp.since('2026-11-25 10:00'), 'not_yet', 0),
  ('RN-06 C7 reativada quarta, terça 01/12 21:00', '2026-12-01 21:00', true, 2, '20:00', '{}', NULL,
     pg_temp.span(NULL, '2026-09-01 00:00') + pg_temp.since('2026-11-25 10:00'), 'pending', 0),
  ('RN-06 C1 inativada 10:05 e reativada 10:10', '2026-11-26 10:10', true, 3, '20:00', '{2026-11-15}', NULL,
     pg_temp.span(NULL, '2026-11-26 10:05') + pg_temp.since('2026-11-26 10:10'), 'pending', 0),
  ('RN-06 C1 inativada quarta 19:00, reativada quinta', '2026-11-26 10:00', true, 3, '20:00', '{2026-11-15}', NULL,
     pg_temp.span(NULL, '2026-11-25 19:00') + pg_temp.since('2026-11-26 10:00'), 'next_week', 0),
  ('RN-06 C8 restaurada quinta', '2026-11-26 10:00', true, 3, '19:00', '{2026-11-01}', NULL,
     pg_temp.span(NULL, '2026-11-10 10:00') + pg_temp.since('2026-11-26 10:00'), 'next_week', 0),
  ('RN-06 C8 restaurada terça', '2026-11-25 20:00', true, 3, '19:00', '{2026-11-01}', NULL,
     pg_temp.span(NULL, '2026-11-10 10:00') + pg_temp.since('2026-11-24 10:00'), 'pending', 0),
  ('RN-06 C6 com o horário mudado', '2026-11-24 10:00', true, 4, '19:00', '{}', NULL, pg_temp.since('2026-11-01 10:00'), 'not_yet', 3),
  ('DA-1 sábado 23:30 cadastrada domingo 00:05', '2026-11-29 00:10', true, 6, '23:30', '{}', NULL, pg_temp.since('2026-11-29 00:05'), 'not_yet', 0),
  ('DA-1 sábado 23:30 cadastrada sábado 23:45', '2026-11-29 00:10', true, 6, '23:30', '{}', NULL, pg_temp.since('2026-11-28 23:45'), 'not_yet', 1),
  -- RN-07: sem dia; sem horário
  ('RN-07 sem dia',            '2026-11-26 10:00', true, NULL, '20:00', '{}', NULL, '{(,)}', 'no_meeting_day', NULL),
  ('RN-07 quarta sem horário 23:59:59', '2026-11-25 23:59:59', true, 3, NULL, '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-07 quarta sem horário quinta 00:00', '2026-11-26 00:00', true, 3, NULL, '{2026-11-15}', NULL, '{(,)}', 'pending', 0),
  ('RN-07 sábado sem horário 23:59:59', '2026-11-28 23:59:59', true, 6, NULL, '{2026-11-15}', NULL, '{(,)}', 'not_yet', 0),
  ('RN-07 sábado sem horário domingo', '2026-11-29 00:00', true, 6, NULL, '{2026-11-15}', NULL, '{(,)}', 'not_yet', 1),
  -- RN-01 e DA-5
  ('RN-01 inativa com relatório', '2026-11-26 10:00', false, 3, '20:00', '{2026-11-22}', true, '{(,)}', NULL, NULL),
  ('DA-5 sem histórico nunca fica pendente', '2026-11-26 10:00', true, 3, '20:00', '{}', NULL, NULL, 'next_week', 0),
  -- RN-10
  ('RN-10 desde sempre sem relatório', '2026-11-24 10:00', true, 3, '20:00', '{}', NULL, '{(,)}', 'not_yet', 4),
  ('RN-10 cadastrada em 10/03/2023, último em 21/10', '2026-11-24 10:00', true, 3, '20:00', '{}', NULL,
     pg_temp.since('2023-03-10 00:00'), 'not_yet', 4);

-- Os casos que diferem do esperado (vazio = todos certos).
CREATE FUNCTION pg_temp.mismatches() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(format('%s: have (%s, %s) want (%s, %s)', k.label,
                                    r.report_status, r.report_missing_weeks, k.exp_status, k.exp_weeks), '; '
                             ORDER BY k.label), '')
    FROM pg_temp.cases k
    CROSS JOIN LATERAL private.report_situation_rule(k.at_local, k.is_active, k.weekday, k.mtime,
                                                     k.weeks, k.held, k.periods) r
   WHERE r.report_status IS DISTINCT FROM k.exp_status
      OR r.report_missing_weeks IS DISTINCT FROM k.exp_weeks
$$;

-- ---------------------------------------------------------------------------
-- 1. A tabela de casos nas três sessões de fuso — 4
-- ---------------------------------------------------------------------------
SELECT cmp_ok((SELECT count(*)::int FROM pg_temp.cases), '>=', 60, 'a tabela tem pelo menos 60 casos');
SET LOCAL timezone = 'UTC';
SELECT is(pg_temp.mismatches(), '', 'regra por tabela com a sessão em UTC');
SET LOCAL timezone = 'America/Sao_Paulo';
SELECT is(pg_temp.mismatches(), '', 'regra por tabela com a sessão em America/Sao_Paulo');
SET LOCAL timezone = 'Asia/Tokyo';
SELECT is(pg_temp.mismatches(), '', 'regra por tabela com a sessão em Asia/Tokyo');
RESET timezone;

-- ---------------------------------------------------------------------------
-- 2. Prazo (RN-02, RN-07) — 6
-- ---------------------------------------------------------------------------
SELECT is(private.report_deadline('2026-11-22', 3, '20:00'), '2026-11-25 21:00'::timestamp,
  'RN-02: quarta 20:00 → prazo quarta 21:00');
SELECT is(private.report_deadline('2026-11-22', 5, '23:30'), '2026-11-28 00:30'::timestamp,
  'RN-02: sexta 23:30 → prazo sábado 00:30 (vira o dia)');
SELECT is(private.report_deadline('2026-11-22', 6, '23:30'), '2026-11-29 00:30'::timestamp,
  'RN-02: sábado 23:30 → prazo domingo 00:30 (vira a semana)');
SELECT is(private.report_deadline('2026-11-22', 3, NULL), '2026-11-26 00:00'::timestamp,
  'RN-07: quarta sem horário → prazo quinta 00:00');
SELECT is(private.report_deadline('2026-11-22', 0, '00:00'), '2026-11-22 01:00'::timestamp,
  'RN-02: domingo 00:00 → prazo domingo 01:00');
SELECT is(private.report_deadline('2026-11-22', 6, NULL), '2026-11-29 00:00'::timestamp,
  'RN-07: sábado sem horário → prazo domingo 00:00 (fora da semana)');

-- ---------------------------------------------------------------------------
-- 3. A semana conta (RN-06; DA-1, DA-3, DA-5) — 6
-- ---------------------------------------------------------------------------
SET LOCAL timezone = 'Asia/Tokyo';
SELECT ok(private.report_week_counts('2026-11-22', 3, '20:00', pg_temp.since('2026-11-25 21:00')),
  'DA-3: cadastrada no prazo em ponto: a semana conta (período fechado no início)');
SELECT ok(NOT private.report_week_counts('2026-11-22', 3, '20:00', pg_temp.span(NULL, '2026-11-25 21:00')),
  'DA-3: inativada no prazo em ponto: a semana não conta (período aberto no fim)');
SELECT ok(NOT private.report_week_counts('2026-11-22', 3, '20:00', NULL), 'DA-5: sem histórico, nenhuma semana conta');
SELECT ok(NOT private.report_week_counts('2026-11-22', 3, '20:00', '{}'), 'RN-06: histórico vazio, nenhuma semana conta');
SELECT ok(private.report_week_counts('2026-11-22', 6, '23:30', pg_temp.span('2026-11-28 23:40', '2026-11-29 00:10')),
  'DA-1: prazo na semana seguinte: confere no domingo, 00:00');
SELECT ok(NOT private.report_week_counts('2026-11-22', 6, '23:30', pg_temp.since('2026-11-29 00:05')),
  'DA-1: cadastrada no domingo às 00:05, a semana anterior não conta');
RESET timezone;

-- ---------------------------------------------------------------------------
-- 4. Pureza e propriedades — 3
-- ---------------------------------------------------------------------------
SELECT is((SELECT array_agg(p.provolatile::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace = 'private'::regnamespace
              AND p.proname IN ('report_deadline', 'report_week_counts', 'report_situation_rule')),
  ARRAY['i', 'i', 'i'], 'a regra, o prazo e a semana que conta são IMMUTABLE');
SELECT is((SELECT array_agg(p.prosecdef ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace = 'private'::regnamespace
              AND p.proname IN ('report_deadline', 'report_week_counts', 'report_situation_rule')),
  ARRAY[false, false, false], 'a regra pura não é security definer');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.pronamespace = 'private'::regnamespace
                         AND p.proname IN ('report_deadline', 'report_week_counts', 'report_situation_rule')
                         AND p.prosrc ~* '\m(from|join)\s+(public|private)\.'),
  'a regra pura não lê tabela nenhuma');

SELECT * FROM finish();
ROLLBACK;
