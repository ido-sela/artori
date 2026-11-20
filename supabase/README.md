# Artori – Supabase backend

Project: `qeolqmcqffiycwicyaas` (https://qeolqmcqffiycwicyaas.supabase.co)

## Schema (already applied)
Tables: `categories`, `products`, `orders`, `order_items`, `site_settings`, `admins`.
- The public can only read active categories/products and site settings.
- Orders and order items have no public policy. They are written only by the server (Edge Function with the service role) and read by admins.
- `public.is_admin()` checks the `admins` table. Admins get full access to everything and to the `products` storage bucket.
- Storage bucket `products` (public read, admin write) holds product images.

## Seed
- Categories (49): already imported.
- Products (120): run `seed_products_1.sql` … `seed_products_4.sql` in order in the Supabase SQL Editor.
  The files are idempotent (`on conflict (slug) do nothing`).

## Make a user an admin
1. Dashboard → Authentication → Users → Add user (email + password).
2. In the SQL Editor:
   `insert into public.admins (user_id) select id from auth.users where email = 'CLIENT_EMAIL';`

Never put the service_role key in the site code. Only the publishable (anon) key goes in the browser.
