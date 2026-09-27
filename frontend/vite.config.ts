import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages はリポジトリ名のサブパスで配信されるため、base を差し替えられるようにしてある。
//   ローカル:      npm run build            → base '/'
//   Pages 向け:    VITE_BASE=/kabu-ai/ npm run build
// アプリ側は import.meta.env.BASE_URL 経由で JSON を取りに行くので、どちらでも動く。
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Fluent と React は滅多に変わらない。本体と分けておけば、更新のたびに取り直さずに済む
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          // アイコンは部品側からも参照されるので、分けると循環する。同じ塊に入れる
          if (id.includes('@fluentui') || id.includes('@griffel') || id.includes('tabster') || id.includes('keyborg')) return 'fluent';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    open: false
  }
})
