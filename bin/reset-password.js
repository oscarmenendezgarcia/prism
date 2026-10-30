'use strict';

/**
 * bin/reset-password.js — a link to set a new password, for when no admin can make one.
 * Anyone who can run this on the server can read its data anyway, so it asks for nothing else.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { createStore }    = require(path.join(__dirname, '..', 'src', 'services', 'store.js'));
const { resolveDataDir } = require(path.join(__dirname, '..', 'src', 'utils', 'dataDir.js'));

function run(flags) {
  const email = flags.positional;
  if (!email) {
    process.stderr.write('Usage: prism reset-password <email> [--data-dir <path>]\n');
    process.exit(2);
  }

  const dataDir = flags.dataDir || resolveDataDir({ env: process.env, packageRoot: path.join(__dirname, '..'), homedir: os.homedir() }).path;
  if (!fs.existsSync(path.join(dataDir, 'prism.db'))) {
    process.stderr.write(`Error: no database in ${dataDir}. Use --data-dir if it is elsewhere.\n`);
    process.exit(1);
  }

  const log = console.log;
  console.log = () => {}; // Opening the store reports on itself; this command prints a link.
  const store = createStore(dataDir);
  console.log = log;

  const user = store.accounts.getUserByEmail(email);
  const link = user && store.accounts.createResetLink({ userId: user.id, createdBy: 'prism reset-password' });
  store.close();
  if (!link) {
    process.stderr.write(`Error: there is no active account with the email ${email}.\n`);
    process.exit(1);
  }
  process.stdout.write(`Open this on your Prism server, within a day:\n  /reset/${link.token}\n\nFor example: http://localhost:${process.env.PORT || 3000}/reset/${link.token}\n`);
  process.exit(0);
}

module.exports = { run };
