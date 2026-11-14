
-- Update cell_reports UPDATE policy
DROP POLICY IF EXISTS "Cell reports update policy" ON public.cell_reports;
CREATE POLICY "Cell reports update policy" ON public.cell_reports
  FOR UPDATE TO authenticated
  USING (user_has_permission(auth.uid(), 'edit_cell_report'::permission_action));

-- Update cell_reports DELETE policy
DROP POLICY IF EXISTS "Users with delete_cell can delete reports" ON public.cell_reports;
CREATE POLICY "Cell reports delete policy" ON public.cell_reports
  FOR DELETE TO authenticated
  USING (user_has_permission(auth.uid(), 'delete_cell_report'::permission_action));

-- Update cell_report_participants delete policy
DROP POLICY IF EXISTS "Participants delete policy" ON public.cell_report_participants;
CREATE POLICY "Participants delete policy" ON public.cell_report_participants
  FOR DELETE TO authenticated
  USING (
    user_has_permission(auth.uid(), 'edit_cell_report'::permission_action)
    OR user_has_permission(auth.uid(), 'delete_cell_report'::permission_action)
    OR user_has_permission(auth.uid(), 'edit_cell'::permission_action)
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
