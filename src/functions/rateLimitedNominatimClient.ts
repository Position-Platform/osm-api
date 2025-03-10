import pLimit from 'p-limit';
import fs from 'fs';
import * as path from 'path';
import { readFile } from 'fs/promises';
import { Logger } from './logger';
import { CONFIG } from './config';

// Client Nominatim avec rate-limiting intégré
export class RateLimitedNominatimClient {
  private cache: Map<string, any> = new Map();
  private cacheFile: string;
  private requestLimit = pLimit(CONFIG.CONCURRENT_NOMINATIM_REQUESTS);
  private logger: Logger;

  constructor(
    private userAgent: string,
    private referer: string,
    cacheFile: string,
    logger: Logger
  ) {
    this.cacheFile = cacheFile;
    this.logger = logger;
    this.loadCache();
  }

  private async loadCache() {
    if (CONFIG.CACHE_LOCATION_DATA) {
      try {
        if (fs.existsSync(this.cacheFile)) {
          const data = await readFile(this.cacheFile, 'utf8');
          const cacheData = JSON.parse(data);
          this.cache = new Map(Object.entries(cacheData));
          this.logger.info(
            `Loaded ${this.cache.size} entries from Nominatim cache`
          );
        } else {
          // Créer le répertoire du cache s'il n'existe pas
          const dir = path.dirname(this.cacheFile);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
        }
      } catch (error) {
        this.logger.error('Failed to load Nominatim cache:', error);
      }
    }
  }

  private async saveCache() {
    if (CONFIG.CACHE_LOCATION_DATA) {
      try {
        const cacheObj = Object.fromEntries(this.cache);
        await fs.promises.writeFile(
          this.cacheFile,
          JSON.stringify(cacheObj, null, 2)
        );
        this.logger.info(`Saved ${this.cache.size} entries to Nominatim cache`);
      } catch (error) {
        this.logger.error('Failed to save Nominatim cache:', error);
      }
    }
  }

  private getCacheKey(lat: number, lon: number): string {
    // Arrondir pour éviter des problèmes de précision de flottants
    return `${parseFloat(lat.toFixed(6))},${parseFloat(lon.toFixed(6))}`;
  }

  async reverse(lat: number, lon: number): Promise<any> {
    const cacheKey = this.getCacheKey(lat, lon);

    // Vérifier le cache
    if (CONFIG.CACHE_LOCATION_DATA && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Effectuer la requête avec rate limiting
    return this.requestLimit(async () => {
      let response;
      let attempts = 0;

      while (attempts < CONFIG.RETRY_ATTEMPTS) {
        try {
          const url = new URL('https://nominatim.position.cm/reverse');
          url.searchParams.append('lat', lat.toString());
          url.searchParams.append('lon', lon.toString());
          url.searchParams.append('format', 'json');
          url.searchParams.append('addressdetails', '1');

          const res = await fetch(url.toString(), {
            headers: {
              'User-Agent': this.userAgent,
              Referer: this.referer
            }
          });

          if (!res.ok) {
            throw new Error(
              `Nominatim API error: ${res.status} ${res.statusText}`
            );
          }

          response = await res.json();

          // Mettre en cache le résultat
          if (CONFIG.CACHE_LOCATION_DATA) {
            this.cache.set(cacheKey, response);

            // Sauvegarder le cache périodiquement (tous les 100 nouvelles entrées)
            if (this.cache.size % 100 === 0) {
              await this.saveCache();
            }
          }

          // Attendre 1 seconde pour respecter les limites de l'API Nominatim
          await new Promise((resolve) => setTimeout(resolve, 1000));

          return response;
        } catch (error) {
          attempts++;
          this.logger.warn(
            `Nominatim retry ${attempts}/${CONFIG.RETRY_ATTEMPTS} for ${lat},${lon}: ${error}`
          );

          // Attendre avec backoff exponentiel avant de réessayer
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * Math.pow(2, attempts))
          );
        }
      }

      throw new Error(
        `Failed to get reverse geocoding data after ${CONFIG.RETRY_ATTEMPTS} attempts`
      );
    });
  }

  async saveCacheOnExit() {
    await this.saveCache();
  }
}
