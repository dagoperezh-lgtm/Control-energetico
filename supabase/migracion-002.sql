-- =====================================================================
-- Migración 002: fórmula Mifflin-St Jeor y ajuste personal del gasto basal
-- Ejecutar una vez en: Supabase > SQL Editor > New snippet > Run
-- Es segura de repetir y no modifica datos existentes.
-- =====================================================================

alter table public.parametros_perfil
  add column if not exists ajuste_basal_pct numeric(5,1) not null default 0
  check (ajuste_basal_pct between -40 and 40);

alter table public.parametros_perfil drop constraint if exists parametros_perfil_formula_basal_check;
alter table public.parametros_perfil add constraint parametros_perfil_formula_basal_check
  check (formula_basal in ('harris_benedict','mifflin_st_jeor','katch_mcardle'));
