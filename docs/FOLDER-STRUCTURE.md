# Folder Structure

## Root Level
```
ISP-Management-System/
├── .gitignore
├── README.md
├── docs/
├── deployment/
├── database/
├── scripts/
├── frontend/
└── backend/
```

## Frontend (Next.js)
```
frontend/
├── public/
│   ├── images/
│   ├── logos/
│   └── icons/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── page.tsx
│   │   │   ├── apply/
│   │   │   ├── news/
│   │   │   ├── about/
│   │   │   └── contact/
│   │   ├── admin/
│   │   │   ├── login/
│   │   │   ├── dashboard/
│   │   │   ├── subscribers/
│   │   │   ├── packages/
│   │   │   ├── billing/
│   │   │   ├── payments/
│   │   │   ├── mikrotik/
│   │   │   ├── tickets/
│   │   │   ├── technicians/
│   │   │   ├── reports/
│   │   │   ├── staff/
│   │   │   └── settings/
│   │   └── client/
│   │       ├── dashboard/
│   │       ├── bills/
│   │       ├── payments/
│   │       ├── packages/
│   │       ├── profile/
│   │       └── support/
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── forms/
│   │   ├── tables/
│   │   └── charts/
│   ├── features/
│   │   ├── auth/
│   │   ├── subscribers/
│   │   ├── packages/
│   │   ├── billing/
│   │   ├── payments/
│   │   ├── mikrotik/
│   │   ├── tickets/
│   │   ├── technicians/
│   │   └── coverage/
│   ├── services/
│   ├── hooks/
│   ├── lib/
│   ├── types/
│   └── styles/
├── .env.example
├── package.json
├── next.config.ts
└── tsconfig.json
```

## Backend (Laravel)
```
backend/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   ├── Api/
│   │   │   ├── Auth/
│   │   │   ├── Admin/
│   │   │   ├── Subscriber/
│   │   │   ├── Billing/
│   │   │   ├── Payments/
│   │   │   ├── MikroTik/
│   │   │   └── Tickets/
│   │   ├── Middleware/
│   │   └── Requests/
│   ├── Models/
│   ├── Services/
│   │   ├── Billing/
│   │   ├── Payments/
│   │   ├── MikroTik/
│   │   ├── Notifications/
│   │   └── Coverage/
│   ├── Policies/
│   ├── Jobs/
│   ├── Events/
│   └── Listeners/
├── bootstrap/
├── config/
├── database/
│   ├── migrations/
│   ├── seeders/
│   └── factories/
├── routes/
├── resources/
├── storage/
├── tests/
│   ├── Feature/
│   └── Unit/
├── .env.example
├── artisan
└── composer.json
```

## Documentation
```
docs/
├── SRS.md
├── ARCHITECTURE.md
├── FOLDER-STRUCTURE.md
├── DATABASE-DESIGN.md
├── API-DOCUMENTATION.md
├── DEVELOPMENT-SETUP.md
├── SECURITY.md
└── TESTING.md
```