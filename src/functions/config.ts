// Configuration
export const CONFIG = {
  BATCH_SIZE: 100, // Nombre d'éléments à traiter par lot
  CONCURRENT_NOMINATIM_REQUESTS: 1, // Respecter les limites de Nominatim (1 requête/s)
  CONCURRENT_DB_OPERATIONS: 10, // Nombre de requêtes DB simultanées
  LOG_INTERVAL: 100, // Intervalle pour les logs de progression
  RETRY_ATTEMPTS: 3, // Nombre de tentatives pour les opérations qui échouent
  CACHE_LOCATION_DATA: true, // Activer le cache des données de localisation
  CACHE_FILE: './cache/nominatim-cache.json', // Fichier de cache,
  TIMEOUT: 1800000, // 30 minutes timeout for ogr2ogr operations
  CONCURRENT_OPERATIONS: 2, // Nombre d'opérations ogr2ogr simultanées
  CLEAN_EMPTY_FILES: true, // Supprimer les fichiers GeoJSON vides
  MIN_FEATURES: 1
};
