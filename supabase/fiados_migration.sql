-- Mister Inventario · Cuenta de fiado: movimientos, abonos y WhatsApp
-- Ejecutar DESPUÉS de ventas_migration.sql. Se puede volver a ejecutar sin perder datos.
--
-- Qué hace:
--   1. Los abonos guardan cómo se pagaron (efectivo o transferencia) y quién los recibió.
--   2. La cajera y el dueño pueden registrar abonos.
--   3. Cartola del cliente: fiados (con productos) y abonos, para la cajera y el dueño.
--   4. La cajera puede agregar o corregir el WhatsApp de un cliente.
--   5. El efectivo esperado al cerrar la caja suma los abonos pagados en efectivo.
--   6. Fiado manual: anotar una deuda sin pasar por la caja (ej. cuaderno antiguo), con fecha.
--   7. Abonos y fiados manuales pueden llevar una fecha anterior.

alter table public.customer_payments add column if not exists payment_method text not null default 'cash';
alter table public.customer_payments add column if not exists received_by text not null default '';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_payments_method_check') then
    alter table public.customer_payments add constraint customer_payments_method_check check (payment_method in ('cash', 'transfer'));
  end if;
end;
$$;
create index if not exists customer_payments_customer_idx on public.customer_payments(company_id, customer_id, paid_at desc);
create index if not exists sales_customer_idx on public.sales(company_id, customer_id, created_at desc);

-- 1 y 2. Registrar abono (con fecha opcional) ---------------------------------------------
drop function if exists public.record_customer_payment(text, integer);
drop function if exists public.record_customer_payment(text, integer, text, text);
create or replace function public.record_customer_payment(
  payment_customer text,
  payment_amount integer,
  paid_with text default 'cash',
  received_name text default '',
  paid_on timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  new_balance integer;
begin
  if tenant_id is null or not public.is_company_member(tenant_id) then raise exception 'not authorized'; end if;
  if payment_amount is null or payment_amount <= 0 then raise exception 'invalid payment'; end if;
  if paid_with not in ('cash', 'transfer') then raise exception 'invalid payment method'; end if;
  if paid_on is not null and paid_on > now() + interval '1 day' then raise exception 'payment date cannot be in the future'; end if;
  update public.customers set balance = balance - payment_amount
  where id = payment_customer and company_id = tenant_id and balance >= payment_amount
  returning balance into new_balance;
  if new_balance is null then raise exception 'payment exceeds outstanding balance'; end if;
  insert into public.customer_payments (company_id, customer_id, amount, payment_method, received_by, paid_at)
  values (tenant_id, payment_customer, payment_amount, paid_with, left(coalesce(received_name, ''), 80), coalesce(paid_on, now()));
  return new_balance;
end;
$$;

-- 6. Fiado manual -------------------------------------------------------------------------
create table if not exists public.customer_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  amount integer not null check (amount > 0),
  description text not null default '',
  charged_at timestamptz not null default now(),
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists customer_charges_customer_idx on public.customer_charges(company_id, customer_id, charged_at desc);
alter table public.customer_charges enable row level security;
revoke all on public.customer_charges from anon, authenticated;
grant select on public.customer_charges to authenticated;
drop policy if exists customer_charges_member_read on public.customer_charges;
create policy customer_charges_member_read on public.customer_charges for select to authenticated
  using (public.is_company_member(company_id));

-- La cajera respeta el límite de crédito; el dueño puede anotar sobre el límite (deudas antiguas).
create or replace function public.record_customer_charge(
  target_customer text,
  charge_amount integer,
  charge_note text default '',
  charge_date timestamptz default null,
  created_name text default ''
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  is_admin boolean;
  new_balance integer;
begin
  if tenant_id is null or not public.is_company_member(tenant_id) then raise exception 'not authorized'; end if;
  if charge_amount is null or charge_amount <= 0 then raise exception 'invalid amount'; end if;
  if charge_date is not null and charge_date > now() + interval '1 day' then raise exception 'charge date cannot be in the future'; end if;
  is_admin := public.has_company_role(tenant_id, array['owner', 'admin']);
  update public.customers set balance = balance + charge_amount
  where id = target_customer and company_id = tenant_id and (is_admin or balance + charge_amount <= credit_limit)
  returning balance into new_balance;
  if new_balance is null then raise exception 'credit limit exceeded or customer not found'; end if;
  insert into public.customer_charges (company_id, customer_id, amount, description, charged_at, created_by)
  values (tenant_id, target_customer, charge_amount, left(coalesce(trim(charge_note), ''), 200), coalesce(charge_date, now()), left(coalesce(created_name, ''), 80));
  return new_balance;
end;
$$;

-- 3. Cartola del cliente ------------------------------------------------------------------
create or replace function public.get_customer_statement(target_customer text)
returns table (kind text, movement_id text, happened_at timestamptz, amount integer, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare tenant_id uuid := public.current_company_id();
begin
  if tenant_id is null or not public.is_company_member(tenant_id) then raise exception 'not authorized'; end if;
  return query
  select * from (
    select 'fiado'::text, sale.id, sale.created_at, sale.total,
           coalesce(string_agg(item.quantity || ' × ' || item.name, ', ' order by item.name), '')
    from public.sales as sale
    left join public.sale_items as item on item.sale_id = sale.id
    where sale.company_id = tenant_id and sale.customer_id = target_customer and sale.payment_method = 'credit'
    group by sale.id, sale.created_at, sale.total
    union all
    select 'fiado'::text, charge.id::text, charge.charged_at, charge.amount,
           coalesce(nullif(charge.description, ''), 'Fiado anotado a mano')
           || (case when charge.created_by <> '' then ' · anotó ' || charge.created_by else '' end)
    from public.customer_charges as charge
    where charge.company_id = tenant_id and charge.customer_id = target_customer
    union all
    select 'abono'::text, payment.id::text, payment.paid_at, payment.amount,
           (case payment.payment_method when 'transfer' then 'Transferencia' else 'Efectivo' end)
           || (case when payment.received_by <> '' then ' · recibió ' || payment.received_by else '' end)
    from public.customer_payments as payment
    where payment.company_id = tenant_id and payment.customer_id = target_customer
  ) as movements
  order by 3 desc
  limit 300;
end;
$$;

-- 4. WhatsApp del cliente -----------------------------------------------------------------
create or replace function public.set_customer_phone(target_customer text, new_phone text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare tenant_id uuid := public.current_company_id();
begin
  if tenant_id is null or not public.is_company_member(tenant_id) then raise exception 'not authorized'; end if;
  update public.customers set phone = left(trim(coalesce(new_phone, '')), 30)
  where id = target_customer and company_id = tenant_id;
  if not found then raise exception 'customer not found'; end if;
end;
$$;

-- 5. Efectivo esperado incluye abonos en efectivo -----------------------------------------
create or replace function public.get_cashier_expected_cash(target_session uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  session_row public.cash_sessions%rowtype;
  cash_sales integer;
  cash_payments integer;
begin
  if tenant_id is null or not public.has_company_role(tenant_id, array['owner', 'admin', 'cashier']) then
    raise exception 'not authorized to close this register';
  end if;
  select * into session_row from public.cash_sessions
  where id = target_session and company_id = tenant_id and status = 'open';
  if not found then raise exception 'open register not found'; end if;

  select coalesce(sum(total), 0)::integer into cash_sales from public.sales
  where company_id = tenant_id and payment_method = 'cash' and created_at >= session_row.opened_at;
  select coalesce(sum(amount), 0)::integer into cash_payments from public.customer_payments
  where company_id = tenant_id and payment_method = 'cash' and paid_at >= session_row.opened_at;
  return session_row.opening_amount + cash_sales + cash_payments;
end;
$$;

revoke all on function public.record_customer_payment(text, integer, text, text, timestamptz) from public;
revoke all on function public.record_customer_charge(text, integer, text, timestamptz, text) from public;
revoke all on function public.get_customer_statement(text) from public;
revoke all on function public.set_customer_phone(text, text) from public;
revoke all on function public.get_cashier_expected_cash(uuid) from public;
grant execute on function public.record_customer_payment(text, integer, text, text, timestamptz) to authenticated;
grant execute on function public.record_customer_charge(text, integer, text, timestamptz, text) to authenticated;
grant execute on function public.get_customer_statement(text) to authenticated;
grant execute on function public.set_customer_phone(text, text) to authenticated;
grant execute on function public.get_cashier_expected_cash(uuid) to authenticated;

notify pgrst, 'reload schema';
