import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  plugins:[react()],
  base:'/3d/',
  build:{
    outDir:fileURLToPath(new URL('../web/3d/',import.meta.url)),
    emptyOutDir:true,
    sourcemap:false,
    target:'es2022',
    rollupOptions:{output:{
      onlyExplicitManualChunks:true,
      manualChunks(id){
        const path=id.replaceAll('\\','/');
        if(/\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'react';
        if(/\/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(path)) return 'motion';
        if(/\/node_modules\/(three|three-stdlib|@react-three\/fiber|@react-three\/drei)\//.test(path)) return 'three';
      }
    }}
  },
  server:{
    host:'127.0.0.1',port:9142,strictPort:true,
    proxy:{'/api':{target:'http://127.0.0.1:9140',changeOrigin:true,headers:{Origin:'http://127.0.0.1:9140'}},'/connect.html':{target:'http://127.0.0.1:9140',changeOrigin:true}}
  }
});
