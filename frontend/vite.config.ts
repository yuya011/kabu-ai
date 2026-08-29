import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages はリポジトリ名のサブパスで配信されるため、base を差し替えられるようにしてある。
//   ローカル:      npm run build            → base '/'
//   Pages 向け:    VITE_BASE=/kabu-ai/ npm run build
// アプリ側は import.meta.env.BASE_URL 経由で JSON を取りに行くので、どちらでも動く。
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 3000,
    open: false
  }
})
