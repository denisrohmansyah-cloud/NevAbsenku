/* =========================================================
   NEV ABSENKU — Tambahan: Lokasi Kantor (Geofencing) & Selfie
   -----------------------------------------------------------
   File terpisah dari kode utama (index lama tetap sama).
   Fitur yang ditambahkan mengikuti referensi "Presensi Pro v1":
     1. HRD mengatur titik lokasi kantor + radius toleransi lewat peta.
     2. Saat STAF absen, sistem memverifikasi jarak lokasi HP staf
        terhadap titik kantor (geofencing).
     3. STAF wajib mengambil foto selfie sebagai bukti kehadiran
        sebelum absensi benar-benar disimpan.
   Membutuhkan: Leaflet.js (peta), serta variabel/fungsi dari
   index.html (DB, load, save, toast, escapeHTML, currentUser,
   formatTime, finalizeAttendance, stopScanner, renderAll, dll).
========================================================= */


/* =========================================================
LOADER LEAFLET + TILE PETA
-----------------------------------------------------------
Sebelumnya ensureLeaflet() & featureLoadError() dipanggil tetapi
tidak pernah didefinisikan, sehingga peta tidak pernah dibuat.
Di sini keduanya dibuat, lengkap dengan CDN cadangan (jika unpkg
diblokir) dan tile cadangan (jika tile OpenStreetMap ditolak).
========================================================= */

let leafletPromise = null;

function loadExternalScript(src){
    return new Promise((resolve, reject)=>{
        const el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.onload = ()=> resolve();
        el.onerror = ()=>{ el.remove(); reject(new Error("Gagal memuat " + src)); };
        document.head.appendChild(el);
    });
}

function loadExternalCss(href){
    return new Promise(resolve=>{
        const el = document.createElement("link");
        el.rel = "stylesheet";
        el.href = href;
        el.onload = ()=> resolve(true);
        el.onerror = ()=>{ el.remove(); resolve(false); };
        document.head.appendChild(el);
    });
}

function leafletCssApplied(){
    // Jika leaflet.css termuat, .leaflet-container memiliki overflow hidden.
    const probe = document.createElement("div");
    probe.className = "leaflet-container";
    probe.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;";
    document.body.appendChild(probe);
    const ok = getComputedStyle(probe).overflow === "hidden";
    probe.remove();
    return ok;
}

function ensureLeaflet(){
    if(window.L && L.map){
        return leafletCssApplied()
            ? Promise.resolve(L)
            : loadExternalCss("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css").then(()=> L);
    }
    if(leafletPromise) return leafletPromise;

    const sources = [
        "https://unpkg.com/leaflet@1.9.4/dist/",
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/",
        "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/"
    ];

    leafletPromise = (async()=>{
        for(const base of sources){
            try{
                await loadExternalScript(base + "leaflet.js");
                if(window.L && L.map){
                    if(!leafletCssApplied()) await loadExternalCss(base + "leaflet.css");
                    return L;
                }
            }catch(e){ console.warn("Leaflet dari", base, "gagal:", e); }
        }
        leafletPromise = null;
        throw new Error("Library peta (Leaflet) tidak dapat dimuat. Periksa koneksi internet.");
    })();

    return leafletPromise;
}

function featureLoadError(featureName, err){
    console.error(featureName + " gagal dimuat:", err);
    toast(featureName + " gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.", "error");
}

// Tile OpenStreetMap kadang ditolak (misalnya halaman dibuka dari file:// tanpa Referer).
// Setelah beberapa tile gagal, otomatis pindah ke tile cadangan CARTO.
function addBaseTiles(map){
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        referrerPolicy: "origin",
        attribution: "&copy; OpenStreetMap contributors"
    });
    const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    });

    let errors = 0, switched = false;
    osm.on("tileerror", ()=>{
        errors++;
        if(errors >= 3 && !switched){
            switched = true;
            map.removeLayer(osm);
            carto.addTo(map);
        }
    });
    osm.addTo(map);
    return osm;
}


let officeMapInstance = null;
let officeMarker = null;
let officeCircle = null;

let selfieStream = null;
let pendingAttendance = null; // {session, token, location, locationOk, photo}


/* =========================================================
SETTINGS (lokasi kantor & radius)
========================================================= */

function getSettings(){
    return load(DB.settings, { officeLat:null, officeLng:null, radius:100, geofenceEnabled:false });
}

function saveOfficeSettings(partial){
    const current = getSettings();
    const merged = { ...current, ...partial };
    save(DB.settings, merged);
    return merged;
}


/* =========================================================
LOKASI & RADIUS KHUSUS PER KEGIATAN (HRD "Buat QR Absensi" &
KOOR KP "Buat QR Ngoprek")
-----------------------------------------------------------
Selain pengaturan Lokasi & Radius Kantor yang berlaku global
(hanya bisa diatur HRD), HRD maupun Koor KP kini juga bisa
menentukan titik lokasi & radius KHUSUS untuk satu kegiatan/QR
tertentu, untuk memperketat absensi kegiatan tersebut. Jika
diaktifkan, titik & radius inilah yang dipakai saat validasi
lokasi STAF (lihat checkGeofence()), menggantikan pengaturan
kantor untuk kegiatan itu saja.
========================================================= */

const sessionGeoPickers = {}; // { hrd:{map,marker,circle}, koor:{map,marker,circle} }

async function toggleSessionGeofence(role){
    const checkbox = document.getElementById(`${role}GeoEnabled`);
    const section = document.getElementById(`${role}GeoSection`);
    if(!checkbox || !section) return;

    section.classList.toggle("hidden", !checkbox.checked);
    if(checkbox.checked) await initSessionGeoPicker(role);
}

async function initSessionGeoPicker(role){
    const mapEl = document.getElementById(`${role}GeoMap`);
    if(!mapEl) return;
    try{ await ensureLeaflet(); }catch(err){ featureLoadError("Peta",err); return; }

    if(sessionGeoPickers[role]){
        // Peta sudah pernah dibuat, cukup perbaiki ukurannya (habis disembunyikan lalu ditampilkan lagi).
        setTimeout(()=> sessionGeoPickers[role].map.invalidateSize(), 100);
        return;
    }

    const defaultLat=-6.200000, defaultLng=106.816666;
    const map = L.map(mapEl).setView([defaultLat, defaultLng], 5);

    addBaseTiles(map);

    const icon = L.divIcon({
        className: "",
        html: "<div class=\"office-marker-icon\">📍</div>",
        iconSize: [30,30],
        iconAnchor: [15,28]
    });

    const radiusInput = document.getElementById(`${role}GeoRadius`);
    const marker = L.marker([defaultLat, defaultLng], { draggable:true, icon }).addTo(map);
    const circle = L.circle([defaultLat, defaultLng], {
        radius: parseFloat(radiusInput.value) || 100,
        color: "#e50914",
        fillColor: "#e50914",
        fillOpacity: 0.15
    }).addTo(map);

    function setPoint(lat,lng){
        marker.setLatLng([lat,lng]);
        circle.setLatLng([lat,lng]);
        document.getElementById(`${role}GeoLat`).value = lat.toFixed(6);
        document.getElementById(`${role}GeoLng`).value = lng.toFixed(6);
    }

    marker.on("drag", e=>{
        const pos = e.target.getLatLng();
        setPoint(pos.lat, pos.lng);
    });

    map.on("click", e=> setPoint(e.latlng.lat, e.latlng.lng));

    sessionGeoPickers[role] = { map, marker, circle };
    setTimeout(()=> map.invalidateSize(), 150);
}

function updateSessionRadiusPreview(role){
    const picker = sessionGeoPickers[role];
    if(!picker) return;
    const radius = parseFloat(document.getElementById(`${role}GeoRadius`).value) || 0;
    picker.circle.setRadius(radius);
}

function useMyLocationForSession(role){
    if(!navigator.geolocation){
        toast("Perangkat/browser ini tidak mendukung geolokasi.", "error");
        return;
    }
    toast("Mengambil lokasi Anda saat ini...", "success");
    navigator.geolocation.getCurrentPosition(
        pos=>{
            const { latitude, longitude } = pos.coords;
            document.getElementById(`${role}GeoLat`).value = latitude.toFixed(6);
            document.getElementById(`${role}GeoLng`).value = longitude.toFixed(6);

            const picker = sessionGeoPickers[role];
            if(picker){
                picker.marker.setLatLng([latitude, longitude]);
                picker.circle.setLatLng([latitude, longitude]);
                picker.map.setView([latitude, longitude], 17);
            }
            toast("Lokasi saat ini digunakan untuk kegiatan ini.", "success");
        },
        ()=> toast("Gagal mengambil lokasi. Pastikan izin lokasi diaktifkan.", "error"),
        { enableHighAccuracy:true, timeout:10000 }
    );
}

function resetSessionGeoForm(role){
    const checkbox = document.getElementById(`${role}GeoEnabled`);
    const section = document.getElementById(`${role}GeoSection`);
    const lat = document.getElementById(`${role}GeoLat`);
    const lng = document.getElementById(`${role}GeoLng`);
    const radius = document.getElementById(`${role}GeoRadius`);

    if(checkbox) checkbox.checked = false;
    if(section) section.classList.add("hidden");
    if(lat) lat.value = "-";
    if(lng) lng.value = "-";
    if(radius) radius.value = 100;

    const picker = sessionGeoPickers[role];
    if(picker){
        picker.marker.setLatLng([-6.200000, 106.816666]);
        picker.circle.setLatLng([-6.200000, 106.816666]).setRadius(100);
        picker.map.setView([-6.200000, 106.816666], 5);
    }
}


/* =========================================================
PERHITUNGAN JARAK (Haversine)
========================================================= */

function haversineDistance(lat1, lng1, lat2, lng2){
    const R = 6371000; // radius bumi dalam meter
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function checkGeofence(session){
    return new Promise(resolve=>{
        const settings = getSettings();

        // Lokasi & radius khusus kegiatan ini (diatur HRD/Koor KP saat membuat QR)
        // selalu diprioritaskan di atas pengaturan Lokasi & Radius Kantor yang global.
        const sessionGeo = (session && session.geoEnabled && session.geoLat!=null && session.geoLng!=null)
            ? { lat: session.geoLat, lng: session.geoLng, radius: session.geoRadius || 100 }
            : null;

        const officeGeo = (settings.geofenceEnabled && settings.officeLat!=null && settings.officeLng!=null)
            ? { lat: settings.officeLat, lng: settings.officeLng, radius: settings.radius }
            : null;

        const target = sessionGeo || officeGeo;
        const source = sessionGeo ? "session" : "office";

        // Perangkat STAF tidak lagi menerima koordinat titik absensi: pengecekan radius dilakukan server.
        const needServer = !target && typeof currentUser!=="undefined" && currentUser && currentUser.role==="STAF"
            && typeof cloudSyncEnabled!=="undefined" && cloudSyncEnabled
            && !!((session && session.geoEnabled) || settings.geofenceEnabled);
        if(needServer){
            if(!navigator.geolocation){
                resolve({ enforced:true, ok:false, location:null, distance:null, radius:settings.radius, source, error:"unsupported" });
                return;
            }
            navigator.geolocation.getCurrentPosition(
                async pos=>{
                    const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    try{
                        const r = await cloudPost("checkLocation", { sessionId: session.id, lat: location.lat, lng: location.lng }, 1);
                        resolve({ enforced: r.enforced!==false, ok: r.within===true, distance:null, radius: r.radius || settings.radius, location, source: (session && session.geoEnabled) ? "session" : "office", serverChecked:true });
                    }catch(e){
                        resolve({ enforced:true, ok:false, location, distance:null, radius:settings.radius, source, error:e, serverChecked:true });
                    }
                },
                err=>resolve({ enforced:true, ok:false, location:null, distance:null, radius:settings.radius, source, error:err }),
                { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
            );
            return;
        }

        if(!navigator.geolocation){
            resolve({ enforced: !!target, ok:false, location:null, distance:null, radius: target?target.radius:settings.radius, source, error:"unsupported" });
            return;
        }

        navigator.geolocation.getCurrentPosition(
            pos=>{
                const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                if(target){
                    const distance = haversineDistance(location.lat, location.lng, target.lat, target.lng);
                    resolve({ enforced:true, ok: distance<=target.radius, distance, radius:target.radius, location, source });
                }else{
                    resolve({ enforced:false, ok:true, distance:null, radius:settings.radius, location, source });
                }
            },
            err=>{
                resolve({ enforced: !!target, ok:false, location:null, distance:null, radius: target?target.radius:settings.radius, source, error:err });
            },
            { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
        );
    });
}


/* =========================================================
PETA LOKASI KANTOR (HRD - halaman "Lokasi & Radius")
========================================================= */

async function initOfficeMap(){
    const mapEl = document.getElementById("officeMap");
    if(!mapEl) return;
    try{ await ensureLeaflet(); }catch(err){ featureLoadError("Peta",err); return; }

    const settings = getSettings();
    const defaultLat = settings.officeLat ?? -6.200000;
    const defaultLng = settings.officeLng ?? 106.816666;

    document.getElementById("geofenceEnabled").checked = !!settings.geofenceEnabled;
    document.getElementById("officeRadius").value = settings.radius || 100;
    document.getElementById("officeLat").value = settings.officeLat!=null ? settings.officeLat.toFixed(6) : "-";
    document.getElementById("officeLng").value = settings.officeLng!=null ? settings.officeLng.toFixed(6) : "-";

    if(officeMapInstance){
        // Peta sudah pernah dibuat sebelumnya, cukup refresh ukuran & posisi.
        setTimeout(()=> officeMapInstance.invalidateSize(), 100);
        officeMarker.setLatLng([defaultLat, defaultLng]);
        officeCircle.setLatLng([defaultLat, defaultLng]).setRadius(settings.radius || 100);
        officeMapInstance.setView([defaultLat, defaultLng], officeMapInstance.getZoom());
        return;
    }

    officeMapInstance = L.map("officeMap").setView([defaultLat, defaultLng], settings.officeLat!=null ? 17 : 5);

    addBaseTiles(officeMapInstance);

    const officeIcon = L.divIcon({
        className: "",
        html: "<div class=\"office-marker-icon\">🏢</div>",
        iconSize: [30,30],
        iconAnchor: [15,28]
    });

    officeMarker = L.marker([defaultLat, defaultLng], { draggable:true, icon: officeIcon }).addTo(officeMapInstance);
    officeCircle = L.circle([defaultLat, defaultLng], {
        radius: settings.radius || 100,
        color: "#e50914",
        fillColor: "#e50914",
        fillOpacity: 0.15
    }).addTo(officeMapInstance);

    officeMarker.on("drag", e=>{
        const pos = e.target.getLatLng();
        officeCircle.setLatLng(pos);
        document.getElementById("officeLat").value = pos.lat.toFixed(6);
        document.getElementById("officeLng").value = pos.lng.toFixed(6);
    });

    officeMapInstance.on("click", e=>{
        officeMarker.setLatLng(e.latlng);
        officeCircle.setLatLng(e.latlng);
        document.getElementById("officeLat").value = e.latlng.lat.toFixed(6);
        document.getElementById("officeLng").value = e.latlng.lng.toFixed(6);
    });

    setTimeout(()=> officeMapInstance.invalidateSize(), 150);
}

function updateOfficeRadiusPreview(){
    const radius = parseFloat(document.getElementById("officeRadius").value) || 0;
    if(officeCircle) officeCircle.setRadius(radius);
}

function toggleGeofenceEnabled(){
    const enabled = document.getElementById("geofenceEnabled").checked;
    const mapEl = document.getElementById("officeMap");
    if(mapEl) mapEl.style.opacity = enabled ? "1" : "0.55";
}

function useMyLocationAsOffice(){
    if(!navigator.geolocation){
        toast("Perangkat/browser ini tidak mendukung geolokasi.", "error");
        return;
    }
    toast("Mengambil lokasi Anda saat ini...", "success");
    navigator.geolocation.getCurrentPosition(
        pos=>{
            const { latitude, longitude } = pos.coords;
            if(officeMapInstance){
                officeMarker.setLatLng([latitude, longitude]);
                officeCircle.setLatLng([latitude, longitude]);
                officeMapInstance.setView([latitude, longitude], 17);
            }
            document.getElementById("officeLat").value = latitude.toFixed(6);
            document.getElementById("officeLng").value = longitude.toFixed(6);
            toast("Lokasi saat ini digunakan. Jangan lupa klik Simpan.", "success");
        },
        ()=> toast("Gagal mengambil lokasi. Pastikan izin lokasi diaktifkan.", "error"),
        { enableHighAccuracy:true, timeout:10000 }
    );
}

function saveOfficeLocation(){
    const latVal = document.getElementById("officeLat").value;
    const lngVal = document.getElementById("officeLng").value;
    const radius = parseFloat(document.getElementById("officeRadius").value) || 100;
    const enabled = document.getElementById("geofenceEnabled").checked;

    const lat = parseFloat(latVal);
    const lng = parseFloat(lngVal);

    if(enabled && (isNaN(lat) || isNaN(lng))){
        toast("Tentukan titik lokasi kantor di peta terlebih dahulu.", "error");
        return;
    }

    saveOfficeSettings({
        officeLat: isNaN(lat) ? null : lat,
        officeLng: isNaN(lng) ? null : lng,
        radius,
        geofenceEnabled: enabled
    });

    toast("Lokasi & radius kantor berhasil disimpan.", "success");
}


/* =========================================================
SELFIE + VERIFIKASI LOKASI SAAT ABSEN (STAF)
========================================================= */

function beginAttendanceCapture(session, token){
    pendingAttendance = { session, token, location:null, locationOk:true, photo:null };

    const video = document.getElementById("selfieVideo");
    const preview = document.getElementById("selfiePreview");
    const statusEl = document.getElementById("selfieLocationStatus");

    document.getElementById("selfieCaptureBtn").classList.remove("hidden");
    document.getElementById("selfieRetakeBtn").classList.add("hidden");
    document.getElementById("selfieSubmitBtn").classList.add("hidden");
    preview.classList.add("hidden");
    video.classList.remove("hidden");

    statusEl.textContent = "Mendapatkan lokasi...";
    statusEl.style.background = "#f7f7f7";
    statusEl.style.color = "#555";

    document.getElementById("selfieModal").classList.add("show");

    // "Bangunkan" server Apps Script selagi pengguna berfoto, supaya pengiriman nanti tidak kena cold start.
    try{ if(typeof CLOUD_SCRIPT_URL==="string") fetch(cacheBust(CLOUD_SCRIPT_URL+"?action=bootstrap"),{cache:"no-store"}).catch(()=>{}); }catch(e){}

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio:false })
        .then(stream=>{
            selfieStream = stream;
            video.srcObject = stream;
        })
        .catch(()=>{
            toast("Kamera tidak bisa diakses. Aktifkan izin kamera.", "error");
            closeSelfieModal();
        });

    checkGeofence(session).then(result=>{
        if(!pendingAttendance) return; // modal sudah ditutup duluan
        pendingAttendance.location = result.location;

        const originLabel = result.source==="session" ? "kegiatan ini" : "kantor";

        if(result.enforced){
            pendingAttendance.locationOk = result.ok;
            if(result.ok){
                statusEl.textContent = result.distance!=null
                    ? `Lokasi valid (±${Math.round(result.distance)} m dari titik ${originLabel}).`
                    : `Lokasi valid (di dalam radius ${originLabel}).`;
                statusEl.style.background = "#dcfce7"; statusEl.style.color = "#15803d";
            }else if(result.distance!=null || (result.serverChecked && result.location)){
                statusEl.textContent = result.distance!=null
                    ? `Anda berada di luar radius ${originLabel} (±${Math.round(result.distance)} m, radius diizinkan ${result.radius} m). Absensi tidak dapat dikirim.`
                    : `Anda berada di luar radius ${originLabel} (radius diizinkan ${result.radius} m). Absensi tidak dapat dikirim.`;
                statusEl.style.background = "#fee2e2"; statusEl.style.color = "#b91c1c";
            }else{
                statusEl.textContent = "Tidak dapat memastikan lokasi Anda. Aktifkan GPS/izin lokasi lalu coba lagi.";
                statusEl.style.background = "#fee2e2"; statusEl.style.color = "#b91c1c";
            }
        }else{
            pendingAttendance.locationOk = true;
            statusEl.textContent = result.location
                ? "Lokasi tercatat (validasi radius belum diaktifkan untuk kegiatan/kantor ini)."
                : "Lokasi tidak tersedia, namun validasi radius tidak diaktifkan sehingga absen tetap dapat dilanjutkan.";
            statusEl.style.background = "#f7f7f7"; statusEl.style.color = "#555";
        }
    });
}

function captureSelfie(){
    const video = document.getElementById("selfieVideo");
    const canvas = document.getElementById("selfieCanvas");

    if(!video.videoWidth){
        toast("Kamera belum siap, tunggu sebentar lalu coba lagi.", "error");
        return;
    }

    // Perkecil ke lebar maks. 720 px: cukup jelas sebagai bukti, tapi ukurannya
    // jauh lebih kecil (puluhan KB) sehingga upload tidak gagal di jaringan HP yang lambat.
    const MAX_W = 480;
    const scale = Math.min(1, MAX_W / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    // Cermin gambar supaya hasil foto natural seperti yang dilihat di preview.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    pendingAttendance.photo = dataUrl;

    document.getElementById("selfiePreview").src = dataUrl;
    document.getElementById("selfiePreview").classList.remove("hidden");
    video.classList.add("hidden");
    document.getElementById("selfieCaptureBtn").classList.add("hidden");
    document.getElementById("selfieRetakeBtn").classList.remove("hidden");
    document.getElementById("selfieSubmitBtn").classList.remove("hidden");
}

function retakeSelfie(){
    if(pendingAttendance) pendingAttendance.photo = null;
    document.getElementById("selfiePreview").classList.add("hidden");
    document.getElementById("selfieVideo").classList.remove("hidden");
    document.getElementById("selfieCaptureBtn").classList.remove("hidden");
    document.getElementById("selfieRetakeBtn").classList.add("hidden");
    document.getElementById("selfieSubmitBtn").classList.add("hidden");
}

async function submitAttendanceWithSelfie(){
    if(!pendingAttendance){
        closeSelfieModal();
        return;
    }
    if(!pendingAttendance.photo){
        toast("Ambil selfie dulu.", "error");
        return;
    }
    if(pendingAttendance.locationOk === false){
        toast("Di luar radius lokasi absensi.", "error");
        return;
    }

    // finalizeAttendance() (lihat cloud-sync.js) bersifat async karena foto perlu
    // diunggah ke Google Drive & data disimpan ke Google Sheets terlebih dahulu.
    const submitBtn = document.getElementById("selfieSubmitBtn");
    const retakeBtn = document.getElementById("selfieRetakeBtn");
    if(submitBtn){ submitBtn.disabled = true; submitBtn.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> Menyimpan..."; }
    if(retakeBtn) retakeBtn.disabled = true;

    try{
        await finalizeAttendance(pendingAttendance.session, pendingAttendance.token, pendingAttendance.location, pendingAttendance.photo);
    } finally {
        if(submitBtn){ submitBtn.disabled = false; submitBtn.innerHTML = "<i class=\"fa-solid fa-check\"></i> Kirim Absensi"; }
        if(retakeBtn) retakeBtn.disabled = false;
        closeSelfieModal();
    }
}

function closeSelfieModal(){
    if(selfieStream){
        selfieStream.getTracks().forEach(t=>t.stop());
        selfieStream = null;
    }
    const video = document.getElementById("selfieVideo");
    if(video) video.srcObject = null;
    document.getElementById("selfieModal").classList.remove("show");
    pendingAttendance = null;
}
