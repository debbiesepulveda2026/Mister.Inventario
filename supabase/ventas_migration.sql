-- Mister Inventario · Migración para la página de ventas (cajas vinculadas)
-- Ejecutar DESPUÉS de schema.sql y tenant_migration.sql, en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a ejecutar sin romper datos.
--
-- Qué hace:
--   1. Permite que las cajas (página ventas.html) inicien sesión como usuario anónimo
--      sin disparar el registro de almacén.
--   2. Cajas vinculadas con un código temporal que genera el dueño.
--   3. PIN de cajeras verificado en el servidor (bcrypt + bloqueo tras 5 intentos).
--   4. Cajera: puede ver y guardar costos/márgenes y crear clientes de fiado.
--   5. Límite de fiado por defecto para clientes que crea la cajera (lo define el dueño).

create extension if not exists pgcrypto;

-- 1. Registro: ignorar usuarios anónimos (cajas) -----------------------------------------
create or replace function public.create_store_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  store_rut text := nullif(trim(new.raw_user_meta_data->>'rut'), '');
  store_name text := nullif(trim(new.raw_user_meta_data->>'legal_name'), '');
  store_business text := nullif(trim(new.raw_user_meta_data->>'business'), '');
  store_address text := nullif(trim(new.raw_user_meta_data->>'address'), '');
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  if store_rut is null or store_name is null or store_business is null or store_address is null then
    raise exception 'RUT, razón social, giro y dirección son obligatorios para crear el almacén';
  end if;

  insert into public.company_signup_requests (user_id, email, rut, legal_name, business, address)
  values (new.id, new.email, store_rut, store_name, store_business, store_address);
  return new;
end;
$$;

-- 2. Límite de fiado por defecto ---------------------------------------------------------
alter table public.companies add column if not exists default_credit_limit integer not null default 30000;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_default_credit_limit_check') then
    alter table public.companies add constraint companies_default_credit_limit_check check (default_credit_limit >= 0);
  end if;
end;
$$;
grant update (rut, legal_name, business, address, order_whatsapp, default_credit_limit) on public.companies to authenticated;

-- 3. PIN de personal en el servidor ------------------------------------------------------
alter table public.employees add column if not exists pin_set boolean not null default false;
alter table public.employees add column if not exists pin_failed_attempts integer not null default 0;
alter table public.employees add column if not exists pin_locked_until timestamptz;

-- Los PIN antiguos (PBKDF2 calculado en el navegador) no se pueden verificar en el servidor.
-- Se limpian y el dueño debe volver a asignarlos desde Personal.
update public.employees set pin_hash = null, pin_set = false
where pin_hash is not null and pin_hash not like '$2%';
update public.employees set pin_set = (pin_hash is not null);

revoke all on public.employees from anon, authenticated;
grant select (id, name, rut, active, company_id, created_at, pin_set) on public.employees to authenticated;
grant insert (id, name, rut, active, company_id) on public.employees to authenticated;
grant update (id, name, rut, active, company_id) on public.employees to authenticated;
grant delete on public.employees to authenticated;

create or replace function public.set_employee_pin(target_employee text, new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare tenant_id uuid := public.current_company_id();
begin
  if tenant_id is null or not public.has_company_role(tenant_id, array['owner', 'admin']) then
    raise exception 'not authorized to set staff PINs';
  end if;
  if new_pin !~ '^[0-9]{4,8}$' then
    raise exception 'El PIN debe tener entre 4 y 8 dígitos';
  end if;
  update public.employees
  set pin_hash = crypt(new_pin, gen_salt('bf', 8)), pin_set = true, pin_failed_attempts = 0, pin_locked_until = null
  where id = target_employee and company_id = tenant_id;
  if not found then raise exception 'employee not found in active store'; end if;
end;
$$;

-- Devuelve {"ok": true, "id": ..., "name": ...} o {"ok": false, "reason": ...}.
-- No lanza excepción al fallar para que el contador de intentos quede guardado.
create or replace function public.verify_employee_pin(target_employee text, pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  person public.employees%rowtype;
begin
  if tenant_id is null or not public.is_company_member(tenant_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_member');
  end if;
  select * into person from public.employees
  where id = target_employee and company_id = tenant_id
  for update;
  if not found or not person.active then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if person.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;
  if person.pin_locked_until is not null and person.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', person.pin_locked_until);
  end if;
  if crypt(coalesce(pin, ''), person.pin_hash) = person.pin_hash then
    update public.employees set pin_failed_attempts = 0, pin_locked_until = null where id = person.id;
    return jsonb_build_object('ok', true, 'id', person.id, 'name', person.name);
  end if;
  update public.employees
  set pin_failed_attempts = person.pin_failed_attempts + 1,
      pin_locked_until = case when person.pin_failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
  where id = person.id;
  return jsonb_build_object('ok', false, 'reason', case when person.pin_failed_attempts + 1 >= 5 then 'locked' else 'wrong_pin' end);
end;
$$;

-- 4. Cajas vinculadas --------------------------------------------------------------------
create table if not exists public.terminal_link_codes (
  code text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Caja',
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);

create table if not exists public.cash_terminals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null default 'Caja',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.terminal_link_codes enable row level security;
alter table public.cash_terminals enable row level security;
revoke all on public.terminal_link_codes from anon, authenticated;
revoke all on public.cash_terminals from anon, authenticated;
grant select on public.cash_terminals to authenticated;
drop policy if exists cash_terminals_admin_read on public.cash_terminals;
create policy cash_terminals_admin_read on public.cash_terminals for select to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']) or user_id = auth.uid());

create or replace function public.create_terminal_code(terminal_label text default 'Caja')
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  new_code text;
begin
  if tenant_id is null or not public.has_company_role(tenant_id, array['owner', 'admin']) then
    raise exception 'not authorized to link registers';
  end if;
  delete from public.terminal_link_codes where company_id = tenant_id and (expires_at < now() or used_at is not null);
  new_code := upper(encode(gen_random_bytes(4), 'hex'));
  insert into public.terminal_link_codes (code, company_id, created_by, label, expires_at)
  values (new_code, tenant_id, auth.uid(), coalesce(nullif(trim(terminal_label), ''), 'Caja'), now() + interval '15 minutes');
  return new_code;
end;
$$;

create or replace function public.claim_terminal_code(link_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  link public.terminal_link_codes%rowtype;
  existing uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'Solo un equipo de caja puede usar el código';
  end if;
  select company_id into existing from public.company_members where user_id = auth.uid();
  if existing is not null then return existing; end if;

  select * into link from public.terminal_link_codes
  where code = upper(trim(link_code)) and used_at is null and expires_at > now()
  for update;
  if not found then raise exception 'Código inválido o vencido'; end if;

  insert into public.company_members (company_id, user_id, role) values (link.company_id, auth.uid(), 'cashier');
  insert into public.cash_terminals (user_id, company_id, label, last_seen_at) values (auth.uid(), link.company_id, link.label, now())
  on conflict (user_id) do update set company_id = excluded.company_id, label = excluded.label, last_seen_at = now();
  update public.terminal_link_codes set used_at = now(), used_by = auth.uid() where code = link.code;
  return link.company_id;
end;
$$;

create or replace function public.touch_terminal()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.cash_terminals set last_seen_at = now() where user_id = auth.uid();
$$;

create or replace function public.revoke_terminal(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare tenant_id uuid := public.current_company_id();
begin
  if tenant_id is null or not public.has_company_role(tenant_id, array['owner', 'admin']) then
    raise exception 'not authorized to unlink registers';
  end if;
  delete from public.company_members where user_id = target_user and company_id = tenant_id and role = 'cashier';
  delete from public.cash_terminals where user_id = target_user and company_id = tenant_id;
end;
$$;

-- 5. Cajera: costos, márgenes y clientes de fiado ----------------------------------------
drop policy if exists product_financials_owner_access on public.product_financials;
drop policy if exists product_financials_team_access on public.product_financials;
create policy product_financials_team_access on public.product_financials for all to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin', 'cashier']))
  with check (public.has_company_role(company_id, array['owner', 'admin', 'cashier']));

create or replace function public.save_product_price(target_product text, new_cost integer, target_margin numeric)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  final_price integer;
begin
  if tenant_id is null or not public.has_company_role(tenant_id, array['owner', 'admin', 'cashier']) then
    raise exception 'not authorized to manage product costs';
  end if;
  if new_cost < 0 or target_margin < 0 or target_margin >= 100 then
    raise exception 'cost must be nonnegative and margin must be between 0 and 100';
  end if;

  final_price := round(new_cost / (1 - target_margin / 100))::integer;
  update public.products set price = final_price
  where id = target_product and company_id = tenant_id;
  if not found then raise exception 'product not found in active store'; end if;

  insert into public.product_financials (company_id, product_id, cost_price, updated_at)
  values (tenant_id, target_product, new_cost, now())
  on conflict (company_id, product_id) do update
    set cost_price = excluded.cost_price, updated_at = excluded.updated_at;
  return final_price;
end;
$$;

drop policy if exists customers_cashier_insert on public.customers;
create policy customers_cashier_insert on public.customers for insert to authenticated
  with check (public.has_company_role(company_id, array['cashier']));

create or replace function public.customers_cashier_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare tenant_id uuid := public.current_company_id();
begin
  if tenant_id is not null
     and public.has_company_role(tenant_id, array['cashier'])
     and not public.has_company_role(tenant_id, array['owner', 'admin']) then
    select default_credit_limit into new.credit_limit from public.companies where id = tenant_id;
    new.credit_limit := coalesce(new.credit_limit, 0);
    new.balance := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_cashier_defaults on public.customers;
create trigger customers_cashier_defaults before insert on public.customers
  for each row execute function public.customers_cashier_defaults();

-- Permisos de ejecución -------------------------------------------------------------------
revoke all on function public.set_employee_pin(text, text) from public;
revoke all on function public.verify_employee_pin(text, text) from public;
revoke all on function public.create_terminal_code(text) from public;
revoke all on function public.claim_terminal_code(text) from public;
revoke all on function public.touch_terminal() from public;
revoke all on function public.revoke_terminal(uuid) from public;
revoke all on function public.customers_cashier_defaults() from public;
revoke all on function public.create_store_for_new_user() from public;
revoke all on function public.save_product_price(text, integer, numeric) from public;
grant execute on function public.set_employee_pin(text, text) to authenticated;
grant execute on function public.verify_employee_pin(text, text) to authenticated;
grant execute on function public.create_terminal_code(text) to authenticated;
grant execute on function public.claim_terminal_code(text) to authenticated;
grant execute on function public.touch_terminal() to authenticated;
grant execute on function public.revoke_terminal(uuid) to authenticated;
grant execute on function public.save_product_price(text, integer, numeric) to authenticated;
