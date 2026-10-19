# Architecture

## Overview
The ISP Management System is a production-oriented web application with a separate frontend and backend architecture.

## Architecture Diagram

```
┌─────────────────┐     REST API     ┌──────────────────┐
│   Next.js        │ ◄──────────────► │   Laravel        │
│   (Frontend)     │  /api/v1/*       │   (Backend)      │
│   Port: 3000     │                  │   Port: 8000     │
└────────┬────────┘                  └────────┬─────────┘
         │                                  │
         │                                  ▼
         │                          ┌───────────────┐
         │                          │  PostgreSQL   │
         │                          │  Port: 5432   │
         │                          └───────────────┘
         │
         ▼
┌─────────────────┐
│   Client        │
│   Browser       │
└─────────────────┘
```

## Frontend Architecture
- **Framework**: Next.js with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: React hooks (useState, useContext)
- **API Client**: Fetch API with authentication tokens
- **Import Alias**: `@/*`

## Backend Architecture
- **Framework**: Laravel 12
- **Language**: PHP 8.2
- **Database**: PostgreSQL
- **API**: REST API with `/api/v1/` prefix
- **Authentication**: Laravel Sanctum (evaluate)
- **Module Organization**: Domain-driven modules

## Database Architecture
- **Database**: PostgreSQL 16
- **Connection**: PDO with `pdo_pgsql` extension
- **Database Name**: `isp_management`
- **Host**: `127.0.0.1`
- **Port**: `5432`

## Security Architecture
- JWT or Sanctum-based authentication
- CSRF protection (Laravel built-in)
- CORS configured for frontend/backend separation
- Input validation via Form Requests
- Authorization via Policies
- Environment variables for secrets