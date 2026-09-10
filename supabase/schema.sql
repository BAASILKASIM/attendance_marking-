-- ==============================================================================
-- SUPABASE POSTGRESQL SCHEMA FOR CONTRACTOR SITE ATTENDANCE SYSTEM
-- Copy and paste this script directly into your Supabase SQL Editor and click RUN!
-- ==============================================================================

-- 1. Create Job Sites Table
CREATE TABLE IF NOT EXISTS job_sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius INTEGER DEFAULT 150,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure description column exists if upgrading existing table
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS description TEXT;

-- Insert default site if table is empty
INSERT INTO job_sites (id, name, lat, lng, radius, description)
VALUES ('site-1', 'Main Workshop / Office', 12.9716, 77.5946, 150, 'Headquarters & workshop')
ON CONFLICT (id) DO NOTHING;

-- 2. Create Workers Roster Table
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT DEFAULT '1111',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default team workers
INSERT INTO workers (id, name, pin) VALUES
  ('w1', 'Ramesh (Senior Electrician)', '1111'),
  ('w2', 'Suresh (Wireman)', '2222'),
  ('w3', 'Anil Kumar (Assistant)', '3333'),
  ('w4', 'Karthik (Supervisor)', '4444')
ON CONFLICT (id) DO NOTHING;

-- 3. Create Attendance Logs Table
CREATE TABLE IF NOT EXISTS attendance_logs (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  worker_id TEXT,
  worker_name TEXT NOT NULL,
  punch_type TEXT NOT NULL,
  site_id TEXT,
  site_name TEXT NOT NULL,
  is_within_geofence BOOLEAN NOT NULL DEFAULT FALSE,
  distance_meters INTEGER,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  ip_address TEXT,
  device_info TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE job_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;

-- 5. Create Permissive Policies for Field App (Public Anon Access)
-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Allow anon read job_sites" ON job_sites;
DROP POLICY IF EXISTS "Allow anon all job_sites" ON job_sites;
DROP POLICY IF EXISTS "Allow anon read workers" ON workers;
DROP POLICY IF EXISTS "Allow anon all workers" ON workers;
DROP POLICY IF EXISTS "Allow anon insert attendance_logs" ON attendance_logs;
DROP POLICY IF EXISTS "Allow anon read attendance_logs" ON attendance_logs;
DROP POLICY IF EXISTS "Allow anon delete attendance_logs" ON attendance_logs;

-- Job Sites Policies
CREATE POLICY "Allow anon all job_sites" 
  ON job_sites FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- Workers Policies
CREATE POLICY "Allow anon all workers" 
  ON workers FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- Attendance Logs Policies
CREATE POLICY "Allow anon all attendance_logs" 
  ON attendance_logs FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- 6. Create helpful indexes for fast log querying
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON attendance_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_worker_name ON attendance_logs (worker_name);
CREATE INDEX IF NOT EXISTS idx_logs_site_name ON attendance_logs (site_name);
