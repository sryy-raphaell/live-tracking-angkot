-- ============================================================
--  Live Tracking Bus — Database Schema
--  PostgreSQL 14+
--  Jalankan: psql -d tracking_db -f schema.sql
-- ============================================================

-- Master kendaraan
CREATE TABLE IF NOT EXISTS vehicles (
    id           SERIAL PRIMARY KEY,
    vehicle_code VARCHAR(20)  UNIQUE NOT NULL,   -- "BD-01"
    plate_number VARCHAR(15),                     -- "BA 1234 XY"
    route        VARCHAR(100),                    -- "Pasar Sago - Painan"
    is_active    BOOLEAN      DEFAULT true,
    created_at   TIMESTAMP    DEFAULT NOW()
);

-- Data sopir
CREATE TABLE IF NOT EXISTS drivers (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    phone      VARCHAR(20),
    pin        VARCHAR(10)  NOT NULL,             -- PIN 4–6 angka (plain text, upgrade ke hash nanti)
    vehicle_id INT          REFERENCES vehicles(id) ON DELETE SET NULL,
    is_active  BOOLEAN      DEFAULT true,
    created_at TIMESTAMP    DEFAULT NOW()
);

-- Sesi operasional (satu baris per giliran kerja sopir)
CREATE TABLE IF NOT EXISTS sessions (
    id         SERIAL PRIMARY KEY,
    vehicle_id INT          NOT NULL REFERENCES vehicles(id),
    driver_id  INT          NOT NULL REFERENCES drivers(id),
    started_at TIMESTAMP    DEFAULT NOW(),
    ended_at   TIMESTAMP,                         -- NULL = masih aktif
    status     VARCHAR(20)  DEFAULT 'active'      -- active | ended
);

-- Riwayat koordinat GPS (volume tinggi)
CREATE TABLE IF NOT EXISTS location_logs (
    id         BIGSERIAL PRIMARY KEY,
    session_id INT          NOT NULL REFERENCES sessions(id),
    vehicle_id INT          NOT NULL REFERENCES vehicles(id),
    lat        DECIMAL(10,7) NOT NULL,
    lng        DECIMAL(10,7) NOT NULL,
    logged_at  TIMESTAMP    DEFAULT NOW()
);

-- ── Indeks penting ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_location_vehicle  ON location_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_location_time     ON location_logs(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_session  ON location_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_session_active    ON sessions(vehicle_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_driver_vehicle    ON drivers(vehicle_id);

-- ── View: sesi aktif saat ini (shortcut untuk query server) ─
CREATE OR REPLACE VIEW active_sessions AS
SELECT
    s.id         AS session_id,
    s.vehicle_id,
    v.vehicle_code,
    v.plate_number,
    v.route,
    s.driver_id,
    d.name       AS driver_name,
    d.phone      AS driver_phone,
    s.started_at
FROM sessions  s
JOIN vehicles  v ON v.id = s.vehicle_id
JOIN drivers   d ON d.id = s.driver_id
WHERE s.status = 'active';

-- ── View: posisi terakhir per kendaraan ─────────────────────
CREATE OR REPLACE VIEW latest_locations AS
SELECT DISTINCT ON (ll.vehicle_id)
    ll.vehicle_id,
    v.vehicle_code,
    v.route,
    ll.lat,
    ll.lng,
    ll.logged_at,
    d.name  AS driver_name
FROM location_logs ll
JOIN vehicles v ON v.id = ll.vehicle_id
LEFT JOIN active_sessions ase ON ase.vehicle_id = ll.vehicle_id
LEFT JOIN drivers d ON d.id = ase.driver_id
ORDER BY ll.vehicle_id, ll.logged_at DESC;
