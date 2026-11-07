# NextLink — ISP Management System & Website Portal

Inspired by **Dot Internet Benchmark** & Konika Designs BD SRS specification.

---

## 🛠️ Core Technology Stack

### 1. Framework & Runtime
* **Next.js 14 (App Router):** Modern full-stack React framework providing Server-Side Rendering (SSR), Static Site Generation (SSG), and Serverless Route Handlers for both applications.
* **React 18:** Component-driven UI architecture with concurrent features.
* **TypeScript 5:** End-to-end static typing for robust, error-free code across both Frontend and Admin projects.
* **Node.js:** JavaScript runtime environment powering server execution and build workflows.

### 2. UI & Design System
* **Tailwind CSS (v3):** Utility-first CSS framework with dynamic design token customization.
* **Radix UI Primitives:** Accessible, headless UI foundation components (`@radix-ui/react-dialog`, `dropdown-menu`, `select`, `tabs`, `switch`, `tooltip`, `avatar`, `progress`, `popover`, `separator`, etc.).
* **Lucide React:** Modern, lightweight SVG icon library.
* **Class Variance Authority (CVA), `clsx`, `tailwind-merge`:** Robust variant-based styling and conditional class merging.
* **next-themes:** Instant Dark/Light mode toggle with persistence and support for 5 color palette presets (Blue, Green, Purple, Red, Orange).

### 3. State Management & Persistence
* **Zustand (v4):** Lightweight and scalable client state management for authentication, portal content, and UI settings.
* **Zustand `persist` & Browser LocalStorage:** Real-time form auto-saving (e.g. online registration draft) and persistent user customization.

### 4. Forms & Schema Validation
* **React Hook Form:** High-performance, re-render-free form state management.
* **Zod:** Declarative schema validation ensuring strict data validation across registration, tickets, billing, and settings forms.
* **`@hookform/resolvers`:** Direct integration bridge between Zod schemas and React Hook Form.

### 5. Data Visualization & Data Grids
* **TanStack React Table (v8):** Headless table engine powering subscriber management, invoice registry, tickets CRM, and technician dispatching with multi-column sorting, filtering, and pagination.
* **Recharts:** Responsive charting library powering monthly revenue collections, ISP subscriber growth trends, and bandwidth usage statistics.

### 6. Notifications & Date Utilities
* **React Hot Toast:** Lightweight and customizable toast notifications.
* **date-fns:** Modular date calculation, formatting, and invoice scheduling.

### 7. Backend, Storage & Integrations
* **Next.js Route Handlers (`/api/*`):** Serverless REST API endpoints (`/api/data`, `/api/content`, `/api/backup`).
* **JSON File-based Database (`data/`):** Lightweight, reliable persistent storage using `adminStore.json` and `siteData.json` with live bi-directional sync.
* **MikroTik RouterOS API Engine:** Integration architecture ready for RouterOS v6/v7 queue synchronization, bandwidth profiling, and subscriber suspend/reconnect actions.
* **SMS Gateway API Integration:** Automated messaging pipelines for payment reminders, due bill notifications, and OTP verification.
* **Role-Based Access Control (RBAC):** Multi-role authentication layer supporting Super Admin, Billing/Accounts, Helpdesk Support, Field Technicians, and Subscribers.

### 8. Automation & Scripts
* **Windows Batch Scripts:** One-click launcher scripts (`run-all.bat`, `run-frontend.bat`, `run-admin.bat`).

---

## 🚀 Quick Start (Running Both Projects)

### 1. Frontend (User / Subscriber Portal) — Port `3000`
```bash
cd frontend
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

**Demo Subscriber Credentials:**
- **Username:** `demo` or `subscriber`
- **Password:** `demo123` or `pass123`

---

### 2. Backend / Admin Panel (ISP Management) — Port `8000`
```bash
cd admin
npm run dev
```
Open [http://localhost:8000](http://localhost:8000)

**Quick Role-based Logins (1-Click selection on Login page):**
- **Super Admin:** `admin@nextlink.com` / `admin123`
- **Accounts / Billing:** `billing@nextlink.com` / `billing123`
- **Support / Helpdesk:** `support@nextlink.com` / `support123`
- **Field Technician:** `field@nextlink.com` / `field123`

---

## 🎨 Global Features Included in Both Applications:
1. 🌙 **Dark / Light Mode**: Instant toggle with persistence (supports system default too).
2. 🎨 **Theme Color Palette**: Live change across 5 presets: Blue, Green, Purple, Red, Orange.
3. 🔤 **Font Size Scaling**: Small (14px), Medium (16px), Large (18px) for readability.
4. 🌐 **Language Switcher**: Full English and বাংলা (Bengali) translation.
5. 💾 **Auto Save**: Live form draft auto-saving with localStorage persistence and toggle control.
6. ⚙️ **Floating Settings Trigger**: Always accessible gear icon at the bottom-right of every page.

---

## 📂 Architecture Overview

### Frontend (`port: 3000`):
- `/` — Homepage: Hero, internet packages, BDIX speed tiers, FTP/Live TV links, coverage overview, news.
- `/coverage` — Interactive area coverage checker.
- `/apply` — Online connection registration with NID photo upload and Auto-Save draft.
- `/login` — Subscriber authentication.
- `/dashboard` — Subscriber dashboard: bandwidth usage, live speed, bill due status, MikroTik sync info.
- `/tickets` — Self-service customer support ticket lodging.
- `/settings` — Dedicated user customization center.

### Admin Panel (`port: 8000`):
- `/login` — Multi-role authentication (Super Admin, Billing, Support, Field Tech).
- `/dashboard` — ISP KPI stats, revenue charts, growth trends, recent tickets & payments.
- `/subscribers` — Full subscriber management table, filter by zone/package, add subscriber dialog.
- `/subscribers/[id]` — Detailed subscriber profile, MikroTik queue status, suspend/reconnect switch.
- `/packages` — Internet package CRUD (speed, monthly fee, duration, features).
- `/billing` — Monthly invoice registry, payment status (paid, unpaid, overdue), SMS reminder, PDF export.
- `/tickets` — Helpdesk CRM, ticket workflow (Open, In Progress, Resolved), field technician assignment.
- `/technicians` — Field technician dispatching, zones, active jobs, status toggle.
- `/reports` — Financial analytics, monthly collection vs invoiced revenue, churn rate.
- `/settings` — MikroTik RouterOS API config (v6/v7), SMS gateway API, role matrix, and UI theme preferences.
