-- Cierra los avisos de seguridad del linter tras 0001.

-- set_updated_at: fijar search_path (evita hijacking de resolución de nombres).
alter function public.set_updated_at() set search_path = '';

-- rls_auto_enable: event trigger guardrail preexistente. No debe ser invocable
-- por los roles de la API pública (anon/authenticated) vía RPC.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
