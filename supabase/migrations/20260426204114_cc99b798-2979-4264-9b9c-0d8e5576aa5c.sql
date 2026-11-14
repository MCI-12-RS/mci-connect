DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'view_audit_log'
      AND enumtypid = 'public.permission_action'::regtype
  ) THEN
    ALTER TYPE public.permission_action ADD VALUE 'view_audit_log';
  END IF;
END $$;