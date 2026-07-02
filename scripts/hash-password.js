// Generates a scrypt password hash to store in tenants.json under "adminPasswordHash".
// Run: npm run hash-password
import { scryptSync, randomBytes } from "crypto";
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question("Password to hash (input will be visible): ", (password) => {
  rl.close();
  if (!password) {
    console.error("No password provided.");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const stored = `${salt.toString("hex")}:${hash.toString("hex")}`;
  console.log('\nPaste this value into tenants.json under "adminPasswordHash":\n');
  console.log(`  ${stored}\n`);
});
