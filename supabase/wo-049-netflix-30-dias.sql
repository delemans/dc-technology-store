-- =====================================================================
-- WO-049 · Netflix: el plan pasa de 26 a 30 días (22/10/2026, ANC cambió la duración; el precio ya estaba al día)
--   Renombra las variantes en catalogo_precios conservando precio, costo y estado. Los pedidos anteriores conservan
--   el nombre con el que se vendieron (su garantía y su renovación se calculan con lo que compró cada cliente).
-- Requiere wo-032 (catalogo_precios). Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.catalogo_precios') is null then
        raise exception 'Nada se aplicó. Falta public.catalogo_precios: aplica antes wo-032-fase3.sql.';
    end if;
end;
$$;

update public.catalogo_precios c
   set variante = replace(c.variante, '26 días', '30 días'), updated_at = now()
 where c.producto_id = 'netflix'
   and c.variante like '%26 días'
   and not exists (select 1 from public.catalogo_precios x
                    where x.producto_id = c.producto_id and x.variante = replace(c.variante, '26 días', '30 días'));

-- Verificación: deben quedar las variantes de Netflix con "30 días" y ninguna con "26 días"
select producto_id, variante, precio, activo from public.catalogo_precios where producto_id = 'netflix' order by variante;
