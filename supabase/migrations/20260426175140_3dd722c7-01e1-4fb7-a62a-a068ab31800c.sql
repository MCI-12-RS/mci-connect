
CREATE OR REPLACE FUNCTION public.sync_spouse_relationship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Avoid recursion when the trigger updates other rows
  IF current_setting('app.sync_spouse_running', true) = 'on' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_spouse_running', 'on', true);

  -- If spouse changed (or on insert), sync both sides
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.spouse_id::text, '') = COALESCE(NEW.spouse_id::text, '') THEN
    PERFORM set_config('app.sync_spouse_running', 'off', true);
    RETURN NEW;
  END IF;

  -- Clear old partner if it pointed back to NEW.id
  IF TG_OP = 'UPDATE' AND OLD.spouse_id IS NOT NULL AND OLD.spouse_id IS DISTINCT FROM NEW.spouse_id THEN
    UPDATE public.members
      SET spouse_id = NULL
      WHERE id = OLD.spouse_id AND spouse_id = NEW.id;
  END IF;

  IF NEW.spouse_id IS NOT NULL THEN
    -- Prevent self-marriage
    IF NEW.spouse_id = NEW.id THEN
      PERFORM set_config('app.sync_spouse_running', 'off', true);
      RAISE EXCEPTION 'A member cannot be their own spouse';
    END IF;

    -- Clear any existing spouse of the new partner that points elsewhere
    UPDATE public.members
      SET spouse_id = NULL
      WHERE spouse_id = NEW.spouse_id AND id <> NEW.id;

    -- Set the reverse link
    UPDATE public.members
      SET spouse_id = NEW.id
      WHERE id = NEW.spouse_id AND (spouse_id IS DISTINCT FROM NEW.id);
  END IF;

  PERFORM set_config('app.sync_spouse_running', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_spouse_relationship_trigger ON public.members;

CREATE TRIGGER sync_spouse_relationship_trigger
AFTER INSERT OR UPDATE OF spouse_id ON public.members
FOR EACH ROW
EXECUTE FUNCTION public.sync_spouse_relationship();
