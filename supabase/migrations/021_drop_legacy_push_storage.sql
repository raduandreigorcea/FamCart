-- Push moved to OneSignal. Device subscriptions now live in OneSignal's
-- backend, keyed to Clerk user ids via OneSignal.login(external_id), and the
-- push-on-item-insert edge function targets those ids over the OneSignal REST
-- API. The self-hosted Web Push / FCM storage (migrations 016 and 017) is
-- therefore dead: nothing reads or writes these tables anymore.

drop function if exists public.claim_push_subscription(text, text, text);
drop function if exists public.claim_device_push_token(text, text);

drop table if exists public.push_subscriptions;
drop table if exists public.device_push_tokens;
