import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{outDir:'../test-artifacts/return-repair/frontend-dist',emptyOutDir:true},server:{host:'127.0.0.1',port:4175,strictPort:true}});
