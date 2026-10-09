create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  rut text not null,
  legal_name text not null,
  business text not null,
  address text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'cashier')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id),
  unique (user_id)
);

create table if not exists public.company_signup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  rut text not null,
  legal_name text not null,
  business text not null,
  address text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  notification_sent_at timestamptz
);

create table if not exists public.suppliers (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  rut text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);

alter table public.products add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists supplier_id text;
alter table public.customers add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.employees add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.sales add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.sale_items add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.cash_sessions add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.customer_payments add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.companies add column if not exists order_whatsapp text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_supplier_company_fkey') then
    alter table public.products add constraint products_supplier_company_fkey
      foreign key (supplier_id, company_id) references public.suppliers(id, company_id);
  end if;
end;
$$;

create unique index if not exists products_id_company_id_key on public.products(id, company_id);
create table if not exists public.product_financials (
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id text not null,
  cost_price integer not null check (cost_price >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, product_id),
  foreign key (product_id, company_id) references public.products(id, company_id) on delete cascade
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_company_read on storage.objects;
create policy product_images_company_read on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and split_part(name, '/', 1) = public.current_company_id()::text and public.is_company_member(public.current_company_id()));
drop policy if exists product_images_company_insert on storage.objects;
create policy product_images_company_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and split_part(name, '/', 1) = public.current_company_id()::text and public.has_company_role(public.current_company_id(), array['owner', 'admin', 'cashier']));
drop policy if exists product_images_company_update on storage.objects;
create policy product_images_company_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and split_part(name, '/', 1) = public.current_company_id()::text and public.has_company_role(public.current_company_id(), array['owner', 'admin', 'cashier']))
  with check (bucket_id = 'product-images' and split_part(name, '/', 1) = public.current_company_id()::text and public.has_company_role(public.current_company_id(), array['owner', 'admin', 'cashier']));
drop policy if exists product_images_company_delete on storage.objects;
create policy product_images_company_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and split_part(name, '/', 1) = public.current_company_id()::text and public.has_company_role(public.current_company_id(), array['owner', 'admin', 'cashier']));

do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname from pg_constraint
    where conrelid = 'public.products'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (sku)'
  loop
    execute format('alter table public.products drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

create unique index if not exists products_company_sku_key on public.products(company_id, sku);
create index if not exists products_company_id_idx on public.products(company_id);
create index if not exists customers_company_id_idx on public.customers(company_id);
create index if not exists employees_company_id_idx on public.employees(company_id);
create index if not exists sales_company_id_created_at_idx on public.sales(company_id, created_at desc);
create index if not exists sale_items_company_id_idx on public.sale_items(company_id);
create index if not exists cash_sessions_company_id_status_idx on public.cash_sessions(company_id, status);
create index if not exists customer_payments_company_id_idx on public.customer_payments(company_id);
create index if not exists product_financials_company_id_idx on public.product_financials(company_id);
create index if not exists suppliers_company_id_name_idx on public.suppliers(company_id, name);

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id from public.company_members where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company and user_id = auth.uid()
  );
$$;

create or replace function public.has_company_role(target_company uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company and user_id = auth.uid() and role = any(allowed_roles)
  );
$$;

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
  if tenant_id is null or not public.has_company_role(tenant_id, array['owner', 'admin']) then
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

create or replace function public.get_cashier_expected_cash(target_session uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  expected_cash integer;
begin
  if tenant_id is null or not public.has_company_role(tenant_id, array['owner', 'admin', 'cashier']) then
    raise exception 'not authorized to close this register';
  end if;

  select session.opening_amount + coalesce(sum(sale.total) filter (where sale.payment_method = 'cash'), 0)::integer
  into expected_cash
  from public.cash_sessions as session
  left join public.sales as sale
    on sale.company_id = session.company_id
    and sale.created_at >= session.opened_at
  where session.id = target_session
    and session.company_id = tenant_id
    and session.status = 'open'
  group by session.opening_amount;

  if expected_cash is null then raise exception 'open register not found'; end if;
  return expected_cash;
end;
$$;

create or replace function public.list_supplier_contacts()
returns table (id text, name text, phone text, whatsapp text, active boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select supplier.id, supplier.name, supplier.phone, supplier.whatsapp, supplier.active
  from public.suppliers as supplier
  where supplier.company_id = public.current_company_id()
    and public.is_company_member(supplier.company_id)
    and supplier.active;
$$;

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
  if store_rut is null or store_name is null or store_business is null or store_address is null then
    raise exception 'RUT, razón social, giro y dirección son obligatorios para crear el almacén';
  end if;

  insert into public.company_signup_requests (user_id, email, rut, legal_name, business, address)
  values (new.id, new.email, store_rut, store_name, store_business, store_address);
  return new;
end;
$$;

create or replace function public.get_my_signup_status()
returns table (status text, rejection_note text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select request.status, null::text
  from public.company_signup_requests as request
  where request.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.approve_store_signup(request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.company_signup_requests%rowtype;
  created_company uuid;
begin
  if lower(coalesce(auth.jwt()->>'email', '')) <> 'debbie.sepulveda2026@soymas.cl' then
    raise exception 'not authorized to approve store registrations';
  end if;

  select * into request_row
  from public.company_signup_requests
  where id = request_id and status = 'pending'
  for update;
  if not found then raise exception 'request not found or already reviewed'; end if;

  insert into public.companies (rut, legal_name, business, address)
  values (request_row.rut, request_row.legal_name, request_row.business, request_row.address)
  returning id into created_company;

  insert into public.company_members (company_id, user_id, role)
  values (created_company, request_row.user_id, 'owner');

  update public.company_signup_requests
  set status = 'approved', company_id = created_company, reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id;
  return created_company;
end;
$$;

create or replace function public.reject_store_signup(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(auth.jwt()->>'email', '')) <> 'debbie.sepulveda2026@soymas.cl' then
    raise exception 'not authorized to reject store registrations';
  end if;
  update public.company_signup_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id and status = 'pending';
  if not found then raise exception 'request not found or already reviewed'; end if;
end;
$$;

drop trigger if exists create_store_after_signup on auth.users;
create trigger create_store_after_signup
  after insert on auth.users
  for each row execute function public.create_store_for_new_user();

create or replace function public.stamp_company_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare active_company uuid := public.current_company_id();
begin
  if active_company is null then raise exception 'account has no store'; end if;
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'store ownership cannot be changed';
  end if;
  new.company_id := active_company;
  return new;
end;
$$;

drop trigger if exists products_stamp_company on public.products;
create trigger products_stamp_company before insert or update on public.products for each row execute function public.stamp_company_id();
drop trigger if exists customers_stamp_company on public.customers;
create trigger customers_stamp_company before insert or update on public.customers for each row execute function public.stamp_company_id();
drop trigger if exists employees_stamp_company on public.employees;
create trigger employees_stamp_company before insert or update on public.employees for each row execute function public.stamp_company_id();
drop trigger if exists sales_stamp_company on public.sales;
create trigger sales_stamp_company before insert or update on public.sales for each row execute function public.stamp_company_id();
drop trigger if exists sale_items_stamp_company on public.sale_items;
create trigger sale_items_stamp_company before insert or update on public.sale_items for each row execute function public.stamp_company_id();
drop trigger if exists cash_sessions_stamp_company on public.cash_sessions;
create trigger cash_sessions_stamp_company before insert or update on public.cash_sessions for each row execute function public.stamp_company_id();
drop trigger if exists customer_payments_stamp_company on public.customer_payments;
create trigger customer_payments_stamp_company before insert or update on public.customer_payments for each row execute function public.stamp_company_id();

create or replace function public.sync_sale(sale_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  inserted_count integer;
  sale_total integer := (sale_payload->>'total')::integer;
  sale_customer text := nullif(sale_payload->>'customer_id', '');
  sale_payment text := sale_payload->>'payment_method';
  line jsonb;
begin
  if tenant_id is null or sale_payload->>'company_id' <> tenant_id::text then
    raise exception 'sale does not belong to the active store';
  end if;

  insert into public.sales (id, company_id, created_at, total, payment_method, customer_id, cashier_name, synced)
  values (
    sale_payload->>'id', tenant_id, (sale_payload->>'created_at')::timestamptz, sale_total,
    sale_payment, sale_customer, sale_payload->>'cashier_name', true
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return; end if;

  for line in select value from jsonb_array_elements(sale_payload->'items') loop
    insert into public.sale_items (sale_id, company_id, product_id, name, quantity, unit_price)
    values (
      sale_payload->>'id', tenant_id, line->>'product_id', line->>'name',
      (line->>'quantity')::integer, (line->>'unit_price')::integer
    );
    update public.products set stock = greatest(0, stock - (line->>'quantity')::integer)
    where id = line->>'product_id' and company_id = tenant_id;
  end loop;

  if sale_payment = 'credit' then
    update public.customers set balance = balance + sale_total
    where id = sale_customer and company_id = tenant_id and balance + sale_total <= credit_limit;
    if not found then raise exception 'credit limit exceeded or customer not found'; end if;
  end if;
end;
$$;

create or replace function public.record_customer_payment(payment_customer text, payment_amount integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tenant_id uuid := public.current_company_id();
  new_balance integer;
begin
  if tenant_id is null or payment_amount <= 0 then raise exception 'invalid payment'; end if;
  update public.customers set balance = balance - payment_amount
  where id = payment_customer and company_id = tenant_id and balance >= payment_amount
  returning balance into new_balance;
  if new_balance is null then raise exception 'payment exceeds outstanding balance'; end if;
  insert into public.customer_payments (company_id, customer_id, amount)
  values (tenant_id, payment_customer, payment_amount);
  return new_balance;
end;
$$;

revoke all on function public.current_company_id() from public;
revoke all on function public.is_company_member(uuid) from public;
revoke all on function public.has_company_role(uuid, text[]) from public;
revoke all on function public.save_product_price(text, integer, numeric) from public;
revoke all on function public.get_cashier_expected_cash(uuid) from public;
revoke all on function public.list_supplier_contacts() from public;
revoke all on function public.create_store_for_new_user() from public;
revoke all on function public.get_my_signup_status() from public;
revoke all on function public.approve_store_signup(uuid) from public;
revoke all on function public.reject_store_signup(uuid) from public;
revoke all on function public.stamp_company_id() from public;
revoke all on function public.sync_sale(jsonb) from public;
revoke all on function public.record_customer_payment(text, integer) from public;
grant execute on function public.current_company_id() to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.has_company_role(uuid, text[]) to authenticated;
grant execute on function public.save_product_price(text, integer, numeric) to authenticated;
grant execute on function public.get_cashier_expected_cash(uuid) to authenticated;
grant execute on function public.list_supplier_contacts() to authenticated;
grant execute on function public.sync_sale(jsonb) to authenticated;
grant execute on function public.record_customer_payment(text, integer) to authenticated;
grant execute on function public.get_my_signup_status() to authenticated;
grant execute on function public.approve_store_signup(uuid) to authenticated;
grant execute on function public.reject_store_signup(uuid) to authenticated;

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.employees enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.customer_payments enable row level security;
alter table public.company_signup_requests enable row level security;
alter table public.product_financials enable row level security;
alter table public.suppliers enable row level security;

revoke all on public.companies, public.company_members from anon, authenticated;
revoke all on public.product_financials from anon, authenticated;
revoke all on public.suppliers from anon, authenticated;
revoke all on public.company_signup_requests from anon, authenticated;
revoke all on public.company_settings from anon, authenticated;
drop policy if exists company_settings_team_read on public.company_settings;
drop policy if exists company_settings_admin_write on public.company_settings;

drop policy if exists company_members_read_own on public.company_members;
create policy company_members_read_own on public.company_members for select to authenticated using (user_id = auth.uid());
drop policy if exists signup_requests_approver_read on public.company_signup_requests;
create policy signup_requests_approver_read on public.company_signup_requests for select to authenticated
  using (lower(coalesce(auth.jwt()->>'email', '')) = 'debbie.sepulveda2026@soymas.cl');
drop policy if exists companies_read_member on public.companies;
create policy companies_read_member on public.companies for select to authenticated using (public.is_company_member(id));
drop policy if exists companies_update_admin on public.companies;
create policy companies_update_admin on public.companies for update to authenticated using (public.has_company_role(id, array['owner', 'admin'])) with check (public.has_company_role(id, array['owner', 'admin']));

drop policy if exists products_read on public.products;
drop policy if exists products_admin_write on public.products;
drop policy if exists products_team_write on public.products;
create policy products_read on public.products for select to authenticated using (public.is_company_member(company_id));
create policy products_team_write on public.products for all to authenticated using (public.has_company_role(company_id, array['owner', 'admin', 'cashier'])) with check (public.has_company_role(company_id, array['owner', 'admin', 'cashier']));

drop policy if exists product_financials_owner_access on public.product_financials;
create policy product_financials_owner_access on public.product_financials for all to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists suppliers_admin_access on public.suppliers;
create policy suppliers_admin_access on public.suppliers for all to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists customers_team_read on public.customers;
drop policy if exists customers_admin_write on public.customers;
create policy customers_team_read on public.customers for select to authenticated using (public.is_company_member(company_id));
create policy customers_admin_write on public.customers for all to authenticated using (public.has_company_role(company_id, array['owner', 'admin'])) with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists employees_team_read on public.employees;
drop policy if exists employees_admin_write on public.employees;
create policy employees_team_read on public.employees for select to authenticated using (public.is_company_member(company_id));
create policy employees_admin_write on public.employees for all to authenticated using (public.has_company_role(company_id, array['owner', 'admin'])) with check (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists sales_team_read on public.sales;
drop policy if exists sales_owner_read on public.sales;
create policy sales_owner_read on public.sales for select to authenticated using (public.has_company_role(company_id, array['owner', 'admin']));
drop policy if exists sale_items_team_read on public.sale_items;
drop policy if exists sale_items_owner_read on public.sale_items;
create policy sale_items_owner_read on public.sale_items for select to authenticated using (public.has_company_role(company_id, array['owner', 'admin']));

drop policy if exists cash_sessions_team_access on public.cash_sessions;
drop policy if exists cash_sessions_admin_access on public.cash_sessions;
drop policy if exists cash_sessions_cashier_select_open on public.cash_sessions;
drop policy if exists cash_sessions_cashier_open on public.cash_sessions;
drop policy if exists cash_sessions_cashier_close on public.cash_sessions;
create policy cash_sessions_admin_access on public.cash_sessions for all to authenticated
  using (public.has_company_role(company_id, array['owner', 'admin']))
  with check (public.has_company_role(company_id, array['owner', 'admin']));
create policy cash_sessions_cashier_select_open on public.cash_sessions for select to authenticated
  using (public.has_company_role(company_id, array['cashier']) and status = 'open');
create policy cash_sessions_cashier_open on public.cash_sessions for insert to authenticated
  with check (public.has_company_role(company_id, array['cashier']) and status = 'open');
create policy cash_sessions_cashier_close on public.cash_sessions for update to authenticated
  using (public.has_company_role(company_id, array['cashier']) and status = 'open')
  with check (public.has_company_role(company_id, array['cashier']) and status = 'closed');
drop policy if exists customer_payments_team_read on public.customer_payments;
create policy customer_payments_team_read on public.customer_payments for select to authenticated using (public.is_company_member(company_id));

grant select on public.companies, public.company_members to authenticated;
grant select on public.company_signup_requests to authenticated;
grant update (rut, legal_name, business, address) on public.companies to authenticated;
grant update (rut, legal_name, business, address, order_whatsapp) on public.companies to authenticated;
grant select, insert, update, delete on public.products, public.customers to authenticated;
grant select, insert, update, delete on public.product_financials to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;
revoke all on public.employees from anon, authenticated;
grant select (id, name, rut, active, company_id, created_at) on public.employees to authenticated;
grant insert (id, name, rut, active, company_id, pin_hash) on public.employees to authenticated;
grant update (id, name, rut, active, company_id, pin_hash) on public.employees to authenticated;
grant delete on public.employees to authenticated;
grant select on public.sales, public.sale_items, public.customer_payments to authenticated;
grant select, insert, update on public.cash_sessions to authenticated;