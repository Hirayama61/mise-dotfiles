# 分け方の観点

1 観点 1 節。各節は 兆候 (何を見たら当てるか)・決まり・直し方の形・重さ (既定)・対象外 で書く。
コードの形の `Xxx` は機能名に、`parts/` `hooks/` `utils/` と `XxxRoot` `XxxFrame` の名前は同じフォルダの前例に合わせて置き換える。
状態管理とフォームのライブラリは問わない。「store」「フォームの値」はそのリポジトリが使っているものを指す。

## A. 部品の層

部品は 4 つの層のどれかに置く。

| 層               | 持つもの                                                         | props                                        |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| Root             | 取得・フォームの状態・送信・確認ダイアログ・入れ子モーダルの開閉 | 対象 (ID・日付) と `onClose` / `onCompleted` |
| 枠               | タイトル・本文・ボタンの配置                                     | `children` か `ReactNode` の slot            |
| 並べるだけの部品 | 余白と順番                                                       | `ReactNode` の slot                          |
| 見た目だけの部品 | 1 つの表示                                                       | 文字列・boolean・`null`                      |

### S-01 モーダルは Root と枠に分ける

兆候: 1 つのファイルに `Dialog` と、取得・フォームの設定・送信・別のモーダルの開閉のどれかが同居している。props が 8 個以上。`renderForm` / `renderXxx` で本文を組み立てている。

決まり: 枠 (`XxxFrame`) はタイトル・本文・ボタンの配置だけを持ち、本文とボタンを `children` か `ReactNode` の slot で受け取る。
Root (`XxxModalRoot`) が初期値・取得・フォームの状態・送信・確認やエラーのダイアログ・入れ子のモーダルの開閉を持つ。
親 (Container) から渡すのは、押された対象と `onClose` / `onCompleted` だけ。

直し方の形は次のとおり。

```text
XxxModalRoot          取得・フォーム・送信・入れ子モーダルの開閉
└ <フォームの Provider>
   ├ XxxModalFrame    枠。children を PropsWithChildren で受ける
   │  └ XxxModalBody  本文の並び。欄・一覧・ボタンを ReactNode の slot で受ける (S-03)
   └ YyyModalRoot     入れ子のモーダルは Dialog の外で兄弟に並べる (S-02)
```

```ts
type OwnProps = {
  /** 保存中。「保存する」を押せない */
  isSubmitting: boolean;
  onCancel: () => void;
  onSave: () => void;
};
/** children は入力欄と一覧 */
type Props = React.PropsWithChildren<OwnProps>;
```

重さ: MUST。

対象外: 確認ダイアログのように本文が固定文言 1 つの部品。

### S-02 Dialog の中で Dialog を開かない

兆候: `Dialog` の子孫 (`render` 関数・`renderXxx` の戻り値・`DialogContent` の中) で、別のモーダルやその Root を描画している。

決まり: 入れ子のモーダルは Root で兄弟として並べる。2 つが同じフォームの値を見るなら、フォームの Provider の中で並べる。

直し方の形は次のとおり。

```tsx
<FormProvider {...form}>
  <XxxModalFrame {...frameProps}>...</XxxModalFrame>
  {isYyyOpen && <YyyModalRoot onClose={handleCloseYyy} />}
</FormProvider>
```

重さ: MUST。

### S-03 並べるだけの部品は slot で受ける

兆候: 受け取った props の大半を使わずに 1〜2 個の子へそのまま渡している。配列・オブジェクト・フォームの状態が素通りしている。並び方 (余白・順番) だけを持つ部品が、入力欄のマスタや一覧のデータまで知っている。

決まり: 並び方だけを持つ部品は、中身を `ReactNode` の slot (`fields` / `table` / `addButton`) か `children` で受け取り、組み立ては Root で行う。`children` を受け取る部品は `React.PropsWithChildren<OwnProps>` で型を付ける。

直し方の形は次のとおり。

```ts
type OwnProps = {
  /** 入力欄 (XxxFields) */
  fields: React.ReactNode;
  /** 一覧 (XxxTable) */
  table: React.ReactNode;
  /** 追加ボタン (AddXxxButtonRoot) */
  addButton: React.ReactNode;
};
```

```tsx
// Root 側
<XxxModalBody
  fields={<XxxFields form={form} />}
  table={<XxxTable users={users} />}
  addButton={<AddXxxButtonRoot onOpen={handleOpen} />}
/>
```

重さ: MUST。

### S-04 表と行は枠。各列は Root が組み立てる

兆候: 表や行の部品が `rows` の配列・`selectedIds`・`reservations` のような配列を受け取り、行ごとに業務ルールや上限の判定を呼んでいる。行がオブジェクト (行の型) を丸ごと受け取っている。セルの JSX を配列に詰めて共通の表部品に渡している。

決まり: 表は見出しと行を並べる枠にして `children` と boolean (`isEmpty` など) だけを受け取る。行は列の並びと見た目だけを持ち、チェックボックス・ラベル・チップを `ReactNode` で受け取る。
行ごとに繰り返す対話部品 (チェックボックスなど) は、`aria-label` と付け外しだけを持つ小部品 (`XxxCheckbox`) に分ける。Root が `isChecked` / `isDisabled` / `onToggle` を渡す。
行は `tbody` の中で `map` で描く。

直し方の形は次のとおり。

```ts
// parts/XxxTable.tsx
type OwnProps = { /** 行が 0 件。案内文言を出す */ isEmpty: boolean };
type Props = React.PropsWithChildren<OwnProps>;

// parts/XxxRow.tsx
type OwnProps = {
  checkbox: React.ReactNode;
  /** 省略されたときの全文を title に出す */
  userName: XxxFormDetail["userName"];
  statusLabel: React.ReactNode;
  chips: React.ReactNode;
};

// parts/XxxCheckbox.tsx
type OwnProps = {
  userId: XxxFormDetail["userId"];
  /** 読み上げに使う */
  userName: XxxFormDetail["userName"];
  isChecked: boolean;
  isDisabled: boolean;
  onToggle: (userId: XxxFormDetail["userId"]) => void;
};
```

```tsx
// Root 側
const hasNoRows = rows.length === 0;
<XxxTable isEmpty={hasNoRows}>
  {rows.map((row) => (
    <XxxRow
      key={row.userId}
      checkbox={
        <XxxCheckbox
          {...row}
          isChecked={isChecked(row.userId)}
          isDisabled={!canCheck(row.userId)}
          onToggle={toggle}
        />
      }
      userName={row.userName}
      statusLabel={hasStatusLabel && <XxxStatusLabel status={row.status} />}
      chips={<XxxChipsRoot userId={row.userId} />}
    />
  ))}
</XxxTable>;
```

重さ: MUST。

対象外: 行が自分の 1 件のフィールドだけから作る表記 (改行の除去・期間の表記・区分値から色を引く) は行の知識なので、API の型の要素を 1 件受け取って行の中で変換してよい。指摘するのは、他の行・store・上限のように行の外を見ないと決まらない判定を行で呼んでいるとき。

### S-05 見た目だけの部品は API の型を知らない

兆候: `parts/` のチップ・ラベル・セルが API のレスポンス型を丸ごと受け取り、中で色・向き・時間帯に変換している。`parts/` の部品が Root のフォルダの中の型を import している。

決まり: 表示に使う文字列・boolean・`null` だけを props にし、変換と「どの要素を出すか」は、store とフォームから自分で取り出す `XxxChipsRoot` に寄せる。props の型は `string` のままにし、API の型でつながない。
`parts/` の部品の型は、フォームの型 (`XxxFormDetail["userName"]`) か `string` から取る。

直し方の形は次のとおり。

```ts
// parts/XxxChip.tsx
type OwnProps = {
  /** 時間帯の略称 (午前・午後) */
  slotLabel: string;
  roomName: string;
  /** 開始〜終了。どちらも未入力なら null */
  timeRange: string | null;
  textColor: string;
  backgroundColor: string;
};

// XxxChipsRoot/XxxChipsRoot.tsx  props はメンバー ID だけ。一覧は store、対象日と編集中 ID はフォームから
type OwnProps = { userId: XxxFormDetail["userId"] };
const assigned = getAssignedReservations(reservations, userId, targetDate, editingReservationId);
return assigned.map((r) => <XxxChip key={r.id} slotLabel={...} roomName={r.room.name} timeRange={getTimeRange(r)} textColor={text} backgroundColor={background} />);
```

重さ: MUST。

対象外: 表記が定数表 (`LABEL[status]`) で引けるラベルは、文字列まで下げない。出す状況だけに絞った元の型 (`Exclude<Status, "normal">`) で受け取る (expression E-10)。

### S-06 1 つの操作の知識は 1 つの部品に。操作の処理はハンドラに置く

兆候: ボタンを押せる条件を親が計算し、押した後の取得を子 (開くモーダルの Root) が `useEffect` でしている。取り終わるまで `null` を返す分岐や、`hasFetchSettled` / `isFetched` の state がある。

決まり: 押せる条件・押したときの取得・開く、を 1 つの `XxxButtonRoot` にまとめ、store とフォームから自分で取り出す。取得は `useEffect` ではなくハンドラで行い、終わってから `onOpen()` を呼ぶ。開く側の Root から取得・settled の state・`null` 返却を外す。

直し方の形は次のとおり。

```ts
// AddXxxButtonRoot.tsx
type OwnProps = { /** 取り直した後に呼ぶ。失敗しても呼ぶ */ onOpen: () => void };

const AddXxxButtonRoot = (props: Props): JSX.Element => {
  const { onOpen } = props;
  const users = useUsersOnTargetDate();
  const hasEnabledUser = users.some((user) => isEnabledUser(user));
  const handleClick = (): void => {
    // 失敗の通知は取得層が出す。失敗しても、取得できている同じ日のメンバーで開く
    fetchUsers(targetDate).then(() => { onOpen(); });
  };
  return <Button disabled={!hasEnabledUser} onClick={handleClick}>...</Button>;
};
```

重さ: MUST。

### S-07 Root だけの state は hooks/ に分ける

兆候: Root が、チェックの状態・上限・確定後の値のように、その Root だけで使う state と関数のまとまりを持っている。

決まり: `XxxRoot/hooks/useXxx.ts` へ分け、store やフォームを用意しなくてもテストできる形にする。引数は値で並べる (expression E-12)。戻り値は、Root が描画に使う最小の関数と値にする。

直し方の形は次のとおり。

```ts
// XxxRoot/hooks/useSelection.ts
export const useSelection = (
  users: User[],
  selected: XxxFormDetail[],
  limit: number
): {
  rows: SelectionRow[];
  isChecked: (id: UserId) => boolean;
  canCheck: (id: UserId) => boolean;
  toggle: (id: UserId) => void;
  getSelected: () => XxxFormDetail[];
} => { ... };
```

テストは hook を呼ぶだけの部品を描画して確かめる。

重さ: MUST。

対象外: boolean 1 つの開閉 state。

### S-08 1 機能 1 ファイル。変更が集まるファイルを作らない

兆候: Container や表・フォームの部品が、追加・編集・削除・コピーのように複数の機能の中身 (描画・取得・state・開閉) を持っている。行数や props の数が膨らんでいる。

決まり: Container は開くものを選んで Root を並べるだけにする。追加・編集は `modal/`、削除は `dialog/`、エラー帯は `parts/` に 1 機能 1 ファイル。機能をやめるときにファイルを消せば済む形にする。

重さ: SHOULD。既存ファイルにこの PR が責務を足したなら MUST で、その責務を含む分け直しは「この PR で直す」。

### S-09 JSDoc の @remarks に「持たないこと」と「誰が決めるか」

兆候: 分けた部品・関数の JSDoc に、何を持たないかが書かれていない。または書かれているが実装と合っていない。

決まり: `@remarks 〜は判定しない (XxxRoot が決める)` の形で、持たないことと決める場所を書く。

重さ: NITS。

## B. 関数・型の置き場所

### S-10 業務ルールは名前の付いた純粋関数に

兆候: コンポーネントや関数の中に、`canInvite` のような無名・ローカルの閉包で業務ルール (招待できる条件・押せる条件・上限) が書かれている。JSX や `filter` の中で区分値と `===` 比較をしている。

決まり: 業務のルールは、1 か所でしか使わなくても名前の付いた関数 (`canXxx` / `isXxx` / `getXxx`) に出し、条件の左右を説明変数に分け、テストを付ける。置き場所は S-12。

直し方の形は次のとおり。

```ts
/** メンバー選択モーダルで新しく招待できるメンバーか。予約の権限があり、対象日が契約期間内 */
export const canAddAttendee = (user: User): boolean => {
  const isReservationEnabled = isReservationEnabledMember(user);
  const isOutOfContractPeriod = user.status === USER_STATUS.outOfContractPeriod;
  return isReservationEnabled && !isOutOfContractPeriod;
};
```

重さ: MUST。

対象外: 業務のルールでない自明な処理、薄いラッパー。

### S-11 関数の入力は、その役割に要るものだけ

兆候: 行や一覧を作る関数が、別の表示 (チップ・集計) のための値を同じ戻り値へ相乗りさせるために、余分な引数を受け取っている。戻り値の型に、その関数の役割と別の用途のフィールドがある。内部で別の関数に分けていても、同じ戻り値に入っていれば相乗り。引数をオブジェクト 1 つにまとめている (責務が多いサイン。expression E-12)。

決まり: 役割ごとに関数を分け、入力をその役割に要るものだけにする。別の表示のための値は、それを出す部品 (`XxxChipsRoot`) が自分の関数 (`getAssignedReservations`) で引く。

直し方の形は次のとおり。

```ts
// 行を作る関数の入力は users と attendees だけ
export const getSelectionRows = (users: User[], attendees: XxxFormDetail[]): SelectionRow[]
// 別の表示のための値は別の関数
export const getAssignedReservations = (reservations: Reservation[], userId: UserId, targetDate: string, editingReservationId: XxxFormValues["id"]): Reservation[]
```

重さ: MUST。

### S-12 置き場所は使う範囲で決める。parts は Root のフォルダを読まない

兆候: 1 つの部品からしか使わない関数・hook が共有ディレクトリにある。2 か所以上で使う関数が部品のフォルダにある。`parts/` の部品が `XxxRoot/utils/` の型を import している。`validators` や `utils` が何でも置き場になっている。

決まり: `git grep` で使っている箇所を数えて決める。将来の再利用の見込みを理由にしない。

- 1 か所: 使う部品の名前のフォルダを作って本体を入れ、横に `hooks/` `utils/` を置く。テストも同じフォルダ
- 2 か所以上: 機能ごとの共有ディレクトリ (場所は前例と同じ) に置き、テストを付ける
- 表示の都合だけの関数・定数 (文言の組み立て・改行の除去・余白の計算) は、その部品のファイルの中
- 2 つの Root から使う hook は、その機能のフォルダの `hooks/`
- `parts/` の部品の型は、フォームの型か `string` から取る。行の型が `Pick<XxxFormDetail, ...>` なら同じ型になる

直し方の形は次のとおり。

```text
modal/
  XxxRoot/
    XxxRoot.tsx
    XxxRoot.test.tsx
    hooks/useXxx.ts (+ .test.tsx)
    utils/getXxxRows.ts (+ .test.ts)      共有ディレクトリから移す
  parts/XxxRow.tsx                        型は XxxFormDetail から取る
<共有ディレクトリ>/<機能>/isXxx.ts         2 か所以上で使うものだけ
```

重さ: MUST。

### S-13 同じ型を複数ファイルで書き直さない

兆候: `GetXxxResponse["data"]["users"][number]` のような別名が複数ファイルにある (`git grep` で数える)。戻り値の型を `{ background: string; text: string }` のように書き直している。

決まり: API のレスポンスの要素は、API の型ファイルで 1 回だけ `export type Xxx = GetXxxResponse["data"]["xxx"][number]` と定義する。各ファイルはそれを import する。定数の値や関数の戻り値の型は、元の型から `Pick` で取って名前を付けて export する。
API のファイルを触る分は「別チケット可」にしてよいが、形は書く。

直し方の形は次のとおり。

```ts
// api/getUsers.ts
export type User = GetUsersResponse["data"]["users"][number];
// <共有ディレクトリ>/getRoomColor.ts
export type RoomColor = Pick<(typeof ROOM_COLORS)[RoomColorKey], "background" | "text">;
```

重さ: SHOULD。

## C. 分岐と共通化

### S-14 分岐は外側で決める。boolean で違いを吸収した共通化をしない

兆候: 新規と編集・プラン種別・日単位と週単位のような分岐が、画面内や共通部品の `if` / boolean props にある。

決まり: 新規と編集は Container を分け、どちらかはページが URL で 1 回決める。違いが大きいものは Root ごとファイルを分ける。共通化は、今の呼び出し元が同じ使い方をしているときだけ。

重さ: MUST。

### S-15 同じ役割の部品が隣にあるなら、見た目の決まりは 1 つの枠に寄せる

兆候: 新しく作る (または直す) 部品が、同じフォルダの既存の部品と同じ atoms (`ConfirmDialog` など)・同じ幅や余白の定数・同じ props を使っている。デザイン由来のスタイル (余白・文字色・行の高さ) が片方の部品にだけある。同じ atoms の利用箇所を同じフォルダで `git grep` して数える。

決まり: 見た目の決まりは機能名の枠 (`XxxConfirmDialog`) に 1 つ持ち、各ダイアログは本文の組み立てと送信だけを持つ。違いは文字の大きさのような区分値 (`messageSize`) で受け、boolean で分岐しない (S-14)。送信を持つダイアログは、送信中の state を自分で持って枠の `isSubmitting` に渡し、失敗したときだけ戻す (成功は `onCompleted` で閉じる)。

直し方の形は次のとおり。

```text
dialog/
  XxxConfirmDialog.tsx        枠。title / message / messageSize / submitLabel / isSubmitting / onCancel / onConfirm。余白・色・幅はここだけ
  CopyConfirmDialog.tsx       本文の組み立てだけ。スタイルを持たない
  XxxDeleteDialog.tsx         送信と isSubmitting の state。本文は定数
```

```ts
const [isDeleting, setIsDeleting] = React.useState(false);
// 成功したら onCompleted で閉じるので、isDeleting は失敗したときだけ戻す
const handleDelete = async (): Promise<void> => {
  setIsDeleting(true);
  const isDeleted = await deleteXxx(id).then(
    () => true,
    () => false,
  );
  if (!isDeleted) {
    setIsDeleting(false);
    return;
  }
  onCompleted();
};
```

重さ: SHOULD。送信中でも二重に押せるダイアログは MUST (test T-05 の「応答を待っている間」と組)。

対象外: 使い方が違う部品を boolean の分岐でまとめること (S-14)。
