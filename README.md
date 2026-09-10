# ⚡ Electrical Contractor Field Attendance System

A modern, mobile-first GPS & Geofenced Attendance System with strict perimeter guardrails and cloud database sync for electrical contractors and field workers.

## 🌟 Key Features
- **Strict Perimeter Guardrails**: Employees can **only** clock in or out when physically inside the designated job site perimeter (verified via real GPS coordinates & Haversine formula). Off-site punch attempts are strictly blocked.
- **Supabase Cloud PostgreSQL**: Real-time cloud database storage for attendance logs, job sites, and worker rosters with multi-device synchronization.
- **Python Backend (Vercel Serverless & Local)**: Written entirely in Python (`api/index.py`, `server.py`) using Flask, openpyxl, and requests. Deploys seamlessly to Vercel with `@vercel/python`.
- **Dynamic Job Sites**: Configure multiple job sites (offices, substations, residential projects) with custom geofence radius.
- **Stand-on-Site Coordinate Capture**: Tap *"Set to My Current GPS Location"* when standing on a new job site to lock in exact GPS coordinates.
- **One-Click Native Excel Export (.xlsx)**: Download clean, structured Excel spreadsheets directly from mobile phones or PCs (generated natively via client-side SheetJS or server-side OpenPyXL).
- **Offline Resilient**: Punches recorded with weak or interrupted network are stored safely on the device and automatically sync to Supabase when network is restored.

---

## 🚀 Supabase Cloud Database Setup (2 Minutes)

1. **Create a Free Supabase Project**:
   - Go to [Supabase](https://supabase.com) and create a free project.
2. **Run the Database Schema**:
   - In your Supabase Dashboard, go to **SQL Editor**.
   - Copy the contents of [`supabase/schema.sql`](supabase/schema.sql) and paste it into the editor.
   - Click **RUN** to create the tables (`job_sites`, `workers`, `attendance_logs`) and security policies.
3. **Get Your API Credentials**:
   - In Supabase, go to **Project Settings > API**.
   - Copy your **Project URL** (e.g. `https://xxxxxxxxxxxxxxxx.supabase.co`).
   - Copy your **Public Anon Key** (under *Project API Keys* > `anon` `public`).

---

## 🌐 Deployment to Vercel

1. Push your repository to GitHub:
   ```bash
   git add .
   git commit -m "Production ready release"
   git push origin main
   ```
2. Import the project into [Vercel](https://vercel.com):
   - Framework Preset: **Other**
   - Root Directory: `./`
3. Add **Environment Variables** in Vercel Project Settings:
   - `SUPABASE_URL`: Your Supabase Project URL (`https://xxxxxxxxxxxxxxxx.supabase.co`)
   - `SUPABASE_ANON_KEY`: Your Supabase Public Anon Key (`eyJhbGciOi...`)
4. Click **Deploy**. Vercel will automatically build and deploy the Python runtime (`api/index.py`).

---

## 💻 Running Locally

1. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. (Optional) Create a `.env` file in the project root:
   ```env
   SUPABASE_URL=https://xxxxxxxxxxxxxxxx.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
3. Start the server:
   ```bash
   python server.py
   ```
4. Open [http://localhost:8088](http://localhost:8088) in your browser.

---

## 📱 How Field Workers Use It on Smartphones

1. Workers open the web app link on Chrome (Android) or Safari (iPhone).
2. Tap the browser menu and select **"Add to Home Screen"** to install it as an app icon.
3. Worker selects their name from the dropdown.
4. When physically standing within the job site perimeter (e.g. within 150m), tap **Clock In** or **Clock Out**.
5. The system verifies GPS coordinates against the perimeter, prompts for the worker's PIN, and securely logs the attendance record to Supabase.