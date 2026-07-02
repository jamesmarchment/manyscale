// Generates a scrypt password hash to store in tenants.json under "adminPasswordHash".
// Run: npm run hash-password
import { createInterface } from "readline";
import { hashPassword } from "../lib/auth.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question("Password to hash (input will be visible): ", (password) => {
  rl.close();
  if (!password) {
    console.error("No password provided.");
    process.exit(1);
  }
  const stored = hashPassword(password);
  console.log('\nPaste this value into tenants.json under "adminPasswordHash":\n');
  console.log(`  ${stored}\n`);
});
