CREATE OR REPLACE FUNCTION sync_spouse_trigger()
RETURNS trigger AS $$
BEGIN
  -- Antiloop limit (prevents the trigger from recursively firing from its own UPDATEs deeper than 1 level)
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Operations
  IF TG_OP = 'DELETE' THEN
    -- If deleted user had a spouse, clear the spouse's record automatically
    IF OLD.spouse_id IS NOT NULL THEN
      UPDATE public.members 
      SET spouse_id = NULL 
      WHERE id = OLD.spouse_id AND spouse_id = OLD.id;
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    -- If spouse was changed
    IF OLD.spouse_id IS DISTINCT FROM NEW.spouse_id THEN
      -- 1. Unlink the old spouse (they are no longer married to this user)
      IF OLD.spouse_id IS NOT NULL THEN
        UPDATE public.members 
        SET spouse_id = NULL 
        WHERE id = OLD.spouse_id AND spouse_id = NEW.id;
      END IF;

      -- 2. Link the new spouse
      IF NEW.spouse_id IS NOT NULL THEN
        UPDATE public.members 
        SET spouse_id = NEW.id 
        WHERE id = NEW.spouse_id AND (spouse_id IS NULL OR spouse_id IS DISTINCT FROM NEW.id);
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'INSERT' THEN
    -- Link the selected spouse upon creation
    IF NEW.spouse_id IS NOT NULL THEN
      UPDATE public.members 
      SET spouse_id = NEW.id 
      WHERE id = NEW.spouse_id AND (spouse_id IS NULL OR spouse_id IS DISTINCT FROM NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Remove it if it exists (re-run safety)
DROP TRIGGER IF EXISTS on_member_spouse_change ON public.members;

-- Attach trigger to AFTER event
-- (So we only update the other row when the current row successfully commits its change)
CREATE TRIGGER on_member_spouse_change
AFTER INSERT OR UPDATE OF spouse_id OR DELETE ON public.members
FOR EACH ROW
EXECUTE FUNCTION sync_spouse_trigger();
