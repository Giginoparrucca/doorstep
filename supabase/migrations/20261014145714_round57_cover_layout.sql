-- Additive cover framing; existing photos remain centered at 100%.
-- RLS and grants on properties remain unchanged.
BEGIN;
ALTER TABLE public.properties ADD COLUMN hero_image_layout jsonb;
ALTER TABLE public.properties ADD CONSTRAINT properties_hero_image_layout_check CHECK (
  hero_image_layout IS NULL OR (
    jsonb_typeof(hero_image_layout) = 'object'
    AND hero_image_layout ?& ARRAY['zoom','x','y']
    AND jsonb_typeof(hero_image_layout->'zoom') = 'number'
    AND jsonb_typeof(hero_image_layout->'x') = 'number'
    AND jsonb_typeof(hero_image_layout->'y') = 'number'
    AND (hero_image_layout->>'zoom')::numeric BETWEEN 1 AND 3
    AND (hero_image_layout->>'x')::numeric BETWEEN 0 AND 100
    AND (hero_image_layout->>'y')::numeric BETWEEN 0 AND 100
  )
);
COMMENT ON COLUMN public.properties.hero_image_layout IS 'Responsive cover framing: zoom 1..3, x/y 0..100; null is centered at 100%.';
NOTIFY pgrst, 'reload schema';
COMMIT;
