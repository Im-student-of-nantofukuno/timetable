週次時間割：フロントエンド第1パッチ

対象ファイル
- script.js
- index.html

このパッチで変更すること
1. 浅い管理画面・深い管理画面に「今週／来週／再来週／再々来週」の選択欄を追加。
2. 選択値を weekOffset（0～3）として保持。
3. 管理画面の時間割取得URLに weekOffset を追加。
4. 週ごとにブラウザキャッシュを分離。
5. 一括保存データの各変更項目に weekOffset を含める。
6. 重複確認用の全学年取得も週ごとに通信共有・キャッシュを分離。

重要な注意
- この段階ではGAS側の週枠読み取り・書き込み処理はまだ変更していません。
- Cloudflareの現在のAPIはGETパラメータとPOST本文をGASへ転送するため、Cloudflare側のコード変更はありません。
- GASがweekOffsetを処理するようになるまでは、週選択に応じた実際の列切り替えは行われません。
- 本パッチは本番適用前の作業用です。適用後にGAS側も対応させる必要があります。
- GitHub、Cloudflare、GAS、Googleスプレッドシートへの反映は行っていません。

適用方法（Git管理下のリポジトリのルートで）
  git apply script-week-offset.patch
  git apply index-week-selector.patch

戻す場合
  git apply -R script-week-offset.patch
  git apply -R index-week-selector.patch
