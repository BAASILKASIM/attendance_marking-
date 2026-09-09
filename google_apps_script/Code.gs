/**
 * CONTRACTOR FIELD ATTENDANCE SYSTEM - GOOGLE APPS SCRIPT
 * 
 * 100% Free Backend connected to Google Sheets.
 * Automatically appends attendance punches, calculates status,
 * and creates clickable Google Maps links.
 * 
 * Instructions:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this code into Code.gs
 * 4. Click 'Deploy' > 'New deployment'
 * 5. Select type: 'Web app'
 * 6. Set 'Execute as': 'Me'
 * 7. Set 'Who has access': 'Anyone'
 * 8. Copy the Web App URL and paste it into the Attendance App Admin Settings!
 */

const SHEET_NAME = "Attendance_Logs";
const SITES_SHEET_NAME = "Job_Sites";

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = (e && e.parameter && e.parameter.action) || "getSites";
    
    if (action === "getSites") {
      let sitesSheet = ss.getSheetByName(SITES_SHEET_NAME);
      if (!sitesSheet) {
        sitesSheet = initializeSitesSheet(ss);
      }
      
      const data = sitesSheet.getDataRange().getValues();
      const sites = [];
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) {
          sites.push({
            id: String(data[i][0]),
            name: String(data[i][1]),
            lat: parseFloat(data[i][2]),
            lng: parseFloat(data[i][3]),
            radius: parseInt(data[i][4]) || 150
          });
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", sites: sites }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "resolveMap") {
      const mapUrl = e.parameter.url;
      try {
        const resp = UrlFetchApp.fetch(mapUrl, { followRedirects: false, muteHttpExceptions: true });
        const location = resp.getHeaders()['Location'] || resp.getHeaders()['location'];
        return ContentService.createTextOutput(JSON.stringify({ status: "success", resolvedUrl: location || mapUrl }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Contractor Attendance API is live!" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  // Concurrency Lock: Prevents simultaneous user requests from overwriting rows or colliding
  const lock = LockService.getScriptLock();
  try {
    // Wait up to 30 seconds for any ongoing write from another user to finish
    lock.waitLock(30000);
  } catch (lockErr) {
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "error", 
      message: "Server busy recording another user's punch. Please retry in a moment." 
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      sheet = initializeAttendanceSheet(ss);
    }
    
    let payload;
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.data) {
      payload = JSON.parse(e.parameter.data);
    } else {
      payload = e.parameter;
    }
    
    const punches = Array.isArray(payload) ? payload : [payload];
    
    punches.forEach(p => {
      const timestamp = p.timestamp ? new Date(p.timestamp) : new Date();
      const dateStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd");
      const timeStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "hh:mm:ss a");
      
      const workerName = p.workerName || "Unknown Worker";
      const punchType = p.punchType || "Check-In";
      const siteName = p.siteName || "Unassigned Site";
      const distance = (p.distanceMeters !== undefined && p.distanceMeters !== null) ? Math.round(p.distanceMeters) + " m" : "N/A";
      const status = p.isWithinGeofence ? "✅ ON-SITE" : "⚠️ OFF-SITE";
      const lat = p.latitude || "";
      const lng = p.longitude || "";
      const accuracy = p.accuracy ? "±" + Math.round(p.accuracy) + "m" : "";
      
      let mapsFormula = "";
      if (lat && lng) {
        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        mapsFormula = `=HYPERLINK("${mapsUrl}", "📍 View Map (${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)})")`;
      }
      
      const ipAddress = p.ipAddress || "Unknown";
      const deviceInfo = p.deviceInfo || "Mobile Browser";
      const notes = p.notes || "";
      
      sheet.appendRow([
        timestamp,
        dateStr,
        timeStr,
        workerName,
        punchType,
        siteName,
        status,
        distance,
        mapsFormula,
        lat,
        lng,
        accuracy,
        ipAddress,
        deviceInfo,
        notes
      ]);
      
      const lastRow = sheet.getLastRow();
      if (!p.isWithinGeofence) {
        sheet.getRange(lastRow, 7).setBackground("#FFF3CD").setFontColor("#856404").setFontWeight("bold");
      } else {
        sheet.getRange(lastRow, 7).setBackground("#D4EDDA").setFontColor("#155724").setFontWeight("bold");
      }
    });

    // Commit all cell changes immediately before releasing the lock
    SpreadsheetApp.flush();
    
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "success", 
      message: `Recorded ${punches.length} punch(es) successfully.` 
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "error", 
      message: err.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    // Always release lock for the next user
    lock.releaseLock();
  }
}

function initializeAttendanceSheet(ss) {
  let sheet = ss.insertSheet(SHEET_NAME);
  const headers = [
    "Full Timestamp",
    "Date",
    "Time",
    "Worker Name",
    "Punch Type",
    "Job Site",
    "Geofence Status",
    "Distance from Site",
    "Map Link",
    "Latitude",
    "Longitude",
    "GPS Accuracy",
    "IP Address",
    "Device / Browser",
    "Notes"
  ];
  
  sheet.appendRow(headers);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#1E293B");
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
  headerRange.setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
  
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(6, 180);
  sheet.setColumnWidth(7, 130);
  sheet.setColumnWidth(9, 220);
  
  return sheet;
}

function initializeSitesSheet(ss) {
  let sheet = ss.insertSheet(SITES_SHEET_NAME);
  const headers = [
    "Site ID",
    "Site Name",
    "Latitude",
    "Longitude",
    "Allowed Radius (Meters)"
  ];
  
  sheet.appendRow(headers);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#0F766E");
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
  sheet.setFrozenRows(1);
  
  sheet.appendRow([
    "site-1",
    "Main Workshop / Office",
    12.9716,
    77.5946,
    150
  ]);
  
  return sheet;
}
