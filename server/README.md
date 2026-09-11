# 🖥️ Server — Express + MongoDB Backend

> Part of **Demo_HQEPL** · [← Back to root](../README.md)

Node.js REST API built with Express and MongoDB (Mongoose). Full security middleware stack, centralized error handling, JWT auth skeleton, and Winston logging.

---

## 📁 Folder Structure

```
server/
├── config/
│   ├── corsOptions.js      ← CORS whitelist (100% env-driven, no hardcoded URLs)
│   ├── db.js               ← MongoDB connection (local + Atlas)
│   └── logger.js           ← Winston logger (console dev / file rotation prod)
│
├── controllers/
│   └── auth.controller.js  ← Auth placeholder (all methods stubbed)
│
├── docs/                   ← API docs (Postman collection, Swagger — add here)
│
├── logs/                   ← Winston log files (gitignored, .gitkeep present)
│
├── middlewares/
│   ├── validators/         ← express-validator request validators (per route)
│   ├── auth.middleware.js  ← JWT protect() + RBAC authorize()
│   ├── errorHandler.js     ← Global error handler (dev: stack / prod: masked)
│   ├── notFoundHandler.js  ← 404 for all undefined routes
│   └── rateLimiter.js      ← Auth, upload, password-reset specific limiters
│
├── models/
│   └── user.model.js       ← Mongoose User schema (bcrypt hook, roles, indexes)
│
├── routes/
│   ├── index.js            ← API v1 root router — all resource routes mount here
│   └── auth.routes.js      ← Auth routes (placeholder)
│
├── scripts/
│   └── seed.js             ← Database seeder (run: npm run seed)
│
├── services/
│   └── auth.service.js     ← JWT generation + secure cookie management
│
├── uploads/                ← Local file uploads (gitignored, .gitkeep present)
│
├── utils/
│   ├── AppError.js         ← Custom operational error class
│   ├── apiResponse.js      ← Standardized response helpers (sendSuccess, etc.)
│   ├── asyncHandler.js     ← Eliminates try/catch in every controller
│   └── upload.js           ← Multer config (MIME filter + size limit from env)
│
├── .env                    ← Local secrets (GITIGNORED — never commit)
├── .env.example            ← Template (safe to commit)
├── .gitignore
├── app.js                  ← Express factory (all middleware layers)
├── nodemon.json            ← Nodemon watch config
├── package.json
├── README.md               ← You are here
└── server.js               ← Entry point (DB connect + HTTP server + shutdown)
```

---

## ⚙️ Environment Setup

### 1. Copy the template

```bash
cp .env.example .env
```

### 2. Edit `.env` — required variables

| Variable          | Description                                      | Example (local)                          |
|-------------------|--------------------------------------------------|------------------------------------------|
| `NODE_ENV`        | Runtime environment                              | `development`                            |
| `PORT`            | Server port                                      | `5000`                                   |
| `APP_HOST`        | Full server URL (used in startup logs only)      | `http://localhost:5000`                  |
| `CLIENT_URL`      | Production frontend URL for CORS                 | `http://localhost:5173`                  |
| `DEV_CLIENT_URLS` | Comma-separated dev/staging URLs for CORS        | `http://localhost:5173,http://localhost:3000` |
| `MONGO_URI`       | MongoDB connection string                        | `mongodb://127.0.0.1:27017/ai_inv_dev`   |
| `JWT_SECRET`      | Access token signing secret (min 64 chars)       | *(generate — see below)*                 |
| `JWT_REFRESH_SECRET` | Refresh token secret (min 64 chars)          | *(generate — see below)*                 |

#### Generate JWT secrets

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run twice — once for `JWT_SECRET`, once for `JWT_REFRESH_SECRET`.

---

## 🚀 Running the Server

### Development (with hot reload)

```bash
npm run dev
```

### Production

```bash
npm start
```

### Seed the database

```bash
npm run seed
```

---

## 📡 API Reference

### Base URL

All endpoints are prefixed by:

```
/api/v1
```

The full URL depends on your `APP_HOST` + `PORT` env vars.

### Available Endpoints

| Method | Path              | Auth   | Status      | Description         |
|--------|-------------------|--------|-------------|---------------------|
| `GET`  | `/health`         | None   | ✅ Live      | Server health check |
| `GET`  | `/api/v1`         | None   | ✅ Live      | API info & version  |
| `POST` | `/api/v1/auth/register` | None | 🔜 Coming | User registration  |
| `POST` | `/api/v1/auth/login`    | None | 🔜 Coming | User login         |
| `POST` | `/api/v1/auth/logout`   | JWT  | 🔜 Coming | User logout        |
| `POST` | `/api/v1/auth/refresh-token` | Cookie | 🔜 Coming | Refresh access token |
| `GET`  | `/api/v1/auth/me`       | JWT  | 🔜 Coming | Get current user   |

### Response Format

Every response follows this consistent structure:

```json
// ✅ Success
{
  "success": true,
  "message": "Operation successful",
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 10 }
}

// ❌ Error
{
  "success": false,
  "status": "fail",
  "message": "Human-readable error message"
}
```

---

## 🔐 Security Architecture

| Layer                  | Package / Technique                                    |
|------------------------|--------------------------------------------------------|
| HTTP headers           | `helmet` — XSS, MIME sniff, clickjacking, HSTS        |
| CORS                   | `cors` + env-driven whitelist (no hardcoded origins)  |
| Global rate limit      | `express-rate-limit` — 100 req / 15 min per IP        |
| Auth rate limit        | `express-rate-limit` — 10 req / 15 min (login/register)|
| Body size              | `express.json({ limit: '10kb' })`                     |
| NoSQL injection        | `express-mongo-sanitize` — strips `$` and `.`         |
| HTTP param pollution   | `hpp` — prevents array injection                      |
| Password hashing       | `bcryptjs` — rounds from `BCRYPT_SALT_ROUNDS` env var |
| JWT auth               | Access token (short TTL) + refresh token (long TTL)   |
| Cookie security        | `httpOnly`, `secure` (prod), `sameSite`               |
| Input validation       | `express-validator` (per route, in `middlewares/validators/`) |
| Error hiding           | Internal errors masked in production                  |
| Credential masking     | MongoDB URI password hidden in all logs               |

---

## 🧩 Middleware Execution Order

Middleware in `app.js` runs in this exact order:

```
Request
  │
  ▼
1. helmet()              — Security headers
2. cors()                — CORS policy
3. rateLimit()           — Global API rate limit (on /api)
4. express.json()        — Parse JSON body (max 10kb)
5. cookieParser()        — Parse cookies
6. mongoSanitize()       — Strip NoSQL injection chars
7. hpp()                 — HTTP param pollution prevention
8. compression()         — Gzip compression
9. morgan()              — HTTP request logging
10. /health              — Health check (no auth)
11. /api/v1              — All API routes
12. notFoundHandler()    — 404 for unmatched routes
13. globalErrorHandler() — Catch-all error formatter
  │
  ▼
Response
```

---

## 📦 Dependencies

### Production

| Package                 | Purpose                                |
|-------------------------|----------------------------------------|
| `express`               | Web framework                          |
| `mongoose`              | MongoDB ODM                            |
| `jsonwebtoken`          | JWT sign & verify                      |
| `bcryptjs`              | Password hashing                       |
| `dotenv`                | Load `.env` variables                  |
| `helmet`                | Security headers                       |
| `cors`                  | Cross-origin resource sharing          |
| `express-rate-limit`    | Rate limiting                          |
| `express-mongo-sanitize`| NoSQL injection prevention             |
| `hpp`                   | HTTP parameter pollution prevention    |
| `express-validator`     | Request body validation                |
| `compression`           | Gzip responses                         |
| `cookie-parser`         | Parse request cookies                  |
| `morgan`                | HTTP request logger                    |
| `multer`                | Multipart/form-data (file uploads)     |
| `winston`               | Structured logging                     |
| `winston-daily-rotate-file` | Log file rotation                 |

### Dev

| Package    | Purpose                                |
|------------|----------------------------------------|
| `nodemon`  | Auto-restart on file change            |
| `eslint`   | Code linting                           |

---

## 📋 Scripts

```bash
npm run dev       # Start with nodemon (hot reload)
npm start         # Start without hot reload (production)
npm run seed      # Run database seeder
npm run lint      # Run ESLint
npm run lint:fix  # Auto-fix lint errors
```

---

## 🗂️ Adding a New Resource

1. **Model** → `models/your-resource.model.js`
2. **Controller** → `controllers/your-resource.controller.js`
3. **Validator** → `middlewares/validators/your-resource.validator.js`
4. **Routes** → `routes/your-resource.routes.js`
5. **Mount** → `routes/index.js`:
   ```js
   const yourResourceRoutes = require('./your-resource.routes');
   router.use('/your-resource', yourResourceRoutes);
   ```

---

## 🔄 Logs

- **Development** → Colorized output in terminal
- **Production** → Daily rotating files in `logs/` directory:
  - `app-YYYY-MM-DD.log` — all levels
  - `error-YYYY-MM-DD.log` — errors only
  - Archives zipped after 30 days

---

> ← [Root README](../README.md) · [Client README](../client/README.md)
