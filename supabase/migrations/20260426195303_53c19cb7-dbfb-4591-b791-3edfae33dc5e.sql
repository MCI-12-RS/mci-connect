-- Security definer helper to check if a member is leader of any member
-- visible to the current user via the same-ministry rule. Bypasses RLS
-- to avoid infinite recursion when used inside the members policy.
CREATE OR REPLACE FUNCTION public.is_leader_of_visible_member(_user_id uuid, _candidate_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _child record;
BEGIN
  IF _candidate_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  FOR _child IN
    SELECT id FROM public.members WHERE leader_id = _candidate_id
  LOOP
    IF is_in_same_ministry(_user_id, _child.id) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

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
    AND is_leader_of_visible_member(auth.uid(), id)
  )
);