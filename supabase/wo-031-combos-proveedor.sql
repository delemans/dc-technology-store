-- =====================================================================
-- WO-031 · Compra automática al proveedor para COMBOS (triangulación de varias plataformas)
-- Requiere: wo-024-triangulacion.sql y wo-026-triangulacion-panel.sql. Idempotente.
--
-- Modelo: un combo es una triangulación PADRE (DC-XXXXX, es_combo) con una línea HIJA por plataforma
-- (DC-XXXXX1, DC-XXXXX2…). Cada hija se vincula al panel con vincular_triangulacion() → un pedido y una
-- compra por plataforma, con su garantía. El padre lleva la conversación con el proveedor (una
-- cotización, un #pago, un mensaje de accesos) y las esperas de n8n.
--
-- Decisiones del director (WO-030):
--   · Si una plataforma falla (agotada, accesos ilegibles o con baja confianza) las demás se entregan
--     y la fallida queda en REVISION_MANUAL ("En revisión") para ofrecer cambio o reembolso parcial.
--   · Control de margen: si el costo del proveedor supera lo cobrado al cliente (o no se puede leer),
--     el padre queda con pago_pausado = true y n8n NO reenvía el #pago al proveedor salvo que el
--     administrador lo fuerce explícitamente (#pago DC-XXXXX forzar).
-- =====================================================================

-- 0) Verificación previa: si falta wo-024 o wo-026, se detiene ANTES de crear nada y dice qué falta
do $$
declare
    v_faltan text[] := '{}';
    c text;
begin
    if to_regclass('public.triangulaciones') is null then
        raise exception 'Nada se aplicó. Falta la tabla public.triangulaciones: aplica primero wo-024-triangulacion.sql y luego wo-026-triangulacion-panel.sql.';
    end if;
    foreach c in array array['pedido_id', 'compra_id', 'vinculo_error'] loop
        if not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'triangulaciones' and column_name = c) then
            v_faltan := array_append(v_faltan, 'columna triangulaciones.' || c);
        end if;
    end loop;
    if to_regprocedure('public.vincular_triangulacion(text)') is null then
        v_faltan := array_append(v_faltan, 'función vincular_triangulacion()'::text);
    end if;
    if to_regprocedure('public.avanzar_compra_triangulada(text, text, numeric, text)') is null then
        v_faltan := array_append(v_faltan, 'función avanzar_compra_triangulada()'::text);
    end if;
    if array_length(v_faltan, 1) > 0 then
        raise exception 'Nada se aplicó. Falta wo-026-triangulacion-panel.sql (%). Aplícalo y vuelve a ejecutar este archivo.',
            array_to_string(v_faltan, ', ');
    end if;
end;
$$;

alter table public.triangulaciones
    add column if not exists grupo        text,
    add column if not exists es_combo     boolean not null default false,
    add column if not exists pago_pausado boolean not null default false,
    add column if not exists lineas       jsonb;   -- solo el padre: [{referencia, producto, variante, precio_venta}]

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'triangulaciones_grupo_padre') then
        alter table public.triangulaciones add constraint triangulaciones_grupo_padre
            foreign key (grupo) references public.triangulaciones (referencia) on delete cascade;
    end if;
end;
$$;
create index if not exists triangulaciones_grupo on public.triangulaciones (grupo) where grupo is not null;

-- El enrutador de n8n necesita saber qué es combo, qué hijas tiene y si el pago está pausado
drop function if exists public.triangulaciones_abiertas();
create function public.triangulaciones_abiertas()
returns table (referencia text, estado text, esperando text, resume_url text, wamid_cotizacion text,
               wamid_pago text, compra_id text, estado_compra text, grupo text, es_combo boolean, pago_pausado boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select t.referencia, t.estado, t.esperando, t.resume_url, t.wamid_cotizacion, t.wamid_pago, t.compra_id,
           (select c.estado::text from public.compras_proveedor c where c.id::text = t.compra_id),
           t.grupo, t.es_combo, t.pago_pausado
    from public.triangulaciones t
    where t.estado not in ('ENTREGADO', 'CANCELADO', 'VENCIDO', 'AGOTADO')
    order by t.id desc
    limit 80;
$$;
revoke all on function public.triangulaciones_abiertas() from public, anon, authenticated;
grant execute on function public.triangulaciones_abiertas() to service_role;

-- Actualiza las líneas de un combo en una sola llamada (n8n, credencial de servidor).
-- p_lineas: [{ referencia, estado?, costo?, notas?, credencial_final?, confianza?, panel?, clave? }]
--   panel = 'PEDIDO_REALIZADO' | 'ENTREGADO' → avanzar_compra_triangulada() de esa línea (wo-026).
drop function if exists public.actualizar_lineas_combo(text, jsonb);
create function public.actualizar_lineas_combo(p_grupo text, p_lineas jsonb)
returns table (referencia text, ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    l   jsonb;
    v_ref text;
    r   record;
begin
    if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
        return;
    end if;
    for l in select * from jsonb_array_elements(p_lineas) loop
        v_ref := l->>'referencia';
        if not exists (select 1 from public.triangulaciones t where t.referencia = v_ref and t.grupo = p_grupo) then
            return query select v_ref, false, 'La línea no pertenece a este combo.';
            continue;
        end if;
        update public.triangulaciones t
           set estado = coalesce(l->>'estado', t.estado),
               costo_proveedor = coalesce((l->>'costo')::numeric, t.costo_proveedor),
               notas = coalesce(left(l->>'notas', 500), t.notas),
               credencial_final = coalesce(right(l->>'credencial_final', 4), t.credencial_final),
               confianza = coalesce((l->>'confianza')::numeric, t.confianza)
         where t.referencia = v_ref;
        if l->>'panel' in ('PEDIDO_REALIZADO', 'ENTREGADO') then
            select * into r from public.avanzar_compra_triangulada(v_ref, l->>'panel', (l->>'costo')::numeric, l->>'clave');
            return query select v_ref, coalesce(r.ok, false), coalesce(r.mensaje, 'sin respuesta');
        else
            return query select v_ref, true, 'Línea actualizada.';
        end if;
    end loop;
end;
$$;
revoke all on function public.actualizar_lineas_combo(text, jsonb) from public, anon, authenticated;
grant execute on function public.actualizar_lineas_combo(text, jsonb) to service_role;

-- Verificación
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'triangulaciones' and column_name in ('grupo', 'es_combo', 'pago_pausado', 'lineas')
order by column_name;
