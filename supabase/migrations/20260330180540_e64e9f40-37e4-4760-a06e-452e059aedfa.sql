
-- Function to find g12_level=1 ancestor (ministry root)
CREATE OR REPLACE FUNCTION get_ministry_root(_member_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_id uuid;
  _current_level integer;
  _leader uuid;
  _safety integer := 0;
BEGIN
  SELECT id, g12_level, leader_id INTO _current_id, _current_level, _leader
  FROM members WHERE id = _member_id;

  IF _current_level IS NULL THEN RETURN NULL; END IF;
  IF _current_level = 1 THEN RETURN _current_id; END IF;
  IF _current_level = 0 THEN RETURN NULL; END IF;

  WHILE _leader IS NOT NULL AND _safety < 20 LOOP
    SELECT id, g12_level, leader_id INTO _current_id, _current_level, _leader
    FROM members WHERE id = _leader;
    IF _current_level IS NULL THEN RETURN NULL; END IF;
    IF _current_level = 1 THEN RETURN _current_id; END IF;
    IF _current_level = 0 THEN RETURN NULL; END IF;
    _safety := _safety + 1;
  END LOOP;

  RETURN NULL;
END;
$$;

-- Function to check if target member is in same ministry as user
CREATE OR REPLACE FUNCTION is_in_same_ministry(_user_id uuid, _target_member_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_member_id uuid;
  _user_root uuid;
  _target_root uuid;
BEGIN
  IF _target_member_id IS NULL THEN RETURN false; END IF;
  SELECT id INTO _user_member_id FROM members WHERE auth_user_id = _user_id;
  IF _user_member_id IS NULL THEN RETURN false; END IF;
  IF _user_member_id = _target_member_id THEN RETURN true; END IF;
  _user_root := get_ministry_root(_user_member_id);
  IF _user_root IS NULL THEN RETURN false; END IF;
  IF _target_member_id = _user_root THEN RETURN true; END IF;
  _target_root := get_ministry_root(_target_member_id);
  RETURN _target_root IS NOT NULL AND _target_root = _user_root;
END;
$$;

-- Function to check if user is leader/timothy of a cell
CREATE OR REPLACE FUNCTION can_manage_own_cell(_user_id uuid, _cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cells c
    JOIN members m ON m.auth_user_id = _user_id
    WHERE c.id = _cell_id
    AND (c.leader_id = m.id OR c.timothy_id = m.id)
  )
$$;

-- Update members SELECT policy
DROP POLICY IF EXISTS "Users with view_members can view" ON members;
CREATE POLICY "Members view policy" ON members FOR SELECT TO authenticated
USING (
  user_has_permission(auth.uid(), 'view_all_church'::permission_action)
  OR user_has_permission(auth.uid(), 'view_members'::permission_action)
  OR (user_has_permission(auth.uid(), 'view_own_ministry'::permission_action) AND is_in_same_ministry(auth.uid(), id))
  OR auth_user_id = auth.uid()
);

-- Update members UPDATE policy
DROP POLICY IF EXISTS "Users with edit_member can update" ON members;
CREATE POLICY "Members update policy" ON members FOR UPDATE TO authenticated
USING (
  user_has_permission(auth.uid(), 'edit_member'::permission_action)
  OR (user_has_permission(auth.uid(), 'edit_own_data'::permission_action) AND auth_user_id = auth.uid())
);

-- Update cells SELECT policy
DROP POLICY IF EXISTS "Users with view_members can view cells" ON cells;
CREATE POLICY "Cells view policy" ON cells FOR SELECT TO authenticated
USING (
  user_has_permission(auth.uid(), 'view_all_church'::permission_action)
  OR user_has_permission(auth.uid(), 'view_members'::permission_action)
  OR (user_has_permission(auth.uid(), 'view_own_ministry'::permission_action) AND (
    is_in_same_ministry(auth.uid(), leader_id)
    OR is_in_same_ministry(auth.uid(), timothy_id)
    OR is_in_same_ministry(auth.uid(), host_id)
  ))
  OR can_manage_own_cell(auth.uid(), id)
);

-- Update cells UPDATE policy
DROP POLICY IF EXISTS "Users with edit_cell can update" ON cells;
CREATE POLICY "Cells update policy" ON cells FOR UPDATE TO authenticated
USING (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR (user_has_permission(auth.uid(), 'edit_own_data'::permission_action) AND can_manage_own_cell(auth.uid(), id))
);

-- Update cell_reports SELECT policy
DROP POLICY IF EXISTS "Users with view_members can view reports" ON cell_reports;
CREATE POLICY "Cell reports view policy" ON cell_reports FOR SELECT TO authenticated
USING (
  user_has_permission(auth.uid(), 'view_all_church'::permission_action)
  OR user_has_permission(auth.uid(), 'view_members'::permission_action)
  OR (user_has_permission(auth.uid(), 'view_own_ministry'::permission_action) AND EXISTS (
    SELECT 1 FROM cells c WHERE c.id = cell_id AND (
      is_in_same_ministry(auth.uid(), c.leader_id)
      OR is_in_same_ministry(auth.uid(), c.timothy_id)
    )
  ))
  OR can_manage_own_cell(auth.uid(), cell_id)
);

-- Update cell_reports INSERT policy
DROP POLICY IF EXISTS "Users with edit_cell can insert reports" ON cell_reports;
CREATE POLICY "Cell reports insert policy" ON cell_reports FOR INSERT TO authenticated
WITH CHECK (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR (user_has_permission(auth.uid(), 'edit_own_data'::permission_action) AND can_manage_own_cell(auth.uid(), cell_id))
);

-- Update cell_reports UPDATE policy
DROP POLICY IF EXISTS "Users with edit_cell can update reports" ON cell_reports;
CREATE POLICY "Cell reports update policy" ON cell_reports FOR UPDATE TO authenticated
USING (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR (user_has_permission(auth.uid(), 'edit_own_data'::permission_action) AND can_manage_own_cell(auth.uid(), cell_id))
);

-- Update cell_report_participants SELECT
DROP POLICY IF EXISTS "Users with view_members can view participants" ON cell_report_participants;
CREATE POLICY "Participants view policy" ON cell_report_participants FOR SELECT TO authenticated
USING (
  user_has_permission(auth.uid(), 'view_all_church'::permission_action)
  OR user_has_permission(auth.uid(), 'view_members'::permission_action)
  OR (user_has_permission(auth.uid(), 'view_own_ministry'::permission_action) AND EXISTS (
    SELECT 1 FROM cell_reports cr JOIN cells c ON c.id = cr.cell_id
    WHERE cr.id = report_id AND (
      is_in_same_ministry(auth.uid(), c.leader_id)
      OR is_in_same_ministry(auth.uid(), c.timothy_id)
    )
  ))
  OR EXISTS (
    SELECT 1 FROM cell_reports cr WHERE cr.id = report_id AND can_manage_own_cell(auth.uid(), cr.cell_id)
  )
);

-- Update cell_report_participants INSERT
DROP POLICY IF EXISTS "Users with edit_cell can insert participants" ON cell_report_participants;
CREATE POLICY "Participants insert policy" ON cell_report_participants FOR INSERT TO authenticated
WITH CHECK (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR EXISTS (
    SELECT 1 FROM cell_reports cr WHERE cr.id = report_id
    AND user_has_permission(auth.uid(), 'edit_own_data'::permission_action)
    AND can_manage_own_cell(auth.uid(), cr.cell_id)
  )
);

-- Update cell_report_participants DELETE
DROP POLICY IF EXISTS "Users with edit_cell can delete participants" ON cell_report_participants;
CREATE POLICY "Participants delete policy" ON cell_report_participants FOR DELETE TO authenticated
USING (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR EXISTS (
    SELECT 1 FROM cell_reports cr WHERE cr.id = report_id
    AND user_has_permission(auth.uid(), 'edit_own_data'::permission_action)
    AND can_manage_own_cell(auth.uid(), cr.cell_id)
  )
);
