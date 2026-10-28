---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React の設計規約

関数コンポーネントと hooks(React 16.8 以降)を前提とする。
型・関数・命名は `typescript.md` に従う。
コード例は TSX で書く。
`.jsx` では型注釈と型引数を外して書く。

## 基本方針

- Effect を書く前に、render 中に計算できないか、event handler で実行できないかを検討する。
  どちらでもないときだけ Effect を使う。
- 規約とプロジェクトの既存方針が食い違う場合は、既存方針を優先する。

## render の純粋性

- render 中に、コンポーネントの外にある変数・オブジェクト・DOM を変更しない。
  render は同じ props と state から同じ JSX を返す計算として書く。
- コンポーネントを別のコンポーネントの内部で定義しない。
  内部で定義すると render のたびに別の型になり、子の state と DOM が毎回作り直される。
- JSX を返す `renderFoo()` を増やさず、UI のまとまりを別コンポーネントへ切り出す。

```tsx
// Good
const UserRow = ({ user }: { user: User }) => <li>{user.name}</li>;

const UserList = ({ users }: { users: readonly User[] }) => (
  <ul>
    {users.map((user) => (
      <UserRow key={user.id} user={user} />
    ))}
  </ul>
);

// Avoid
const UserList = ({ users }: { users: readonly User[] }) => {
  const UserRow = ({ user }: { user: User }) => <li>{user.name}</li>;

  return (
    <ul>
      {users.map((user) => (
        <UserRow key={user.id} user={user} />
      ))}
    </ul>
  );
};
```

## State の構造

- props や他の state から計算できる値を state に持たない。
  render 中に計算する。
- 同じ事実を複数の state に持たない。
  選択中の要素は、オブジェクトのコピーではなく ID で持つ。
- state は使うコンポーネントに置く。
  兄弟で共有が必要になってから、共通の親へ持ち上げる。

```tsx
// Good
const [items, setItems] = useState<readonly Item[]>([]);
const [selectedId, setSelectedId] = useState<ItemId | null>(null);
const selectedItem = items.find((item) => item.id === selectedId);

// Avoid
const [items, setItems] = useState<readonly Item[]>([]);
const [selectedItem, setSelectedItem] = useState<Item | null>(null);
```

```tsx
// Good
const fullName = `${firstName} ${lastName}`;

// Avoid
const [fullName, setFullName] = useState("");

useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);
```

## ユーザー操作の処理

- クリックや送信に起因する処理は event handler に書く。
  state を変えて Effect で検知する二段構えにしない。
- 親への通知は、子の state を更新する event handler の中で親の callback を呼ぶ。
  Effect で state の変化を監視して親へ伝えない。
- Effect で state を更新し、別の Effect がそれを検知する連鎖を作らない。
  次の state は 1 つの event handler の中でまとめて計算する。

```tsx
// Good
const handleSubmit = async () => {
  await postOrder(cart);
  showToast("注文しました");
};

// Avoid
const [submitted, setSubmitted] = useState(false);

useEffect(() => {
  if (submitted) {
    postOrder(cart).then(() => showToast("注文しました"));
  }
}, [submitted, cart]);
```

## props の変化による state のリセット

- props が変わったら state を初期化したいときは、Effect で `setState` せず `key` で表現する。
  `key` が変わるとコンポーネントは別物として扱われ、内部の state がすべて初期値に戻る。
- `key` はリストの警告を消す道具ではなく、要素の identity として扱う。
  並び替えや削除が起きるリストに index を `key` として渡さない。

```tsx
// Good
<Profile key={userId} userId={userId} />;

// Avoid
const Profile = ({ userId }: { userId: UserId }) => {
  const [comment, setComment] = useState("");

  useEffect(() => {
    setComment("");
  }, [userId]);
  // ...
};
```

## Effect

- Effect は、React の外にあるシステム(DOM API・タイマー・購読・ネットワーク)と同期するために使う。
- setup で外部に与えた作用は、cleanup で戻す。
  購読は解除し、タイマーは止める。
- Effect でデータを取得するときは、cleanup で古いリクエストの結果を捨てる。
  props が素早く変わったとき、遅れて届いた古い応答で state を上書きしないためである。

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

- Effect の中で読む props・state・それらから作った値を、すべて依存配列に書く。
  依存配列は「どの値が変わったら同期し直すか」の宣言で、実行回数を調整する道具ではない。
- `react-hooks/exhaustive-deps` を `eslint-disable` で黙らせない。
  依存を減らしたいときは、依存配列ではなく Effect のコードを変える。
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

- `useMemo`・`useCallback`・`React.memo` は性能の最適化として扱い、正しさをこれらで担保しない。
  外しても結果が変わらないコードを書く。
- コンポーネント内で定義し、ひとつの Effect だけで使う関数は `useCallback` で包まず、その Effect の中へ移す。
  props で受け取った callback のように移せない関数は、この限りでない。
