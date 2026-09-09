const FORCE_RESET = false;
if (FORCE_RESET) {
    localStorage.clear();
}

// ========================================
// Google Apps Script API
// ========================================
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxfwsvnTbewcHwfBvblpE9UoyqvBAqpzyBzieCTVQ9mevnpmtc_OJgJ9VeFG14FgrUh/exec";

const STORAGE_KEYS = {
  profile: "timetable.profile",
  baseTimetables: "timetable.baseTimetables",
  classCourses: "timetable.classCourses",
  changes: "timetable.changes",
  notifications: "timetable.notifications",
  managers: "timetable.managers"
};

const state = {
  view: "student",
  adminMode: "notice",
  authenticated: false,
  adminProfile: null,
 adminProfiles: null,
  profile: {
    grade: "2",
    classNo: "4",
    course: "humanities"
  },
  adminDay: "月",
  data: {
    periods: [],
    courses: {},
    classes: [],
    baseTimetables: {},
    classCourses: {},
    changes: [],
    notifications: [],
    managers: [],
    gasClassDataCache: {},
    gasAdminTimetableCache: {},
  }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadInitialData();
  bindEvents();
  await setupAuth();
  restoreProfile();
  updateTargetSummary();
  renderAll();
}

async function setupAuth() {
  const checkAdminProfile = async (session) => {
    state.authenticated = !!session;
    state.adminProfile = null;

    if (!session) {
      console.log("未認証");
      return false;
    }

    console.log("認証済み:", session.user.email);

    const { data, error } = await window.supabaseClient
      .from("admin_profiles")
      .select("user_id, display_name, role")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) {
      console.error("管理者プロフィール取得失敗:", error);
      return false;
    }

    if (!data) {
      console.log("管理者プロフィールなし");
      return false;
    }

    state.adminProfile = data;

    console.log("管理者プロフィール:", data);

    return data.role === "admin";
  };

  const {
    data: { session },
    error
  } = await window.supabaseClient.auth.getSession();

  if (error) {
    console.error("認証状態取得失敗:", error);
    return;
  }

  const isAdmin = await checkAdminProfile(session);

  if (isAdmin && state.view === "student") {
    // ここでは自動的に管理画面へ飛ばさず、
    // 管理者アイコンを押したときに入れるようにする
    console.log("管理者として認証されています");
  }

  window.supabaseClient.auth.onAuthStateChange(async (event, newSession) => {
    const isAdmin = await checkAdminProfile(newSession);

    if (!newSession) {
      setView("student");
      return;
    }

    if (event === "SIGNED_IN") {
      console.log(
        isAdmin
          ? "管理者としてログインしました"
          : "一般ユーザーとしてログインしました"
      );
    }
  });
}

async function loadInitialData() {
  const timetableData = window.TIMETABLE_DATA || {};

  state.data.periods = timetableData.periods || [1, 2, 3, 4, 5, 6, 7];
  state.data.courses = timetableData.courses || {};
  state.data.classCourses = readStored(
    STORAGE_KEYS.classCourses,
    window.CLASS_COURSE_OVERRIDES || {}
  );
  state.data.classes = applyClassCourseOverrides(timetableData.classes || []);
  state.data.baseTimetables = readStored(
    STORAGE_KEYS.baseTimetables,
    timetableData.baseTimetables || {}
  );
  state.data.changes = readStored(
    STORAGE_KEYS.changes,
    window.TIMETABLE_CHANGES || []
  );
  // お知らせはSupabaseから取得
  const { data, error } = await window.supabaseClient
    .from("notifications")
    .select("*");
  if (error) {
    console.error("notifications取得失敗:", error);
    // Supabase取得失敗時は一時的にlocalStorageを使用
    state.data.notifications = readStored(
      STORAGE_KEYS.notifications,
      window.NOTIFICATIONS || []
    );
  } else {
    console.log("notifications取得成功:", data);
    state.data.notifications = data || [];
  }
  state.data.managers = normalizeManagers(
    readStored(STORAGE_KEYS.managers, window.MANAGERS || [])
  );
}

function isNotificationActive(notification) {
  const now = new Date();
  const start = new Date(notification.display_start);
  const end = new Date(notification.display_end);
  return now >= start && now <= end;
}

function formatNotificationRange(notification) {
  const start = new Date(notification.display_start);
  const end = new Date(notification.display_end);
  const startText = `${start.getMonth() + 1}/${start.getDate()}`;
  const endText = `${end.getMonth() + 1}/${end.getDate()}`;
  if (startText === endText) {
    return startText;
  }
  return `${startText}〜${endText}`;
}

function bindEvents() {
$$("[data-view-button]").forEach((button) => {
  button.addEventListener("click", async () => {
    const targetView = button.dataset.viewButton;

    // 管理者ログインアイコン
    if (targetView === "login") {
      const {
        data: { session },
        error
      } = await window.supabaseClient.auth.getSession();

      if (error) {
        console.error("認証状態の確認に失敗:", error);
        return;
      }

      if (!session) {
        handleGoogleLogin();
        return;
      }

      if (state.adminProfile?.role === "admin") {
        setView("quick-admin");
      } else {
        console.log("管理者権限がありません");
        setView("student");
      }

      return;
    }

    // 浅い管理画面・詳細管理画面
    if (
      targetView === "quick-admin" ||
      targetView === "deep-admin"
    ) {
      if (
        state.authenticated &&
        state.adminProfile?.role === "admin"
      ) {
        setView(targetView);
      } else if (!state.authenticated) {
        handleGoogleLogin();
      } else {
        alert("管理者権限がありません。");
        setView("student");
      }

      return;
    }

    setView(targetView);
  });
});
  $("#logout-button")?.addEventListener("click", handleLogout);
  $("#show-admin-profiles")?.addEventListener("click", loadAdminProfiles);

  const studentDaySelect = $("#student-day");

  if (studentDaySelect) {
    const dayNames = [
      "日",
      "月",
      "火",
      "水",
      "木",
      "金",
      "土"
    ];

    const today = new Date();
    const todayName = dayNames[today.getDay()];

    if (["月", "火", "水", "木", "金"].includes(todayName)) {
      studentDaySelect.value = todayName;
    }
  }
    
  $("#student-day")?.addEventListener("change", () => {
    renderStudent();
  });
    
  ["#student-grade", "#student-class", "#student-course"].forEach((selector) => {
    const element = $(selector);
    if (!element) return;
    element.addEventListener("change", () => {
      state.profile = {
        grade: $("#student-grade").value,
        classNo: $("#student-class").value,
        course: $("#student-course").value
      };
      ensureValidStudentProfile();
      saveStored(STORAGE_KEYS.profile, state.profile);
      renderStudent();
    });
  });

  $("#admin-grade")?.addEventListener("change", renderQuickAdmin);
  $("#admin-day")?.addEventListener("change", () => {
    state.adminDay = $("#admin-day").value;
    renderQuickAdmin();
  });

  $("#deep-admin-grade")?.addEventListener("change", renderDeepAdmin);

  $$(".segmented-control [data-admin-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.adminMode = button.dataset.adminMode;
      $$(".segmented-control [data-admin-mode]").forEach((modeButton) => {
        modeButton.setAttribute("aria-selected", String(modeButton === button));
      });
      renderAdminPosts();
    });
  });

  $(".post-form")?.addEventListener("submit", handlePostSubmit);
  $("#google-login-button")?.addEventListener("click", handleGoogleLogin);
  $$(".post-form input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", updateTargetSummary);
  });
  $(".manager-form")?.addEventListener("submit", handleManagerSubmit);
}

async function loadAdminProfiles() {
  const button = $("#show-admin-profiles");
  const list = $("#admin-profile-list");

  if (!button || !list) return;

  if (state.adminProfiles !== null) {
    return;
  }

  button.disabled = true;
  button.textContent = "読み込み中…";

  const { data, error } = await window.supabaseClient
    .from("admin_profiles")
    .select("display_name, role");

  if (error) {
    console.error("管理者一覧取得失敗:", error);
    button.disabled = false;
    button.textContent = "管理者一覧を見る";
    alert("管理者一覧の取得に失敗しました。");
    return;
  }

  console.log("管理者一覧取得成功:", data);

  state.adminProfiles = data || [];

  list.replaceChildren();

  if (!state.adminProfiles.length) {
    list.append(createEmptyState("登録されている管理者はいません。"));
  } else {
    state.adminProfiles.forEach((profile) => {
      const item = document.createElement("li");

      const role = document.createElement("span");
      role.textContent = profile.role || "role未設定";

      const separator = document.createElement("span");
      separator.textContent = " : ";

      const name = document.createElement("span");
      name.textContent = profile.display_name || "表示名未設定";

      item.append(role, separator, name);
      list.append(item);
    });
  }

  list.hidden = false;
  button.remove();
}

async function handleGoogleLogin() {
  const message = $("#login-message");

  if (message) {
    message.textContent = "Googleログイン画面を開いています……";
  }

  const { error } = await window.supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) {
    console.error("Googleログイン失敗:", error);

    if (message) {
      message.textContent = "ログインに失敗しました。";
    }
  }
}

function restoreProfile() {
  state.profile = readStored(STORAGE_KEYS.profile, state.profile);
  setSelectValue("#student-grade", state.profile.grade);
  setSelectValue("#student-class", state.profile.classNo);
  setSelectValue("#student-course", state.profile.course);
  ensureValidStudentProfile();
}

function renderAll() {
  setView(state.view);
  renderStudent();
  renderQuickAdmin();
  renderDeepAdmin();
}

function setView(viewName) {
  // 管理画面は認証済みユーザーだけが入れる
  if (
    (viewName === "quick-admin" || viewName === "deep-admin") &&
    !state.authenticated
  ) {
    viewName = "login";
  }

  state.view = viewName;
  $(".app-shell")?.setAttribute("data-view", viewName);

  $$("[data-screen]").forEach((screen) => {
    screen.hidden = screen.dataset.screen !== viewName;
  });

  $$("[data-view-button]").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.viewButton === viewName
    );
  });
}

async function renderStudent() {

    ensureValidStudentProfile();

  setSelectValue(
    "#student-grade",
    state.profile.grade
  );

  setSelectValue(
    "#student-class",
    state.profile.classNo
  );

  setSelectValue(
    "#student-course",
    state.profile.course
  );


  const profileControls =
    $("#student-profile-controls");

  const timetablePanel =
    $(".timetable-panel");


  profileControls?.setAttribute(
    "data-course",
    state.profile.course
  );

  timetablePanel?.setAttribute(
    "data-course",
    state.profile.course
  );


  // ========================================
  // GASから現在のクラスデータを取得
  // ========================================

  const profileKey =
    `${state.profile.grade}-${state.profile.classNo}-${state.profile.course}`;

  const cachedData =
    state.data.gasClassDataCache[profileKey];

  const gasData = cachedData
    || await fetchGasClassData(state.profile);

  console.log("gasData:", gasData);
  console.log("state.data.gasClassData:", state.data.gasClassData);
  // ========================================
  // GAS取得失敗
  // ========================================

  if (!gasData) {

    $$(".period-subject").forEach(
      (subjectNode) => {

        subjectNode.textContent = "";

        subjectNode
          .closest("li")
          ?.classList.remove("is-changed");

      }
    );

    renderStudentNotices();

    return;
  }

  if (!cachedData) {
    state.data.gasClassDataCache[profileKey] = gasData;
  }
  // ========================================
  // 今日の曜日を取得 2日以上先なら警告
  // ========================================
 
  const selectedDay =
    document.getElementById("student-day")?.value || "月";
  const daySelect = document.getElementById("student-day");

  if (daySelect) {
    const dayNumber = {
      "月": 1,
      "火": 2,
      "水": 3,
      "木": 4,
      "金": 5
    };

    const todayNumber = new Date().getDay();
    const selectedNumber = dayNumber[selectedDay];

    let daysAhead =
      (selectedNumber - todayNumber + 7) % 7;

   // 土日は月曜日を次の登校日として扱う
    if (todayNumber === 6) {
      daysAhead = selectedNumber === 1 ? 2 : daysAhead;
    }

    if (todayNumber === 0) {
      daysAhead = selectedNumber === 1 ? 1 : daysAhead;
    }

    const dayChip = daySelect.closest(".profile-chip--day");

    if (dayChip) {
      dayChip.classList.remove(
        "day-is-today",
        "day-is-tomorrow",
        "day-is-future"
      );

      if (daysAhead === 0) {
        dayChip.classList.add("day-is-today");
      } else if (daysAhead === 1) {
        dayChip.classList.add("day-is-tomorrow");
      } else {
        dayChip.classList.add("day-is-future");
      }
    }

  }
  const todayTimetable =
    gasData.timetable?.[selectedDay] || [];
  
  const subjectMap = {};
  
  // ========================================
  // subjectsを検索しやすい形にする
  // ========================================

  (gasData.subjects || []).forEach(
    (subject) => {

      subjectMap[subject.subject_id] =
        subject;

    }
  );


  // ========================================
  // 各時限を表示
  // ========================================

  $$(".period-subject").forEach(
    (subjectNode) => {

      const period =
        Number(subjectNode.dataset.period);


      const timetableItem =
        todayTimetable.find(
          (item) =>
            Number(item.period) === period
        );


      if (!timetableItem) {

        subjectNode.textContent = "";

        subjectNode
          .closest("li")
          ?.classList.remove("is-changed");

        return;
      }


      const subjectId =
        timetableItem.subject_id;


      let displayName = "";


      // ====================================
      // jointの場合
      // ====================================

      if (timetableItem.joint) {

        displayName =
          timetableItem.joint.joint_name || "";

      }

      // ====================================
      // 通常授業の場合
      // ====================================

      else {

        const subject =
          subjectMap[subjectId];

        displayName =
          subject?.subject_name || subjectId || "";

      }


      subjectNode.textContent =
        displayName;


      // ====================================
      // subject_changeがあった場合
      // ====================================

      subjectNode
        .closest("li")
        ?.classList.toggle(
          "is-changed",
          Boolean(
            timetableItem.subject_change
          )
        );
    }
  );

  renderStudentNotices();
}

function renderStudentNotices() {
  const container = $("#student-notices");
  if (!container) return;

  const notices = state.data.notifications.filter((notice) => {
  return notice.kind === "notice"
    && isNotificationActive(notice)
    && matchesTargets(notice.targets, state.profile);
  });

  container.replaceChildren();

  if (!notices.length) {
    container.append(createEmptyState("表示できるお知らせはありません。"));
    return;
  }

  notices.forEach((notice) => {
    const card = document.createElement("article");
    card.className = "notice-card";
    card.innerHTML = `
      <h3>${escapeHtml(notice.title)}｜${escapeHtml(notice.range || "")}</h3>
      <p>${escapeHtml(notice.body)}</p>
    `;
    container.append(card);
  });
}

async function renderQuickAdmin() {
  // 浅い管理画面を表示している管理者以外ではGASを呼ばない
  if (
    state.view !== "quick-admin" ||
    !state.authenticated ||
    state.adminProfile?.role !== "admin"
  ) {
    return;
  }

  const grade =
    $("#admin-grade")?.value || "2";

  const matrix =
    $("#change-matrix");

  if (!matrix) return;

  // 学年単位のGASデータを取得
  const gasData =
    await fetchGasAdminTimetable(grade);

  if (!gasData) {
    matrix.replaceChildren(
      createEmptyState(
        "時間割を取得できませんでした。"
      )
    );
    return;
  }

  // GASから取得したクラス一覧を使用
  const classes =
    gasData.classes || [];

  matrix.style.setProperty(
    "--class-count",
    classes.length
  );

  matrix.replaceChildren();

  // ヘッダー
  appendMatrixHeader(
    matrix,
    classes.map(convertGasClassForDisplay)
  );

  // 現在選択されている曜日
  const day =
    state.adminDay || "月";

  // GASの曜日データ
  const dayData =
    gasData.timetable?.[day] || {};

  // 1～7限
  state.data.periods.forEach((period) => {
    matrix.append(
      createCell(
        `${period}限`,
        "div",
        "matrix-cell matrix-cell--period"
      )
    );

    classes.forEach((gasClass) => {
      const classId =
        String(gasClass.class_id);

      const classItem =
        convertGasClassForDisplay(gasClass);

      const timetable =
        dayData[classId] || [];

      const timetableItem =
        timetable.find(
          (item) =>
            Number(item.period) ===
            Number(period)
        );

      const subjectId =
        timetableItem?.subject_id || "";

      const displayName =
        getGasAdminSubjectDisplayName(
          gasData,
          subjectId,
          timetableItem
        );

      const isChanged =
        Boolean(
          timetableItem?.subject_change
        );

      const cell =
        createCell(
          displayName,
          "button",
          `matrix-cell ${
            getSubjectClass(classItem.course)
          }${isChanged ? " is-changed" : ""}`
        );

      cell.type = "button";

      cell.dataset.classId =
        classId;

      cell.dataset.period =
        String(period);

      cell.addEventListener(
        "click",
        () => {
          editChange(
            classItem,
            period,
            null
          );
        }
      );
      matrix.append(cell);
    });
  });
  renderAdminPosts();
}

function renderAdminPosts() {
  const container = $(".admin-post-list");
  if (!container) return;

  const posts = state.data.notifications.filter((post) => post.kind === state.adminMode);
  container.replaceChildren();

  if (!posts.length) {
    container.append(createEmptyState("投稿はまだありません。"));
    return;
  }

  posts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "admin-post-card";
    card.innerHTML = `
      <button type="button" aria-label="この投稿を削除">×</button>
      <p>${escapeHtml(post.title)}｜${escapeHtml(formatNotificationRange(post))}<br>${escapeHtml(post.body)}</p>
      <small>${formatTargets(post.targets)}</small>
    `;
    $("button", card).addEventListener("click", () => deleteNotification(post.id));
    container.append(card);
  });
}

function renderDeepAdmin() {
  const grade = $("#deep-admin-grade")?.value || "2";
  const classes = getClassesByGrade(grade);
  const matrix = $("#base-matrix");
  if (!matrix) return;

  matrix.style.setProperty("--class-count", classes.length);
  matrix.replaceChildren();
  appendMatrixHeader(matrix, classes, true);

  state.data.periods.forEach((period) => {
    matrix.append(createCell(`${period}限`, "div", "matrix-cell matrix-cell--period"));

    classes.forEach((classItem) => {
      const base = state.data.baseTimetables[classItem.id] || [];
      const subject = base[period - 1] || "";
      const cell = createCell(subject || "教科", "button", `matrix-cell ${getSubjectClass(classItem.course)}`);
      cell.type = "button";
      cell.dataset.classId = classItem.id;
      cell.dataset.period = String(period);
      cell.addEventListener("click", () => editBaseSubject(classItem, period, subject));
      matrix.append(cell);
    });
  });

  renderManagers();
}

function renderManagers() {
  const list = $(".manager-list");
  if (!list) return;
  list.replaceChildren();

  state.data.managers.forEach((manager) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <button type="button" aria-label="削除">×</button>
      <span>${escapeHtml(manager.id)}</span>
    `;
    item.title = manager.email;
    $("button", item).addEventListener("click", () => deleteManager(manager.id));
    list.append(item);
  });
}

function appendMatrixHeader(matrix, classes, editableCourses = false) {
  matrix.append(createCell("", "div", "matrix-cell matrix-cell--corner"));

  classes.forEach((classItem) => {
    const courseLabel = state.data.courses[classItem.course] || "";
    const label = editableCourses
      ? `<span>${escapeHtml(classItem.label)}</span><button class="course-edit-button" type="button" data-class-id="${escapeHtml(classItem.id)}">${escapeHtml(courseLabel)}</button>`
      : `${escapeHtml(classItem.label)}<br>${escapeHtml(courseLabel)}`;
    const cell = createCell(label, "div", `matrix-cell ${getSubjectClass(classItem.course)}`, true);
    if (editableCourses) {
      $(".course-edit-button", cell)?.addEventListener("click", (event) => {
        event.stopPropagation();
        editClassCourse(classItem);
      });
    }
    matrix.append(cell);
  });
}

function editChange(classItem, period, existingChange) {
  const current = existingChange?.subject || "";
  const subject = prompt(`${classItem.label} ${state.data.courses[classItem.course]} ${period}限の変更`, current);
  if (subject === null) return;

  const trimmed = subject.trim();
  state.data.changes = state.data.changes.filter((change) => {
    return !(change.date === state.adminDate && change.classId === classItem.id && Number(change.period) === period);
  });

  if (trimmed) {
    state.data.changes.push({
      id: `change-${Date.now()}`,
      date: state.adminDate,
      classId: classItem.id,
      period,
      subject: trimmed,
      note: "画面から追加"
    });
    addChangeHistory(classItem, period, trimmed);
  }

  saveStored(STORAGE_KEYS.changes, state.data.changes);
  renderQuickAdmin();
  renderStudent();
}

function editClassCourse(classItem) {
  const entries = Object.entries(state.data.courses);
  const menu = entries.map(([value, label], index) => `${index + 1}: ${label}`).join("\n");
  const currentIndex = Math.max(0, entries.findIndex(([value]) => value === classItem.course));
  const answer = prompt(`${classItem.label} の文理を選択してください\n${menu}`, String(currentIndex + 1));
  if (answer === null) return;

  const selected = entries[Number(answer) - 1];
  if (!selected) {
    alert("一覧の番号で選択してください。");
    return;
  }

  state.data.classCourses[classItem.id] = selected[0];
  saveStored(STORAGE_KEYS.classCourses, state.data.classCourses);
  state.data.classes = applyClassCourseOverrides(state.data.classes);
  renderDeepAdmin();
  renderQuickAdmin();
  renderStudent();
}

function editBaseSubject(classItem, period, currentSubject) {
  const subject = prompt(`${classItem.label} ${state.data.courses[classItem.course]} ${period}限の基本教科`, currentSubject || "");
  if (subject === null) return;
  const timetable = [...(state.data.baseTimetables[classItem.id] || Array(7).fill(""))];
  timetable[period - 1] = subject.trim();
  state.data.baseTimetables[classItem.id] = timetable;
  saveStored(STORAGE_KEYS.baseTimetables, state.data.baseTimetables);
  renderDeepAdmin();
  renderStudent();
}

async function handlePostSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;

  const title = form.elements["post-title"].value.trim();
  const body = form.elements["post-body"].value.trim();
  const startDate = form.elements["post-start"].value;
  const endDate = form.elements["post-end"].value;
  // 必須項目の確認
  if (!title || !body || !startDate || !endDate) {
    alert("タイトル・本文・掲載開始日・掲載終了日を入力してください。");
    return;
  }
  // 開始日と終了日の前後関係を確認
  if (endDate < startDate) {
    alert("掲載終了日は掲載開始日以降の日付にしてください。");
    return;
  }
  // 日付をSupabase保存用の日時に変換
  const displayStart = `${startDate}T00:00:00+09:00`;
  const displayEnd = `${endDate}T23:59:59+09:00`;
  const notification = {
    id: `post-${Date.now()}`,
    kind: state.adminMode,
    title,
    display_start: displayStart,
    display_end: displayEnd,
    body,
    targets: {
      grades: getCheckedValues(form, "target-grade"),
      classes: getCheckedValues(form, "target-class"),
      courses: getCheckedValues(form, "target-course")
    }
  };
  // Supabaseへ保存
  const { data, error } = await window.supabaseClient
    .from("notifications")
    .insert([notification])
    .select();
  if (error) {
    console.error("お知らせ投稿失敗:", error);
    alert("お知らせの投稿に失敗しました。");
    return;
  }
  console.log("お知らせ投稿成功:", data);
  // Supabaseに保存されたデータを画面側にも反映
  state.data.notifications.unshift(data[0]);
  // フォームを初期化
  form.reset();
  // 対象設定を初期状態に戻す
  $("input[name='target-grade'][value='2']", form).checked = true;
  $("input[name='target-class'][value='all']", form).checked = true;
  $("input[name='target-course'][value='all']", form).checked = true;
  updateTargetSummary();
  renderAdminPosts();
  renderStudentNotices();
}

function handleManagerSubmit(event) {
  event.preventDefault();
  const input = event.currentTarget.elements["new-manager-email"];
  const email = input.value.trim();

  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("メールアドレスの形式を確認してください。");
    return;
  }
  if (state.data.managers.some((manager) => manager.email === email)) {
    alert("同じメールアドレスがすでに登録されています。");
    return;
  }

  state.data.managers.push({ id: createManagerId(), email });
  saveStored(STORAGE_KEYS.managers, state.data.managers);
  input.value = "";
  renderManagers();
}

function deleteNotification(id) {
  state.data.notifications = state.data.notifications.filter((post) => post.id !== id);
  saveStored(STORAGE_KEYS.notifications, state.data.notifications);
  renderAdminPosts();
  renderStudentNotices();
}

function deleteManager(id) {
  state.data.managers = state.data.managers.filter((manager) => manager.id !== id);
  saveStored(STORAGE_KEYS.managers, state.data.managers);
  renderManagers();
}

function ensureValidStudentProfile() {
  let classItem = getClassByProfile(state.profile);

  if (!classItem) {
    classItem = state.data.classes.find((item) => item.grade === state.profile.grade && item.classNo === state.profile.classNo);
  }

  if (!classItem) {
    classItem = state.data.classes.find((item) => item.grade === state.profile.grade) || state.data.classes[0];
  }

  if (!classItem) return;

  state.profile = {
    grade: classItem.grade,
    classNo: classItem.classNo,
    course: classItem.course
  };
}

function getMergedTimetable(classId, date) {
  const subjects = [...(state.data.baseTimetables[classId] || Array(7).fill(""))];
  getChangesForClass(classId, date).forEach((change) => {
    subjects[Number(change.period) - 1] = change.subject;
  });
  return subjects;
}

function getChangesForClass(classId, date) {
  return state.data.changes.filter((change) => change.classId === classId && change.date === date);
}

function findChange(classId, period, date) {
  return state.data.changes.find((change) => {
    return change.classId === classId && change.date === date && Number(change.period) === Number(period);
  });
}

function getClassId(profile) {
  return getClassByProfile(profile)?.id || "";
}

function getClassByProfile(profile) {
  return state.data.classes.find((item) => {
    return item.grade === profile.grade && item.classNo === profile.classNo && item.course === profile.course;
  });
}

function getClassesByGrade(grade) {
  return state.data.classes.filter((item) => item.grade === String(grade));
}

function matchesTargets(targets = {}, profile) {
  return targetMatches(targets.grades, profile.grade)
    && targetMatches(targets.classes, profile.classNo)
    && targetMatches(targets.courses, profile.course);
}

function targetMatches(values = ["all"], currentValue) {
  return values.includes("all") || values.includes(String(currentValue));
}

function getCheckedValues(form, name) {
  const values = $$(`input[name='${name}']:checked`, form).map((input) => input.value);
  return values.length ? values : ["all"];
}

function formatTargets(targets = {}) {
  return `[${(targets.grades || ["all"]).join(",")}]年`
    + `[${(targets.classes || ["all"]).join(",")}]組 `
    + `文理:[${(targets.courses || ["all"]).map((course) => state.data.courses[course] || "全").join(",")}]`;
}

function getSubjectClass(course) {
  if (course === "science" || course === "explore-science") return "subject-science";
  if (course === "agriculture") return "subject-agriculture";
  if (course === "welfare") return "subject-welfare";
  return "subject-humanities";
}

function applyClassCourseOverrides(classes) {
  return classes.map((classItem) => ({
    ...classItem,
    course: state.data.classCourses[classItem.id] || classItem.course
  }));
}

function normalizeManagers(managers) {
  return managers.map((manager) => {
    if (typeof manager === "string") {
      return { id: createManagerId(), email: manager };
    }
    return manager;
  });
}

function createManagerId() {
  return `mgr-${Math.random().toString(36).slice(2, 8)}`;
}

function addChangeHistory(classItem, period, subject) {
  state.data.notifications.unshift({
    id: `history-${Date.now()}`,
    kind: "history",
    title: "時間割変更",
    range: formatDateForDisplay(state.adminDate),
    body: `${classItem.label} ${state.data.courses[classItem.course] || ""} ${period}限を「${subject}」に変更しました。`,
    teacherId: "local-admin",
    targets: {
      grades: [classItem.grade],
      classes: [classItem.classNo],
      courses: [classItem.course]
    }
  });
  saveStored(STORAGE_KEYS.notifications, state.data.notifications);
}

function updateTargetSummary() {
  const form = $(".post-form");
  const summary = $("#target-summary");
  if (!form || !summary) return;

  const grades = getCheckedValues(form, "target-grade").map((value) => value === "all" ? "全学年" : `${value}年`);
  const classes = getCheckedValues(form, "target-class").map((value) => value === "all" ? "全組" : `${value}組`);
  const courses = getCheckedValues(form, "target-course").map((value) => value === "all" ? "全" : state.data.courses[value] || value);
  summary.textContent = `対象: ${grades.join(",")} / ${classes.join(",")} / ${courses.join(",")}`;
}

function formatDateForDisplay(dateText) {
  const [, month, day] = dateText.split("-");
  return `${month}/${day}`;
}

function createCell(content, tagName = "div", className = "matrix-cell", allowHtml = false) {
  const cell = document.createElement(tagName);
  cell.className = className;
  if (allowHtml) {
    cell.innerHTML = content;
  } else {
    cell.textContent = content;
  }
  return cell;
}

function createEmptyState(message) {
  const element = document.createElement("p");
  element.className = "empty-state";
  element.textContent = message;
  return element;
}

function setSelectValue(selector, value) {
  const select = $(selector);
  if (select) select.value = value;
}

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function saveStored(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ========================================
// GASからクラスのデータを取得
// ========================================
async function fetchGasClassData(profile) {
  try {
    const params = new URLSearchParams({
      grade: String(profile.grade),
      class_no: String(profile.classNo),
      course: String(profile.course)
    });

    const url = `${GAS_API_URL}?${params.toString()}`;

    console.log("GAS request URL:", url);

    const response = await fetch(url);

    console.log("GAS response status:", response.status);

    if (!response.ok) {
      throw new Error(`GAS request failed: ${response.status}`);
    }

    const result = await response.json();

    console.log("GAS response JSON:", result);

    if (!result.success) {
      throw new Error(result.error || "GASからデータを取得できませんでした");
    }

    return result.data;

  } catch (error) {
    console.error("fetchGasClassData error:", error);
    return null;
  }
}

// ========================================
// GASから浅い管理画面用の時間割を取得
// 学年単位で月～金をまとめて取得
// ========================================
async function fetchGasAdminTimetable(grade) {
  const cacheKey =
    String(grade);

  // ブラウザ側キャッシュ
  const cached =
    state.data.gasAdminTimetableCache[
      cacheKey
    ];

  if (cached) {
    console.log(
      "浅い管理画面：ブラウザキャッシュ使用:",
      cacheKey
    );

    return cached;
  }

  try {
    const params =
      new URLSearchParams({
        admin: "quick",
        grade: String(grade)
      });

    const url =
      `${GAS_API_URL}?${params.toString()}`;

    console.log(
      "浅い管理画面GAS request:",
      url
    );

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        `GAS request failed: ${response.status}`
      );
    }

    const result =
      await response.json();

    console.log(
      "浅い管理画面GAS response:",
      result
    );

    if (!result.success) {
      throw new Error(
        result.error ||
        "GASから時間割を取得できませんでした"
      );
    }

    // 学年単位でキャッシュ
    state.data.gasAdminTimetableCache[
      cacheKey
    ] = result.data;

    return result.data;

  } catch (error) {
    console.error(
      "fetchGasAdminTimetable error:",
      error
    );

    return null;
  }
}

// ========================================
// GASのclass情報を画面表示用に変換
// ========================================
function convertGasClassForDisplay(gasClass) {
  const courseMap = {
    "": "none",
    "文系": "humanities",
    "理系": "science",
    "探文": "explore-humanities",
    "探理": "explore-science",
    "農": "agriculture",
    "福": "welfare"
  };

  const course =
    courseMap[
      String(gasClass.course || "").trim()
    ] || "none";

  return {
    id: String(gasClass.class_id),
    grade: String(gasClass.grade),
    classNo: String(gasClass.class_no),
    course,
    label:
      `${gasClass.grade}${gasClass.class_no}H`
  };
}

// ========================================
// GASのsubject_idから表示名を取得
// jointにも対応
// ========================================
function getGasAdminSubjectDisplayName(
  gasData,
  subjectId,
  timetableItem
) {
  if (!subjectId) {
    return "";
  }

  // joint授業
  if (timetableItem?.joint) {
    return (
      timetableItem.joint.joint_name ||
      subjectId
    );
  }

  // 通常授業
  const subject =
    (gasData.subjects || []).find(
      (item) =>
        String(item.subject_id) ===
        String(subjectId)
    );

  return (
    subject?.subject_name ||
    subjectId
  );
}
