import type { Preview } from "@storybook/react-vite";
// アプリの全体 CSS をここで読む。パスはリポジトリに合わせる。
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: { expanded: true },
  },
};

export default preview;
