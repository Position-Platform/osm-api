import pLimit from 'p-limit';
import { PoolClient } from 'pg';
import { convertHour } from './convert';
import fs from 'fs';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { Logger } from './logger';
import { CONFIG } from './config';
import { RateLimitedNominatimClient } from './rateLimitedNominatimClient';

// Classe pour gérer l'insertion des données
export class OSMDataImporter {
  private dbClient: PoolClient;
  private nominatimClient: RateLimitedNominatimClient;
  private dbLimit = pLimit(CONFIG.CONCURRENT_DB_OPERATIONS);
  private logger: Logger;
  private stats = {
    totalProcessed: 0,
    successfulInserts: 0,
    failedInserts: 0,
    skippedDuplicates: 0
  };

  constructor(
    dbClient: PoolClient,
    nominatimClient: RateLimitedNominatimClient,
    logger: Logger
  ) {
    this.dbClient = dbClient;
    this.nominatimClient = nominatimClient;
    this.logger = logger;
  }

  async importData(country: string): Promise<void> {
    try {
      // Créer une table temporaire pour vérifier les doublons
      await this.createTemporaryTable();

      // Charger et préparer les données OSM
      const preparedData = await this.loadAndPrepareData(country);
      this.logger.info(
        `Préparation terminée, ${preparedData.length} éléments valides trouvés`
      );

      // Traiter par lots
      await this.processBatches(preparedData);

      // Afficher les statistiques finales
      this.logger.info('Importation terminée!');
      this.logger.info(`Total traité: ${this.stats.totalProcessed}`);
      this.logger.info(`Insérés avec succès: ${this.stats.successfulInserts}`);
      this.logger.info(`Échecs d'insertion: ${this.stats.failedInserts}`);
      this.logger.info(`Doublons ignorés: ${this.stats.skippedDuplicates}`);
    } catch (error) {
      this.logger.error("Erreur lors de l'importation des données:", error);
      throw error;
    }
  }

  private async createTemporaryTable(): Promise<void> {
    try {
      // Créer une table temporaire pour suivre les osm_id déjà traités
      await this.dbClient.query(`
        CREATE TEMP TABLE IF NOT EXISTS temp_processed_osm_ids (
          osm_id BIGINT PRIMARY KEY
        );
      `);
      this.logger.info('Table temporaire créée pour le suivi des doublons');
    } catch (error) {
      this.logger.error(
        'Erreur lors de la création de la table temporaire:',
        error
      );
      throw error;
    }
  }

  private async loadAndPrepareData(country: string): Promise<any[]> {
    const basePath = `./src/osm/data/${country}/`;
    const allData = [];
    const uniqueOsmIds = new Set();

    try {
      // Vérifier si le répertoire existe
      if (!fs.existsSync(basePath)) {
        throw new Error(`Répertoire de données non trouvé: ${basePath}`);
      }

      // Obtenir la liste des fichiers GeoJSON
      const files = fs
        .readdirSync(basePath)
        .filter((file) => file.endsWith('.geojson'))
        .map((file) => parseInt(path.basename(file, '.geojson')))
        .filter((num) => !isNaN(num))
        .sort((a, b) => a - b);

      this.logger.info(
        `Chargement de ${files.length} fichiers GeoJSON pour ${country}`
      );

      // Traiter chaque fichier
      for (const fileNum of files) {
        const filePath = path.join(basePath, `${fileNum}.geojson`);

        try {
          const fileContent = await readFile(filePath, 'utf8');
          const geojsonData = JSON.parse(fileContent);

          if (!geojsonData.features || !Array.isArray(geojsonData.features)) {
            this.logger.warn(`Format de fichier invalide: ${filePath}`);
            continue;
          }

          // Filtrer et transformer les données
          for (const feature of geojsonData.features) {
            if (!feature.properties?.name) continue;

            const osmId = feature.properties.osm_id;

            // Vérifier les doublons
            if (uniqueOsmIds.has(osmId)) continue;
            uniqueOsmIds.add(osmId);

            // Traiter les tags
            let tags = {};
            if (feature.properties.other_tags) {
              try {
                tags = JSON.parse(
                  '{' + feature.properties.other_tags.replace(/=>/g, ':') + '}'
                );
              } catch (error) {
                this.logger.warn(
                  `Erreur de parsing des tags pour OSM ID ${osmId}`
                );
              }
            }

            // Ajouter l'élément transformé
            allData.push({
              ...feature,
              souscategorie: fileNum,
              id: osmId,
              tags
            });
          }
        } catch (error) {
          this.logger.warn(
            `Erreur lors du traitement du fichier ${filePath}:`,
            error
          );
        }
      }

      this.logger.info(`${allData.length} éléments uniques chargés`);
      return allData;
    } catch (error) {
      this.logger.error('Erreur lors du chargement des données:', error);
      throw error;
    }
  }

  private async processBatches(data: any[]): Promise<void> {
    const totalBatches = Math.ceil(data.length / CONFIG.BATCH_SIZE);
    this.logger.info(
      `Traitement en ${totalBatches} lots de ${CONFIG.BATCH_SIZE} éléments`
    );

    for (let i = 0; i < totalBatches; i++) {
      const start = i * CONFIG.BATCH_SIZE;
      const end = Math.min(start + CONFIG.BATCH_SIZE, data.length);
      const batch = data.slice(start, end);

      this.logger.info(
        `Traitement du lot ${i + 1}/${totalBatches} (${batch.length} éléments)`
      );

      // Traiter chaque élément du lot en parallèle avec limite de concurrence
      const promises = batch.map((item) => this.processItem(item));
      await Promise.allSettled(promises);

      this.logger.info(
        `Lot ${i + 1}/${totalBatches} terminé. Progression: ${end}/${
          data.length
        }`
      );
    }
  }

  private async processItem(osmData: any): Promise<void> {
    this.stats.totalProcessed++;

    try {
      // Vérifier si cet OSM ID a déjà été traité
      const { rows } = await this.dbClient.query(
        'SELECT 1 FROM temp_processed_osm_ids WHERE osm_id = $1',
        [osmData.id]
      );

      if (rows.length > 0) {
        this.stats.skippedDuplicates++;
        return;
      }

      // Extraire les informations de base
      const name = osmData.properties.name;
      const lon = osmData.geometry.coordinates[0];
      const lat = osmData.geometry.coordinates[1];
      const souscategorie = osmData.souscategorie;
      const id = osmData.id;

      // Extraire les tags
      const tags = osmData.tags || {};
      const {
        opening_hours: openingHours,
        phone: phone1,
        'contact:phone': phone2,
        website: website1,
        'contact:website': website2,
        'addr:postcode': addrPostcode,
        'addr:city': city,
        'addr:street': rue,
        image: image,
        description: description,
        service: service1,
        animal_breeding: service2,
        brewery: service3,
        ...otherTags
      } = tags;

      // Combiner les valeurs alternatives
      const phone = phone1 || phone2 || '000000000';
      const website = website1 || website2;
      const services = service1 || service2 || service3 || 'Aucun service';

      // Construire la liste des commodités
      const commoditesArray = [];
      if (otherTags['air_conditioning'])
        commoditesArray.push('Air Conditionné');
      if (otherTags['cuisine'])
        commoditesArray.push(`Cuisine : ${otherTags['cuisine']}`);
      if (openingHours === '24/7') commoditesArray.push('Ouvert 24h');
      if (otherTags['outdoor_seating'])
        commoditesArray.push('Sièges Extérieurs');
      if (otherTags['capacity'])
        commoditesArray.push(`Capacité : ${otherTags['capacity']} places`);
      if (otherTags['internet_access']) commoditesArray.push('Wifi');
      if (otherTags['payment:cash']) commoditesArray.push('Espèces');
      if (
        otherTags['payment:debit_cards'] ||
        otherTags['payment:mastercard'] ||
        otherTags['payment:visa']
      ) {
        commoditesArray.push('Carte bancaire');
      }
      if (otherTags['payment:mtm_money'])
        commoditesArray.push('Paiement mobile');

      const commodites =
        commoditesArray.length > 0
          ? commoditesArray.join(';')
          : 'Pas de Commodités';

      // Obtenir les données de géocodage inverse
      let nominatimData: any;
      try {
        nominatimData = await this.nominatimClient.reverse(lat, lon);
      } catch (error) {
        this.logger.warn(`Erreur Nominatim pour ${name} (${id}): ${error}`);
        nominatimData = { address: {} };
      }

      // Exécuter l'insertion en base de données
      await this.dbLimit(async () => {
        try {
          // Commencer une transaction
          await this.dbClient.query('BEGIN');

          // 1. Insérer dans la table batiments
          const batimentQuery = {
            text: `
              INSERT INTO batiments (
                nom, nombre_niveau, code, longitude, latitude, 
                ville, commune, quartier, user_id, rue, 
                created_at, updated_at, image
              ) VALUES (
                $1, $2, $3, $4, $5, 
                $6, $7, $8, $9, $10, 
                $11, $12, $13
              ) RETURNING *
            `,
            values: [
              name,
              0, // nombreNiveau
              `BATIMENT_${id}`,
              lon,
              lat,
              city || nominatimData.address.city || nominatimData.address.state,
              nominatimData.address.city_district || '',
              nominatimData.address.suburb || '',
              1, // idUser
              rue || nominatimData.address.road,
              new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
              new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
              image || '/images/logo-nom.jpg'
            ]
          };

          const batimentResult = await this.dbClient.query(batimentQuery);
          const batimentId = batimentResult.rows[0].id;

          // 2. Insérer dans la table etablissements
          const etablissementQuery = {
            text: `
              INSERT INTO etablissements (
                batiment_id, description, nom, code_postal, 
                site_internet, user_id, etage, services, 
                commodites, phone, whatsapp1, osm_id,
                created_at, updated_at, cover
              ) VALUES (
                $1, $2, $3, $4, 
                $5, $6, $7, $8, 
                $9, $10, $11, $12,
                $13, $14, $15
              ) RETURNING *
            `,
            values: [
              batimentId,
              description || 'Aucune Description',
              name,
              addrPostcode,
              website,
              1, // idUser
              0, // etage
              services,
              commodites,
              phone,
              '000000000', // whatsapp1
              id,
              new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
              new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
              image || '/images/logo-nom.jpg'
            ]
          };

          const etablissementResult = await this.dbClient.query(
            etablissementQuery
          );
          const etablissementId = etablissementResult.rows[0].id;

          // 3. Lier à la sous-catégorie
          await this.dbClient.query(
            'INSERT INTO sous_categories_etablissements (etablissement_id, sous_categorie_id) VALUES ($1, $2)',
            [etablissementId, souscategorie]
          );

          // 4. Ajouter les horaires d'ouverture si disponibles
          if (openingHours) {
            try {
              const hours = convertHour(openingHours);
              const daysMap = {
                mo: 'Lundi',
                tu: 'Mardi',
                we: 'Mercredi',
                th: 'Jeudi',
                fr: 'Vendredi',
                sa: 'Samedi',
                su: 'Dimanche'
              };

              for (const [dayCode, dayName] of Object.entries(daysMap)) {
                if (hours[dayCode] && hours[dayCode][0] && hours[dayCode][1]) {
                  await this.dbClient.query(
                    `INSERT INTO horaires (etablissement_id, jour, plage_horaire, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                      etablissementId,
                      dayName,
                      `${hours[dayCode][0]}-${hours[dayCode][1]}`,
                      new Date()
                        .toISOString()
                        .replace(/T/, ' ')
                        .replace(/\..+/, ''),
                      new Date()
                        .toISOString()
                        .replace(/T/, ' ')
                        .replace(/\..+/, '')
                    ]
                  );
                }
              }
            } catch (error) {
              this.logger.warn(
                `Erreur lors de l'ajout des horaires pour ${name}: ${error}`
              );
            }
          }

          // 5. Marquer cet OSM ID comme traité
          await this.dbClient.query(
            'INSERT INTO temp_processed_osm_ids (osm_id) VALUES ($1)',
            [id]
          );

          // Valider la transaction
          await this.dbClient.query('COMMIT');

          this.stats.successfulInserts++;

          // Log de progression tous les X éléments
          if (this.stats.successfulInserts % CONFIG.LOG_INTERVAL === 0) {
            this.logger.info(
              `Progression: ${this.stats.successfulInserts} établissements insérés`
            );
          }
        } catch (error) {
          // Annuler la transaction en cas d'erreur
          await this.dbClient.query('ROLLBACK');
          this.stats.failedInserts++;
          this.logger.error(
            `Erreur lors de l'insertion de ${name} (${id}):`,
            error
          );
        }
      });
    } catch (error) {
      this.stats.failedInserts++;
      this.logger.error(
        `Erreur lors du traitement de l'élément ${osmData.id}:`,
        error
      );
    }
  }
}
