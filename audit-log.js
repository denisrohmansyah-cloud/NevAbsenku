/* NEV Absenku — AuditLog viewer (HRD only). */
(function(){
"use strict";
let rows=[],busy=false;
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function mount(){
 const main=document.querySelector("main.main"); if(!main||document.getElementById("page-hrd-audit-log"))return;
 const section=document.createElement("section");section.id="page-hrd-audit-log";section.className="page";
 section.innerHTML='<div class="audit-toolbar"><div><h3>Riwayat Aktivitas Sistem</h3><p>Catatan aktivitas yang tercatat pada Google Sheets AuditLog.</p></div><button class="btn btn-primary" id="auditRefresh"><i class="fa-solid fa-rotate"></i> Muat ulang</button></div><div class="audit-filters"><label>Cari aktor / aktivitas<input id="auditSearch" type="search" placeholder="Nama, ID, aksi, ringkasan"></label><label>Jenis aktivitas<select id="auditAction"><option value="">Semua aktivitas</option></select></label><label>Dari tanggal<input id="auditFrom" type="date"></label><label>Sampai tanggal<input id="auditTo" type="date"></label></div><div id="auditStatus" class="audit-status">Belum dimuat.</div><div id="auditTable" class="audit-table"></div>';
 main.appendChild(section);
 section.querySelector("#auditRefresh").addEventListener("click",loadRows);
 ["auditSearch","auditAction","auditFrom","auditTo"].forEach(id=>section.querySelector("#"+id).addEventListener("input",render));
}
function status(msg,error){const el=document.getElementById("auditStatus");if(el){el.textContent=msg;el.classList.toggle("is-error",!!error)}}
async function loadRows(){
 if(currentUser?.role!=="HRD"){status("Akses hanya untuk HRD.",true);return}
 if(busy)return;busy=true;status("Mengambil catatan aktivitas dari server…");
 try{
  const result=await cloudPost("getAuditLog",{limit:500},1);
  rows=Array.isArray(result.records)?result.records:[];
  const sel=document.getElementById("auditAction"),old=sel.value;
  const actions=[...new Set(rows.map(x=>x.action).filter(Boolean))].sort();
  sel.innerHTML='<option value="">Semua aktivitas</option>'+actions.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
  sel.value=actions.includes(old)?old:"";
  status(rows.length+" catatan berhasil dimuat. Maksimal 500 catatan terbaru.");
  render();
 }catch(e){status("Gagal memuat AuditLog: "+(e.message||e),true)}
 finally{busy=false}
}
function render(){
 const box=document.getElementById("auditTable");if(!box)return;
 const q=(document.getElementById("auditSearch")?.value||"").toLowerCase();
 const action=document.getElementById("auditAction")?.value||"",from=document.getElementById("auditFrom")?.value||"",to=document.getElementById("auditTo")?.value||"";
 const filtered=rows.filter(r=>{
  const hay=[r.actorName,r.actorId,r.actorRole,r.actorDivision,r.action,r.entityType,r.entityId,r.summary].join(" ").toLowerCase();
  const day=String(r.timestamp||"").slice(0,10);
  return (!q||hay.includes(q))&&(!action||r.action===action)&&(!from||day>=from)&&(!to||day<=to);
 });
 if(!filtered.length){box.innerHTML='<div class="audit-empty">Tidak ada catatan yang sesuai filter.</div>';return}
 box.innerHTML='<div class="table-wrapper"><table><thead><tr><th>Waktu</th><th>Aktor</th><th>Role / Divisi</th><th>Aktivitas</th><th>Objek</th><th>Ringkasan</th></tr></thead><tbody>'+filtered.map(r=>{
  let time=r.timestamp||"-";try{time=new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jakarta"}).format(new Date(time))}catch(e){}
  return '<tr><td>'+esc(time)+'</td><td><strong>'+esc(r.actorName||"-")+'</strong><br><small>'+esc(r.actorId||"")+'</small></td><td>'+esc(r.actorRole||"-")+'<br><small>'+esc(r.actorDivision||"-")+'</small></td><td><code>'+esc(r.action||"-")+'</code></td><td>'+esc(r.entityType||"-")+(r.entityId?"<br><small>"+esc(r.entityId)+"</small>":"")+'</td><td>'+esc(r.summary||"-")+'</td></tr>'
 }).join("")+'</tbody></table></div>';
}
function renderAuditLog(){mount();loadRows()}
window.renderAuditLog=renderAuditLog;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();