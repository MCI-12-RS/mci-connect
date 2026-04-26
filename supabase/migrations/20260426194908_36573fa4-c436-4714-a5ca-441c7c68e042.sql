-- Allow users with view_own_ministry to also see members who are leaders
-- of any member they can already see (so leader names render in lists).
DROP POLICY IF EXISTS "Members view policy" ON public.members;

CREATE POLICY "Members view policy"
ON public.members
FOR SELECT
TO authenticated
USING (
  user_has_permission(auth.uid(), 'view_all_church'::permission_action)
  OR user_has_permission(auth.uid(), 'view_members'::permission_action)
  OR (
    user_has_permission(auth.uid(), 'view_own_ministry'::permission_action)
    AND is_in_same_ministry(auth.uid(), id)
  )
  OR (auth_user_id = auth.uid())
  OR (
    user_has_permission(auth.uid(), 'view_own_ministry'::permission_action)
    AND EXISTS (
      SELECT 1 FROM public.members child
      WHERE child.leader_id = members.id
        AND is_in_same_ministry(auth.uid(), child.id)
    )
  )
);