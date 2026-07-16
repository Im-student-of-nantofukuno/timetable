# 時間割連絡システム 構成メモ

このファイルは、現在の静的HTML/CSS/JavaScript版のファイル関係と、将来Supabaseへ移行するときの大まかな手順をまとめたものです。

## 画面構成

`index.html` が全画面の土台です。画面は `data-screen` で分かれています。

- `student`: 生徒用画面。学年・組・文理を選ぶと、対象の時間割とお知らせを表示します。
- `login`: 管理者ログイン画面。現状は仮導線で、ログインボタンから浅い管理画面へ移動します。
- `quick-admin`: 浅い管理画面。日ごとの時間割変更、お知らせ/変更履歴の投稿・削除を行います。
- `deep-admin`: 深い管理画面。基本時間割、クラスの文理、管理者ID一覧を編集します。

画面切り替えは `script.js` の `setView()` が担当し、`style.css` が現在の `data-view` に応じて表示するアイコンを制御しています。

## ファイルの役割

- `index.html`
  - HTML構造本体です。
  - `style.css` と各データJS、最後に `script.js` を読み込みます。

- `style.css`
  - 全画面の見た目、色分け、レスポンシブ、アイコン表示制御を担当します。
  - 画像アイコンは `アイコンeditor.png`、`アイコン工具.png`、`アイコンベル.png`、`アイコン時間割.png`、`アイコン目玉.png`、`アイコン管理者.png` を使います。

- `script.js`
  - アプリ本体の処理です。
  - 仮データ読み込み、`localStorage` 保存、画面描画、投稿、削除、時間割変更、基本時間割編集、文理変更、管理者ID追加削除を担当します。

- `timetable_base.js`
  - 基本時間割の仮データです。
  - `window.TIMETABLE_DATA` に、授業時限、文理ラベル、クラス一覧、基本時間割を持たせています。

- `class_courses.js`
  - クラスの文理上書き用の仮データです。
  - 現状は `window.CLASS_COURSE_OVERRIDES = {};` で、実際の変更は `localStorage` に保存されます。

- `timetable_changes.js`
  - 日ごとの時間割変更の仮データです。
  - `window.TIMETABLE_CHANGES` を `script.js` が読み、基本時間割に上書きして表示します。

- `notification.js`
  - お知らせ/変更履歴の仮データです。
  - `kind: "notice"` は生徒用のお知らせ、`kind: "history"` は変更履歴として扱います。

- `managers.js`
  - 管理者の仮データです。
  - 現在は `{ id, email }` 形式です。画面にはIDだけ表示し、内部的にメールと1:1対応させます。

- `修正箇所.txt`
  - 修正要望と対応状況のメモです。
  - `[o]` は対応済み、`[]` は未対応です。

## 現在のデータ保存

初期データは各 `.js` ファイルから読みます。画面上で編集した内容は `localStorage` に保存します。

使っている主なキーは `script.js` の `STORAGE_KEYS` にあります。

- `timetable.profile`: 生徒画面の学年・組・文理
- `timetable.baseTimetables`: 基本時間割の編集結果
- `timetable.classCourses`: クラス文理の上書き
- `timetable.changes`: 日ごとの時間割変更
- `timetable.notifications`: お知らせ/変更履歴
- `timetable.managers`: 管理者IDとメール

Supabase移行時は、この `localStorage` 読み書きをSupabaseの取得/保存処理に置き換える方針です。

## Supabaseテーブル案

最初は以下のテーブルに分けると、現在の構造から移行しやすいです。

- `classes`
  - `id`
  - `grade`
  - `class_no`
  - `course`
  - `label`
  - `school_year`

- `base_timetables`
  - `id`
  - `class_id`
  - `period`
  - `subject`
  - `teacher_id`
  - `room_id`
  - `school_year`

- `timetable_changes`
  - `id`
  - `date`
  - `class_id`
  - `period`
  - `subject`
  - `teacher_id`
  - `room_id`
  - `note`
  - `created_by`
  - `created_at`

- `notifications`
  - `id`
  - `kind`
  - `title`
  - `body`
  - `range_text`
  - `start_date`
  - `end_date`
  - `created_by`
  - `created_at`

- `notification_targets`
  - `id`
  - `notification_id`
  - `grade`
  - `class_no`
  - `course`

- `managers`
  - `id`
  - `email`
  - `created_at`

先生・場所の重複チェックまで進めるなら、次も追加するとよいです。

- `subjects`
- `teachers`
- `rooms`
- `lesson_groups`
- `lesson_group_classes`

## Supabase移行の大まかな手順

1. Supabaseプロジェクトを作成する。

2. 上記テーブルを作る。
   - まずは `classes`、`base_timetables`、`timetable_changes`、`notifications`、`notification_targets`、`managers` だけで十分です。

3. 現在の仮データをSupabaseへ投入する。
   - `timetable_base.js` の `classes` を `classes` に入れます。
   - `baseTimetables` を `base_timetables` に展開します。
   - `timetable_changes.js` を `timetable_changes` に入れます。
   - `notification.js` を `notifications` と `notification_targets` に分けます。
   - `managers.js` を `managers` に入れます。

4. `index.html` にSupabase clientを読み込む。
   - CDNで始めるなら `@supabase/supabase-js` を読み込みます。
   - 設定値は `supabase_client.js` のような別ファイルに分離すると扱いやすいです。

5. `script.js` のデータ読み込みをSupabaseに置き換える。
   - `loadInitialData()` が移行の中心です。
   - ここで各テーブルを取得し、現在の `state.data` の形に整形します。

6. 保存処理をSupabaseに置き換える。
   - `saveStored()` をそのまま置き換えるより、用途別に `saveBaseTimetable()`、`saveTimetableChange()`、`saveNotification()` のように分ける方が安全です。

7. 認証を接続する。
   - `login` 画面でSupabase Authを使います。
   - ログイン済みユーザーのメールが `managers` に存在する場合のみ管理画面へ移動させます。

8. Row Level Securityを設定する。
   - 生徒画面用の読み取りは公開または匿名読み取り。
   - 管理者編集は認証済み、かつ `managers` 登録済みのみ許可する方針にします。

9. `localStorage` はキャッシュ用途に縮小する。
   - 生徒の学年・組・文理だけは引き続き `localStorage` に残すと便利です。
   - 時間割やお知らせの正本はSupabaseに寄せます。

## 後回しにしている項目

`修正箇所.txt` で未対応のものは、主に先生・場所・教科マスタ、合同授業グループ、認証/ドメイン確認が必要です。

- 場所/先生の重複チェック
- 教科・先生・場所の選択式入力
- 教科入力時の先生/場所自動セット
- 合同授業グループの不足警告
- 合同授業グループの追加・削除画面
- 管理者メールのドメイン確認
- Supabase Authと管理者テーブルの連携

これらは、Supabase移行後にテーブル構造を固めてから作る方が破綻しにくいです。

## 開発時の注意

- `script.js` は現在、データファイルをグローバル変数として読む前提です。読み込み順は `index.html` の順番を維持してください。
- `localStorage` に古いデータが残っていると、JSファイルの初期データより古い保存データが優先されます。表示がおかしい場合はブラウザのlocalStorageを削除してください。
- クラスIDは `grade-classNo-course` 形式を基本にしています。Supabase移行時もIDの扱いを急に変えない方が安全です。
- 画面表示の大半は `renderStudent()`、`renderQuickAdmin()`、`renderDeepAdmin()` が担当しています。
