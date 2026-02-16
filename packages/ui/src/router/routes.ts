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
      },
      {
        path: 'chat/:conversationId',
        name: 'chat-conversation',
        component: () => import('src/pages/ChatPage.vue')
      },
      {
        path: 'tools',
        name: 'tools',
        component: () => import('src/pages/ToolsPage.vue')
      },
      {
        path: 'tools/:name',
        name: 'tool',
        component: () => import('src/pages/ToolPage.vue')
      },
      {
        path: 'workflows',
        name: 'workflows',
        component: () => import('src/pages/WorkflowsPage.vue')
      },
      {
        path: 'auth/callback',
        name: 'auth-callback',
        component: () => import('src/pages/AuthCallbackPage.vue')
      }
    ]
  }
];

export default routes;
