-- ============================================================
--  Seed data — untuk development & demo
--  Jalankan SETELAH schema.sql:
--  psql -d tracking_db -f seed.sql
-- ============================================================

-- Kendaraan
INSERT INTO vehicles (vehicle_code, plate_number, route) VALUES
    ('BD-01', 'BA 1234 XY', 'Pasar Sago - Painan'),
    ('BD-02', 'BA 5678 AB', 'Pasar Baru - Tapan'),
    ('BD-03', 'BA 9012 CD', 'BIM - Pesisir Selatan'),
    ('BD-04', 'BA 3456 EF', 'Pasar Raya - Indarung')
ON CONFLICT (vehicle_code) DO NOTHING;

-- Sopir (PIN disimpan plain text untuk prototype — upgrade ke bcrypt di produksi)
INSERT INTO drivers (name, phone, pin, vehicle_id) VALUES
    ('Pak Budi',  '081234567890', '1234', (SELECT id FROM vehicles WHERE vehicle_code = 'BD-01')),
    ('Pak Andi',  '081234567891', '2345', (SELECT id FROM vehicles WHERE vehicle_code = 'BD-02')),
    ('Bu Sari',   '081234567892', '3456', (SELECT id FROM vehicles WHERE vehicle_code = 'BD-03')),
    ('Pak Doni',  '081234567893', '4567', (SELECT id FROM vehicles WHERE vehicle_code = 'BD-04')),
    ('Pak Rudi',  '081234567894', '5678', (SELECT id FROM vehicles WHERE vehicle_code = 'BD-05')),
    ('Pak Iwan',  '081234567895', '6789', (SELECT id FROM vehicles WHERE vehicle_code = 'BD-06')),
    ('Bu Dewi',   '081234567896', '7890', (SELECT id FROM vehicles WHERE vehicle_code = 'BD-04'))
ON CONFLICT DO NOTHING;
