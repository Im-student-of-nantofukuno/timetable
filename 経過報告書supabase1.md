# Supabase対応 開発経過報告書

## 1. Supabase対応を始めた目的

時間割サイトの管理機能について、管理者認証や管理者情報の管理をより安全に行うため、Supabaseを利用した認証・権限管理へ移行することとした。

主な目標：

- 管理画面に入れる人を制限する
- 管理者権限をブラウザ側から勝手に変更できないようにする
- 管理者情報を必要以上に取得しない
- 将来的に複数の先生が利用できる構造にする
- 最終的には `@teacher.tym.ed.jp` のアカウントに限定する

---

## 2. Google認証の導入

Supabase Authを利用し、Googleアカウントによるログインを導入した。

### Google側

Google Auth Platform / Google Cloudを利用してOAuthクライアントを作成。

アプリケーション種類は **ウェブアプリケーション** を選択した。

---

## 3. SupabaseでGoogle認証を有効化

SupabaseのAuthentication設定でGoogleを有効化。

取得したClient IDとClient SecretをSupabase側へ登録した。

以下の設定も確認した。

- Skip nonce checks → OFF
- Allow users without an email → OFF

---

## 4. Supabase Authによるユーザー管理

Googleで認証すると、Supabase AuthのUsersにユーザーが登録されることを確認した。

メールアドレスは独自テーブルに重複して保存せず、Supabase Authで管理する方針とした。

理由：

- メールアドレスの二重管理を避けられる
- AuthがUIDとメールアドレスを管理してくれる
- 認証情報と権限情報を分離できる

最終的な構造：

```text
Supabase Auth
├─ UID
├─ メールアドレス
└─ 認証情報

admin_profiles
├─ UID
├─ 表示名
└─ role
```

---

## 5. Supabaseクライアントの導入

サイト側に `supabase_client.js` を導入した。

概ね以下の形でSupabaseクライアントを初期化している。

```javascript
window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);
```

ConsoleでSupabaseクライアントが正常に生成されることを確認した。

---

## 6. 認証状態の取得

Supabase Authから現在ログインしているユーザーを取得できることを確認した。

取得できる情報として、主に以下を確認した。

- UID
- メールアドレス

また、ページを再読み込みしても認証状態を復元できる仕組みを導入した。

これにより、一度Google認証した後、再読み込みしてもログイン状態を維持できるようになった。

---

## 7. `admin_profiles` テーブルの作成

管理者情報を管理するため、以下のテーブルを作成した。

```text
admin_profiles
```

主要なカラム：

```text
user_id
display_name
role
```

例：

```text
user_id       : XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
display_name  : 制作者
role          : admin
```

ユーザーを識別する共通キーとして、Supabase AuthのUIDを `user_id` に利用する。

---

## 8. 管理者情報の登録

Supabase AuthのUsersに登録されたテスト用アカウントのUIDを取得。

そのUIDを `admin_profiles.user_id` に登録し、

```text
display_name = 制作者
role = admin
```

とした。

これによって、

```text
Googleアカウント
       ↓
Supabase Auth
       ↓
UID
       ↓
admin_profiles
       ↓
role
```

という関係を構築した。

---

## 9. Row Level Security（RLS）の設定

`admin_profiles` に対してRLSを有効化した。

まず、自分自身のプロフィールだけSELECTできるポリシーを設定した。

ポリシー名：

```text
Users can read their own admin profile
```

`authenticated` ユーザーについて、

```text
auth.uid() = user_id
```

の場合に読み取りを許可する構造とした。

---

## 10. 不正なrole変更のテスト

ブラウザのConsoleから、

```javascript
.update({ role: "unknown" })
```

を実行して、管理者自身のroleを変更できるかテストした。

結果：

```text
更新結果: []
エラー: null
```

となり、Supabase上の

```text
role = admin
```

は変更されなかった。

つまり、ブラウザ側から直接roleを書き換えることはできないことを確認した。

---

## 11. 管理者判定の実装

サイト側で、

1. Supabase Authからログインユーザーを取得
2. UIDを取得
3. `admin_profiles` を検索
4. `role` を確認

する仕組みを実装した。

判定は、

```text
Google認証済み
      ↓
admin_profilesにUIDが存在？
      ↓
role = admin？
      ↓
YES → 浅い管理画面
NO  → 生徒画面
```

という構造。

---

## 12. 一般ユーザーによるテスト

Supabase AuthのUsersには登録されているものの、`admin_profiles` には登録していないアカウントでログインした。

結果、

```text
管理者権限がありません
```

とConsoleに表示され、管理画面へ移動しなかった。

一方、`admin_profiles` に

```text
role = admin
```

として登録したアカウントでは、浅い管理画面へ移動できた。

これにより、

> 「Google認証できること」と「管理者であること」を分離できた

ことを確認した。

---

## 13. 管理者一覧機能の設計

管理者一覧については、無料枠での通信量などを考慮し、

> 管理画面を開いた瞬間には取得しない

方針とした。

浅い管理画面に、

```text
管理者一覧を見る
```

ボタンを設置。

クリックしたときだけSupabaseへ問い合わせる構造にした。

さらに取得するデータを、

```javascript
.select("display_name, role")
```

として、

```text
取得する：
- display_name
- role

取得しない：
- user_id
- メールアドレス
- その他の不要なカラム
```

という構造とした。

---

## 14. 管理者一覧のキャッシュ

管理者一覧は一度取得したら、

```text
state.adminProfiles
```

に保存するようにした。

その後同じページでボタンを連打しても、Supabaseへ再問い合わせしないようにした。

実際に、ボタンを連打しても「管理者一覧取得成功」が1回しか出ないことを確認した。

F5でページを再読み込みすると状態がリセットされるため、再度クリックしたときに1回だけ取得されることも確認した。

---

## 15. 管理者一覧のUI調整

当初は、

```text
管理者一覧を見る
        ↓
管理者一覧を閉じる
```

とボタン表示を変える方式だった。

しかし、

> 一覧を表示した後に閉じる必要はない

と判断。

最終的に、

```text
[管理者一覧を見る]
```

をクリックすると一覧を表示し、ボタン自体を削除する仕様に変更した。

現在の表示例：

```text
admin : 制作者
```

この動作は正常に確認済み。

---

## 16. RLS自己参照によるエラーと修正

管理者一覧を取得するため、

> `role = admin` のユーザーだけが `admin_profiles` を読める

というRLSを追加した。

当初はRLS内部から `admin_profiles` 自身を参照する方式にしたため、

```text
infinite recursion detected in policy
for relation "admin_profiles"
```

というエラーが発生した。

これを確認した後、**Security Definer関数**を利用する方式へ変更した。

関数：

```text
is_admin()
```

これにより自己参照による無限再帰エラーを解消した。

---

## 17. 現在確認できているセキュリティ構造

現在の基本構造：

```text
Google
  ↓
Supabase Auth
  ↓
UID
  ↓
admin_profiles
  ↓
role
```

アクセス制御：

```text
一般ユーザー
  ↓
admin_profiles
  → 管理者一覧取得 ❌

管理者
  ↓
admin_profiles
  → 管理者一覧取得 ✅
```

また、

```text
ブラウザ
  ↓
roleを書き換える
  ↓
Supabase RLS
  ↓
❌ 拒否
```

となることも実際に確認済み。

---

## 18. 現在の進捗

### 完了

- [x] Supabase Auth導入
- [x] Google認証導入
- [x] Google OAuth設定
- [x] Client ID / Client Secret設定
- [x] Supabase Usersへの登録確認
- [x] 認証状態の復元
- [x] UID取得
- [x] `admin_profiles` 作成
- [x] UIDによる紐付け
- [x] `role` による管理者判定
- [x] RLS設定
- [x] roleの不正変更テスト
- [x] 一般ユーザーの管理画面アクセス拒否
- [x] 管理者一覧取得
- [x] 必要項目のみ取得
- [x] 管理者一覧の取得回数削減
- [x] 管理者一覧UI完成

### 今後

予定：

```text
① ログアウト機能の整理
        ↓
② 管理者機能の追加・整理
        ↓
③ 権限・RLSの追加確認
        ↓
④ @teacher.tym.ed.jp 制限
        ↓
⑤ 最終的なセキュリティテスト
        ↓
⑥ 学校での長期運用を想定した整理
```

`@teacher.tym.ed.jp` 制限は最後にする方針。

現在は個人Googleアカウントでもテストできるため、認証・権限部分を先に完成させ、最後に学校アカウント限定へ変更する。

---

## 19. 現時点の設計まとめ

現在の認証・権限管理は、

> **Googleで本人確認 → Supabase AuthでUIDを管理 → UIDを使ってadmin_profilesのroleを確認 → roleに応じて管理画面へのアクセスを制御し、重要な権限変更はRLSによってブラウザから禁止する**

という構造になっている。

また、管理者一覧については、

> **必要になったときだけ `display_name` と `role` を取得し、同一ページ内では再取得しない**

という通信量を抑えた設計になっている。
