-- Round 55 Phase 2: host-only generic sharing defaults; no guest records.
BEGIN;
CREATE TABLE public.host_share_preferences (
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
 preference_key text NOT NULL CHECK (preference_key IN (
  'message_language','en_start','en_partial','en_received','en_complete',
  'it_start','it_partial','it_received','it_complete')),
 value text NOT NULL CHECK (length(value) BETWEEN 1 AND 4000),
 PRIMARY KEY (property_id, preference_key),
 CHECK (preference_key <> 'message_language' OR value IN ('it','en'))
);
ALTER TABLE public.host_share_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_share_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_share_preferences TO authenticated;
GRANT ALL ON public.host_share_preferences TO service_role;
CREATE POLICY share_owner_select ON public.host_share_preferences FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = host_share_preferences.property_id AND p.owner_id = (SELECT auth.uid())));
CREATE POLICY share_owner_insert ON public.host_share_preferences FOR INSERT TO authenticated
 WITH CHECK (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = host_share_preferences.property_id AND p.owner_id = (SELECT auth.uid())));
CREATE POLICY share_owner_update ON public.host_share_preferences FOR UPDATE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = host_share_preferences.property_id AND p.owner_id = (SELECT auth.uid())))
 WITH CHECK (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = host_share_preferences.property_id AND p.owner_id = (SELECT auth.uid())));
CREATE POLICY share_owner_delete ON public.host_share_preferences FOR DELETE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = host_share_preferences.property_id AND p.owner_id = (SELECT auth.uid())));
COMMENT ON TABLE public.host_share_preferences IS 'Private per-property generic message templates and language. Rendered guest messages are never stored here.';
COMMIT;
