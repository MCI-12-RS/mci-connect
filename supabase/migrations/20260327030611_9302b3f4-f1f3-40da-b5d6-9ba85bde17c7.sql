
ALTER TABLE public.members
ADD COLUMN IF NOT EXISTS total_disciples integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_cells integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recount_disciples()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.leader_id IS NOT NULL THEN
    UPDATE members SET total_disciples = (
      SELECT count(*) FROM members WHERE leader_id = OLD.leader_id
    ) WHERE id = OLD.leader_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.leader_id IS NOT NULL THEN
    UPDATE members SET total_disciples = (
      SELECT count(*) FROM members WHERE leader_id = NEW.leader_id
    ) WHERE id = NEW.leader_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.recount_cells()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected_ids uuid[];
BEGIN
  affected_ids := ARRAY[]::uuid[];
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF OLD.leader_id IS NOT NULL THEN affected_ids := affected_ids || OLD.leader_id; END IF;
    IF OLD.timothy_id IS NOT NULL THEN affected_ids := affected_ids || OLD.timothy_id; END IF;
    IF OLD.host_id IS NOT NULL THEN affected_ids := affected_ids || OLD.host_id; END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.leader_id IS NOT NULL THEN affected_ids := affected_ids || NEW.leader_id; END IF;
    IF NEW.timothy_id IS NOT NULL THEN affected_ids := affected_ids || NEW.timothy_id; END IF;
    IF NEW.host_id IS NOT NULL THEN affected_ids := affected_ids || NEW.host_id; END IF;
  END IF;
  UPDATE members m SET total_cells = (
    SELECT count(*) FROM cells c
    WHERE c.leader_id = m.id OR c.timothy_id = m.id OR c.host_id = m.id
  )
  WHERE m.id = ANY(affected_ids);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_recount_disciples
AFTER INSERT OR UPDATE OF leader_id OR DELETE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.recount_disciples();

CREATE TRIGGER trg_recount_cells
AFTER INSERT OR UPDATE OF leader_id, timothy_id, host_id OR DELETE ON public.cells
FOR EACH ROW EXECUTE FUNCTION public.recount_cells();

-- Use replica role to skip FK triggers and user triggers during backfill
SET session_replication_role = replica;

UPDATE members m SET total_disciples = (
  SELECT count(*) FROM members d WHERE d.leader_id = m.id
);

UPDATE members m SET total_cells = (
  SELECT count(*) FROM cells c WHERE c.leader_id = m.id OR c.timothy_id = m.id OR c.host_id = m.id
);

SET session_replication_role = DEFAULT;
