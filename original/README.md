# Mirror of the original site

Static copy of the original storefront (pages, CSS/JS, fonts, all images).

- Storefront data (products, categories, cart) is served by the Zappy API.
  The browser blocks direct calls from other domains (CORS), so all API calls
  go to `/zapi/...`, which `vercel.json` rewrites to `https://api.zappy5.com/...`.
- Deploy on Vercel: set **Root Directory** to `original` (no build command).
- Test locally: `python serve_local.py 8767` then open http://127.0.0.1:8767/
- Known limit: the API only accepts browser requests that come from domains
  allowed in the Zappy account. Browsing works; cart/checkout/contact POSTs need
  the new domain to be added in Zappy, or they return 403.
- Windows: `git config core.longpaths true` before cloning.
