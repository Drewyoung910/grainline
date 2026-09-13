-- DRAFT ONLY. Initial Conversation/Message RLS policy and table-grant shape
-- for disposable PostgreSQL proof. Production activation requires a promoted,
-- guarded migration after the compatible application is live.

ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Conversation" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Message" NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grainline_conversation_participant_or_reported_select
  ON public."Conversation";
CREATE POLICY grainline_conversation_participant_or_reported_select
  ON public."Conversation"
  FOR SELECT
  TO grainline_app_runtime
  USING (
    NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    ) IN ("userAId", "userBId")
    OR public.grainline_conversation_staff_report_visible(id)
  );

DROP POLICY IF EXISTS grainline_message_participant_or_reported_select
  ON public."Message";
CREATE POLICY grainline_message_participant_or_reported_select
  ON public."Message"
  FOR SELECT
  TO grainline_app_runtime
  USING (
    NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    ) IN ("senderId", "recipientId")
    OR public.grainline_conversation_staff_report_visible("conversationId")
  );

REVOKE ALL ON TABLE public."Conversation"
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON TABLE public."Message"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT ON TABLE public."Conversation" TO grainline_app_runtime;
GRANT SELECT ON TABLE public."Message" TO grainline_app_runtime;
