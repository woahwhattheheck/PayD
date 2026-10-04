# PayD: Stellar-Based Cross-Border Payroll Platform!

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Powered%20by-Stellar-7B68EE)](https://www.stellar.org/)

## 🧩 Project Summary

PayD is a revolutionary payroll system that enables organizations to pay employees, contractors, and partners across different countries using blockchain-based digital assets. By leveraging Stellar's fast, low-cost network, PayD replaces traditional banking rails with near-instant, transparent, and cost-effective payments.

**Key Benefits:**

- ⚡ Near-instant salary payments (seconds vs. days)
- 🔍 Transparent transaction tracking on-chain
- 💰 Lower cross-border fees (fraction of traditional banking)
- 📊 Stable-value payouts with predictable conversion rates

## 🚨 Problem This Solves

Traditional international payroll faces significant challenges:

| Problem                        | Impact                                  |
| ------------------------------ | --------------------------------------- |
| International bank delays      | Payments take 2–5 business days         |
| High transfer fees             | SWIFT + intermediary fees (often 5-15%) |
| Currency conversion issues     | Unpredictable FX rates and hidden fees  |
| Lack of proof                  | Difficult to verify payment delivery    |
| Contractor/freelancer payments | Many unbanked or prefer digital methods |

## 💡 Core Concept

Instead of routing through expensive banking infrastructure:

All transactions occur on-chain with full transparency and auditability.

## 🏗 System Architecture

┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐ │ Organization │ │ Backend │ │ Stellar │ │ Dashboard │────│ (API) │────│ Network │ │ (Web App) │ │ │ │ │ └─────────────────┘ └──────────────┘ └─────────────────┘ │ │ │ ▼ ▼ ▼ ┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐ │ Employee │ │ Payroll │ │ Employee │ │ Onboarding │ │ Engine │ │ Wallets │ └─────────────────┘ └──────────────┘ └─────────────────┘ │ ▼ ┌─────────────────┐ │ Local Anchors │ │ (Cash-out) │ └─────────────────┘

## 🔑 Main Actors

| Actor                   | Role                                                          |
| ----------------------- | ------------------------------------------------------------- |
| **Employer**            | Funds payroll, schedules payments, manages employees          |
| **Employee/Contractor** | Receives salary in digital assets, converts to local currency |
| **Backend System**      | Handles payroll logic, transaction processing                 |
| **Stellar Network**     | Processes fast, low-cost transactions                         |
| **Anchor Services**     | Converts digital assets to local bank/mobile money            |

## 💰 Asset Design on Stellar

PayD utilizes Stellar's asset issuance capabilities to create organization-specific stable assets:

### Example Asset: ORGUSD

- **Issuer Account**: Controlled by the organization
- **Backing**: 1:1 with USD (or other stable currencies)
- **Distribution**: Through organization's distribution account
- **Trustlines**: Employees must accept the asset to receive payments

### Stellar Concepts Employed

- **Asset Issuance**: Creating custom tokens for payroll
- **Distribution Accounts**: Managing bulk payments
- **Trustlines**: Employee wallet acceptance
- **Anchors**: Local currency conversion
- **Fast Settlement**: Sub-5 second transaction finality

## ⚙️ Core Features

### 1️⃣ Employer Dashboard

- **Employee Management**: Add/remove employees with wallet addresses
- **Salary Configuration**: Set amounts, frequencies (weekly/monthly)
- **Bulk Upload**: CSV import for payroll lists
- **Payment Scheduling**: Automated recurring payments
- **Analytics**: Payroll history, total costs, FX tracking

### 2️⃣ Employee Portal

- **Salary Tracking**: View incoming payments
- **Transaction History**: Complete on-chain records
- **Balance Management**: Asset balances and values
- **Withdrawal Options**: Multiple anchor services
- **Wallet Integration**: QR codes for easy setup

### 3️⃣ Payroll Engine (Backend)

**Automated Payment Flow:**

1. Checks scheduled payments at designated times
2. Verifies employer account balance and authorization
3. Signs and submits Stellar transactions
4. Processes bulk payments efficiently
5. Logs all transactions in database
6. Sends notifications to employees

### 4️⃣ FX & Conversion System

- **Real-time Rates**: Live asset-to-fiat conversion
- **Anchor Fees**: Transparent withdrawal costs
- **Network Fees**: Minimal Stellar transaction fees
- **Multi-currency Support**: Support for various local currencies

### 5️⃣ Transparency & Auditability

Every payment includes:

- **Transaction Hash**: Unique Stellar transaction ID
- **Timestamp**: Exact payment time
- **On-chain Verification**: Public ledger proof
- **Audit Trail**: Complete payment history

## 🛠 Tech Stack

### Frontend

- **React 19** - Modern UI framework
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool
- **Stellar Design System** - Consistent UI components
- **React Router** - Client-side routing
- **TanStack Query** - Data fetching and caching

### Backend

- **Node.js** - Runtime environment
- **Express.js** - API framework
- **Stellar SDK** - Blockchain integration
- **PostgreSQL** - Data persistence
- **Redis** - Caching and session management

### Blockchain

- **Stellar Network** - Primary blockchain
- **Soroban** - Smart contracts (future expansion)
- **Stellar Wallets Kit** - Wallet integration

### DevOps

- **Docker** - Containerization
- **GitHub Actions** - CI/CD pipelines
- **ESLint + Prettier** - Code quality
- **Husky** - Git hooks

## 🚀 Getting Started

### Prerequisites

- **Node.js** v22+ and **npm** for the frontend and backend.
- **Rust** and **Stellar CLI** when working on the Soroban contracts.
- A configured PostgreSQL instance and any services needed by the backend features
  you use; see the [backend setup](backend/README.md).

### Install the frontend

Clone the repository, then install and run from its root:

```bash
git clone https://github.com/Protocol-Guild/PayD.git
cd PayD
npm install --prefix frontend
npm run dev
```

The application source is in [`frontend/src/`](frontend/src/). The root
[`package.json`](package.json) forwards `dev`, `build`, `preview`, and `lint` to
[`frontend/package.json`](frontend/package.json). Its `packages/*` workspace
pattern does not include `frontend/` or `backend/`, so installing only the root
package does not install either application's declared dependencies.

The frontend commands above need only the frontend installation. Run `npm install`
in the root separately when you need repository-wide formatting or the Git hooks;
those tools are declared in the root package.

`npm run dev` starts Vite only. Open the URL printed by Vite; it does not start
the backend, a database, or a local Stellar network.

### Configure and start the backend

From the repository root, install and configure the backend separately:

```bash
npm install --prefix backend
cp backend/.env.example backend/.env
```

Edit `backend/.env` using the
[backend configuration and database instructions](backend/README.md) before
starting it in a separate terminal:

```bash
npm run backend:dev
```

The current [`frontend/vite.config.ts`](frontend/vite.config.ts) proxies `/api`
to `http://localhost:3000`. Set `PORT=3000` in `backend/.env` for that development
proxy, or update its target to the backend port you choose. The backend's default
port is 3001. Copying the root `.env.example` alone does not configure the backend.

### Commands from the repository root

| Command                              | Package and purpose                            |
| ------------------------------------ | ---------------------------------------------- |
| `npm run dev`                        | Frontend Vite development server               |
| `npm run build`                      | Frontend TypeScript compilation and Vite build |
| `npm run preview`                    | Frontend preview of a completed build          |
| `npm run lint`                       | Frontend ESLint                                |
| `npm run format`                     | Repository-wide Prettier                       |
| `npm run backend:dev`                | Backend development server                     |
| `npm run backend:test`               | Backend Jest tests                             |
| `npm run build --prefix backend`     | Backend TypeScript build                       |
| `npm run test:e2e --prefix frontend` | Frontend Playwright tests                      |

There is no root `test` script. The backend and frontend test commands above
are separate; frontend Playwright setup is documented in
[`frontend/e2e/README.md`](frontend/e2e/README.md). A frontend build does not build
the backend or Soroban contracts.
