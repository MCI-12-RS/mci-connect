CREATE OR REPLACE FUNCTION refresh_member_stats_trigger()
RETURNS trigger AS $$
BEGIN
  -- 1. Prevent trigger execution loop explicitly
  IF current_setting('my_app.refreshing_stats', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- 2. Mark that we are currently refreshing
  PERFORM set_config('my_app.refreshing_stats', 'true', true);

  -- 3. Run the protected recursive query
  WITH RECURSIVE subordinates AS (
    -- Base case: all members with their immediate leader
    SELECT id, leader_id, id AS root_id, ARRAY[id] AS path
    FROM public.members
    UNION ALL
    -- Recursive step: find subordinates of subordinates
    SELECT m.id, m.leader_id, s.root_id, s.path || m.id
    FROM public.members m
    INNER JOIN subordinates s ON m.leader_id = s.id
    -- STOP INFINITE LOOP if cycle is detected in the specific path
    WHERE NOT m.id = ANY(s.path)
  ),
  disciple_counts AS (
    SELECT root_id, COUNT(id) - 1 AS calc_total_disciples
    FROM subordinates
    GROUP BY root_id
  ),
  cell_counts AS (
    SELECT leader_id, COUNT(id) AS calc_total_cells
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

  -- 4. Unmark flag
  PERFORM set_config('my_app.refreshing_stats', 'false', true);
  
  RETURN NULL;
EXCEPTION 
  WHEN OTHERS THEN
    -- Ensure we unmark even if an error occurs
    PERFORM set_config('my_app.refreshing_stats', 'false', true);
    RAISE;
END;
$$ LANGUAGE plpgsql;
