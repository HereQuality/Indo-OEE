# ⚛️ Client — React + Tailwind CSS Frontend

> Part of **Demo_HQEPL** · [← Back to root](../README.md)

React 18 single-page application built with Vite 5 and Tailwind CSS 3. 100% environment-variable-driven — no hardcoded URLs or hosts anywhere in the codebase.

---

## 📁 Folder Structure

```
client/
├── src/
│   ├── assets/
│   │   ├── images/            ← Static images (SVG, PNG, etc.)
│   │   └── icons/             ← Icon assets
│   │
│   ├── components/
│   │   ├── common/            ← App-wide: ProtectedRoute, PublicRoute, etc.
│   │   └── ui/                ← Pure presentational: Button, Input, Modal, etc.
│   │
│   ├── context/               ← React Context providers (if not using Zustand)
│   │
│   ├── hooks/
│   │   └── useAuth.js         ← Auth hook wrapping Zustand store
│   │
│   ├── layouts/               ← Page wrappers: MainLayout, AuthLayout
│   │
│   ├── pages/                 ← One component per route
│   │   ├── Auth/
│   │   │   ├── LoginPage.jsx
│   │   │   └── RegisterPage.jsx
│   │   ├── Dashboard/
│   │   │   └── DashboardPage.jsx
│   │   └── NotFound/
│   │       └── NotFoundPage.jsx
│   │
│   ├── services/
│   │   └── api.js             ← Axios instance + request/response interceptors
│   │
│   ├── store/
│   │   └── authStore.js       ← Zustand auth state (persisted in localStorage)
│   │
│   ├── utils/
│   │   └── constants.js       ← App constants (ROUTES, ROLES, HTTP_STATUS, etc.)
│   │
│   ├── App.jsx                ← Root router (all routes defined here)
│   ├── index.css              ← Global Tailwind + design system tokens
│   └── main.jsx               ← ReactDOM entry + BrowserRouter + Toaster
│
├── .env                       ← Local secrets (GITIGNORED — never commit)
├── .env.example               ← Template (safe to commit)
├── .gitignore
├── index.html                 ← Vite HTML entry + Google Fonts
├── package.json
├── postcss.config.js          ← Tailwind + Autoprefixer
├── README.md                  ← You are here
├── tailwind.config.js         ← Extended theme: colors, fonts, animations
└── vite.config.js             ← Path aliases (@/, @components/, etc.) + dev proxy
```

---

## ⚙️ Environment Setup

### 1. Copy the template

```bash
cp .env.example .env
```

### 2. Edit `.env`

> ⚠️ All Vite environment variables **must be prefixed with `VITE_`** to be accessible in the browser.

| Variable               | Description                                | Example (local dev)                      |
|------------------------|--------------------------------------------|------------------------------------------|
| `VITE_API_BASE_URL`    | **Required.** Full backend API base URL    | `http://localhost:5000/api/v1`           |
| `VITE_APP_NAME`        | Application display name                   | `Demo_HQEPL`                      |
| `VITE_APP_VERSION`     | App version string                         | `1.0.0`                                  |
| `VITE_ENABLE_ANALYTICS`| Toggle analytics (future)                  | `false`                                  |
| `VITE_ENABLE_DEBUG_TOOLS`| Toggle dev tools (future)               | `true`                                   |

#### Local `.env` example

```env
VITE_API_BASE_URL=http://localhost:5000/api/v1
VITE_APP_NAME=Demo_HQEPL
VITE_APP_VERSION=1.0.0
VITE_ENABLE_ANALYTICS=false
VITE_ENABLE_DEBUG_TOOLS=true
```

#### Production `.env` example

```env
VITE_API_BASE_URL=https://api.your-domain.com/api/v1
VITE_APP_NAME=Demo_HQEPL
VITE_APP_VERSION=1.0.0
VITE_ENABLE_ANALYTICS=true
VITE_ENABLE_DEBUG_TOOLS=false
```

---

## 🚀 Running the Client

### Development

```bash
npm run dev
```

Starts Vite dev server. Port is configured in `vite.config.js`.

> 💡 The dev server proxies `/api/*` requests to the backend URL, so CORS is transparent during development.

### Production build

```bash
npm run build
```

Outputs to `dist/`. Upload this to Vercel / Netlify / S3.

### Preview production build locally

```bash
npm run preview
```

---

## 🛣️ Routing

All routes are defined in [`src/App.jsx`](./src/App.jsx).

| Path            | Component          | Auth     | Status       |
|-----------------|--------------------|----------|--------------|
| `/`             | Landing / Home     | Public   | ✅ Active    |
| `/login`        | LoginPage          | Public   | 🔜 Coming    |
| `/register`     | RegisterPage       | Public   | 🔜 Coming    |
| `/dashboard`    | DashboardPage      | Protected| 🔜 Coming    |
| `/inventory`    | InventoryPage      | Protected| 🔜 Coming    |
| `/profile`      | ProfilePage        | Protected| 🔜 Coming    |
| `/settings`     | SettingsPage       | Protected| 🔜 Coming    |
| `*`             | Redirect to `/`    | —        | ✅ Active    |

---

## 🌐 API Integration

All HTTP calls go through the centralized Axios instance at `src/services/api.js`.

```js
import api from "@services/api";

// Example usage in any component/hook
const response = await api.get("/users");
const response = await api.post("/auth/login", { email, password });
```

**Built-in behaviour:**

- Base URL auto-applied from `VITE_API_BASE_URL`
- Credentials (cookies) sent with every request
- 401 response → silent token refresh → retry original request
- Error messages shown as toast notifications automatically
- Request timeout: 15 seconds

---

## 🎨 Design System

Defined in `src/index.css` using Tailwind `@layer components`.

### Component Classes

| Class              | Usage                                    |
|--------------------|------------------------------------------|
| `.btn-primary`     | Primary CTA button (blue)                |
| `.btn-secondary`   | Secondary button (slate)                 |
| `.btn-ghost`       | Ghost / text button                      |
| `.btn-danger`      | Destructive action button (red)          |
| `.card`            | Base card container                      |
| `.card-hover`      | Card with hover elevation effect         |
| `.input`           | Text input field                         |
| `.label`           | Form field label                         |
| `.form-error`      | Inline validation error text             |
| `.badge-primary`   | Blue badge/chip                          |
| `.badge-success`   | Green badge/chip                         |
| `.badge-warning`   | Yellow badge/chip                        |
| `.badge-danger`    | Red badge/chip                           |
| `.spinner`         | Loading spinner                          |
| `.page-container`  | Max-width centered page wrapper          |
| `.section-title`   | Page/section heading style               |
| `.skeleton`        | Shimmer skeleton loader                  |
| `.text-gradient`   | Blue-to-purple gradient text             |
| `.glass`           | Glassmorphism backdrop blur              |

### Colors (Extended Tailwind Theme)

| Token              | Usage                   |
|--------------------|-------------------------|
| `primary-*`        | Brand blue (50–950)     |
| `secondary-*`      | Accent purple           |
| `success-*`        | Green feedback          |
| `warning-*`        | Amber feedback          |
| `danger-*`         | Red feedback            |
| `dark-*`           | Dark mode backgrounds   |

### Animations

| Class              | Effect                              |
|--------------------|-------------------------------------|
| `animate-fade-in`  | Fade + slide up on mount            |
| `animate-slide-in` | Slide in from left                  |
| `animate-shimmer`  | Skeleton shimmer sweep              |
| `animate-spin`     | Tailwind default (spinner)          |

---

## 🔒 Path Aliases

Configured in `vite.config.js`. Use instead of relative paths.

| Alias           | Resolves to         |
|-----------------|---------------------|
| `@`             | `src/`              |
| `@components`   | `src/components/`   |
| `@pages`        | `src/pages/`        |
| `@hooks`        | `src/hooks/`        |
| `@services`     | `src/services/`     |
| `@store`        | `src/store/`        |
| `@utils`        | `src/utils/`        |
| `@assets`       | `src/assets/`       |
| `@layouts`      | `src/layouts/`      |
| `@context`      | `src/context/`      |

```js
// ✅ Use alias
import api from "@services/api";
import useAuth from "@hooks/useAuth";

// ❌ Avoid relative paths
import api from "../../services/api";
```

---

## 📦 Dependencies

### Production

| Package            | Purpose                                       |
|--------------------|-----------------------------------------------|
| `react`            | UI framework                                  |
| `react-dom`        | DOM renderer                                  |
| `react-router-dom` | Client-side routing                           |
| `axios`            | HTTP client with interceptors                 |
| `zustand`          | Lightweight global state (persisted)          |
| `react-hook-form`  | Performant form management                    |
| `react-hot-toast`  | Toast notification system                     |
| `react-icons`      | Icon library (Font Awesome, Material, etc.)   |
| `clsx`             | Conditional class name utility                |

### Dev

| Package                    | Purpose                        |
|----------------------------|--------------------------------|
| `vite`                     | Build tool + dev server        |
| `@vitejs/plugin-react`     | React HMR support              |
| `tailwindcss`              | Utility-first CSS              |
| `postcss`                  | CSS transform pipeline         |
| `autoprefixer`             | CSS vendor prefix automation   |
| `eslint`                   | Linting                        |
| `eslint-plugin-react`      | React linting rules            |
| `eslint-plugin-react-hooks`| Hooks linting rules            |

---

## 📋 Scripts

```bash
npm run dev       # Start Vite dev server
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
npm run lint      # Run ESLint
npm run lint:fix  # Auto-fix lint errors
```

---

## 🗂️ Adding a New Page

1. Create `src/pages/YourPage/YourPage.jsx`
2. Add route in `src/App.jsx`:
   ```jsx
   import YourPage from "@pages/YourPage/YourPage";
   <Route path="/your-path" element={<YourPage />} />
   ```
3. Add path constant in `src/utils/constants.js`:
   ```js
   YOUR_PAGE: "/your-path",
   ```

---

## 🚢 Deploying to Vercel

1. Connect your GitHub repository to Vercel
2. Set **Root Directory** to `client`
3. Add environment variables in Vercel dashboard:
   ```
   VITE_API_BASE_URL = https://api.your-domain.com/api/v1
   ```
4. Build command: `npm run build`
5. Output directory: `dist`

---

> ← [Root README](../README.md) · [Server README](../server/README.md)
