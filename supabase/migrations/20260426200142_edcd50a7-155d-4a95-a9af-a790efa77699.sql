CREATE OR REPLACE FUNCTION public.enforce_cell_report_current_week()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _today date;
  _week_start date;
  _week_end date;
BEGIN
  _today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _week_start := _today - ((EXTRACT(DOW FROM _today))::int);
  _week_end := _week_start + 6;

  IF NEW.date < _week_start OR NEW.date > _week_end THEN
    RAISE EXCEPTION 'A data do relatório deve estar dentro da semana atual (% a %).', _week_start, _week_end
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_cell_report_current_week_trigger ON public.cell_reports;

CREATE TRIGGER enforce_cell_report_current_week_trigger
BEFORE INSERT OR UPDATE OF date ON public.cell_reports
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cell_report_current_week();