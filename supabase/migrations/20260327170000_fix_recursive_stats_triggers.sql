-- 1. DROP EXISTING CONFLICTING TRIGGERS AND FUNCTIONS
-- We drop everything from previous attempts to ensure a clean state.
DROP TRIGGER IF EXISTS trg_recount_disciples ON public.members;
DROP TRIGGER IF EXISTS trg_recount_cells ON public.cells;
DROP FUNCTION IF EXISTS public.recount_disciples();
DROP FUNCTION IF EXISTS public.recount_cells();
DROP TRIGGER IF EXISTS refresh_stats_on_member_change ON public.members;
DROP TRIGGER IF EXISTS refresh_stats_on_cell_change ON public.cells;
DROP FUNCTION IF EXISTS public.refresh_member_stats_trigger();
DROP TRIGGER IF EXISTS trg_refresh_stats_members ON public.members;
DROP TRIGGER IF EXISTS trg_refresh_stats_cells ON public.cells;
DROP FUNCTION IF EXISTS public.refresh_member_stats_v2();

-- 2. CREATE REFINED UNIFIED REFRESH FUNCTION
-- This version uses session-based loop protection and properly aggregates 
-- both own cells and disciples' cells recursively.
CREATE OR REPLACE FUNCTION public.refresh_member_stats_v2()
RETURNS trigger AS $$
DECLARE
    affected_member_ids uuid[] := '{}';
    ancestor_ids uuid[] := '{}';
BEGIN
    -- Protection using session config (more reliable than trigger depth)
    IF current_setting('my_app.refreshing_stats', true) = 'true' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Collect directly affected members
    IF TG_TABLE_NAME = 'members' THEN
        IF (TG_OP = 'INSERT') THEN
            affected_member_ids := ARRAY[NEW.id];
            IF NEW.leader_id IS NOT NULL THEN affected_member_ids := affected_member_ids || NEW.leader_id; END IF;
        ELSIF (TG_OP = 'UPDATE') THEN
            affected_member_ids := ARRAY[NEW.id];
            IF NEW.leader_id IS NOT NULL THEN affected_member_ids := affected_member_ids || NEW.leader_id; END IF;
            IF OLD.leader_id IS NOT NULL AND OLD.leader_id <> NEW.leader_id THEN 
                affected_member_ids := affected_member_ids || OLD.leader_id; 
            END IF;
        ELSIF (TG_OP = 'DELETE') THEN
            IF OLD.leader_id IS NOT NULL THEN affected_member_ids := ARRAY[OLD.leader_id]; END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'cells' THEN
        IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
            IF NEW.leader_id IS NOT NULL THEN affected_member_ids := ARRAY[NEW.leader_id]; END IF;
        END IF;
        IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
            IF OLD.leader_id IS NOT NULL THEN affected_member_ids := affected_member_ids || OLD.leader_id; END IF;
        END IF;
    END IF;

    IF array_length(affected_member_ids, 1) IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Set refreshing flag to avoid infinite recursion
    PERFORM set_config('my_app.refreshing_stats', 'true', true);

    -- Find ALL ancestors for the affected members to update the entire chain
    WITH RECURSIVE ancestors AS (
        SELECT id, leader_id FROM public.members WHERE id = ANY(affected_member_ids)
        UNION ALL
        SELECT m.id, m.leader_id FROM public.members m
        INNER JOIN ancestors a ON m.id = a.leader_id
    )
    SELECT ARRAY_AGG(DISTINCT id) INTO ancestor_ids FROM ancestors;

    IF ancestor_ids IS NOT NULL AND array_length(ancestor_ids, 1) > 0 THEN
        -- Recalculate stats for the entire chain
        -- This logic counts members' own cells PLUS all descendants' cells.
        WITH RECURSIVE subordinates AS (
            -- Base case: everyone we need to update
            SELECT id AS root_id, id AS subordinate_id, ARRAY[id] AS path
            FROM public.members
            WHERE id = ANY(ancestor_ids)
            UNION ALL
            -- Recursive step: find disciples of those members
            SELECT s.root_id, m.id, s.path || m.id
            FROM public.members m
            INNER JOIN subordinates s ON m.leader_id = s.subordinate_id
            WHERE NOT m.id = ANY(s.path)
        ),
        cell_totals AS (
            -- Pre-aggregate active cells by leader
            SELECT leader_id, count(*) as count 
            FROM public.cells 
            WHERE is_active = true 
            GROUP BY leader_id
        ),
        stats AS (
            SELECT 
                sub.root_id,
                -- Count unique active subordinates (excluding the root itself)
                COUNT(DISTINCT sub.subordinate_id) FILTER (
                    WHERE sub.subordinate_id <> sub.root_id 
                    AND EXISTS (SELECT 1 FROM public.members m2 WHERE m2.id = sub.subordinate_id AND m2.is_active = true)
                ) AS calc_total_disciples,
                -- Sum of active cells led by anyone in this branch
                COALESCE(SUM(ct.count), 0) AS calc_total_cells
            FROM subordinates sub
            LEFT JOIN cell_totals ct ON sub.subordinate_id = ct.leader_id
            GROUP BY sub.root_id
        )
        UPDATE public.members m
        SET 
            total_disciples = s.calc_total_disciples,
            total_cells = s.calc_total_cells
        FROM stats s
        WHERE m.id = s.root_id;
    END IF;

    -- Unset refreshing flag
    PERFORM set_config('my_app.refreshing_stats', 'false', true);

    RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('my_app.refreshing_stats', 'false', true);
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RE-CREATE TRIGGERS
CREATE TRIGGER trg_refresh_stats_members
AFTER INSERT OR UPDATE OF leader_id, is_active OR DELETE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.refresh_member_stats_v2();

CREATE TRIGGER trg_refresh_stats_cells
AFTER INSERT OR UPDATE OF leader_id, is_active OR DELETE ON public.cells
FOR EACH ROW EXECUTE FUNCTION public.refresh_member_stats_v2();

-- 4. PERFORM RE-SYCHRONIZED INITIAL BACKFILL
-- This will fix all existing members' counts immediately.
WITH RECURSIVE subordinates AS (
    SELECT id AS root_id, id AS subordinate_id, ARRAY[id] AS path
    FROM public.members
    UNION ALL
    SELECT s.root_id, m.id, s.path || m.id
    FROM public.members m
    INNER JOIN subordinates s ON m.leader_id = s.subordinate_id
    WHERE NOT m.id = ANY(s.path)
),
cell_totals AS (
    SELECT leader_id, count(*) as count 
    FROM public.cells 
    WHERE is_active = true 
    GROUP BY leader_id
),
stats AS (
    SELECT 
        sub.root_id,
        COUNT(DISTINCT sub.subordinate_id) FILTER (
            WHERE sub.subordinate_id <> sub.root_id 
            AND EXISTS (SELECT 1 FROM public.members m2 WHERE m2.id = sub.subordinate_id AND m2.is_active = true)
        ) AS calc_total_disciples,
        COALESCE(SUM(ct.count), 0) AS calc_total_cells
    FROM subordinates sub
    LEFT JOIN cell_totals ct ON sub.subordinate_id = ct.leader_id
    GROUP BY sub.root_id
)
UPDATE public.members m
SET 
    total_disciples = s.calc_total_disciples,
    total_cells = s.calc_total_cells
FROM stats s
WHERE m.id = s.root_id;
