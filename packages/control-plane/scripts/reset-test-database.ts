import { resetTestDatabase } from "../src/database";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required to reset the test database.");
}

await resetTestDatabase(connectionString);
