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
  deepAdminDay: "月",
  data: {
    periods: [],
    courses: {},
    classes: [],
    baseTimetables: {},
    classCourses: {},
    changes: [],
    notifications: [],
    managers: [],
    gasClassOptionsCache: {},
    gasAdminTimetableCache: {},
    gasAdminConflictPairs: {},
    gasAdminTimetableConflicts: {},
    gasAdminConflictInitialized: false,
    gasAllSubjectsCache: null,
    gasAllSubjectsPromise : null,
    gasAllAdminTimetablesPromise : null,
    gasTeacherTimetableCache: {},
    gasAdminTimetablePromises: {}
  }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// ========================================
// 画面上部に一時的な通知を表示
// alert() の代わりに使用
// ========================================
function showToast(
  message,
  duration = 3500,
  type = "normal"
) {
  const toast = document.createElement("div");

  toast.className = "app-toast";
  toast.textContent = message;

  const backgroundColor =
    type === "error"
      ? "#d00000"
      : "#333";

  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translate(-50%, -20px);
    z-index: 99999;

    max-width: min(90vw, 600px);
    padding: 12px 20px;

    background: ${backgroundColor};
    color: #fff;

    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);

    font-size: 0.95rem;
    line-height: 1.5;
    white-space: pre-line;
    text-align: center;

    opacity: 0;
    transition:
      opacity 0.2s ease,
      transform 0.2s ease;

    pointer-events: none;
  `;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform =
      "translate(-50%, 0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform =
      "translate(-50%, -20px)";

    setTimeout(() => {
      toast.remove();
    }, 200);
  }, duration);
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    await loadInitialData();
    bindEvents();
    await setupAuth();
    restoreProfile();
    updateTargetSummary();
    renderAll();

  } catch (error) {

    console.error(
      "初期読み込みエラー:",
      error
    );

    showToast(
      "ページの読み込みに失敗しました。"
    );

    document.body.appendChild(
      createLoadErrorState(
        "ページを読み込めませんでした。"
      )
    );
  }
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

      showToast(
        "管理者プロフィールの取得に失敗しました。",
        5000,
        "error"
      );  
      return false;
    }

    if (!data) {
      console.log("管理者プロフィールなし");
      return false;
    }
    
    state.adminProfile = data;

    console.log("管理者プロフィール:", data);

    return data.role === "quick" || data.role === "deep";
  };

  const {
    data: { session },
    error
  } = await window.supabaseClient.auth.getSession();

  if (error) {
    console.error("認証状態取得失敗:", error);
        
    showToast(
      "認証状態の確認取得に失敗しました。",
      5000,
      "error"
      );  
    
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
    showToast(
      "お知らせ・変更履歴 の取得に失敗しました。",
      5000,
      "error"
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

      console.log("クリックされたボタン:", button);
      console.log("targetView:", targetView);

      // 管理者ログインアイコン
      if (targetView === "login") {
        const {
          data: { session },
          error
        } = await window.supabaseClient.auth.getSession();

        if (error) {
          console.error("認証状態の確認失敗:", error);
          showToast(
            "認証状態の確認に失敗しました。",
            5000,
            "error"
            );  
          return;
        }

        if (!session) {
          handleGoogleLogin();
          return;
        }
  
        if (
          state.adminProfile?.role === "quick" ||
          state.adminProfile?.role === "deep"
        ) {
          setView("quick-admin");
        
          console.log("浅い管理画面：先読み開始");
        
          fetchAllGasSubjects();
          fetchAllAdminTimetables();
        
          renderQuickAdmin();
        }else if(
          state.adminProfile?.role === "user"
        ) {
          showToast("あなたの権限では、管理画面に入れません。\n管理者登録を再度行ってください")
        }else {
                
          //モーダル
          const userId = session.user.id;

          const modal = document.createElement("div");
          modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            padding: 20px;
          `;

          const dialog = document.createElement("div");
          dialog.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 24px;
            width: min(420px, 100%);
            box-sizing: border-box;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
          `;

          dialog.innerHTML = `
            <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 16px;">
              管理者として登録されていません。
            </div>

            <div style="margin-bottom: 12px; line-height: 1.6;">
              下記のユーザーIDを用いて、他の管理者に管理者登録してもらってください。
            </div>
 
            <div style="margin-bottom: 6px; font-weight: bold;">
              あなたのユーザーID：
            </div>
 
            <input
              type="text"
              value="${userId}"
              readonly
              style="
                width: 100%;
                box-sizing: border-box;
                padding: 10px;
                border: 1px solid #ccc;
                border-radius: 6px;
                font-size: 0.9rem;
                margin-bottom: 16px;
              "
            >

            <button
              id="copy-user-id"
              type="button"
              style="
                display: block;
                margin: 0 auto 10px;
                padding: 9px 22px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
              "
            >
              IDをコピー
            </button>

            <button
              id="close-user-id-modal"
              type="button"
              style="
                display: block;
                margin: 0 auto;
                padding: 9px 22px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
              "
            >
              閉じる
            </button>
          `;
          
          modal.appendChild(dialog);
          document.body.appendChild(modal);
 
          const copyButton = dialog.querySelector("#copy-user-id");
          const closeButton = dialog.querySelector("#close-user-id-modal");
 
          copyButton.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(userId);
 
              copyButton.textContent = "コピーしました！";
 
              setTimeout(() => {
                copyButton.textContent = "IDをコピー";
              }, 1500);
 
            } catch (error) {
              console.error("ユーザーIDのコピーに失敗:", error);
              showToast(
                "コピーに失敗しました。ユーザーIDを手動でコピーしてください。",
                5000,
                "error"
                );  
            }
          });
          
          closeButton.addEventListener("click", () => {
            modal.remove();
          });
        //ここまでモーダル
        
        setView("student");
      }
      
      return;
      }
        
      // 生徒画面
      if (targetView === "student") {
        setView("student");
        renderStudent();
        return;
      }
         
      // 浅い管理画面・深い管理画面
      if (
        targetView === "quick-admin" ||
        targetView === "deep-admin"
      ) {
        if (!state.authenticated) {
          handleGoogleLogin();
          return;
        }

        const role = state.adminProfile?.role;
        
        // 深い管理画面は deep のみ
        if (
          targetView === "deep-admin" &&
          role !== "deep"
        ) {
          showToast("深い管理画面を利用する権限がありません。");
          setView("student");
          return;
        } 
         
         // 浅い管理画面は quick / deep
        if (
          targetView === "quick-admin" &&
          role !== "quick" &&
          role !== "deep"
        ) {
          showToast("管理画面を利用する権限がありません。");
          setView("student");
          return;
        }
         
        setView(targetView);
 
        if (targetView === "quick-admin") {
          renderQuickAdmin();
        }
 
         if (targetView === "deep-admin") {
          renderDeepAdmin();
        }
          
        return;
      }
    });
  });
    
  $("#logout-button")?.addEventListener("click", handleLogout);
  
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

  //先生の検索の初期化
  setupTeacherPicker();
    
   // ========================================
   // 生徒側プロフィール変更
   // ========================================

  // 学年が変わった場合
  $("#student-grade")?.addEventListener("change", async () => {

    const grade =
      $("#student-grade").value;
    
    const classControl =
      $("#student-class")?.closest("label");
    
    const courseControl =
      $("#student-course")?.closest("label");
    
    const teacherControl =
      $("#student-teacher-control");

    // ========================================
    // 「先生」が選択された場合
    // ========================================

    if (grade === "teacher") {

      // 組・コースを非表示
      if (classControl) {
        classControl.hidden = true;
      }
      if (courseControl) {
        courseControl.hidden = true;
      }

      state.profile.grade = "teacher";
      state.profile.classNo = "";
      state.profile.course = "";

      saveStored(
        STORAGE_KEYS.profile,
        state.profile
      );

      // IDを表示
      if (teacherControl) {
        teacherControl.hidden = false;
      }

      await loadTeacherOptions();
      await renderStudent();

      return;
    }

    // ========================================
    // 通常の1～3年が選択された場合
    // ========================================

    if (classControl) {
      classControl.hidden = false;
    }

    if (courseControl) {
      courseControl.hidden = false;
    }

    if (teacherControl) {
      teacherControl.hidden = true;
    }

    // 通常の生徒プロフィールを更新
    state.profile.grade = grade;
    state.profile.classNo =
      $("#student-class").value;

    // 年組が変わったので、コース一覧をGASから取得
    const optionsData =
      await fetchGasClassOptions(
        state.profile.grade,
        state.profile.classNo
      );

    if (!optionsData) {
      return;
    }

    // 取得したコースを選択欄へ反映
    updateStudentCourseOptions(
      optionsData.courses,
      state.profile.course
    );

    // 現在選択可能なコースを確認
    const courseSelect =
      $("#student-course");

    if (
      !courseSelect ||
      !optionsData.courses?.[courseSelect.value]
    ) {

      const firstCourse =
        Object.keys(
          optionsData.courses || {}
        )[0];

      if (firstCourse) {
        courseSelect.value =
          firstCourse;

        state.profile.course =
          firstCourse;
      }
  
    } else {

      state.profile.course =
        courseSelect.value;

    }

    saveStored(
      STORAGE_KEYS.profile,
      state.profile
    );

    await renderStudent();
  });


  // ========================================
  // 組が変わった場合
  // ========================================

  $("#student-class")?.addEventListener(
    "change",
    async () => {

      // 先生モードでは何もしない
      if (
        $("#student-grade")?.value ===
        "teacher"
      ) {
        return;
      }

      state.profile.grade =
        $("#student-grade").value;

      state.profile.classNo =
        $("#student-class").value;

      const optionsData =
        await fetchGasClassOptions(
          state.profile.grade,
          state.profile.classNo
        );

      if (!optionsData) {
        return;
      }

      updateStudentCourseOptions(
        optionsData.courses,
        state.profile.course
      );

      const courseSelect =
        $("#student-course");

      if (
        !courseSelect ||
        !optionsData.courses?.[
          courseSelect.value
        ]
      ) {

        const firstCourse =
          Object.keys(
            optionsData.courses || {}
          )[0];

        if (firstCourse) {
          courseSelect.value =
            firstCourse;

          state.profile.course =
            firstCourse;
        }

      } else {
  
        state.profile.course =
          courseSelect.value;

      }

      saveStored(
        STORAGE_KEYS.profile,
        state.profile
      );
  
      await renderStudent();
    }
  );


  // ========================================
  // コースだけが変わった場合
  // ========================================

  $("#student-course")?.addEventListener(
    "change",
    () => {

      state.profile.course =
        $("#student-course").value;

      saveStored(
        STORAGE_KEYS.profile,
        state.profile
      );

      // ★ここではGASを呼ばない
      renderStudent();
    }
  );

  $("#admin-grade")?.addEventListener("change", renderQuickAdmin);
  $("#admin-day")?.addEventListener("change", () => {
    state.adminDay = $("#admin-day").value;
    renderQuickAdmin();
  });

  $("#deep-admin-grade")?.addEventListener(
    "change",
    renderDeepAdmin
  );

  $("#deep-admin-day")?.addEventListener(
    "change",
    () => {
      state.deepAdminDay =
        $("#deep-admin-day").value;

      renderDeepAdmin();
    }
  );

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
  
  // ========================================
  // 管理者追加
  // ========================================
  $("#add-admin-profile")?.addEventListener(
    "click",
    showAddAdminProfileDialog
  );
}

  const studentInfoButton =
    document.getElementById("student-info-button");

  if (studentInfoButton) {
    studentInfoButton.addEventListener(
      "click",
      () => {
        const confirmed =
          window.confirm(
            "ドキュメントに飛びますか？"
          );

        if (confirmed) {
          window.location.href =
            "https://docs.google.com/document/d/1fU3y60iBCRSSywc3J4EdUebXePZ1NAMRqKeDYOOgRA8/edit?usp=sharing";
        }
      }
    );
  }

async function loadTeacherOptions() {
  const select =
    $("#student-teacher");

  const optionsContainer =
    $("#teacher-picker-options");

  if (!select || !optionsContainer) {
    return;
  }

  const { data, error } =
    await window.supabaseClient
      .from("admin_profiles")
      .select("user_id, display_name")
      .order("display_name", {
        ascending: true
      });

  if (error) {
    console.error(
      "管理者一覧取得失敗:",
      error
    );

    showToast(
      "管理者一覧の取得に失敗しました。",
      5000,
      "error"
      );  

    select.replaceChildren(
      new Option(
        "取得できませんでした",
        ""
      )
    );

    optionsContainer.replaceChildren();

    const empty =
      document.createElement("div");

    empty.className =
      "teacher-picker-empty";

    empty.textContent =
      "取得できませんでした";

    optionsContainer.appendChild(empty);

    return;
  }

  // ========================================
  // 既存selectを更新
  // ========================================

  select.replaceChildren(
    new Option(
      "選択してください",
      ""
    )
  );

  // ========================================
  // カスタム候補一覧を作成
  // ========================================

  optionsContainer.replaceChildren();

  (data || []).forEach((profile) => {
    if (!profile.user_id) {
      return;
    }

    const displayName =
      profile.display_name ||
      "表示名未設定";

    const shortId =
      `${profile.user_id.slice(0, 8)}…`;

    const label =
      `${displayName} (${shortId})`;

    // 既存select
    const option =
      new Option(
        label,
        profile.user_id
      );

    select.appendChild(option);

    // カスタム候補
    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "teacher-picker-option";

    button.dataset.value =
      profile.user_id;

    button.dataset.searchText =
      label.toLowerCase();

    button.textContent =
      label;

    button.addEventListener(
      "click",
      async () => {

        select.value =
          profile.user_id;

        state.profile.teacherId =
          profile.user_id;

        saveStored(
          STORAGE_KEYS.profile,
          state.profile
        );

        updateTeacherPickerLabel();

        closeTeacherPicker();

        await renderStudent();
      }
    );

    optionsContainer.appendChild(button);
  });

  updateTeacherPickerLabel();
}

// ========================================
// 先生選択プルダウン
// ========================================

function openTeacherPicker() {
  const menu =
    $("#teacher-picker-menu");

  const button =
    $("#teacher-picker-button");

  if (!menu || !button) {
    return;
  }

  menu.hidden = false;

  button.setAttribute(
    "aria-expanded",
    "true"
  );

  const search =
    $("#teacher-picker-search");

  search?.focus();
}


function closeTeacherPicker() {
  const menu =
    $("#teacher-picker-menu");

  const button =
    $("#teacher-picker-button");

  if (!menu || !button) {
    return;
  }

  menu.hidden = true;

  button.setAttribute(
    "aria-expanded",
    "false"
  );
}


function updateTeacherPickerLabel() {
  const select =
    $("#student-teacher");

  const label =
    $("#teacher-picker-label");

  if (!select || !label) {
    return;
  }

  const selected =
    select.options[
      select.selectedIndex
    ];

  label.textContent =
    selected?.textContent ||
    "選択してください";

  // 選択状態を候補側にも反映
  $$(".teacher-picker-option")
    .forEach((option) => {

      option.classList.toggle(
        "is-selected",
        option.dataset.value ===
          select.value
      );
    });
}


function filterTeacherOptions() {
  const search =
    $("#teacher-picker-search");

  if (!search) {
    return;
  }

  const keyword =
    search.value
      .trim()
      .toLowerCase();

  let visibleCount = 0;

  $$(".teacher-picker-option")
    .forEach((option) => {

      const text =
        option.dataset.searchText || "";

      const matched =
        !keyword ||
        text.includes(keyword);

      option.hidden =
        !matched;

      if (matched) {
        visibleCount++;
      }
    });

  const optionsContainer =
    $("#teacher-picker-options");

  if (!optionsContainer) {
    return;
  }

  let empty =
    optionsContainer.querySelector(
      ".teacher-picker-empty"
    );

  if (visibleCount === 0) {

    if (!empty) {
      empty =
        document.createElement("div");

      empty.className =
        "teacher-picker-empty";

      optionsContainer.appendChild(
        empty
      );
    }

    empty.textContent =
      "該当する先生がいません。";

  } else if (empty) {
    empty.remove();
  }
}


function setupTeacherPicker() {
  const button =
    $("#teacher-picker-button");

  const search =
    $("#teacher-picker-search");

  const picker =
    $("#teacher-picker");

  if (!button || !search || !picker) {
    return;
  }

  // 開閉
  button.addEventListener(
    "click",
    () => {

      const menu =
        $("#teacher-picker-menu");

      if (!menu) {
        return;
      }

      if (menu.hidden) {
        openTeacherPicker();
      } else {
        closeTeacherPicker();
      }
    }
  );

  // 検索
  search.addEventListener(
    "input",
    filterTeacherOptions
  );

  // 外側をクリックしたら閉じる
  document.addEventListener(
    "click",
    (event) => {

      if (!picker.contains(event.target)) {
        closeTeacherPicker();
      }
    }
  );
}

function setupTeacherSearch() {
  const searchInput =
    document.getElementById("student-teacher-search");

  const teacherSelect =
    document.getElementById("student-teacher");

  if (!searchInput || !teacherSelect) {
    return;
  }

  searchInput.addEventListener("input", () => {
    const keyword =
      searchInput.value.trim().toLowerCase();

    const currentValue =
      teacherSelect.value;

    Array.from(
      teacherSelect.options
    ).forEach((option) => {
      if (!option.value) {
        option.hidden = false;
        return;
      }

      const text =
        option.textContent.toLowerCase();

      option.hidden =
        keyword !== "" &&
        !text.includes(keyword);
    });

    // 現在選択中の先生は検索結果から消さない
    const selectedOption =
      teacherSelect.querySelector(
        `option[value="${CSS.escape(currentValue)}"]`
      );

    if (selectedOption) {
      selectedOption.hidden = false;
    }
  });
}

async function loadAdminProfiles() {
  const list = $("#admin-profile-list");

  if (!list) return;

  if (state.adminProfiles !== null) {
    return;
  }

  const { data, error } = await window.supabaseClient
    .from("admin_profiles")
    .select("user_id, display_name, role");

  if (error) {
    console.error(
      "管理者一覧取得失敗:",
      error
    );

    showToast(
      "管理者一覧の取得に失敗しました。",
      5000,
      "error"
      );  

    list.replaceChildren(
      createEmptyState(
        "管理者一覧を取得できませんでした。"
      )
    );

    return;
  }

  console.log(
    "管理者一覧取得成功:",
    data
  );

  state.adminProfiles = data || [];

  list.replaceChildren();

  if (!state.adminProfiles.length) {
    list.append(
      createEmptyState(
        "登録されている管理者はいません。"
      )
    );

    return;
  }

  state.adminProfiles.forEach((profile) => {
    const item =
      document.createElement("li");

    const role =
      document.createElement("span");

    role.textContent =
      profile.role || "role未設定";

    const separator =
      document.createElement("span");

    separator.textContent =
      " : ";

    const name =
      document.createElement("span");

    name.textContent =
      profile.display_name ||
      "表示名未設定";

    // User IDは先頭8文字だけ表示
    const userId =
      document.createElement("span");

    userId.textContent =
      profile.user_id
        ? ` (${profile.user_id.slice(0, 8)}…)`
        : "";

    // 削除ボタン
    const deleteButton =
      document.createElement("button");

    deleteButton.type = "button";
    deleteButton.textContent = "削除";
    deleteButton.className =
      "admin-profile-delete";

    deleteButton.addEventListener(
      "click",
      () => {
        deleteAdminProfile(profile);
      }
    );

    item.append(
      role,
      separator,
      name,
      userId,
      deleteButton
    );

    list.append(item);
  });
}

async function deleteAdminProfile(profile) {
  if (!profile?.user_id) {
    showToast("削除対象のUser IDが取得できません。");
    return;
  }

  const confirmed = window.confirm(
    `${profile.display_name || "この管理者"}を削除しますか？\n\n` +
    "この操作を行うと、このユーザーは管理画面を利用できなくなります。"
  );

  if (!confirmed) {
    return;
  }

  try {
    const {
      data: { session },
      error: sessionError
    } = await window.supabaseClient.auth.getSession();

    if (sessionError) {
      throw new Error(
        "ログイン状態の確認に失敗しました。"
      );
    }

    if (!session) {
      throw new Error(
        "ログインしてください。"
      );
    }

    const response = await fetch(
      "/api/admin-profile",
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          user_id: profile.user_id
        })
      }
    );

    const result =
      await response.json();

    console.log(
      "管理者削除結果:",
      result
    );

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ||
        "管理者の削除に失敗しました。"
      );
    }

    showToast(
      `${profile.display_name || "管理者"}を削除しました。`
    );

    state.adminProfiles = null;

    await loadAdminProfiles();

  } catch (error) {
    console.error(
      "管理者削除エラー:",
      error
    );

    showToast(
      "管理者の削除に失敗しました。\n\n" +
      error.message
    );
  }
}

// ========================================
// 管理者追加モーダル
// ========================================

function showAddAdminProfileDialog() {
  const overlay =
    document.createElement("div");

  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  `;

  const dialog =
    document.createElement("div");

  dialog.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    width: min(480px, 100%);
    box-sizing: border-box;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  `;

  dialog.innerHTML = `
    <h2 style="
      margin: 0 0 20px;
      font-size: 1.2rem;
    ">
      管理者を追加
    </h2>

    <div style="margin-bottom: 14px;">
      <label
        for="new-admin-user-id"
        style="
          display: block;
          font-weight: bold;
          margin-bottom: 6px;
        "
      >
        User ID
      </label>

      <input
        id="new-admin-user-id"
        type="text"
        placeholder="SupabaseのUser ID"
        style="
          width: 100%;
          box-sizing: border-box;
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 6px;
        "
      >
    </div>

    <div style="margin-bottom: 14px;">
      <label
        for="new-admin-display-name"
        style="
          display: block;
          font-weight: bold;
          margin-bottom: 6px;
        "
      >
        表示名
      </label>

      <input
        id="new-admin-display-name"
        type="text"
        placeholder="例：○○先生"
        style="
          width: 100%;
          box-sizing: border-box;
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 6px;
        "
      >
    </div>

    <div style="margin-bottom: 20px;">
      <label
        for="new-admin-role"
        style="
          display: block;
          font-weight: bold;
          margin-bottom: 6px;
        "
      >
        権限
      </label>

      <select
        id="new-admin-role"
        style="
          width: 100%;
          box-sizing: border-box;
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 6px;
        "
      >
        <option value="user">
          user（見る専用）
        </option>

        <option value="quick">
          quick（浅い管理画面）
        </option>
        
        <option value="deep">
          deep（深い管理画面）
        </option>
      </select>
    </div>

    <div style="
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    ">
      <button
        id="cancel-add-admin"
        type="button"
        style="
          padding: 9px 18px;
          border: 1px solid #ccc;
          border-radius: 6px;
          background: white;
          cursor: pointer;
        "
      >
        キャンセル
      </button>

      <button
        id="submit-add-admin"
        type="button"
        style="
          padding: 9px 18px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        "
      >
        追加する
      </button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const userIdInput =
    dialog.querySelector("#new-admin-user-id");

  const displayNameInput =
    dialog.querySelector("#new-admin-display-name");

  const roleSelect =
    dialog.querySelector("#new-admin-role");

  const cancelButton =
    dialog.querySelector("#cancel-add-admin");

  const submitButton =
    dialog.querySelector("#submit-add-admin");

  // キャンセル
  cancelButton.addEventListener(
    "click",
    () => {
      overlay.remove();
    }
  );

  // 背景クリック
  overlay.addEventListener(
    "click",
    (event) => {
      if (event.target === overlay) {
        overlay.remove();
      }
    }
  );

  // 登録
  submitButton.addEventListener(
    "click",
    async () => {

      const userId =
        userIdInput.value.trim();

      const displayName =
        displayNameInput.value.trim();

      const role =
        roleSelect.value;

      if (!userId) {
        showToast("User IDを入力してください。");
        userIdInput.focus();
        return;
      }

      if (!displayName) {
        showToast("表示名を入力してください。");
        displayNameInput.focus();
        return;
      }

      if (
        role !== "user" &&
        role !== "quick" &&
        role !== "deep"
      ) {
        showToast("権限を選択してください。");
        return;
      }

      // UUID形式の簡易チェック
      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      if (!uuidPattern.test(userId)) {
        showToast(
          "User IDの形式が正しくありません。\n" +
          "Supabase Authに表示されるUser IDを確認してください。"
        );
        userIdInput.focus();
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = "登録中…";

      try {

        // 現在のログインセッションを取得
        const {
          data: { session },
          error: sessionError
        } =
          await window.supabaseClient.auth.getSession();

        if (sessionError) {
          throw new Error(
            "ログイン状態の確認に失敗しました。"
          );
        }

        if (!session) {
          throw new Error(
            "ログインしてください。"
          );
        }

        // Cloudflare Pages Functionへ送信
        const response =
          await fetch(
            "/api/admin-profile",
            {
              method: "POST",

              headers: {
                "Content-Type": "application/json",
                "Authorization":
                  `Bearer ${session.access_token}`
              },

              body: JSON.stringify({
                user_id: userId,
                display_name: displayName,
                role: role
              })
            }
          );

        const result =
          await response.json();

        console.log(
          "管理者追加結果:",
          result
        );

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.error ||
            "管理者の登録に失敗しました。"
          );
        }

        showToast(
          `${displayName} さんを管理者として登録しました。`
        );

        overlay.remove();

        // 一覧を再取得
        state.adminProfiles = null;

        await loadAdminProfiles();

      } catch (error) {

        console.error(
          "管理者追加エラー:",
          error
        );

        showToast(
          "管理者の登録に失敗しました。IDを再確認の上、再度登録してください。",
          5000,
          "error"
          );  

        submitButton.disabled = false;
        submitButton.textContent = "追加する";
      }
    }
  );

  // 最初にUser IDへフォーカス
  setTimeout(() => {
    userIdInput.focus();
  }, 0);
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

    showToast(
      "Googleログインに失敗しました。",
      5000,
      "error"
    );

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

// ========================================
// 先生の時間割をGASから取得
// ========================================

async function fetchTeacherDayTimetable(teacherId, day) {
  if (!teacherId) return null;

  const targetTeacherId = String(teacherId).trim();
  const targetDay = String(day).trim();

  if (!targetTeacherId || !targetDay) {
    return null;
  }

  // ブラウザキャッシュ確認
  const cacheKey =
    `${targetTeacherId}_${targetDay}`;

  const cached =
    state.data.gasTeacherTimetableCache?.[cacheKey];

  if (cached) {
    console.log(
      "先生時間割：ブラウザキャッシュ使用:",
      cacheKey
    );

    return cached;
  }

  const {
    data: { session },
    error: sessionError
  } = await window.supabaseClient.auth.getSession();

  if (sessionError) {
    console.error(
      "先生時間割：認証状態の取得に失敗:",
      sessionError
    );

    showToast(
      "先生の時間割処理にて、認証状態の取得に失敗しました。",
      5000,
      "error"
      );  
    return null;
  }

  if (!session) {
    console.error(
      "先生時間割：ログインしていません"
    );

    showToast(
      "先生の時間割処理にて、ログインを確認できませんでした。",
      5000,
      "error"
      );  
    return null;
  }

  const params = new URLSearchParams();

  params.set(
    "teacher_id",
    targetTeacherId
  );

  params.set(
    "day",
    targetDay
  );

  try {
    console.log(
      "先生時間割：GASへ取得:",
      cacheKey
    );

    const response = await fetch(
      `/api/timetable?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${session.access_token}`
        }
      }
    );

    const data = await response.json();

    console.log(
      "先生時間割取得結果:",
      data
    );

    if (!response.ok || !data.success) {
      console.error(
        "先生時間割取得失敗:",
        data
      );
      howToast(
        "先生の時間割の取得に失敗しました。",
        5000,
        "error"
      );
      return null;
    }
      
    // 取得成功 → ブラウザキャッシュへ保存
    if (!state.data.gasTeacherTimetableCache) {
      state.data.gasTeacherTimetableCache = {};
    }

    state.data.gasTeacherTimetableCache[cacheKey] =
      data.data;

    console.log(
      "先生時間割：ブラウザキャッシュ保存:",
      cacheKey
    );

    return data.data;

  } catch (error) {
    console.error(
      "先生時間割取得エラー:",
      error
    );

    showToast(
      "先生の時間割の取得に失敗しました。",
      5000,
      "error"
      );  
    return null;
  }
}

// 先生時間割を画面へ描画

async function renderTeacherTimetable() {

  const teacherId =
    state.profile.teacherId;

  const selectedDay =
    document.getElementById(
      "student-day"
    )?.value || "月";


  // いったん全時限を空にする
  $$(
    ".period-subject"
  ).forEach((subjectNode) => {

    subjectNode.textContent = "";

    subjectNode
      .closest("li")
      ?.classList.remove(
        "is-changed"
      );

  });


  if (!teacherId) {
    return;
  }


  const data =
    await fetchTeacherDayTimetable(
      teacherId,
      selectedDay
    );


  if (!data) {
    return;
  }


  const timetable =
    data.timetable || [];


  // 1～7限を描画

  $$(".period-subject").forEach(
    (subjectNode) => {

      const period =
        Number(
          subjectNode.dataset.period
        );


      const periodData =
        timetable.find(
          (item) =>
            Number(item.period) ===
            period
        );


      if (
        !periodData ||
        !periodData.subjects?.length
      ) {

        subjectNode.textContent = "";

        return;
      }


      // 同じ時限に複数クラスを担当している場合
      const names =
        periodData.subjects
          .map(
            (item) =>
              item.subject_name || ""
          )
          .filter(Boolean);


      subjectNode.textContent =
        names.join(" / ");
    }
  );
}

async function renderStudent() {

  // 先生モード

  if (
    state.profile.grade === "teacher"
  ) {

    setSelectValue(
      "#student-grade",
      "teacher"
    );

    setSelectValue(
      "#student-teacher",
      state.profile.teacherId || ""
    );

    updateTeacherPickerLabel();

    await renderTeacherTimetable();

    renderStudentNotices();

    return;
  }

  // 通常の生徒モード
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
  // GASから現在の年組データを取得
  //
  // 年組ごとに1回だけ取得し、
  // 文系・理系などのコースはブラウザ側で切り替える
  // ========================================

  const periodList =
    $(".period-list");
  
  periodList?.removeAttribute("hidden");
  
  $(".load-error-state")?.remove();
  
  const optionsData =
    await fetchGasClassOptions(
      state.profile.grade,
      state.profile.classNo
    );

  console.log(
    "年組全コースデータ:",
    optionsData
  );

  // GAS取得失敗

  if (!optionsData) {

    $$(".period-subject").forEach(
      (subjectNode) => {
  
        subjectNode.textContent = "";
  
        subjectNode
          .closest("li")
          ?.classList.remove("is-changed");
  
      }
    );
  
    const periodList =
      $(".period-list");
  
    if (periodList) {
      periodList.hidden = true;
  
      const oldError =
        $(".load-error-state");
  
      oldError?.remove();
  
      periodList.parentElement?.append(
        createLoadErrorState(
          "時間割を読み込めませんでした。"
        )
      );
    }
  
    renderStudentNotices();
  
    return;
  }
  // コース選択欄をJSONに合わせる

  updateStudentCourseOptions(
    optionsData.courses,
    state.profile.course
  );

  // 現在選択されているコースのデータを取得

  let gasData =
    optionsData.courses?.[
      state.profile.course
    ];

  // 現在のコースが存在しない場合

  if (!gasData) {

    const firstCourse =
      Object.keys(
        optionsData.courses || {}
      )[0];

    if (!firstCourse) {

      console.error(
        "利用可能なコースがありません:",
        optionsData
      );

      
      showToast(
        "無効なコースが入力されました。",
        5000,
        "error"
        );  

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

    state.profile.course =
      firstCourse;

    setSelectValue(
      "#student-course",
      firstCourse
    );

    saveStored(
      STORAGE_KEYS.profile,
      state.profile
    );

    gasData =
      optionsData.courses[firstCourse];
  }

  console.log(
    "現在表示するコース:",
    state.profile.course
  );

  console.log(
    "現在表示する時間割データ:",
    gasData
  );
  
  // 今日の曜日を取得 2日以上先なら警告
 
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
  
  // subjectsを検索しやすい形にする

  (gasData.subjects || []).forEach(
    (subject) => {

      subjectMap[subject.subject_id] =
        subject;

    }
  );

  // 各時限を表示

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


      // jointの場合

      if (timetableItem.joint) {

        displayName =
          timetableItem.joint.joint_name || "";

      }

      // 通常授業の場合

      else {

        const subject =
          subjectMap[subjectId];

        displayName =
          subject?.subject_name || subjectId || "";

      }


      subjectNode.textContent =
        displayName;

      // subject_changeがあった場合

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
    (
      state.adminProfile?.role !== "quick" &&
      state.adminProfile?.role !== "deep"
    )
  ) {
    return;
  }

  const grade =
    $("#admin-grade")?.value || "2";

  const matrix =
    $("#change-matrix");

  if (!matrix) return;

  
 // ========================================
  // 重複一覧と学年時間割を並行して取得
  // ========================================
  
  let conflictPromise =
    Promise.resolve();
  
  if (
    !state.data.gasAdminConflictInitialized
  ) {
  
    conflictPromise =
      fetchInitialAdminConflicts()
        .then(() => {
          state.data.gasAdminConflictInitialized =
            true;
        });
  }
  
  // 時間割取得は重複一覧を待たずに開始
  const gasDataPromise =
    fetchGasAdminTimetable(grade);
  
  
  // 重複一覧の取得完了を待つ
  await conflictPromise;
  
  
  // 学年時間割を待つ
  const gasData =
    await gasDataPromise;

  if (!gasData) {
    matrix.replaceChildren(
      createLoadErrorState(
        "時間割を読み込めませんでした。"
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

      const changeSubjectId =
        timetableItem?.subject_change || "";

      const displayName =
        changeSubjectId || "";

      const isChanged =
        Boolean(changeSubjectId);
      const isConflict =
        hasAdminConflict(
          grade,
          day,
          classId,
          period
        );

      const cell =
        createCell(
          displayName,
          "button",
          `matrix-cell ${
            getSubjectClass(classItem.course)
          }${isChanged ? " is-changed" : ""}${
            isConflict ? " is-conflict" : ""
          }`
        );

      const tooltipSubjectId =
        changeSubjectId ||
        timetableItem?.subject_base ||
        "";
      
      cell.title =
        getGasAdminSubjectTooltip(
          gasData,
          tooltipSubjectId
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
      ${
        post.kind !== "history"
          ? `<small>${formatTargets(post.targets)}</small>`
          : ""
      }
    `;
    $("button", card).addEventListener("click", () => deleteNotification(post.id));
    container.append(card);
  });
}

async function renderDeepAdmin() {
  if (
    state.view !== "deep-admin" ||
    !state.authenticated ||
    state.adminProfile?.role !== "deep"
  ) {
    return;
  }

  const grade = $("#deep-admin-grade")?.value || "2";
  const day =
    $("#deep-admin-day")?.value ||
    state.deepAdminDay ||
    "月";

  const matrix = $("#base-matrix");

  if (!matrix) return;

  state.deepAdminDay = day;

  if (
    !state.data.gasAdminConflictInitialized
  ) {

    await fetchInitialAdminConflicts();

    state.data.gasAdminConflictInitialized =
      true;

  }
  
  // 浅い管理画面と同じGASデータを使用
  const gasData = await fetchGasAdminTimetable(grade);

  if (!gasData) {
    matrix.replaceChildren(
      createLoadErrorState(
        "時間割を読み込めませんでした。"
      )
    );
    return;
  }

  const classes = gasData.classes || [];

  matrix.style.setProperty(
    "--class-count",
    classes.length
  );

  // ここで既存セルを全部消す
  matrix.replaceChildren();

  // ヘッダーもJSで生成
  appendMatrixHeader(
    matrix,
    classes.map(convertGasClassForDisplay)
  );

  // 選択中の曜日
  const dayData =
    gasData.timetable?.[day] || {};

  // 1〜7限
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
            Number(item.period) === Number(period)
        );

      // 基本時間割
      const displaySubjectId =
        timetableItem?.subject_base || "";
      
      const isConflict =
        hasAdminConflict(
          grade,
          day,
          classId,
          period
        );
      
      const cell =
        createCell(
          displaySubjectId,
          "button",
          `matrix-cell ${
            getSubjectClass(classItem.course)
          }${isConflict ? " is-conflict" : ""}`
        );
      
      // カーソルを合わせたときの詳細情報
      cell.title =
        getGasAdminSubjectTooltip(
          gasData,
          displaySubjectId
        );

      cell.type = "button";

      cell.dataset.classId =
        classId;

      cell.dataset.period =
        String(period);

      cell.dataset.day =
        day;

      cell.addEventListener(
        "click",
        () => {
          editBaseSubject(
            classItem,
            period,
            displaySubjectId
          );
        }
      );

      matrix.append(cell);
    });
  });

  renderManagers();
    
  await loadAdminProfiles();
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

function appendMatrixHeader(matrix, classes) {
  matrix.append(
    createCell(
      "",
      "div",
      "matrix-cell matrix-cell--corner"
    )
  );

  classes.forEach((classItem) => {
    const courseLabel =
      state.data.courses[classItem.course] || "";

    const label =
      `${escapeHtml(classItem.label)}<br>` +
      `${escapeHtml(courseLabel)}`;

    const cell =
      createCell(
        label,
        "div",
        `matrix-cell ${getSubjectClass(classItem.course)}`,
        true
      );

    matrix.append(cell);
  });
}

async function editChange(classItem, period, existingChange) {
  const current =
    existingChange?.subject_change ||
    existingChange?.subject ||
    "";

  // ========================================
  // 全学年の科目一覧を取得
  // ========================================
  const [
    allSubjects,
    allTimetables
  ] = await Promise.all([
    fetchAllGasSubjects(),
    fetchAllAdminTimetables()
  ]);
  
  if (!allSubjects) {
    showToast(
      "科目一覧を取得できませんでした。\n" +
      "時間割データを確認してください。"
    );
    return;
  }

  // ========================================
  // 科目を検索・選択
  // ========================================
  const day =
    state.adminDay || "月";


  if (!allTimetables) {
    showToast(
      "重複判定用の時間割を取得できませんでした。\n" +
      "時間割データを確認してください。"
    );
    return;
  }

  const subjectChange =
    await showSubjectSelectionDialog(
      allSubjects,
      current,
      `${day}曜日　${classItem.grade}年${classItem.classNo}組 ${state.data.courses[classItem.course] || ""}　${period}限目`,
      {
        classId: classItem.id,
        day,
        period,
        allTimetables,
        grade: classItem.grade,
        classNo: classItem.classNo
      }
    );

  if (subjectChange === null) {
    return;
  }

  // ========================================
  // 保存直前のsubject_id存在チェック
  // ※空欄は「変更をクリア」なので許可
  // ========================================
  if (subjectChange !== "") {

    const validSubject =
      allSubjects.some(
        (subject) =>
          String(subject.subject_id).trim() ===
          subjectChange
      );

    if (!validSubject) {
      showToast(
        `存在しないsubject_idです。\n\n${subjectChange}`
      );
      return;
    }
  }

  // 現在のログインセッションを取得
  const {
    data: { session },
    error: sessionError
  } = await window.supabaseClient.auth.getSession();

  if (sessionError) {
    console.error("認証状態の取得に失敗:", sessionError);
    showToast("ログイン状態の確認に失敗しました。");
    return;
  }

  if (!session) {
    showToast("ログインしてください。");
    return;
  }

  // 変更した日付を日本時間で取得
  const now = new Date();

  const changeDate =
    new Intl.DateTimeFormat(
      "ja-JP",
      {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    )
      .format(now)
      .replaceAll("/", "-");
    
  try {
    const response = await fetch("/api/timetable-change", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        action: "updateTimetableChange",
        classId: classItem.id,
        grade: classItem.grade,
        day,
        period,
        subjectChange,
        teacherChange: ""
      })
    });

    const result = await response.json();

    console.log("時間割変更結果:", result);

    if (!response.ok || !result.success) {
      throw new Error(
        result.error || "時間割変更に失敗しました"
      );
    }

    // ブラウザ側のGASキャッシュを削除
    delete state.data.gasAdminTimetableCache[
      String(classItem.grade)
    ];
   
    // ========================================
    // 重複結果を確認
    // ========================================

    let message =
      `${day}曜日 ${period}限を「${subjectChange}」に変更しました。`;

    if (
      result.conflicts &&
      result.conflicts.length > 0
    ) {
      message +=
        "\n\n⚠ 重複が見つかりました。";

      const teacherConflicts =
        result.conflicts.filter(
          conflict =>
            conflict.type === "teacher"
        );

      const placeConflicts =
        result.conflicts.filter(
          conflict =>
            conflict.type === "place"
        );

      if (teacherConflicts.length > 0) {
        message +=
          "\n\n【担当教員の重複】";

        teacherConflicts.forEach(
          conflict => {
            message +=
              `\n・${conflict.teacher_id}` +
              ` → class_id ${conflict.class_id}` +
              `（${conflict.subject_id}）`;
          }
        );
      }

      if (placeConflicts.length > 0) {
        message +=
          "\n\n【担当場所の重複】";

        placeConflicts.forEach(
          conflict => {
            message +=
              `\n・${conflict.place}` +
              ` → class_id ${conflict.class_id}` +
              `（${conflict.subject_id}）`;
          }
        );
      }

      message +=
        "\n\n重複していますが、時間割は変更されています。";
    }
    showToast(message);

    // ========================================
    // 重複セル情報をブラウザ側へ更新
    // 重複が0件でも必ず呼ぶ
    // ========================================
    saveAdminConflicts(
      classItem.grade,
      day,
      classItem.id,
      period,
      result.conflicts || []
    );
    
    // ========================================
    // 変更履歴をSupabaseへ保存
    // ========================================
    try {
      await addChangeHistory(
        classItem,
        period,
        subjectChange,
        changeDate
      );
    } catch (historyError) {
      console.error(
        "変更履歴の保存に失敗:",
        historyError
      );

      showToast(
        "時間割は変更されましたが、" +
        "変更履歴の保存に失敗しました。\n\n" +
        historyError.message
      );
    }
    // 最新データをGASから再取得
    await renderQuickAdmin();

    // 学生画面側も最新状態にする
    await renderStudent();

  } catch (error) {
    console.error(
      "時間割変更エラー:",
      error
    );

    showToast(
      "時間割の変更に失敗しました。",
      5000,
      "error"
    );      
  }
}

async function editBaseSubject(classItem, period, currentSubject) {
  // ========================================
  // 全学年の科目一覧を取得
  // ========================================
  const [
    allSubjects,
    allTimetables
  ] = await Promise.all([
    fetchAllGasSubjects(),
    fetchAllAdminTimetables()
  ]);

  if (!allSubjects) {
    showToast(
      "科目一覧を取得できませんでした。\n" +
      "時間割データを確認してください。"
    );
    return;
  }

    // ========================================
    // 科目を検索・選択
    // ========================================
    const day =
      state.deepAdminDay ||
      state.adminDay ||
      "月";

    if (!allTimetables) {
      showToast(
        "重複判定用の時間割を取得できませんでした。\n" +
        "時間割データを確認してください。"
      );
      return;
    }

    const subjectId =
      await showSubjectSelectionDialog(
        allSubjects,
        currentSubject,
        `${classItem.label}　${state.data.courses[classItem.course] || ""}　${period}限目`,
        {
          classId: classItem.id,
          day,
          period,
          allTimetables
        }
      );
    
  // キャンセル
  if (subjectId === null) {
    return;
  }

  // ========================================
  // subject_idの存在チェック
  // 空欄は「基本時間割を空欄にする」ため許可
  // ========================================
  if (subjectId !== "") {
    const validSubject =
      allSubjects.some(
        (subject) =>
          String(subject.subject_id).trim() ===
          String(subjectId).trim()
      );

    if (!validSubject) {
      showToast(
        `存在しないsubject_idです。\n\n${subjectId}`
      );
      return;
    }
  }

  // ========================================
  // ログイン状態を確認
  // ========================================
  const {
    data: { session },
    error: sessionError
  } = await window.supabaseClient.auth.getSession();

  if (sessionError) {
    console.error(
      "認証状態の取得に失敗:",
      sessionError
    );

    showToast(
      "ログイン状態の確認に失敗しました。",
      5000,
      "error"
    );

    return;
  }

  if (!session) {
    showToast("ログインしてください。");
    return;
  }

  try {
    // ========================================
    // Cloudflare Pages Function経由で保存
    // ========================================
    const response =
      await fetch("/api/timetable-change", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${session.access_token}`
        },

        body: JSON.stringify({
          action: "updateTimetableBase",

          classId: classItem.id,
          grade: classItem.grade,
          day,
          period,

          subjectBase: subjectId,

          // 今回は基本時間割だけ変更
          teacherChange: ""
        })
      });

    const result =
      await response.json();

    console.log(
      "基本時間割変更結果:",
      result
    );

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ||
        "基本時間割の変更に失敗しました"
      );
    }

    // ========================================
    // 重複セル情報をブラウザ側へ保存
    // ========================================
    saveAdminConflicts(
      classItem.grade,
      day,
      classItem.id,
      period,
      result.conflicts || []
    );
      
    // ========================================
    // ブラウザ側のGASキャッシュを削除
    // ========================================
    delete state.data.gasAdminTimetableCache[
      String(classItem.grade)
    ];

    // ========================================
    // 完了
    // ========================================
    showToast(
      `${day}曜日 ${period}限の基本時間割を` +
      `「${subjectId || "空欄"}」に変更しました。`
    );

    // ========================================
    // 最新データをGASから再取得
    // ========================================
    await renderDeepAdmin();

    // 学生画面も更新
    await renderStudent();

  } catch (error) {
    console.error(
      "基本時間割変更エラー:",
      error
    );

    showToast(
      "基本時間割の変更に失敗しました。\n\n" +
      error.message,
      5000,
      "error"
    );  
  }
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
    showToast("タイトル・本文・掲載開始日・掲載終了日を入力してください。");
    return;
  }
  // 開始日と終了日の前後関係を確認
  if (endDate < startDate) {
    showToast("掲載終了日は掲載開始日以降の日付にしてください。");
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
    showToast(
      "お知らせの投稿に失敗しました。",
      5000,
      "error"
    );
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
    showToast("メールアドレスの形式を確認してください。");
    return;
  }
  if (state.data.managers.some((manager) => manager.email === email)) {
    showToast("同じメールアドレスがすでに登録されています。");
    return;
  }

  state.data.managers.push({ id: createManagerId(), email });
  saveStored(STORAGE_KEYS.managers, state.data.managers);
  input.value = "";
  renderManagers();
}

async function deleteNotification(id) {
  if (!id) {
    showToast("削除するお知らせが指定されていません。");
    return;
  }

  const confirmed = window.confirm(
    "このお知らせを削除しますか？"
  );

  if (!confirmed) {
    return;
  }

  try {
    // ========================================
    // Supabaseから削除
    // ========================================
    const { error } = await window.supabaseClient
      .from("notifications")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(
        "お知らせ削除失敗:",
        error
      );

      throw new Error(
        error.message ||
        "お知らせの削除に失敗しました。"
      );
    }

    // ========================================
    // ブラウザ側のstateも更新
    // ========================================
    state.data.notifications =
      state.data.notifications.filter(
        (post) => post.id !== id
      );

    // ========================================
    // 画面を更新
    // ========================================
    renderAdminPosts();
    renderStudentNotices();

    console.log(
      "お知らせ削除成功:",
      id
    );

  } catch (error) {
    console.error(
      "お知らせ削除エラー:",
      error
    );

    showToast(
      "お知らせの削除に失敗しました。\n\n" +
      error.message
    );
  }
}

function deleteManager(id) {
  state.data.managers = state.data.managers.filter((manager) => manager.id !== id);
  saveStored(STORAGE_KEYS.managers, state.data.managers);
  renderManagers();
}

function ensureValidStudentProfile() {
  let classItem =
    getClassByProfile(state.profile);

  if (!classItem) {
    classItem =
      state.data.classes.find(
        (item) =>
          item.grade === state.profile.grade &&
          item.classNo === state.profile.classNo
      );
  }

  if (!classItem) {
    classItem =
      state.data.classes.find(
        (item) =>
          item.grade === state.profile.grade
      ) || state.data.classes[0];
  }

  if (!classItem) {
    return;
  }

  // 学年・組は有効なクラス情報に合わせる
  // コースは現在選択中のものを維持する
  state.profile = {
    grade: classItem.grade,
    classNo: classItem.classNo,
    course:
      state.profile.course ||
      classItem.course
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

async function addChangeHistory(
  classItem,
  period,
  subject,
  changeDate
) {
  const startDate = new Date(
    `${changeDate}T00:00:00+09:00`
  );

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);

  const formatJstDateTime = (date) => {
    const parts =
      new Intl.DateTimeFormat(
        "ja-JP",
        {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        }
      ).formatToParts(date);

    const get = (type) =>
      parts.find(
        part => part.type === type
      )?.value;

    return (
      `${get("year")}-${get("month")}-${get("day")}` +
      `T${get("hour")}:${get("minute")}:${get("second")}+09:00`
    );
  };

  const history = {
    id: `history-${Date.now()}`,
    kind: "history",
    title: "時間割変更",

    display_start:
      formatJstDateTime(startDate),

    display_end:
      formatJstDateTime(endDate),

    body:
      `${classItem.label} ` +
      `${state.data.courses[classItem.course] || ""} ` +
      `${period}限を「${subject || "空欄"}」に変更しました。`,

    targets: {
      grades: [String(classItem.grade)],
      classes: [String(classItem.classNo)],
      courses: [classItem.course]
    }
  };

  const {
    data,
    error
  } = await window.supabaseClient
    .from("notifications")
    .insert([history])
    .select();

  if (error) {
    console.error(
      "変更履歴の保存に失敗:",
      error
    );

    
    showToast(
      "変更履歴の保存に失敗しました。",
      5000,
      "error"
    );  

    throw new Error(
      error.message ||
      "変更履歴の保存に失敗しました。"
    );
  }

  console.log(
    "変更履歴の保存成功:",
    data
  );

  if (data?.[0]) {
    state.data.notifications.unshift(
      data[0]
    );
  }

  renderAdminPosts();
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

function createLoadErrorState(
  message = "時間割を読み込めませんでした。"
) {
  const container =
    document.createElement("div");

  container.className =
    "load-error-state";

  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    gap: 12px;

    padding: 30px 20px;
    margin: 20px 0;

    text-align: center;
  `;

  const messageElement =
    document.createElement("p");

  messageElement.textContent = message;

  messageElement.style.cssText = `
    margin: 0;
    font-weight: 600;
  `;

  const reloadButton =
    document.createElement("button");

  reloadButton.type = "button";
  reloadButton.textContent = "再読み込み";

  reloadButton.style.cssText = `
    padding: 8px 20px;

    border: none;
    border-radius: 6px;

    background: #333;
    color: #fff;

    cursor: pointer;

    font-size: 0.95rem;
  `;

  reloadButton.addEventListener(
    "click",
    () => {
      window.location.reload();
    }
  );

  container.append(
    messageElement,
    reloadButton
  );

  return container;
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
// GASから年組ごとの全コースデータを取得
//
// grade + class_no だけで取得する。
// コースは指定しない。
// ========================================
async function fetchGasClassOptions(grade, classNo) {

  const cacheKey =
    `${String(grade)}-${String(classNo)}`;

  // ========================================
  // ブラウザ側キャッシュ
  // ========================================

  const cached =
    state.data.gasClassOptionsCache[cacheKey];

  if (cached) {

    console.log(
      "生徒時間割：ブラウザキャッシュ使用:",
      cacheKey
    );

    return cached;
  }

  try {

    const params =
      new URLSearchParams({
        grade: String(grade),
        class_no: String(classNo)
      });

    const url =
      `/api/timetable?${params.toString()}`;

    console.log(
      "生徒時間割GAS request:",
      url
    );

    const response =
      await fetch(url);

    console.log(
      "生徒時間割GAS status:",
      response.status
    );

    if (!response.ok) {

      throw new Error(
        `時間割取得に失敗しました: ${response.status}`
      );

    }

    const result =
      await response.json();

    console.log(
      "生徒時間割GAS response:",
      result
    );

    if (!result.success) {

      throw new Error(
        result.error ||
        "GASから時間割を取得できませんでした"
      );

    }

    // ========================================
    // 年組単位でキャッシュ
    // ========================================

    state.data.gasClassOptionsCache[cacheKey] =
      result.data;

    return result.data;

  } catch (error) {

    console.error(
      "fetchGasClassOptions error:",
      error
    );
    
    showToast(
      "時間割情報の取得に失敗しました。",
      5000,
      "error"
    );

    return null;
  }
}

// ========================================
// GASから返されたコース一覧を
// 生徒側のコースselectへ反映
// ========================================
function updateStudentCourseOptions(
  courses,
  preferredCourse = ""
) {

  const select =
    $("#student-course");

  if (!select) return;

  const courseLabels = {
    humanities: "文系",
    science: "理系",
    "explore-humanities": "探文",
    "explore-science": "探理",
    agriculture: "農業",
    welfare: "福祉"
  };

  const courseEntries =
    Object.entries(courses || {});

  select.replaceChildren();

  courseEntries.forEach(
    ([courseKey, courseData]) => {

      const option =
        document.createElement("option");

      option.value =
        courseKey;

      option.textContent =
        courseLabels[courseKey]
        || courseData?.class?.course
        || courseKey;

      select.append(option);
    }
  );

  // 以前選択していたコースが存在するなら維持
  if (
    preferredCourse &&
    courses?.[preferredCourse]
  ) {

    select.value =
      preferredCourse;

    return;
  }

  // なければ最初のコース
  if (courseEntries.length > 0) {

    select.value =
      courseEntries[0][0];

  }
}

// ========================================
// GASから浅い管理画面用の時間割を取得
// 学年単位で月～金をまとめて取得
// ========================================
async function fetchGasAdminTimetable(grade) {
  const cacheKey =
    String(grade);

  // ========================================
  // ① ブラウザキャッシュ
  // ========================================

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


  // ========================================
  // ② 同じ学年を現在取得中なら、その通信を共有
  // ========================================

  if (
    !state.data.gasAdminTimetablePromises
  ) {
    state.data.gasAdminTimetablePromises = {};
  }

  const existingPromise =
    state.data.gasAdminTimetablePromises[
      cacheKey
    ];

  if (existingPromise) {
    console.log(
      "浅い管理画面：取得中の通信を共有:",
      cacheKey
    );

    return await existingPromise;
  }


  // ========================================
  // ③ 実際のGAS通信
  // ========================================

  const promise =
    (async () => {

      const maxAttempts = 3;

      for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
      ) {

        try {

          const params =
            new URLSearchParams({
              admin: "quick",
              grade: cacheKey
            });

          const url =
            `/api/timetable?${params.toString()}`;

          console.log(
            "浅い管理画面GAS request:",
            url
          );

          const response =
            await fetch(url);


          // ========================================
          // HTTPエラー
          // ========================================

          if (!response.ok) {

            const retryable =
              response.status === 502 ||
              response.status === 503 ||
              response.status === 504;

            if (
              retryable &&
              attempt < maxAttempts
            ) {

              console.warn(
                `浅い管理画面GAS通信失敗: ` +
                `${response.status} ` +
                `(${attempt}/${maxAttempts})`
              );

              const waitMs =
                attempt * 300;

              await new Promise(
                resolve =>
                  setTimeout(
                    resolve,
                    waitMs
                  )
              );

              continue;
            }

            throw new Error(
              `GAS request failed: ${response.status}`
            );
          }


          // ========================================
          // JSON取得
          // ========================================

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


          // ========================================
          // 成功
          // ========================================

          state.data.gasAdminTimetableCache[
            cacheKey
          ] = result.data;

          return result.data;

        } catch (error) {

          console.error(
            `fetchGasAdminTimetable error ` +
            `(${attempt}/${maxAttempts}):`,
            error
          );


          // ネットワーク系エラーならリトライ
          if (
            attempt < maxAttempts &&
            !String(error.message || "")
              .startsWith("GAS request failed:")
          ) {

            const waitMs =
              attempt * 300;

            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  waitMs
                )
            );

            continue;
          }


          // ========================================
          // 最終的に失敗
          // ========================================

          showToast(
            "GASから時間割の取得に失敗しました。",
            5000,
            "error"
          );

          return null;
        }
      }

      return null;
    })();


  // ========================================
  // ④ この学年の通信を記録
  // ========================================

  state.data.gasAdminTimetablePromises[
    cacheKey
  ] = promise;


  // ========================================
  // ⑤ 完了したら「取得中」状態を解除
  // ========================================

  try {

    return await promise;

  } finally {

    if (
      state.data.gasAdminTimetablePromises[
        cacheKey
      ] === promise
    ) {

      state.data.gasAdminTimetablePromises[
        cacheKey
      ] = null;
    }
  }
}

// ========================================
// GASから初期重複一覧を取得
// 全学年・全クラス対象
// ========================================

async function fetchInitialAdminConflicts() {

  try {

    const response =
      await fetch(
        "/api/timetable?admin=conflicts"
      );

    if (!response.ok) {

      throw new Error(
        `重複一覧取得失敗: ${response.status}`
      );

    }

    const result =
      await response.json();

    console.log(
      "初期重複一覧GAS response:",
      result
    );

    if (!result.success) {

      throw new Error(
        result.error ||
        "初期重複一覧を取得できませんでした"
      );

    }

    const pairs = {};

    (result.data || []).forEach(
      (conflict) => {

        const classId1 =
          String(
            conflict.class_id1 || ""
          ).trim();

        const classId2 =
          String(
            conflict.class_id2 || ""
          ).trim();

        if (
          !classId1 ||
          !classId2
        ) {
          return;
        }

        const key =
          getAdminConflictPairKey(
            conflict.day,
            conflict.period,
            classId1,
            classId2
          );

        pairs[key] = true;

      }
    );

    state.data.gasAdminConflictPairs =
      pairs;

    console.log(
      "初期重複ペア:",
      pairs
    );

    return pairs;

  } catch (error) {

    console.error(
      "初期重複一覧取得失敗:",
      error
    );
    
    showToast(
      "重複一覧の取得に失敗しました。",
      5000,
      "error"
    );  

    state.data.gasAdminConflictPairs =
      {};

    return null;

  }
}

function getAdminConflictPairKey(
  day,
  period,
  classIdA,
  classIdB
) {
  const a = Number(classIdA);
  const b = Number(classIdB);

  const minId = Math.min(a, b);
  const maxId = Math.max(a, b);

  return [
    String(day),
    String(period),
    String(minId),
    String(maxId)
  ].join("_");
}


function saveAdminConflicts(
  grade,
  day,
  targetClassId,
  period,
  conflicts
) {
  if (!state.data.gasAdminConflictPairs) {
    state.data.gasAdminConflictPairs = {};
  }

  const pairs =
    state.data.gasAdminConflictPairs;

  const targetId =
    String(targetClassId).trim();

  const prefix = [
    String(day),
    String(period)
  ].join("_") + "_";
  
  // 今回変更したクラスに関係する
  // 古い重複ペアを削除
  Object.keys(pairs).forEach((key) => {
    if (!key.startsWith(prefix)) {
      return;
    }

    const parts =
      key.split("_");

    const classA =
      parts[2];

    const classB =
      parts[3];

    if (
      classA === targetId ||
      classB === targetId
    ) {
      delete pairs[key];
    }
  });

  // 今回の最新の重複を登録
  (conflicts || []).forEach(
    (conflict) => {

      const conflictClassId =
        String(
          conflict.class_id || ""
        ).trim();

      if (!conflictClassId) {
        return;
      }

      if (
        conflictClassId === targetId
      ) {
        return;
      }

      const key =
        getAdminConflictPairKey(
          day,
          period,
          targetId,
          conflictClassId
        );

      pairs[key] = true;
    }
  );
}


function hasAdminConflict(
  grade,
  day,
  classId,
  period
) {
  const pairs =
    state.data.gasAdminConflictPairs;

  if (!pairs) {
    return false;
  }

  const targetId =
    String(classId);

  const prefix = [
    String(day),
    String(period)
  ].join("_") + "_";

  return Object.keys(pairs).some(
    (key) => {

      if (!key.startsWith(prefix)) {
        return false;
      }

      const parts =
        key.split("_");

      const classA =
        parts[2];

      const classB =
        parts[3];

      return (
        classA === targetId ||
        classB === targetId
      );
    }
  );
}

function clearAdminConflictData(grade) {
  const prefix =
    `${String(grade)}_`;

  Object.keys(
    state.data.gasAdminTimetableConflicts || {}
  ).forEach((key) => {
    if (key.startsWith(prefix)) {
      delete state.data.gasAdminTimetableConflicts[key];
    }
  });
}

// ========================================
// 全学年のsubject_idを取得
// ========================================
async function fetchAllGasSubjects() {

  // すでに取得済みなら再利用
  if (state.data.gasAllSubjectsCache) {
    console.log(
      "全学年subject一覧：ブラウザキャッシュ使用"
    );

    return state.data.gasAllSubjectsCache;
  }

  // 現在取得中なら、その通信を待つ
  if (state.data.gasAllSubjectsPromise) {
    console.log(
      "全学年subject一覧：取得中の通信を共有"
    );

    return await state.data.gasAllSubjectsPromise;
  }

  // まだ取得していないので、新しく通信開始
  state.data.gasAllSubjectsPromise =
    (async () => {

      try {
        const response =
          await fetch(
            "/api/timetable?admin=subjects"
          );

        if (!response.ok) {
          throw new Error(
            `科目一覧の取得に失敗しました: ${response.status}`
          );
        }

        const result =
          await response.json();

        if (!result.success) {
          throw new Error(
            result.error ||
            "科目一覧を取得できませんでした"
          );
        }

        const subjects =
          Array.isArray(result.data)
            ? result.data
            : [];

        state.data.gasAllSubjectsCache =
          subjects;

        console.log(
          "全学年subject一覧:",
          subjects
        );

        return subjects;

      } catch (error) {

        console.error(
          "全学年subject一覧取得失敗:",
          error
        );

        showToast(
          "全学年の科目一覧の取得に失敗しました。",
          5000,
          "error"
        );

        return null;

      } finally {

        // 通信終了後はPromiseを解除
        state.data.gasAllSubjectsPromise =
          null;
      }

    })();

  return await state.data.gasAllSubjectsPromise;
}

// ========================================
// 重複判定用：全学年の時間割を取得
// ========================================
async function fetchAllAdminTimetables() {

  // 取得中の通信があれば、それを共有
  if (state.data.gasAllAdminTimetablesPromise) {

    console.log(
      "全学年時間割：取得中の通信を共有"
    );

    return await state.data.gasAllAdminTimetablesPromise;
  }

  state.data.gasAllAdminTimetablesPromise =
    (async () => {

      const results =
        await Promise.all(
          ["1", "2", "3"].map(
            async (grade) => {

              const data =
                await fetchGasAdminTimetable(grade);

              if (!data) {
                console.error(
                  `重複判定用の${grade}年時間割取得に失敗しました`
                );

                return null;
              }

              return {
                grade,
                data
              };
            }
          )
        );

      const timetables = {};

      for (const result of results) {

        if (!result) {
          return null;
        }

        timetables[result.grade] =
          result.data;
      }

      return timetables;

    })();

  try {

    return await state.data.gasAllAdminTimetablesPromise;

  } finally {

    state.data.gasAllAdminTimetablesPromise =
      null;
  }
}

// ========================================
// 1つのsubject_idを実際の科目情報へ展開
// jointなら構成科目をすべて返す
// ========================================
function getExpandedSubjectInfos(
  subjectId,
  subjectMap
) {

  const id =
    String(subjectId || "").trim();

  if (!id) {
    return [];
  }

  const subject =
    subjectMap.get(id);

  if (!subject) {
    return [];
  }

  // 通常科目
  if (
    !Array.isArray(subject.subject_ids)
  ) {
    return [subject];
  }

  // joint
  return subject.subject_ids
    .map(
      childId =>
        subjectMap.get(
          String(childId).trim()
        )
    )
    .filter(Boolean);
}


// ========================================
// 指定した日・時限において
// 候補科目が重複するか判定
// ========================================
function checkSubjectSelectionConflict(
  candidateSubject,
  targetClassId,
  day,
  period,
  allSubjects,
  allTimetables
) {

  const targetId =
    String(targetClassId || "").trim();

  const targetPeriod =
    Number(period);

  // ========================================
  // subject_id → 科目情報
  // ========================================
  const subjectMap =
    new Map();

  (allSubjects || []).forEach(
    (subject) => {

      const id =
        String(
          subject.subject_id || ""
        ).trim();

      if (!id) {
        return;
      }

      subjectMap.set(
        id,
        subject
      );
    }
  );


  // ========================================
  // 候補科目を展開
  //
  // 通常科目
  //   → その科目自身
  //
  // joint
  //   → 構成科目すべて
  // ========================================
  const candidateInfos =
    getExpandedSubjectInfos(
      candidateSubject.subject_id,
      subjectMap
    );

  if (
    candidateInfos.length === 0
  ) {
    return false;
  }


  // ========================================
  // 全学年を確認
  // ========================================
  for (
    const grade of ["1", "2", "3"]
  ) {

    const gradeData =
      allTimetables?.[grade];

    if (!gradeData) {
      continue;
    }


    // ========================================
    // この学年の指定曜日
    // ========================================
    const dayData =
      gradeData.timetable?.[day];

    if (!dayData) {
      continue;
    }


    // ========================================
    // 全クラスを確認
    // ========================================
    for (
      const otherClassId of
      Object.keys(dayData)
    ) {

      const normalizedClassId =
        String(
          otherClassId
        ).trim();


      // 編集対象クラス自身は除外
      if (
        normalizedClassId ===
        targetId
      ) {
        continue;
      }


      const timetable =
        dayData[otherClassId];

      if (
        !Array.isArray(timetable)
      ) {
        continue;
      }


      // ========================================
      // 同じ時限を探す
      // ========================================
      const periodData =
        timetable.find(
          (item) =>
            Number(item.period) ===
            targetPeriod
        );

      if (!periodData) {
        continue;
      }


      // ========================================
      // 実際に行われる科目
      //
      // subject_changeがあれば変更後、
      // なければsubject_base
      // ========================================
      const otherSubjectId =
        String(
          periodData.subject_change ||
          periodData.subject_base ||
          periodData.subject_id ||
          ""
        ).trim();

      if (!otherSubjectId) {
        continue;
      }

      // 同じjoint_id同士は重複扱いしない
      
      if (
        String(candidateSubject.subject_id || "").trim() ===
          otherSubjectId &&
        Array.isArray(
          subjectMap.get(
            String(candidateSubject.subject_id || "").trim()
          )?.subject_ids
        )
      ) {
        continue;
      }


      // ========================================
      // 相手側の科目を展開
      // ========================================
      const otherInfos =
        getExpandedSubjectInfos(
          otherSubjectId,
          subjectMap
        );


      // ========================================
      // 先生・場所を比較
      // ========================================
      for (
        const candidateInfo
        of candidateInfos
      ) {

        const candidateTeacher =
          String(
            candidateInfo.teacher_id ||
            ""
          ).trim();

        const candidatePlace =
          String(
            candidateInfo.place ||
            ""
          ).trim();


        for (
          const otherInfo
          of otherInfos
        ) {

          const otherTeacher =
            String(
              otherInfo.teacher_id ||
              ""
            ).trim();

          const otherPlace =
            String(
              otherInfo.place ||
              ""
            ).trim();


          // ------------------------------------
          // 担当教員の重複
          // ------------------------------------
          if (
            candidateTeacher &&
            otherTeacher &&
            candidateTeacher ===
              otherTeacher
          ) {

            return true;
          }


          // ------------------------------------
          // 場所の重複
          // ------------------------------------
          if (
            candidatePlace &&
            otherPlace &&
            candidatePlace ===
              otherPlace
          ) {

            return true;
          }

        }
      }
    }
  }


  return false;
}

// ========================================
// 科目ID選択ダイアログ
// ========================================
async function showSubjectSelectionDialog(
  subjects,
  currentValue,
  locationText,
  conflictContext = null
) {
  return new Promise((resolve) => {

    // ========================================
    // 背景
    // ========================================
    const overlay =
      document.createElement("div");

    overlay.className =
      "subject-selection-overlay";


    // ========================================
    // ダイアログ本体
    // ========================================
    const dialog =
      document.createElement("div");

    dialog.className =
      "subject-selection-dialog";


    // ========================================
    // タイトル
    // ========================================
    const location =
      document.createElement("div");

    location.className =
      "subject-selection-location";

    location.textContent =
      locationText || "";

    dialog.appendChild(location);


    const title =
      document.createElement("h3");

    title.textContent =
      "変更する科目を選択";

    dialog.appendChild(title);


    // ========================================
    // 検索欄
    // ========================================
    const search =
      document.createElement("input");

    search.type = "search";
    search.placeholder =
      "科目ID・科目名で検索";

    search.value =
      currentValue || "";

    search.className =
      "subject-selection-search";

    dialog.appendChild(search);


    // ========================================
    // 科目一覧
    // ========================================
    const list =
      document.createElement("div");

    list.className =
      "subject-selection-list";

    dialog.appendChild(list);


    // ========================================
    // キャンセル
    // ========================================
    const cancel =
      document.createElement("button");

    cancel.type = "button";
    cancel.textContent = "キャンセル";

    cancel.className =
      "subject-selection-cancel";

    dialog.appendChild(cancel);


    overlay.appendChild(dialog);
    document.body.appendChild(overlay);


    // ========================================
    // 一覧を表示
    // ========================================
    function renderList() {

      const keyword =
        search.value
          .trim()
          .toLowerCase();

      list.innerHTML = "";

        // ======================================
        // 変更をクリア
        // ======================================
        const clearButton =
          document.createElement("button");
        
        clearButton.type = "button";

        clearButton.className =
          "subject-selection-clear";

        clearButton.textContent =
          "変更をクリア（元の科目に戻す）";

        clearButton.addEventListener(
          "click",
          () => {
        
            overlay.remove();

            resolve("");
          }
        );

        list.appendChild(clearButton);


        const filtered =
          subjects.filter((subject) => {

          const subjectId =
            String(
              subject.subject_id || ""
            ).trim();
          
          let subjectName =
            String(
              subject.subject_name || ""
            ).trim();
          
          if (
            !/^j[A-Z]{2}\d{3}$/.test(subjectId) &&
            conflictContext
          ) {
            subjectName =
              `${subjectName}_${conflictContext.grade}${conflictContext.classNo}H`;
          }
          
          if (!keyword) {
            return true;
          }
          
          return (
            subjectId
              .toLowerCase()
              .includes(keyword) ||
            subjectName
              .toLowerCase()
              .includes(keyword)
          );
        });


      // ======================================
      // 該当なし
      // ======================================
      if (filtered.length === 0) {

        const empty =
          document.createElement("div");

        empty.className =
          "subject-selection-empty";

        empty.textContent =
          "該当する科目がありません";

        list.appendChild(empty);

        return;
      }


      // ======================================
      // 科目ボタン
      // ======================================
      filtered.forEach((subject) => {
        const subjectId =
          String(subject.subject_id || "").trim();
      
        const subjectName =
          String(subject.subject_name || "").trim();
      
        // 表示専用の科目名
        let displayName = subjectName;
      
        // jointではなく通常科目の場合だけHを付ける
        const hLabel =
          getHLabelFromSubjectId(
            subjectId,
            conflictContext?.allTimetables
          );
      
        if (hLabel) {
          displayName =
            `${subjectName}_${hLabel}`;
        }

        const button =
          document.createElement("button");

        button.type = "button";

        button.className =
          "subject-selection-item";


        // ======================================
        // 重複判定
        // ======================================
        let isConflict = false;

        if (conflictContext) {

          isConflict =
            checkSubjectSelectionConflict(
              subject,
              conflictContext.classId,
              conflictContext.day,
              conflictContext.period,
              subjects,
              conflictContext.allTimetables
            );
        }


        // ======================================
        // joint科目の色
        // ======================================
        if (
          /^j[A-Z]{2}\d{3}$/.test(subjectId)
        ) {
          button.style.backgroundColor =
            "#f4f8ff";
        }


        // ======================================
        // 重複科目は赤表示
        // ======================================
        if (isConflict) {

          button.classList.add(
            "subject-selection-conflict"
          );

          button.title =
            "担当教員または場所が他のクラスと重複します";
        }


        // 「科目ID : 科目名」の形式
        button.textContent =
          `${subjectId} : ${subjectName}`;
        
        button.addEventListener(
          "click",
          () => {

            overlay.remove();

            resolve(subjectId);
          }
        );

        list.appendChild(button);
      });
    }


    // ========================================
    // イベント
    // ========================================
    search.addEventListener(
      "input",
      renderList
    );


    cancel.addEventListener(
      "click",
      () => {

        overlay.remove();

        resolve(null);
      }
    );


    // 背景クリックでキャンセル
    overlay.addEventListener(
      "click",
      (event) => {

        if (event.target === overlay) {

          overlay.remove();

          resolve(null);
        }
      }
    );


    // ESCキーでキャンセル
    function handleKeydown(event) {

      if (event.key === "Escape") {

        overlay.remove();

        document.removeEventListener(
          "keydown",
          handleKeydown
        );

        resolve(null);
      }
    }

    document.addEventListener(
      "keydown",
      handleKeydown
    );


    // 初期表示
    renderList();

    // 検索欄にフォーカス
    setTimeout(() => {
      search.focus();
      search.select();
    }, 0);
  });
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
// subject_id から表示用のHラベルを取得
//
// class_id（末尾1桁を除く）
//   ↓
// GASのclass情報から grade / class_no を取得
//   ↓
// 「○○H」を作成
// ========================================
function getHLabelFromSubjectId(subjectId, allTimetables) {
  const id = String(subjectId || "").trim();

  // jointはHラベルを付けない
  if (/^j[A-Z]{2}\d{3}$/.test(id)) {
    return "";
  }

  // 例：
  // AD201 → 20 + 1
  // JA151 → 15 + 1
  const match = id.match(
    /^[A-Z]{2}(\d{2})\d$/
  );

  if (!match) {
    return "";
  }

  // 最後の1桁を除いた部分 = class_id
  const classId = match[1];

  // 既存のGAS class情報から探す
  for (const grade of ["1", "2", "3"]) {
    const classes =
      allTimetables?.[grade]?.classes || [];

    const gasClass = classes.find(
      (item) =>
        String(item.class_id) === classId
    );

    if (gasClass) {
      return `${gasClass.grade}${gasClass.class_no}H`;
    }
  }

  // class_idが見つからなかった場合
  return "";
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

// ========================================
// 管理画面のセルに表示する詳細情報
// ========================================
function getGasAdminSubjectTooltip(
  gasData,
  subjectId
) {
  const id =
    String(subjectId || "").trim();

  if (!id) {
    return "";
  }

  const subjects =
    Array.isArray(gasData?.subjects)
      ? gasData.subjects
      : [];

  const subject =
    subjects.find(
      (item) =>
        String(
          item?.subject_id || ""
        ).trim() === id
    );

  // 科目情報が見つからない場合
  if (!subject) {
    return [
      `科目ID: ${id}`,
      "表示名: ―",
      "先生: ―",
      "場所: ―"
    ].join("\n");
  }

  // ========================================
  // 通常科目
  // ========================================
  if (
    !Array.isArray(subject.subject_ids)
  ) {
    return [
      `表示名: ${subject.subject_name || id}`,
      `先生: ${subject.teacher_id || "―"}`,
      `場所: ${subject.place || "―"}`
    ].join("\n");
  }

  // ========================================
  // joint
  // ========================================
  const childSubjects =
    subject.subject_ids
      .map((childId) => {
        const childIdText =
          String(childId || "").trim();

        return subjects.find(
          (item) =>
            String(
              item?.subject_id || ""
            ).trim() === childIdText
        );
      })
      .filter(Boolean);

  const teacherList =
    [
      ...new Set(
        childSubjects
          .map(
            (item) =>
              String(
                item?.teacher_id || ""
              ).trim()
          )
          .filter(Boolean)
      )
    ];

  const placeList =
    [
      ...new Set(
        childSubjects
          .map(
            (item) =>
              String(
                item?.place || ""
              ).trim()
          )
          .filter(Boolean)
      )
    ];

  return [
    `表示名: ${subject.subject_name || id}`,
    `先生: ${
      teacherList.length > 0
        ? teacherList.join(" / ")
        : "―"
    }`,
    `場所: ${
      placeList.length > 0
        ? placeList.join(" / ")
        : "―"
    }`
  ].join("\n");
}
