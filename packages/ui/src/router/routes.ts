import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('src/layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        name: 'chat',
        component: () => import('src/pages/ChatPage.vue')
      }
    ]
  }
];

export default routes;
