-- 1. Create the new columns
ALTER TABLE public.members ADD COLUMN total_disciples INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.members ADD COLUMN total_cells INTEGER NOT NULL DEFAULT 0;

-- 2. Create the function that will recount and update the members table
CREATE OR REPLACE FUNCTION refresh_member_stats_trigger()
RETURNS trigger AS $$
BEGIN
  -- Prevent trigger loop by checking if it's already running in the current context
  -- (Since we do an UPDATE on the members table itself inside this function)
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  WITH RECURSIVE subordinates AS (
    -- Base case: all members with their immediate leader
    SELECT id, leader_id, id AS root_id
    FROM public.members
    UNION ALL
    -- Recursive step: find subordinates of subordinates
    SELECT m.id, m.leader_id, s.root_id
    FROM public.members m
    INNER JOIN subordinates s ON m.leader_id = s.id
  ),
  disciple_counts AS (
    -- Count total descendants for each root_id
    -- We subtract 1 so we don't count the root member itself
    SELECT root_id, COUNT(id) - 1 AS calc_total_disciples
    FROM subordinates
    GROUP BY root_id
  ),
  cell_counts AS (
    -- Count total cells for each leader
    SELECT leader_id, COUNT(id) AS calc_total_cells
    FROM public.cells
    WHERE leader_id IS NOT NULL
    GROUP BY leader_id
  )
  -- Update ONLY members whose counts changed to avoid massive unnecessary writes
  UPDATE public.members m
  SET 
    total_disciples = COALESCE(d.calc_total_disciples, 0),
    total_cells = COALESCE(c.calc_total_cells, 0)
  FROM disciple_counts d
  LEFT JOIN cell_counts c ON d.root_id = c.leader_id
  WHERE m.id = d.root_id 
    AND (
      m.total_disciples IS DISTINCT FROM COALESCE(d.calc_total_disciples, 0) 
      OR m.total_cells IS DISTINCT FROM COALESCE(c.calc_total_cells, 0)
    );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3. Create the Database Triggers
-- Note: We use FOR EACH STATEMENT so the recalculation happens once at the end of the query (e.g. batch insert), instead of once per row!

CREATE TRIGGER refresh_stats_on_member_change
AFTER INSERT OR UPDATE OR DELETE ON public.members
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_member_stats_trigger();

CREATE TRIGGER refresh_stats_on_cell_change
AFTER INSERT OR UPDATE OR DELETE ON public.cells
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_member_stats_trigger();

-- 4. Initial calculation (to populate the table existing data immediately instead of waiting for a change)
-- We simulate a fake empty query or just run the update logic once manually inside an anonymous block
DO $$ 
BEGIN
  -- We just manually invoke the logic once for existing rows
  WITH RECURSIVE subordinates AS (
    SELECT id, leader_id, id AS root_id
    FROM public.members
    UNION ALL
    SELECT m.id, m.leader_id, s.root_id
    FROM public.members m
    INNER JOIN subordinates s ON m.leader_id = s.id
  ),
  disciple_counts AS (
    SELECT root_id, count(id) - 1 AS calc_total_disciples
    FROM subordinates
    GROUP BY root_id
  ),
  cell_counts AS (
    SELECT leader_id, count(id) AS calc_total_cells
    FROM public.cells
    WHERE leader_id IS NOT NULL
    GROUP BY leader_id
  )
  UPDATE public.members m
  SET 
    total_disciples = COALESCE(d.calc_total_disciples, 0),
    total_cells = COALESCE(c.calc_total_cells, 0)
  FROM disciple_counts d
  LEFT JOIN cell_counts c ON d.root_id = c.leader_id
  WHERE m.id = d.root_id 
    AND (
      m.total_disciples IS DISTINCT FROM COALESCE(d.calc_total_disciples, 0) 
      OR m.total_cells IS DISTINCT FROM COALESCE(c.calc_total_cells, 0)
    );
END $$;
