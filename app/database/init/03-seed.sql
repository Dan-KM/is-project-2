-- Runs once, after 02-schema.sql. Initial reference data + test users.
BEGIN;
SET ROLE system_owner;

INSERT INTO crop (crop_name, crop_type, crop_coefficient, days_to_maturity) VALUES
  ('Wheat',     'Cereal',     1.150, 130),
  ('Rice',      'Cereal',     1.200, 120),
  ('Maize',     'Cereal',     1.200, 125),
  ('Groundnut', 'Legume',     1.150, 130),
  ('Soybean',   'Legume',     1.150, 110),
  ('Tomato',    'Vegetable',  1.150, 120),
  ('Cotton',    'Fibre',      1.200, 180),
  ('Sugarcane', 'Sugar crop', 1.250, 365);

-- Dev-only test accounts. crypt() + gen_salt('bf') = bcrypt hash.
INSERT INTO users (user_role, first_name, last_name, email, phone, password_hash) VALUES
  ('farmer', 'Test', 'Farmer', 'farmer@example.test', '+254700000001', crypt('Farmer#2026', gen_salt('bf', 12))),
  ('admin',  'Test', 'Admin',  'admin@example.test',  '+254700000002', crypt('Admin#2026',  gen_salt('bf', 12)));

RESET ROLE;
COMMIT;
