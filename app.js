/* ===================== 미래를 심는 씨앗 - 메인 로직 ===================== */
(function () {
  "use strict";

  const SESSION_KEY = "seedBank_session_v1";

  /* ---------------- firestore storage ---------------- */
  /* 데이터(씨앗/대여기록/회원)는 모두 Firebase Firestore에 저장되어
     모든 방문자가 실시간으로 같은 데이터를 봐요. js/firebase-config.js 를 먼저 설정하세요. */
  let db = { users: [], seeds: [], rentals: [] };
  const dbReady = { users: false, seeds: false, rentals: false };
  let fs = null;

  function isConfigured() {
    return typeof firebaseConfig !== "undefined"
      && firebaseConfig.apiKey
      && firebaseConfig.apiKey.indexOf("여기에") === -1;
  }

  async function seedInitialDataIfNeeded() {
    const seedsSnap = await fs.collection("seeds").limit(1).get();
    if (seedsSnap.empty) {
      const batch = fs.batch();
      DEFAULT_DB.seeds.forEach(seed => {
        const { id, ...rest } = seed;
        batch.set(fs.collection("seeds").doc(), rest);
      });
      await batch.commit();
    }
    const adminSnap = await fs.collection("users").doc("관리자").get();
    if (!adminSnap.exists) {
      await fs.collection("users").doc("관리자").set({
        name: "관리자", password: "admin123", studentId: "-", role: "admin"
      });
    }
  }

  function attachListeners() {
    fs.collection("seeds").onSnapshot(snap => {
      db.seeds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      dbReady.seeds = true;
      guardAndRender();
    }, onFirestoreError);
    fs.collection("rentals").onSnapshot(snap => {
      db.rentals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      dbReady.rentals = true;
      guardAndRender();
    }, onFirestoreError);
    fs.collection("users").onSnapshot(snap => {
      db.users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      dbReady.users = true;
      guardAndRender();
    }, onFirestoreError);
  }

  function onFirestoreError(err) {
    console.error(err);
    renderConnectionError();
  }

  async function boot() {
    if (!isConfigured()) { renderSetupNotice(); return; }
    try {
      firebase.initializeApp(firebaseConfig);
      fs = firebase.firestore();
      await seedInitialDataIfNeeded();
      attachListeners();
    } catch (e) {
      onFirestoreError(e);
    }
  }

  function renderSetupNotice() {
    document.getElementById("nav-links").innerHTML = "";
    document.getElementById("nav-user").innerHTML = "";
    document.getElementById("app").innerHTML = `
    <div class="auth-wrap">
      <div class="panel auth-card">
        <div class="brand-icon-big">🏡🌱</div>
        <h1>설정이 필요해요</h1>
        <p class="muted">아직 Firebase 연결 설정이 안 되어 있어요.<br>
        <code>js/firebase-config.js</code> 파일을 열어 프로젝트 설정 값을 붙여넣어 주세요.<br>
        자세한 방법은 <code>SETUP.md</code> 문서를 확인하세요.</p>
      </div>
    </div>`;
  }

  function renderConnectionError() {
    document.getElementById("app").innerHTML = `
    <div class="auth-wrap">
      <div class="panel auth-card">
        <div class="brand-icon-big">⚠️🌱</div>
        <h1>연결에 실패했어요</h1>
        <p class="muted">Firebase 설정 값이 올바른지, Firestore 보안 규칙이 게시되었는지 확인해주세요.<br>
        자세한 방법은 <code>SETUP.md</code> 문서를 확인하세요.</p>
      </div>
    </div>`;
  }

  function renderLoadingScreen() {
    document.getElementById("nav-links").innerHTML = "";
    document.getElementById("nav-user").innerHTML = "";
    document.getElementById("app").innerHTML = `<div class="empty-state"><div class="big">🌱</div>불러오는 중이에요...</div>`;
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }
  function setSession(userId) { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId })); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  function currentUser() {
    const s = getSession();
    if (!s) return null;
    return db.users.find(u => u.id === s.userId) || null;
  }

  /* ---------------- utils ---------------- */
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function fmtDate(d) { return d ? d : "-"; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  function addDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function isOverdue(rental) {
    return rental.status === "rented" && rental.dueDate && rental.dueDate < todayStr();
  }
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* seed 의 현재 대여 상태 계산: available / pending / rented */
  function seedStatus(seedId) {
    const active = db.rentals.find(r => r.seedId === seedId && (r.status === "pending" || r.status === "rented"));
    if (!active) return "available";
    return active.status; // 'pending' | 'rented'
  }
  function seedActiveRental(seedId) {
    return db.rentals.find(r => r.seedId === seedId && (r.status === "pending" || r.status === "rented")) || null;
  }
  const STATUS_LABEL = {
    available: "대여 가능",
    pending: "승인 대기",
    rented: "대여 중",
    returned: "반납 완료",
    rejected: "거절됨"
  };
  function badgeHtml(status, overdue) {
    const cls = overdue ? "overdue" : status;
    const label = overdue ? "반납 지연" : STATUS_LABEL[status];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  /* ---------------- router ---------------- */
  const routes = {
    login: renderLogin,
    signup: renderSignup,
    catalog: renderCatalog,
    seed: renderSeedDetail,
    "add-seed": renderAddSeed,
    mypage: renderMyPage,
    admin: renderAdmin,
    dashboard: renderDashboard
  };

  function parseHash() {
    let h = location.hash.replace(/^#\/?/, "");
    if (!h) h = "catalog";
    const parts = h.split("/");
    return { name: parts[0], param: parts[1] };
  }

  function navigate(hash) { location.hash = hash; }

  function guardAndRender() {
    if (!(dbReady.users && dbReady.seeds && dbReady.rentals)) { renderLoadingScreen(); return; }
    const { name, param } = parseHash();
    const user = currentUser();

    if (!user && name !== "login" && name !== "signup") {
      navigate("#/login"); return;
    }
    if (user && (name === "login" || name === "signup")) {
      navigate("#/catalog"); return;
    }
    if (name === "admin" && (!user || user.role !== "admin")) {
      navigate("#/catalog"); toast("관리자만 접근할 수 있어요."); return;
    }

    renderNav(user, name);
    const fn = routes[name] || renderCatalog;
    const app = document.getElementById("app");
    app.innerHTML = fn(param, user);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function renderNav(user, activeName) {
    const navLinks = document.getElementById("nav-links");
    const navUser = document.getElementById("nav-user");
    if (!user) { navLinks.innerHTML = ""; navUser.innerHTML = ""; return; }

    const links = [
      { key: "catalog", label: "🌿 씨앗 목록" },
      { key: "add-seed", label: "🌱 씨앗 등록" },
      { key: "mypage", label: "📋 내 대여 현황" },
      { key: "dashboard", label: "📊 대시보드" }
    ];
    if (user.role === "admin") links.push({ key: "admin", label: "🛠 관리자" });

    navLinks.innerHTML = links.map(l =>
      `<a href="#/${l.key}" class="${activeName === l.key ? "active" : ""}">${l.label}</a>`
    ).join("");

    navUser.innerHTML = `
      <span class="pill">${user.role === "admin" ? "🛠 관리자" : "🌱 " + esc(user.studentId)} · ${esc(user.name)}님</span>
      <button class="btn-logout" data-action="logout">로그아웃</button>
    `;
  }

  /* ---------------- views: auth ---------------- */
  function renderLogin() {
    return `
    <div class="auth-wrap">
      <div class="panel auth-card">
        <div class="brand-icon-big">🏡🌱</div>
        <h1>미래를 심는 씨앗</h1>
        <p class="muted">씨앗을 빌리고, 지혜를 나눠요</p>
        <div class="auth-tabs">
          <a href="#/login" class="active">로그인</a>
          <a href="#/signup">회원가입</a>
        </div>
        <form data-form="login">
          <div class="field">
            <label>이름</label>
            <input type="text" name="name" placeholder="이름을 입력하세요" required>
          </div>
          <div class="field">
            <label>비밀번호</label>
            <input type="password" name="password" placeholder="비밀번호를 입력하세요" required>
          </div>
          <button class="btn" type="submit" style="width:100%">로그인</button>
        </form>
      </div>
    </div>`;
  }

  function renderSignup() {
    return `
    <div class="auth-wrap">
      <div class="panel auth-card">
        <div class="brand-icon-big">🏡🌱</div>
        <h1>회원가입</h1>
        <p class="muted">이름과 비밀번호만 있으면 바로 가입돼요</p>
        <div class="auth-tabs">
          <a href="#/login">로그인</a>
          <a href="#/signup" class="active">회원가입</a>
        </div>
        <form data-form="signup">
          <div class="field">
            <label>이름</label>
            <input type="text" name="name" placeholder="이름을 입력하세요" required>
          </div>
          <div class="field">
            <label>학번</label>
            <input type="text" name="studentId" placeholder="예: 10914" required>
          </div>
          <div class="field">
            <label>비밀번호</label>
            <input type="password" name="password" placeholder="비밀번호 (제한 없음)" required>
          </div>
          <button class="btn" type="submit" style="width:100%">가입하고 시작하기</button>
        </form>
      </div>
    </div>`;
  }

  function doLogin(name, password) {
    const user = db.users.find(u => u.name === name && u.password === password);
    if (!user) { toast("이름 또는 비밀번호가 올바르지 않아요."); return; }
    setSession(user.id);
    toast(`${user.name}님, 환영해요! 🌱`);
    navigate("#/catalog");
  }
  async function doSignup(name, studentId, password) {
    if (db.users.some(u => u.name === name)) { toast("이미 있는 이름이에요. 다른 이름을 써주세요."); return; }
    try {
      await fs.collection("users").doc(name).set({ name, password, studentId, role: "student" });
    } catch (e) { console.error(e); toast("가입에 실패했어요. 잠시 후 다시 시도해주세요."); return; }
    setSession(name);
    toast("가입 완료! 미래를 심는 씨앗에 오신 걸 환영해요 🌿");
    navigate("#/catalog");
  }

  /* ---------------- views: catalog ---------------- */
  function renderCatalog() {
    const cards = db.seeds.map(seedCardHtml).join("");
    return `
    <div class="panel">
      <div class="catalog-toolbar">
        <h2 style="margin:0">🌿 씨앗 목록</h2>
        <input type="text" id="seedSearch" placeholder="품종명으로 검색..." oninput="window.__filterSeeds(this.value)">
      </div>
      <div class="seed-grid" id="seedGrid">${cards || emptyState("아직 등록된 씨앗이 없어요.")}</div>
    </div>`;
  }

  function seedCardHtml(seed) {
    const status = seedStatus(seed.id);
    const media = seed.image
      ? `<img src="${seed.image}" alt="${esc(seed.name)}">`
      : seed.emoji;
    return `
    <div class="seed-card" data-seed-name="${esc(seed.name).toLowerCase()}">
      <div class="seed-media">${media}</div>
      <div class="seed-body">
        <div class="seed-name">${esc(seed.name)}</div>
        <div class="seed-meta">기증자 ${esc(seed.donor)} · ${fmtDate(seed.donateDate)}</div>
        <div class="seed-wisdom">💡 ${esc(seed.wisdom.slice(0, 46))}${seed.wisdom.length > 46 ? "…" : ""}</div>
        <div class="seed-foot">
          ${badgeHtml(status)}
          <button class="btn small" data-action="view-seed" data-id="${seed.id}">자세히 보기</button>
        </div>
      </div>
    </div>`;
  }

  window.__filterSeeds = function (q) {
    q = q.trim().toLowerCase();
    document.querySelectorAll("#seedGrid .seed-card").forEach(card => {
      const name = card.getAttribute("data-seed-name");
      card.style.display = name.includes(q) ? "" : "none";
    });
  };

  function emptyState(msg) {
    return `<div class="empty-state" style="grid-column:1/-1"><div class="big">🌱</div>${esc(msg)}</div>`;
  }

  /* ---------------- views: seed detail ---------------- */
  function renderSeedDetail(id, user) {
    const seed = db.seeds.find(s => s.id === id);
    if (!seed) return `<div class="panel">${emptyState("씨앗을 찾을 수 없어요.")}</div>`;
    const status = seedStatus(seed.id);
    const media = seed.image ? `<img src="${seed.image}" alt="${esc(seed.name)}">` : seed.emoji;

    const canRequest = user.role === "student" && status === "available";
    const loanCount = db.rentals.filter(r => r.seedId === seed.id && (r.status === "rented" || r.status === "returned")).length;
    const wisdomLog = db.rentals
      .filter(r => r.seedId === seed.id && r.status === "returned" && r.note && r.note.trim())
      .slice().sort((a, b) => (b.returnDate || "").localeCompare(a.returnDate || ""));

    return `
    <div class="panel">
      <a href="#/catalog" class="muted">&larr; 목록으로</a>
      <div class="detail-grid mt">
        <div class="detail-media">${media}</div>
        <div class="detail-info">
          <div class="flex-between">
            <h1 style="margin:0">${esc(seed.name)}</h1>
            ${badgeHtml(status)}
          </div>
          <dl>
            <dt>기증자</dt><dd>${esc(seed.donor)}</dd>
            <dt>기증일</dt><dd>${fmtDate(seed.donateDate)}</dd>
          </dl>
          <div class="wisdom-box">🌾 <b>기증자가 남긴 첫 지혜</b><br>${esc(seed.wisdom)}</div>
          <p class="hint mt">지금까지 총 ${loanCount}번 대여되었어요.</p>
          <div class="mt">
            ${canRequest
        ? `<button class="btn" data-action="request-rental" data-id="${seed.id}">🌱 이 씨앗 대여 신청하기</button>`
        : (user.role === "student"
          ? `<button class="btn" disabled>${status === "pending" ? "승인 대기 중이에요" : "지금은 대여할 수 없어요"}</button>`
          : "")}
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title"><h2>📚 누적된 재배 지혜</h2></div>
      <p class="hint" style="margin-top:-8px">이전 대여자들의 이름은 비공개로 처리되고, 대여했던 기간과 남긴 팁만 기록돼요.</p>
      ${wisdomLog.length ? `
      <div style="display:flex;flex-direction:column;gap:12px" class="mt">
        ${wisdomLog.map(r => `
          <div class="wisdom-box" style="background:var(--cream);border-left-color:var(--wood-light);color:var(--text)">
            <div class="muted" style="font-size:.8rem;margin-bottom:4px">🗓 이전 대여자 · ${fmtDate(r.rentalDate)} ~ ${fmtDate(r.returnDate)} 대여</div>
            ${esc(r.note)}
          </div>`).join("")}
      </div>` : emptyState("아직 다른 대여자가 남긴 지혜가 없어요.")}
    </div>`;
  }

  async function requestRental(seedId, user) {
    const seed = db.seeds.find(s => s.id === seedId);
    if (!seed) return;
    if (seedStatus(seedId) !== "available") { toast("지금은 대여 신청을 할 수 없는 씨앗이에요."); return; }
    await fs.collection("rentals").add({
      seedId, userId: user.id, renterName: user.name, studentId: user.studentId,
      requestDate: todayStr(), rentalDate: null, dueDate: null, returnDate: null, status: "pending", note: ""
    });
    toast("대여 신청 완료! 관리자 승인을 기다려주세요 🌿");
    guardAndRender();
  }

  /* ---------------- views: my page ---------------- */
  let noteEditingId = null;

  function noteEditPanelHtml(rental) {
    if (!rental) return "";
    const seed = db.seeds.find(s => s.id === rental.seedId);
    return `
    <div class="panel" style="background:var(--cream);margin-top:14px;margin-bottom:0;box-shadow:none;border-style:dashed">
      <div class="panel-title"><h2>🌾 ${seed ? esc(seed.name) : ""}에게 남길 지혜</h2></div>
      <form data-form="save-note">
        <div class="field">
          <label>다음 대여자가 참고할 수 있는 짧은 팁을 남겨주세요. 이름은 표시되지 않아요.</label>
          <textarea name="note" placeholder="예: 물을 너무 자주 주면 뿌리가 썩어요.">${esc(rental.note || "")}</textarea>
        </div>
        <div class="field-row">
          <button class="btn" type="submit">저장하기</button>
          <button class="btn secondary" type="button" data-action="cancel-note">취소</button>
        </div>
      </form>
    </div>`;
  }

  async function updateRentalNote(rentalId, note) {
    const r = db.rentals.find(x => x.id === rentalId);
    if (!r) return;
    await fs.collection("rentals").doc(rentalId).update({ note });
    noteEditingId = null;
    toast("지혜를 저장했어요. 반납하면 다음 대여자에게 전해져요 🌿");
    guardAndRender();
  }

  function renderMyPage(_, user) {
    const mine = db.rentals.filter(r => r.userId === user.id)
      .slice().sort((a, b) => (b.requestDate || "").localeCompare(a.requestDate || ""));
    return `
    <div class="panel">
      <div class="panel-title"><h2>📋 내 대여 현황</h2></div>
      <p class="hint" style="margin-top:-8px">반납하기 전에 다음 대여자를 위한 재배 지혜를 남겨보세요. 반납 시 씨앗 상세 페이지에 이름 없이(기간만 표시) 기록돼요.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>씨앗</th><th>신청일</th><th>대여일</th><th>반납예정일</th><th>반납일</th><th>상태</th><th>지혜 메모</th></tr></thead>
          <tbody>
            ${mine.length ? mine.map(r => {
      const seed = db.seeds.find(s => s.id === r.seedId);
      return `<tr>
                <td>${seed ? esc(seed.name) : "-"}</td>
                <td>${fmtDate(r.requestDate)}</td>
                <td>${fmtDate(r.rentalDate)}</td>
                <td>${fmtDate(r.dueDate)}</td>
                <td>${fmtDate(r.returnDate)}</td>
                <td>${badgeHtml(r.status, isOverdue(r))}</td>
                <td>${r.status === "rented"
          ? `<button class="btn small ${r.note ? "secondary" : ""}" data-action="edit-note" data-id="${r.id}">${r.note ? "메모 수정" : "지혜 남기기"}</button>`
          : (r.note ? "✅ 남김" : "-")}</td>
              </tr>`;
    }).join("") : `<tr><td colspan="7" class="empty-row">아직 대여한 씨앗이 없어요. 씨앗 목록에서 신청해보세요!</td></tr>`}
          </tbody>
        </table>
      </div>
      ${noteEditingId ? noteEditPanelHtml(mine.find(r => r.id === noteEditingId)) : ""}
    </div>`;
  }

  /* ---------------- views: add seed ---------------- */
  function renderAddSeed() {
    return `
    <div class="panel" style="max-width:520px;margin:0 auto">
      <div class="panel-title"><h2>🌱 새 씨앗 등록</h2></div>
      <p class="hint">누구나 새로운 품종을 기증하고 등록할 수 있어요.</p>
      <form data-form="add-seed">
        <div class="img-upload-preview" id="newSeedPreview">📷 이미지 미리보기</div>
        <div class="field">
          <label>씨앗 이미지 (선택, 없으면 이모지 🌱 로 표시)</label>
          <input type="file" accept="image/*" id="newSeedImage">
        </div>
        <div class="field">
          <label>대체 이모지</label>
          <input type="text" name="emoji" placeholder="예: 🌻" maxlength="4">
        </div>
        <div class="field">
          <label>품종명</label>
          <input type="text" name="name" placeholder="예: 봉선화" required>
        </div>
        <div class="field-row">
          <div class="field">
            <label>기증자</label>
            <input type="text" name="donor" placeholder="이름" required>
          </div>
          <div class="field">
            <label>기증일</label>
            <input type="date" name="donateDate" value="${todayStr()}" required>
          </div>
        </div>
        <div class="field">
          <label>씨앗에 담긴 지혜 (재배 팁)</label>
          <textarea name="wisdom" placeholder="키우는 방법이나 팁을 적어주세요" required></textarea>
        </div>
        <button class="btn" type="submit" style="width:100%">씨앗 등록하기</button>
      </form>
    </div>`;
  }

  /* ---------------- views: admin ---------------- */
  let adminTab = "pending";
  function renderAdmin() {
    const pending = db.rentals.filter(r => r.status === "pending");
    const rented = db.rentals.filter(r => r.status === "rented");

    return `
    <div class="panel">
      <div class="panel-title"><h2>🛠 관리자 화면</h2></div>
      <div class="tab-bar">
        <button data-action="admin-tab" data-tab="pending" class="${adminTab === "pending" ? "active" : ""}">승인 대기 (${pending.length})</button>
        <button data-action="admin-tab" data-tab="rented" class="${adminTab === "rented" ? "active" : ""}">대여 중 · 반납 처리 (${rented.length})</button>
        <button data-action="admin-tab" data-tab="seeds" class="${adminTab === "seeds" ? "active" : ""}">씨앗 관리</button>
      </div>
      ${adminTab === "pending" ? adminPendingHtml(pending) : ""}
      ${adminTab === "rented" ? adminRentedHtml(rented) : ""}
      ${adminTab === "seeds" ? adminSeedsHtml() : ""}
    </div>`;
  }

  function adminPendingHtml(pending) {
    return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>씨앗</th><th>신청자</th><th>학번</th><th>신청일</th><th>대여기간(일)</th><th>처리</th></tr></thead>
        <tbody>
          ${pending.length ? pending.map(r => {
      const seed = db.seeds.find(s => s.id === r.seedId);
      return `<tr>
              <td>${seed ? esc(seed.name) : "-"}</td>
              <td>${esc(r.renterName)}</td>
              <td>${esc(r.studentId)}</td>
              <td>${fmtDate(r.requestDate)}</td>
              <td><input type="number" min="1" value="14" style="width:64px;padding:5px 8px;border-radius:6px;border:1px solid var(--wood-pale)" id="days-${r.id}"></td>
              <td>
                <button class="btn small" data-action="approve-rental" data-id="${r.id}">승인</button>
                <button class="btn small danger" data-action="reject-rental" data-id="${r.id}">거절</button>
              </td>
            </tr>`;
    }).join("") : `<tr><td colspan="6" class="empty-row">승인 대기 중인 신청이 없어요.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  }

  function adminRentedHtml(rented) {
    return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>씨앗</th><th>대여자</th><th>학번</th><th>대여일</th><th>반납예정일</th><th>상태</th><th>처리</th></tr></thead>
        <tbody>
          ${rented.length ? rented.map(r => {
      const seed = db.seeds.find(s => s.id === r.seedId);
      const overdue = isOverdue(r);
      return `<tr>
              <td>${seed ? esc(seed.name) : "-"}</td>
              <td>${esc(r.renterName)}</td>
              <td>${esc(r.studentId)}</td>
              <td>${fmtDate(r.rentalDate)}</td>
              <td>${fmtDate(r.dueDate)}</td>
              <td>${badgeHtml(r.status, overdue)}</td>
              <td><button class="btn small amber" data-action="return-rental" data-id="${r.id}">반납 처리</button></td>
            </tr>`;
    }).join("") : `<tr><td colspan="7" class="empty-row">현재 대여 중인 씨앗이 없어요.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  }

  function adminSeedsHtml() {
    const rows = db.seeds.map(seed => `
      <tr>
        <td style="font-size:1.4rem">${seed.image ? `<img src="${seed.image}" style="width:34px;height:34px;object-fit:cover;border-radius:6px">` : seed.emoji}</td>
        <td>${esc(seed.name)}</td>
        <td>${esc(seed.donor)}</td>
        <td>${fmtDate(seed.donateDate)}</td>
        <td>${badgeHtml(seedStatus(seed.id))}</td>
        <td><button class="btn small danger" data-action="delete-seed" data-id="${seed.id}">삭제</button></td>
      </tr>`).join("");

    return `
    <div class="flex-between">
      <h3 style="margin:0">등록된 씨앗</h3>
      <a href="#/add-seed" class="btn small">🌱 새 씨앗 등록하기</a>
    </div>
    <p class="hint">모든 회원이 새 씨앗을 등록할 수 있어요. 삭제는 관리자만 할 수 있어요(대여 중/승인 대기인 씨앗은 삭제할 수 없어요).</p>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>이미지</th><th>품종명</th><th>기증자</th><th>기증일</th><th>상태</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty-row">등록된 씨앗이 없어요.</td></tr>`}</tbody>
      </table>
    </div>`;
  }

  async function approveRental(rentalId) {
    const r = db.rentals.find(x => x.id === rentalId);
    if (!r || r.status !== "pending") return;
    const daysInput = document.getElementById("days-" + rentalId);
    const days = daysInput ? Math.max(1, parseInt(daysInput.value, 10) || 14) : 14;
    const rentalDate = todayStr();
    const dueDate = addDays(rentalDate, days);
    await fs.collection("rentals").doc(rentalId).update({ status: "rented", rentalDate, dueDate });
    toast("대여 신청을 승인했어요.");
    guardAndRender();
  }
  async function rejectRental(rentalId) {
    const r = db.rentals.find(x => x.id === rentalId);
    if (!r || r.status !== "pending") return;
    await fs.collection("rentals").doc(rentalId).update({ status: "rejected" });
    toast("대여 신청을 거절했어요.");
    guardAndRender();
  }
  async function returnRental(rentalId) {
    const r = db.rentals.find(x => x.id === rentalId);
    if (!r || r.status !== "rented") return;
    await fs.collection("rentals").doc(rentalId).update({ status: "returned", returnDate: todayStr() });
    toast("반납 처리 완료! 씨앗이 다시 대여 가능해졌어요 🌱");
    guardAndRender();
  }
  async function deleteSeed(seedId) {
    if (seedActiveRental(seedId)) { toast("현재 대여 중이거나 승인 대기 중인 씨앗은 삭제할 수 없어요."); return; }
    if (!confirm("이 씨앗을 삭제할까요? 관련 대여 기록도 함께 삭제됩니다.")) return;
    const relatedRentals = db.rentals.filter(r => r.seedId === seedId);
    const batch = fs.batch();
    batch.delete(fs.collection("seeds").doc(seedId));
    relatedRentals.forEach(r => batch.delete(fs.collection("rentals").doc(r.id)));
    await batch.commit();
    toast("씨앗을 삭제했어요.");
    guardAndRender();
  }
  async function addSeed(data) {
    const ref = await fs.collection("seeds").add({
      name: data.name, emoji: data.emoji || "🌱", image: data.image || "",
      donor: data.donor, donateDate: data.donateDate, wisdom: data.wisdom
    });
    toast("새 씨앗을 등록했어요 🌿");
    navigate("#/seed/" + ref.id);
  }

  /* ---------------- views: dashboard ---------------- */
  function renderDashboard() {
    const rentals = db.rentals;
    const completedLoans = rentals.filter(r => r.status === "rented" || r.status === "returned");
    const totalLoans = completedLoans.length;
    const returnedCount = rentals.filter(r => r.status === "returned").length;
    const rentedCount = rentals.filter(r => r.status === "rented").length;
    const pendingCount = rentals.filter(r => r.status === "pending").length;
    const returnRate = totalLoans ? Math.round((returnedCount / totalLoans) * 100) : 0;

    const countBySeed = {};
    completedLoans.forEach(r => { countBySeed[r.seedId] = (countBySeed[r.seedId] || 0) + 1; });
    const ranking = Object.entries(countBySeed)
      .map(([seedId, count]) => ({ seed: db.seeds.find(s => s.id === seedId), count }))
      .filter(x => x.seed)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const maxCount = ranking.length ? ranking[0].count : 1;
    const medals = ["🥇", "🥈", "🥉", "🌱", "🌱"];

    const donutR = 46, donutC = 2 * Math.PI * donutR;
    const donutOffset = donutC * (1 - returnRate / 100);

    return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-value">${totalLoans}</div>
        <div class="stat-label">이번 학기 총 대여 건수</div>
      </div>
      <div class="stat-card leaf">
        <div class="stat-icon">✅</div>
        <div class="stat-value">${returnRate}%</div>
        <div class="stat-label">반납률</div>
      </div>
      <div class="stat-card amber">
        <div class="stat-icon">🌾</div>
        <div class="stat-value">${rentedCount}</div>
        <div class="stat-label">현재 대여 중</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⏳</div>
        <div class="stat-value">${pendingCount}</div>
        <div class="stat-label">승인 대기 중</div>
      </div>
    </div>

    <div class="section-row">
      <div class="panel">
        <div class="panel-title"><h2>🏆 인기 품종 순위</h2></div>
        ${ranking.length ? `
        <ul class="rank-list">
          ${ranking.map((item, i) => `
            <li class="rank-item">
              <span class="rank-medal">${medals[i]}</span>
              <span class="rank-name">${esc(item.seed.name)}</span>
              <span class="rank-bar-track"><span class="rank-bar-fill" style="width:${(item.count / maxCount) * 100}%"></span></span>
              <span class="rank-count">${item.count}회</span>
            </li>`).join("")}
        </ul>` : emptyState("아직 대여 기록이 없어요.")}
      </div>

      <div class="panel">
        <div class="panel-title"><h2>✅ 반납률</h2></div>
        <div class="donut-wrap">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="${donutR}" fill="none" stroke="#efe0c2" stroke-width="14"/>
            <circle cx="60" cy="60" r="${donutR}" fill="none" stroke="#4c7a44" stroke-width="14"
              stroke-dasharray="${donutC}" stroke-dashoffset="${donutOffset}"
              stroke-linecap="round" transform="rotate(-90 60 60)"/>
            <text x="60" y="66" text-anchor="middle" font-size="22" font-family="Jua" fill="#4a3324">${returnRate}%</text>
          </svg>
          <div class="donut-legend">
            반납 완료 <b>${returnedCount}건</b> / 총 대여·대여중 <b>${totalLoans}건</b><br>
            <span class="muted">반납률 = 반납 완료 ÷ (대여중 + 반납 완료)</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  /* 업로드한 사진을 Firestore 문서 용량(1MB) 안에 들어가도록 축소해요 */
  function resizeImageToDataURL(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
          else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- event delegation ---------------- */
  document.addEventListener("submit", function (e) {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const type = form.getAttribute("data-form");
    const fd = new FormData(form);

    if (type === "login") {
      doLogin(fd.get("name").trim(), fd.get("password"));
    } else if (type === "signup") {
      doSignup(fd.get("name").trim(), fd.get("studentId").trim(), fd.get("password"));
    } else if (type === "add-seed") {
      const fileInput = document.getElementById("newSeedImage");
      const file = fileInput && fileInput.files[0];
      const payload = {
        name: fd.get("name").trim(),
        donor: fd.get("donor").trim(),
        donateDate: fd.get("donateDate"),
        wisdom: fd.get("wisdom").trim(),
        emoji: fd.get("emoji").trim(),
        image: ""
      };
      if (file) {
        resizeImageToDataURL(file, 480, 0.72)
          .then(dataUrl => { payload.image = dataUrl; addSeed(payload); })
          .catch(() => addSeed(payload));
      } else {
        addSeed(payload);
      }
    } else if (type === "save-note") {
      if (noteEditingId) updateRentalNote(noteEditingId, fd.get("note").trim());
    }
  });

  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "newSeedImage") {
      const file = e.target.files[0];
      const preview = document.getElementById("newSeedPreview");
      if (file && preview) {
        const reader = new FileReader();
        reader.onload = () => { preview.innerHTML = `<img src="${reader.result}">`; };
        reader.readAsDataURL(file);
      }
    }
  });

  document.addEventListener("click", function (e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    const id = el.getAttribute("data-id");
    const user = currentUser();

    switch (action) {
      case "logout":
        clearSession(); toast("로그아웃 되었어요."); navigate("#/login"); break;
      case "view-seed":
        navigate("#/seed/" + id); break;
      case "request-rental":
        if (user) requestRental(id, user); break;
      case "admin-tab":
        adminTab = el.getAttribute("data-tab"); guardAndRender(); break;
      case "approve-rental":
        approveRental(id); break;
      case "reject-rental":
        rejectRental(id); break;
      case "return-rental":
        returnRental(id); break;
      case "delete-seed":
        deleteSeed(id); break;
      case "edit-note":
        noteEditingId = id; guardAndRender(); break;
      case "cancel-note":
        noteEditingId = null; guardAndRender(); break;
    }
  });

  window.addEventListener("hashchange", guardAndRender);
  window.addEventListener("DOMContentLoaded", boot);
})();
