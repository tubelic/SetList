// SetList の setlist.json を GitHub から取得して
// iCloud Drive > Scriptable > setlist.json に保存する
// 既存ファイルと内容が同じなら保存せず「更新がありませんでした。」と表示
// 内容が違う場合のみ、上書き確認を出して保存する

const RAW_URL = "https://raw.githubusercontent.com/tubelic/SetList/refs/heads/main/setlist.json";
const FILE_NAME = "setlist.json";

async function main() {
  const fm = FileManager.iCloud();
  const dir = fm.documentsDirectory();
  const filePath = fm.joinPath(dir, FILE_NAME);

  try {
    // GitHub から取得
    const req = new Request(RAW_URL);
    req.timeoutInterval = 30;
    const remoteText = await req.loadString();

    // 取得内容が JSON として正しいか確認
    let remoteJson;
    try {
      remoteJson = JSON.parse(remoteText);
    } catch (e) {
      await showMessage(
        "ダウンロード失敗",
        "取得した内容が JSON として不正だったため保存を中止しました。"
      );
      return;
    }

    // 比較用に整形
    const remoteCanonical = JSON.stringify(remoteJson);
    const remotePretty = JSON.stringify(remoteJson, null, 2) + "\n";

    // ローカル既存ファイルがあれば比較
    if (fm.fileExists(filePath)) {
      // iCloud 上のファイル読込前にダウンロードしておく
      await fm.downloadFileFromiCloud(filePath);

      let localJson = null;
      try {
        const localText = fm.readString(filePath);
        localJson = JSON.parse(localText);
      } catch (e) {
        // ローカルが壊れていても、更新確認は続行
      }

      if (localJson !== null) {
        const localCanonical = JSON.stringify(localJson);

        if (localCanonical === remoteCanonical) {
          await showMessage(
            "確認結果",
            "更新がありませんでした。"
          );
          return;
        }
      }

      // 差分あり or ローカルJSONが読めない場合は上書き確認
      const alert = new Alert();
      alert.title = "上書き確認";
      alert.message =
        `${FILE_NAME} に更新が見つかりました。\n\n` +
        `保存先:\n${filePath}\n\n` +
        "上書き保存しますか？";
      alert.addAction("上書きする");
      alert.addCancelAction("キャンセル");

      const result = await alert.presentAlert();
      if (result === -1) {
        return;
      }
    }

    // 保存
    fm.writeString(filePath, remotePretty);

    await showMessage(
      "保存完了",
      `${FILE_NAME} を保存しました。\n\n保存先:\n${filePath}`
    );
  } catch (error) {
    await showMessage(
      "エラー",
      `処理中にエラーが発生しました。\n\n${String(error)}`
    );
  }
}

async function showMessage(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("OK");
  await alert.presentAlert();
}

await main();
Script.complete();
