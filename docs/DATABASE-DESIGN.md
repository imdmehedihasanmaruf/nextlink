# Database Design

## Overview
The database uses PostgreSQL as the primary data store for the ISP Management System.

## Core Entities

### Users
- `id` (PK)
- `name`
- `email`
- `email_verified_at`
- `password`
- `remember_token`
- `created_at`
- `updated_at`

### Subscribers
- `id` (PK)
- `user_id` (FK to users)
- `subscriber_id` (unique)
- `name`
- `email`
- `phone`
- `address`
- `connection_type` (PPPoE, Static IP)
- `ip_address`
- `mac_address`
- `status` (active, suspended, pending)
- `package_id` (FK to packages)
- `created_at`
- `updated_at`

### Packages
- `id` (PK)
- `name`
- `description`
- `speed` (bandwidth in Mbps)
- `price`
- `billing_cycle` (monthly, quarterly, yearly)
- `status`
- `created_at`
- `updated_at`

### Bills
- `id` (PK)
- `subscriber_id` (FK to subscribers)
- `invoice_number` (unique)
- `amount`
- `due_date`
- `paid_date`
- `status` (pending, paid, overdue, cancelled)
- `billing_cycle`
- `created_at`
- `updated_at`

### Payments
- `id` (PK)
- `bill_id` (FK to bills)
- `subscriber_id` (FK to subscribers)
- `payment_method` (bKash, Nagad, Rocket, SSLCommerz)
- `transaction_id`
- `amount`
- `status` (pending, verified, failed)
- `created_at`
- `updated_at`

### Tickets
- `id` (PK)
- `subscriber_id` (FK to subscribers)
- `assigned_to` (FK to staff)
- `title`
- `description`
- `priority` (low, medium, high, urgent)
- `status` (open, in_progress, resolved, closed)
- `created_at`
- `updated_at`

### MikroTik Routers
- `id` (PK)
- `name`
- `host`
- `port`
- `username`
- `password`
- `status`
- `created_at`
- `updated_at`

### Audit Logs
- `id` (PK)
- `user_id`
- `action`
- `table_name`
- `record_id`
- `old_values`
- `new_values`
- `ip_address`
- `created_at`

## Relationships
- One User to One Subscriber
- One Package to Many Subscribers
- One Subscriber to Many Bills
- One Bill to One Payment
- One Subscriber to Many Tickets
- One Staff to Many Tickets

## Notes
- All timestamps use UTC
- Soft deletes enabled where appropriate
- Indexes on foreign keys and frequently queried columns
- Passwords stored using bcrypt