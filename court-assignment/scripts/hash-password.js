const crypto = require("crypto");

function usage() {
  console.error('Usage: `npm run hash-password -- "your password"`');
}

const password = process.argv.slice(2).join(" ").trim();
if (!password) {
  usage();
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 32);
const value = `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
const sessionSecret = crypto.randomBytes(32).toString("base64url");

console.log(`ADMIN_PASSWORD_HASH=${value}`);
console.log(`ADMIN_SESSION_SECRET=${sessionSecret}`);

