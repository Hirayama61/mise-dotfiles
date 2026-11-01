# 書き方の観点

1 観点 1 節。各節は 兆候 (何を見たら当てるか)・決まり・直し方の形・重さ (既定)・対象外 で書く。
スタイルの仕組み (CSS Modules・CSS-in-JS) は問わない。`classes.xxx` はそのリポジトリの class の参照に読み替える。

## A. 読みやすさ

### E-01 props は本体の先頭で分割代入する

兆候: `const Core = ({ classes, status }: Props)` のように引数の位置で分割代入している。`props.xxx` を本文で直接参照している。

決まり: `const Core = (props: Props): JSX.Element => { const { classes, status } = props; ... }` にそろえる。

重さ: MUST。

### E-02 条件と値は説明変数で意図を表す

兆候: JSX の `{cond && ...}` や `if` の条件が `status === USER_STATUS.normal` のような比較のまま。JSX の中で関数を呼んでいる (`{formatDate(dateKey, FORMAT)}`)。`rows.length === 0` のような判定が JSX にある。

決まり: 比較・判定・表記の組み立ては、何の判定かが読める名前の変数 (`isNormal` / `hasNoRows` / `dateLabel`) に出してから使う。型ガードの結果を変数にしても、TS 4.9 以降では絞り込まれる。例: `const hasStatusLabel = isLabeledStatus(status); {hasStatusLabel && <Label status={status} />}`。

直し方の形は次のとおり。

```diff
- {rows.length === 0 && <Empty />}
+ const hasNoRows = rows.length === 0;
+ {hasNoRows && <Empty />}
```

重さ: MUST。

対象外: 一度しか使わず、その場の名前 (スタイル名・変数名) で意味が分かる値。式を言い換えるだけの説明変数 (`const value = props.value`)。

### E-03 三項演算子でクラス・数・分岐を選ばない

兆候: `cond ? classes.a : classes.b`。`(x ? 1 : 0) + ...` のような数え方。`prev.includes(id) ? prev.filter(...) : prev.concat(id)`。入れ子の三項演算子。

決まりは次のとおり。

- 見た目の出し分けは、既定のスタイルと上書きのクラスにして `clsx(classes.root, { [classes.absent]: isAbsent })`
- 数えるときは配列にして型ガードで外してから `length`
- 分岐は説明変数と早期 `return`

直し方の形は次のとおり。

```diff
- const colorClassName = status === ABSENT ? classes.absent : classes.outOfPeriod;
- <span className={clsx(classes.root, colorClassName)}>
+ // root に期間外・対象外の色を置き、欠席だけ absent で上書きする
+ const isAbsent = status === USER_STATUS.absent;
+ <span className={clsx(classes.root, { [classes.absent]: isAbsent })}>
```

```diff
- const headcount = (reservation.organizer ? 1 : 0) + reservation.participants.length + reservation.attendees.length;
+ // 主催者は未選択 (null) のことがあるので、人数から外して数える
+ const people = [reservation.organizer, ...reservation.participants].filter(
+   (person): person is NonNullable<Reservation["organizer"]> => person !== null
+ );
+ const headcount = people.length + reservation.attendees.length;
```

```diff
- setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat(id));
+ setSelectedIds((prev) => {
+   const isSelected = prev.includes(id);
+   if (isSelected) return prev.filter((x) => x !== id);
+   return prev.concat(id);
+ });
```

重さ: MUST。

### E-04 処理を段階に分ける。1 件の変換を関数に出す

兆候: `reduce` で絞り込みと変換を同時にしている。`new Map` を作ってから引いているが、引くのは 1 人分を探すだけ。長い `filter` / `map` の連鎖が 1 文。

決まり: 要素 1 つの変換を `toXxx(row, ...)` に出し、`filter` → `map` の順に段階で書く。1 件を探すだけなら `find` で、引く場所で探し方が読めるようにする。実際には起きない分岐は型で消す (E-09)。それができないときはコメントで「起きない」と残す。

直し方の形は次のとおり。

```diff
- return rows.filter(isSelected).reduce<Detail[]>((acc, row) => { ... }, []);
+ const selectedRows = rows.filter((row) => selectedIds.includes(row.userId));
+ return selectedRows.map((row) => toSelectedAttendee(row, reservationType));
```

重さ: MUST。

### E-05 未入力・未取得・見つからないは定数にして比べる

兆候: `time ? convert(time) : ""` のように文字列の真偽値で未入力を見ている。`users === null` や `user?.x ?? default` を素のまま書いている。`departureTime || arrivalTime`。

決まり: API の型に合わせて `null` / `""` / `undefined` を名前の付いた定数にし、説明変数で比べる。「通常」と「分からない」のように意味が違う状態を同じ値に畳まない (E-10)。

直し方の形は次のとおり。

```diff
+ /** 時刻が未入力のときの API の値 */
+ const UNSET_TIME = null;
+ /** 時刻が未入力のときの表記 */
+ const EMPTY_TIME = "";
- const toHHMM = (time: string | null): string => (time ? convertHHMMSSToHHMM(time) : "");
+ const toHHMM = (time: string | null): string => {
+   const isUnset = time === UNSET_TIME;
+   if (isUnset) return EMPTY_TIME;
+   return convertHHMMSSToHHMM(time);
+ };
```

```diff
+ /** 対象日のメンバーが未取得のときの値 */
+ const UNFETCHED_USERS = null;
- if (users === null) return [];
+ const isUnfetched = users === UNFETCHED_USERS;
+ if (isUnfetched) return [];
```

重さ: SHOULD。

### E-06 色・数値は定数。既存の定数があればそれを使う

兆候: `"#f5f5f5"` `"rgba(0, 0, 0, 0.6)"` のような直書き。スタイルの定義の中に色が直接ある。

決まり: 値そのものを `git grep` し、リポジトリの定数ファイルに同じ値の定数があればそれを使う。なければファイルの先頭に名前の付いた定数を作る。数値・文言の定数には出どころ (デザインファイル・画面項目書) を JSDoc に書き、ライブラリの初期値との差し引きで求めた値は式のまま定数にする。

直し方の形は次のとおり。

```diff
+ import { BASE_BACKGROUND_COLOR, DARK_BLUE } from "@/constants/styles";
-   backgroundColor: "#f5f5f5",
-   color: "#37474f"
+   backgroundColor: BASE_BACKGROUND_COLOR,
+   color: DARK_BLUE
```

重さ: MUST。

対象外: 一度しか使わず、その場の名前で意味が分かり、既存の定数もない値 (`padding: "2px 12px"` など)。

### E-07 JSX は並べるだけにする

兆候: `items={[{ label: ..., className: ... }, ...]}` のように見出しの配列を JSX の中で作っている。JSX の中で `map` の中身が長い。

決まり: 見出しの項目 (`headItems`) や行の値は変数に出し、JSX は並べるだけにする。

重さ: NITS。

### E-08 名前は中身に合わせる

兆候: 値を取り出すだけの関数が `to*` (変換) で始まる。判定が `is*` / `has*` / `can*` でない。

決まり: 取得 `get*` / `find*`、変換 `to*` / `format*` / `convert*`、判定 `is*` / `has*` / `can*`。同じディレクトリの前例にそろえる。

重さ: NITS。

## B. 型

### E-09 作った元が 2 通りある要素は判別 union にする

兆候: 「一覧にいたメンバー」と「新しく招待するメンバー」のように作った元が違う要素を同じ形の型に畳み、後段で ID から元の配列を `find` し直している。「どちらにもいない」という起きない場合に `undefined` を返して型ガードで落としている。`isAttendee: boolean` のようなフラグで元を表している。

決まり: 行に `source` を持たせた判別 union にし、元の値 (`attendee` / `user`) をそのまま持つ。後段は `source` で分けるだけにし、探し直しと `undefined` を消す。

直し方の形は次のとおり。

```ts
export const ROW_SOURCE = { attendee: "attendee", candidate: "candidate" } as const;
export type SelectionRow = Pick<XxxFormDetail, "userId" | "userName"> &
  (
    | { source: typeof ROW_SOURCE.attendee; attendee: XxxFormDetail; status: Status | undefined }
    | { source: typeof ROW_SOURCE.candidate; user: User; status: Status }
  );

const toSelectedAttendee = (
  row: SelectionRow,
  reservationType: XxxFormValues["reservationType"],
): XxxFormDetail => {
  const isAttendee = row.source === ROW_SOURCE.attendee;
  if (isAttendee) return row.attendee;
  return toFormDetail(row.user, reservationType);
};
```

重さ: MUST。

### E-10 「分からない」を既定値に畳まない。出す状況だけの型で受け取る

兆候: `user?.status ?? USER_STATUS.normal` のように、見つからない場合を「通常」に畳んでいる。見た目の部品が `status === normal` なら `null` を返す分岐を持っている。定数表に `normal: ""` のような使わない値がある。

決まり: 分からないときは `undefined` のままにする。出すかどうかは呼ぶ側が型ガード (`isLabeledXxx(status): status is LabeledXxx`) で決める。見た目の部品は出す状況だけの型 (`Exclude<Status, typeof STATUS.normal>`) を props にし、`null` 返却を持たない。型ガードは 2 か所以上で使うなら共有ディレクトリに置く。

直し方の形は次のとおり。

```ts
export type LabeledUserStatus = Exclude<UserStatus, typeof USER_STATUS.normal>;
const UNKNOWN_STATUS = undefined;
export const isLabeledUserStatus = (
  status: UserStatus | undefined,
): status is LabeledUserStatus => {
  const isUnknown = status === UNKNOWN_STATUS;
  const isNormal = status === USER_STATUS.normal;
  return !isUnknown && !isNormal;
};
```

```diff
  type OwnProps = {
-   status: UserStatus;
+   status: LabeledUserStatus;
  };
- if (status === USER_STATUS.normal) return null;
```

重さ: MUST。

### E-11 同時に 1 つしか成り立たない状態は union 1 つで持つ

兆候: 開いているモーダルや送信の段階を、boolean の state を並べて表している。段階と一緒に変わる値 (確認の本文) を別の state に持っている。

決まり: `kind` / `phase` 付きの union 1 つで持ち、一緒に変わる値も同じ state に入れる。送信中かなどの boolean は段階から表で導く。モーダルは開いている間だけ描き、リセットの effect を持たない。

重さ: SHOULD。

### E-12 引数は値で並べる。オブジェクト 1 つの引数は責務が多いサイン

兆候: `fn({ a, b, c }: XxxSource)` のように引数をオブジェクト 1 つで受けている。引数をまとめるためだけの型 (`XxxSource` / `XxxParams`) がある。

決まり: 引数をまとめたくなった時点で、その関数の役割が多すぎないかを疑う (structure S-11)。小さな関数に分けて呼ぶ側で組み合わせ (`toSelectedAttendees` → `filterSelectedRows` + `toSelectedAttendee`)、分けた後の引数は値で並べる。呼ぶ側から、何を使うか・いくつ受けているかが読めるようにする。まとめる型は消す。

直し方の形は次のとおり。

```diff
- export const getRows = ({ users, attendees }: RowsSource): Row[] =>
+ export const getRows = (users: User[], attendees: XxxFormDetail[]): Row[] =>
```

```ts
const selectedRows = filterSelectedRows(rows, selectedIds);
const next = selectedRows.map((row) => toSelectedAttendee(row, reservationType));
```

重さ: SHOULD。

対象外: React の props。

## C. React

### E-13 useState / useMemo / useCallback を「値を固定する」ために使わない

兆候: `const [rows] = React.useState(() => compute(...))` で最初の描画の値を固定している。`React.useMemo(() => toInitialValues(...), [target])` で「開いている間は同じ値」を保っている。依存配列から props が抜けている。

決まり: これらは計算を省くだけで、値が同じことを保証しない。性能のためにだけ使う。props から計算できる値は毎回計算する。固定が要るのは、開いている間に props が変わり、それを反映してはいけない経路があるときだけで、その経路があることをコードで確かめる。フォームライブラリの初期値は、再初期化の設定がなければ最初の描画でしか読まれないので、毎回計算してよい。

直し方の形は次のとおり。

```diff
- const [rows] = React.useState(() => getRows(users, attendees));
+ const rows = getRows(users, attendees);
```

```diff
- const initialValues = React.useMemo(() => toInitialValues(target, locations), [target]);
+ // 初期値は最初の描画でしか読まれないので、開いたときの値が初期値になる
+ const initialValues = toInitialValues(target, locations);
```

重さ: MUST。

### E-14 useEffect を操作の結果や派生値に使わない。isMounted は経路があるときだけ

兆候: ボタンを押したことをきっかけにする取得を、開いた部品の `useEffect` でしている。派生値や store の監視に `useEffect` と state を使っている。`let isMounted = true` の cleanup があるが、取得中はオーバーレイで閉じられない。

決まり: 操作で起きる処理はハンドラに置く (structure S-06)。派生値は描画の中で計算する。アンマウント対策は、実際にアンマウントできる経路があることをコードで確かめてから入れる。なければ外す。

重さ: MUST。

### E-15 children は PropsWithChildren で受ける

兆候: `children: React.ReactNode` を `OwnProps` に書いている。`children` を受け取るのに型に無い。

決まり: `type Props = React.PropsWithChildren<OwnProps>;` にし、JSDoc で children が何かを書く。

重さ: NITS。

## D. マークアップ・CSS

### E-16 動的な色は CSS 変数で class に渡す

兆候: `style={{ color, backgroundColor, borderColor }}` のように、props で受けた色を `style` 属性で直接当てている。

決まり: class 側で `var(--xxx)` を読み、`style` には色の値を入れた CSS 変数だけを渡す。TS の `CSSProperties` は CSS 変数を知らないので、変数の型を足して `React.CSSProperties & XxxVariables` にする (`as` は要らない)。色が区分で決まっている (10 色など) なら、色ごとの class を作って区分を props で受ける形でもよい。

直し方の形は次のとおり。

```ts
type ChipColorVariables = { "--chip-text-color": string; "--chip-background-color": string };
// class 側
// .root { border: 1px solid var(--chip-text-color); color: var(--chip-text-color); background-color: var(--chip-background-color); }
// 本文
const chipColorStyle: React.CSSProperties & ChipColorVariables = { "--chip-text-color": textColor, "--chip-background-color": backgroundColor };
<span className={classes.root} style={chipColorStyle}>
```

重さ: SHOULD。

### E-17 意味に合ったマークアップと読み上げ

兆候: 表に `caption` がない。アイコンだけ・チェックボックスだけの列の見出しが `label: ""`。繰り返す対話部品に `aria-label` がない。`fieldset` / `legend` が要るグループを `div` で書いている。

決まり: 表に読み上げ用の `caption`、見えない見出し (`visuallyHidden` の class で「選択」など)、行ごとの対話部品に `aria-label` (メンバー名など) を入れる。

直し方の形は次のとおり。

```css
.visuallyHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
```

```tsx
<caption className={classes.visuallyHidden}>メンバーの選択</caption>
{ label: <span className={classes.visuallyHidden}>選択</span>, className: ... }
```

重さ: SHOULD。

### E-18 ライブラリの標準の書き方を使う

兆候: 共通の表部品にセルの JSX を配列で詰めていて、行の部品より複雑になっている。フォームライブラリにある配列の並び替えを自前で書いている。

決まり: `tbody` の中に行の部品を並べる。フォームライブラリの配列操作 (`move` / `swap`) を使う。ライブラリの選定や導入は対象外。

重さ: SHOULD。
