# ISP Management System — Software Requirement Specification (SRS)

## 1. Introduction
This document describes the functional scope and requirements for the Next-Gen ISP Management System & Website Portal.

## 2. Functional Requirements

### 2.1 Public Website and Internet Packages
- Public-facing website with internet packages
- Coverage finder to check service availability
- Online connection request submission

### 2.2 Authentication and Role-Based Access Control
- User authentication with role-based access control
- Super Admin role for full system access
- Admin, Staff, and Subscriber roles

### 2.3 Super Admin Dashboard
- Admin dashboard with key metrics and charts
- Subscriber management
- Billing and payment overview
- Reports and analytics

### 2.4 Accounts and Billing
- Monthly invoices and billing cycles
- Payment tracking and reconciliation
- Multiple payment gateways

### 2.5 Payment Gateways
- bKash Tokenized Checkout
- Nagad Payment Integration
- Rocket Payment Integration
- SSLCommerz Integration

### 2.6 MikroTik RouterOS Integration
- PPPoE subscriber management
- Static IP subscriber management
- Bandwidth and queue management
- Automated enable/disable and reconnection

### 2.7 CRM and Helpdesk
- Ticket management system
- Field technician job management
- SMS notifications

### 2.8 Subscriber Client Portal
- Subscriber dashboard
- Bill management
- Payment history
- Support ticket submission

### 2.9 Reports and Audit Logs
- Comprehensive reporting
- Audit log tracking

### 2.10 Application Security
- Access control
- Credential handling
- Payment security
- Router security

## 3. Unresolved Requirements
- [ ] MikroTik RouterOS API credentials (test environment)
- [ ] Payment gateway API keys (sandbox/test mode)
- [ ] SMS gateway provider selection
- [ ] Exact coverage area definition
- [ ] Bandwidth plan configurations