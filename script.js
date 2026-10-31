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
  changes: "timetable.changes"
};
// ========================================
// 昔local環境で作ってた時の名残 今は空
// ========================================
window.CLASS_COURSE_OVERRIDES = {};

window.TIMETABLE_DATA = {
  periods: [1,2,3,4,5,6,7],//セルを7限目までつくる
  courses: {},
  classes: [],
  baseTimetables: {}
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
  // 0=今週、1=来週、2=再来週、3=再々来週（GAS側の週枠計算と連携）
  adminWeekOffset: 0,
  deepAdminWeekOffset: 0,
  data: {
    periods: [],
    courses: {},
    classes: [],
    baseTimetables: {},
    classCourses: {},
    changes: [],
    notifications: [],
    gasClassOptionsCache: {},
    gasClassMetadata: null,
    gasClassMetadataPromise: null,
    gasAdminTimetableCache: {},
    gasAdminConflictPairs: {},
    gasAdminTimetableConflicts: {},
    gasAdminConflictInitialized: false,
    gasAllSubjectsCache: null,
    gasAllSubjectsPromise : null,
    gasAllAdminTimetablesPromise : null,
    gasAllAdminTimetablesPromises: {},
    gasTeacherTimetableCache: {},
    gasAdminTimetablePromises: {},
    pendingTimetableEdits: {},
    pendingEditUndoStack: [],
    pendingEditRedoStack: [],
    pendingConflictCells: {},
    pendingConflictPairs: {},
    pendingConflictToastKeys: {},
    pendingConflictSubjects: null,
    pendingConflictTimetables: null,
    batchEditKeyboardInstalled: false
  }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// ========================================
// 画面上部に一時的な通知を表示
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

  // すでに表示されているToastの下に配置する
  const existingToasts =
    Array.from(
      document.querySelectorAll(".app-toast")
    ).filter(
      (item) => item !== toast
    );

  let topPosition = 20;

  existingToasts.forEach((existingToast) => {
    topPosition +=
      existingToast.offsetHeight + 12;
  });

  toast.style.top =
    `${topPosition}px`;

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
    await restoreProfile();
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
      console.log("メール未認証");
      return false;
    }

    console.log("メール認証済み",);

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
          ? "先生としてログインしました"
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
  
    // Supabase取得失敗時はお知らせを空にする
    state.data.notifications = [];
  
    showToast(
      "お知らせ・変更履歴 の取得に失敗しました。",
      5000,
      "error"
    );
  } else {
    console.log("notifications取得成功:", data);
    state.data.notifications = data || [];
  }
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

  $("#admin-week")?.addEventListener("change", () => {
    state.adminWeekOffset = Number($("#admin-week").value) || 0;
    renderQuickAdmin();
  });

  $("#deep-admin-day")?.addEventListener(
    "change",
    () => {
      state.deepAdminDay =
        $("#deep-admin-day").value;

      renderDeepAdmin();
    }
  );
  
  $("#deep-admin-week")?.addEventListener("change", () => {
    state.deepAdminWeekOffset = Number($("#deep-admin-week").value) || 0;
    renderDeepAdmin();
  });
  
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
    input.addEventListener("change", (event) => {
      const changed = event.currentTarget;
  
      // 文理の対象設定だけ、全と個別の選択を排他的にする
      if (changed.name === "target-course") {
        const form = changed.form;
        const allCheckbox = $("input[name='target-course'][value='all']", form);
        const courseCheckboxes = $$(
          "input[name='target-course']",
          form
        );
  
        if (changed.value === "all" && changed.checked) {
          // 「全」を選んだら、個別のコースを解除
          courseCheckboxes.forEach((checkbox) => {
            if (checkbox.value !== "all") {
              checkbox.checked = false;
            }
          });
        } else if (changed.value !== "all" && changed.checked) {
          // 個別のコースを選んだら、「全」を解除
          allCheckbox.checked = false;
        }
  
        // すべての選択を解除した場合は「全」に戻す
        const hasSelection = courseCheckboxes.some(
          (checkbox) => checkbox.checked
        );
  
        if (!hasSelection) {
          allCheckbox.checked = true;
        }
      }
  
      updateTargetSummary();
    });
  });
 
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
          window.open("https://docs.google.com/document/d/1ROLjYdAlIvV3b8w8YJR8LD_0AzD-XJqQ86815m-LmQo/edit?tab=t.mm7btv9ejgq1","_blank");
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

  try {
    // 現在のログインセッションを取得
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

    // 管理者一覧APIから取得
    const response = await fetch(
      "/api/admin-profile",
      {
        method: "GET",
        headers: {
          "Authorization":
            `Bearer ${session.access_token}`
        }
      }
    );

    const result =
      await response.json();

    console.log(
      "管理者一覧取得結果:",
      result
    );

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ||
        "管理者一覧の取得に失敗しました。"
      );
    }

    state.adminProfiles =
      result.data || [];

    list.replaceChildren();

    if (!state.adminProfiles.length) {
      list.append(
        createEmptyState(
          "登録されている管理者はいません。"
        )
      );

      return;
    }

    state.adminProfiles.forEach(
      (profile) => {

        const item =
          document.createElement("li");

        const role =
          document.createElement("span");

        role.textContent =
          profile.role ||
          "unknown";

        const separator =
          document.createElement("span");

        separator.textContent =
          " : ";

        const name =
          document.createElement("span");

        name.textContent =
          profile.display_name ||
          "表示名未設定";

        const userId =
          document.createElement("span");
        
        userId.className =
          "admin-profile-id-copy";
        
        userId.textContent =
          profile.user_id
            ? `(${profile.user_id.slice(0, 8)}…)`
            : "";
        
        userId.title =
          "クリックしてUser IDをコピー";
        
        userId.style.cursor =
          "pointer";
        
        userId.addEventListener(
          "click",
          async () => {
        
            if (!profile.user_id) {
              return;
            }
        
            try {
        
              await navigator.clipboard.writeText(
                profile.user_id
              );
        
              showToast(
                "User IDをコピーしました。"
              );
        
            } catch (error) {
        
              console.error(
                "User IDコピー失敗:",
                error
              );
        
              showToast(
                "User IDのコピーに失敗しました。",
                5000,
                "error"
              );
            }
          }
        );
        const deleteButton =
          document.createElement("button");

        deleteButton.type =
          "button";

        deleteButton.textContent =
          "削除";

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
      }
    );

  } catch (error) {

    console.error(
      "管理者一覧取得失敗:",
      error
    );

    showToast(
      "管理者一覧の取得に失敗しました。\n" +
      error.message,
      5000,
      "error"
    );

    list.replaceChildren(
      createEmptyState(
        "管理者一覧を取得できませんでした。"
      )
    );
  }
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

async function restoreProfile() {
  state.profile = readStored(
    STORAGE_KEYS.profile,
    state.profile
  );

  // ========================================
  // 先生モードを復元
  // ========================================
  if (state.profile.grade === "teacher") {

    // 学年select
    setSelectValue(
      "#student-grade",
      "teacher"
    );

    // 組・コースを非表示
    const classControl =
      $("#student-class")?.closest("label");

    const courseControl =
      $("#student-course")?.closest("label");

    const teacherControl =
      $("#student-teacher-control");

    if (classControl) {
      classControl.hidden = true;
    }

    if (courseControl) {
      courseControl.hidden = true;
    }

    if (teacherControl) {
      teacherControl.hidden = false;
    }

    // 先生一覧を読み込む
    await loadTeacherOptions();

    // 保存されていた先生を復元
    setSelectValue(
      "#student-teacher",
      state.profile.teacherId || ""
    );

    updateTeacherPickerLabel();

    return;
  }

  // ========================================
  // 通常の生徒モードを復元
  // ========================================

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
      showToast(
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

  const periodList =
    $(".period-list");
  
  // 読み込み中は時間割セルを表示しない
  if (periodList) {
    periodList.hidden = true;
  }
  
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
  
  // class_id → 年組を調べるためのクラス情報を用意
  if (!state.data.gasClassMetadata) {
    state.data.gasClassMetadata =
      await fetchClassMetadata();
  }
  
  const data =
    await fetchTeacherDayTimetable(
      teacherId,
      selectedDay
    );


  if (!data) {
    return;
  }
  
  // 読み込み完了後に時間割を表示
  if (periodList) {
    periodList.hidden = false;
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
          .map((item) => {
      
            const subjectName =
              String(
                item.subject_name || ""
              ).trim();
      
            const subjectId =
              String(
                item.subject_id || ""
              ).trim();
      
            // =====================================
            // joint
            // joint_nameはそのまま表示
            // =====================================
            if (item.is_joint === true) {
              return subjectName;
            }
      
            // =====================================
            // 通常科目
            // class_idからHを生成
            // =====================================
            const hLabel =
              getHLabelFromClassId(
                item.class_id,
                state.data.gasClassMetadata
              );
      
            if (hLabel) {
              return `${subjectName}_${hLabel}`;
            }
      
            return subjectName;
          })
          .filter(Boolean);
      
      subjectNode.textContent =
        names.join(" / ");
    }
  );
}

function updateStudentDayChipColor() {
  const daySelect = document.getElementById("student-day");
  if (!daySelect) return;

  const selectedDay = daySelect.value || "月";

  const dayNumber = {
    "月": 1,
    "火": 2,
    "水": 3,
    "木": 4,
    "金": 5
  };

  const todayNumber = new Date().getDay();
  const selectedNumber = dayNumber[selectedDay];

  if (selectedNumber === undefined) return;

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
  if (!dayChip) return;

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

async function renderStudent() {

  applyStudentTheme();

  // 曜日に応じて背景色を更新（先生・生徒共通）
  updateStudentDayChipColor();

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

    applyStudentTheme({
      ...state.profile,
      grade: "teacher",
      classNo: "teacher",
      course: "teacher"
    });

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

  applyStudentTheme();


  // ========================================
  // GASから現在の年組データを取得
  //
  // 年組ごとに1回だけ取得し、
  // 文系・理系などのコースはブラウザ側で切り替える
  // ========================================

  const periodList =
    $(".period-list");
  
  // 読み込み中は時間割セルを表示しない
  if (periodList) {
    periodList.hidden = true;
  }
  
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

    if (
        firstCourse === undefined ||
        firstCourse === null
      ) {

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

    applyStudentTheme();
  }

  console.log(
    "現在表示するコース:",
    state.profile.course
  );

  console.log(
    "現在表示する時間割データ:",
    gasData
  );
  
  updateStudentDayChipColor();


  // 曜日を取得
  const selectedDay =
    document.getElementById("student-day")?.value || "月";

  // 読み込み完了後に時間割を表示
  if (periodList) {
    periodList.hidden = false;
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

function applyStudentTheme(profile = state.profile) {
  const grade =
    profile.grade || "";

  const classNo =
    profile.classNo || "";

  const course =
    grade === "teacher"
      ? "teacher"
      : normalizeCourseTheme(
          profile.course || "none"
        );

  [
    $("#student-profile-controls"),
    $(".timetable-panel")
  ].forEach((element) => {
    if (!element) return;

    element.dataset.grade = grade;
    element.dataset.class = classNo;
    element.dataset.course = course;
  });
}

function renderStudentNotices() {
  const container = $("#student-notices");
  if (!container) return;

  const notices = state.data.notifications.filter((notice) => {
    const active = isNotificationActive(notice);
    const targetMatch = matchesTargets(notice.targets, state.profile);
    const kindMatch = notice.kind === "notice";
    
    return kindMatch && active && targetMatch;
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

  ensureBatchEditToolbar("quick");
  installBatchEditKeyboardShortcuts();

  
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
   fetchGasAdminTimetable(grade, state.adminWeekOffset);
  
  
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

  installQuickExportButton(matrix, grade, state.adminDay || "月", gasData);

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

      const pendingEdit = getPendingTimetableEdit(
        "updateTimetableChange",
        classId,
        day,
        period,
        grade
      );
      const changeSubjectId = pendingEdit
        ? pendingEdit.subjectChange
        : (timetableItem?.subject_change || "");

      const displayName =
        changeSubjectId || "";

      const isChanged =
        Boolean(changeSubjectId);
      const isConflict =
        hasAdminCellConflict(
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
            timetableItem || null
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
          ? `<small>${escapeHtml(formatTargets(post.targets))}</small>`
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

  ensureBatchEditToolbar("deep");
  installBatchEditKeyboardShortcuts();
  state.deepAdminDay = day;

  if (
    !state.data.gasAdminConflictInitialized
  ) {

    await fetchInitialAdminConflicts();

    state.data.gasAdminConflictInitialized =
      true;

  }
  
  // 浅い管理画面と同じGASデータを使用
  const gasData = await fetchGasAdminTimetable(grade, state.deepAdminWeekOffset);

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

    // 先生の表示名を取得してから時間割セルを作る
  await loadAdminProfiles();
    
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

      // 基本時間割。未保存の編集があれば、その値を画面に表示する。
      const pendingBaseEdit = getPendingTimetableEdit(
        "updateTimetableBase",
        classId,
        day,
        period,
        grade
      );
      const displaySubjectId = pendingBaseEdit
        ? pendingBaseEdit.subjectBase
        : (timetableItem?.subject_base || "");
      
      // 未保存編集を含めて再計算した重複状態を表示する。
      const isConflict =
        hasAdminCellConflict(
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
      classItem.courseLabel ||
      state.data.courses[classItem.course] ||
      "";


    const label =
      `<span class="matrix-header-class-label">${escapeHtml(classItem.label)}</span>` +
      (courseLabel
        ? `<span class="matrix-header-course-label">${escapeHtml(courseLabel)}</span>`
        : "");


    const cell =
      createCell(
        label,
        "div",
        `matrix-cell matrix-cell--class-header ${getSubjectClass(classItem.course)}`,
        true
      );

    matrix.append(cell);
  });
}


/* ========================================
   浅い管理画面：時間割の画像保存・印刷
   ======================================== */

function closeQuickExportMenu() {
  document.getElementById("quick-export-menu")?.remove();
}

function installQuickExportButton(matrix, grade, day, gasData) {
  closeQuickExportMenu();

  const corner = matrix.firstElementChild;
  if (!corner) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "matrix-cell matrix-cell--corner matrix-export-trigger";
  button.setAttribute("aria-label", "時間割を保存・印刷");
  button.title = "時間割を画像保存・印刷";

  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  corner.replaceWith(button);

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    closeQuickExportMenu();

    const menu = document.createElement("div");
    menu.id = "quick-export-menu";
    menu.className = "quick-export-menu";
    menu.innerHTML = `
      <button type="button" data-export-action="png">
        <span aria-hidden="true">▧</span>
        画像として保存（PNG）
      </button>
      <button type="button" data-export-action="print">
        <span aria-hidden="true">▤</span>
        印刷する
      </button>
    `;

    document.body.appendChild(menu);

    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(
      8,
      Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)
    )}px`;
    menu.style.top = `${Math.min(
      rect.bottom + 6,
      window.innerHeight - menu.offsetHeight - 8
    )}px`;

    menu.querySelector('[data-export-action="png"]')
      .addEventListener("click", async () => {
        closeQuickExportMenu();
        try {
          await downloadQuickTimetablePng(grade, day, gasData);
        } catch (error) {
          console.error("時間割PNG保存エラー:", error);
          showToast("画像の保存に失敗しました。", 4000, "error");
        }
      });

    menu.querySelector('[data-export-action="print"]')
      .addEventListener("click", () => {
        closeQuickExportMenu();
        printQuickTimetable(grade, day, gasData);
      });

    const closeOnOutsideClick = (e) => {
      if (!menu.contains(e.target) && e.target !== button) {
        closeQuickExportMenu();
        document.removeEventListener("click", closeOnOutsideClick);
      }
    };

    setTimeout(() => {
      document.addEventListener("click", closeOnOutsideClick);
    }, 0);
  });
}


async function getQuickExportData(grade, day, gasData) {
  const classes = gasData.classes || [];
  const dayData = gasData.timetable?.[day] || {};
  const subjects = gasData.subjects || [];

  // UUIDと先生の表示名を対応させる
  let profiles = state.adminProfiles || [];

  try {
    const { data, error } = await window.supabaseClient
      .from("admin_profiles")
      .select("user_id, display_name");

    if (!error && Array.isArray(data)) {
      profiles = data;
    }
  } catch (error) {
    console.error("先生の表示名取得に失敗:", error);
  }

  function getTeacherName(subject) {
    const teacherId = String(subject?.teacher_id || "").trim();
    if (!teacherId) return "";

    const profile = profiles.find(
      (item) => String(item.user_id || "").trim() === teacherId
    );

    // UUIDならプロフィールの表示名、直接入力された名前ならその名前
    return profile?.display_name || teacherId;
  }

  // 今日を含め、次に来る対象曜日の日付を計算
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const targetWeekday = weekdays.indexOf(day);

  const targetDate = new Date(today);

  if (targetWeekday >= 0) {
    const daysUntil = (targetWeekday - today.getDay() + 7) % 7;
    targetDate.setDate(targetDate.getDate() + daysUntil);
  }

  const pad = (number) => String(number).padStart(2, "0");
  const targetDateISO = [
    targetDate.getFullYear(),
    pad(targetDate.getMonth() + 1),
    pad(targetDate.getDate())
  ].join("-");

  const date = [
    targetDate.getFullYear(),
    pad(targetDate.getMonth() + 1),
    pad(targetDate.getDate())
  ].join("/");

  const exportedAt = new Date().toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  const rows = state.data.periods.map((period) => ({
    period,
    cells: classes.map((gasClass) => {
      const classId = String(gasClass.class_id);
      const timetable = dayData[classId] || [];

      const item = timetable.find(
        (entry) => Number(entry.period) === Number(period)
      );

      // 変更された科目だけを表示。基本時間割では補完しない
      const subjectId = item?.subject_change || "";

      if (!subjectId) {
        return { subject: "", teacher: "" };
      }

      const subject = subjects.find(
        (entry) => String(entry.subject_id) === String(subjectId)
      );

      let teacherNames = [];

      if (Array.isArray(subject?.subject_ids)) {
        teacherNames = subject.subject_ids
          .map((id) =>
            subjects.find(
              (entry) => String(entry.subject_id) === String(id)
            )
          )
          .map(getTeacherName)
          .filter(Boolean);
      } else if (subject) {
        const name = getTeacherName(subject);
        if (name) teacherNames = [name];
      }

      const uniqueTeacherNames = [...new Set(teacherNames)];

      return {
        subject: getGasAdminSubjectDisplayName(
          gasData,
          subjectId,
          item
        ),
        teacher: uniqueTeacherNames
          .map((name) =>
            name.endsWith("先生") ? name : `${name}先生`
          )
          .join(" / ")
      };
    })
  }));

  return {
    grade,
    day,
    date,
    targetDateISO,
    exportedAt,
    classes: classes.map((gasClass) => ({
      ...convertGasClassForDisplay(gasClass),
      courseLabel: String(gasClass.course || "").trim()
    })),
    rows
  };
}

function drawWrappedCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const chars = Array.from(String(text || ""));
  let line = "";
  let lineNumber = 0;

  for (const char of chars) {
    const testLine = line + char;

    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineNumber * lineHeight);
      lineNumber++;
      line = char;

      if (lineNumber >= maxLines - 1) break;
    } else {
      line = testLine;
    }
  }

  if (line && lineNumber < maxLines) {
    ctx.fillText(line, x, y + lineNumber * lineHeight);
  }
}

async function downloadQuickTimetablePng(grade, day, gasData) {
  const data = await getQuickExportData(grade, day, gasData);
  const periodWidth = 64;
  const cellWidth = Math.max(115, Math.min(175, 1100 / data.classes.length));
  const cellHeight = 100;
  const left = 24;
  const top = 112;
  const width = left * 2 + periodWidth + cellWidth * data.classes.length;
  const height = top + cellHeight * (data.rows.length + 1) + 24;

  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#222222";
  ctx.textAlign = "left";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(`${data.grade}年生 時間割`, left, 38);

  ctx.font = "14px sans-serif";
  ctx.fillText(
    `${data.day}曜日　対象日: ${data.date}`,
    left,
    62
  );
  
  ctx.font = "12px sans-serif";
  ctx.fillText(
    `出力日時: ${data.exportedAt}`,
    left,
    82
  );

  const tableX = left;
  const tableY = top;
  const tableWidth = periodWidth + cellWidth * data.classes.length;

  ctx.strokeStyle = "#555555";
  ctx.lineWidth = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const drawCell = (x, y, w, h, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#555555";
    ctx.strokeRect(x, y, w, h);
  };

  drawCell(tableX, tableY, periodWidth, cellHeight, "#eeeeee");
  ctx.fillStyle = "#222222";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText("時限", tableX + periodWidth / 2, tableY + cellHeight / 2);

  data.classes.forEach((cls, index) => {
    const x = tableX + periodWidth + index * cellWidth;
    drawCell(x, tableY, cellWidth, cellHeight, "#eeeeee");
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "#222222";
    ctx.fillText(`${cls.label}`, x + cellWidth / 2, tableY + 34);
    ctx.font = "12px sans-serif";
    ctx.fillText(
      cls.courseLabel || state.data.courses[cls.course] || "",
      x + cellWidth / 2,
      tableY + 60
    );
  });

  data.rows.forEach((row, rowIndex) => {
    const y = tableY + cellHeight * (rowIndex + 1);
    drawCell(tableX, y, periodWidth, cellHeight, "#eeeeee");

    ctx.fillStyle = "#222222";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(`${row.period}限`, tableX + periodWidth / 2, y + cellHeight / 2);

    row.cells.forEach((cell, colIndex) => {
      const x = tableX + periodWidth + colIndex * cellWidth;
      drawCell(x, y, cellWidth, cellHeight, "#ffffff");

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#222222";
      ctx.font = "bold 14px sans-serif";
      drawWrappedCanvasText(
        ctx, cell.subject, x + cellWidth / 2, y + 27,
        cellWidth - 12, 17, 2
      );

      ctx.strokeStyle = "#888888";
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 57);
      ctx.lineTo(x + cellWidth - 8, y + 57);
      ctx.stroke();

      ctx.font = "12px sans-serif";
      drawWrappedCanvasText(
        ctx, cell.teacher, x + cellWidth / 2, y + 77,
        cellWidth - 12, 15, 2
      );
    });
  });

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("PNGを生成できませんでした"));
    }, "image/png");
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
  `時間割変更_${data.grade}年_${data.targetDateISO}.png`;
  link.click();
  URL.revokeObjectURL(url);
}

async function printQuickTimetable(grade, day, gasData) {
  // 非同期処理より先に開き、ポップアップ制限を避ける
  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    showToast(
      "印刷画面を開けませんでした。ポップアップを許可してください。",
      5000,
      "error"
    );
    return;
  }

  const data = await getQuickExportData(grade, day, gasData);

  const escape = (value) => escapeHtml(String(value || ""));

  const headers = data.classes.map((cls) => `
    <th>
      <div>${escape(cls.label)}</div>
      <small>${escape(
        cls.courseLabel || state.data.courses[cls.course] || ""
      )}</small>
    </th>
  `).join("");

  const rows = data.rows.map((row) => `
    <tr>
      <th class="period">${row.period}限</th>
      ${row.cells.map((cell) => `
        <td>
          <div class="subject">${escape(cell.subject)}</div>
          <div class="separator"></div>
          <div class="teacher">${escape(cell.teacher)}</div>
        </td>
      `).join("")}
    </tr>
  `).join("");

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <title>${escape(
        `時間割変更_${data.grade}年_${data.targetDateISO}`
      )}</title>
      <style>
        @page { size: A4 landscape; margin: 8mm; }
        * { box-sizing: border-box; }
        body { font-family: sans-serif; color: #222; margin: 0; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        .meta { margin-bottom: 10px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #555; padding: 4px; text-align: center; }
        thead th, .period { background: #eee; }
        td { height: 20mm; }
        .subject { font-size: 12px; font-weight: bold; overflow-wrap: anywhere; }
        .separator { border-top: 1px solid #999; margin: 6px 0; }
        .teacher { font-size: 10px; overflow-wrap: anywhere; }
        small { font-size: 9px; font-weight: normal; }
        @media screen {
          body { padding: 16px; }
          .print-button { margin-bottom: 12px; padding: 8px 16px; }
        }
        @media print {
          .print-button { display: none; }
        }
      </style>
    </head>
    <body>
      <button class="print-button" onclick="window.print()">印刷する</button>
      <h1>${escape(data.grade)}年生 時間割</h1>
      <div class="meta">
        ${escape(data.day)}曜日　
        対象日: ${escape(data.date)}　
        出力日時: ${escape(data.exportedAt)}
      </div>
      <table>
        <thead><tr><th class="period">時限</th>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ========================================
// 管理画面の一括編集・Undo/Redo
// ========================================
function cloneTimetableEditMap(source = {}) {
  return JSON.parse(JSON.stringify(source));
}

function getTimetableEditKey(action, classId, day, period, grade, weekOffset = 0) {
  return [
    action,
    String(grade),
    String(classId),
    String(day),
    String(period),
    action === "updateTimetableChange" ? `w${Number(weekOffset) || 0}` : "base"

  ].join("|");
}

function getPendingTimetableEdit(action, classId, day, period, grade) {
  const edits = state.data.pendingTimetableEdits || {};
  if (grade !== undefined && grade !== null) {
    const weekOffset = action === "updateTimetableChange" ? state.adminWeekOffset : 0;
    return edits[getTimetableEditKey(action, classId, day, period, grade, weekOffset)] || null;

  }

  return Object.values(edits).find(edit =>
    edit.action === action &&
    String(edit.classId) === String(classId) &&
    String(edit.day) === String(day) &&
    Number(edit.period) === Number(period)
  ) || null;
}

function getPendingEditCount(action = null) {
  return Object.values(state.data.pendingTimetableEdits || {})
    .filter(edit => !action || edit.action === action)
    .length;
}

function hasAdminCellConflict(grade, day, classId, period) {
  // 全時間割を使ったローカル再計算が済んでいれば、それを優先する。
  // これにより、未保存編集で解消した重複が古いサーバー結果で赤く残らない。
  if (state.data.pendingConflictTimetables) {
    return Boolean(
      state.data.pendingConflictCells?.[`${day}|${period}|${classId}`]
    );
  }
  return hasAdminConflict(grade, day, classId, period);
}

function installBatchEditKeyboardShortcuts() {
  if (state.data.batchEditKeyboardInstalled) return;
  state.data.batchEditKeyboardInstalled = true;

  window.addEventListener("beforeunload", event => {
    if (getPendingEditCount() > 0) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  document.addEventListener("keydown", event => {
    if (
      state.view !== "quick-admin" &&
      state.view !== "deep-admin"
    ) return;

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      )
    ) return;

    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;

    const key = String(event.key || "").toLowerCase();

    if (key === "z" && event.shiftKey) {
      if (state.data.pendingEditRedoStack.length) {
        event.preventDefault();
        redoPendingTimetableEdit();
      }
      return;
    }

    if (key === "z") {
      if (state.data.pendingEditUndoStack.length > 1) {
        event.preventDefault();
        undoPendingTimetableEdit();
      }
      return;
    }

    if (key === "y") {
      if (state.data.pendingEditRedoStack.length) {
        event.preventDefault();
        redoPendingTimetableEdit();
      }
    }
  });
}

function ensureBatchEditToolbar(mode) {
  const matrix = mode === "quick"
    ? $("#change-matrix")
    : $("#base-matrix");
  if (!matrix) return;

  const panel = matrix.closest(".matrix-panel");
  if (!panel) return;

  let toolbar = panel.querySelector(".batch-edit-toolbar");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.className = "batch-edit-toolbar";
    toolbar.innerHTML = `
      <div class="batch-edit-toolbar__summary" aria-live="polite">
        <strong class="batch-edit-count">未保存の変更はありません</strong>
        <span class="batch-edit-hint">編集内容は「まとめて保存」するまで反映されません。</span>
      </div>
      <div class="batch-edit-toolbar__actions">
        <button type="button" class="batch-edit-undo">元に戻す</button>
        <button type="button" class="batch-edit-redo">やり直す</button>
        <button type="button" class="batch-edit-discard">変更を破棄</button>
        <button type="button" class="batch-edit-save">まとめて保存</button>
      </div>
    `;
    panel.insertBefore(toolbar, matrix);

    toolbar.querySelector(".batch-edit-undo").addEventListener("click", undoPendingTimetableEdit);
    toolbar.querySelector(".batch-edit-redo").addEventListener("click", redoPendingTimetableEdit);
    toolbar.querySelector(".batch-edit-discard").addEventListener("click", () => {
      const action = mode === "quick"
        ? "updateTimetableChange"
        : "updateTimetableBase";
      discardPendingTimetableEdits(action);
    });
    toolbar.querySelector(".batch-edit-save").addEventListener("click", () => {
      const action = mode === "quick"
        ? "updateTimetableChange"
        : "updateTimetableBase";
      savePendingTimetableEdits(action);
    });
  }

  toolbar.dataset.mode = mode;
  updateBatchEditToolbar();
}

function updateBatchEditToolbar() {
  document.querySelectorAll(".batch-edit-toolbar").forEach(toolbar => {
    const mode = toolbar.dataset.mode;
    const action = mode === "quick"
      ? "updateTimetableChange"
      : "updateTimetableBase";
    const count = getPendingEditCount(action);
    const countElement = toolbar.querySelector(".batch-edit-count");
    const saveButton = toolbar.querySelector(".batch-edit-save");
    const discardButton = toolbar.querySelector(".batch-edit-discard");
    const undoButton = toolbar.querySelector(".batch-edit-undo");
    const redoButton = toolbar.querySelector(".batch-edit-redo");

    if (countElement) {
      countElement.textContent = count
        ? `未保存の変更：${count}件`
        : "未保存の変更はありません";
    }
    if (saveButton) saveButton.disabled = count === 0;
    if (discardButton) discardButton.disabled = count === 0;
    if (undoButton) undoButton.disabled = state.data.pendingEditUndoStack.length <= 1;
    if (redoButton) redoButton.disabled = state.data.pendingEditRedoStack.length === 0;
  });
}

function recordPendingEditSnapshot() {
  const snapshot = cloneTimetableEditMap(state.data.pendingTimetableEdits || {});
  state.data.pendingEditUndoStack.push(snapshot);
  if (state.data.pendingEditUndoStack.length > 100) {
    state.data.pendingEditUndoStack.shift();
  }
  state.data.pendingEditRedoStack = [];
}

function refreshBatchEditScreen() {
  updateBatchEditToolbar();
  if (state.view === "quick-admin") {
    renderQuickAdmin();
  } else if (state.view === "deep-admin") {
    renderDeepAdmin();
  }
}

async function updatePendingConflictState(allSubjects = state.data.pendingConflictSubjects,
                                         allTimetables = state.data.pendingConflictTimetables) {
  if (!Array.isArray(allSubjects) || !allTimetables) {
    const [subjects, timetables] = await Promise.all([
      fetchAllGasSubjects(),
      fetchAllAdminTimetables()
    ]);
    if (!subjects || !timetables) return;
    allSubjects = subjects;
    allTimetables = timetables;
  }

  state.data.pendingConflictSubjects = allSubjects;
  state.data.pendingConflictTimetables = allTimetables;

  const stagedTimetables = cloneTimetableEditMap(allTimetables);
  Object.values(state.data.pendingTimetableEdits || {}).forEach(edit => {
    const gradeData = stagedTimetables[String(edit.grade)];
    const dayData = gradeData?.timetable?.[edit.day];
    const timetable = dayData?.[String(edit.classId)];
    if (!Array.isArray(timetable)) return;

    const item = timetable.find(row => Number(row.period) === Number(edit.period));
    if (!item) return;

    if (edit.action === "updateTimetableChange") {
      item.subject_change = edit.subjectChange;
    } else if (edit.action === "updateTimetableBase") {
      item.subject_base = edit.subjectBase;
    }
  });

  const subjectMap = new Map();
  allSubjects.forEach(subject => {
    const id = String(subject.subject_id || "").trim();
    if (id) subjectMap.set(id, subject);
  });

  const conflictCells = {};
  const conflictPairs = {};
  const weekdays = ["月", "火", "水", "木", "金"];

  const getEffectiveId = item => String(
    item?.subject_change ||
    item?.subject_base ||
    item?.subject_id ||
    ""
  ).trim();

  const hasOverlap = (idA, idB) => {
    if (!idA || !idB) return [];
    const subjectA = subjectMap.get(idA);
    const subjectB = subjectMap.get(idB);
    if (!subjectA || !subjectB) return [];

    if (
      idA === idB &&
      Array.isArray(subjectA.subject_ids)
    ) return [];

    const infosA = getExpandedSubjectInfos(idA, subjectMap);
    const infosB = getExpandedSubjectInfos(idB, subjectMap);
    const types = [];

    infosA.forEach(a => infosB.forEach(b => {
      const teacherA = String(a.teacher_id || "").trim();
      const teacherB = String(b.teacher_id || "").trim();
      const placeA = String(a.place || "").trim();
      const placeB = String(b.place || "").trim();

      if (teacherA && teacherA === teacherB) types.push("teacher");
      if (placeA && placeA === placeB) types.push("place");
    }));

    return [...new Set(types)];
  };

  weekdays.forEach(day => {
    const periodEntries = new Map();

    ["1", "2", "3"].forEach(grade => {
      const dayData = stagedTimetables[grade]?.timetable?.[day] || {};
      Object.keys(dayData).forEach(classId => {
        const timetable = dayData[classId];
        if (!Array.isArray(timetable)) return;

        timetable.forEach(item => {
          const period = Number(item.period);
          const subjectId = getEffectiveId(item);
          if (!subjectId) return;

          if (!periodEntries.has(period)) periodEntries.set(period, []);
          periodEntries.get(period).push({
            grade,
            classId: String(classId),
            period,
            subjectId
          });
        });
      });
    });

    periodEntries.forEach((entries, period) => {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i];
          const b = entries[j];
          if (a.classId === b.classId) continue;

          const types = hasOverlap(a.subjectId, b.subjectId);
          if (!types.length) continue;

          const keyA = `${day}|${period}|${a.classId}`;
          const keyB = `${day}|${period}|${b.classId}`;
          conflictCells[keyA] = true;
          conflictCells[keyB] = true;
          const pair = [a.classId, b.classId].sort((x, y) => Number(x) - Number(y));
          conflictPairs[`${day}|${period}|${pair[0]}|${pair[1]}`] = types;
        }
      }
    });
  });

  const previous = state.data.pendingConflictCells || {};
  state.data.pendingConflictCells = conflictCells;
  state.data.pendingConflictPairs = conflictPairs;

  const editedCellKeys = Object.values(state.data.pendingTimetableEdits || {})
    .map(edit => `${edit.day}|${edit.period}|${edit.classId}`);
  const newlyConflictingEditedCell = editedCellKeys.some(key =>
    conflictCells[key] && !previous[key]
  );
  if (newlyConflictingEditedCell) {
    showToast(
      "編集中の時間割に担当教員または場所の重複があります。該当セルを赤く表示しています。",
      5000,
      "error"
    );
  }
}

function stageTimetableEdit({
  action,
  classItem,
  day,
  period,
  originalValue,
  newValue
}) {
  const normalizedNewValue = String(newValue ?? "").trim();
  const normalizedOriginalValue = String(originalValue ?? "").trim();
  const key = getTimetableEditKey(
    action,
    classItem.id,
    day,
    period,
    classItem.grade,
    action === "updateTimetableChange" ? state.adminWeekOffset : 0
  );

  if (!state.data.pendingEditUndoStack.length) {
    state.data.pendingEditUndoStack.push(
      cloneTimetableEditMap(state.data.pendingTimetableEdits || {})
    );
  }

  if (normalizedNewValue === normalizedOriginalValue) {
    delete state.data.pendingTimetableEdits[key];
  } else {
    state.data.pendingTimetableEdits[key] = {
      key,
      action,
      classId: String(classItem.id),
      grade: String(classItem.grade),
      classNo: String(classItem.classNo || ""),
      course: String(classItem.course || ""),
      classLabel: String(classItem.label || `${classItem.grade}年${classItem.classNo}組`),
      day,
      period: Number(period),
      weekOffset: action === "updateTimetableChange" ? state.adminWeekOffset : null,
      originalValue: normalizedOriginalValue,
      newValue: normalizedNewValue,
      ...(action === "updateTimetableChange"
        ? { subjectChange: normalizedNewValue, teacherChange: "" }
        : { subjectBase: normalizedNewValue })
    };
  }

  state.data.pendingEditUndoStack.push(
    cloneTimetableEditMap(state.data.pendingTimetableEdits || {})
  );
  if (state.data.pendingEditUndoStack.length > 100) {
    state.data.pendingEditUndoStack.shift();
  }
  state.data.pendingEditRedoStack = [];

  updateBatchEditToolbar();
  updatePendingConflictState().then(() => {
    refreshBatchEditScreen();
  }).catch(error => {
    console.error("編集中の重複判定に失敗:", error);
  });
  refreshBatchEditScreen();
}

async function restorePendingEditSnapshot(snapshot) {
  state.data.pendingTimetableEdits = cloneTimetableEditMap(snapshot || {});
  await updatePendingConflictState();
  refreshBatchEditScreen();
}

async function undoPendingTimetableEdit() {
  const stack = state.data.pendingEditUndoStack;
  if (stack.length <= 1) return;

  const current = stack.pop();
  state.data.pendingEditRedoStack.push(current);
  const previous = stack[stack.length - 1] || {};
  await restorePendingEditSnapshot(previous);
  showToast("直前の編集を元に戻しました。");
}

async function redoPendingTimetableEdit() {
  const stack = state.data.pendingEditRedoStack;
  if (!stack.length) return;

  const next = stack.pop();
  state.data.pendingEditUndoStack.push(cloneTimetableEditMap(next));
  await restorePendingEditSnapshot(next);
  showToast("編集をやり直しました。");
}

async function discardPendingTimetableEdits(action) {
  const current = state.data.pendingTimetableEdits || {};
  const count = getPendingEditCount(action);
  if (!count) return;

  const kept = {};
  Object.entries(current).forEach(([key, edit]) => {
    if (edit.action !== action) kept[key] = edit;
  });

  if (!state.data.pendingEditUndoStack.length) {
    state.data.pendingEditUndoStack.push(
      cloneTimetableEditMap(current)
    );
  }
  state.data.pendingTimetableEdits = kept;
  state.data.pendingEditUndoStack.push(cloneTimetableEditMap(kept));
  state.data.pendingEditRedoStack = [];
  state.data.pendingConflictToastKeys = {};
  await updatePendingConflictState();
  refreshBatchEditScreen();
  showToast(`${count}件の未保存変更を破棄しました。`);
}

function getCurrentCellSubject(data, day, classId, period, field) {
  const item = data?.timetable?.[day]?.[String(classId)]?.find(
    row => Number(row.period) === Number(period)
  );
  return String(item?.[field] || "");
}

async function editChange(classItem, period, existingChange) {
  const [allSubjects, allTimetables] = await Promise.all([
    fetchAllGasSubjects(),
    fetchAllAdminTimetables()
  ]);

  if (!allSubjects) {
    showToast("科目一覧を取得できませんでした。\n時間割データを確認してください。");
    return;
  }
  if (!allTimetables) {
    showToast("重複判定用の時間割を取得できませんでした。\n時間割データを確認してください。");
    return;
  }

  const day = state.adminDay || "月";
  const gradeData = allTimetables[String(classItem.grade)];
  const currentBase = getCurrentCellSubject(gradeData, day, classItem.id, period, "subject_base");
  const currentServerValue = getCurrentCellSubject(gradeData, day, classItem.id, period, "subject_change");
  const pending = getPendingTimetableEdit(
    "updateTimetableChange", classItem.id, day, period, classItem.grade
  );
  const currentValue = pending
    ? pending.subjectChange
    : (currentServerValue || existingChange?.subject_change || existingChange?.subject || "");

  const stagedTimetables = cloneTimetableEditMap(allTimetables);
  Object.values(state.data.pendingTimetableEdits || {}).forEach(edit => {
    const rows = stagedTimetables[String(edit.grade)]?.timetable?.[edit.day]?.[String(edit.classId)];
    const item = Array.isArray(rows)
      ? rows.find(row => Number(row.period) === Number(edit.period))
      : null;
    if (!item) return;
    if (edit.action === "updateTimetableChange") item.subject_change = edit.subjectChange;
    if (edit.action === "updateTimetableBase") item.subject_base = edit.subjectBase;
  });

  const subjectChange = await showSubjectSelectionDialog(
    allSubjects,
    currentValue,
    `${day}曜日　${classItem.grade}年${classItem.classNo}組 ${state.data.courses[classItem.course] || ""}　${period}限目`,
    {
      classId: classItem.id,
      day,
      period,
      allTimetables: stagedTimetables,
      grade: classItem.grade,
      classNo: classItem.classNo
    }
  );

  if (subjectChange === null) return;

  if (subjectChange !== "" && !allSubjects.some(subject =>
    String(subject.subject_id).trim() === String(subjectChange).trim()
  )) {
    showToast(`存在しないsubject_idです。\n\n${subjectChange}`);
    return;
  }

  stageTimetableEdit({
    action: "updateTimetableChange",
    classItem,
    day,
    period,
    originalValue: currentServerValue,
    newValue: subjectChange
  });
  if (subjectChange === "" && !currentBase) {
    showToast("このセルの変更科目を空欄にしました。保存すると基本時間割に戻ります。");
  }
}

async function editBaseSubject(classItem, period, currentSubject) {
  const [allSubjects, allTimetables] = await Promise.all([
    fetchAllGasSubjects(),
    fetchAllAdminTimetables()
  ]);

  if (!allSubjects) {
    showToast("科目一覧を取得できませんでした。\n時間割データを確認してください。");
    return;
  }
  if (!allTimetables) {
    showToast("重複判定用の時間割を取得できませんでした。\n時間割データを確認してください。");
    return;
  }

  const day = state.deepAdminDay || state.adminDay || "月";
  const gradeData = allTimetables[String(classItem.grade)];
  const currentServerValue = getCurrentCellSubject(
    gradeData, day, classItem.id, period, "subject_base"
  );
  const pending = getPendingTimetableEdit(
    "updateTimetableBase", classItem.id, day, period, classItem.grade
  );
  const currentValue = pending ? pending.subjectBase : currentServerValue;

  const stagedTimetables = cloneTimetableEditMap(allTimetables);
  Object.values(state.data.pendingTimetableEdits || {}).forEach(edit => {
    const rows = stagedTimetables[String(edit.grade)]?.timetable?.[edit.day]?.[String(edit.classId)];
    const item = Array.isArray(rows)
      ? rows.find(row => Number(row.period) === Number(edit.period))
      : null;
    if (!item) return;
    if (edit.action === "updateTimetableChange") item.subject_change = edit.subjectChange;
    if (edit.action === "updateTimetableBase") item.subject_base = edit.subjectBase;
  });

  const subjectId = await showSubjectSelectionDialog(
    allSubjects,
    currentValue || currentSubject || "",
    `${classItem.label}　${state.data.courses[classItem.course] || ""}　${period}限目（基本時間割）`,
    {
      classId: classItem.id,
      day,
      period,
      allTimetables: stagedTimetables,
      grade: classItem.grade,
      classNo: classItem.classNo
    }
  );

  if (subjectId === null) return;

  if (subjectId !== "" && !allSubjects.some(subject =>
    String(subject.subject_id).trim() === String(subjectId).trim()
  )) {
    showToast(`存在しないsubject_idです。\n\n${subjectId}`);
    return;
  }

  stageTimetableEdit({
    action: "updateTimetableBase",
    classItem,
    day,
    period,
    originalValue: currentServerValue,
    newValue: subjectId
  });
}

function getTokyoDateString() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).replaceAll("/", "-");
}

async function savePendingTimetableEdits(action) {
  const edits = Object.values(state.data.pendingTimetableEdits || {})
    .filter(edit => edit.action === action);

  if (!edits.length) {
    showToast("保存する変更はありません。");
    return;
  }

  const {
    data: { session },
    error: sessionError
  } = await window.supabaseClient.auth.getSession();

  if (sessionError || !session?.access_token) {
    showToast("ログイン状態を確認できません。再ログインしてください。", 5000, "error");
    return;
  }

  const changes = edits.map(edit => action === "updateTimetableChange"
    ? {
        classId: edit.classId,
        grade: edit.grade,
        day: edit.day,
        period: edit.period,
        subjectChange: edit.subjectChange,
        teacherChange: edit.teacherChange || "",
        weekOffset: Number(edit.weekOffset ?? state.adminWeekOffset) || 0
      }
    : {
        classId: edit.classId,
        grade: edit.grade,
        day: edit.day,
        period: edit.period,
        subjectBase: edit.subjectBase
      });

  const saveButton = document.querySelector(
    `.batch-edit-toolbar[data-mode="${action === "updateTimetableChange" ? "quick" : "deep"}"] .batch-edit-save`
  );
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "保存中…";
  }

  try {
    const response = await fetch("/api/timetable-change", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action, changes })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || "時間割の一括保存に失敗しました。");
    }

    const savedKeys = new Set(edits.map(edit => edit.key));
    const remaining = {};
    Object.entries(state.data.pendingTimetableEdits || {}).forEach(([key, edit]) => {
      if (!savedKeys.has(key)) remaining[key] = edit;
    });
    state.data.pendingTimetableEdits = remaining;
    state.data.pendingEditUndoStack = [cloneTimetableEditMap(remaining)];
    state.data.pendingEditRedoStack = [];

    edits.forEach(edit => {
      delete state.data.gasAdminTimetableCache[`${String(edit.grade)}:w${Number(edit.weekOffset ?? state.adminWeekOffset) || 0}`];
    });

    const results = Array.isArray(result.results) ? result.results : [];
    if (action === "updateTimetableChange") {
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        const itemResult = results[i] || {};
        saveAdminConflicts(
          edit.grade,
          edit.day,
          edit.classId,
          edit.period,
          itemResult.conflicts || []
        );
      }

      try {
        await addBatchChangeHistory(edits, session.user.id);
      } catch (historyError) {
        console.error("変更履歴の保存に失敗:", historyError);
        showToast("時間割は保存されましたが、変更履歴の保存に失敗しました。", 5000, "error");
      }
    }

    state.data.pendingConflictCells = {};
    state.data.pendingConflictPairs = {};
    state.data.pendingConflictTimetables = null;
    await updatePendingConflictState();

    const conflictRows = [];
    results.forEach((itemResult, index) => {
      (itemResult.conflicts || []).forEach(conflict => {
        conflictRows.push({
          ...conflict,
          editedClassId: edits[index]?.classId,
          editedDay: edits[index]?.day,
          editedPeriod: edits[index]?.period
        });
      });
    });

    if (conflictRows.length) {
      const teacherConflicts = conflictRows.filter(item => item.type === "teacher");
      const placeConflicts = conflictRows.filter(item => item.type === "place");
      let message = `${edits.length}件の変更を保存しました。\n\n⚠ 重複が見つかりました。`;

      if (teacherConflicts.length) {
        message += "\n\n【担当教員の重複】";
        teacherConflicts.forEach(item => {
          message += `\n・${item.teacher_id || "担当教員"} → class_id ${item.class_id}（${item.subject_id || ""}）`;
        });
      }
      if (placeConflicts.length) {
        message += "\n\n【担当場所の重複】";
        placeConflicts.forEach(item => {
          message += `\n・${item.place || "場所"} → class_id ${item.class_id}（${item.subject_id || ""}）`;
        });
      }
      message += "\n\n重複していますが、変更は保存されています。";
      showToast(message, 6000, "error");
    } else {
      showToast(`${edits.length}件の変更をまとめて保存しました。`);
    }

    if (state.view === "quick-admin") {
      await renderQuickAdmin();
    } else if (state.view === "deep-admin") {
      await renderDeepAdmin();
    }
    await renderStudent();
  } catch (error) {
    console.error("時間割の一括保存エラー:", error);
    showToast(
      `一括保存に失敗しました。未保存の編集内容は保持されています。\n${error.message}`,
      6000,
      "error"
    );
  } finally {
    if (saveButton) {
      saveButton.textContent = "まとめて保存";
      updateBatchEditToolbar();
    }
  }
}

async function requestNotificationApi(action, payload = {}) {
  const {
    data: { session },
    error
  } = await window.supabaseClient.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error(
      "ログイン状態を確認できません。再ログインしてください。"
    );
  }

  const response = await fetch("/api/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ action, ...payload })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.success === false) {
    throw new Error(
      result.error || "お知らせAPIの処理に失敗しました。"
    );
  }

  return result;
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

  
  //const courseNameMap = {
  //  all: "all",
  //  none: "なし",
  //  humanities: "文系",
  //  science: "理系",
  //  "explore-humanities": "探文",
  //  "explore-science": "探理"
  //};
  
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


  // 認証済み管理者用API経由で保存
  try {
    const result = await requestNotificationApi(
      "insert",
      { notification }
    );

    state.data.notifications.unshift(result.data);
    console.log("お知らせ投稿成功:", result.data);
  } catch (error) {
    console.error("お知らせ投稿失敗:", error);

    showToast(
      "お知らせの投稿に失敗しました。\n" + error.message,
      5000,
      "error"
    );

    return;
  }

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
    
    // 認証済み管理者用API経由で削除
    await requestNotificationApi("delete", { id });

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

function ensureValidStudentProfile() {
  // 先生モードは生徒用プロフィール検証の対象外
  if (state.profile.grade === "teacher") {
    return;
  }

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
  // 先生は学年・クラス・コースに関係なく対象にする
  if (String(profile.grade) === "teacher") {
    return true;
  }

  const targetCourses = (targets.courses || ["all"]).map(
    (course) => normalizeCourseTheme(course)
  );

  const profileCourse = normalizeCourseTheme(profile.course);

  return targetMatches(targets.grades, profile.grade)
    && targetMatches(targets.classes, profile.classNo)
    && targetMatches(targetCourses, profileCourse);
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
    + `文理:[${(targets.courses || ["all"]).map((course) => {
      if (course === "all") return "全";
      return state.data.courses[course] || course;
    }).join(",")}]`;
}

function getSubjectClass(course) {
  const themeCourse =
    normalizeCourseTheme(course);

  if (themeCourse === "science" || themeCourse === "explore-science") return "subject-science";
  if (themeCourse === "agriculture") return "subject-agriculture";
  if (themeCourse === "welfare") return "subject-welfare";
  return "subject-humanities";
}

function normalizeCourseTheme(course) {
  const value =
    String(course || "")
      .trim()
      .toLowerCase();

  const map = {
    "": "none",
    none: "none",
    "なし": "none",
    humanities: "humanities",
    humanity: "humanities",
    human: "humanities",
    bunkei: "humanities",
    "文": "humanities",
    "文系": "humanities",
    science: "science",
    sci: "science",
    rikei: "science",
    "理": "science",
    "理系": "science",
    "explore-humanities": "explore-humanities",
    explore_humanities: "explore-humanities",
    tankyu_humanities: "explore-humanities",
    "探文": "explore-humanities",
    "explore-science": "explore-science",
    explore_science: "explore-science",
    tankyu_science: "explore-science",
    "探理": "explore-science",
    agriculture: "agriculture",
    agri: "agriculture",
    "農": "agriculture",
    "農業": "agriculture",
    welfare: "welfare",
    "福": "welfare",
    "福祉": "welfare",
    teacher: "teacher",
    "先生": "teacher"
  };

  return map[value] || value || "none";
}

function applyClassCourseOverrides(classes) {
  return classes.map((classItem) => ({
    ...classItem,
    course: state.data.classCourses[classItem.id] || classItem.course
  }));
}

async function addBatchChangeHistory(edits, userId) {
  const now = new Date();
  const endDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const formatJstDateTime = (date) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);

  const changesText = edits.map((edit) => {
    const before = edit.originalValue || "空欄";
    const after = edit.subjectChange || "空欄";
    return `${edit.classLabel}・${edit.day}曜日・${edit.period}限: 「${before}」→「${after}」`;
  }).join(" / ");

  const history = {
    id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "history",
    title: `時間割変更（${edits.length}件）`,
    display_start: now.toISOString(),
    display_end: endDate.toISOString(),
    body: `実行時刻: ${formatJstDateTime(now)} / 実行ユーザーID: ${userId} / 変更内容: ${changesText}`,
    targets: {
      grades: ["all"],
      classes: ["all"],
      courses: ["all"]
    }
  };

  const result = await requestNotificationApi("insert", { notification: history });
  if (result.data) {
    state.data.notifications.unshift(result.data);
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
// 先生の時間割表示用：クラス情報のみ取得
// 管理者用の時間割データは取得しない
// ========================================
async function fetchClassMetadata() {
  // 取得済みならキャッシュを返す
  if (state.data.gasClassMetadata) {
    return state.data.gasClassMetadata;
  }

  // 同じ取得処理が進行中なら、その通信を共有する
  if (state.data.gasClassMetadataPromise) {
    return await state.data.gasClassMetadataPromise;
  }

  state.data.gasClassMetadataPromise =
    (async () => {
      try {
        const {
          data: { session },
          error: sessionError
        } = await window.supabaseClient.auth.getSession();

        if (sessionError) {
          throw new Error(
            "ログイン情報の取得に失敗しました"
          );
        }

        if (!session?.access_token) {
          throw new Error(
            "ログインしていません。再ログインしてください"
          );
        }

        const params = new URLSearchParams({
          admin: "classMetadata"
        });

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

        if (!response.ok) {
          throw new Error(
            `クラス情報の取得に失敗しました: ${response.status}`
          );
        }

        const result = await response.json();

        if (
          !result.success ||
          !Array.isArray(result.data)
        ) {
          throw new Error(
            result.error ||
            "クラス情報の形式が正しくありません"
          );
        }

        // 既存の表示用関数が使える形式に整理する
        const grouped = {
          "1": { classes: [] },
          "2": { classes: [] },
          "3": { classes: [] }
        };

        result.data.forEach((item) => {
          const grade =
            String(item.grade || "").trim();

          if (grouped[grade]) {
            grouped[grade].classes.push({
              class_id:
                String(item.class_id || "").trim(),
              grade,
              class_no:
                String(item.class_no || "").trim(),
              course:
                String(item.course || "").trim()
            });
          }
        });

        state.data.gasClassMetadata = grouped;

        console.log(
          "先生時間割用クラス情報の取得成功"
        );

        return grouped;

      } catch (error) {
        console.error(
          "先生時間割用クラス情報の取得失敗:",
          error
        );

        showToast(
          "クラス情報の取得に失敗しました。ページを再読み込みしてください。",
          5000,
          "error"
        );

        return null;

      } finally {
        state.data.gasClassMetadataPromise = null;
      }
    })();

  return await state.data.gasClassMetadataPromise;
}

// ========================================
// GASから浅い管理画面用の時間割を取得
// 学年単位で月～金をまとめて取得
// ========================================
async function fetchGasAdminTimetable(grade, weekOffset = 0) {
  const normalizedWeekOffset = Math.max(0, Math.min(3, Number(weekOffset) || 0));
  const cacheKey =
    `${String(grade)}:w${normalizedWeekOffset}`;

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
              grade: String(grade),
              weekOffset: String(normalizedWeekOffset)
            });

          const url =
            `/api/timetable?${params.toString()}`;

          console.log(
            "浅い管理画面GAS request:",
            url
          );

          
          const {
            data: { session },
            error: sessionError
          } = await window.supabaseClient.auth.getSession();
          
          if (sessionError) {
            throw new Error(
              "ログイン情報の取得に失敗しました"
            );
          }
          
          if (!session?.access_token) {
            throw new Error(
              "ログインしていません。再ログインしてください"
            );
          }
          
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${session.access_token}`
            }
          });


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
              showToast(`浅い管理画面GAS通信失敗: ` + `${response.status} ` +"\n再度取得しています"
                    ,3000
                    ,"error"
                       )

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
        
    const {
      data: { session },
      error: sessionError
    } = await window.supabaseClient.auth.getSession();
    
    if (sessionError) {
      throw new Error(
        "ログイン情報の取得に失敗しました"
      );
    }
    
    if (!session?.access_token) {
      throw new Error(
        "ログインしていません。再ログインしてください"
      );
    }
    
    const response = await fetch(
      "/api/timetable?admin=conflicts",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      }
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
                const {
                  data: { session },
                  error: sessionError
                } = await window.supabaseClient.auth.getSession();
        
                if (sessionError || !session?.access_token) {
                  throw new Error("科目一覧の取得にはログインが必要です");
                }
        
                const response = await fetch(
                  "/api/timetable?admin=subjects",
                  {
                    method: "GET",
                    headers: {
                      Authorization: `Bearer ${session.access_token}`
                    },
                    cache: "no-store"
                  }
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
async function fetchAllAdminTimetables(weekOffset = state.adminWeekOffset) {
  const normalizedWeekOffset = Math.max(0, Math.min(3, Number(weekOffset) || 0));
  const promiseKey = `w${normalizedWeekOffset}`;
  if (!state.data.gasAllAdminTimetablesPromises) {
    state.data.gasAllAdminTimetablesPromises = {};
  }

 // 同じ週枠の取得中通信だけ共有する
  if (state.data.gasAllAdminTimetablesPromises[promiseKey]) {
    return await state.data.gasAllAdminTimetablesPromises[promiseKey];
  }

  state.data.gasAllAdminTimetablesPromises[promiseKey] = (async () => {
    const results = await Promise.all(
      ["1", "2", "3"].map(async (grade) => {
        const data = await fetchGasAdminTimetable(grade, normalizedWeekOffset);
        if (!data) {
          console.error(`重複判定用の${grade}年時間割取得に失敗しました`);
          return null;
        }
        return { grade, data };
      })
    );
    const timetables = {};
    for (const result of results) {
      if (!result) return null;
      timetables[result.grade] = result.data;
    }
    return timetables;
  })();

  try {
    return await state.data.gasAllAdminTimetablesPromises[promiseKey];
  } finally {

    delete state.data.gasAllAdminTimetablesPromises[promiseKey];
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
    // joint科目を構成する個別subject_idを候補から除外
    // joint自体のsubject_idは候補に残す。
    // ※科目マスターや保存データは変更しない。
    // ========================================
    const jointMemberSubjectIds = new Set();

    subjects.forEach((subject) => {
      if (!Array.isArray(subject.subject_ids)) {
        return;
      }

      subject.subject_ids.forEach((memberId) => {
        const id = String(memberId || "").trim();
        if (id) {
          jointMemberSubjectIds.add(id);
        }
      });
    });
      
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

          // 他のjoint科目の構成科目として使われているIDは、
          // 時間割変更の候補一覧には表示しない。
          if (jointMemberSubjectIds.has(subjectId)) {
            return false;
          }
        
          const subjectName =
            String(
              subject.subject_name || ""
            ).trim();
        
          const hLabel =
            getHLabelFromSubjectId(
              subjectId,
              conflictContext?.allTimetables
            );
        
          const courseLabel = getCourseLabelFromSubjectId(
            subjectId,
            conflictContext?.allTimetables
          );
          const displayName = hLabel
            ? `${subjectName}_${hLabel}${courseLabel ? `（${courseLabel}）` : ""}`
            : `${subjectName}${courseLabel ? `（${courseLabel}）` : ""}`;
        
          if (!keyword) {
            return true;
          }
        
          return (
            subjectId
              .toLowerCase()
              .includes(keyword) ||
            subjectName
              .toLowerCase()
              .includes(keyword) ||
            displayName
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
        
        const courseLabel = getCourseLabelFromSubjectId(
          subjectId,
          conflictContext?.allTimetables
        );

        if (hLabel) {
          displayName =
             `${subjectName}_${hLabel}${courseLabel ? `（${courseLabel}）` : ""}`;
        } else if (courseLabel) {
          displayName = `${subjectName}（${courseLabel}）`;
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
          `${subjectId} : ${displayName}`;
        
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
    // GASが返すコース名（文系・理系・探文など）を表示用に保持する。
    courseLabel: String(gasClass.course || "").trim(),
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

// subject_idに対応するクラスのコース名を取得する。
// 例：同じ「21H」でも、文系・理系の科目を区別して表示する。
function getCourseLabelFromSubjectId(subjectId, allTimetables) {
  const id = String(subjectId || "").trim();

  // joint科目には特定クラスのコース名を付けない。
  if (/^j[A-Z]{2}\d{3}$/.test(id)) {
    return "";
  }

  const match = id.match(/^[A-Z]{2}(\d{2})\d$/);
  if (!match) {
    return "";
  }

  const classId = match[1];
  for (const grade of ["1", "2", "3"]) {
    const classes = allTimetables?.[grade]?.classes || [];
    const gasClass = classes.find(
      (item) => String(item.class_id) === classId
    );

    if (gasClass) {
      const course = String(gasClass.course || "").trim();
      const labels = {
        "文": "文系",
        "文系": "文系",
        "理": "理系",
        "理系": "理系",
        "探文": "探文",
        "探理": "探理",
        "農": "農",
        "農業": "農",
        "福": "福",
        "福祉": "福"
      };
      return labels[course] || course;
    }
  }

  return "";
}

function getHLabelFromClassId(
  classId,
  allTimetables
) {
  const targetClassId =
    String(classId || "").trim();

  if (!targetClassId) {
    return "";
  }

  for (const grade of ["1", "2", "3"]) {

    const classes =
      allTimetables?.[grade]?.classes || [];

    const gasClass =
      classes.find(
        c =>
          String(c.class_id) ===
          targetClassId
      );

    if (gasClass) {
      return `${gasClass.grade}${gasClass.class_no}H`;
    }
  }

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

  // ========================================
  // teacher_id → display_name
  // ========================================
  const getTeacherDisplayName =
    (teacherId) => {

      const id =
        String(teacherId || "").trim();

      if (!id) {
        return "";
      }

      const profile =
        (state.adminProfiles || []).find(
          (item) =>
            String(
              item?.user_id || ""
            ).trim() === id
        );

      return (
        profile?.display_name ||
        id
      );
    };

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

    const teacherName =
      getTeacherDisplayName(
        subject.teacher_id
      );

    return [
      `表示名: ${subject.subject_name || id}`,
      `先生: ${teacherName || "―"}`,
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

  const teacherNameList =
    teacherList
      .map(
        (teacherId) =>
          getTeacherDisplayName(
            teacherId
          )
      )
      .filter(Boolean);

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
      teacherNameList.length > 0
        ? teacherNameList.join(" / ")
        : "―"
    }`,
    `場所: ${
      placeList.length > 0
        ? placeList.join(" / ")
        : "―"
    }`
  ].join("\n");
}

// ========================================
// 時間割コマンド：解析・検証・プレビュー・保留編集への反映
// API/GASの通信経路は既存のものを利用する。
// ========================================
function commandSetStatus(message, kind = "info") {
  const status = document.getElementById("command-editor-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

function commandCourseAlias(course) {
  const normalized = String(course || "").trim();
  const aliases = {
    "": "", "探文": "tb", "探理": "tr", "文系": "bun",
    "理系": "ri", "農": "nou", "福": "fuku"
  };
  return Object.prototype.hasOwnProperty.call(aliases, normalized) ? aliases[normalized] : null;
}

function parseTimetableCommandText(text) {
  const commands = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((rawLine, lineIndex) => {
    const parts = rawLine.split(",").map(part => part.trim()).filter(Boolean);
    parts.forEach((linePart) => {
      const match = linePart.match(/^(\w+)\s+(\d+)(?:\s+to\s+(?:(\w+)\s+)?(\d+))?\s*=\s*(\S+)$/i);
      if (!match) {
        errors.push(`${lineIndex + 1}行目「${linePart}」: 書式を確認してください。例：21tb 1 to 4 = jSP101`);
        return;
      }
      commands.push({
        line: lineIndex + 1,
        startClass: match[1].toLowerCase(),
        startPeriod: Number(match[2]),
        endClass: (match[3] || match[1]).toLowerCase(),
        endPeriod: Number(match[4] || match[2]),
        subjectId: match[5]
      });
    });
  });
  if (!commands.length && !errors.length) errors.push("コマンドを入力してください。");
  return { commands, errors };
}

function resolveCommandClass(alias, classes) {
  const value = String(alias || "").toLowerCase();
  return classes.find(item => {
    const grade = String(item.grade || "").trim();
    const classNo = String(item.class_no || "").trim();
    const courseAlias = commandCourseAlias(item.course);
    const base = `${grade}${classNo}`;
    return value === base || (courseAlias && value === `${base}${courseAlias}`);
  }) || null;
}

function getCommandSubjectId(subject) {
  return String(subject?.subject_id || "").trim();
}

async function buildTimetableCommandPlan(text) {
  const parsed = parseTimetableCommandText(text);
  if (parsed.errors.length) return { errors: parsed.errors, changes: [] };

  const [metadata, subjects, timetables] = await Promise.all([
    fetchClassMetadata(), fetchAllGasSubjects(), fetchAllAdminTimetables()
  ]);
  if (!metadata || !subjects || !timetables) {
    return { errors: ["クラス・科目・時間割データを取得できませんでした。再試行してください。"], changes: [] };
  }

  const classes = ["1", "2", "3"].flatMap(grade => metadata[grade]?.classes || [])
    .slice()
    .sort((a, b) => String(a.class_id).localeCompare(String(b.class_id), undefined, { numeric: true }));
  const subjectIds = new Set(subjects.map(getCommandSubjectId).filter(Boolean));
  const periodNumbers = (Array.isArray(state.data.periods) && state.data.periods.length
    ? state.data.periods.map(Number)
    : [1, 2, 3, 4, 5, 6, 7]);
  const action = state.view === "deep-admin" ? "updateTimetableBase" : "updateTimetableChange";
  const day = state.view === "deep-admin" ? (state.deepAdminDay || $("#deep-admin-day")?.value || "月") : (state.adminDay || $("#admin-day")?.value || "月");
  const errors = [];
  const plannedByKey = new Map();

  parsed.commands.forEach(command => {
    const start = resolveCommandClass(command.startClass, classes);
    const end = resolveCommandClass(command.endClass, classes);
    if (!start) { errors.push(`${command.line}行目: 開始クラス「${command.startClass}」が見つかりません。`); return; }
    if (!end) { errors.push(`${command.line}行目: 終了クラス「${command.endClass}」が見つかりません。`); return; }
    if (!periodNumbers.includes(command.startPeriod) || !periodNumbers.includes(command.endPeriod)) {
      errors.push(`${command.line}行目: 時限は ${periodNumbers[0]}～${periodNumbers[periodNumbers.length - 1]} の範囲で指定してください。`); return;
    }
    const subjectId = command.subjectId.toLowerCase() === "none" ? "" : command.subjectId;
    if (subjectId && !subjectIds.has(subjectId)) {
      errors.push(`${command.line}行目: 科目ID「${subjectId}」が見つかりません。`); return;
    }
    const startIndex = classes.findIndex(item => String(item.class_id) === String(start.class_id));
    const endIndex = classes.findIndex(item => String(item.class_id) === String(end.class_id));
    const firstClassIndex = Math.min(startIndex, endIndex);
    const lastClassIndex = Math.max(startIndex, endIndex);
    const firstPeriod = Math.min(command.startPeriod, command.endPeriod);
    const lastPeriod = Math.max(command.startPeriod, command.endPeriod);
    for (let ci = firstClassIndex; ci <= lastClassIndex; ci++) {
      const classData = classes[ci];
      for (let period = firstPeriod; period <= lastPeriod; period++) {
        if (!periodNumbers.includes(period)) continue;
        const grade = String(classData.grade);
        const classId = String(classData.class_id);
        const timetable = timetables[grade]?.timetable?.[day]?.[classId] || [];
        const row = timetable.find(item => Number(item.period) === period) || {};
        const pending = getPendingTimetableEdit(action, classId, day, period, grade);
        const originalValue = pending
          ? pending.originalValue
          : String(action === "updateTimetableChange" ? (row.subject_change || "") : (row.subject_base || ""));
        const key = getTimetableEditKey(action, classId, day, period, grade);
        plannedByKey.set(key, {
          key, action, classId, grade,
          classNo: String(classData.class_no || ""),
          course: String(classData.course || ""),
          classLabel: `${grade}${classData.class_no || ""}H${classData.course ? ` ${classData.course}` : ""}`,
          day, period, originalValue, newValue: subjectId,
          ...(action === "updateTimetableChange" ? { subjectChange: subjectId, teacherChange: "" } : { subjectBase: subjectId })
        });
      }
    }
  });

  if (errors.length) return { errors, changes: [] };
  const changes = Array.from(plannedByKey.values()).filter(change =>
    String(change.originalValue) !== String(change.newValue)
  );
  return { errors: [], changes, day, action };
}

function renderTimetableCommandPreview(plan) {
  const preview = document.getElementById("command-editor-preview");
  const applyButton = document.getElementById("command-apply-button");
  if (!preview || !applyButton) return;
  preview.replaceChildren();
  if (!plan || plan.errors?.length) {
    preview.hidden = true;
    applyButton.disabled = true;
    return;
  }
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const header = document.createElement("tr");
  ["クラス", "曜日・時限", "変更前", "変更後"].forEach(label => {
    const th = document.createElement("th"); th.textContent = label; header.append(th);
  });
  thead.append(header); table.append(thead);
  const tbody = document.createElement("tbody");
  plan.changes.slice(0, 300).forEach(change => {
    const tr = document.createElement("tr");
    [change.classLabel, `${change.day}${change.period}限`, change.originalValue || "（空欄）", change.newValue || "（空欄）"].forEach(value => {
      const td = document.createElement("td"); td.textContent = value; tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody); preview.append(table); preview.hidden = false;
  if (plan.changes.length > 300) {
    const note = document.createElement("p"); note.textContent = `先頭300件を表示しています（合計${plan.changes.length}件）。`; note.style.padding = "0 10px"; preview.append(note);
  }
  applyButton.disabled = plan.changes.length === 0;
}

function stageTimetableCommandPlan(plan) {
  if (!plan || !Array.isArray(plan.changes) || !plan.changes.length) return false;
  const before = cloneTimetableEditMap(state.data.pendingTimetableEdits || {});
  const next = cloneTimetableEditMap(before);
  plan.changes.forEach(change => {
    if (String(change.newValue) === String(change.originalValue)) {
      delete next[change.key];
    } else {
      next[change.key] = change;
    }
  });
  if (JSON.stringify(before) === JSON.stringify(next)) return false;
  if (!state.data.pendingEditUndoStack.length) state.data.pendingEditUndoStack.push(before);
  state.data.pendingEditUndoStack.push(next);
  if (state.data.pendingEditUndoStack.length > 100) state.data.pendingEditUndoStack.shift();
  state.data.pendingEditRedoStack = [];
  state.data.pendingTimetableEdits = next;
  updateBatchEditToolbar();
  updatePendingConflictState().then(refreshBatchEditScreen).catch(error => {
    console.error("コマンド変更の重複判定に失敗:", error);
    refreshBatchEditScreen();
  });
  refreshBatchEditScreen();
  return true;
}

function installTimetableCommandFeatures() {
  const editor = document.getElementById("command-editor-textarea");
  const validateButton = document.getElementById("command-validate-button");
  const previewButton = document.getElementById("command-preview-button");
  const applyButton = document.getElementById("command-apply-button");
  const previewElement = document.getElementById("command-editor-preview");
  if (!editor || !validateButton || !previewButton || !applyButton) return;
  let currentPlan = null;
  const suggestionBox = document.createElement("div");
  suggestionBox.className = "command-suggestions";
  suggestionBox.hidden = true;
  suggestionBox.setAttribute("role", "listbox");
  document.body.append(suggestionBox);
  let suggestionTarget = null;
  let suggestionItems = [];
  let suggestionIndex = 0;
  let subjectsPromise = null;

  const hideSuggestions = () => {
    suggestionBox.hidden = true;
    suggestionTarget = null;
    suggestionItems = [];
    suggestionIndex = 0;
  };

  const updateSuggestions = async (target) => {
    const cursor = target.selectionStart ?? target.value.length;
    const beforeCursor = target.value.slice(0, cursor);
    const line = beforeCursor.split(/\r?\n/).pop() || "";
    const match = line.match(/=\s*([a-zA-Z0-9_]*)$/);
    if (!match) { hideSuggestions(); return; }
    const prefix = match[1];
    if (!subjectsPromise) subjectsPromise = fetchAllGasSubjects();
    const subjects = await subjectsPromise;
    if (!Array.isArray(subjects) || document.activeElement !== target) { hideSuggestions(); return; }
    suggestionItems = subjects.map(subject => ({
      id: getCommandSubjectId(subject),
      name: String(subject.subject_name || "")
    })).filter(item => item.id && item.id.toLowerCase().startsWith(prefix.toLowerCase()))
      .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
      .slice(0, 12);
    if (!suggestionItems.length) { hideSuggestions(); return; }
    suggestionTarget = target;
    suggestionIndex = 0;
    suggestionBox.replaceChildren();
    suggestionItems.forEach((item, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "command-suggestion";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", index === suggestionIndex ? "true" : "false");
      const id = document.createElement("strong"); id.textContent = item.id;
      const name = document.createElement("span"); name.textContent = item.name;
      option.append(id, name);
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("click", () => chooseSuggestion(index));
      suggestionBox.append(option);
    });
    const rect = target.getBoundingClientRect();
    suggestionBox.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 330))}px`;
    suggestionBox.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 240)}px`;
    suggestionBox.style.width = `${Math.min(Math.max(rect.width, 250), window.innerWidth - 16)}px`;
    suggestionBox.hidden = false;
  };

  const chooseSuggestion = (index = suggestionIndex) => {
    const target = suggestionTarget;
    const item = suggestionItems[index];
    if (!target || !item) return;
    const cursor = target.selectionStart ?? target.value.length;
    const before = target.value.slice(0, cursor);
    const after = target.value.slice(cursor);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = before.slice(lineStart);
    const token = line.match(/(=\s*)([a-zA-Z0-9_]*)$/);
    if (!token) { hideSuggestions(); return; }
    const replaceStart = cursor - token[2].length;
    target.value = target.value.slice(0, replaceStart) + item.id + after;
    const nextCursor = replaceStart + item.id.length;
    target.setSelectionRange(nextCursor, nextCursor);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.focus();
    hideSuggestions();
  };

  const attachAutocomplete = target => {
    target.addEventListener("input", () => { updateSuggestions(target).catch(() => hideSuggestions()); });
    target.addEventListener("click", () => { updateSuggestions(target).catch(() => hideSuggestions()); });
    target.addEventListener("keydown", event => {
      if (suggestionBox.hidden || suggestionTarget !== target) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        suggestionIndex = (suggestionIndex + (event.key === "ArrowDown" ? 1 : suggestionItems.length - 1)) % suggestionItems.length;
        Array.from(suggestionBox.children).forEach((option, index) => option.setAttribute("aria-selected", index === suggestionIndex ? "true" : "false"));
      } else if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault(); chooseSuggestion(suggestionIndex);
      } else if (event.key === "Escape") {
        event.preventDefault(); hideSuggestions();
      }
    });
    target.addEventListener("blur", () => setTimeout(() => {
      if (!suggestionBox.matches(":hover")) hideSuggestions();
    }, 120));
  };

  document.querySelectorAll("[data-command-input]").forEach(attachAutocomplete);
  attachAutocomplete(editor);

  const validate = async (withPreview) => {
    validateButton.disabled = true; previewButton.disabled = true; applyButton.disabled = true;
    commandSetStatus("クラス・科目・時間割を確認しています…");
    try {
      const plan = await buildTimetableCommandPlan(editor.value);
      currentPlan = plan;
      if (plan.errors.length) {
        commandSetStatus(plan.errors.join("\n"), "error");
        renderTimetableCommandPreview(null);
        return;
      }
      commandSetStatus(`検証成功：${plan.changes.length}セルが変更対象です。時間割への反映前にプレビューを確認してください。`, "success");
      if (withPreview) renderTimetableCommandPreview(plan);
      else { previewElement.hidden = true; applyButton.disabled = true; }
    } catch (error) {
      console.error("時間割コマンドの検証に失敗:", error);
      currentPlan = null;
      commandSetStatus(error.message || "検証に失敗しました。", "error");
      renderTimetableCommandPreview(null);
    } finally {
      validateButton.disabled = false; previewButton.disabled = false;
    }
  };

  validateButton.addEventListener("click", () => validate(false));
  previewButton.addEventListener("click", () => validate(true));
  editor.addEventListener("input", () => {
    currentPlan = null; applyButton.disabled = true; previewElement.hidden = true;
    commandSetStatus("入力内容が変わりました。反映する前にもう一度プレビューしてください。");
  });
  applyButton.addEventListener("click", () => {
    if (!currentPlan || applyButton.disabled) return;
    const changed = stageTimetableCommandPlan(currentPlan);
    if (!changed) {
      commandSetStatus("反映できる新しい変更はありません。", "info");
      return;
    }
    commandSetStatus(`変更を保留編集に反映しました（${currentPlan.changes.length}セル）。「まとめて保存」で確定してください。`, "success");
    applyButton.disabled = true;
    currentPlan = null;
  });
}


// 時間割コマンド入力欄と展開エディタの同期

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("command-editor-modal");
  const editor = document.getElementById("command-editor-textarea");
  const compactInputs = Array.from(document.querySelectorAll("[data-command-input]"));
  const expandButtons = Array.from(document.querySelectorAll("[data-command-expand]"));
  const closeButtons = Array.from(document.querySelectorAll("[data-command-close]"));

  if (!modal || !editor || compactInputs.length === 0) return;
  installTimetableCommandFeatures();

  let lastFocusedElement = null;
  let activeCompactInput = compactInputs[0];

  const syncCompactToEditor = () => {
    const focused = compactInputs.find((input) => input === document.activeElement);
    if (focused) activeCompactInput = focused;
    editor.value = activeCompactInput?.value || compactInputs[0].value || "";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const syncEditorToCompact = () => {
    const value = editor.value;
    compactInputs.forEach((input) => {
      input.value = value;
    });
  };

  const openModal = (button) => {
    const entry = button.closest("[data-command-entry]");
    const input = entry?.querySelector("[data-command-input]");
    if (input) activeCompactInput = input;
    lastFocusedElement = document.activeElement;
    syncCompactToEditor();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("command-editor-open");
    editor.focus();
  };

  const closeModal = () => {
    syncEditorToCompact();
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("command-editor-open");
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  };

  compactInputs.forEach((input) => {
    input.addEventListener("focus", () => {
      activeCompactInput = input;
    });
    input.addEventListener("input", () => {
      if (modal.hidden) {
        compactInputs.forEach((other) => {
          if (other !== input) other.value = input.value;
        });
      }
    });
  });

  editor.addEventListener("input", syncEditorToCompact);
  expandButtons.forEach((button) => {
    button.addEventListener("click", () => openModal(button));
  });
  closeButtons.forEach((button) => button.addEventListener("click", closeModal));

  document.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
    if (event.key === "Tab" && event.target === editor && !event.shiftKey) {
      // UI段階ではTabを通常のフォーカス移動に任せ、補完実装時に動作を拡張する。
    }
  });
});
