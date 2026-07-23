const FORCE_RESET = true;
if (FORCE_RESET) {
    localStorage.clear();
}

async function testConnection() {
    const { data, error } = await window.supabaseClient
        .from("classes")
        .select("*");

    console.log("data:", data);
    console.log("error:", error);
}

testConnection();

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
  profile: {
    grade: "2",
    classNo: "4",
    course: "humanities"
  },
  adminDate: new Date().toISOString().slice(0, 10),
  data: {
    periods: [],
    courses: {},
    classes: [],
    baseTimetables: {},
    classCourses: {},
    changes: [],
    notifications: [],
    managers: []
  }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

function init() {
  loadInitialData();
  bindEvents();
  restoreProfile();
  syncDateInputs();
  updateTargetSummary();
  renderAll();
}

function loadInitialData() {
  const timetableData = window.TIMETABLE_DATA || {};

  state.data.periods = timetableData.periods || [1, 2, 3, 4, 5, 6, 7];
  state.data.courses = timetableData.courses || {};
  state.data.classCourses = readStored(STORAGE_KEYS.classCourses, window.CLASS_COURSE_OVERRIDES || {});
  state.data.classes = applyClassCourseOverrides(timetableData.classes || []);
  state.data.baseTimetables = readStored(STORAGE_KEYS.baseTimetables, timetableData.baseTimetables || {});
  state.data.changes = readStored(STORAGE_KEYS.changes, window.TIMETABLE_CHANGES || []);
  state.data.notifications = readStored(STORAGE_KEYS.notifications, window.NOTIFICATIONS || []);
  state.data.managers = normalizeManagers(readStored(STORAGE_KEYS.managers, window.MANAGERS || []));
}

function bindEvents() {
  $$("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewButton));
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
  $("#deep-admin-grade")?.addEventListener("change", renderDeepAdmin);

  $$(".admin-header input").forEach((input) => {
    input.addEventListener("change", () => {
      const month = Number($(".admin-header input[name='month']")?.value || 1);
      const day = Number($(".admin-header input[name='day']")?.value || 1);
      const year = new Date().getFullYear();
      state.adminDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      renderQuickAdmin();
    });
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
  $$(".post-form input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", updateTargetSummary);
  });
  $(".manager-form")?.addEventListener("submit", handleManagerSubmit);
}

function restoreProfile() {
  state.profile = readStored(STORAGE_KEYS.profile, state.profile);
  setSelectValue("#student-grade", state.profile.grade);
  setSelectValue("#student-class", state.profile.classNo);
  setSelectValue("#student-course", state.profile.course);
  ensureValidStudentProfile();
}

function syncDateInputs() {
  const [, month, day] = state.adminDate.split("-");
  const monthInput = $(".admin-header input[name='month']");
  const dayInput = $(".admin-header input[name='day']");
  if (monthInput) monthInput.value = String(Number(month));
  if (dayInput) dayInput.value = String(Number(day));
}

function renderAll() {
  setView(state.view);
  renderStudent();
  renderQuickAdmin();
  renderDeepAdmin();
}

function setView(viewName) {
  state.view = viewName;
  $(".app-shell")?.setAttribute("data-view", viewName);

  $$("[data-screen]").forEach((screen) => {
    screen.hidden = screen.dataset.screen !== viewName;
  });

  $$("[data-view-button]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewButton === viewName);
  });
}

function renderStudent() {
  ensureValidStudentProfile();
  setSelectValue("#student-grade", state.profile.grade);
  setSelectValue("#student-class", state.profile.classNo);
  setSelectValue("#student-course", state.profile.course);

  const profileControls = $("#student-profile-controls");
  const timetablePanel = $(".timetable-panel");
  profileControls?.setAttribute("data-course", state.profile.course);
  timetablePanel?.setAttribute("data-course", state.profile.course);

  const classId = getClassId(state.profile);
  const subjects = getMergedTimetable(classId, state.adminDate);
  const changedPeriods = getChangesForClass(classId, state.adminDate).map((change) => Number(change.period));

  $$(".period-subject").forEach((subjectNode) => {
    const period = Number(subjectNode.dataset.period);
    subjectNode.textContent = subjects[period - 1] || "";
    subjectNode.closest("li")?.classList.toggle("is-changed", changedPeriods.includes(period));
  });

  renderStudentNotices();
}

function renderStudentNotices() {
  const container = $("#student-notices");
  if (!container) return;

  const notices = state.data.notifications.filter((notice) => {
    return notice.kind === "notice" && matchesTargets(notice.targets, state.profile);
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

function renderQuickAdmin() {
  const grade = $("#admin-grade")?.value || "2";
  const classes = getClassesByGrade(grade);
  const matrix = $("#change-matrix");
  if (!matrix) return;

  matrix.style.setProperty("--class-count", classes.length);
  matrix.replaceChildren();
  appendMatrixHeader(matrix, classes);

  state.data.periods.forEach((period) => {
    matrix.append(createCell(`${period}限`, "div", "matrix-cell matrix-cell--period"));

    classes.forEach((classItem) => {
      const change = findChange(classItem.id, period, state.adminDate);
      const cell = createCell(
        change?.subject || "",
        "button",
        `matrix-cell ${getSubjectClass(classItem.course)}${change ? " is-changed" : ""}`
      );
      cell.type = "button";
      cell.dataset.classId = classItem.id;
      cell.dataset.period = String(period);
      cell.addEventListener("click", () => editChange(classItem, period, change));
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
      <p>${escapeHtml(post.title)}｜${escapeHtml(post.range || "")}<br>${escapeHtml(post.body)}</p>
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

function handlePostSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.elements["post-title"].value.trim();
  const body = form.elements["post-body"].value.trim();
  const range = form.elements["post-range"].value.trim();

  if (!title || !body) {
    alert("タイトルと本文を入力してください。");
    return;
  }

  state.data.notifications.unshift({
    id: `post-${Date.now()}`,
    kind: state.adminMode,
    title,
    range,
    body,
    targets: {
      grades: getCheckedValues(form, "target-grade"),
      classes: getCheckedValues(form, "target-class"),
      courses: getCheckedValues(form, "target-course")
    }
  });

  saveStored(STORAGE_KEYS.notifications, state.data.notifications);
  form.reset();
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
