// db/index.js — PostgreSQL connection pool
// Semua query ke DB lewat file ini

const { Pool } = require('pg');

// Pool otomatis menggunakan DATABASE_URL dari .env
// Atau bisa set tiap variabel terpisah (PG_HOST, PG_USER, dst.)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Kalau tidak pakai URL, uncomment ini:
    // host:     process.env.PG_HOST     || 'localhost',
    // port:     parseInt(process.env.PG_PORT) || 5432,
    // database: process.env.PG_DATABASE || 'tracking_db',
    // user:     process.env.PG_USER     || 'postgres',
    // password: process.env.PG_PASSWORD || '',
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client:', err.message);
});

// ── Verifikasi koneksi saat startup ────────────────────────
async function testConnection() {
    try {
        const res = await pool.query('SELECT NOW() AS now');
        console.log(`[DB] PostgreSQL terhubung ✓  (${res.rows[0].now})`);
    } catch (err) {
        console.error('[DB] Gagal terhubung ke PostgreSQL:', err.message);
        console.error('     Pastikan DATABASE_URL di .env sudah benar.');
        process.exit(1);
    }
}

// ── Query helpers ───────────────────────────────────────────

/** Ambil daftar sopir berdasarkan vehicle_code, opsional filter nama */
async function getDriversByVehicle(vehicleCode, query = '') {
    const sql = `
        SELECT d.id, d.name, d.phone
        FROM drivers d
        JOIN vehicles v ON v.id = d.vehicle_id
        WHERE v.vehicle_code = $1
          AND d.is_active = true
          AND ($2 = '' OR LOWER(d.name) LIKE LOWER('%' || $2 || '%'))
        ORDER BY d.name
    `;
    const { rows } = await pool.query(sql, [vehicleCode, query]);
    return rows;
}

/** Verifikasi login sopir — return driver row atau null */
async function verifyDriver(vehicleCode, name, pin) {
    const sql = `
        SELECT d.id, d.name, d.phone, v.vehicle_code, v.route, v.plate_number
        FROM drivers d
        JOIN vehicles v ON v.id = d.vehicle_id
        WHERE v.vehicle_code = $1
          AND d.name          = $2
          AND d.pin           = $3
          AND d.is_active     = true
          AND v.is_active     = true
    `;
    const { rows } = await pool.query(sql, [vehicleCode, name, pin]);
    return rows[0] || null;
}

/** Buat sesi baru saat sopir mulai bertugas */
async function createSession(vehicleId, driverId) {
    // Tutup sesi lama yang masih aktif untuk kendaraan ini (kalau ada)
    await pool.query(
        `UPDATE sessions SET status = 'ended', ended_at = NOW()
         WHERE vehicle_id = $1 AND status = 'active'`,
        [vehicleId]
    );
    const { rows } = await pool.query(
        `INSERT INTO sessions (vehicle_id, driver_id) VALUES ($1, $2) RETURNING id`,
        [vehicleId, driverId]
    );
    return rows[0].id;
}

/** Tutup sesi saat sopir selesai bertugas / disconnect */
async function endSession(sessionId) {
    if (!sessionId) return;
    await pool.query(
        `UPDATE sessions SET status = 'ended', ended_at = NOW() WHERE id = $1`,
        [sessionId]
    );
}

/** Catat koordinat ke location_logs */
async function logLocation(sessionId, vehicleId, lat, lng) {
    await pool.query(
        `INSERT INTO location_logs (session_id, vehicle_id, lat, lng) VALUES ($1, $2, $3, $4)`,
        [sessionId, vehicleId, lat, lng]
    );
}

/** Ambil semua kendaraan aktif + lokasi terakhir */
async function getAllVehicles() {
    const sql = `
        SELECT
            v.vehicle_code  AS id,
            v.plate_number,
            v.route,
            ll.lat,
            ll.lng,
            ll.logged_at    AS "updatedAt",
            ll.driver_name  AS "driverName",
            (ase.vehicle_id IS NOT NULL) AS "isOnline",
            EXTRACT(EPOCH FROM (NOW() - ll.logged_at))::INT AS "secsAgo"
        FROM vehicles v
        LEFT JOIN latest_locations ll  ON ll.vehicle_id = v.id
        LEFT JOIN active_sessions  ase ON ase.vehicle_id = v.id
        WHERE v.is_active = true
        ORDER BY v.vehicle_code
    `;
    const { rows } = await pool.query(sql);
    return rows;
}

/** Ambil ID numerik vehicle dari vehicle_code */
async function getVehicleId(vehicleCode) {
    const { rows } = await pool.query(
        'SELECT id FROM vehicles WHERE vehicle_code = $1',
        [vehicleCode]
    );
    return rows[0]?.id || null;
}

module.exports = {
    pool,
    testConnection,
    getDriversByVehicle,
    verifyDriver,
    createSession,
    endSession,
    logLocation,
    getAllVehicles,
    getVehicleId
};
