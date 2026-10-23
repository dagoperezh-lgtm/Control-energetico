-- =====================================================================
-- Control de Peso — esquema Supabase (PostgreSQL)
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
--
-- Principios de registro histórico:
--  1. Nada se sobrescribe sin dejar rastro: toda inserción, edición o
--     borrado queda en la tabla `historial_cambios` (trigger de auditoría).
--  2. Los parámetros del perfil (estatura, fórmula de basal, carbos/h,
--     meta, FC) tienen vigencia por fecha (`parametros_perfil`). Cada día
--     se calcula con los parámetros vigentes en esa fecha, igual que la
--     planilla mantenía la edad 51 y luego 54 por fila.
--  3. Cada consumo guarda una copia de kcal y carbos del alimento al
--     momento de registrarlo: corregir el catálogo no altera días pasados.
--  4. El histórico importado de la planilla se archiva tal cual en
--     `historico_planilla` (todas las columnas de la hoja Datos).
-- =====================================================================

-- ---------- Perfiles ----------
create table if not exists public.perfiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  nombre           text not null default '',
  sexo             text not null default 'M' check (sexo in ('M','F')),
  fecha_nacimiento date,
  inicio_etapa     date,               -- referencia de "variación acumulada"
  es_admin         boolean not null default false,
  creado_en        timestamptz not null default now()
);

-- Parámetros con vigencia desde una fecha (historial de parámetros)
create table if not exists public.parametros_perfil (
  id              bigint generated always as identity primary key,
  usuario_id      uuid not null references public.perfiles(id) on delete cascade,
  vigente_desde   date not null,
  estatura_cm     numeric(5,1) not null,
  formula_basal   text not null default 'harris_benedict'
                  check (formula_basal in ('harris_benedict','katch_mcardle')),
  carbos_por_hora numeric(6,1) not null default 40,   -- g/h de entrenamiento
  meta_kcal       numeric(7,1) not null default 1200, -- meta diaria de ingesta
  fc_reposo       int,                                 -- FC mínima / reposo
  fc_maxima       int,
  edad_fija       int,     -- opcional: replica la edad fija de la planilla
  nota            text,
  creado_en       timestamptz not null default now(),
  unique (usuario_id, vigente_desde)
);

-- ---------- Mediciones corporales ----------
create table if not exists public.mediciones (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  fecha       date not null,
  peso_kg     numeric(6,2) not null check (peso_kg > 0),
  grasa_pct   numeric(5,2) check (grasa_pct >= 0 and grasa_pct < 100), -- en %
  origen      text not null default 'manual'
              check (origen in ('manual','balanza','interpolado','importado')),
  nota        text,
  creado_en   timestamptz not null default now(),
  unique (usuario_id, fecha)
);

-- ---------- Catálogo de alimentos ----------
create table if not exists public.alimentos (
  id           bigint generated always as identity primary key,
  propietario  uuid references public.perfiles(id) on delete set null,
  alcance      text not null default 'personal'
               check (alcance in ('personal','propuesto','compartido')),
  nombre       text not null,
  kcal         numeric(7,1) not null,   -- por porción
  carbos_g     numeric(7,1) not null default 0,
  porcion      text not null default '1 porción',
  fuente       text not null default 'propia'
               check (fuente in ('propia','planilla','openfoodfacts','usda')),
  codigo_barra text,
  ref_externa  text,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now()
);
create index if not exists alimentos_nombre_idx on public.alimentos (lower(nombre));
create unique index if not exists alimentos_compartido_nombre_uq
  on public.alimentos (lower(nombre)) where alcance = 'compartido';

-- ---------- Consumos (registro por comida) ----------
create table if not exists public.consumos (
  id           bigint generated always as identity primary key,
  usuario_id   uuid not null references public.perfiles(id) on delete cascade,
  fecha        date not null,
  comida       text not null check (comida in ('desayuno','almuerzo','once_cena','colacion','total_dia')),
  alimento_id  bigint references public.alimentos(id) on delete set null,
  nombre       text not null,            -- copia al momento del registro
  kcal_unidad  numeric(7,1) not null,    -- copia al momento del registro
  carbos_unidad numeric(7,1) not null default 0,
  cantidad     numeric(7,2) not null default 1,
  origen       text not null default 'manual' check (origen in ('manual','importado')),
  creado_en    timestamptz not null default now()
);
create index if not exists consumos_usuario_fecha_idx on public.consumos (usuario_id, fecha);

-- ---------- Actividades (entrenamiento) ----------
create table if not exists public.actividades (
  id           bigint generated always as identity primary key,
  usuario_id   uuid not null references public.perfiles(id) on delete cascade,
  fecha        date not null,
  deporte      text not null check (deporte in ('ciclismo','trote','natacion','otro')),
  duracion_min numeric(7,1) not null default 0,
  distancia_km numeric(8,2),
  kcal         numeric(7,1),            -- null = se estima con el modelo propio
  fc_media     int,
  origen       text not null default 'manual'
               check (origen in ('manual','importado','strava','apple_health')),
  nota         text,
  creado_en    timestamptz not null default now()
);
create index if not exists actividades_usuario_fecha_idx on public.actividades (usuario_id, fecha);

-- ---------- Archivo íntegro de la planilla importada ----------
create table if not exists public.historico_planilla (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  fecha       date not null,
  datos       jsonb not null,           -- todas las columnas de la hoja Datos
  calidad     jsonb not null default '{}'::jsonb,  -- banderas de calidad
  importado_en timestamptz not null default now(),
  unique (usuario_id, fecha)
);

-- ---------- Historial de cambios (auditoría) ----------
create table if not exists public.historial_cambios (
  id          bigint generated always as identity primary key,
  usuario_id  uuid,
  tabla       text not null,
  registro_id text not null,
  operacion   text not null,           -- INSERT / UPDATE / DELETE
  antes       jsonb,
  despues     jsonb,
  en          timestamptz not null default now()
);
create index if not exists historial_usuario_idx on public.historial_cambios (usuario_id, en desc);

create or replace function public.registrar_cambio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fila jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  uid uuid := coalesce(auth.uid(),
                       nullif(fila->>'usuario_id','')::uuid,
                       nullif(fila->>'propietario','')::uuid);
begin
  -- Las importaciones masivas no se auditan fila a fila (quedan en historico_planilla)
  if tg_op = 'INSERT' and fila->>'origen' = 'importado' then
    return new;
  end if;
  insert into public.historial_cambios(usuario_id, tabla, registro_id, operacion, antes, despues)
  values (uid, tg_table_name, fila->>'id', tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['mediciones','consumos','actividades','alimentos','parametros_perfil','perfiles'] loop
    execute format('drop trigger if exists auditoria on public.%I', t);
    execute format('create trigger auditoria after insert or update or delete on public.%I
                    for each row execute function public.registrar_cambio()', t);
  end loop;
end $$;

-- ---------- Alta automática de perfil al registrarse ----------
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles(id, nombre) values (new.id, coalesce(new.raw_user_meta_data->>'nombre', ''))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists al_registrarse on auth.users;
create trigger al_registrarse after insert on auth.users
  for each row execute function public.crear_perfil();

create or replace function public.soy_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select es_admin from public.perfiles where id = auth.uid()), false)
$$;

-- ---------- Seguridad por fila (cada usuario ve solo lo suyo) ----------
alter table public.perfiles           enable row level security;
alter table public.parametros_perfil  enable row level security;
alter table public.mediciones         enable row level security;
alter table public.alimentos          enable row level security;
alter table public.consumos           enable row level security;
alter table public.actividades        enable row level security;
alter table public.historico_planilla enable row level security;
alter table public.historial_cambios  enable row level security;

drop policy if exists propio on public.perfiles;
create policy propio on public.perfiles for all
  using (id = auth.uid()) with check (id = auth.uid() and (es_admin = false or public.soy_admin()));

do $$
declare t text;
begin
  foreach t in array array['parametros_perfil','mediciones','consumos','actividades','historico_planilla'] loop
    execute format('drop policy if exists propio on public.%I', t);
    execute format('create policy propio on public.%I for all
                    using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())', t);
  end loop;
end $$;

drop policy if exists leer_historial on public.historial_cambios;
create policy leer_historial on public.historial_cambios for select using (usuario_id = auth.uid());

-- Alimentos: compartidos visibles para todos; personales y propuestos solo para su dueño.
drop policy if exists ver_alimentos on public.alimentos;
create policy ver_alimentos on public.alimentos for select
  using (alcance = 'compartido' or propietario = auth.uid() or public.soy_admin());
drop policy if exists crear_alimentos on public.alimentos;
create policy crear_alimentos on public.alimentos for insert
  with check (propietario = auth.uid() and (alcance <> 'compartido' or public.soy_admin()));
drop policy if exists editar_alimentos on public.alimentos;
create policy editar_alimentos on public.alimentos for update
  using ((propietario = auth.uid() and alcance <> 'compartido') or public.soy_admin())
  with check (alcance <> 'compartido' or public.soy_admin());
drop policy if exists borrar_alimentos on public.alimentos;
create policy borrar_alimentos on public.alimentos for delete
  using ((propietario = auth.uid() and alcance <> 'compartido') or public.soy_admin());

-- Después de crear tu cuenta en la app, conviértete en administrador del catálogo:
--   update public.perfiles set es_admin = true where id = (select id from auth.users where email = 'TU_CORREO');
