
-- Drop existing cell_reports policies
DROP POLICY IF EXISTS "Cell reports view policy" ON public.cell_reports;
DROP POLICY IF EXISTS "Cell reports insert policy" ON public.cell_reports;
DROP POLICY IF EXISTS "Cell reports update policy" ON public.cell_reports;

-- Drop existing cell_report_participants policies
DROP POLICY IF EXISTS "Participants view policy" ON public.cell_report_participants;
DROP POLICY IF EXISTS "Participants insert policy" ON public.cell_report_participants;
DROP POLICY IF EXISTS "Participants delete policy" ON public.cell_report_participants;

-- VIEW: cell_reports
CREATE POLICY "Cell reports view policy" ON public.cell_reports
FOR SELECT TO authenticated
USING (
  user_has_permission(auth.uid(), 'view_all_reports'::permission_action)
  OR user_has_permission(auth.uid(), 'view_all_church'::permission_action)
  OR user_has_permission(auth.uid(), 'view_members'::permission_action)
  OR (
    user_has_permission(auth.uid(), 'view_own_reports'::permission_action)
    AND (
      can_manage_own_cell(auth.uid(), cell_id)
      OR EXISTS (
        SELECT 1 FROM cells c
        WHERE c.id = cell_reports.cell_id
        AND (
          is_in_same_ministry(auth.uid(), c.leader_id)
          OR is_in_same_ministry(auth.uid(), c.timothy_id)
        )
      )
    )
  )
  OR (
    user_has_permission(auth.uid(), 'view_own_ministry'::permission_action)
    AND EXISTS (
      SELECT 1 FROM cells c
      WHERE c.id = cell_reports.cell_id
      AND (
        is_in_same_ministry(auth.uid(), c.leader_id)
        OR is_in_same_ministry(auth.uid(), c.timothy_id)
      )
    )
  )
  OR can_manage_own_cell(auth.uid(), cell_id)
);

-- INSERT: cell_reports
CREATE POLICY "Cell reports insert policy" ON public.cell_reports
FOR INSERT TO authenticated
WITH CHECK (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR user_has_permission(auth.uid(), 'submit_any_visible_report'::permission_action)
  OR (
    user_has_permission(auth.uid(), 'submit_own_cell_report'::permission_action)
    AND can_manage_own_cell(auth.uid(), cell_id)
  )
  OR (
    user_has_permission(auth.uid(), 'edit_own_data'::permission_action)
    AND can_manage_own_cell(auth.uid(), cell_id)
  )
);

-- UPDATE: cell_reports
CREATE POLICY "Cell reports update policy" ON public.cell_reports
FOR UPDATE TO authenticated
USING (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR user_has_permission(auth.uid(), 'submit_any_visible_report'::permission_action)
  OR (
    user_has_permission(auth.uid(), 'submit_own_cell_report'::permission_action)
    AND can_manage_own_cell(auth.uid(), cell_id)
  )
  OR (
    user_has_permission(auth.uid(), 'edit_own_data'::permission_action)
    AND can_manage_own_cell(auth.uid(), cell_id)
  )
);

-- VIEW: cell_report_participants
CREATE POLICY "Participants view policy" ON public.cell_report_participants
FOR SELECT TO authenticated
USING (
  user_has_permission(auth.uid(), 'view_all_reports'::permission_action)
  OR user_has_permission(auth.uid(), 'view_all_church'::permission_action)
  OR user_has_permission(auth.uid(), 'view_members'::permission_action)
  OR (
    user_has_permission(auth.uid(), 'view_own_reports'::permission_action)
    AND EXISTS (
      SELECT 1 FROM cell_reports cr
      JOIN cells c ON c.id = cr.cell_id
      WHERE cr.id = cell_report_participants.report_id
      AND (
        can_manage_own_cell(auth.uid(), c.id)
        OR is_in_same_ministry(auth.uid(), c.leader_id)
        OR is_in_same_ministry(auth.uid(), c.timothy_id)
      )
    )
  )
  OR (
    user_has_permission(auth.uid(), 'view_own_ministry'::permission_action)
    AND EXISTS (
      SELECT 1 FROM cell_reports cr
      JOIN cells c ON c.id = cr.cell_id
      WHERE cr.id = cell_report_participants.report_id
      AND (is_in_same_ministry(auth.uid(), c.leader_id) OR is_in_same_ministry(auth.uid(), c.timothy_id))
    )
  )
  OR EXISTS (
    SELECT 1 FROM cell_reports cr
    WHERE cr.id = cell_report_participants.report_id
    AND can_manage_own_cell(auth.uid(), cr.cell_id)
  )
);

-- INSERT: cell_report_participants
CREATE POLICY "Participants insert policy" ON public.cell_report_participants
FOR INSERT TO authenticated
WITH CHECK (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR user_has_permission(auth.uid(), 'submit_any_visible_report'::permission_action)
  OR EXISTS (
    SELECT 1 FROM cell_reports cr
    WHERE cr.id = cell_report_participants.report_id
    AND (
      (user_has_permission(auth.uid(), 'submit_own_cell_report'::permission_action) AND can_manage_own_cell(auth.uid(), cr.cell_id))
      OR (user_has_permission(auth.uid(), 'edit_own_data'::permission_action) AND can_manage_own_cell(auth.uid(), cr.cell_id))
    )
  )
);

-- DELETE: cell_report_participants
CREATE POLICY "Participants delete policy" ON public.cell_report_participants
FOR DELETE TO authenticated
USING (
  user_has_permission(auth.uid(), 'edit_cell'::permission_action)
  OR user_has_permission(auth.uid(), 'submit_any_visible_report'::permission_action)
  OR EXISTS (
    SELECT 1 FROM cell_reports cr
    WHERE cr.id = cell_report_participants.report_id
    AND (
      (user_has_permission(auth.uid(), 'submit_own_cell_report'::permission_action) AND can_manage_own_cell(auth.uid(), cr.cell_id))
      OR (user_has_permission(auth.uid(), 'edit_own_data'::permission_action) AND can_manage_own_cell(auth.uid(), cr.cell_id))
    )
  )
);
