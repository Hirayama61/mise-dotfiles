import { createUi, type Ui } from "./lib/ui.ts";

/**
 * "<tool> version X.Y.Z (...)" の形式で名乗るツールの出力からバージョンだけ取り出す。
 *
 * @param output - --version の出力。取得できなかった場合は null。
 * @returns バージョン文字列。取り出せなければ空文字。
 */
const parseToolVersion = (output: string | null): string =>
  output?.split("\n")[0]?.split(/\s+/)[2] ?? "";

/**
 * コマンドを実行して標準出力を返す。
 *
 * @param command - 実行するコマンドと引数。
 * @returns trim した標準出力。失敗・コマンド不在・空出力は null。
 */
const capture = (command: readonly string[]): string | null => {
  try {
    const result = Bun.spawnSync([...command], { stdout: "pipe", stderr: "ignore" });
    if (!result.success) {
      return null;
    }
    const text = result.stdout.toString().trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
};

const toolVersion = (tool: string): string => parseToolVersion(capture([tool, "--version"]));

/**
 * ghq と gh を揃える。リポの取得と認証に必要なため、mise run setup を待たずここで入れる。
 *
 * mise use で入れたツールは、このプロセスの PATH には現れない。
 * Bun は起動時の PATH で実行ファイルを解決するので、mise に絶対パスを聞いて持ち回る。
 *
 * @param ui - 表示部品。
 * @returns gh の実行パス。
 */
const ensureRepoTools = async (ui: Ui): Promise<string> => {
  const missing = ["ghq", "gh"].filter((tool) => Bun.which(tool) === null);

  if (missing.length > 0) {
    await ui.run("mise", `${missing.join(" ")} を導入しています`, [
      "mise",
      "use",
      "--global",
      ...missing,
    ]);
  }

  const locate = (tool: string): string => {
    const path = Bun.which(tool) ?? capture(["mise", "which", tool]);
    if (path === null) {
      throw new Error(`${tool} を導入できなかった`);
    }
    return path;
  };

  const show = (tool: string, path: string): void => {
    const version = toolVersion(path);
    ui.status("ok", tool, version === "" ? "不明" : version);
  };

  const ghqPath = locate("ghq");
  const ghPath = locate("gh");
  show("ghq", ghqPath);
  show("gh", ghPath);
  return ghPath;
};

const ensureGithubAuth = (ui: Ui, ghPath: string): void => {
  const authenticated = Bun.spawnSync([ghPath, "auth", "status"], {
    stdout: "ignore",
    stderr: "ignore",
  }).success;

  if (!authenticated) {
    ui.note("GitHub の認証が必要です。ブラウザが開きます。");
    process.stdout.write("\n");
    const login = Bun.spawnSync(
      [ghPath, "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    if (!login.success) {
      throw new Error("gh auth login が失敗した");
    }
    process.stdout.write("\n");
  }

  ui.status("ok", "gh auth", capture([ghPath, "api", "user", "--jq", ".login"]) ?? "認証済み");
};

// 空入力を既定値で埋められない項目を、値が入るまで聞き直す。
const askUntilAnswered = async (ui: Ui, label: string, defaultValue: string): Promise<string> => {
  let answer = "";
  while (answer === "") {
    answer = await ui.ask(label, defaultValue);
  }
  return answer;
};

const printGitconfigPreview = (ui: Ui, name: string, email: string): void => {
  const lines = [
    "",
    ui.paint("SUBTLE", "   ~/.gitconfig に書きます"),
    "",
    ui.paint("SUBTLE", "     [user]"),
    ui.paint("SUBTLE", "         name  = ") + ui.paint("FG", name),
    ui.paint("SUBTLE", "         email = ") + ui.paint("FG", email),
    "",
    "",
  ];
  process.stdout.write(lines.join("\n"));
};

// git は ~/.gitconfig が存在すると ~/.config/git/config を読まなくなる。
// ここで書く値は ~/.gitconfig に入るので、後から共有設定を include で足しても
// include より後ろに残り、端末固有の値として勝ち続ける。
//
// commit には name と email の両方が要る。片方でも欠けていれば対話に入り、
// 残っている方は既定値として提示するので Enter で維持できる。
const ensureGitIdentity = async (ui: Ui, ghPath: string): Promise<void> => {
  const currentName = capture(["git", "config", "--get", "user.name"]);
  const currentEmail = capture(["git", "config", "--get", "user.email"]);

  if (currentName !== null && currentEmail !== null) {
    ui.status("kept", "user.name", currentName);
    ui.status("kept", "user.email", currentEmail);
    process.stdout.write("\n");
    ui.note("既に設定済みなので変更しません。");
    return;
  }

  const login = capture([ghPath, "api", "user", "--jq", ".login"]);
  const userId = capture([ghPath, "api", "user", "--jq", ".id"]);
  const suggestedName = capture([ghPath, "api", "user", "--jq", ".name // .login"]);

  ui.note("commit に必要な identity が未設定です。");
  ui.note("Enter で [ ] 内の候補を採用します。変えるなら入力してください。");

  const noreply =
    userId !== null && login !== null ? `${userId}+${login}@users.noreply.github.com` : "";
  if (noreply !== "") {
    ui.note("email の既定は GitHub がアドレスを隠す noreply 形式です。");
  }
  process.stdout.write("\n");

  const name = await askUntilAnswered(ui, "name", currentName ?? suggestedName ?? login ?? "");
  const email = await askUntilAnswered(ui, "email", currentEmail ?? noreply);

  printGitconfigPreview(ui, name, email);

  if (!(await ui.confirm("この内容で書き込みますか"))) {
    process.stdout.write("\n");
    ui.note("中止しました。commit する前に git config --global で設定してください。");
    return;
  }

  const wroteName = Bun.spawnSync(["git", "config", "--global", "user.name", name]).success;
  const wroteEmail = Bun.spawnSync(["git", "config", "--global", "user.email", email]).success;
  if (!wroteName || !wroteEmail) {
    throw new Error("git config --global の書き込みに失敗した");
  }

  process.stdout.write("\n");
  ui.status("ok", "user.name", name);
  ui.status("ok", "user.email", email);
};

const printNextSteps = (ui: Ui): void => {
  ui.ready("リポを編集して push できます");
  ui.section("Next Action");
  ui.nextStep("mise run setup", "リポジトリが管理するツールを揃える");
  ui.nextStep("claude login", "Claude Code の認証(未認証なら)");
  process.stdout.write("\n");
  ui.clipboard("mise run setup");
  process.stdout.write("\n");
};

/**
 * このリポジトリに対して commit / push できる状態にする。
 *
 * gh 認証と git identity を設定する任意タスク。実行しなくても mise run setup へ進める。
 * fish や nvim といった実際に使うツールの導入と設定は mise run setup が担当する。
 */
const runGitSetup = async (): Promise<void> => {
  const ui = await createUi();

  // スピナー表示中に中断されるとカーソルが消えたままになる。
  process.on("exit", () => {
    ui.showCursor();
  });
  process.on("SIGINT", () => {
    process.exit(130);
  });

  ui.banner("commit / push できる状態まで");

  ui.section("ツール");
  const ghPath = await ensureRepoTools(ui);

  ui.section("GitHub");
  ensureGithubAuth(ui, ghPath);

  ui.section("git identity");
  await ensureGitIdentity(ui, ghPath);

  printNextSteps(ui);
  ui.close();
};

if (import.meta.main) {
  runGitSetup().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
