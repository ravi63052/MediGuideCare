# MediGuide

MediGuide is a full-stack healthcare assistance demo with authenticated patient profiles,
per-user appointments, medicine lookup, map-based hospital search, and educational AI chat.

> **Educational demo only:** MediGuide is not a clinical system and does not provide medical
> advice, diagnosis, or treatment. Use synthetic information only. Never enter real patient
> records, protected health information (PHI), or other sensitive personal information. In an
> emergency, contact local emergency services.

## Tech stack

- **Frontend:** React 19, React Router 7, Vite 7, Tailwind CSS 3
- **Backend:** Node.js, Express 5, MongoDB/Mongoose
- **Authentication:** bcrypt password hashing and JWT sessions in HttpOnly cookies
- **Validation:** Zod on authentication, profile, and appointment request bodies

## Features

- Email OTP-verified registration and two-step login, logout, session restoration, and single-use password-reset links
- Registration and password-reset passwords require at least 8 characters, one uppercase letter, one number, and one special character
- Public-only auth pages and protected workspace routes
- Persistent, account-specific profile editing with optional profile photos and workspace avatars
- Per-user appointment booking/cancellation with active-provider verification and a validated
  snapshot of the hospital selected from the live directory
- Automatic `Upcoming -> Completed` transition once a visit ends (`APPOINTMENT_DURATION_MINUTES`,
  default 30) and cancellation e-mails through the configured email provider
- Optional Resend appointment confirmations/reminders and password-reset emails, plus persistent
  in-app reminder/notification APIs
- Synthetic doctor directory with specialty/location filtering
- Live Indian hospital search using OpenStreetMap, 24-hour MongoDB caching, stale-cache fallback,
  and optional Google Places listings/photos
- Medicine browsing by name/composition, A–Z letter, and listed use/category
- Name-matched local medicine images with a generic default illustration
- Prescription image/PDF/text extraction with on-demand Groq details for unmatched medicines
- Existing medicine AI lookup and chat features

## Getting started

### 1. Configure the server

Copy `.env.example` to `.env` in the repository root and set at least:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/mediguide
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
```

Generate a suitable local secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`JWT_SECRET` is required in production. In development, an ephemeral secret is generated when
one is absent, but all sessions become invalid when the server restarts. `GROQ_API_KEY` is only
needed for the optional AI features.

Hospital search works without a Google key through Nominatim/Overpass (OpenStreetMap). Set
`GOOGLE_PLACES_API_KEY` to prefer Google Places listings and photos. Live provider access requires
internet connectivity; fresh OpenStreetMap results are cached in MongoDB for 24 hours, and stale
records are clearly labelled if used during an outage. For a public deployment, set
`HOSPITAL_DIRECTORY_USER_AGENT` to a value identifying the project and a contact, in line with
Nominatim's usage policy.

#### Email OTPs and optional email notifications

Email is sent over an HTTPS API because hosts such as Render block outbound SMTP ports.
Pick a provider with `EMAIL_PROVIDER` and configure the **root `.env`** (not the frontend
environment):

```dotenv
# Brevo: no domain needed - verify one sender address (a Gmail address is fine)
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib_your_actual_key
MAIL_FROM="MediGuide <your-verified-sender@gmail.com>"
APP_URL=http://localhost:5173
```

```dotenv
# Resend: requires a domain verified in the Resend dashboard
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_your_actual_key
MAIL_FROM="MediGuide <appointments@your-verified-domain.com>"
APP_URL=http://localhost:5173
```

`APPOINTMENT_DURATION_MINUTES` (default 30, range 0-480) controls when an appointment counts as
finished: once its start time plus that duration has passed it is stored and displayed as
`Completed`, and its pending reminders are cancelled.

Resend's shared `onboarding@resend.dev` sender only delivers to the Resend account owner's address.
`GET /api/health/email` reports the active provider, whether a key is present, and the parsed
sender address (never the key itself). Misconfiguration is logged as a warning at startup and on
every skipped send; nothing fails silently.

Replace the placeholders with your own values. `MAIL_FROM` must be a sender on the verified domain;
it cannot be an arbitrary user's email address. Registration sends a six-digit code that expires
after 10 minutes; the account remains inactive until that code is confirmed. Each login requires the
email/password followed by a six-digit email code, also expiring after 10 minutes. Codes are single
use, stored as bcrypt hashes, and rate-limited. `APP_URL` is only needed for password-reset and
appointment-reminder links; OTP emails do not use it. If `APP_URL` is omitted, the API uses the
first valid origin in `CLIENT_ORIGIN` (or `CLIENT_URL`) for those links. Set `APP_URL` explicitly
when the browser origin differs from the CORS origin. Restart the API after changing `.env`.

OTP delivery requires the selected provider's API key and `MAIL_FROM`. Password resets and
reminders also require `APP_URL` or a valid frontend-origin fallback. Registration and login OTP
are unavailable when email delivery is not configured or the provider does not accept the message.
An accepted email is not proof that the mailbox exists; only entering the code activates an account.
The API never substitutes a shared testing sender. Appointment delivery runs in the background: an
email failure is logged but does not block or roll back a saved appointment. Password-reset requests
always return a generic response to avoid revealing whether an account exists. Never commit the
real key or share it in chat.

### 2. Start the API

```bash
cd server
npm ci
npm run dev
```

The API validates its configuration, connects to MongoDB, and upserts the synthetic demo doctors
before listening on `http://localhost:5000`. Seeding is idempotent, so restarts do not create
duplicates. Startup stops with a clear error if MongoDB or the production auth configuration is
invalid. The API also initializes reminder indexes and starts the persistent appointment-reminder
scheduler. The health check is `GET http://localhost:5000/api/health`.

### 3. Start the frontend

In another terminal:

```bash
cd client
npm ci
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). Vite proxies relative `/api` requests to
the backend, so browser code never needs to call a backend localhost URL directly.

### Production build

```bash
cd client
npm run build
npm run preview
```

### Client and server tests

```bash
cd client
npm test

cd ../server
npm test
```

The client tests cover cold-start retries, HTML loading pages, network failures, immediate API
errors, and cancellation. The server tests cover password-reset token behavior, reminder
scheduling, model registration, CORS origin handling and session-cookie policy, and safe email
configuration/diagnostics without requiring a live MongoDB connection or sending real email.

## Deployment (Vercel frontend + Render API)

The frontend is deployed to Vercel and the API to Render. The browser never calls Render
directly: it requests `/api/...` on its own origin, and `client/vercel.json` rewrites that path
to the Render service. Same-origin requests mean no CORS preflight, no third-party cookie and no
mixed-content failures.

| Setting | Frontend (Vercel) | API (Render) |
| --- | --- | --- |
| Root directory | `client` | `server` |
| Build command | `npm run build` | `npm ci` |
| Start command | (static) | `npm start` |
| Health check | - | `/api/health` |

Required API environment variables: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (32+ chars).
Recommended: `CLIENT_ORIGIN=https://medi-guide-care.vercel.app` and
`APP_URL=https://medi-guide-care.vercel.app`. Leave `VITE_API_URL` unset on Vercel - the
production build uses the relative `/api` base on purpose.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full checklist, the request flow diagram and a
troubleshooting table for "Failed to fetch", blank pages and login-not-sticking issues.

## Main routes

| Frontend route | Access | Purpose |
| --- | --- | --- |
| `/` | Public | Landing page |
| `/login`, `/register` | Signed-out only | Account access |
| `/forgot-password`, `/reset-password` | Public | Password recovery |
| `/profile` | Authenticated | Persistent user profile and optional photo |
| `/appointments` | Authenticated | Per-user appointments with hospital selection |
| `/hospitals` | Authenticated | Live map-based hospital directory |
| `/medicines` | Authenticated | Medicine and prescription lookup |
| `/prescriptions` | Authenticated | Prescription workspace placeholder |
| `/chat` | Authenticated | Educational AI assistant |

Appointment booking provides city and specialty dropdowns with plain-language guidance to filter
the synthetic provider directory. Hospital map actions open Google Maps (using the exact Google
Places listing when supplied), while hospital data-source
attribution and the fictional-provider/non-affiliation disclaimers remain visible.

### Authentication and appointment API

| Endpoint | Description |
| --- | --- |
| `POST /api/auth/register` | Create an account and session |
| `POST /api/auth/login` | Sign in |
| `POST /api/auth/forgot-password` | Request a reset email without account enumeration |
| `POST /api/auth/reset-password` | Consume a valid single-use reset token |
| `POST /api/auth/logout` | Clear the session cookie |
| `GET /api/auth/me` | Restore the current user |
| `PATCH /api/auth/profile` | Update allowed profile fields |
| `POST/GET/DELETE /api/auth/profile/photo` | Manage the session user's profile photo |
| `GET /api/appointments` | List only the session user's appointments |
| `POST /api/appointments` | Book with a validated hospital snapshot for the session user |
| `GET /api/appointments/reminders` | List owned reminders and in-app notifications |
| `PATCH /api/appointments/:id/reminders` | Update owned reminder preferences |
| `PATCH /api/appointments/:id/checklist` | Update the owned readiness checklist |
| `PATCH /api/appointments/:id/cancel` | Cancel an owned upcoming appointment and email a notice |
| `GET /api/hospitals/search` | Search/cache OpenStreetMap or Google hospital listings |
| `GET /api/hospitals/photo` | Proxy an approved Google Places photo reference |
| `GET /api/doctors` | List/filter active synthetic doctors |
| `GET /api/medicines` | Search/filter medicines by `search`, `letter`, and `category` |
| `GET /api/health/email` | Report the active email provider, key presence and parsed sender (no secrets) |

## Project structure

```text
client/src/
├── api.js                       # Credentialed API client
├── context/AuthContext.jsx       # Session and user state
├── components/auth/             # Protected/public-only route guards
├── components/layout/           # Public and authenticated app shells
└── pages/                       # Landing, auth, and workspace pages

server/src/
├── controllers/                 # Auth, appointments, directory, medicines
├── middleware/requireAuth.js     # Verifies cookie session and loads the user
├── models/                      # User, Doctor, Hospital, and Appointment schemas
├── routes/                      # Express API routes
├── services/                    # AI, lookup, and Resend email services
├── utils/session.js              # JWT and secure-cookie helpers
└── validators/                  # Zod request validation
```

## Security notes

- Passwords are hashed with bcrypt and are never returned by the API. Reset tokens are random,
  hashed at rest, expire after 30 minutes, and are cleared after successful use.
- Session cookies are `HttpOnly` and `SameSite=Lax`; they are `Secure` in production. Cross-site
  deployments can opt into `SameSite=None` (always paired with `Secure`) via
  `SESSION_COOKIE_SAME_SITE=none`, but the same-origin `/api` proxy is preferred.
- CORS only echoes back explicitly allowed origins (the deployed Vercel app, its preview
  deployments and localhost, plus anything in `CLIENT_ORIGIN`/`CLIENT_ORIGIN_PATTERNS`);
  credentials are never combined with a `*` wildcard.
- `app.set("trust proxy", ...)` is enabled so rate limits are applied per real visitor IP behind
  the Render/Vercel proxies instead of one shared bucket.
- Authentication and password-reset requests are rate-limited; login/reset-request responses do
  not reveal whether an account exists.
- Profile-photo uploads are session-scoped, limited to 2 MB, and checked against JPG/PNG/WebP
  signatures rather than trusting the browser's declared file type.
- Appointment reads and writes are scoped by the verified server-side session.
- Hospital search/photo endpoints are rate-limited; Google keys remain on the server.
- Email provider keys (Resend or Brevo) and patient recipient addresses are used only by the server; notification content
  is HTML-escaped and recipients come from the authenticated account, not the booking request.
- Set a strong `JWT_SECRET`, configure `CLIENT_ORIGIN` and `APP_URL`, and use HTTPS in production.
- This remains an educational demo, not a production healthcare or PHI-storage solution.

## License

See [LICENSE](./LICENSE).
