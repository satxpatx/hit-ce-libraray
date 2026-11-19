-- HIT Civil Engineering - Digital Library Management System
-- PostgreSQL Initial Migration matching prisma/schema.prisma
-- Institution: Haldia Institute of Technology, Department of Civil Engineering

CREATE TYPE "RoleName" AS ENUM ('SUPER_ADMIN', 'LIBRARIAN', 'FACULTY', 'STUDENT');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'RESERVED', 'UNDER_MAINTENANCE', 'LOST', 'DAMAGED', 'WITHDRAWN');
CREATE TYPE "CirculationStatus" AS ENUM ('ISSUED', 'RETURNED', 'OVERDUE', 'LOST');
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'READY_FOR_PICKUP', 'FULFILLED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "FineStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED');
CREATE TYPE "AcquisitionStatus" AS ENUM ('PENDING', 'APPROVED', 'ORDERED', 'RECEIVED', 'REJECTED');

CREATE TABLE "roles" (
  "id" SERIAL PRIMARY KEY,
  "name" "RoleName" NOT NULL UNIQUE,
  "description" TEXT,
  "permissions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "departments" (
  "id" SERIAL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "institution" TEXT NOT NULL DEFAULT 'Haldia Institute of Technology',
  "location" TEXT NOT NULL DEFAULT 'Haldia, West Bengal, India',
  "hod_name" TEXT,
  "contact_email" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "users" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "phone" TEXT,
  "photo_url" TEXT,
  "role_id" INTEGER NOT NULL REFERENCES "roles"("id"),
  "department_id" INTEGER REFERENCES "departments"("id"),
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "user_sessions" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "students" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "member_code" TEXT NOT NULL UNIQUE,
  "roll_number" TEXT NOT NULL UNIQUE,
  "registration_number" TEXT UNIQUE,
  "semester" INTEGER NOT NULL DEFAULT 1,
  "batch_year" TEXT NOT NULL,
  "section" TEXT,
  "program" TEXT NOT NULL DEFAULT 'B.Tech Civil Engineering',
  "address" TEXT,
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "faculty" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "member_code" TEXT NOT NULL UNIQUE,
  "employee_id" TEXT NOT NULL UNIQUE,
  "designation" TEXT NOT NULL,
  "specialization" TEXT,
  "qualification" TEXT,
  "office_room" TEXT,
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "categories" (
  "id" SERIAL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "authors" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "affiliation" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "publishers" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "city" TEXT,
  "country" TEXT DEFAULT 'India',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "books" (
  "id" SERIAL PRIMARY KEY,
  "book_code" TEXT NOT NULL UNIQUE,
  "isbn" TEXT,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "author_id" INTEGER REFERENCES "authors"("id"),
  "author_display" TEXT NOT NULL,
  "co_authors" TEXT,
  "publisher_id" INTEGER REFERENCES "publishers"("id"),
  "publisher_display" TEXT,
  "edition" TEXT,
  "publication_year" INTEGER,
  "language" TEXT NOT NULL DEFAULT 'English',
  "pages" INTEGER,
  "category_id" INTEGER NOT NULL REFERENCES "categories"("id"),
  "subject" TEXT,
  "keywords" TEXT,
  "description" TEXT,
  "call_number" TEXT,
  "cover_image_url" TEXT,
  "department_id" INTEGER REFERENCES "departments"("id"),
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "books_isbn_idx" ON "books"("isbn");
CREATE INDEX "books_title_idx" ON "books"("title");
CREATE INDEX "books_category_id_idx" ON "books"("category_id");

CREATE TABLE "accession_sequences" (
  "id" SERIAL PRIMARY KEY,
  "prefix" TEXT NOT NULL DEFAULT 'HIT-CE',
  "year" INTEGER NOT NULL UNIQUE,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "book_copies" (
  "id" SERIAL PRIMARY KEY,
  "book_id" INTEGER NOT NULL REFERENCES "books"("id") ON DELETE CASCADE,
  "accession_number" TEXT NOT NULL UNIQUE,
  "copy_number" INTEGER NOT NULL DEFAULT 1,
  "barcode_value" TEXT NOT NULL UNIQUE,
  "qr_payload" TEXT NOT NULL,
  "acquisition_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vendor_name" TEXT,
  "bill_number" TEXT,
  "bill_date" TIMESTAMP(3),
  "purchase_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "funding_source" TEXT,
  "rack_number" TEXT,
  "shelf_number" TEXT,
  "physical_condition" TEXT NOT NULL DEFAULT 'Good',
  "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
  "remarks" TEXT,
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "book_copies_book_id_idx" ON "book_copies"("book_id");
CREATE INDEX "book_copies_status_idx" ON "book_copies"("status");

CREATE TABLE "circulation_transactions" (
  "id" SERIAL PRIMARY KEY,
  "transaction_code" TEXT NOT NULL UNIQUE,
  "copy_id" INTEGER NOT NULL REFERENCES "book_copies"("id"),
  "book_id" INTEGER NOT NULL REFERENCES "books"("id"),
  "borrower_user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "issued_by_user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "returned_to_user_id" INTEGER REFERENCES "users"("id"),
  "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "due_date" TIMESTAMP(3) NOT NULL,
  "return_date" TIMESTAMP(3),
  "renewal_count" INTEGER NOT NULL DEFAULT 0,
  "status" "CirculationStatus" NOT NULL DEFAULT 'ISSUED',
  "overdue_days" INTEGER NOT NULL DEFAULT 0,
  "fine_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "remarks" TEXT,
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "circulation_transactions_copy_id_idx" ON "circulation_transactions"("copy_id");
CREATE INDEX "circulation_transactions_borrower_user_id_idx" ON "circulation_transactions"("borrower_user_id");
CREATE INDEX "circulation_transactions_status_idx" ON "circulation_transactions"("status");

CREATE TABLE "reservations" (
  "id" SERIAL PRIMARY KEY,
  "book_id" INTEGER NOT NULL REFERENCES "books"("id") ON DELETE CASCADE,
  "copy_id" INTEGER REFERENCES "book_copies"("id"),
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "queue_position" INTEGER NOT NULL DEFAULT 1,
  "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
  "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "fulfilled_at" TIMESTAMP(3),
  "notes" TEXT,
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE "fines" (
  "id" SERIAL PRIMARY KEY,
  "receipt_number" TEXT NOT NULL UNIQUE,
  "transaction_id" INTEGER NOT NULL REFERENCES "circulation_transactions"("id") ON DELETE CASCADE,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "amount" DECIMAL(10,2) NOT NULL,
  "paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "waived_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "overdue_days" INTEGER NOT NULL DEFAULT 0,
  "status" "FineStatus" NOT NULL DEFAULT 'UNPAID',
  "waiver_reason" TEXT,
  "waived_by_user_id" INTEGER REFERENCES "users"("id"),
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "fine_payments" (
  "id" SERIAL PRIMARY KEY,
  "fine_id" INTEGER NOT NULL REFERENCES "fines"("id") ON DELETE CASCADE,
  "amount" DECIMAL(10,2) NOT NULL,
  "payment_mode" TEXT NOT NULL DEFAULT 'CASH',
  "reference_no" TEXT,
  "collected_by_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "digital_resources" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "subject" TEXT,
  "author_name" TEXT,
  "academic_year" TEXT,
  "semester" TEXT,
  "description" TEXT,
  "file_name" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size_bytes" INTEGER NOT NULL DEFAULT 0,
  "access_level" TEXT NOT NULL DEFAULT 'ALL_AUTHENTICATED',
  "download_count" INTEGER NOT NULL DEFAULT 0,
  "uploaded_by_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "acquisition_requests" (
  "id" SERIAL PRIMARY KEY,
  "requested_by_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "book_title" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "isbn" TEXT,
  "publisher" TEXT,
  "edition" TEXT,
  "category" TEXT,
  "estimated_price" DECIMAL(10,2),
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "justification" TEXT,
  "status" "AcquisitionStatus" NOT NULL DEFAULT 'PENDING',
  "review_notes" TEXT,
  "reviewed_by_id" INTEGER REFERENCES "users"("id"),
  "reviewed_at" TIMESTAMP(3),
  "is_demo_data" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "excel_import_logs" (
  "id" SERIAL PRIMARY KEY,
  "uploaded_by_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "file_name" TEXT NOT NULL,
  "sheet_name" TEXT,
  "import_type" TEXT NOT NULL DEFAULT 'BOOKS_AND_COPIES',
  "duplicate_mode" TEXT NOT NULL DEFAULT 'SKIP',
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "imported_rows" INTEGER NOT NULL DEFAULT 0,
  "updated_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_rows" INTEGER NOT NULL DEFAULT 0,
  "error_rows" INTEGER NOT NULL DEFAULT 0,
  "error_summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "notifications" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'INFO',
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "link_view" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "audit_logs" (
  "id" SERIAL PRIMARY KEY,
  "actor_user_id" INTEGER REFERENCES "users"("id"),
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "ip_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "system_settings" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "borrowing_policies" (
  "id" SERIAL PRIMARY KEY,
  "role_name" "RoleName" NOT NULL UNIQUE,
  "max_books" INTEGER NOT NULL,
  "loan_duration_days" INTEGER NOT NULL,
  "max_renewals" INTEGER NOT NULL,
  "grace_period_days" INTEGER NOT NULL DEFAULT 0,
  "daily_fine_inr" DECIMAL(10,2) NOT NULL DEFAULT 5.00,
  "max_fine_cap_inr" DECIMAL(10,2) NOT NULL DEFAULT 500.00,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "backup_logs" (
  "id" SERIAL PRIMARY KEY,
  "created_by_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "backup_type" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_size_bytes" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
