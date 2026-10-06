-- =====================================================================
-- WO-035 · Compra al proveedor en su portal web (ancpagos.com) en vez de por WhatsApp
-- Requiere: wo-024 (triangulaciones), wo-026, wo-031 y wo-033. Ejecutar en Supabase → SQL Editor. Es idempotente.
--
-- El bot (n8n) cotiza con el catálogo público de ANC, te pide el pago (#pago con la captura), crea el
-- pedido en ancpagos.com con ese comprobante y revisa cada minuto la página del pedido hasta que
-- aparecen los accesos. Aquí solo se guarda el pedido de ANC (id + token de su página).
-- El token de ANC abre la página con los accesos: solo lo leen el panel (admin) y n8n (service_role).
-- =====================================================================

do $$
declare
    v_faltan text[] := '{}';
begin
    if to_regclass('public.triangulaciones') is null then
        v_faltan := array_append(v_faltan, 'public.triangulaciones (wo-024)'::text);
    elsif not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'triangulaciones' and column_name = 'iniciada_at') then
        v_faltan := array_append(v_faltan, 'triangulaciones.iniciada_at (wo-032/wo-033)'::text);
    end if;
    if array_length(v_faltan, 1) > 0 then
        raise exception 'Nada se aplicó. Falta: %', array_to_string(v_faltan, ', ');
    end if;
end;
$$;

-- 1) Pedido en el portal del proveedor
alter table public.triangulaciones
    add column if not exists canal_compra    text,
    add column if not exists anc_pedido_id   text,
    add column if not exists anc_token       text,
    add column if not exists anc_revisado_at timestamptz;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'triangulaciones_canal_compra') then
        alter table public.triangulaciones add constraint triangulaciones_canal_compra
            check (canal_compra is null or canal_compra in ('whatsapp', 'web'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'triangulaciones_anc_pedido') then
        alter table public.triangulaciones add constraint triangulaciones_anc_pedido
            check ((anc_pedido_id is null or anc_pedido_id ~ '^[0-9]{1,12}$') and (anc_token is null or length(anc_token) between 8 and 200));
    end if;
end;
$$;

-- 2) Pedidos de ANC cuyos accesos falta leer (n8n los revisa cada minuto, el más antiguo primero).
--    Marca la revisión para repartir: a lo sumo 5 por minuto y cada uno cada 2 minutos como máximo.
drop function if exists public.triangulaciones_anc_esperando();
create function public.triangulaciones_anc_esperando()
returns table (referencia text, anc_pedido_id text, anc_token text, resume_url text, producto text, variante text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    return query
    with elegidas as (
        select t.id
        from public.triangulaciones t
        where t.esperando = 'CREDENCIALES'
          and t.anc_pedido_id is not null and t.anc_token is not null and t.resume_url is not null
          and (t.anc_revisado_at is null or t.anc_revisado_at < now() - interval '2 minutes')
        order by t.anc_revisado_at nulls first, t.id
        limit 5
        for update skip locked
    )
    update public.triangulaciones t
       set anc_revisado_at = now()
      from elegidas e
     where t.id = e.id
    returning t.referencia, t.anc_pedido_id, t.anc_token, t.resume_url, t.producto, t.variante;
end;
$$;
revoke all on function public.triangulaciones_anc_esperando() from public, anon, authenticated;
grant execute on function public.triangulaciones_anc_esperando() to service_role;

-- Resultado
select count(*) filter (where canal_compra = 'web') as pedidos_web,
       count(*) filter (where anc_pedido_id is not null and esperando = 'CREDENCIALES') as esperando_accesos_anc,
       to_regprocedure('public.triangulaciones_anc_esperando()') is not null as compra_web_lista
from public.triangulaciones;
