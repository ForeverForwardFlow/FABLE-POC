import { configure } from 'quasar/wrappers';

export default configure(() => ({
  boot: ['websocket'],
  css: ['app.scss'],
  extras: ['roboto-font', 'material-icons'],
  build: {
    target: { browser: ['es2022', 'chrome115', 'firefox115', 'safari14'] },
    vueRouterMode: 'history',
    typescript: { strict: true, vueShim: true }
  },
  framework: {
    config: { dark: true },
    plugins: ['Notify', 'Dialog', 'Loading', 'LocalStorage']
  },
  devServer: {
    open: true
  }
}));
