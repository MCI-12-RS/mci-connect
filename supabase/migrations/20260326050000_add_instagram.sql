
-- Add instagram and avatar_url to members table
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS instagram text;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS avatar_url text;
