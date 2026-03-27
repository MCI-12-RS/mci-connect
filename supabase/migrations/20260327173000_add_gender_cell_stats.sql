-- 1. ADD NEW COLUMNS TO MEMBERS
ALTER TABLE public.members 
ADD COLUMN IF NOT EXISTS male_cells integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS female_cells integer DEFAULT 0;

-- 2. UPDATE REFRESH FUNCTION TO POPULATE GENDER-SPECIFIC COUNTS
CREATE OR REPLACE FUNCTION public.refresh_member_stats_v2()
RETURNS trigger AS $$
DECLARE
    affected_member_ids uuid[] := '{}';
    ancestor_ids uuid[] := '{}';
BEGIN
    -- Protection using session config
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

    -- Set refreshing flag
    PERFORM set_config('my_app.refreshing_stats', 'true', true);

    -- Find ALL ancestors
    WITH RECURSIVE ancestors AS (
        SELECT id, leader_id FROM public.members WHERE id = ANY(affected_member_ids)
        UNION ALL
        SELECT m.id, m.leader_id FROM public.members m
        INNER JOIN ancestors a ON m.id = a.leader_id
    )
    SELECT ARRAY_AGG(DISTINCT id) INTO ancestor_ids FROM ancestors;

    IF ancestor_ids IS NOT NULL AND array_length(ancestor_ids, 1) > 0 THEN
        WITH RECURSIVE subordinates AS (
            SELECT id AS root_id, id AS subordinate_id, ARRAY[id] AS path
            FROM public.members
            WHERE id = ANY(ancestor_ids)
            UNION ALL
            SELECT s.root_id, m.id, s.path || m.id
            FROM public.members m
            INNER JOIN subordinates s ON m.leader_id = s.subordinate_id
            WHERE NOT m.id = ANY(s.path)
        ),
        cell_totals AS (
            -- Pre-aggregate active cells by leader and gender
            SELECT 
                c.leader_id, 
                m.gender,
                count(*) as count 
            FROM public.cells c
            JOIN public.members m ON c.leader_id = m.id
            WHERE c.is_active = true 
            GROUP BY c.leader_id, m.gender
        ),
        stats AS (
            SELECT 
                sub.root_id,
                COUNT(DISTINCT sub.subordinate_id) FILTER (
                    WHERE sub.subordinate_id <> sub.root_id 
                    AND EXISTS (SELECT 1 FROM public.members m2 WHERE m2.id = sub.subordinate_id AND m2.is_active = true)
                ) AS calc_total_disciples,
                COALESCE(SUM(ct.count) FILTER (WHERE ct.gender = 'Masculino' OR ct.gender = 'M'), 0) AS calc_male_cells,
                COALESCE(SUM(ct.count) FILTER (WHERE ct.gender = 'Feminino' OR ct.gender = 'F'), 0) AS calc_female_cells
            FROM subordinates sub
            LEFT JOIN cell_totals ct ON sub.subordinate_id = ct.leader_id
            GROUP BY sub.root_id
        )
        UPDATE public.members m
        SET 
            total_disciples = s.calc_total_disciples,
            male_cells = s.calc_male_cells,
            female_cells = s.calc_female_cells,
            total_cells = s.calc_male_cells + s.calc_female_cells
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

-- 3. PERFORM INITIAL BACKFILL
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
    SELECT 
        c.leader_id, 
        m.gender,
        count(*) as count 
    FROM public.cells c
    JOIN public.members m ON c.leader_id = m.id
    WHERE c.is_active = true 
    GROUP BY c.leader_id, m.gender
),
stats AS (
    SELECT 
        sub.root_id,
        COUNT(DISTINCT sub.subordinate_id) FILTER (
            WHERE sub.subordinate_id <> sub.root_id 
            AND EXISTS (SELECT 1 FROM public.members m2 WHERE m2.id = sub.subordinate_id AND m2.is_active = true)
        ) AS calc_total_disciples,
        COALESCE(SUM(ct.count) FILTER (WHERE ct.gender = 'Masculino' OR ct.gender = 'M'), 0) AS calc_male_cells,
        COALESCE(SUM(ct.count) FILTER (WHERE ct.gender = 'Feminino' OR ct.gender = 'F'), 0) AS calc_female_cells
    FROM subordinates sub
    LEFT JOIN cell_totals ct ON sub.subordinate_id = ct.leader_id
    GROUP BY sub.root_id
)
UPDATE public.members m
SET 
    total_disciples = s.calc_total_disciples,
    male_cells = s.calc_male_cells,
    female_cells = s.calc_female_cells,
    total_cells = s.calc_male_cells + s.calc_female_cells
FROM stats s
WHERE m.id = s.root_id;
