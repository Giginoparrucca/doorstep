BEGIN;
LOCK TABLE public.chat_qa_pairs IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.properties ADD COLUMN entry_chat_protected boolean NOT NULL DEFAULT false;
ALTER TABLE public.chat_messages ADD COLUMN entry_sensitive boolean NOT NULL DEFAULT false,
  ADD COLUMN entry_identity_version uuid, ADD COLUMN entry_content_version text;
ALTER TABLE public.chat_qa_pairs ADD COLUMN source_property_id uuid;
-- Legacy derived answers have no recoverable source identity after chat purge.
-- Preserve them privately rather than treating regex anonymization as proof.
CREATE TABLE entry_access.chat_qa_quarantine AS
  SELECT q.*,now() AS quarantined_at,'legacy_unverified_source'::text AS quarantine_reason
  FROM public.chat_qa_pairs q;
ALTER TABLE entry_access.chat_qa_quarantine ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON entry_access.chat_qa_quarantine FROM PUBLIC,anon,authenticated,service_role;
DELETE FROM public.chat_qa_pairs;
UPDATE public.properties SET entry_chat_protected=true WHERE entry_checkin_required=true;
UPDATE public.chat_messages m SET entry_sensitive=true FROM public.properties p
  WHERE p.id=m.property_id AND p.entry_chat_protected=true;

-- This digest never leaves the server. Any dedicated access/room/code change
-- invalidates earlier text, even if the booking's identity did not change.
CREATE FUNCTION entry_access.chat_content_version(p_property uuid,p_code text,p_test boolean)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT md5(jsonb_build_array(
   (SELECT jsonb_build_array(p.keybox_code,p.access_method,p.show_fixed_lockbox_to_guest,
     p.show_rotating_lockbox_to_guest,p.rotating_lockbox_enabled,p.use_per_guest_lockbox)
     FROM public.properties p WHERE p.id=p_property AND p.deleted_at IS NULL),
   (SELECT jsonb_agg(jsonb_build_array(r.id,r.status,r.deleted_at,r.room_id,r.keybox_code,r.checkin_date,r.checkout_date) ORDER BY r.id)
     FROM public.ota_reservations r WHERE r.property_id=p_property AND r.booking_code=p_code AND r.is_test=p_test),
   (SELECT jsonb_agg(v ORDER BY v::text) FROM (SELECT DISTINCT jsonb_build_array(c.room_id,c.keybox_code) v
     FROM public.checkins c WHERE c.property_id=p_property AND c.booking_code=p_code AND c.is_test=p_test AND c.deleted_at IS NULL) x),
   (SELECT jsonb_agg(jsonb_build_array(r.id,r.door_code,r.deleted_at) ORDER BY r.id)
     FROM public.property_rooms r WHERE r.property_id=p_property)
 )::text)
$$;
REVOKE ALL ON FUNCTION entry_access.chat_content_version(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Also catches an old capture invocation that started before this migration.
CREATE FUNCTION entry_access.guard_qa_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(66880201);
  IF NEW.source_property_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.properties p
    WHERE p.id=NEW.source_property_id AND p.entry_chat_protected=false
      AND p.entry_checkin_required=false AND p.deleted_at IS NULL) THEN
    INSERT INTO entry_access.chat_qa_quarantine SELECT NEW.*,now(),'unverified_or_protected_source';
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION entry_access.guard_qa_source() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER round66_qa_source BEFORE INSERT OR UPDATE ON public.chat_qa_pairs
  FOR EACH ROW EXECUTE FUNCTION entry_access.guard_qa_source();

CREATE FUNCTION entry_access.stamp_chat_provenance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.properties%ROWTYPE;
BEGIN
  -- Serialize message insertion with opt-in, including direct host inserts.
  SELECT * INTO p FROM public.properties WHERE id=NEW.property_id FOR SHARE;
  IF TG_OP='UPDATE' THEN
    NEW.entry_sensitive:=OLD.entry_sensitive OR NEW.entry_sensitive OR coalesce(p.entry_checkin_required,false);
    NEW.entry_identity_version:=OLD.entry_identity_version;
    NEW.entry_content_version:=OLD.entry_content_version;
    IF NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.booking_code IS DISTINCT FROM OLD.booking_code
      OR NEW.is_test IS DISTINCT FROM OLD.is_test OR NEW.message IS DISTINCT FROM OLD.message THEN
      NEW.entry_identity_version:=NULL; NEW.entry_content_version:=NULL;
    END IF;
  ELSE
    NEW.entry_sensitive:=coalesce(p.entry_checkin_required,false);
    NEW.entry_identity_version:=NULL; NEW.entry_content_version:=NULL;
    IF NEW.entry_sensitive THEN
      SELECT b.identity_version INTO NEW.entry_identity_version FROM entry_access.bookings b
        WHERE b.property_id=NEW.property_id AND b.booking_code=NEW.booking_code
          AND b.is_test=coalesce(NEW.is_test,false) AND b.status='active';
      NEW.entry_content_version:=entry_access.chat_content_version(NEW.property_id,NEW.booking_code,coalesce(NEW.is_test,false));
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION entry_access.stamp_chat_provenance() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER round66_chat_provenance BEFORE INSERT OR UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION entry_access.stamp_chat_provenance();

CREATE FUNCTION entry_access.protect_chat_optin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  NEW.entry_chat_protected:=coalesce(OLD.entry_chat_protected,false) OR NEW.entry_checkin_required;
  IF NEW.entry_checkin_required AND NOT OLD.entry_checkin_required THEN
    PERFORM pg_advisory_xact_lock(66880201);
    UPDATE public.chat_messages SET entry_sensitive=true WHERE property_id=NEW.id;
    INSERT INTO entry_access.chat_qa_quarantine SELECT q.*,now(),'property_opted_in'
      FROM public.chat_qa_pairs q WHERE q.source_property_id=NEW.id;
    DELETE FROM public.chat_qa_pairs WHERE source_property_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION entry_access.protect_chat_optin() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER round66_chat_optin BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION entry_access.protect_chat_optin();
-- New properties can be opted in by an owner at creation too.
CREATE FUNCTION entry_access.protect_chat_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.entry_chat_protected:=NEW.entry_checkin_required; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION entry_access.protect_chat_insert() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER round66_chat_property_insert BEFORE INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION entry_access.protect_chat_insert();

CREATE FUNCTION public.get_entry_chat_delivery(p_property_id uuid,p_booking_code text,p_is_test boolean,p_since timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prop public.properties%ROWTYPE; snap jsonb; msgs jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO prop FROM public.properties WHERE id=p_property_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF prop.entry_checkin_required AND p_booking_code IS NOT NULL THEN
   snap:=public.get_entry_access_booking_snapshot(p_property_id,p_booking_code,p_is_test);
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO msgs FROM (
   SELECT m.id,m.sender,m.message,m.booking_code,m.created_at,m.entry_sensitive,m.entry_identity_version,m.entry_content_version
   FROM public.chat_messages m WHERE m.property_id=p_property_id AND (m.booking_code IS NOT DISTINCT FROM p_booking_code OR (p_booking_code IS NULL AND m.booking_code=''))
     AND m.is_test=p_is_test AND m.deleted_at IS NULL
     AND (p_since IS NULL OR (m.created_at>p_since AND m.sender IN ('host','system')))
   ORDER BY CASE WHEN p_since IS NULL THEN m.created_at END DESC, m.created_at ASC,m.id
   LIMIT CASE WHEN p_since IS NULL THEN 50 ELSE 5 END
 ) q;
 RETURN jsonb_build_object('property_id',p_property_id,'booking_code',p_booking_code,'is_test',p_is_test,
   'enabled',prop.entry_checkin_required,'snapshot',snap,'messages',msgs,
   'content_version',entry_access.chat_content_version(p_property_id,p_booking_code,p_is_test));
END $$;
REVOKE ALL ON FUNCTION public.get_entry_chat_delivery(uuid,text,boolean,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_entry_chat_delivery(uuid,text,boolean,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_chat_qa_pairs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF current_setting('role',true)='authenticated' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(66880201);
  WITH conversations AS (
    SELECT
      m.property_id,
      m.booking_code,
      MIN(m.created_at) AS first_msg_at,
      MAX(m.created_at) AS last_msg_at,
      COUNT(*)          AS msg_count,
      BOOL_OR(m.sender = 'guest') AS has_guest,
      BOOL_OR(m.sender = 'host')  AS has_host,
      BOOL_OR(m.sender = 'bot' OR m.sender = 'ai')   AS has_ai,
      BOOL_OR(m.sender = 'system'
              AND (m.message ILIKE '%escalat%' OR m.message ILIKE '%richiesto%'))
                                  AS was_escalated,
      MD5(m.property_id::TEXT || COALESCE(m.booking_code, '_no_code')
          || MIN(m.created_at)::TEXT)  AS source_hash
    FROM public.chat_messages m
    WHERE m.is_test = FALSE
      AND EXISTS (SELECT 1 FROM public.properties safe_p WHERE safe_p.id=m.property_id
        AND safe_p.entry_chat_protected=false AND safe_p.entry_checkin_required=false AND safe_p.deleted_at IS NULL)
      AND m.deleted_at IS NULL
      -- Round 14.2: skip booking codes the guest has objected to.
      AND (m.booking_code IS NULL
           OR m.booking_code NOT IN (SELECT booking_code FROM public.excluded_booking_codes))
    GROUP BY m.property_id, m.booking_code
    HAVING BOOL_OR(m.sender = 'guest')
       AND BOOL_OR(m.sender IN ('host', 'bot', 'ai'))
  ),
  first_q AS (
    SELECT DISTINCT ON (m.property_id, m.booking_code)
      m.property_id, m.booking_code, m.message AS question_raw,
      m.created_at AS question_at
    FROM public.chat_messages m
    WHERE m.sender = 'guest'
      AND m.is_test = FALSE
      AND m.deleted_at IS NULL
    ORDER BY m.property_id, m.booking_code, m.created_at ASC
  ),
  last_a AS (
    SELECT DISTINCT ON (m.property_id, m.booking_code)
      m.property_id, m.booking_code, m.message AS answer_raw,
      m.sender AS answer_sender, m.created_at AS answer_at
    FROM public.chat_messages m
    WHERE m.sender IN ('host', 'bot', 'ai')
      AND m.is_test = FALSE
      AND m.deleted_at IS NULL
    ORDER BY m.property_id, m.booking_code, m.created_at DESC
  ),
  enriched AS (
    SELECT
      c.*,
      q.question_raw,
      q.question_at,
      a.answer_raw,
      a.answer_sender,
      a.answer_at,
      p.region AS property_region,
      p.property_type,
      ck.arrival_date,
      ck.nights,
      (SELECT COUNT(*) FROM public.checkins ck2
        WHERE ck2.booking_code = c.booking_code
          AND ck2.property_id = c.property_id
          AND ck2.is_test = FALSE
          AND ck2.deleted_at IS NULL) AS guest_count
    FROM conversations c
    JOIN first_q q ON q.property_id = c.property_id
                  AND q.booking_code IS NOT DISTINCT FROM c.booking_code
    JOIN last_a a  ON a.property_id = c.property_id
                  AND a.booking_code IS NOT DISTINCT FROM c.booking_code
    LEFT JOIN public.properties p ON p.id = c.property_id
    LEFT JOIN LATERAL (
      SELECT arrival_date, nights
      FROM public.checkins
      WHERE booking_code = c.booking_code
        AND property_id = c.property_id
        AND is_test = FALSE
        AND deleted_at IS NULL
        AND guest_type IN ('single', 'head', 'group')
      ORDER BY submitted_at DESC NULLS LAST
      LIMIT 1
    ) ck ON TRUE
  )
  INSERT INTO public.chat_qa_pairs (
    source_property_id, question_text, answer_text, answered_by, escalated,
    category, language, message_count,
    time_to_first_response_seconds, time_to_resolution_seconds,
    property_region, property_type,
    season, stay_length_bucket, group_size_bucket,
    source_hash
  )
  SELECT
    e.property_id,
    public.anonymize_text(e.question_raw),
    public.anonymize_text(e.answer_raw),
    CASE
      WHEN e.has_host AND e.has_ai THEN 'host_after_ai'
      WHEN e.has_host              THEN 'host'
      ELSE 'ai'
    END,
    e.was_escalated,
    NULL,
    CASE
      WHEN e.question_raw ~* '\m(non|che|per|della|sono|grazie|prego|ciao)\M'
        OR e.question_raw ~ '[àèéìòù]'
        THEN 'it'
      WHEN e.question_raw ~* '\m(the|and|please|thanks|hello|hi|how|where|what)\M'
        THEN 'en'
      ELSE NULL
    END,
    e.msg_count,
    EXTRACT(EPOCH FROM (e.answer_at - e.question_at))::INTEGER,
    EXTRACT(EPOCH FROM (e.last_msg_at - e.first_msg_at))::INTEGER,
    e.property_region,
    e.property_type,
    public.compute_season(e.arrival_date),
    CASE
      WHEN e.nights IS NULL    THEN NULL
      WHEN e.nights <= 2       THEN '1-2'
      WHEN e.nights <= 7       THEN '3-7'
      ELSE                          '8+'
    END,
    CASE
      WHEN e.guest_count IS NULL OR e.guest_count = 0 THEN NULL
      WHEN e.guest_count = 1                          THEN 'solo'
      WHEN e.guest_count = 2                          THEN 'couple'
      WHEN e.guest_count BETWEEN 3 AND 4              THEN 'family'
      ELSE                                                  'group'
    END,
    e.source_hash
  FROM enriched e
  ON CONFLICT (source_hash) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_chat_qa_pairs() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.capture_chat_qa_pairs() TO authenticated,service_role;
COMMIT;
