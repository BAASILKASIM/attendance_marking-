# ⚡ Electrical Contractor Field Attendance System

A 100% free, mobile-first GPS & Geofenced Attendance System designed specifically for electrical contractors and field workers.

## 🌟 Key Features
- **Dynamic Attendance Points**: Easily configure multiple job sites (offices, substations, residential complexes) with custom geofence radius.
- **Stand-on-Site Coordinate Capture**: When visiting a new project site, tap *"Set to My Current GPS Location"* to lock in the site coordinates with zero guesswork.
- **High-Accuracy GPS & Geofencing**: Calculates exact distance in meters from the active job site and flags punches as **✅ ON-SITE** or **⚠️ OFF-SITE**.
- **Live Google Sheet (Excel) Sync**: Automatically appends each punch into a Google Sheet with timestamp, worker name, distance, status, IP address, and a clickable Google Maps link!
- **One-Click Native Excel Export (.xlsx)**: Download clean, structured Excel spreadsheets directly from your phone or PC.
- **Works Offline**: Intermittent mobile network at basements/trenching sites? Punches are safely stored on the device and automatically sync once network returns.
- **100% Free Forever**: Zero hosting fees, zero database fees, and no monthly subscriptions.

---

## 🚀 5-Minute Setup Guide

### Step 1: Set Up Free Google Sheets Backend (Takes 2 Minutes)
1. Open [Google Sheets](https://sheets.new) and create a new blank spreadsheet (name it e.g. `Contractor_Attendance_2026`).
2. In the top menu, click **Extensions** > **Apps Script**.
3. Delete any default code in `Code.gs` and paste the contents of `google_apps_script/Code.gs`.
4. Click the blue **Deploy** button (top right) > **New deployment**.
5. Click the gear icon next to "Select type" and choose **Web app**.
6. Fill in the deployment details:
   - **Description**: `Attendance Webhook`
   - **Execute as**: `Me (your email)`
   - **Who has access**: `Anyone` *(Important: this allows the phone web app to send punches)*
7. Click **Deploy**, authorize permissions when prompted, and **copy the Web app URL** (it looks like `https://script.google.com/macros/s/.../exec`).

### Step 2: Configure the Attendance App
1. Open `index.html` in your browser.
2. Go to the **Admin** tab (⚙️).
3. Paste your Google Web App URL into the **Google Apps Script Web App URL** box.
4. Click **Save Settings**, then click **Test Sync**.
5. Switch to your Google Sheet—you will see a formatted row appear immediately!

### Step 3: Host 100% Free on the Web (GitHub Pages or Netlify)

#### Option A: GitHub Pages (Recommended - 100% Free Forever)
1. Create a free GitHub repository named `attendance-system`.
2. Push or upload this project folder to your repository.
3. Go to **Settings** > **Pages**.
4. Under "Branch", select `main` and root `/`, then click **Save**.
5. In 60 seconds, your site will be live on HTTPS (e.g. `https://yourusername.github.io/attendance-system/`).

#### Option B: Netlify or Vercel (Drag & Drop - 100% Free)
1. Go to [Netlify Drop](https://app.netlify.com/drop).
2. Drag and drop this folder.
3. Your app is live with free HTTPS instantly!

---

## 📱 How Field Workers Use It on Smartphones
1. Send the live link to your electricians or print a QR code with the URL at the job site toolbox.
2. Workers open the link on Chrome (Android) or Safari (iPhone).
3. Tap the browser menu and select **"Add to Home Screen"** — it installs just like a native app with an icon!
4. Worker selects their name, taps **Clock In** or **Clock Out**.
5. The system captures their GPS, checks if they are on-site, and logs everything to your Google Sheet in real time.

---

## 🛠️ Tech Stack
- **Frontend**: Vanilla HTML5, Modern CSS3 (Glassmorphism / Industrial High-Contrast theme), JavaScript (ES6+).
- **Geolocation**: HTML5 Geolocation API with high accuracy mode + Haversine distance formula.
- **Spreadsheet Generation**: SheetJS (`xlsx.full.min.js`) for client-side `.xlsx` export.
- **Backend & Storage**: Google Apps Script connected to Google Sheets (0 server maintenance).
- **Hosting**: GitHub Pages / Netlify / Vercel (100% Free Tier).\n