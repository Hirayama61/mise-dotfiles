---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript のコーディング規約

## 基本方針

- 型安全性を優先し、コンパイラが検出できる問題の範囲を広く保つ。
- 将来の再利用を予測して過度に抽象化しない。
- 状態を持たない処理は関数として実装する。

## 型

- strict mode を前提とする。
- `any` は使用しない。
  型が不明な値は `unknown` で受け取り、使用前に絞り込む。
- non-null assertion (`!`) や `@ts-ignore` で型エラーを回避しない。
- 型定義には `interface` ではなく `type` を使用する。
- 複数の状態は Discriminated Union で表現し、不正な状態を型で表現できない設計を優先する。
- 既存の値や型から導出できる型を重複して定義しない。

```ts
// Good
type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: User }
  | { status: "error"; error: Error };

// Avoid
type RequestState = {
  status: string;
  data?: User;
  error?: Error;
};
```

## 型アサーション

- 型エラーの解消だけを目的に `as` を使用しない。
  `as unknown as T` のような二重アサーションも使用しない。
- アサーションが必要になったら、先に型設計や絞り込みの改善を検討する。
- 外部から取得した値をアサーションだけで信用しない。
- 値が型を満たすことの検証には `satisfies` を使用する。

```ts
const config = {
  apiUrl: "/api",
  timeout: 5000,
} satisfies Config;
```

## リテラル型

- 取り得る値が限定されている場合は `string` や `number` へ広げず、リテラル型を維持する。
- 固定値の集合には `enum` を使わず、Union 型や `as const` を使用する。

```ts
const permissions = ["read", "write", "admin"] as const;

type Permission = (typeof permissions)[number];
```

## 関数

- 関数はアロー関数で定義する。
  `function` 宣言は巻き上げが必要な場合だけ使用する。
- データ変換や判定は純粋関数にし、副作用のある処理と分離する。
- 深いネストは guard clause や早期 return で避ける。

## データの扱い

- `const` を既定とし、`let` は再代入が必要な場合だけ使用する。
  `var` は使用しない。
- 受け取ったオブジェクトや引数を直接変更せず、イミュータブルに扱う。
- 共有されるミュータブルな状態を作らない。

```ts
// Good
const updatedUser = { ...user, name: newName };

// Avoid
user.name = newName;
```

## Readonly

- 関数が値を変更しない場合は読み取り専用として受け取る。
  配列は `readonly T[]` にする。
- 呼び出し側の値を意図せず変更できる API を作らない。

## null / undefined

- nullable な値は条件分岐で絞り込んでから使用する。
- 意図が明確になる場合は optional chaining (`?.`) と nullish coalescing (`??`) を使用する。
- 不在値の表現に既存プロジェクトの規約がある場合は、そちらに従う。

## 条件分岐

- `==` / `!=` は使用せず、`===` / `!==` を使用する。
- boolean の組み合わせで複雑な状態を表現せず、排他的な状態は Discriminated Union を検討する。
- 三項演算子は単純な値の選択だけに使い、ネストさせない。

## Generics

- 型同士の関係性を表現する必要がある場合に使用する。
  将来の再利用の予測だけで Generic にしない。
- 可読性を大きく下げる Conditional Types や再帰型は慎重に使用する。

## Utility Types

- 標準の Utility Types で意図を表現できる場合は活用する。
- 何重にも組み合わせず、複雑になったら意味のある名前を持つ型として定義する。

```ts
type UpdateUserInput = Partial<Pick<User, "name" | "email">>;
```

## 型定義の配置

- 型は、その型を所有または主に利用するコードの近くに配置する。
- 型を集めるだけの巨大な `types.ts` や `types/` を作らない。
  複数の領域から利用されるようになってから共有の型として切り出す。
- 型の配置に既存プロジェクトの方針がある場合は、そちらを優先する。

## 命名

- `Data`, `Info`, `Item`, `Object` のような文脈のない曖昧な名前を避ける。
- boolean は `is`, `has`, `can`, `should` など、`true` の意味が分かる名前にする。

## モジュール

- 外部から必要なものだけを export し、実装詳細はモジュールスコープに隠蔽する。
- 循環依存を避ける。
  Barrel export (`index.ts`) は循環依存や依存の不透明化を生むため、無条件には使用しない。

## JSDoc

- export する関数と型には JSDoc を書く。
  モジュール内部の関数には、シグネチャに現れない情報があるときだけ書く。
- コードから読み取れる情報を繰り返さず、用途・制約・意図を書く。
- 型情報は TypeScript のシグネチャに任せ、JSDoc に `{型}` を重複して書かない。
- 実装の詳細の説明は JSDoc ではなく通常のコメント(`//`)にする。
- 変数に代入されたアロー関数も名前付き関数として扱う。
  インラインの無名コールバックには書かない。

### 関数の JSDoc

- JSDoc を書く関数では、すべての引数に `@param` を書き、名前を引数と一致させる。
- 戻り値がある場合は `@returns` に戻り値の意味を書く。
  `void` の場合は省略する。
- `@example` は利用方法がコードだけでは分かりにくい場合に使用する。

```ts
/**
 * 指定期間に作成されたユーザーを取得する。
 *
 * @param startDate - 検索期間の開始日時。期間に含む。
 * @param endDate - 検索期間の終了日時。期間に含まない。
 * @returns 指定期間に作成されたユーザー。
 */
const findUsersByPeriod = (startDate: Date, endDate: Date): readonly User[] => {
  // ...
};
```

### 型の JSDoc

- `type` には、その型が何を表すかを書く。
- 名前と型から意味が明らかなプロパティにはコメントを付けず、用途や制約が分からないプロパティにだけ書く。

```ts
/**
 * アプリケーション上で扱うユーザー情報。
 */
type User = {
  id: UserId;
  name: string;

  /**
   * UI 上で優先的に表示する任意の名称。
   *
   * 未設定の場合は `name` を使用する。
   */
  nickname?: string;
};
```

### JSDoc の質

コードを日本語へ言い換えるだけで終えず、呼び出し側が知るべき情報(優先順位、制約、境界条件)を書く。
書くべき追加情報がない場合は 1 行の要約に留める。

```ts
// Avoid
/**
 * ユーザー名を取得する。
 *
 * @param user - ユーザー。
 * @returns ユーザー名。
 */

// Prefer
/**
 * 画面表示用のユーザー名を取得する。
 *
 * @param user - 表示対象のユーザー。
 * @returns ニックネームが設定されていればニックネーム、それ以外は登録名。
 */
```
