// server.js — Live Tracking BUs
// Stack: Express + Socket.io + PostgreSQL

require('dotenv').config();

const express = require('express');
const app     = express();
const http    = require('http').createServer(app);
const io      = require('socket.io')(http);
const path    = require('path');
const db      = require('./db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory cache (performa realtime, tidak gantikan DB) ───────────────────
//
//  vehicleCache[vehicleCode] = {
//      vehicleId,       ← ID numerik dari tabel vehicles
//      lat, lng,
//      updatedAt,
//      driverName,
//      isOnline,
//      sessionId        ← ID sesi aktif dari tabel sessions
//  }
//
const vehicleCache  = {};   // { vehicleCode: { ...data } }
const driverSockets = {};   // { socketId: vehicleCode }  ← untuk cleanup saat disconnect

// ─── Static & root ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

// ─── API: Daftar sopir per kendaraan (dengan filter nama) ─────────────────────
app.get('/api/drivers/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const q = req.query.q || '';
        const list = await db.getDriversByVehicle(vehicleId, q);
        res.json(list.map(d => ({ name: d.name })));
    } catch (err) {
        console.error('[API /drivers]', err.message);
        res.status(500).json({ error: 'Gagal mengambil data sopir.' });
    }
});

// ─── API: Login sopir ─────────────────────────────────────────────────────────
app.post('/api/driver/login', async (req, res) => {
    try {
        const { vehicleId, name, pin } = req.body;
        if (!vehicleId || !name || !pin) {
            return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });
        }
        const driver = await db.verifyDriver(vehicleId, name, pin);
        if (driver) {
            res.json({ success: true, name: driver.name, vehicleId: driver.vehicle_code });
        } else {
            res.json({ success: false, message: 'Nama atau PIN salah.' });
        }
    } catch (err) {
        console.error('[API /driver/login]', err.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ─── API: Semua kendaraan aktif (untuk admin dashboard) ──────────────────────
app.get('/api/vehicles', async (req, res) => {
    try {
        // Gabungkan data dari DB dengan status online realtime dari cache
        const fromDB = await db.getAllVehicles();
        const result = fromDB.map(v => ({
            ...v,
            isOnline:   vehicleCache[v.id]?.isOnline   ?? v.isOnline,
            driverName: vehicleCache[v.id]?.driverName ?? v.driverName,
            lat:        vehicleCache[v.id]?.lat        ?? v.lat,
            lng:        vehicleCache[v.id]?.lng        ?? v.lng,
            updatedAt:  vehicleCache[v.id]?.updatedAt  ?? v.updatedAt,
        }));
        res.json(result);
    } catch (err) {
        console.error('[API /vehicles]', err.message);
        res.status(500).json({ error: 'Gagal mengambil data kendaraan.' });
    }
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[+] ${socket.id}`);

    // ── Sopir: join setelah login berhasil ─────────────────────────────────
    socket.on('driverJoin', async ({ vehicleId, driverName }) => {
        try {
            socket.join(vehicleId);
            socket.data = { vehicleId, driverName, role: 'driver' };
            driverSockets[socket.id] = vehicleId;

            // Ambil ID numerik dari DB, lalu buat sesi baru
            const [vehicleNumId, driver] = await Promise.all([
                db.getVehicleId(vehicleId),
                db.verifyDriver(vehicleId, driverName, null)
                    .catch(() => null)
            ]);

            // Cari driverId dari nama saja (sudah diverifikasi PIN sebelumnya)
            const { rows: driverRows } = await db.pool.query(
                `SELECT d.id FROM drivers d
                 JOIN vehicles v ON v.id = d.vehicle_id
                 WHERE v.vehicle_code = $1 AND d.name = $2 AND d.is_active = true`,
                [vehicleId, driverName]
            );
            const driverId = driverRows[0]?.id;

            let sessionId = null;
            if (vehicleNumId && driverId) {
                sessionId = await db.createSession(vehicleNumId, driverId);
                console.log(`[Sesi] #${sessionId} dimulai — ${driverName} → ${vehicleId}`);
            }

            // Simpan ke cache
            if (!vehicleCache[vehicleId]) vehicleCache[vehicleId] = {};
            Object.assign(vehicleCache[vehicleId], {
                vehicleId:   vehicleNumId,
                vehicleCode: vehicleId,
                driverName,
                sessionId,
                isOnline: true,
            });
            socket.data.sessionId  = sessionId;
            socket.data.vehicleNumId = vehicleNumId;

            io.to(vehicleId).emit('driverStatus', { online: true, vehicleId, driverName });
            io.to('__monitor__').emit('vehicleUpdate', { ...vehicleCache[vehicleId], isOnline: true });
            io.to('__nearby__').emit('vehicleUpdate', { ...vehicleCache[vehicleId], isOnline: true });

        } catch (err) {
            console.error('[driverJoin]', err.message);
        }
    });

    // ── Penumpang: join room kendaraan tertentu ────────────────────────────
    socket.on('joinRoom', (vehicleId) => {
        socket.join(vehicleId);
        socket.data = { vehicleId, role: 'passenger' };

        const cached = vehicleCache[vehicleId];
        if (cached?.lat) socket.emit('locationUpdate', cached);
        socket.emit('driverStatus', {
            online:     cached?.isOnline  ?? false,
            vehicleId,
            driverName: cached?.driverName ?? '—'
        });
    });

    // ── Monitor: pantau semua kendaraan ───────────────────────────────────
    socket.on('joinMonitor', async () => {
        socket.join('__monitor__');
        socket.data = { role: 'monitor' };
        try {
            const fromDB = await db.getAllVehicles();
            const snapshot = fromDB.map(v => ({
                ...v,
                isOnline:   vehicleCache[v.id]?.isOnline   ?? v.isOnline,
                driverName: vehicleCache[v.id]?.driverName ?? v.driverName,
                lat:        vehicleCache[v.id]?.lat        ?? v.lat,
                lng:        vehicleCache[v.id]?.lng        ?? v.lng,
            }));
            socket.emit('allLocations', snapshot);
        } catch (err) {
            console.error('[joinMonitor]', err.message);
            // Fallback ke cache saja
            socket.emit('allLocations', Object.values(vehicleCache));
        }
    });

    // ── Nearby: penumpang di halte lihat semua Bus ─────────────────────
    socket.on('joinNearby', async () => {
        socket.join('__nearby__');
        socket.data = { role: 'nearby' };
        try {
            const fromDB = await db.getAllVehicles();
            const snapshot = fromDB.map(v => ({
                ...v,
                isOnline:   vehicleCache[v.id]?.isOnline   ?? v.isOnline,
                driverName: vehicleCache[v.id]?.driverName ?? v.driverName,
                lat:        vehicleCache[v.id]?.lat        ?? v.lat,
                lng:        vehicleCache[v.id]?.lng        ?? v.lng,
            }));
            socket.emit('allLocations', snapshot);
        } catch (err) {
            socket.emit('allLocations', Object.values(vehicleCache));
        }
    });

    // ── Sopir: kirim koordinat ─────────────────────────────────────────────
    socket.on('updateLocation', async ({ vehicleId, lat, lng }) => {
        if (!vehicleId || lat === undefined || lng === undefined) return;

        const updatedAt = Date.now();
        const entry = vehicleCache[vehicleId] || {};

        const payload = {
            ...entry,
            vehicleId:   entry.vehicleId,
            vehicleCode: vehicleId,
            lat, lng, updatedAt,
            isOnline:    true,
            driverName:  entry.driverName || socket.data?.driverName || '—',
        };
        vehicleCache[vehicleId] = payload;

        // Broadcast realtime
        io.to(vehicleId).emit('locationUpdate', payload);
        io.to('__monitor__').emit('vehicleUpdate', payload);
        io.to('__nearby__').emit('vehicleUpdate', payload);

        // Catat ke DB (fire-and-forget, tidak blokir realtime)
        if (entry.sessionId && entry.vehicleId) {
            db.logLocation(entry.sessionId, entry.vehicleId, lat, lng)
                .catch(err => console.error('[logLocation]', err.message));
        }
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
        const { vehicleId, role, driverName, sessionId } = socket.data || {};
        console.log(`[-] ${socket.id} (${role}, ${vehicleId || '—'})`);

        if (role === 'driver' && vehicleId) {
            if (driverSockets[socket.id] === vehicleId) {
                delete driverSockets[socket.id];

                if (vehicleCache[vehicleId]) {
                    vehicleCache[vehicleId].isOnline = false;
                }

                io.to(vehicleId).emit('driverStatus', { online: false, vehicleId });
                io.to('__monitor__').emit('vehicleUpdate', {
                    ...(vehicleCache[vehicleId] || {}),
                    vehicleCode: vehicleId, isOnline: false
                });
                io.to('__nearby__').emit('vehicleUpdate', {
                    ...(vehicleCache[vehicleId] || {}),
                    vehicleCode: vehicleId, isOnline: false
                });

                // Tutup sesi di DB
                if (sessionId) {
                    db.endSession(sessionId)
                        .then(() => console.log(`[Sesi] #${sessionId} ditutup — ${driverName}`))
                        .catch(err => console.error('[endSession]', err.message));
                }
            }
        }
    });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
    await db.testConnection();
    http.listen(PORT, () => {
        console.log(`✅ Server jalan di http://localhost:${PORT}`);
    });
}

start();