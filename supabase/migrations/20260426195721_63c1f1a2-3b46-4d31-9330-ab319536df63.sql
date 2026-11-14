CREATE OR REPLACE FUNCTION public.enforce_unique_weekly_cell_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _week_start date;
  _week_end date;
  _exists boolean;
BEGIN
  -- Week: Sunday (start) through Saturday (end)
  _week_start := NEW.date - ((EXTRACT(DOW FROM NEW.date))::int);
  _week_end := _week_start + 6;

  SELECT EXISTS (
    SELECT 1 FROM public.cell_reports
    WHERE cell_id = NEW.cell_id
      AND date >= _week_start
      AND date <= _week_end
      AND (TG_OP = 'INSERT' OR id <> NEW.id)
  ) INTO _exists;

  IF _exists THEN
    RAISE EXCEPTION 'Já existe um relatório para esta célula nesta semana (% a %).', _week_start, _week_end
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_unique_weekly_cell_report_trigger ON public.cell_reports;

CREATE TRIGGER enforce_unique_weekly_cell_report_trigger
BEFORE INSERT OR UPDATE OF cell_id, date ON public.cell_reports
FOR EACH ROW
EXECUTE FUNCTION public.enforce_unique_weekly_cell_report();