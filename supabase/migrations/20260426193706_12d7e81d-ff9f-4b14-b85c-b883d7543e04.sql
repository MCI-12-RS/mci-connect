CREATE OR REPLACE FUNCTION public.is_in_same_ministry(_user_id uuid, _target_member_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_member_id uuid;
  _user_root uuid;
  _user_root_spouse uuid;
  _target_root uuid;
  _target_root_spouse uuid;
BEGIN
  IF _target_member_id IS NULL THEN RETURN false; END IF;

  SELECT id INTO _user_member_id FROM members WHERE auth_user_id = _user_id;
  IF _user_member_id IS NULL THEN RETURN false; END IF;

  IF _user_member_id = _target_member_id THEN RETURN true; END IF;

  _user_root := get_ministry_root(_user_member_id);
  IF _user_root IS NULL THEN RETURN false; END IF;

  -- Spouse of the user's G12 leader (root) is also part of the visible ministry
  SELECT spouse_id INTO _user_root_spouse FROM members WHERE id = _user_root;

  -- The G12 leader and their spouse are visible
  IF _target_member_id = _user_root THEN RETURN true; END IF;
  IF _user_root_spouse IS NOT NULL AND _target_member_id = _user_root_spouse THEN
    RETURN true;
  END IF;

  -- Target must roll up to the same G12 root, OR to the spouse of that root
  _target_root := get_ministry_root(_target_member_id);
  IF _target_root IS NOT NULL THEN
    IF _target_root = _user_root THEN RETURN true; END IF;
    IF _user_root_spouse IS NOT NULL AND _target_root = _user_root_spouse THEN
      RETURN true;
    END IF;

    -- Also: target's root spouse equals user's root (covers the inverse pairing)
    SELECT spouse_id INTO _target_root_spouse FROM members WHERE id = _target_root;
    IF _target_root_spouse IS NOT NULL AND _target_root_spouse = _user_root THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$function$;