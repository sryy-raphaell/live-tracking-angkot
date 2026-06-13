# 🚐 Live Tracking Bus

Sistem live tracking angkutan umum berbasis web. Penumpang scan QR → lihat posisi realtime di peta.

## Cara Pakai

### 1. Install & Jalankan

```bash
npm install
npm start
```

Server akan jalan di `http://localhost:3000`

### 2. Alur Penggunaan

| Halaman   | URL                     | Untuk                                |
| --------- | ----------------------- | ------------------------------------ |
| Admin     | `/`                     | Generate QR & pantau semua kendaraan |
| Sopir     | `/driver.html?id=BD-01` | Kirim lokasi GPS                     |
| Penumpang | `/track.html?id=BD-01`  | Lihat peta realtime                  |

### 3. Langkah di Lapangan

1. Buka halaman **Admin** → masukkan ID kendaraan → klik **Generate QR**
2. QR Sopir → kasih ke sopir, scan sekali saat mulai bertugas
3. QR Penumpang → cetak & tempel di kendaraan atau halte

## Fitur

- Realtime via WebSocket (Socket.io)
- Peta Leaflet.js (gratis, tanpa API key)
- Lokasi terakhir tetap tampil walau sopir belum gerak
- Deteksi sopir online/offline
- WakeLock — cegah layar HP sopir mati
- Multi-kendaraan (Socket.io rooms)
- QR generator lokal (tanpa API eksternal)
- Dashboard admin + auto-refresh

## Deploy

- **Backend:** Railway atau Render (free tier)
- **Catatan:** HTTPS wajib agar GPS browser bekerja di production

## Struktur

```
live-tracking/
├── server.js          # Backend Express + Socket.io
├── package.json
└── public/
    ├── index.html     # Admin dashboard + QR generator
    ├── driver.html    # Halaman sopir (kirim GPS)
    └── track.html     # Halaman penumpang (lihat peta)
```
