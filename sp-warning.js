/* =========================================================
   NEV ABSENKU — Surat Peringatan (SP)
   HRD menerbitkan SP kepada STAF atau KOOR KP.
   Penerima hanya melihat SP miliknya sendiri (difilter di server).
   File terpisah, memakai fungsi bawaan index.html (load, _localSave, toast,
   showPage, escapeHTML, jsId, emptyHTML, formatDateTimeWIB, getTodayWIB)
   dan cloudPost dari cloud-sync.js.
========================================================= */

const SP_LEVEL_ORDER = { SP1:1, SP2:2, SP3:3 };
const SP_ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];

function spAll(){
    const list = load(DB.warnings);
    return Array.isArray(list) ? list : [];
}
function spUseCloud(){
    return typeof cloudSyncEnabled !== "undefined" && cloudSyncEnabled;
}
function spNewId(){
    return "SP-" + Date.now() + "-" + Math.floor(Math.random()*1000000);
}
function spIsExpired(w){
    return !!(w && w.validUntil && String(w.validUntil) < getTodayWIB());
}
function spDateLabel(ymd){
    if(!ymd) return "-";
    try{
        return new Intl.DateTimeFormat("id-ID",{timeZone:"Asia/Jakarta",day:"numeric",month:"long",year:"numeric"})
            .format(new Date(ymd + "T12:00:00+07:00"));
    }catch(e){ return String(ymd); }
}
function spLevelBadge(level){
    const lv = SP_LEVEL_ORDER[level] ? level : "SP1";
    return `<span class="sp-badge sp-badge-${lv}">${lv}</span>`;
}
function spReadBadge(w){
    if(spIsExpired(w)) return `<span class="badge badge-inactive">Kedaluwarsa</span>`;
    return w.readAt
        ? `<span class="badge badge-hadir">Dibaca</span>`
        : `<span class="badge badge-izin">Belum dibaca</span>`;
}
function spShort(text, n){
    const t = String(text || "").replace(/\s+/g," ").trim();
    return t.length > n ? t.slice(0,n-1) + "…" : t;
}

/* ---------- Badge menu, banner dashboard, notifikasi ---------- */

const spToasted = new Set();

function spUnreadForMe(){
    if(!currentUser || currentUser.role==="HRD") return [];
    return spAll().filter(w=> w.targetId===currentUser.id && !w.readAt);
}

function updateWarningBadge(){
    if(!currentUser) return;
    const unread = spUnreadForMe();

    const item = document.querySelector('.menu-item[data-page="my-warning"]');
    if(item){
        let b = item.querySelector(".menu-badge");
        if(unread.length){
            if(!b){ b = document.createElement("span"); b.className = "menu-badge"; item.appendChild(b); }
            b.textContent = unread.length;
        }else if(b){ b.remove(); }
    }

    ["page-staf-dashboard","page-koor-dashboard"].forEach(id=>{
        const pg = document.getElementById(id);
        if(!pg) return;
        let banner = pg.querySelector(".sp-banner");
        if(!unread.length){ if(banner) banner.remove(); return; }
        if(!banner){
            banner = document.createElement("div");
            banner.className = "sp-banner";
            banner.onclick = ()=> showPage("my-warning");
            pg.prepend(banner);
        }
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>Anda memiliki ${unread.length} surat peringatan yang belum dibaca. Ketuk untuk membuka.</span>`;
    });

    const fresh = unread.filter(w=>!spToasted.has(w.id));
    if(fresh.length){
        fresh.forEach(w=>spToasted.add(w.id));
        toast(`Anda menerima ${fresh.length} surat peringatan baru dari HRD.`, "error");
    }
}

function renderWarningsAll(){
    if(!currentUser) return;
    updateWarningBadge();
    if(currentUser.role==="HRD" && document.getElementById("page-hrd-warning")?.classList.contains("active")) renderHrdWarnings();
    if(currentUser.role!=="HRD" && document.getElementById("page-my-warning")?.classList.contains("active")) renderMyWarnings();
}

/* ---------- HRD: daftar SP ---------- */

function renderHrdWarnings(){
    if(currentUser?.role!=="HRD") return;
    const container = document.getElementById("hrdWarningTable");
    if(!container) return;

    const search = (document.getElementById("spFilterSearch")?.value || "").trim().toLowerCase();
    const level  = document.getElementById("spFilterLevel")?.value || "";
    const role   = document.getElementById("spFilterRole")?.value || "";
    const status = document.getElementById("spFilterStatus")?.value || "";

    let list = spAll().slice();
    if(search) list = list.filter(w=>
        String(w.targetName||"").toLowerCase().includes(search) ||
        String(w.targetUsername||"").toLowerCase().includes(search) ||
        String(w.number||"").toLowerCase().includes(search)
    );
    if(level)  list = list.filter(w=>w.level===level);
    if(role)   list = list.filter(w=>w.targetRole===role);
    if(status==="aktif")       list = list.filter(w=>!spIsExpired(w));
    if(status==="kedaluwarsa") list = list.filter(w=>spIsExpired(w));
    if(status==="belum")       list = list.filter(w=>!w.readAt);
    list.sort((a,b)=> String(b.issuedAt).localeCompare(String(a.issuedAt)));

    if(!list.length){
        container.innerHTML = emptyHTML("fa-envelope-open", "Belum ada surat peringatan sesuai filter.");
        return;
    }

    container.innerHTML = `
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr><th>No. SP</th><th>Penerima</th><th>Role / Divisi</th><th>Tingkat</th><th>Alasan</th><th>Diterbitkan</th><th>Berlaku hingga</th><th>Status</th><th>Aksi</th></tr>
                </thead>
                <tbody>
                    ${list.map(w=>`
                        <tr>
                            <td>${escapeHTML(w.number || "-")}</td>
                            <td><strong>${escapeHTML(w.targetName)}</strong><br><span style="font-size:11px;color:#888;">${escapeHTML(w.targetUsername || "")}</span></td>
                            <td>${escapeHTML(w.targetRole)}${w.targetDivision ? " • "+escapeHTML(w.targetDivision) : ""}</td>
                            <td>${spLevelBadge(w.level)}</td>
                            <td title="${escapeHTML(w.reason)}">${escapeHTML(spShort(w.reason, 40))}</td>
                            <td>${w.issuedAt ? escapeHTML(formatDateTimeWIB(w.issuedAt)) : "-"}</td>
                            <td>${w.validUntil ? escapeHTML(spDateLabel(w.validUntil)) : "-"}</td>
                            <td>${spReadBadge(w)}</td>
                            <td style="display:flex;gap:5px;">
                                <button class="btn btn-outline" style="padding:7px 9px;" title="Lihat" onclick="openWarningDetail('${jsId(w.id)}')"><i class="fa-solid fa-eye"></i></button>
                                <button class="btn btn-danger" style="padding:7px 9px;" title="Cabut SP" onclick="deleteWarning('${jsId(w.id)}')"><i class="fa-solid fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>`;
}

/* ---------- HRD: form terbit SP ---------- */

function openWarningForm(){
    if(currentUser?.role!=="HRD"){ toast("Hanya HRD yang dapat menerbitkan SP.","error"); return; }
    const users = load(DB.users).filter(u=>u.role==="STAF" || u.role==="KOOR KP");
    const opt = u=>`<option value="${escapeHTML(u.id)}">${escapeHTML(u.name)} (${escapeHTML(u.username)})${u.division ? " • "+escapeHTML(u.division) : ""}</option>`;
    const sorted = arr=>arr.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    const koor = sorted(users.filter(u=>u.role==="KOOR KP"));
    const staf = sorted(users.filter(u=>u.role==="STAF"));

    document.getElementById("spTarget").innerHTML =
        `<option value="">Pilih penerima...</option>` +
        (koor.length ? `<optgroup label="Koor KP">${koor.map(opt).join("")}</optgroup>` : "") +
        (staf.length ? `<optgroup label="Staf">${staf.map(opt).join("")}</optgroup>` : "");
    document.getElementById("spLevel").value = "SP1";
    ["spReason","spAction","spValidUntil"].forEach(id=>{ document.getElementById(id).value = ""; });
    document.getElementById("spHint").innerHTML = "";
    const btn = document.getElementById("spSubmitBtn");
    if(btn) btn.disabled = false;
    document.getElementById("warningFormModal").classList.add("show");
}

/* Menampilkan riwayat penerima & menyarankan tingkat SP berikutnya. */
function onWarningTargetChange(){
    const id = document.getElementById("spTarget").value;
    const hint = document.getElementById("spHint");
    if(!id){ hint.innerHTML = ""; return; }
    const user = load(DB.users).find(u=>u.id===id);
    if(!user){ hint.innerHTML = ""; return; }

    const active = spAll().filter(w=>w.targetId===id && !spIsExpired(w));
    const highest = active.reduce((m,w)=>Math.max(m, SP_LEVEL_ORDER[w.level]||0), 0);
    const suggested = "SP" + Math.min(3, highest + 1);
    document.getElementById("spLevel").value = suggested;

    let parts = [];
    if(user.role==="STAF" && typeof hrdReportRows==="function"){
        const alpha = hrdReportRows().filter(a=>a.userId===id && a.status==="Alpha").length;
        parts.push(`Alpha tercatat: <strong>${alpha}</strong>`);
    }
    parts.push(active.length
        ? `SP yang masih berlaku: <strong>${active.map(w=>escapeHTML(w.level)).join(", ")}</strong>`
        : `Belum ada SP yang berlaku`);
    parts.push(`Tingkat disarankan: <strong>${suggested}</strong> (bisa diubah)`);
    hint.innerHTML = parts.join("<br>");
}

async function submitWarning(){
    if(currentUser?.role!=="HRD"){ toast("Hanya HRD yang dapat menerbitkan SP.","error"); return; }
    const targetId = document.getElementById("spTarget").value;
    const level = document.getElementById("spLevel").value;
    const reason = document.getElementById("spReason").value.trim();
    const action = document.getElementById("spAction").value.trim();
    const validUntil = document.getElementById("spValidUntil").value;

    if(!targetId){ toast("Pilih penerima SP.","error"); return; }
    if(!SP_LEVEL_ORDER[level]){ toast("Tingkat SP tidak valid.","error"); return; }
    if(!reason){ toast("Alasan/pelanggaran wajib diisi.","error"); return; }
    if(validUntil && validUntil < getTodayWIB()){ toast("Tanggal berlaku tidak boleh sebelum hari ini.","error"); return; }

    const target = load(DB.users).find(u=>u.id===targetId);
    if(!target){ toast("Penerima tidak ditemukan.","error"); return; }
    if(!confirm(`Terbitkan ${level} kepada ${target.name} (${target.role})?\n\nSP langsung terlihat oleh penerima.`)) return;

    const btn = document.getElementById("spSubmitBtn");
    if(btn) btn.disabled = true;

    const payload = { id:spNewId(), targetId, level, reason, action:action||null, validUntil:validUntil||null };
    try{
        let record;
        if(spUseCloud()){
            // id dibuat di klien sehingga server mengenali pengiriman ulang (tidak menerbitkan dobel).
            const json = await cloudPost("issueWarning", payload, 1);
            record = json.record;
        }else{
            record = Object.assign({}, payload, {
                number: spLocalNumber(),
                targetName:target.name, targetUsername:target.username,
                targetRole:target.role, targetDivision:target.division || null,
                issuedBy:currentUser.id, issuedByName:currentUser.name,
                issuedAt:new Date().toISOString(), readAt:null
            });
        }
        const list = spAll().filter(w=>w.id!==record.id);
        list.push(record);
        _localSave(DB.warnings, list);
        closeModal("warningFormModal");
        renderHrdWarnings();
        toast(`${level} untuk ${target.name} berhasil diterbitkan.`,"success");
    }catch(err){
        toast("Gagal menerbitkan SP: " + friendlyCloudError(err), "error");
        if(btn) btn.disabled = false;
    }
}

function spLocalNumber(){
    const now = new Date();
    const yr = now.getFullYear();
    const seq = spAll().filter(w=>String(w.number||"").endsWith("/"+yr)).length + 1;
    return String(seq).padStart(3,"0") + "/SP/NEV/" + SP_ROMAN[now.getMonth()] + "/" + yr;
}

async function deleteWarning(id){
    if(currentUser?.role!=="HRD"){ toast("Akses ditolak.","error"); return; }
    const w = spAll().find(x=>x.id===id);
    if(!w) return;
    if(!confirm(`Cabut ${w.level} untuk ${w.targetName}?\n\nSP akan dihapus dan tidak terlihat lagi oleh penerima.`)) return;
    try{
        if(spUseCloud()) await cloudPost("deleteWarning", { id }, 1);
        _localSave(DB.warnings, spAll().filter(x=>x.id!==id));
        closeModal("warningDetailModal");
        renderHrdWarnings();
        toast("SP berhasil dicabut.","success");
    }catch(err){
        toast("Gagal mencabut SP: " + friendlyCloudError(err), "error");
    }
}

/* ---------- STAF / KOOR KP: SP yang diterima ---------- */

function renderMyWarnings(){
    if(!currentUser || currentUser.role==="HRD") return;
    const container = document.getElementById("myWarningList");
    if(!container) return;
    const list = spAll().filter(w=>w.targetId===currentUser.id)
        .sort((a,b)=> String(b.issuedAt).localeCompare(String(a.issuedAt)));

    if(!list.length){
        container.innerHTML = emptyHTML("fa-circle-check", "Anda belum menerima surat peringatan.");
        return;
    }
    container.innerHTML = list.map(w=>`
        <div class="sp-card lvl-${escapeHTML(w.level)}${spIsExpired(w) ? " expired" : ""}" onclick="openWarningDetail('${jsId(w.id)}')">
            <div class="sp-card-head">
                ${spLevelBadge(w.level)}
                <strong>${escapeHTML(w.number || "Surat Peringatan")}</strong>
                ${spReadBadge(w)}
            </div>
            <p>${escapeHTML(spShort(w.reason, 220))}</p>
            <div class="sp-card-foot">
                <span><i class="fa-regular fa-calendar"></i> ${w.issuedAt ? escapeHTML(formatDateTimeWIB(w.issuedAt)) : "-"}</span>
                <span><i class="fa-solid fa-user-shield"></i> ${escapeHTML(w.issuedByName || "HRD")}</span>
                ${w.validUntil ? `<span>Berlaku hingga ${escapeHTML(spDateLabel(w.validUntil))}</span>` : ""}
            </div>
        </div>
    `).join("");
}

/* ---------- Detail surat + tandai sudah dibaca + PDF ---------- */

function openWarningDetail(id){
    const w = spAll().find(x=>x.id===id);
    if(!w){ toast("SP tidak ditemukan.","error"); return; }
    const isHrd = currentUser?.role==="HRD";
    if(!isHrd && w.targetId!==currentUser?.id){ toast("Akses ditolak.","error"); return; }

    document.getElementById("warningDetailTitle").textContent = "Surat Peringatan " + w.level;
    document.getElementById("warningDetailBody").innerHTML = `
        <div class="sp-letter">
            <div class="sp-letter-head">
                <img src="nev-logo.png" alt="NEV" onerror="this.style.display='none'">
                <h4>SURAT PERINGATAN ${escapeHTML(w.level)}</h4>
                <span>No. ${escapeHTML(w.number || "-")}</span>
            </div>
            <dl>
                <dt>Kepada</dt><dd><strong>${escapeHTML(w.targetName)}</strong> (${escapeHTML(w.targetUsername || "-")})</dd>
                <dt>Jabatan</dt><dd>${escapeHTML(w.targetRole)}${w.targetDivision ? " • Divisi "+escapeHTML(w.targetDivision) : ""}</dd>
                <dt>Tingkat</dt><dd>${spLevelBadge(w.level)}</dd>
                <dt>Diterbitkan</dt><dd>${w.issuedAt ? escapeHTML(formatDateTimeWIB(w.issuedAt)) : "-"} oleh ${escapeHTML(w.issuedByName || "HRD")}</dd>
                <dt>Berlaku hingga</dt><dd>${w.validUntil ? escapeHTML(spDateLabel(w.validUntil)) : "Tidak ditentukan"}</dd>
                <dt>Status</dt><dd>${spReadBadge(w)}${w.readAt ? ` <span style="font-size:11px;color:#888;">${escapeHTML(formatDateTimeWIB(w.readAt))}</span>` : ""}</dd>
            </dl>
            <strong>Alasan / pelanggaran</strong>
            <div class="sp-text">${escapeHTML(w.reason)}</div>
            ${w.action ? `<strong>Ketentuan / tindak lanjut</strong><div class="sp-text">${escapeHTML(w.action)}</div>` : ""}
        </div>`;

    document.getElementById("warningDetailFooter").innerHTML = `
        ${isHrd ? `<button class="btn btn-danger" onclick="deleteWarning('${jsId(w.id)}')"><i class="fa-solid fa-trash"></i> Cabut SP</button>` : ""}
        <button class="btn btn-outline" onclick="downloadWarningPDF('${jsId(w.id)}')"><i class="fa-solid fa-file-pdf"></i> Unduh PDF</button>
        <button class="btn btn-primary" onclick="closeModal('warningDetailModal')">Tutup</button>`;
    document.getElementById("warningDetailModal").classList.add("show");

    if(!isHrd && !w.readAt) markWarningRead(w.id);
}

async function markWarningRead(id){
    const list = spAll();
    const w = list.find(x=>x.id===id);
    if(!w || w.readAt) return;
    try{
        let readAt = new Date().toISOString();
        if(spUseCloud()){
            const json = await cloudPost("markWarningRead", { id }, 1);
            readAt = json.readAt || readAt;
        }
        w.readAt = readAt;
        _localSave(DB.warnings, list);
        updateWarningBadge();
        if(document.getElementById("page-my-warning")?.classList.contains("active")) renderMyWarnings();
    }catch(err){
        console.warn("Gagal menandai SP dibaca:", err);
    }
}

function downloadWarningPDF(id){
    const w = spAll().find(x=>x.id===id);
    if(!w) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("portrait","mm","a4");
    const W = doc.internal.pageSize.getWidth();
    const left = 20, right = W - 20, maxW = right - left;
    let y = 22;

    doc.setFont("helvetica","bold"); doc.setFontSize(16);
    doc.text("NEV ABSENKU", W/2, y, {align:"center"}); y += 7;
    doc.setFontSize(13);
    doc.text("SURAT PERINGATAN " + w.level, W/2, y, {align:"center"}); y += 6;
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text("No. " + (w.number || "-"), W/2, y, {align:"center"}); y += 4;
    doc.setLineWidth(.6); doc.line(left, y, right, y); y += 9;

    const ensure = h=>{ if(y + h > 280){ doc.addPage(); y = 20; } };
    const field = (label, value)=>{
        const lines = doc.splitTextToSize(String(value || "-"), maxW - 42);
        ensure(lines.length * 5 + 2);
        doc.setFont("helvetica","bold"); doc.text(label, left, y);
        doc.setFont("helvetica","normal"); doc.text(lines, left + 42, y);
        y += lines.length * 5 + 2;
    };
    const block = (label, value)=>{
        const lines = doc.splitTextToSize(String(value || "-"), maxW);
        ensure(8 + lines.length * 5);
        doc.setFont("helvetica","bold"); doc.text(label, left, y); y += 6;
        doc.setFont("helvetica","normal"); doc.text(lines, left, y);
        y += lines.length * 5 + 6;
    };

    field("Kepada", `${w.targetName} (${w.targetUsername || "-"})`);
    field("Jabatan", w.targetRole + (w.targetDivision ? " - Divisi " + w.targetDivision : ""));
    field("Tingkat", w.level);
    field("Diterbitkan", (w.issuedAt ? formatDateTimeWIB(w.issuedAt) : "-") + " oleh " + (w.issuedByName || "HRD"));
    field("Berlaku hingga", w.validUntil ? spDateLabel(w.validUntil) : "Tidak ditentukan");
    y += 4;
    block("Alasan / pelanggaran", w.reason);
    if(w.action) block("Ketentuan / tindak lanjut", w.action);

    ensure(30);
    y += 6;
    doc.text("Hormat kami,", right - 50, y); y += 22;
    doc.setFont("helvetica","bold");
    doc.text(w.issuedByName || "HRD", right - 50, y); y += 5;
    doc.setFont("helvetica","normal");
    doc.text("HRD NEV", right - 50, y);

    const safe = String(w.number || w.id).replace(/[^A-Za-z0-9_-]+/g,"-");
    doc.save("NEV-Absenku-SP-" + safe + ".pdf");
    toast("PDF surat peringatan berhasil dibuat.","success");
}
