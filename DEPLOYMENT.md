# Deploying MediGuide (Vercel frontend + Render API)

This is the deployment that previously failed with **"Failed to fetch"** on the Register page.
Follow it top to bottom; every step below is already reflected in the code.

Live URLs for this project:

| Part | URL |
| --- | --- |
| Frontend (Vercel) | `https://medi-guide-care.vercel.app` |
| API (Render) | `https://mediguide-0a1e.onrender.com` |

## How the request flows (important)

```
Browser  ->  https://medi-guide-care.vercel.app/api/auth/register   (same origin)
                        |
                        |  rewrite defined in client/vercel.json
                        v
             https://mediguide-0a1e.onrender.com/api/auth/register
```

The browser only ever talks to **its own origin**. Because of that there is no CORS
preflight, no third-party cookie, and no mixed-content risk. `client/src/api.js` therefore
defaults to the relative base `/api` in production; `VITE_API_URL` is only an optional
override for deployments that expose the API on a different hostname.

## 1. Render (API)

1. Service type: **Web Service**, repository `ravi63052/MediGuideCare`.
2. **Root Directory:** `server`
3. **Build Command:** `npm ci` (or `npm install`)
4. **Start Command:** `npm start`
5. **Health Check Path:** `/api/health`
6. Environment variables (Render dashboard → Environment):

   | Key | Required | Example / notes |
   | --- | --- | --- |
   | `NODE_ENV` | yes | `production` |
   | `MONGODB_URI` | yes | `mongodb+srv://...` (Atlas). Must have no spaces. |
   | `JWT_SECRET` | yes | 32+ random chars. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `CLIENT_ORIGIN` | recommended | `https://medi-guide-care.vercel.app` (comma-separate extra origins). `https://*.vercel.app` preview URLs already work by default. |
   | `APP_URL` | recommended | `https://medi-guide-care.vercel.app` — used in reset/reminder email links |
   | `TRUST_PROXY` | optional | defaults to `1`, correct for Render |
   | `SESSION_COOKIE_SAME_SITE` | optional | leave unset for the recommended same-origin setup. Set to `none` only if the browser calls the API on a *different* hostname. |
   | `RESEND_API_KEY`, `MAIL_FROM`, `GROQ_API`, `GOOGLE_PLACES_API_KEY` | optional | only for email/AI/hospital features |

7. Deploy, then confirm: `curl https://mediguide-0a1e.onrender.com/api/health`
   → `{"status":"ok","service":"MediGuide API","database":"connected"}`

The API prints its effective CORS allow-list on boot:

```
CORS allow-list: https://medi-guide-care.vercel.app, https://mediguide-0a1e.onrender.com, http://localhost:5173, ... + wildcard patterns
```

Note: on Render's free plan the service sleeps after inactivity. The first request can take
~50 seconds. Sign-in keeps the original request alive, shows a non-error waiting notice, and
continues automatically when the API is ready; there is no need to submit the form again.

## 2. Vercel (frontend)

1. Framework preset: **Vite**.
2. **Root Directory:** `client` ← must be `client`, not the repository root.
3. Build Command `npm run build`, Output Directory `dist` (auto-detected).
4. `client/vercel.json` is committed and provides:
   - `/api/:path*` → `https://mediguide-0a1e.onrender.com/api/:path*` (the same-origin proxy)
   - a catch-all rewrite to `/index.html` so `/register`, `/profile`, `/appointments`, etc.
     survive a refresh/deep link instead of returning Vercel's 404 page
   - long-lived caching for hashed assets plus basic security headers
5. Environment variables: **leave `VITE_API_URL` unset.** Vite inlines env vars at build
   time, so any change requires a fresh deployment (no "Redeploy without cache" needed, but a
   plain redeploy is required).

   If you must point at a different API, set `VITE_API_URL=https://your-api.example.com/api`
   (HTTPS, include `/api`). Build-time guards reject `http://` and `localhost` values in
   production builds because browsers block them.
6. After deploying, verify:
   - `https://medi-guide-care.vercel.app/register` loads directly (not a Vercel 404)
   - `https://medi-guide-care.vercel.app/api/health` returns the API JSON, proving the proxy
   - registering an account logs you in and `/profile` stays loaded after a refresh

## 2b. Transactional email (Brevo or Resend)

Render's free web services block outbound SMTP (ports 25/465/587), so **only HTTPS email APIs
work in production**. The API supports two, selected with `EMAIL_PROVIDER`:

| `EMAIL_PROVIDER` | Key variable | Needs a domain? | Notes |
| --- | --- | --- | --- |
| `brevo` (recommended for demos) | `BREVO_API_KEY` (`xkeysib-...`) | **No** — verify a single sender address | 300 emails/day free, HTTPS on port 443 |
| `resend` (default) | `RESEND_API_KEY` (`re_...`) | Yes, a verified domain | `onboarding@resend.dev` only emails the Resend account owner |

### Brevo setup (no domain purchase)

1. Create a free Brevo account, then **Senders, Domains & IPs → Senders → Add Sender** and enter
   the Gmail address you want to send from. Click the verification link Brevo emails you.
2. **SMTP & API → API Keys → Create a new API key** (starts with `xkeysib-`).
3. On Render add:

   ```
   EMAIL_PROVIDER = brevo
   BREVO_API_KEY  = xkeysib-...
   MAIL_FROM      = MediGuide <vickyvenkata295@gmail.com>   # the verified sender, no quotes
   APP_URL        = https://medi-guide-care.vercel.app
   ```

4. Redeploy and check the boot log — it must show:

   ```
   [email] provider=brevo apiKey=BREVO_API_KEY present=true sender="MediGuide <...>" appUrl=https://...
   ```

5. Verify configuration at any time (no secrets are exposed):

   ```bash
   curl -s https://mediguide-care.vercel.app/api/health/email
   # {"provider":"brevo","apiKeyConfigured":true,"senderEmail":"...","senderVerified":true,...}
   ```

### Behaviour and troubleshooting

- When email is misconfigured, sends are **skipped with a WARNING** in the logs (never silent) and
  the API keeps working: `missing_BREVO_API_KEY`, `missing_MAIL_FROM`, `missing_APP_URL`.
- Provider rejections are logged with the HTTP status and response body and rethrown, e.g.
  `[email] provider=brevo FAILED to="..." status=401 code=unauthorized body={...}`.
- `MAIL_FROM` may be `Name <mail@host>` or a bare address; surrounding quotes are stripped.
- Reminder emails also need `APP_URL` (used for the "View your appointments" link).
- Startup warns if `MAIL_FROM` still uses Resend's `resend.dev` sandbox while
  `EMAIL_PROVIDER=brevo`, since that combination cannot deliver.
- Switching back to Resend later needs no code change: set `EMAIL_PROVIDER=resend` and a
  `MAIL_FROM` on your verified domain.

## 2c. Appointment status and notifications

- An appointment is created as `Upcoming` and is promoted to `Completed` once its start time plus
  `APPOINTMENT_DURATION_MINUTES` (default 30) has passed. The sweep runs on every
  `GET /api/appointments` (for that patient) and once a minute from the reminder scheduler, so the
  badge matches reality even after a free-tier sleep. Pending reminders for a finished visit are
  marked cancelled at the same time.
- Cancelling an appointment sends a **cancellation email** through the configured provider
  (`EMAIL_PROVIDER`) and stops its reminders. Delivery is fire-and-forget: the cancellation always
  succeeds even if the provider is down; the API returns
  `notification.email: "queued" | "unavailable"` so the UI can phrase the confirmation.

## 3. Troubleshooting "Failed to fetch"

`fetch` only throws that error when **no HTTP response is readable**. Work down this list:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Console: *blocked by CORS policy / No 'Access-Control-Allow-Origin'* | Browser called the Render API cross-origin and the origin was missing from the allow-list | Use the `/api` proxy (default now), or add the origin to `CLIENT_ORIGIN` on Render |
| Console: *blocked by CORS policy* and the request URL starts with `http://` | Mixed content | Use `https://`; the build now falls back to `/api` |
| Request URL is `http://localhost:5000/...` | `VITE_API_URL` baked into a stale build | Unset `VITE_API_URL` on Vercel and redeploy |
| Vercel 404 page instead of the app | Missing SPA rewrite | `client/vercel.json` (committed) |
| Vercel 404 for `/api/health` | Proxy rewrite missing / wrong API host | `client/vercel.json` |
| First request after idling waits ~50 s | Render free-tier cold start | Keep the page open; the request retries automatically. Use the keep-alive workflow or an always-on plan to prevent it |
| `429 Too many sign-in attempts` | Rate limiter keyed on the proxy IP | `app.set("trust proxy", 1)` (committed) plus a 20-attempt budget for failed attempts only |
| **502** on every `/api/*` call; the response body is Render's "Application loading" page | The Render instance is asleep/booting (free tier) and the Vercel proxy cannot reach it | Keep the page open for automatic retry; if it persists, check `/api/health`, keep the instance warm (see below), or use an always-on instance |
| 502 persists after the API is clearly back (`/api/health` works with `?probe=1`) | A cold-start error page got cached at the CDN | `client/vercel.json` sends `no-store` for `/api/*`; redeploy the client and hard-reload |

### Free-tier sleep (502 / "waking up")

Render free web services stop after ~15 minutes without traffic. During the next request Render
serves its **"Application loading"** page and the Vercel proxy turns that into **502**, so
`/api/auth/me` and `/api/auth/login` fail until boot completes. This is not an authentication
problem: `/api/health` (which needs no session) fails at the same time.

Mitigations in this repo:

- `.github/workflows/keepalive.yml` pings the health endpoint every 5 minutes, with extra time for
  scheduler delays. It accepts only valid health JSON with `database: "connected"`; a Render HTML
  loading page does not count as a successful ping. Check **Actions → Keep API awake** after deploying
  to confirm runs are enabled and green (GitHub schedules are best-effort, not an uptime guarantee).
- `client/src/api.js` retries proxy 502/503/504 responses, HTML boot pages, and dropped connections
  with backoff for about two minutes. The login page shows a waiting notice and finishes the same
  sign-in attempt automatically. Real JSON API errors, including wrong passwords and rate limits,
  are returned immediately rather than retried.
- `client/vercel.json` marks `/api/*` as `no-store` so a cached error page can never look permanent.
- The only hosting-level way to eliminate cold starts completely is an always-on Render instance
  (or another always-on host). A free keep-alive monitor is only a mitigation; the in-process
  reminder scheduler also runs only while the instance is awake.

| Emails arrive locally but never from Render | Missing `EMAIL_PROVIDER`/`BREVO_API_KEY`/`MAIL_FROM` on Render, or SMTP credentials used on a host that blocks SMTP | Use Brevo/Resend over HTTPS (see 2b), then check `/api/health/email` |
| Registers, then immediately bounces to `/login` | Session cookie dropped as a third-party/`SameSite=Lax` cookie | Use the `/api` proxy, or set `SESSION_COOKIE_SAME_SITE=none` on Render |

Useful checks:

```bash
# API alive? (also proves Mongo connectivity)
curl -s https://mediguide-0a1e.onrender.com/api/health

# Proxy alive? (should return the same JSON)
curl -s https://medi-guide-care.vercel.app/api/health

# Preflight for a direct cross-origin call (should echo Access-Control-Allow-Origin)
curl -i -X OPTIONS https://mediguide-0a1e.onrender.com/api/auth/register \
  -H "Origin: https://medi-guide-care.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

## Notes and limits

- **Uploads:** Vercel proxies requests, and serverless request bodies are capped around 4.5 MB.
  Profile photos (2 MB) are fine; prescription PDFs above that size must be sent directly to
  the API or reduced in size.
- **`node_modules` is not committed** any more. Always commit `package-lock.json` and let the
  platform run `npm ci`/`npm install`; committing dependencies copied the Windows-only
  `@napi-rs/canvas` binary into a Linux deploy and bloated the repository.
- **Custom domains:** add the new origin to `CLIENT_ORIGIN` on Render (CORS) **and** set
  `APP_URL` so e-mailed links point at the right place.
- **Rate limiting:** the API trusts one proxy hop by default (`TRUST_PROXY=1`), which is correct
  for Render. Because the browser reaches the API through the Vercel rewrite, there can be more
  than one hop; `TRUST_PROXY` accepts any hop count or a list (`TRUST_PROXY=2`,
  `TRUST_PROXY=loopback,linklocal,uniquelocal`). Do not set `TRUST_PROXY=true`: it is unsafe
  for IP-based rate limiting and is treated as one trusted hop. Only *failed* sign-in attempts
  count towards the 20-per-15-minutes budget, so normal registrations never use it up.
- **Confirm `vercel.json` is active:** after the first deploy, `/api/health` on the Vercel domain
  must return the API JSON. If it returns Vercel's 404 page, the project's Root Directory is not
  `client`, and the file is not being read.
