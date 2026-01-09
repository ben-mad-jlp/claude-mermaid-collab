export const config = {
  PORT: parseInt(process.env.PORT || '3737'),
  HOST: process.env.HOST || '0.0.0.0',
  DIAGRAMS_FOLDER: process.env.DIAGRAMS_FOLDER || './diagrams',
  MAX_FILE_SIZE: 1048576, // 1MB
  THUMBNAIL_CACHE_SIZE: 100,
  UNDO_HISTORY_SIZE: 50,
  WS_RECONNECT_MAX_DELAY: 30000,
} as const;
