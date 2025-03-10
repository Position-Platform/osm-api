import { insertData } from './functions/insertdata';
import { pool } from './functions/db.config';

async function insertDataInDB() {
  pool.connect(async (err, client, done) => {
    if (err) {
      return done(err);
    }
    if (client) {
      await insertData(client, 'cameroun');
    }
  });
}

insertDataInDB();
