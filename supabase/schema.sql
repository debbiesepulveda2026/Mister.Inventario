create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  name text not null,
  sku text not null unique,
  category text not null default '',
  price integer not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id text primary key,
  name text not null,
  rut text not null,
  phone text not null default '',
  credit_limit integer not null default 0 check (credit_limit >= 0),
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id text primary key,
  name text not null,
  rut text not null,
  active boolean not null default true,
  pin_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id text primary key,
  created_at timestamptz not null,
  total integer not null check (total >= 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'credit')),
  customer_id text references public.customers(id) on delete set null,
  cashier_name text not null,
  synced boolean not null default true
);

create table if not exists public.sale_items (
  sale_id text not null references public.sales(id) on delete cascade,
  product_id text not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),
  primary key (sale_id, product_id)
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null,
  closed_at timestamptz,
  opening_amount integer not null default 0,
  expected_amount integer,
  actual_amount integer,
  difference integer,
  breakdown jsonb not null default '{}'::jsonb,
  cashier_name text not null,
  status text not null check (status in ('open', 'closed'))
);

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers(id),
  amount integer not null check (amount > 0),
  paid_at timestamptz not null default now()
);

create table if not exists public.company_settings (
  id text primary key,
  rut text not null default '',
  legal_name text not null default '',
  business text not null default '',
  address text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'cashier'))
);

create or replace function public.has_any_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any(allowed_roles)
  );
$$;

create or replace function public.sync_sale(sale_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
  sale_total integer := (sale_payload->>'total')::integer;
  sale_customer text := nullif(sale_payload->>'customer_id', '');
  sale_payment text := sale_payload->>'payment_method';
  line jsonb;
begin
  if not public.has_any_role(array['owner', 'admin', 'cashier']) then
    raise exception 'not authorized';
  end if;

  insert into public.sales (id, created_at, total, payment_method, customer_id, cashier_name, synced)
  values (
    sale_payload->>'id', (sale_payload->>'created_at')::timestamptz, sale_total,
    sale_payment, sale_customer, sale_payload->>'cashier_name', true
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return; end if;

  for line in select value from jsonb_array_elements(sale_payload->'items') loop
    insert into public.sale_items (sale_id, product_id, name, quantity, unit_price)
    values (
      sale_payload->>'id', line->>'product_id', line->>'name',
      (line->>'quantity')::integer, (line->>'unit_price')::integer
    );
    update public.products
    set stock = greatest(0, stock - (line->>'quantity')::integer)
    where id = line->>'product_id';
  end loop;

  if sale_payment = 'credit' then
    update public.customers
    set balance = balance + sale_total
    where id = sale_customer
      and balance + sale_total <= credit_limit;
    if not found then raise exception 'credit limit exceeded or customer not found'; end if;
  end if;
end;
$$;

create or replace function public.record_customer_payment(payment_customer text, payment_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if not public.has_any_role(array['owner', 'admin', 'cashier']) then
    raise exception 'not authorized';
  end if;
  if payment_amount <= 0 then raise exception 'payment must be positive'; end if;

  update public.customers
  set balance = balance - payment_amount
  where id = payment_customer and balance >= payment_amount
  returning balance into new_balance;
  if new_balance is null then raise exception 'payment exceeds outstanding balance'; end if;

  insert into public.customer_payments (customer_id, amount)
  values (payment_customer, payment_amount);
  return new_balance;
end;
$$;

revoke all on function public.has_any_role(text[]) from public;
revoke all on function public.sync_sale(jsonb) from public;
revoke all on function public.record_customer_payment(text, integer) from public;
grant execute on function public.has_any_role(text[]) to authenticated;
grant execute on function public.sync_sale(jsonb) to authenticated;
grant execute on function public.record_customer_payment(text, integer) to authenticated;

alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.employees enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.customer_payments enable row level security;
alter table public.company_settings enable row level security;
alter table public.user_roles enable row level security;

revoke all on table public.employees from anon, authenticated;
grant select (id, name, rut, active, created_at) on public.employees to authenticated;
grant insert (id, name, rut, active, pin_hash) on public.employees to authenticated;
grant update (id, name, rut, active, pin_hash) on public.employees to authenticated;
grant delete on public.employees to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select on public.sales, public.sale_items, public.customer_payments to authenticated;
grant select, insert, update on public.cash_sessions to authenticated;
grant select, insert, update, delete on public.company_settings to authenticated;

drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated
  using (public.has_any_role(array['owner', 'admin', 'cashier']));
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all to authenticated
  using (public.has_any_role(array['owner', 'admin']))
  with check (public.has_any_role(array['owner', 'admin']));

drop policy if exists customers_team_read on public.customers;
create policy customers_team_read on public.customers for select to authenticated
  using (public.has_any_role(array['owner', 'admin', 'cashier']));
drop policy if exists customers_admin_write on public.customers;
create policy customers_admin_write on public.customers for all to authenticated
  using (public.has_any_role(array['owner', 'admin']))
  with check (public.has_any_role(array['owner', 'admin']));

drop policy if exists employees_team_read on public.employees;
create policy employees_team_read on public.employees for select to authenticated
  using (public.has_any_role(array['owner', 'admin', 'cashier']));
drop policy if exists employees_admin_write on public.employees;
create policy employees_admin_write on public.employees for all to authenticated
  using (public.has_any_role(array['owner', 'admin']))
  with check (public.has_any_role(array['owner', 'admin']));

drop policy if exists sales_team_read on public.sales;
create policy sales_team_read on public.sales for select to authenticated
  using (public.has_any_role(array['owner', 'admin', 'cashier']));
drop policy if exists sale_items_team_read on public.sale_items;
create policy sale_items_team_read on public.sale_items for select to authenticated
  using (public.has_any_role(array['owner', 'admin', 'cashier']));

drop policy if exists cash_sessions_team_access on public.cash_sessions;
create policy cash_sessions_team_access on public.cash_sessions for all to authenticated
  using (public.has_any_role(array['owner', 'admin', 'cashier']))
  with check (public.has_any_role(array['owner', 'admin', 'cashier']));
drop policy if exists customer_payments_team_read on public.customer_payments;
create policy customer_payments_team_read on public.customer_payments for select to authenticated
  using (public.has_any_role(array['owner', 'admin', 'cashier']));

drop policy if exists company_settings_team_read on public.company_settings;
create policy company_settings_team_read on public.company_settings for select to authenticated
  using (public.has_any_role(array['owner', 'admin', 'cashier']));
drop policy if exists company_settings_admin_write on public.company_settings;
create policy company_settings_admin_write on public.company_settings for all to authenticated
  using (public.has_any_role(array['owner', 'admin']))
  with check (public.has_any_role(array['owner', 'admin']));

-- Add policies after enabling Supabase Auth and assigning user_roles. Do not expose
-- employee PIN hashes, customer balances, or sales to an unrestricted anon policy.