---
paths:
  - "**/*.tsx"
---

# React コンポーネントの規約

レビューで当てる観点の全文と直し方の例は `~/.claude/skills/frontend-review/references/` にある (`S-xx` は分け方、`E-xx` は書き方)。
関数コンポーネントと hooks を前提とする。この規約とプロジェクトの既存方針が食い違うときは、既存方針を優先する。

## 部品の層

部品は次の 4 層のどれかに置き、層をまたぐ知識を持たせない。

| 層               | 持つもの                                                         | props                                         |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Root             | 取得・フォームの状態・送信・確認ダイアログ・入れ子モーダルの開閉 | 押された対象と `onClose` / `onCompleted` だけ |
| 枠               | タイトル・本文・ボタンの配置                                     | `children` か `ReactNode` の slot             |
| 並べるだけの部品 | 余白と順番                                                       | `ReactNode` の slot                           |
| 見た目だけの部品 | 1 つの表示。API の型を知らない                                   | 文字列・boolean・`null`                       |

- 受け取った props を使わずに子へ流さない。並べるだけなら slot で受け、組み立ては Root で行う。
- モーダルの中で別のモーダルを開かない。Root で兄弟として並べる。
- 表は見出しと行を並べる枠、行は列の並びだけ。他の行・store・上限のように行の外を見ないと決まらない判定は Root が行い、結果を `ReactNode` か boolean で渡す。
- 1 つの操作 (押せる条件・押したときの処理・開く) は 1 つの部品にまとめる。処理はハンドラに置き、`useEffect` で起こさない。
- Root だけで使う state と関数のまとまりは `hooks/useXxx.ts` に分け、描画なしでテストできるようにする。boolean 1 つの開閉は除く。
- 1 機能 1 ファイル。Container は開くものを選んで Root を並べるだけにする。
- 新規と編集のような分岐は外側 (ページや Container) で 1 回決める。共通部品の boolean props で違いを吸収しない。
- 同じ役割の部品が隣にあるなら、余白・色・幅の決まりは 1 つの枠に寄せ、各部品は本文の組み立てと送信だけを持つ。

## state と effect

- `useState` / `useMemo` / `useCallback` で値を固定しない。props から計算できる値は毎回計算する。
- `useEffect` を操作の結果や派生値に使わない。派生値は描画の中で計算する。
- 同じ事実を複数の state に持たない。選択中の要素は、オブジェクトのコピーではなく ID で持つ。
- state は使う部品に置く。兄弟で共有が要るようになってから、共通の親へ持ち上げる。
- 親への通知は、子の state を更新する event handler の中で親の callback を呼ぶ。Effect で state の変化を見張って親へ伝えない。
- Effect で state を更新し、別の Effect がそれを検知する連鎖を作らない。次の state は 1 つの event handler の中でまとめて計算する。
- `isMounted` の守りは、実際にアンマウントできる経路をコードで確かめてから入れる。
- 同時に 1 つしか成り立たない状態 (開いているモーダル・送信の段階) は `kind` 付きの union 1 つの state で持つ。モーダルは開いている間だけ描き、リセットの effect を持たない。
- 送信を持つ部品は送信中の state を自分で持ち、失敗したときだけ戻す。成功は `onCompleted` で閉じる。

## props と本文

- props は本体の先頭で `const { a, b } = props;` と分割代入する。引数の位置で分割代入しない。
- `children` は `React.PropsWithChildren<OwnProps>` で受け、JSDoc に children が何かを書く。
- JSX は並べるだけにする。比較・判定・表記の組み立て・見出しの配列は変数に出す。
- 見た目の出し分けは既定クラスと上書きクラス (`clsx(classes.root, { [classes.absent]: isAbsent })`) にする。三項演算子でクラスを選ばない。
- 動的な色は `style` に CSS 変数だけを渡し、class 側で `var(--xxx)` を読む。
- 表に `caption`、アイコンだけの列に見えない見出し、繰り返す対話部品に `aria-label` を付ける。グループは `fieldset` / `legend`。
- 表の行は `tbody` の中で `map` で描く。フォームの配列操作はライブラリのものを使う。

## render の純粋性

- render 中に、部品の外にある変数・オブジェクト・DOM を変更しない。render は同じ props と state から同じ JSX を返す計算として書く。
- 部品を別の部品の内部で定義しない。内部で定義すると render のたびに別の型になり、子の state と DOM が毎回作り直される。
- JSX を返す `renderFoo()` を増やさず、UI のまとまりを別の部品へ切り出す。

## key

- props が変わったら state を初期化したいときは、Effect で `setState` せず `key` で表す。`key` が変わると部品は別物として扱われ、内部の state がすべて初期値に戻る。
- `key` はリストの警告を消す道具ではなく、要素の identity として扱う。並び替えや削除が起きるリストに index を `key` として渡さない。

```tsx
// Good
<Profile key={userId} userId={userId} />;

// Avoid
useEffect(() => {
  setComment("");
}, [userId]);
```

## Effect

- Effect を書く前に、render 中に計算できないか、event handler で実行できないかを検討する。どちらでもないときだけ Effect を使う。
- Effect は、React の外にあるシステム (DOM API・タイマー・購読・ネットワーク) と同期するために使う。
- setup で外部に与えた作用は、cleanup で戻す。購読は解除し、タイマーは止める。
- Effect でデータを取得するときは、cleanup で古いリクエストの結果を捨てる。props が素早く変わったとき、遅れて届いた古い応答で state を上書きしないためである。

```tsx
// Good
useEffect(() => {
  let ignore = false;
  fetchUser(userId).then((user) => {
    if (!ignore) {
      setUser(user);
    }
  });
  return () => {
    ignore = true;
  };
}, [userId]);

// Avoid
useEffect(() => {
  fetchUser(userId).then(setUser);
}, [userId]);
```

## 依存配列

- Effect の中で読む props・state・それらから作った値を、すべて依存配列に書く。依存配列は「どの値が変わったら同期し直すか」の宣言で、実行回数を調整する道具ではない。
- `react-hooks/exhaustive-deps` を `eslint-disable` で黙らせない。依存を減らしたいときは、依存配列ではなく Effect のコードを変える。
- render 中に作ったオブジェクトや関数が依存に入って毎回再実行される場合は、それを Effect の中へ移す。

```tsx
// Good
useEffect(() => {
  const options = { roomId, serverUrl };
  const connection = createConnection(options);
  connection.connect();
  return () => connection.disconnect();
}, [roomId, serverUrl]);

// Avoid
const options = { roomId, serverUrl };
useEffect(() => {
  const connection = createConnection(options);
  connection.connect();
  return () => connection.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

## メモ化

- `useMemo`・`useCallback`・`React.memo` は性能の最適化として扱い、正しさをこれらで担保しない。外しても結果が変わらないコードを書く。
- 部品の中で定義し、1 つの Effect だけで使う関数は `useCallback` で包まず、その Effect の中へ移す。props で受け取った callback のように移せない関数は、この限りでない。
