CREATE TABLE public.bridge_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon_url TEXT,
  public_description TEXT,
  private_note TEXT,
  lock_password TEXT,
  category TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.bridge_links TO service_role;

ALTER TABLE public.bridge_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER bridge_links_updated_at
BEFORE UPDATE ON public.bridge_links
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();