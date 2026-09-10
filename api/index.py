"""
Contractor Site Attendance System - Python Backend for Vercel & Local Execution
"""

import os
import math
import json
import io
from datetime import datetime
import requests
from flask import Flask, request, jsonify, send_file, Response

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = BASE_DIR

app = Flask(__name__, static_folder=BASE_DIR, static_url_path='')

# In-Memory Cache with sensible contractor defaults
DEFAULT_SITES = [
    {
        "id": "site_workshop",
        "name": "Main Electrical Workshop",
        "lat": 12.9716,
        "lng": 77.5946,
        "radius": 150,
        "description": "Office, tool inventory and panel fabrication"
    },
    {
        "id": "site_metro",
        "name": "Metro Substation Line 3",
        "lat": 12.9352,
        "lng": 77.6245,
        "radius": 200,
        "description": "High-voltage cable trenching and earthing"
    },
    {
        "id": "site_towers",
        "name": "Sunrise Apartments Project",
        "lat": 12.9912,
        "lng": 77.5855,
        "radius": 120,
        "description": "12-floor internal wiring, DB box & conduit installation"
    }
]

DEFAULT_WORKERS = [
    {"id": "w1", "name": "Ramesh (Senior Electrician)", "pin": "1111"},
    {"id": "w2", "name": "Suresh (Wireman)", "pin": "2222"},
    {"id": "w3", "name": "Anil Kumar (Assistant)", "pin": "3333"},
    {"id": "w4", "name": "Karthik (Supervisor)", "pin": "4444"}
]

STATE = {
    "sites": list(DEFAULT_SITES),
    "workers": list(DEFAULT_WORKERS),
    "punches": [],
    "admin_password": "admin7890"
}

def calculate_haversine(lat1, lon1, lat2, lon2):
    try:
        r = 6371000  # Earth radius in meters
        phi1 = math.radians(float(lat1))
        phi2 = math.radians(float(lat2))
        delta_phi = math.radians(float(lat2) - float(lat1))
        delta_lambda = math.radians(float(lon2) - float(lon1))
        
        a = (math.sin(delta_phi / 2) ** 2 +
             math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2) ** 2))
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return round(r * c)
    except Exception:
        return 999999

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, x-api-key"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response

# ----------------------------------------------------
# FRONTEND ENTRYPOINT & STATIC ASSETS
# ----------------------------------------------------

@app.route("/", methods=["GET"])
@app.route("/index.html", methods=["GET"])
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            content = f.read()
        return Response(content, mimetype="text/html; charset=utf-8")
    return jsonify({"error": "index.html not found"}), 404

@app.route("/<path:path>", methods=["GET"])
def serve_static(path):
    file_path = os.path.join(STATIC_DIR, path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        mimetypes = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".webmanifest": "application/manifest+json"
        }
        ext = os.path.splitext(file_path)[1].lower()
        mimetype = mimetypes.get(ext, "application/octet-stream")
        with open(file_path, "rb") as f:
            return Response(f.read(), mimetype=mimetype)
    return jsonify({"error": f"Asset {path} not found"}), 404

# ----------------------------------------------------
# PYTHON REST API ENDPOINTS
# ----------------------------------------------------

def load_env_file():
    env_file = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and not os.environ.get(k):
                            os.environ[k] = v
        except Exception:
            pass

load_env_file()

@app.route("/api/health", methods=["GET"])
def api_health():
    supabase_configured = bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ANON_KEY"))
    return jsonify({
        "status": "healthy",
        "service": "contractor-attendance-python",
        "runtime": "Python 3 (Vercel Serverless)",
        "supabaseConfigured": supabase_configured,
        "timestamp": datetime.now().isoformat()
    })

@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        if "adminPassword" in data and str(data["adminPassword"]).strip():
            STATE["admin_password"] = str(data["adminPassword"]).strip()
        if "supabaseUrl" in data and "supabaseAnonKey" in data:
            STATE["supabase_url"] = str(data["supabaseUrl"]).strip()
            STATE["supabase_anon_key"] = str(data["supabaseAnonKey"]).strip()
            os.environ["SUPABASE_URL"] = STATE["supabase_url"]
            os.environ["SUPABASE_ANON_KEY"] = STATE["supabase_anon_key"]
        return jsonify({"success": True, "message": "Config updated"})
    
    supabase_url = os.environ.get("SUPABASE_URL", STATE.get("supabase_url", ""))
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", STATE.get("supabase_anon_key", ""))

    return jsonify({
        "adminPassword": STATE["admin_password"],
        "workers": STATE["workers"],
        "supabaseUrl": supabase_url,
        "supabaseAnonKey": supabase_anon_key
    })

@app.route("/api/sites", methods=["GET", "POST"])
def api_sites():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        new_site = {
            "id": "site_" + str(int(datetime.now().timestamp() * 1000)),
            "name": data.get("name", "New Site").strip(),
            "lat": float(data.get("lat", 0.0)),
            "lng": float(data.get("lng", 0.0)),
            "radius": int(data.get("radius", 150)),
            "description": data.get("description", "").strip()
        }
        STATE["sites"].append(new_site)
        return jsonify({"success": True, "site": new_site}), 201

    return jsonify(STATE["sites"])

@app.route("/api/sites/<site_id>", methods=["DELETE"])
def api_delete_site(site_id):
    if len(STATE["sites"]) <= 1:
        return jsonify({"error": "Cannot delete the last remaining site"}), 400
    STATE["sites"] = [s for s in STATE["sites"] if s["id"] != site_id]
    return jsonify({"success": True, "message": f"Site {site_id} deleted"})

@app.route("/api/workers", methods=["GET", "POST"])
def api_workers():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        new_worker = {
            "id": "w_" + str(int(datetime.now().timestamp() * 1000)),
            "name": data.get("name", "").strip(),
            "pin": str(data.get("pin", "1111")).strip()
        }
        if not new_worker["name"]:
            return jsonify({"error": "Worker name required"}), 400
        STATE["workers"].append(new_worker)
        return jsonify({"success": True, "worker": new_worker}), 201

    return jsonify(STATE["workers"])

@app.route("/api/workers/<worker_id>", methods=["DELETE"])
def api_delete_worker(worker_id):
    STATE["workers"] = [w for w in STATE["workers"] if w["id"] != worker_id]
    return jsonify({"success": True, "message": f"Worker {worker_id} deleted"})

@app.route("/api/geofence", methods=["POST"])
def api_geofence():
    data = request.get_json(silent=True) or {}
    w_lat = data.get("workerLat")
    w_lng = data.get("workerLng")
    s_lat = data.get("siteLat")
    s_lng = data.get("siteLng")
    radius = int(data.get("radius", 150))

    if None in [w_lat, w_lng, s_lat, s_lng]:
        return jsonify({"error": "Coordinates missing"}), 400

    dist = calculate_haversine(w_lat, w_lng, s_lat, s_lng)
    return jsonify({
        "distanceMeters": dist,
        "isWithin": dist <= radius,
        "radius": radius,
        "differenceMeters": dist - radius
    })

@app.route("/api/punches", methods=["GET", "POST"])
def api_punches():
    supabase_url = os.environ.get("SUPABASE_URL", STATE.get("supabase_url", ""))
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", STATE.get("supabase_anon_key", ""))

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        
        # Strict Perimeter Guardrail Enforcement
        worker_lat = data.get("latitude")
        worker_lng = data.get("longitude")
        site_id = data.get("siteId")
        is_admin_override = bool(data.get("adminOverride"))
        
        # Check active site boundary
        active_site = next((s for s in STATE["sites"] if str(s.get("id")) == str(site_id)), None)
        is_within = False
        distance_meters = None

        if active_site and worker_lat is not None and worker_lng is not None:
            try:
                distance_meters = calculate_haversine(
                    float(worker_lat), float(worker_lng),
                    float(active_site["lat"]), float(active_site["lng"])
                )
                site_radius = int(active_site.get("radius", 150))
                is_within = (distance_meters <= site_radius)
            except Exception:
                is_within = bool(data.get("isWithinGeofence"))
                distance_meters = data.get("distanceMeters")
        else:
            is_within = bool(data.get("isWithinGeofence"))
            distance_meters = data.get("distanceMeters")

        # Strict Perimeter Guardrail: Block punch if outside perimeter
        if not is_within:
            site_name = active_site["name"] if active_site else "the job site"
            radius_str = str(active_site["radius"]) if active_site else "150"
            dist_str = f"{round(distance_meters)}m" if distance_meters is not None else "unknown distance"
            return jsonify({
                "error": "Perimeter Guardrail Violation",
                "message": f"Attendance blocked: Employee is outside site perimeter ({dist_str} away from '{site_name}', allowed limit: {radius_str}m)."
            }), 403

        punch = {
            "id": data.get("id") or ("p_" + str(int(datetime.now().timestamp() * 1000))),
            "timestamp": data.get("timestamp") or datetime.now().isoformat(),
            "workerId": data.get("workerId", ""),
            "workerName": data.get("workerName", "Worker"),
            "punchType": data.get("punchType", "Clock-In"),
            "siteId": data.get("siteId", ""),
            "siteName": data.get("siteName", active_site["name"] if active_site else "Site"),
            "isWithinGeofence": bool(is_within),
            "distanceMeters": round(distance_meters) if distance_meters is not None else None,
            "latitude": float(worker_lat) if worker_lat is not None else None,
            "longitude": float(worker_lng) if worker_lng is not None else None,
            "accuracy": float(data["accuracy"]) if data.get("accuracy") is not None else None,
            "ipAddress": data.get("ipAddress", request.remote_addr or "127.0.0.1"),
            "deviceInfo": data.get("deviceInfo", request.headers.get("User-Agent", "Browser")),
            "notes": data.get("notes", "")
        }

        # Store in local server memory
        STATE["punches"].insert(0, punch)

        # Forward directly to Supabase PostgreSQL if configured
        if supabase_url and supabase_anon_key:
            try:
                clean_sb_url = supabase_url.strip().rstrip("/")
                clean_sb_key = supabase_anon_key.strip()
                sb_payload = {
                    "id": punch["id"],
                    "timestamp": punch["timestamp"],
                    "worker_id": punch["workerId"] or None,
                    "worker_name": punch["workerName"],
                    "punch_type": punch["punchType"],
                    "site_id": punch["siteId"] or None,
                    "site_name": punch["siteName"],
                    "is_within_geofence": punch["isWithinGeofence"],
                    "distance_meters": punch["distanceMeters"],
                    "latitude": punch["latitude"],
                    "longitude": punch["longitude"],
                    "accuracy": punch["accuracy"],
                    "ip_address": punch["ipAddress"],
                    "device_info": punch["deviceInfo"],
                    "notes": punch["notes"]
                }
                requests.post(
                    f"{clean_sb_url}/rest/v1/attendance_logs",
                    headers={
                        "apikey": clean_sb_key,
                        "Authorization": f"Bearer {clean_sb_key}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal"
                    },
                    json=sb_payload,
                    timeout=5
                )
            except Exception as sb_err:
                print(f"[Supabase sync warning from Python backend] {sb_err}")

        return jsonify({"success": True, "punch": punch}), 201

    # GET Punches - Try Supabase first if configured, else in-memory cache
    if supabase_url and supabase_anon_key:
        try:
            clean_sb_url = supabase_url.strip().rstrip("/")
            clean_sb_key = supabase_anon_key.strip()
            res = requests.get(
                f"{clean_sb_url}/rest/v1/attendance_logs?select=*&order=timestamp.desc&limit=150",
                headers={
                    "apikey": clean_sb_key,
                    "Authorization": f"Bearer {clean_sb_key}",
                    "Content-Type": "application/json"
                },
                timeout=5
            )
            if res.status_code == 200:
                cloud_data = res.json()
                normalized = []
                for r in cloud_data:
                    normalized.append({
                        "id": r.get("id"),
                        "timestamp": r.get("timestamp"),
                        "workerId": r.get("worker_id"),
                        "workerName": r.get("worker_name", "Unknown"),
                        "punchType": r.get("punch_type", "Clock-In"),
                        "siteId": r.get("site_id"),
                        "siteName": r.get("site_name", "Unassigned"),
                        "isWithinGeofence": bool(r.get("is_within_geofence")),
                        "distanceMeters": r.get("distance_meters"),
                        "latitude": r.get("latitude"),
                        "longitude": r.get("longitude"),
                        "accuracy": r.get("accuracy"),
                        "ipAddress": r.get("ip_address"),
                        "deviceInfo": r.get("device_info"),
                        "notes": r.get("notes", "")
                    })
                return jsonify(normalized)
        except Exception as err:
            print(f"[Supabase fetch warning from Python backend] {err}")

    return jsonify(STATE["punches"])

@app.route("/api/export", methods=["GET"])
def api_export_excel():
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Attendance Records"

    headers = [
        "Timestamp", "Date", "Time", "Worker Name", "Punch Type",
        "Job Site", "Geofence Status", "Distance (m)", "Google Maps URL",
        "Latitude", "Longitude", "IP Address", "Device"
    ]

    ws.append(headers)

    # Header styling (Industrial Navy Dark)
    header_fill = PatternFill(start_color="18223C", end_color="18223C", fill_type="solid")
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    align_center = Alignment(horizontal="center", vertical="center")

    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = align_center

    punches = STATE["punches"]
    if not punches:
        # Sample template row
        now = datetime.now()
        ws.append([
            now.isoformat(), now.strftime("%Y-%m-%d"), now.strftime("%I:%M:%S %p"),
            "(Template - Attendance System Ready)", "Clock-In",
            STATE["sites"][0]["name"] if STATE["sites"] else "Workshop",
            "ON-SITE", 0, "", "", "", "127.0.0.1", "System"
        ])
    else:
        for p in punches:
            ts = p.get("timestamp", "")
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                d_str = dt.strftime("%Y-%m-%d")
                t_str = dt.strftime("%I:%M:%S %p")
            except Exception:
                d_str = ts[:10]
                t_str = ts[11:19]

            maps_url = ""
            if p.get("latitude") and p.get("longitude"):
                maps_url = f"https://www.google.com/maps?q={p['latitude']},{p['longitude']}"

            ws.append([
                ts, d_str, t_str,
                p.get("workerName", "Worker"),
                p.get("punchType", "Clock-In"),
                p.get("siteName", "Site"),
                "ON-SITE" if p.get("isWithinGeofence") else "OFF-SITE",
                p.get("distanceMeters", ""),
                maps_url,
                p.get("latitude", ""),
                p.get("longitude", ""),
                p.get("ipAddress", ""),
                p.get("deviceInfo", "")
            ])

    # Auto-adjust column widths
    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = col[0].column_letter
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"Electrical_Site_Attendance_{datetime.now().strftime('%Y-%m-%d')}.xlsx"
    return send_file(
        buf,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

# Vercel entrypoint
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8088))
    print(f"Contractor Attendance Python Server running on http://localhost:{port}/")
    app.run(host="0.0.0.0", port=port, debug=False)
