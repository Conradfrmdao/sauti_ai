-- ============================================================
-- SAUTI1 AI
-- Cancellation function execution grants
-- ============================================================

-- Supabase may add explicit default function grants for its API roles. Keep
-- cancellation available only through an authenticated citizen session.
revoke all
on function public.cancel_voice_conversation(uuid)
from public, anon, service_role;

grant execute
on function public.cancel_voice_conversation(uuid)
to authenticated;

revoke all
on function public.cancel_text_conversation(uuid)
from public, anon, service_role;

grant execute
on function public.cancel_text_conversation(uuid)
to authenticated;

-- ============================================================
-- END
-- ============================================================
