import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
const directory = resolve(process.env.DATA_DIR ?? "data");
await mkdir(directory, { recursive: true, mode: 0o700 });
const configPath = resolve(directory, "admin.json"),
  passwordPath = resolve(directory, "admin-password.txt");
let config;
try {
  config = await open(configPath, "wx", 0o600);
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(
      "管理者設定はすでに存在します。既存のパスワードは変更していません。",
    );
    process.exit(1);
  }
  throw error;
}
const password = randomBytes(24).toString("base64url"),
  salt = randomBytes(16).toString("hex");
try {
  const passwordFile = await open(passwordPath, "wx", 0o600);
  try {
    await passwordFile.writeFile(password + "\n");
    await passwordFile.sync();
  } finally {
    await passwordFile.close();
  }
  await config.writeFile(
    JSON.stringify({
      version: 1,
      salt,
      hash: scryptSync(password, salt, 32).toString("hex"),
    }),
  );
  await config.sync();
} catch (error) {
  await config.close();
  await unlink(configPath).catch(() => {});
  throw error;
}
await config.close();
console.log("管理者を設定しました。 /admin からログインできます。");
console.log("初回パスワードの保存先: " + passwordPath);
console.log(
  "このファイルは管理者だけで保管してください。既存の設定は上書きしません。",
);
