import * as path from 'path';
import fs from 'fs';

// Logger simple
export class Logger {
  private static instance: Logger;
  private logFile: string;

  private constructor(logFile: string) {
    this.logFile = logFile;

    // Créer le répertoire de logs si nécessaire
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialiser le fichier de log
    fs.writeFileSync(
      this.logFile,
      `=== Logs démarrés le ${new Date().toISOString()} ===\n`,
      { flag: 'a' }
    );
  }

  static getInstance(logFile = './logs/osm-import.log'): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(logFile);
    }
    return Logger.instance;
  }

  private log(level: string, message: string, ...args: any[]): void {
    const timestamp = new Date().toISOString();
    const formattedArgs = args
      .map((arg) => {
        if (arg instanceof Error) {
          return arg.stack || arg.message;
        } else if (typeof arg === 'object') {
          return JSON.stringify(arg, null, 2);
        }
        return String(arg);
      })
      .join(' ');

    const logMessage =
      `[${timestamp}] [${level}] ${message} ${formattedArgs}`.trim();

    // Afficher dans la console
    console.log(logMessage);

    // Écrire dans le fichier de log
    fs.appendFileSync(this.logFile, logMessage + '\n');
  }

  info(message: string, ...args: any[]): void {
    this.log('INFO', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log('WARN', message, ...args);
  }

  error(message: string, ...args: any[]): void {
    this.log('ERROR', message, ...args);
  }
}
