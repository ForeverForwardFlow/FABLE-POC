import { boot } from 'quasar/wrappers';

export default boot(({ app }) => {
  app.config.errorHandler = (err, instance, info) => {
    console.error('[FABLE] Unhandled error:', err);
    console.error('[FABLE] Component:', instance?.$options?.name || 'unknown');
    console.error('[FABLE] Info:', info);
  };
});
