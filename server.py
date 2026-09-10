"""
Contractor Site Attendance System - Local Python Server
Run via: python server.py
"""

import sys
import os

# Add directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from api.index import app

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8088))
    print("=" * 65)
    print("  ELECTRICAL CONTRACTOR SITE ATTENDANCE - PYTHON SERVER")
    print("=" * 65)
    print(f"  > Local URL:  http://localhost:{port}/")
    print(f"  > Localhost:  http://127.0.0.1:{port}/")
    print(f"  > Python API: http://localhost:{port}/api/health")
    print("=" * 65)
    app.run(host='0.0.0.0', port=port, debug=False)
