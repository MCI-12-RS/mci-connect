-- Clean existing data by removing all non-numeric characters
UPDATE public.members
SET 
  cpf = REGEXP_REPLACE(cpf, '\D', '', 'g'),
  mobile_whatsapp = REGEXP_REPLACE(mobile_whatsapp, '\D', '', 'g'),
  phone = REGEXP_REPLACE(phone, '\D', '', 'g'),
  zip_code = REGEXP_REPLACE(zip_code, '\D', '', 'g');

-- Optional: ensure any constraints or indexes are optimized for numeric search
-- (e.g. if we want to enforce length or format via CHECK constraints in the future)
