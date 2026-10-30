/* NEV Absenku — Penilaian Staf oleh HRD/KOOR KP. */
(function(){
"use strict";
let records=[],loading=false,saving=false;
const criteria=[["discipline","Disiplin"],["responsibility","Tanggung jawab"],["teamwork","Kerja sama"],["initiative","Inisiatif"],["performance","Kinerja"]];
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function mount(){
 const content=document.querySelector("main.main > .content");if(!content||document.getElementById("page-staff-evaluation"))return;
 const section=document.createElement("section");section.id="page-staff-evaluation";section.className="page";
 section.innerHTML='<div class="eval-header"><div><h3 id="evalPageHeading">Penilaian Kinerja Staf</h3><p id="evalPageDescription">Penilaian berkala oleh HRD atau Koor KP sesuai divisi.</p></div><button class="btn btn-outline" id="evalRefresh"><i class="fa-solid fa-rotate"></i> Segarkan</button></div><div id="evalFormWrap"></div><div class="eval-summary" id="evalSummary"></div><div class="eval-filters" id="evalFilters"><input id="evalSearch" class="form-control" placeholder="Cari nama staf atau periode"><select id="evalPeriod" class="form-control"><option value="">Semua periode</option></select></div><div id="evalStatus" class="eval-status">Memuat data…</div><div id="evalList"></div>';
 content.appendChild(section);
 section.querySelector("#evalRefresh").addEventListener("click",loadRecords);
 ["evalSearch","evalPeriod"].forEach(id=>section.querySelector("#"+id).addEventListener("input",render));
}
function currentPage(){return document.getElementById("page-staff-evaluation")?.classList.contains("active")||document.getElementById("page-my-evaluation")?.classList.contains("active")}
function isEvaluator(){return currentUser?.role==="HRD"||currentUser?.role==="KOOR KP"}
function setStatus(t,error){const el=document.getElementById("evalStatus");if(el){el.textContent=t;el.classList.toggle("is-error",!!error)}}
async function loadRecords(){
 if(!currentUser||!currentPage())return;if(loading)return;loading=true;setStatus("Mengambil data penilaian…");
 try{const res=await cloudPost("getEvaluations",{},1);records=Array.isArray(res.records)?res.records:[];window.PriorityEvaluationRecords=records;setStatus(records.length+" penilaian ditemukan.");renderForm();render()}
 catch(e){setStatus("Gagal memuat penilaian: "+(e.message||e),true)}
 finally{loading=false}
}
function renderForm(){
 const wrap=document.getElementById("evalFormWrap");if(!wrap)return;
 const heading=document.getElementById("evalPageHeading"),description=document.getElementById("evalPageDescription");
 if(!isEvaluator()){if(heading)heading.textContent="Penilaian Saya";if(description)description.textContent="Lihat hasil evaluasi kinerja yang diberikan kepada Anda.";wrap.innerHTML="";return}
 if(heading)heading.textContent="Penilaian Kinerja Staf";if(description)description.textContent="Penilaian berkala oleh HRD atau Koor KP sesuai divisi.";
 const users=(load(DB.users)||[]).filter(u=>u.role==="STAF"&&(currentUser.role==="HRD"||u.division===currentUser.division)).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
 wrap.innerHTML='<form id="evalForm" class="eval-form"><h4><i class="fa-solid fa-clipboard-check"></i> Buat Penilaian Baru</h4><div class="eval-form-grid"><label>Nama staf<select class="form-control" name="staffId" required><option value="">Pilih staf…</option>'+users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name)+' • '+esc(u.division||"-")+'</option>').join("")+'</select></label><label>Tanggal Penilaian<input class="form-control" type="date" name="period" required aria-label="Tanggal Penilaian"></label></div><div class="eval-score-grid">'+criteria.map(([k,label])=>'<label>'+label+'<select class="form-control" name="'+k+'" required><option value="">Pilih nilai</option><option value="1">1 — Perlu pembinaan</option><option value="2">2 — Kurang</option><option value="3">3 — Cukup</option><option value="4">4 — Baik</option><option value="5">5 — Sangat baik</option></select></label>').join("")+'</div><div class="eval-form-grid"><label>Keunggulan / catatan positif<textarea class="form-control" name="strengths" rows="2" maxlength="1000" placeholder="Catat hal yang sudah baik…"></textarea></label><label>Area yang perlu ditingkatkan<textarea class="form-control" name="improvement" rows="2" maxlength="1000" placeholder="Catat saran pengembangan…"></textarea></label></div><div class="eval-form-foot"><small>Skala 1–5. Nilai rata-rata dihitung otomatis oleh server.</small><button class="btn btn-primary" type="submit" '+(!users.length?'disabled':'')+'><i class="fa-solid fa-floppy-disk"></i> Simpan Penilaian</button></div></form>';
 const form=wrap.querySelector("#evalForm");form.addEventListener("submit",submitForm);
}
async function submitForm(e){
 e.preventDefault();if(saving)return;if(!isEvaluator())return;
 const form=e.currentTarget,fd=new FormData(form),payload={};for(const [k,v] of fd.entries())payload[k]=String(v).trim();
 if(!payload.staffId||!payload.period){setStatus("Pilih staf dan tanggal penilaian.",true);return}
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.period)||Number.isNaN(Date.parse(payload.period+"T00:00:00"))){setStatus("Tanggal penilaian tidak valid.",true);return}
 for(const [k] of criteria)if(!payload[k]){setStatus("Lengkapi seluruh nilai kriteria.",true);return}
 saving=true;const btn=form.querySelector("button[type=submit]");btn.disabled=true;
 try{await cloudPost("submitEvaluation",payload,1);form.reset();await loadRecords();setStatus("Penilaian berhasil disimpan.");}
 catch(err){setStatus("Penilaian gagal disimpan: "+(err.message||err),true)}
 finally{saving=false;if(btn)btn.disabled=false}
}
function render(){
 const box=document.getElementById("evalList");if(!box)return;
 const q=(document.getElementById("evalSearch")?.value||"").toLowerCase(),period=document.getElementById("evalPeriod")?.value||"";
 const periods=[...new Set(records.map(r=>r.period).filter(Boolean))].sort().reverse(),sel=document.getElementById("evalPeriod"),old=sel.value;
 if(sel.options.length!==periods.length+1){sel.innerHTML='<option value="">Semua periode</option>'+periods.map(p=>'<option value="'+esc(p)+'">'+esc(/^\\d{4}-\\d{2}-\\d{2}$/.test(p)?formatDate(p):p)+'</option>').join("");sel.value=periods.includes(old)?old:""}
 const list=records.filter(r=>(!q||[r.staffName,r.staffUsername,r.division,r.period,r.evaluatorName].join(" ").toLowerCase().includes(q))&&(!period||r.period===period)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 const summary=document.getElementById("evalSummary");if(summary)summary.innerHTML='<div><strong>'+records.length+'</strong><span>Total penilaian</span></div><div><strong>'+(records.length?(records.reduce((s,r)=>s+Number(r.average||0),0)/records.length).toFixed(2):"0.00")+'</strong><span>Rata-rata keseluruhan</span></div>';
 if(!list.length){box.innerHTML='<div class="eval-empty">Belum ada penilaian yang sesuai.</div>';return}
 box.innerHTML=list.map(r=>'<article class="eval-card"><div class="eval-card-head"><div><h4>'+esc(r.staffName||"-")+'</h4><p>'+esc(r.division||"-")+' • '+esc(r.period||"-")+'</p></div><div class="eval-average"><strong>'+Number(r.average||0).toFixed(2)+'</strong><span>/ 5.00</span></div></div><div class="eval-scores">'+criteria.map(([k,label])=>'<div><span>'+label+'</span><strong>'+esc(r[k])+'/5</strong><i><b style="width:'+Math.max(0,Math.min(5,Number(r[k])||0))*20+'%"></b></i></div>').join("")+'</div><div class="eval-notes">'+(r.strengths?'<p><strong>Keunggulan:</strong> '+esc(r.strengths)+'</p>':'')+(r.improvement?'<p><strong>Perlu ditingkatkan:</strong> '+esc(r.improvement)+'</p>':'')+'</div><footer>Dinilai oleh '+esc(r.evaluatorName||"-")+' ('+esc(r.evaluatorRole||"-")+') • '+esc(formatDate(r.createdAt))+'</footer></article>').join("");
}
function formatDate(v){if(!v)return"-";try{return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeZone:"Asia/Jakarta"}).format(new Date(v))}catch(e){return String(v)}}
function renderStaffEvaluations(){mount();loadRecords()}
window.renderStaffEvaluations=renderStaffEvaluations;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();