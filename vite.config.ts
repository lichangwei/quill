import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  build: {
    // Chrome Extension 页面不需要 Vite 的 modulepreload；预加载链接会触发
    // cross-world extension resource mismatch，并产生无效资源警告。
    modulePreload: false,
    rollupOptions: {
      input: {
        options: 'src/options/options.html',
        sidepanel: 'src/sidepanel/sidepanel.html',
      },
    },
  },
});
