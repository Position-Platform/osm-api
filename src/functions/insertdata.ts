import { PoolClient } from 'pg';
import { Logger } from './logger';
import { format } from 'sql-formatter';
import { CONFIG } from './config';
import { RateLimitedNominatimClient } from './rateLimitedNominatimClient';
import { OSMDataImporter } from './osmDataImporter';

// Fonction principale
export async function insertData(
  client: PoolClient,
  country: string
): Promise<void> {
  // Initialiser le logger
  const logger = Logger.getInstance();
  logger.info(`Démarrage de l'importation des données OSM pour ${country}`);

  // Initialiser le client Nominatim
  const nominatimClient = new RateLimitedNominatimClient(
    'Position', // useragent
    'https://position.cm', // referer
    CONFIG.CACHE_FILE,
    logger
  );

  // Initialiser l'importateur
  const importer = new OSMDataImporter(client, nominatimClient, logger);

  try {
    // Mesurer le temps d'exécution
    const startTime = Date.now();

    // Lancer l'importation
    await importer.importData(country);

    // Sauvegarder le cache Nominatim
    await nominatimClient.saveCacheOnExit();

    // Afficher le temps d'exécution
    const duration = (Date.now() - startTime) / 1000;
    logger.info(`Importation terminée en ${duration.toFixed(2)} secondes`);
  } catch (error) {
    logger.error("Erreur fatale lors de l'importation:", error);
    throw error;
  }
}

// Fonction utilitaire pour formatter les requêtes SQL (pour débogage)
export function formatSql(sql: string): string {
  return format(sql, {
    language: 'postgresql',
    indentStyle: 'standard'
  });
}
