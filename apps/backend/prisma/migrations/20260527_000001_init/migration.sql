-- Initial migration for new architecture
CREATE TYPE "UserRole" AS ENUM ('ADMIN','LOGISTICS','TECHNICIAN','VALIDATOR');
CREATE TYPE "AppointmentStatus" AS ENUM ('DRAFT','WAITING','READY','CRITICAL','COMPLETED');

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  role "UserRole" NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  "refreshToken" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE technicians (
  id TEXT PRIMARY KEY,
  "userId" TEXT UNIQUE,
  name TEXT NOT NULL,
  "baseCity" TEXT NOT NULL,
  "baseAddress" TEXT NOT NULL,
  specialties TEXT[] NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  active BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_tech_user FOREIGN KEY ("userId") REFERENCES users(id)
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "technicianId" TEXT,
  city TEXT NOT NULL,
  "fullAddress" TEXT NOT NULL,
  "serviceType" TEXT NOT NULL,
  "problemDescription" TEXT,
  date TIMESTAMPTZ NOT NULL,
  "startTime" TIMESTAMPTZ NOT NULL,
  "endTime" TIMESTAMPTZ NOT NULL,
  status "AppointmentStatus" NOT NULL DEFAULT 'WAITING',
  "osNumber" TEXT,
  notes TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  "daysOut" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_app_client FOREIGN KEY ("clientId") REFERENCES clients(id),
  CONSTRAINT fk_app_tech FOREIGN KEY ("technicianId") REFERENCES technicians(id)
);

CREATE TABLE hotels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  "dailyRate" NUMERIC(10,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plate TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  "appointmentId" TEXT NOT NULL,
  type TEXT NOT NULL,
  "plannedAmount" NUMERIC(10,2),
  "realAmount" NUMERIC(10,2),
  notes TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_exp_app FOREIGN KEY ("appointmentId") REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  "appointmentId" TEXT NOT NULL,
  "driveFileId" TEXT NOT NULL,
  "driveFolderPath" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  size INTEGER NOT NULL,
  "publicUrl" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_att_app FOREIGN KEY ("appointmentId") REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  "userId" TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  "readAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_notif_user FOREIGN KEY ("userId") REFERENCES users(id)
);

CREATE TABLE status_logs (
  id TEXT PRIMARY KEY,
  "appointmentId" TEXT NOT NULL,
  "technicianId" TEXT,
  status TEXT NOT NULL,
  observation TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_status_app FOREIGN KEY ("appointmentId") REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT fk_status_tech FOREIGN KEY ("technicianId") REFERENCES technicians(id)
);

CREATE TABLE route_suggestions (
  id TEXT PRIMARY KEY,
  "originAppointmentId" TEXT NOT NULL,
  "nearbyAppointmentId" TEXT NOT NULL,
  "distanceKm" DOUBLE PRECISION NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  score INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_sug_origin FOREIGN KEY ("originAppointmentId") REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT fk_sug_near FOREIGN KEY ("nearbyAppointmentId") REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT uniq_sug UNIQUE ("originAppointmentId","nearbyAppointmentId")
);

CREATE TABLE final_validations (
  id TEXT PRIMARY KEY,
  "appointmentId" TEXT NOT NULL UNIQUE,
  "validatorName" TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_val_app FOREIGN KEY ("appointmentId") REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  "userId" TEXT,
  entity TEXT NOT NULL,
  "entityId" TEXT,
  action TEXT NOT NULL,
  metadata JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_audit_user FOREIGN KEY ("userId") REFERENCES users(id)
);

CREATE INDEX idx_users_role_active ON users(role, active);
CREATE INDEX idx_tech_name ON technicians(name);
CREATE INDEX idx_clients_city ON clients(city);
CREATE INDEX idx_app_status_date ON appointments(status, date);
CREATE INDEX idx_app_tech_date ON appointments("technicianId", date);
CREATE INDEX idx_notif_user_created ON notifications("userId", "createdAt");
CREATE INDEX idx_status_app_created ON status_logs("appointmentId", "createdAt");
CREATE INDEX idx_route_status_score ON route_suggestions(status, score);
CREATE INDEX idx_audit_entity_created ON audit_logs(entity, "entityId", "createdAt");
