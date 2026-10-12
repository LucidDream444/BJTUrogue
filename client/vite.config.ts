import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 相对路径：部署时静态产物按版本号分目录（见《技术选型》§7），
  // 绝对路径会在 /game/v1.2.3/ 这类子目录下 404。
  base: './',

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    host: true,
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // 两个入口：`index.html` 是游戏，`test.html` 是白箱测试场。
      //
      // ⚠️ 不加这一段的话，构建时 Vite **只认根目录的 `index.html`** ——
      // `test.html` 会被静默忽略：`npm run dev` 下它还能用（dev server 按需编译），
      // 但 `npm run build` 之后的产物里**根本没有这个文件**。
      // 那种「开发时好好的、一构建就没了」的差别，最容易在需要给队友发一份
      // 静态产物时才被发现。
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        test: fileURLToPath(new URL('./test.html', import.meta.url)),
      },
    },
  },

  test: {
    // 纯逻辑单测：全部跑在 node 环境，不加载 Phaser / 不碰 DOM。
    // 这条配置本身就是架构约束 —— 如果某个测试需要 jsdom，说明逻辑没和表现层分开。
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/main.ts'],
    },
  },
})