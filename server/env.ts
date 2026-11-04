import { loadEnvFile } from "node:process";

// Server only. Vite exposes only VITE_* variables to the browser.
try {
  loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
