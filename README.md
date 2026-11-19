# HIT Civil Engineering – Digital Library Management System

**Institution:** Haldia Institute of Technology  
**Department:** Department of Civil Engineering  
**Location:** Haldia, West Bengal, India  
**Tagline:** Knowledge. Research. Innovation.

A full-stack university departmental Library Management System engineered for physical book copy tracking, formal accession register maintenance, QR code and Code 128 barcode label printing, scanner-driven book circulation, bulk Excel import/export, digital repository governance, and role-based access control.

---

## Attribution & License

This application uses the open-source repository [`vinitshahdeo/Library-Management-System`](https://github.com/vinitshahdeo/Library-Management-System) as a functional reference for core library workflows, modernized into an independent full-stack architecture with original institutional branding for the Department of Civil Engineering, Haldia Institute of Technology.

- **License:** MIT License (see `/LICENSE`)
- **Attribution:** Original functional reference copyright (c) Vinit Shahdeo (MIT License).

---

## Key Capabilities

1. **Physical Copy & Accession Register Management**
   - Sequential, non-reusable institutional accession numbers (`HIT-CE-YYYY-NNNN`, e.g., `HIT-CE-2026-0001`).
   - Full acquisition metadata: vendor, bill number, bill date, INR purchase price, funding source, rack/shelf location, physical condition, and copy lifecycle status (`AVAILABLE`, `ISSUED`, `RESERVED`, `UNDER_MAINTENANCE`, `LOST`, `DAMAGED`, `WITHDRAWN`).
   - Official printable PDF Accession Register and Excel register exports.
2. **QR Code & Code 128 Barcode Engine + Scanner Circulation**
   - Real Code 128 barcodes (`jsbarcode`) and structured JSON QR codes (`qrcode`) for every physical copy.
   - A4 printable label sheets with bulk selection.
   - Scan & Issue / Return desk supporting USB keyboard-wedge barcode scanners, webcam/mobile QR camera scanning (`html5-qrcode`), and manual accession lookup.
   - Transactional duplicate-issuance prevention, role borrowing limits, reservation queue fulfillment, overdue fine calculation in INR, and downloadable PDF receipts (`jspdf`).
3. **Excel Import & Export Engine**
   - Real `.xlsx`, `.xls`, and `.csv` parsing (`xlsx`) with worksheet selector, manual column mapping, row-by-row validation, duplicate accession/ISBN detection, configurable duplicate modes (`SKIP`, `UPDATE`, `ADD_COPY`), and downloadable `.xlsx` validation error reports.
   - 11 formatted institutional ExcelJS (`.xlsx`) export workbooks and import templates for inventory, students, and faculty.
4. **Role-Based Access Control (Backend & Frontend)**
   - **Super Admin:** Full system governance, user/role administration, institutional logo upload, borrowing policies, audit logs, and database backups.
   - **Librarian:** Inventory, accession register, barcode/QR labels, circulation, reservations, fines, members, digital resources, Excel import/export, and reports.
   - **Faculty:** Catalogue search, reservations, self-renewal, digital repository downloads, and book acquisition requests.
   - **Student:** Catalogue search, availability lookup, reservations, loan/due-date tracking, digital repository downloads, and book requests.
5. **Institutional Branding**
   - Configurable upload fields for the **Haldia Institute of Technology** logo and **Department of Civil Engineering** logo under `Administration -> Department Settings`.

---

## Architecture & Persistence

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Recharts, JsBarcode, QRCode, html5-qrcode, jsPDF.
- **Backend:** Node.js + Express REST API (`server.ts`, `server/routesCore.ts`, `server/routesExtended.ts`, `server/excelService.ts`), bcrypt password hashing, HTTP-only session cookies + Bearer tokens, Zod validation, and structured audit logging.
- **Database:**
  - **Embedded Live Runtime Database:** Node.js native relational SQLite (`node:sqlite`, WAL mode, foreign keys enforced, ACID transactions) persisted at `./data/hit_civil_library.db` for zero-config operation.
  - **Cloud Auth & Sync:** Firebase Authentication (Google Sign-In) and Cloud Firestore with audited `firestore.rules`.
  - **Institutional PostgreSQL Deployment:** Complete 28-model Prisma schema (`/prisma/schema.prisma`) and initial SQL migration (`/prisma/migrations/0001_init/migration.sql`) ready for PostgreSQL servers.

---

## Installation & Local Development

### 1. Prerequisites
- Node.js 22+
- npm 10+

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy `.env.example` to `.env` and populate values as needed:
```bash
cp .env.example .env
```

### 4. Start the Application
```bash
npm run dev
```
The full-stack Express + Vite application starts on `http://localhost:3000`.  
On first startup, the database schema is automatically initialized and seeded with a clearly labelled **Demonstration / Sample Dataset** (100 Civil Engineering titles, 150 physical copies, 20 students, 10 faculty, 30 circulation records, 10 overdues, 15 digital resources, and 10 acquisition requests).

### 5. Build for Production
```bash
npm run build
npm start
```

---

## Institutional PostgreSQL Setup (Prisma)

To deploy against a dedicated institutional PostgreSQL server:
1. Set `DATABASE_URL="postgresql://user:password@host:5432/hit_civil_library?schema=public"` in `.env`.
2. Apply the included Prisma schema and migration:
   ```bash
   npx prisma migrate deploy
   # or apply prisma/migrations/0001_init/migration.sql directly via psql
   ```

---

## Demonstration Accounts (Sample Data)

| Role | Email | Password |
| :--- | :--- | :--- |
| Super Admin | `admin.ce@hithaldia.ac.in` | `Admin@HIT2026` |
| Librarian | `librarian.ce@hithaldia.ac.in` | `Librarian@HIT2026` |
| Faculty | `faculty.ce@hithaldia.ac.in` | `Faculty@HIT2026` |
| Student | `student.ce@hithaldia.ac.in` | `Student@HIT2026` |

---

## Verification & Testing

- **Unit Tests (Business Rules):**
  ```bash
  npx tsx --test src/lib/libraryRules.test.ts
  ```
- **Firestore Security Rules Audit:**
  ```bash
  npm run lint:rules
  ```
- **TypeScript & Production Bundle Check:**
  ```bash
  npm run lint
  npm run build
  ```
