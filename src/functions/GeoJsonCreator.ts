import ogr2ogr from 'ogr2ogr';
import pLimit from 'p-limit';
import { Logger } from './logger';
import * as path from 'path';
import { mkdir, readFile } from 'fs/promises';
import fs from 'fs';
import { CONFIG } from './config';

export class GeoJsonCreator {
  private logger: Logger;
  private operationLimit: any;
  private basePath: string;
  private osmPath: string;
  private dataPath: string;
  private configPath: string;

  constructor(logger?: Logger) {
    this.logger = logger || Logger.getInstance('./logs/geojson-creator.log');
    this.operationLimit = pLimit(CONFIG.CONCURRENT_OPERATIONS);

    // Détecter les chemins de base
    this.basePath = process.cwd();
    this.osmPath = path.join(this.basePath, 'src', 'osm');
    this.dataPath = path.join(this.osmPath, 'data');
    this.configPath = path.join(
      this.basePath,
      'src',
      'functions',
      'osmconf.ini'
    );

    this.logger.info(
      `GeoJsonCreator initialisé avec basePath: ${this.basePath}`
    );
  }

  /**
   * Crée un fichier GeoJSON à partir d'un fichier OSM PBF
   * @param tag - Tag OSM à extraire (ex: "amenity='restaurant'")
   * @param country - Code pays (ex: "cm")
   * @param identifiant - Identifiant pour le fichier de sortie
   * @param options - Options supplémentaires
   * @returns Promise avec les statistiques de l'opération
   */
  async createGeoJson(
    tag: string,
    country: string,
    identifiant: string,
    options: {
      overwrite?: boolean;
      geometryType?: 'points' | 'lines' | 'multipolygons' | 'other_relations';
      additionalOptions?: string[];
    } = {}
  ): Promise<{
    success: boolean;
    featuresCount?: number;
    filePath?: string;
    error?: any;
  }> {
    const {
      overwrite = true,
      geometryType = 'points',
      additionalOptions = []
    } = options;

    // Construire les chemins
    const pbfPath = path.join(this.osmPath, `${country}.osm.pbf`);
    const countryDataPath = path.join(this.dataPath, country);
    const savePath = path.join(countryDataPath, `${identifiant}.geojson`);

    try {
      // Vérifier si le fichier PBF existe
      if (!fs.existsSync(pbfPath)) {
        throw new Error(`Le fichier PBF n'existe pas: ${pbfPath}`);
      }

      // Vérifier si le répertoire de destination existe, sinon le créer
      if (!fs.existsSync(countryDataPath)) {
        this.logger.info(`Création du répertoire: ${countryDataPath}`);
        await mkdir(countryDataPath, { recursive: true });
      }

      // Vérifier si le fichier de configuration existe
      if (!fs.existsSync(this.configPath)) {
        throw new Error(
          `Le fichier de configuration n'existe pas: ${this.configPath}`
        );
      }

      // Vérifier si le fichier de sortie existe déjà
      if (fs.existsSync(savePath)) {
        if (overwrite) {
          this.logger.info(`Suppression du fichier existant: ${savePath}`);
          fs.unlinkSync(savePath);
        } else {
          this.logger.info(`Fichier existant conservé: ${savePath}`);
          // Lire le fichier existant pour renvoyer les statistiques
          const fileContent = await readFile(savePath, 'utf8');
          const geoJson = JSON.parse(fileContent);
          return {
            success: true,
            featuresCount: geoJson.features ? geoJson.features.length : 0,
            filePath: savePath
          };
        }
      }

      // Exécuter ogr2ogr avec gestion des erreurs et retries
      return await this.operationLimit(async () => {
        let attempts = 0;
        let lastError = null;

        while (attempts < CONFIG.RETRY_ATTEMPTS) {
          try {
            this.logger.info(
              `Création GeoJSON pour tag "${tag}" (${country}:${identifiant}), tentative ${
                attempts + 1
              }/${CONFIG.RETRY_ATTEMPTS}`
            );

            const tagConditions = tag
              .split(';')
              .map((tagCondition) => {
                const [key, value] = tagCondition.split('=');
                return `${key}='${value}'`;
              })
              .join(' OR ');

            // Préparer les options ogr2ogr
            const ogr2ogrOptions = [
              '-where',
              tagConditions,
              '-oo',
              `CONFIG_FILE=${this.configPath}`,
              geometryType,
              ...additionalOptions
            ];

            // Exécuter ogr2ogr
            await new Promise<void>((resolve, reject) => {
              ogr2ogr(pbfPath, {
                format: 'GeoJSON',
                destination: savePath,
                timeout: CONFIG.TIMEOUT,
                options: ogr2ogrOptions
              }).exec((err, data) => {
                if (err) {
                  reject(err);
                } else {
                  resolve();
                }
              });
            });

            // Lire et valider le fichier généré
            const fileContent = await readFile(savePath, 'utf8');
            const geoJson = JSON.parse(fileContent);
            const featuresCount = geoJson.features
              ? geoJson.features.length
              : 0;

            // Vérifier si le fichier est vide ou contient trop peu de features
            if (
              CONFIG.CLEAN_EMPTY_FILES &&
              featuresCount < CONFIG.MIN_FEATURES
            ) {
              this.logger.warn(
                `Fichier généré avec seulement ${featuresCount} features, suppression: ${savePath}`
              );
              fs.unlinkSync(savePath);
              return {
                success: false,
                featuresCount: 0,
                error: 'Pas assez de features trouvées'
              };
            }

            this.logger.info(
              `GeoJSON créé avec succès: ${savePath} (${featuresCount} features)`
            );
            return {
              success: true,
              featuresCount,
              filePath: savePath
            };
          } catch (error) {
            attempts++;
            lastError = error;
            this.logger.error(
              `Erreur lors de la création du GeoJSON (tentative ${attempts}/${CONFIG.RETRY_ATTEMPTS}):`,
              error
            );

            // Attendre avec backoff exponentiel avant de réessayer
            if (attempts < CONFIG.RETRY_ATTEMPTS) {
              const delay = 1000 * Math.pow(2, attempts);
              this.logger.info(
                `Attente de ${delay}ms avant la prochaine tentative`
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        return {
          success: false,
          error: lastError
        };
      });
    } catch (error) {
      this.logger.error('Erreur lors de la création du GeoJSON:', error);
      return {
        success: false,
        error
      };
    }
  }

  /**
   * Crée plusieurs fichiers GeoJSON en batch
   * @param tasks - Liste des tâches à exécuter
   * @returns Promise avec les résultats
   */
  async createBatch(
    tasks: Array<{
      tag: string;
      country: string;
      identifiant: string;
      options?: any;
    }>
  ): Promise<
    Array<{
      tag: string;
      country: string;
      identifiant: string;
      success: boolean;
      featuresCount?: number;
      filePath?: string;
      error?: any;
    }>
  > {
    this.logger.info(
      `Démarrage du batch de création GeoJSON (${tasks.length} tâches)`
    );

    const results = [];
    for (const [index, task] of tasks.entries()) {
      this.logger.info(
        `Traitement de la tâche ${index + 1}/${tasks.length}: ${task.country}:${
          task.identifiant
        }`
      );

      const result = await this.createGeoJson(
        task.tag,
        task.country,
        task.identifiant,
        task.options
      );

      results.push({
        ...task,
        ...result
      });
    }

    // Résumé des résultats
    const successful = results.filter((r) => r.success).length;
    this.logger.info(
      `Batch terminé: ${successful}/${tasks.length} tâches réussies`
    );

    return results;
  }

  /**
   * Vérifie et nettoie un fichier GeoJSON
   * @param filePath - Chemin du fichier à vérifier
   * @returns Promise avec les informations sur le fichier
   */
  async validateGeoJson(filePath: string): Promise<{
    valid: boolean;
    featuresCount: number;
    fileSize: number;
  }> {
    try {
      // Vérifier si le fichier existe
      if (!fs.existsSync(filePath)) {
        return { valid: false, featuresCount: 0, fileSize: 0 };
      }

      const stats = fs.statSync(filePath);

      // Lire et valider le contenu JSON
      const fileContent = await readFile(filePath, 'utf8');
      const geoJson = JSON.parse(fileContent);

      const featuresCount = geoJson.features ? geoJson.features.length : 0;

      return {
        valid: true,
        featuresCount,
        fileSize: stats.size
      };
    } catch (error) {
      this.logger.error(
        `Erreur lors de la validation du GeoJSON ${filePath}:`,
        error
      );
      return { valid: false, featuresCount: 0, fileSize: 0 };
    }
  }
}
